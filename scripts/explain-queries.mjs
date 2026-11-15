// サイトの主要なクエリ（src/lib/db.ts と同じ形）の実行計画を確認する
//
//   node scripts/explain-queries.mjs
//
// 手元 SQLite は D1 と同じマイグレーションなので、インデックスの使われ方は同じになる。
// 「SCAN」（表やインデックスの全件走査）を含むものに ⚠ を付ける（LIMIT 付きの副問い合わせの結果を読む SCAN (subquery-N) は除く）。D1 の読み取り行数を抑えるためのチェック用。
import { openLocalDb } from './lib/local-db.mjs';

const SUMMARY = `SELECT c.id, json_extract(ai.extracted, '$.project_name'), p.slug, a.slug,
  (SELECT group_concat(ct.tag) FROM case_tags ct WHERE ct.case_id = c.id)
  FROM cases c LEFT JOIN case_ai ai ON ai.case_id = c.id LEFT JOIN areas p ON p.code = c.lg_code LEFT JOIN areas a ON a.code = c.city_code`;
const ORDER = 'ORDER BY c.cft_issue_date DESC LIMIT 50 OFFSET 0';
const SRC = "+c.source = 'kkj'";
const KW = `(c.project_name LIKE '%清掃%' OR c.organization_name LIKE '%清掃%' OR EXISTS (SELECT 1 FROM case_descriptions d WHERE d.case_id = c.id AND d.text LIKE '%清掃%'))`;

const QUERIES = {
  '都道府県一覧（件数つき）': `SELECT a.code, k.n FROM areas a LEFT JOIN case_counts k ON k.dim = 'all' AND k.lg_code = a.code AND k.value = '' WHERE a.kind = 'pref' ORDER BY a.sort`,
  '市区町村（件数つき）': `SELECT a.code, k.n FROM case_counts k JOIN areas a ON a.code = k.value WHERE k.dim = 'city' AND k.lg_code = '13' ORDER BY a.sort, a.code`,
  '件数（種別・業種など）': `SELECT value, n FROM case_counts WHERE dim = 'tag' AND lg_code = '13'`,
  '業種の都道府県別件数': `SELECT lg_code, n FROM case_counts WHERE dim = 'tag' AND value = 'seiso' AND lg_code != ''`,
  '発注機関（上位30）': `SELECT o.org_id, k.n FROM case_counts k JOIN org_stats o ON o.org_id = k.value WHERE k.dim = 'org' AND k.lg_code = '13' ORDER BY k.n DESC, o.organization_name LIMIT 30`,
  '発注機関（1件）': `SELECT * FROM org_stats o LEFT JOIN areas p ON p.code = o.lg_code WHERE o.org_id = 'da880451cc'`,
  '一覧：全国の新着': `${SUMMARY} WHERE ${SRC} ${ORDER}`,
  '一覧：都道府県': `${SUMMARY} WHERE ${SRC} AND c.lg_code = '13' ${ORDER}`,
  '一覧：都道府県×種別': `${SUMMARY} WHERE ${SRC} AND c.lg_code = '13' AND c.category = 'koji' ${ORDER}`,
  '一覧：市区町村': `${SUMMARY} WHERE ${SRC} AND c.city_code = '13101' ${ORDER}`,
  '一覧：発注機関': `${SUMMARY} WHERE ${SRC} AND c.org_id = 'da880451cc' ${ORDER}`,
  '一覧：業種（全国）': SUMMARY.replace('FROM cases c', 'FROM case_tags t JOIN cases c ON c.id = t.case_id') + ` WHERE ${SRC} AND t.tag = 'seiso' ${ORDER}`,
  '一覧：都道府県×業種': SUMMARY.replace('FROM cases c', 'FROM case_tags t JOIN cases c ON c.id = t.case_id') + ` WHERE ${SRC} AND t.tag = 'seiso' AND c.lg_code = '13' ${ORDER}`,
  '一覧：締切前': `${SUMMARY} WHERE ${SRC} AND c.effective_deadline >= '2026-11-05' ${ORDER}`,
  '件数：締切前（COUNT）': `SELECT COUNT(*) FROM cases c WHERE ${SRC} AND c.effective_deadline >= '2026-11-05'`,
  '検索：キーワード': `${SUMMARY} WHERE ${SRC} AND ${KW} ${ORDER}`,
  '検索：キーワード×都道府県': `${SUMMARY} WHERE ${SRC} AND c.lg_code = '13' AND ${KW} ${ORDER}`,
  '案件（1件）': `SELECT * FROM cases WHERE id = '45d36282ece39620' AND +source = 'kkj'`,
  '公告文（分割）': `SELECT text FROM case_descriptions WHERE case_id = '45d36282ece39620' ORDER BY seq`,
  '関連：同じ都道府県×業種': SUMMARY.replace('FROM cases c', 'FROM case_tags t JOIN cases c ON c.id = t.case_id') + ` WHERE ${SRC} AND t.tag = 'seiso' AND c.lg_code = '13' AND c.id != 'x' ORDER BY c.cft_issue_date DESC LIMIT 5`,
  '一覧：締切が近い順（全国）': `${SUMMARY} WHERE ${SRC} AND c.effective_deadline >= '2026-11-05' ORDER BY c.effective_deadline, c.cft_issue_date DESC LIMIT 51`,
  '一覧：締切が近い順（市区町村）': `${SUMMARY} WHERE ${SRC} AND +c.city_code = '08201' AND c.effective_deadline >= '2026-11-05' ORDER BY c.effective_deadline, c.cft_issue_date DESC LIMIT 6`,
  '一覧：締切が近い順（都道府県×業種）': SUMMARY.replace('FROM cases c', 'FROM cases c CROSS JOIN case_tags t ON t.case_id = c.id') + ` WHERE ${SRC} AND t.tag = 'seiso' AND +c.lg_code = '08' AND c.effective_deadline >= '2026-11-05' ORDER BY c.effective_deadline, c.cft_issue_date DESC LIMIT 51`,
  '一覧：ラベル2つ×都道府県': `${SUMMARY} WHERE ${SRC} AND c.lg_code = '08' AND c.id IN (SELECT case_id FROM case_labels WHERE label = 'paper') AND c.id IN (SELECT case_id FROM case_labels WHERE label = 'no-bond') ${ORDER}`,
  '件数：市区町村×業種・機関（範囲）': `SELECT value, n FROM case_counts WHERE dim = 'city_tag' AND lg_code = '08' AND value > '08201:' AND value < '08201;'`,
  '件数：タイル（今週・7日以内）': `SELECT n FROM case_counts WHERE dim = 'due7' AND lg_code = '08' AND value = '08201'`,
  '地元の選択：市区町村の一覧': `SELECT a.code, COALESCE(k.n, 0) FROM areas a LEFT JOIN case_counts k ON k.dim = 'city' AND k.lg_code = a.lg_code AND k.value = a.code WHERE a.code > '08000' AND a.code < '08999' AND +a.kind = 'city' AND a.lg_code = '08' ORDER BY a.sort, a.code`,
  'ねらい目（全国・締切前・ラベルあり）': `${SUMMARY} WHERE ${SRC} AND c.effective_deadline >= '2026-11-08' AND EXISTS (SELECT 1 FROM case_labels l WHERE l.case_id = c.id) ORDER BY c.effective_deadline, c.cft_issue_date DESC LIMIT 7`,
  'ねらい目（市区町村・締切前・ラベルあり）': `${SUMMARY} WHERE ${SRC} AND +c.lg_code = '08' AND +c.city_code = '08201' AND c.effective_deadline >= '2026-11-08' AND EXISTS (SELECT 1 FROM case_labels l WHERE l.case_id = c.id) ORDER BY c.effective_deadline, c.cft_issue_date DESC LIMIT 7`,
  'お気に入り：保存した条件の新着（都道府県）': `SELECT COUNT(*) FROM (SELECT 1 FROM cases c WHERE ${SRC} AND c.lg_code = '08' AND c.cft_issue_date > '2026-11-01' ORDER BY c.cft_issue_date DESC LIMIT 100)`,
  'お気に入り：保存した条件の新着（市区町村）': `SELECT COUNT(*) FROM (SELECT 1 FROM cases c WHERE ${SRC} AND c.lg_code = '08' AND c.city_code = '08201' AND c.cft_issue_date > '2026-11-01' ORDER BY c.cft_issue_date DESC LIMIT 100)`,
  'お気に入り：保存した条件の新着（キーワード）': `SELECT COUNT(*) FROM (SELECT 1 FROM cases c WHERE ${SRC} AND ${KW} AND c.cft_issue_date > '2026-11-01' ORDER BY c.cft_issue_date DESC LIMIT 100)`,
  'お気に入り：保存した条件の新着（都道府県×業種）': `SELECT COUNT(*) FROM (SELECT 1 FROM case_tags t JOIN cases c ON c.id = t.case_id WHERE ${SRC} AND t.tag = 'seiso' AND c.lg_code = '08' AND c.cft_issue_date > '2026-11-01' ORDER BY c.cft_issue_date DESC LIMIT 100)`,
  'お気に入り：保存した条件の新着（締切前）': `SELECT COUNT(*) FROM (SELECT 1 FROM cases c WHERE ${SRC} AND c.lg_code = '08' AND c.effective_deadline >= '2026-11-08' AND c.cft_issue_date > '2026-11-01' ORDER BY c.cft_issue_date DESC LIMIT 100)`,
  'お気に入り：発注機関の新着': `SELECT org_id, COUNT(*), SUM(cft_issue_date > '2026-11-01') FROM cases WHERE org_id = 'da880451cc' AND +source = 'kkj' GROUP BY org_id`,
};

const db = openLocalDb();
for (const [label, sql] of Object.entries(QUERIES)) {
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail);
  const scan = plan.some((d) => /^SCAN (?!CONSTANT|\(subquery)/.test(d) && !/USING (COVERING )?INDEX idx_cases_issue/.test(d));
  console.log(`${scan ? '⚠' : '✓'} ${label}\n${plan.map((d) => `    ${d}`).join('\n')}`);
}
db.close();
