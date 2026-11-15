// AI 抽出・要約の対象を選ぶ（締切がまだ先の案件から、地域・種別・業種が偏らないように N 件）
//
//   node scripts/select-ai-targets.mjs --count 100 --after 2026-11-10
//
// 締切は「参加申請の期限」と「入札書の提出期限」の早いほう。
// 入札書の提出期限は API の TenderSubmissionDeadline、なければ公告文（ProjectDescription）から推定する。
// 公告文では「申請・参加表明・申込・資格確認」の直後の日付を参加申請の期限、「入札書・提出・締切・開札」の直後の日付を
// 入札書の提出期限の候補とし、それぞれ最も遅い日付を採る（履行期間・納入期限などの日付は除く）。
// 最終的な締切は AI が公告を読んで確定する。結果は data/ai/targets.json。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR, openLocalDb } from './lib/local-db.mjs';

// 公告文で、日付の直前にこの語があれば「参加申請の期限」「入札書の提出期限」の候補とみなす
const APPLICATION_WORDS = /申請|参加表明|申込|申し込|資格確認|参加意向/;
const TENDER_WORDS = /入札書|提出|締切|締め切|開札|入札日|受付/;

const { values: args } = parseArgs({
  options: {
    count: { type: 'string', default: '100' },
    after: { type: 'string' }, // この日以降に締切がある案件（既定：今日+5日）
    out: { type: 'string', default: 'targets.json' }, // data/ai/ の下の出力ファイル名
    exclude: { type: 'string' }, // 除外する案件の JSON（data/ai/ の下。[{ id }]）
  },
});
const count = Number(args.count);
const excluded = new Set(
  args.exclude ? JSON.parse(readFileSync(join(DATA_DIR, 'ai', args.exclude), 'utf8')).map((t) => t.id) : [],
);
const after = args.after ?? addDays(todayInJst(), 5);

const db = openLocalDb();
const rows = db
  .prepare(
    `SELECT c.id, c.project_name, c.lg_code, c.category, c.tender_submission_deadline, c.description,
            (SELECT group_concat(tag) FROM case_tags t WHERE t.case_id = c.id) AS tags
     FROM cases c
     WHERE c.source = 'kkj' AND (c.external_document_uri IS NOT NULL OR c.attachments IS NOT NULL)
       -- 調達ポータルへのリンクは検索画面に飛ぶだけで、公告本文が取れない
       AND COALESCE(c.external_document_uri, '') NOT LIKE '%p-portal.go.jp%'
       AND NOT EXISTS (SELECT 1 FROM case_ai a WHERE a.case_id = c.id)`,
  )
  .all();
db.close();

const candidates = rows
  .map((r) => ({ ...r, estimatedDeadline: estimateDeadline(r) }))
  .filter((r) => !excluded.has(r.id))
  .filter((r) => r.estimatedDeadline && r.estimatedDeadline >= after && r.estimatedDeadline <= addDays(after, 120));
console.log(`[select] 候補 ${candidates.length} 件（締切 ${after} 以降と推定）/ 全 ${rows.length} 件`);

// 貪欲法：すでに選んだ件数が少ない「都道府県・種別・業種」を持つ案件を優先する（同点は ID 順で決定的に）
const picked = [];
const used = { pref: new Map(), category: new Map(), tag: new Map() };
const pool = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
while (picked.length < count && pool.length > 0) {
  let best = 0;
  let bestScore = Infinity;
  pool.forEach((c, i) => {
    const tags = c.tags ? c.tags.split(',') : ['(none)'];
    const score =
      3 * (used.pref.get(c.lg_code) ?? 0) +
      0.2 * (used.category.get(c.category ?? '(none)') ?? 0) +
      Math.min(...tags.map((t) => used.tag.get(t) ?? 0));
    if (score < bestScore) [best, bestScore] = [i, score];
  });
  const [c] = pool.splice(best, 1);
  picked.push(c);
  const inc = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  inc(used.pref, c.lg_code);
  inc(used.category, c.category ?? '(none)');
  for (const t of c.tags ? c.tags.split(',') : ['(none)']) inc(used.tag, t);
}

const out = picked.map((c) => ({
  id: c.id,
  project_name: c.project_name,
  lg_code: c.lg_code,
  category: c.category,
  tags: c.tags,
  estimated_deadline: c.estimatedDeadline,
}));
writeFileSync(join(DATA_DIR, 'ai', args.out), JSON.stringify(out, null, 2));
console.log(`[select] ${out.length} 件を data/ai/${args.out} に書き出し`);
console.log('都道府県:', Object.fromEntries([...used.pref].sort()));
console.log('種別:', Object.fromEntries(used.category));
console.log('業種:', Object.fromEntries([...used.tag].sort((a, b) => b[1] - a[1])));

// ---------------------------------------------------------------------------

/** 参加申請の期限と入札書の提出期限の早いほう（YYYY-MM-DD）。どちらも分からなければ null */
function estimateDeadline({ tender_submission_deadline: apiTender, description }) {
  const fromText = scanDeadlines(description);
  const tender = apiTender?.slice(0, 10) ?? fromText.tender;
  const candidates = [fromText.application, tender].filter(Boolean);
  return candidates.length > 0 ? candidates.sort()[0] : null;
}

/** 公告文から { application, tender }（それぞれ最も遅い日付）を拾う */
function scanDeadlines(description) {
  const found = { application: null, tender: null };
  if (!description) return found;
  const text = description.normalize('NFKC');
  const DATE = /(?:令和\s*(\d+)\s*年|R\s*(\d+)\s*[./年]|(20\d\d)\s*[年/.-])\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/g;
  for (const m of text.matchAll(DATE)) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (/履行|納入|納期|工期|契約期間|期間|から$/.test(before.slice(-15))) continue;
    const kind = APPLICATION_WORDS.test(before) ? 'application' : TENDER_WORDS.test(before) ? 'tender' : null;
    if (!kind) continue;
    const year = m[1] ? 2018 + Number(m[1]) : m[2] ? 2018 + Number(m[2]) : Number(m[3]);
    const date = `${year}-${m[4].padStart(2, '0')}-${m[5].padStart(2, '0')}`;
    if (!found[kind] || date > found[kind]) found[kind] = date;
  }
  return found;
}

function todayInJst() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

function addDays(ymd, delta) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
