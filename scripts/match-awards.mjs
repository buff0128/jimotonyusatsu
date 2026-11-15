// 手元の案件（cases、kkj）と落札実績（awards）を突き合わせ、case_award_matches に入れる（試作）
//
//   node scripts/match-awards.mjs
//
// 照合の方法
//   number : 公告文（ProjectDescription）の先頭にある「調達案件番号(19桁)」と、落札実績の調達案件番号が一致（確実）
//   title  : 件名を正規化して完全一致し、その件名の落札実績が1件だけ（番号を持たない案件向けの補助。サイトには出さない）
// 件名照合の精度は、番号で正解が分かっている案件に件名照合をかけて測る（結果は標準出力と docs/LOG_2026-11-05.md）
import { openLocalDb } from './lib/local-db.mjs';

const db = openLocalDb();
db.exec(`CREATE TABLE IF NOT EXISTS case_award_matches (
  case_id TEXT NOT NULL, procurement_item_no TEXT NOT NULL, method TEXT NOT NULL,
  PRIMARY KEY (case_id, procurement_item_no))`);

const awardsByNo = new Map();
const awardsByTitle = new Map();
for (const a of db.prepare('SELECT procurement_item_no, item_name FROM awards').iterate()) {
  awardsByNo.set(a.procurement_item_no, a);
  const key = normalizeTitle(a.item_name);
  if (!key) continue;
  if (!awardsByTitle.has(key)) awardsByTitle.set(key, new Set());
  awardsByTitle.get(key).add(a.procurement_item_no);
}

const cases = db.prepare("SELECT id, project_name, description FROM cases WHERE source = 'kkj'").all();
const insert = db.prepare("INSERT INTO case_award_matches (case_id, procurement_item_no, method) VALUES (?, ?, ?)");
const stats = { cases: cases.length, withNumber: 0, numberMatched: 0, titleMatched: 0, evalTotal: 0, evalCorrect: 0, evalWrong: 0, evalNone: 0 };

db.exec('BEGIN');
db.exec('DELETE FROM case_award_matches');
for (const c of cases) {
  const no = c.description?.match(/調達案件番号\s*(\d{19})/)?.[1];
  const byTitle = titleMatch(c.project_name);
  if (no) {
    stats.withNumber++;
    if (awardsByNo.has(no)) {
      stats.numberMatched++;
      insert.run(c.id, no, 'number');
      // 件名照合の精度：番号で正解が分かっている案件で、件名照合が同じ番号を当てるか
      stats.evalTotal++;
      if (!byTitle) stats.evalNone++;
      else if (byTitle === no) stats.evalCorrect++;
      else stats.evalWrong++;
    }
    continue;
  }
  if (byTitle) {
    stats.titleMatched++;
    insert.run(c.id, byTitle, 'title');
  }
}
db.exec('COMMIT');
console.log('[match]', stats);
console.log(
  `[match] 件名照合の精度（番号で正解が分かる ${stats.evalTotal} 件で評価）: 正解 ${stats.evalCorrect} / 誤り ${stats.evalWrong} / 見つからず ${stats.evalNone}`,
);
db.close();

function titleMatch(projectName) {
  const set = awardsByTitle.get(normalizeTitle(projectName));
  return set && set.size === 1 ? [...set][0] : null;
}

/** 全角・空白・記号・ファイル情報の違いをならす */
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .normalize('NFKC')
    .replace(/\((?:PDF|pdf)[^)]*\)|\[(?:PDF|pdf)[^\]]*\]/g, '')
    .replace(/[\s　・･「」『』()（）【】\[\]〈〉<>"'、。,.\-－ー―]/g, '')
    .toLowerCase();
}
