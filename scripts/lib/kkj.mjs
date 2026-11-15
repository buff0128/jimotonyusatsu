// 官公需情報ポータルサイト検索API のレスポンス（XML）を cases 行に正規化する
import { XMLParser } from 'fast-xml-parser';
import { caseId } from './cases-repo.mjs';

export const KKJ_API_URL = 'http://www.kkj.go.jp/api/';
export const KKJ_MAX_COUNT = 1000;

const CATEGORY_SLUGS = { 物品: 'buppin', 工事: 'koji', 役務: 'ekimu' };

// 公告文がまれに数百MBになる（PDF の抽出失敗とみられる。例：三重 2026-10-14）。
// そのまま解析するとメモリが溢れるので、この長さを超える公告文は解析前に切り詰める（生XMLは元のまま保存）
const MAX_DESCRIPTION_CHARS = 200_000;
const TRUNCATED_NOTE = '\n…（公告文が極端に長いため以下省略。公告原文をご確認ください）';

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // コード類（"08" など）を数値にしない
  trimValues: true,
  isArray: (name) => name === 'SearchResult' || name === 'Attachment',
});

/** @returns {{ searchHits: number, rows: object[] }} */
export function parseKkjXml(xml, fetchedAt) {
  const doc = parser.parse(shrinkHugeDescriptions(xml));
  const results = doc?.Results;
  if (!results) throw new Error('Unexpected XML: <Results> not found');
  if (results.Error) throw new Error(`KKJ API error: ${JSON.stringify(results.Error)}`);

  const searchResults = results.SearchResults ?? {};
  const searchHits = Number(searchResults.SearchHits ?? 0);
  const items = searchResults.SearchResult ?? [];
  return { searchHits, rows: items.map((item) => toCaseRow(item, fetchedAt)) };
}

function toCaseRow(item, fetchedAt) {
  const key = text(item.Key);
  if (!key) throw new Error(`SearchResult without Key: ${JSON.stringify(item).slice(0, 200)}`);
  const categoryRaw = text(item.Category);
  const cityCode = text(item.CityCode);

  return {
    id: caseId('kkj', key),
    source: 'kkj',
    source_key: key,
    project_name: text(item.ProjectName) ?? '(件名なし)',
    organization_name: text(item.OrganizationName),
    lg_code: text(item.LgCode) ?? '',
    prefecture_name: text(item.PrefectureName),
    city_code: cityCode && cityCode.length >= 5 ? cityCode.slice(0, 5) : null,
    city_name: text(item.CityName),
    category: categoryRaw ? (CATEGORY_SLUGS[categoryRaw] ?? null) : null,
    category_raw: categoryRaw,
    procedure_type: text(item.ProcedureType),
    certification: text(item.Certification),
    cft_issue_date: dateOnly(text(item.CftIssueDate)),
    period_end_time: text(item.PeriodEndTime),
    tender_submission_deadline: text(item.TenderSubmissionDeadline),
    opening_tenders_event: text(item.OpeningTendersEvent),
    location: text(item.Location),
    item_code: text(item.ItemCode),
    description: text(item.ProjectDescription),
    external_document_uri: text(item.ExternalDocumentURI),
    file_type: text(item.FileType),
    file_size: toInt(text(item.FileSize)),
    attachments: toAttachmentsJson(item.Attachments),
    kkj_date: text(item.Date),
    fetched_at: fetchedAt,
  };
}

function shrinkHugeDescriptions(xml) {
  if (xml.length < MAX_DESCRIPTION_CHARS) return xml;
  return xml.replace(/<ProjectDescription>([\s\S]*?)<\/ProjectDescription>/g, (all, body) => {
    if (body.length <= MAX_DESCRIPTION_CHARS) return all;
    // 文字参照（&amp; など）の途中で切らない
    const head = body.slice(0, MAX_DESCRIPTION_CHARS).replace(/&[^;]{0,10}$/, '');
    return `<ProjectDescription>${head}${TRUNCATED_NOTE}</ProjectDescription>`;
  });
}

function text(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function dateOnly(iso) {
  return iso ? iso.slice(0, 10) : null;
}

function toInt(s) {
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function toAttachmentsJson(attachments) {
  const list = attachments?.Attachment ?? [];
  const normalized = list
    .map((a) => ({ name: text(a.Name), uri: text(a.Uri) }))
    .filter((a) => a.uri);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}
