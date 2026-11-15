-- 公告文（官公需APIの ProjectDescription）の全文を、D1 の1ステートメント上限（100KB）に収まる大きさに分割して持つ
--
-- D1 では cases.description は使わず（NULL）、全文はこのテーブルに一本化する。
-- 手元の SQLite（正本）は従来どおり cases.description に全文を持ち、このテーブルは D1 への同期時に作る
-- （scripts/lib/description-chunks.mjs、scripts/sync-d1.mjs）。
-- 分割は改行の位置を優先するので、検索語が分割の境目をまたぐことはまれ。
CREATE TABLE case_descriptions (
  case_id TEXT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,   -- 0 から。この順につなげると全文になる
  text    TEXT NOT NULL,
  PRIMARY KEY (case_id, seq)
);
