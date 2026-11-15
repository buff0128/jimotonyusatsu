-- 官公需ポータル以外の取得元（茨城県の入札情報公開サービスなど）を入れられるようにする
--
-- テーブルの作り直し（DROP TABLE）は、外部キーの ON DELETE CASCADE で case_ai が消えるため使わない。
-- その代わり、旧 kkj_key 列に付いている列単位の UNIQUE は残る（source_key は全取得元で一意になる）。
-- 取得元ごとのキーは形式が違う（KKJ は base64、PPI は管理番号）ので、実際にはぶつからない。

ALTER TABLE cases RENAME COLUMN kkj_key TO source_key;

-- kkj: 官公需情報ポータルサイト検索API
-- ibaraki_ppi_koji: いばらき電子入札共同利用 入札情報公開サービス（建設工事・コンサル）
-- ibaraki_ppi_buppin: 茨城県電子調達システム 入札情報サービス（物品・役務）
ALTER TABLE cases ADD COLUMN source TEXT NOT NULL DEFAULT 'kkj';

-- 取得元にしかない事実項目
ALTER TABLE cases ADD COLUMN case_number TEXT;          -- 工事番号・案件番号
ALTER TABLE cases ADD COLUMN estimated_price INTEGER;   -- 予定価格（円・税込み。非公表は NULL）
ALTER TABLE cases ADD COLUMN work_type TEXT;            -- 工種・営業種目（例：土木一式工事、文具・事務機器類）

CREATE UNIQUE INDEX idx_cases_source_key ON cases (source, source_key);
CREATE INDEX idx_cases_source_issue ON cases (source, cft_issue_date DESC);
