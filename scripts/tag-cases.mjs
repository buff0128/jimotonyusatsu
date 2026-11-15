// 件名のキーワードで業種タグ（case_tags, method='rule'）を付け直す
//
//   node scripts/tag-cases.mjs
//
// 体系とキーワードは src/lib/gyoshu.ts（説明は docs/GYOSHU.md）。
// AI のタグ（method='ai'）が付いている案件は、AI の判断を優先してキーワードのタグを付けない。
import { openLocalDb } from './lib/local-db.mjs';
import { classifyByKeywords } from '../src/lib/gyoshu.ts';

const db = openLocalDb();
const cases = db
  .prepare(
    `SELECT id, project_name, category FROM cases c
     WHERE source = 'kkj' AND NOT EXISTS (SELECT 1 FROM case_tags t WHERE t.case_id = c.id AND t.method = 'ai')`,
  )
  .all();

const insert = db.prepare("INSERT INTO case_tags (case_id, tag, method) VALUES (?, ?, 'rule')");
const counts = new Map();
let untagged = 0;

db.exec('BEGIN');
db.exec("DELETE FROM case_tags WHERE method = 'rule'");
for (const c of cases) {
  const tags = classifyByKeywords(c.project_name, c.category);
  if (tags.length === 0) untagged++;
  for (const tag of tags) {
    insert.run(c.id, tag);
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
}
db.exec('COMMIT');

console.log(`[tags] 対象 ${cases.length} 件 / タグなし ${untagged} 件（${((untagged / cases.length) * 100).toFixed(1)}%）`);
console.table(Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])));
db.close();
