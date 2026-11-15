-- 「参加しやすさ」のラベルと、発注機関・地域×業種の統計（どちらも同期のときに手元で計算して送る）
-- 書き込みを抑えるため WITHOUT ROWID・1つのまとまりを1行（JSON）で持つ。

-- ラベル（src/lib/labels.ts のルールで case_ai.extracted から決める。docs/LABELS.md）
CREATE TABLE case_labels (
  case_id TEXT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  label   TEXT NOT NULL,
  PRIMARY KEY (case_id, label)
) WITHOUT ROWID;
CREATE INDEX idx_case_labels_label ON case_labels (label, case_id);

-- 発注機関の統計（過去12か月。scripts/lib/stats.mjs）。data は JSON
CREATE TABLE org_insights (
  org_id TEXT PRIMARY KEY,
  data   TEXT NOT NULL
) WITHOUT ROWID;

-- 地域×業種の統計（過去12か月）。lg_code '' は全国
CREATE TABLE area_tag_insights (
  lg_code TEXT NOT NULL,
  tag     TEXT NOT NULL,
  data    TEXT NOT NULL,
  PRIMARY KEY (lg_code, tag)
) WITHOUT ROWID;
