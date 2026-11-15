-- 回遊（発注機関ページ・業種ページ）と AI 抽出のためのスキーマ

-- 発注機関ID：organization_name（API の値そのまま）の sha256 先頭10桁。/orgs/{org_id} に使う。
-- 機関名を束ねたり分けたりはしないので、表記が違えば別の機関になる。
ALTER TABLE cases ADD COLUMN org_id TEXT;
CREATE INDEX idx_cases_org_id_issue ON cases (org_id, cft_issue_date DESC);
CREATE INDEX idx_cases_issue ON cases (cft_issue_date DESC);
CREATE INDEX idx_cases_deadline ON cases (tender_submission_deadline);

-- 業種タグ（体系は docs/GYOSHU.md・src/lib/gyoshu.ts）
--   rule: 件名のキーワードで機械的に付けたもの / ai: 公告を読んで AI が付けたもの
CREATE TABLE case_tags (
  case_id TEXT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  method  TEXT NOT NULL CHECK (method IN ('rule', 'ai')),
  PRIMARY KEY (case_id, tag)
);
CREATE INDEX idx_case_tags_tag ON case_tags (tag, case_id);

-- 公告PDF等から AI が抽出した項目（JSON。形式は scripts/lib/case-ai.mjs）
ALTER TABLE case_ai ADD COLUMN extracted TEXT;
ALTER TABLE case_ai ADD COLUMN source_files TEXT;   -- JSON: 読んだ資料の URL

-- サイト全体の値（data_version：同期のたびに更新し、エッジキャッシュのキーに使う）
CREATE TABLE site_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO site_meta (key, value) VALUES ('data_version', '0');
