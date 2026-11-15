// cases テーブルへの upsert（取得元をまたいで共通）
import { createHash } from 'node:crypto';

export const CASE_COLUMNS = [
  'id', 'source', 'source_key', 'project_name', 'organization_name', 'lg_code', 'prefecture_name',
  'city_code', 'city_name', 'category', 'category_raw', 'procedure_type', 'certification',
  'cft_issue_date', 'period_end_time', 'tender_submission_deadline', 'opening_tenders_event',
  'location', 'item_code', 'description', 'external_document_uri', 'file_type', 'file_size',
  'attachments', 'kkj_date', 'case_number', 'estimated_price', 'work_type', 'org_id', 'fetched_at',
];

/**
 * 案件ID（URL用）。KKJ は既存ページの URL を変えないよう Key だけから作る。
 * それ以外の取得元は「取得元:キー」から作る。
 */
export function caseId(source, sourceKey) {
  const input = source === 'kkj' ? sourceKey : `${source}:${sourceKey}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** 発注機関ID（/orgs/{id}）。機関名は API の値そのままで、束ねたり分けたりしない */
export function orgId(organizationName) {
  if (!organizationName) return null;
  return createHash('sha256').update(organizationName).digest('hex').slice(0, 10);
}

/** 渡されなかった列は NULL で埋めて upsert する関数を返す（org_id は機関名から作る） */
export function prepareCaseUpsert(db) {
  const updates = CASE_COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
  const stmt = db.prepare(`
    INSERT INTO cases (${CASE_COLUMNS.join(', ')})
    VALUES (${CASE_COLUMNS.map((c) => `:${c}`).join(', ')})
    ON CONFLICT (id) DO UPDATE SET ${updates}
  `);
  return (row) => {
    const unknown = Object.keys(row).filter((k) => !CASE_COLUMNS.includes(k));
    if (unknown.length > 0) throw new Error(`cases に無い列: ${unknown.join(', ')}`);
    const values = { ...row, org_id: orgId(row.organization_name) };
    stmt.run(Object.fromEntries(CASE_COLUMNS.map((c) => [c, values[c] ?? null])));
  };
}
