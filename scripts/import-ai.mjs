// AI 抽出結果（data/ai/results/*.json）を検証して case_ai と case_tags（method='ai'）に取り込む
//
//   node scripts/import-ai.mjs
//
// 形式は scripts/lib/case-ai.mjs。エラーのあるファイルは取り込まない。
// API の値は cases に残したまま変えない（表示側で API が空の項目だけ AI の値を使う）。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, openLocalDb } from './lib/local-db.mjs';
import { normalizeAiResult, toExtracted, validateAiResult } from './lib/case-ai.mjs';

const GENERATED_BY = 'claude-opus-5-5 (Claude Code)';
const dir = join(DATA_DIR, 'ai', 'results');

const db = openLocalDb();
const exists = db.prepare('SELECT 1 FROM cases WHERE id = ?');
const upsertAi = db.prepare(`
  INSERT INTO case_ai (case_id, qualifications, bid_method, summary, extracted, source_files, generated_by, generated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (case_id) DO UPDATE SET
    qualifications = excluded.qualifications, bid_method = excluded.bid_method, summary = excluded.summary,
    extracted = excluded.extracted, source_files = excluded.source_files,
    generated_by = excluded.generated_by, generated_at = excluded.generated_at
`);
const deleteTags = db.prepare('DELETE FROM case_tags WHERE case_id = ?');
const insertTag = db.prepare("INSERT INTO case_tags (case_id, tag, method) VALUES (?, ?, 'ai')");

let imported = 0;
let rejected = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const { result, changes } = normalizeAiResult(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  if (changes.length > 0) console.log(`[ai] 補正 ${file}: ${changes.join(' / ')}`);
  const { errors, warnings } = validateAiResult(result);
  if (!exists.get(result.id)) errors.push('cases に無い案件');
  if (errors.length > 0) {
    rejected++;
    console.error(`[ai] ✗ ${file}: ${errors.join(' / ')}`);
    continue;
  }
  if (warnings.length > 0) console.warn(`[ai] △ ${file}: ${warnings.join(' / ')}`);

  db.exec('BEGIN');
  upsertAi.run(
    result.id,
    result.qualifications ?? null,
    result.bid_method ?? null,
    result.summary,
    JSON.stringify(toExtracted(result)),
    JSON.stringify(result.source_files ?? []),
    GENERATED_BY,
    new Date().toISOString(),
  );
  // AI のタグがある案件は、キーワードのタグを外して AI のタグだけにする
  deleteTags.run(result.id);
  for (const tag of result.tags) insertTag.run(result.id, tag);
  db.exec('COMMIT');
  imported++;
}
db.close();
console.log(`[ai] 取り込み ${imported} 件 / エラー ${rejected} 件`);
