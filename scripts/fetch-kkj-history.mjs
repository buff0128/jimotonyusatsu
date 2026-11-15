// 統計用に、官公需APIから過去分（既定：過去12か月の平日 × 47都道府県）を取得して手元の cases_history に入れる
//
//   node scripts/fetch-kkj-history.mjs                       # 今日から365日前〜29日前（それより新しい分は fetch-kkj で cases にある）
//   node scripts/fetch-kkj-history.mjs --from 2025-11-05 --to 2026-10-07 --lg 08,13
//
// - サイトには出さない・D1 にも送らない。統計（scripts/lib/stats.mjs）の計算にだけ使う
// - リクエストは1本ずつ、間隔1.5秒以上（官公需APIの利用規約）
// - 取得済みの「都道府県×日」は history_runs に記録し、再実行すると続きから取る（途中再開できる）
// - 生XMLは保存しない（容量のため）。統計に使う列だけを保存する
import { parseArgs } from 'node:util';
import { openLocalDb } from './lib/local-db.mjs';
import { orgId } from './lib/cases-repo.mjs';
import { KKJ_API_URL, KKJ_MAX_COUNT, parseKkjXml } from './lib/kkj.mjs';

const REQUEST_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 3;
const USER_AGENT = 'jimotonyusatsu-fetcher/0.1 (+https://jimotonyusatsu.jp)';
const ALL_LG_CODES = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0'));

const { values: args } = parseArgs({
  options: {
    lg: { type: 'string', default: 'all' },
    from: { type: 'string' },
    to: { type: 'string' },
  },
});
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
const from = args.from ?? addDays(today, -365);
const to = args.to ?? addDays(today, -29);
const lgCodes = args.lg === 'all' ? ALL_LG_CODES : args.lg.split(',').map((s) => s.trim().padStart(2, '0'));
const dates = enumerateDates(from, to).filter(isWeekday);

const db = openLocalDb();
const done = new Set(db.prepare("SELECT lg_code || ':' || issue_date AS k FROM history_runs WHERE status = 'ok'").all().map((r) => r.k));
const insert = db.prepare(`
  INSERT INTO cases_history (id, project_name, organization_name, org_id, lg_code, city_code, category, procedure_type,
    certification, cft_issue_date, tender_submission_deadline, opening_tenders_event, fetched_at)
  VALUES (:id, :project_name, :organization_name, :org_id, :lg_code, :city_code, :category, :procedure_type,
    :certification, :cft_issue_date, :tender_submission_deadline, :opening_tenders_event, :fetched_at)
  ON CONFLICT (id) DO UPDATE SET project_name = excluded.project_name, organization_name = excluded.organization_name,
    org_id = excluded.org_id, lg_code = excluded.lg_code, city_code = excluded.city_code, category = excluded.category,
    procedure_type = excluded.procedure_type, certification = excluded.certification, cft_issue_date = excluded.cft_issue_date,
    tender_submission_deadline = excluded.tender_submission_deadline, opening_tenders_event = excluded.opening_tenders_event,
    fetched_at = excluded.fetched_at`);
const logRun = db.prepare(`INSERT INTO history_runs (lg_code, issue_date, search_hits, returned, status, error, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (lg_code, issue_date) DO UPDATE SET search_hits = excluded.search_hits,
  returned = excluded.returned, status = excluded.status, error = excluded.error, fetched_at = excluded.fetched_at`);

const todo = [];
// 新しい日から順に取る（途中で止めても、最近の月から統計に使える）
for (const date of [...dates].reverse()) for (const lg of lgCodes) if (!done.has(`${lg}:${date}`)) todo.push([lg, date]);
console.log(`[history] ${from}〜${to}（平日 ${dates.length} 日）× ${lgCodes.length} 都道府県：残り ${todo.length} / 全 ${dates.length * lgCodes.length}`);

let lastRequestAt = 0;
let total = 0;
for (const [index, [lg, date]] of todo.entries()) {
  const fetchedAt = new Date().toISOString();
  try {
    let { searchHits, rows } = await fetchDay(lg, date);
    if (searchHits > rows.length) {
      // 1000件を超える日は種別（1:物品 2:工事 3:役務）に分けて取り直す
      rows = [];
      for (const category of ['1', '2', '3']) rows.push(...(await fetchDay(lg, date, category)).rows);
    }
    db.exec('BEGIN');
    for (const row of rows) insert.run({ ...pick(row), org_id: orgId(row.organization_name) });
    logRun.run(lg, date, searchHits, rows.length, 'ok', null, fetchedAt);
    db.exec('COMMIT');
    total += rows.length;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    logRun.run(lg, date, null, null, 'error', String(err?.message ?? err), fetchedAt);
    console.error(`[history] LG=${lg} ${date}: 失敗 ${err?.message ?? err}`);
  }
  if ((index + 1) % 100 === 0) console.log(`[history] ${index + 1} / ${todo.length}（${date}、累計 ${total} 件）`);
}
console.log(`[history] 完了：今回 ${total} 件。cases_history は計 ${db.prepare('SELECT COUNT(*) AS n FROM cases_history').get().n} 件`);
db.close();

// ---------------------------------------------------------------------------

async function fetchDay(lg, date, category) {
  const url = new URL(KKJ_API_URL);
  url.searchParams.set('LG_Code', lg);
  url.searchParams.set('CFT_Issue_Date', `${date}/${date}`);
  if (category) url.searchParams.set('Category', category);
  url.searchParams.set('Count', String(KKJ_MAX_COUNT));
  for (let attempt = 1; ; attempt++) {
    await waitForInterval(attempt === 1 ? REQUEST_INTERVAL_MS : REQUEST_INTERVAL_MS * 2 ** attempt);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseKkjXml(await res.text(), new Date().toISOString());
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}

function pick(row) {
  const keys = ['id', 'project_name', 'organization_name', 'lg_code', 'city_code', 'category', 'procedure_type', 'certification',
    'cft_issue_date', 'tender_submission_deadline', 'opening_tenders_event', 'fetched_at'];
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
}

// 直前のリクエスト「開始」から minMs 以上あける（逐次実行なので同時リクエストは常に1本）
async function waitForInterval(minMs) {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt > 0 && elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed));
  lastRequestAt = Date.now();
}

function isWeekday(ymd) {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function addDays(ymd, delta) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function enumerateDates(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
