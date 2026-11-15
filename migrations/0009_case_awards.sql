-- 落札結果（調達ポータルの落札実績オープンデータ。scripts/fetch-awards.mjs → match-awards.mjs）
-- 調達案件番号で確実に照合できた案件だけを送る（件名での照合は手元の検証用で、サイトには出さない）。複数者落札は事業者ごとに1行
CREATE TABLE case_awards (
  case_id             TEXT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  procurement_item_no TEXT NOT NULL,
  corporation_no      TEXT NOT NULL,
  winner_name         TEXT,
  award_price         INTEGER,
  award_date          TEXT,
  PRIMARY KEY (case_id, corporation_no)
) WITHOUT ROWID;
