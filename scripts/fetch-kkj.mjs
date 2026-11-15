// 官公需APIから「都道府県 × 公告日（1日単位）」で案件を取得し、生XMLを保存して SQLite に取り込む
//
//   node scripts/fetch-kkj.mjs                              # 茨城（08）・今日を含む過去14日
//   node scripts/fetch-kkj.mjs --lg 08 --days 14
//   node scripts/fetch-kkj.mjs --lg all --days 28 --weekdays # 47都道府県・直近4週間の平日
//   node scripts/fetch-kkj.mjs --lg 13,14 --from 2026-10-22 --to 2026-11-04
//
// 利用規約に従い、リクエストは常に1本ずつ・間隔は1.5秒以上あける。
// 1日・1都道府県で上限（1000件）を超えたら、種別（物品・工事・役務）に分けて取り直す。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR, ROOT, openLocalDb } from './lib/local-db.mjs';
import { prepareCaseUpsert } from './lib/cases-repo.mjs';
import { KKJ_API_URL, KKJ_MAX_COUNT, parseKkjXml } from './lib/kkj.mjs';

const REQUEST_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 3;
const USER_AGENT = 'jimotonyusatsu-fetcher/0.1 (+https://jimotonyusatsu.jp)';
const ALL_LG_CODES = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0'));
// API の Category パラメータ（1:物品 2:工事 3:役務）
const API_CATEGORIES = { 1: 'buppin', 2: 'koji', 3: 'ekimu' };

const { values: args } = parseArgs({
  options: {
    lg: { type: 'string', default: '08' },
    days: { type: 'string', default: '14' },
    from: { type: 'string' },
    to: { type: 'string' },
    weekdays: { type: 'boolean', default: false },
  },
});

const lgCodes = args.lg === 'all' ? ALL_LG_CODES : args.lg.split(',').map((s) => s.trim().padStart(2, '0'));
const dates = resolveDates(args).filter((d) => !args.weekdays || isWeekday(d));
console.log(`[kkj] ${lgCodes.length} 都道府県 × ${dates.length} 日（${dates[0]}〜${dates.at(-1)}）`);

const db = openLocalDb();
const upsert = prepareCaseUpsert(db);
const logRun = db.prepare(`
  INSERT INTO fetch_runs (lg_code, issue_date, search_hits, returned, raw_path, status, error, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let lastRequestAt = 0;
let total = 0;
for (const lgCode of lgCodes) {
  let prefTotal = 0;
  for (const date of dates) prefTotal += await fetchDay(lgCode, date);
  total += prefTotal;
  console.log(`[kkj] LG=${lgCode} 計 ${prefTotal} 件`);
}

const { n } = db.prepare("SELECT COUNT(*) AS n FROM cases WHERE source = 'kkj'").get();
console.log(`[kkj] 完了: 今回 ${total} 件取り込み / SQLite 内の kkj は計 ${n} 件`);
db.close();

// ---------------------------------------------------------------------------

/** 1都道府県・1日分。上限超えなら種別ごとに取り直す。取り込んだ件数を返す */
async function fetchDay(lgCode, date) {
  const first = await fetchAndStore(lgCode, date);
  if (first === null || first.searchHits <= first.returned) return first?.returned ?? 0;

  console.warn(`[kkj] LG=${lgCode} ${date}: hits ${first.searchHits} > ${first.returned} → 種別ごとに取り直し`);
  let returned = 0;
  for (const category of Object.keys(API_CATEGORIES)) {
    const part = await fetchAndStore(lgCode, date, category);
    if (part && part.searchHits > part.returned) {
      console.warn(`[kkj] LG=${lgCode} ${date} Category=${category}: ⚠ hits ${part.searchHits} > ${part.returned}（取りこぼしあり）`);
    }
    returned += part?.returned ?? 0;
  }
  return returned;
}

async function fetchAndStore(lgCode, date, category) {
  const fetchedAt = new Date().toISOString();
  const label = `LG=${lgCode} ${date}${category ? ` Category=${category}` : ''}`;
  try {
    const xml = await fetchWithRetry(lgCode, date, category);
    const rawPath = saveRaw(lgCode, category ? `${date}_c${category}` : date, xml);
    const { searchHits, rows } = parseKkjXml(xml, fetchedAt);

    db.exec('BEGIN');
    for (const row of rows) upsert(row);
    db.exec('COMMIT');

    logRun.run(lgCode, date, searchHits, rows.length, rawPath, 'ok', null, fetchedAt);
    if (rows.length > 0) console.log(`[kkj] ${label}: ${rows.length} 件`);
    return { searchHits, returned: rows.length };
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    logRun.run(lgCode, date, null, null, null, 'error', String(err?.message ?? err), fetchedAt);
    console.error(`[kkj] ${label}: 失敗 ${err?.message ?? err}`);
    return null;
  }
}

async function fetchWithRetry(lgCode, date, category) {
  const url = new URL(KKJ_API_URL);
  url.searchParams.set('LG_Code', lgCode);
  url.searchParams.set('CFT_Issue_Date', `${date}/${date}`);
  if (category) url.searchParams.set('Category', category);
  url.searchParams.set('Count', String(KKJ_MAX_COUNT));

  for (let attempt = 1; ; attempt++) {
    await waitForInterval(attempt === 1 ? REQUEST_INTERVAL_MS : REQUEST_INTERVAL_MS * 2 ** attempt);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      console.warn(`[kkj] LG=${lgCode} ${date}: ${err.message}（${attempt}回目）→ 再試行`);
    }
  }
}

// 直前のリクエスト「開始」から minMs 以上あける（逐次実行なので同時リクエストは常に1本）
async function waitForInterval(minMs) {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt > 0 && elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed));
  lastRequestAt = Date.now();
}

function saveRaw(lgCode, name, xml) {
  const dir = join(DATA_DIR, 'raw', 'kkj', lgCode);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.xml`);
  writeFileSync(path, xml);
  return relative(ROOT, path);
}

function resolveDates({ from, to, days }) {
  if (from || to) {
    if (!from || !to) throw new Error('--from と --to は両方指定してください');
    return enumerateDates(from, to);
  }
  const today = todayInJst();
  const start = addDays(today, -(Number(days) - 1));
  return enumerateDates(start, today);
}

/** 土日を除く（祝日は除かない。祝日は 0 件で返るだけなので、取りこぼしを避けて含める） */
function isWeekday(ymd) {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function todayInJst() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

function addDays(ymd, delta) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function enumerateDates(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
