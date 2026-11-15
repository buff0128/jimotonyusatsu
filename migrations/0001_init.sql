-- 入札案件（官公需情報ポータルサイト検索APIの1件＝1行）
-- 日付・機関名などAPIで取れる値はそのまま保存し、加工しない
CREATE TABLE cases (
  id                          TEXT PRIMARY KEY,          -- sha256(kkj_key) の先頭16桁（URL用）
  kkj_key                     TEXT NOT NULL UNIQUE,      -- API の Key
  project_name                TEXT NOT NULL,
  organization_name           TEXT,
  lg_code                     TEXT NOT NULL,             -- 都道府県コード2桁（茨城=08）
  prefecture_name             TEXT,
  city_code                   TEXT,                      -- 市区町村コード5桁（API の6桁からチェックデジットを除いたもの）
  city_name                   TEXT,
  category                    TEXT,                      -- buppin / koji / ekimu / NULL
  category_raw                TEXT,                      -- API の Category（物品・工事・役務）
  procedure_type              TEXT,
  certification               TEXT,                      -- 資格等級
  cft_issue_date              TEXT,                      -- 公告日 YYYY-MM-DD
  period_end_time             TEXT,                      -- 納入期限（ISO 8601）
  tender_submission_deadline  TEXT,                      -- 入札日（ISO 8601）
  opening_tenders_event       TEXT,                      -- 開札日（ISO 8601）
  location                    TEXT,                      -- 履行場所
  item_code                   TEXT,
  description                 TEXT,                      -- 公告文（ProjectDescription）
  external_document_uri       TEXT,                      -- 公告URL
  file_type                   TEXT,
  file_size                   INTEGER,
  attachments                 TEXT,                      -- JSON: [{"name": "...", "uri": "..."}]
  kkj_date                    TEXT,                      -- API の Date（ポータル側の登録日時）
  fetched_at                  TEXT NOT NULL              -- 取得日時（ISO 8601）
);

CREATE INDEX idx_cases_lg_issue ON cases (lg_code, cft_issue_date DESC);
CREATE INDEX idx_cases_lg_category_issue ON cases (lg_code, category, cft_issue_date DESC);
CREATE INDEX idx_cases_city_issue ON cases (city_code, cft_issue_date DESC);
CREATE INDEX idx_cases_org ON cases (organization_name);

-- AI による抽出・要約（APIで取れる事実項目は持たない）
CREATE TABLE case_ai (
  case_id        TEXT PRIMARY KEY REFERENCES cases (id) ON DELETE CASCADE,
  qualifications TEXT,       -- 必要な資格
  bid_method     TEXT,       -- 入札方法（paper / electronic / both / unknown）
  summary        TEXT,       -- 業務概要の要約
  generated_by   TEXT NOT NULL,  -- 生成者（モデル名）
  generated_at   TEXT NOT NULL
);

-- 都道府県・市区町村（URLスラッグの対応表）
CREATE TABLE areas (
  code     TEXT PRIMARY KEY,   -- 都道府県=2桁、市区町村=5桁
  lg_code  TEXT NOT NULL,      -- 所属する都道府県コード2桁
  kind     TEXT NOT NULL CHECK (kind IN ('pref', 'city')),
  name     TEXT NOT NULL,
  slug     TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_areas_pref_slug ON areas (slug) WHERE kind = 'pref';
CREATE UNIQUE INDEX idx_areas_city_slug ON areas (lg_code, slug) WHERE kind = 'city';
