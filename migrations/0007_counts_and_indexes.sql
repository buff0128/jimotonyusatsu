-- D1 の読み取りを減らす（集計テーブル・インデックスの見直し）。詳細は docs/LOG_2026-11-05.md「4回目」
--
-- D1 の無料枠は「1日の書き込み10万行」。インデックスを作ると既存の全行ぶん書き込みが発生し、
-- 行を更新するたびに、その列を含むインデックスの行も書き込みに数えられる。そのため新しいインデックスは最小限にしている。

-- 件数の集計（同期のときに scripts/lib/case-counts.mjs で計算する。ページはここを読むだけ）
--   dim      : all / category / tag / city / org
--   lg_code  : 都道府県コード2桁。'' は全国
--   value    : all は ''、category は buppin|koji|ekimu（未分類は ''）、tag は業種 slug、city は市区町村コード、org は発注機関ID
CREATE TABLE case_counts (
  dim     TEXT NOT NULL,
  lg_code TEXT NOT NULL,
  value   TEXT NOT NULL,
  n       INTEGER NOT NULL,
  PRIMARY KEY (dim, lg_code, value)
) WITHOUT ROWID;

-- 発注機関（同期のときに計算）。lg_code は件数の多い都道府県（パンくず用）
CREATE TABLE org_stats (
  org_id            TEXT PRIMARY KEY,
  organization_name TEXT NOT NULL,
  lg_code           TEXT NOT NULL,
  case_count        INTEGER NOT NULL
) WITHOUT ROWID;

-- 「締切前」の絞り込み用：入札書の提出期限（API の値、なければ AI の抽出値）。同期のときに計算する派生列で、API の値は変えない
ALTER TABLE cases ADD COLUMN effective_deadline TEXT;
-- 期限がある行（全体の数%）だけの部分インデックス。書き込みが少ない
CREATE INDEX idx_cases_effective_deadline ON cases (effective_deadline) WHERE effective_deadline IS NOT NULL;

-- 使っていないインデックスを外す（行の更新のたびに書き込みが増えるため）
DROP INDEX IF EXISTS idx_cases_org;            -- organization_name では引かない（org_id を使う）
DROP INDEX IF EXISTS idx_cases_deadline;       -- effective_deadline に置き換え
DROP INDEX IF EXISTS idx_cases_source_issue;   -- D1 には kkj しか無い

-- 都道府県の一覧（kind = 'pref' を sort 順）を全件走査しない
CREATE INDEX idx_areas_kind_sort ON areas (kind, sort);
