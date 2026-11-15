import { env } from 'cloudflare:workers';
import type { CategorySlug } from './categories';

export type Area = {
  code: string;
  lg_code: string;
  kind: 'pref' | 'city';
  name: string;
  slug: string;
};

export type Attachment = { name: string | null; uri: string };

/** 取得元（migrations/0003_case_sources.sql） */
export type CaseSource = 'kkj' | 'ibaraki_ppi_koji' | 'ibaraki_ppi_buppin';

/**
 * サイトに出してよい取得元。茨城県PPI は利用確認が済むまで D1 に同期しないが、念のためクエリでも絞る
 * （docs/SOURCES_IBARAKI.md）
 */
const PUBLISHED_SOURCE = 'kkj';

/** 一覧表示に必要な列だけ */
export type CaseSummary = {
  id: string;
  project_name: string;
  organization_name: string | null;
  org_id: string | null;
  lg_code: string;
  city_code: string | null;
  city_name: string | null;
  category: CategorySlug | null;
  cft_issue_date: string | null;
  tender_submission_deadline: string | null;
  /** AI が公告から抽出した入札書の提出期限（API の値が空のときの補助） */
  ai_tender_deadline: string | null;
  /** AI が抽出した正しい件名（API の件名がファイル名になっている案件だけ） */
  ai_project_name: string | null;
  /** AI が公告から抽出した参加申請の期限 */
  ai_application_deadline: string | null;
  pref_slug: string | null;
  pref_name: string | null;
  city_slug: string | null;
  /** 業種タグ（カンマ区切り） */
  tags: string | null;
  /** 参加しやすさのラベル（カンマ区切り。src/lib/labels.ts） */
  labels: string | null;
};

export type CaseDetail = Omit<
  CaseSummary,
  'pref_slug' | 'pref_name' | 'city_slug' | 'tags' | 'labels' | 'ai_tender_deadline' | 'ai_application_deadline' | 'ai_project_name'
> & {
  source: CaseSource;
  source_key: string;
  prefecture_name: string | null;
  category_raw: string | null;
  procedure_type: string | null;
  certification: string | null;
  period_end_time: string | null;
  opening_tenders_event: string | null;
  location: string | null;
  item_code: string | null;
  description: string | null;
  external_document_uri: string | null;
  file_type: string | null;
  file_size: number | null;
  attachments: string | null;
  kkj_date: string | null;
  case_number: string | null;
  estimated_price: number | null;
  work_type: string | null;
  fetched_at: string;
};

/** 一覧の絞り込み条件（すべて AND） */
export type CaseFilter = {
  lgCode?: string;
  category?: CategorySlug;
  cityCode?: string;
  orgId?: string;
  tag?: string;
  /** 空白区切りの各語を、件名・発注機関・公告文（case_descriptions の全文）のどれかに含む */
  keyword?: string;
  /** 入札書の提出期限（API、なければ AI 抽出）がこの日（YYYY-MM-DD）以降 */
  deadlineFrom?: string;
  /** 参加しやすさのラベル（src/lib/labels.ts の slug）。複数はすべてを満たす案件 */
  labels?: string[];
  excludeId?: string;
  /** 参加しやすさのラベルが1つ以上付いた仕事だけ（「今週のねらい目」） */
  labeled?: boolean;
  /** 公告日がこの日（YYYY-MM-DD）より後（お気に入りの「前回から◯件新しい」） */
  issuedAfter?: string;
};

/**
 * 並び順
 *   new      : 公告日の新しい順（既定）
 *   deadline : 入札書の提出期限（effective_deadline）の近い順。期限が分かり、今日以降の案件だけになる
 */
export type CaseSort = 'new' | 'deadline';

const SUMMARY_SELECT = `
  SELECT c.id, c.project_name, c.organization_name, c.org_id, c.lg_code, c.city_code, c.city_name, c.category,
         c.cft_issue_date, c.tender_submission_deadline,
         json_extract(ai.extracted, '$.tender_submission_deadline') AS ai_tender_deadline,
         json_extract(ai.extracted, '$.project_name') AS ai_project_name,
         json_extract(ai.extracted, '$.application_deadline') AS ai_application_deadline,
         p.slug AS pref_slug, p.name AS pref_name, a.slug AS city_slug,
         (SELECT group_concat(ct.tag) FROM case_tags ct WHERE ct.case_id = c.id) AS tags,
         (SELECT group_concat(cl.label) FROM case_labels cl WHERE cl.case_id = c.id) AS labels
  FROM cases c
  LEFT JOIN case_ai ai ON ai.case_id = c.id
  LEFT JOIN areas p ON p.code = c.lg_code
  LEFT JOIN areas a ON a.code = c.city_code`;

const MAX_KEYWORD_TERMS = 5;

const db = () => env.DB;

// ---------------------------------------------------------------------------
// 地域

const AREA_COLUMNS = 'code, lg_code, kind, name, slug';

export async function getPrefBySlug(slug: string): Promise<Area | null> {
  return db().prepare(`SELECT ${AREA_COLUMNS} FROM areas WHERE kind = 'pref' AND slug = ?`).bind(slug).first<Area>();
}

export async function getAreaByCode(code: string): Promise<Area | null> {
  return db().prepare(`SELECT ${AREA_COLUMNS} FROM areas WHERE code = ?`).bind(code).first<Area>();
}

export async function getCityBySlug(lgCode: string, slug: string): Promise<Area | null> {
  return db()
    .prepare(`SELECT ${AREA_COLUMNS} FROM areas WHERE kind = 'city' AND lg_code = ? AND slug = ?`)
    .bind(lgCode, slug)
    .first<Area>();
}

export async function listPrefsWithCounts(): Promise<(Area & { case_count: number })[]> {
  const { results } = await db()
    .prepare(
      `SELECT a.code, a.lg_code, a.kind, a.name, a.slug, COALESCE(k.n, 0) AS case_count
       FROM areas a LEFT JOIN case_counts k ON k.dim = 'all' AND k.lg_code = a.code AND k.value = ''
       WHERE a.kind = 'pref' ORDER BY a.sort`,
    )
    .all<Area & { case_count: number }>();
  return results;
}

/** 案件のある市区町村だけ（地方公共団体コード順） */
export async function listCitiesWithCounts(lgCode: string): Promise<(Area & { case_count: number })[]> {
  const { results } = await db()
    .prepare(
      `SELECT a.code, a.lg_code, a.kind, a.name, a.slug, k.n AS case_count
       FROM case_counts k JOIN areas a ON a.code = k.value
       WHERE k.dim = 'city' AND k.lg_code = ? ORDER BY a.sort, a.code`,
    )
    .bind(lgCode)
    .all<Area & { case_count: number }>();
  return results;
}

// ---------------------------------------------------------------------------
// 集計（case_counts。同期のときに scripts/lib/case-counts.mjs が計算する）

type CountDim = 'all' | 'category' | 'tag' | 'city' | 'org' | 'week' | 'due7' | 'city_tag' | 'city_org';

async function readCounts(dim: CountDim, lgCode = ''): Promise<Map<string, number>> {
  const { results } = await db()
    .prepare('SELECT value, n FROM case_counts WHERE dim = ? AND lg_code = ?')
    .bind(dim, lgCode)
    .all<{ value: string; n: number }>();
  return new Map(results.map((r) => [r.value, r.n]));
}

async function readCount(dim: CountDim, lgCode: string, value: string): Promise<number> {
  const row = await db()
    .prepare('SELECT n FROM case_counts WHERE dim = ? AND lg_code = ? AND value = ?')
    .bind(dim, lgCode, value)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 種別ごとの件数。未分類は null のキー */
export async function countByCategory(lgCode?: string): Promise<Map<CategorySlug | null, number>> {
  const counts = await readCounts('category', lgCode ?? '');
  return new Map([...counts].map(([value, n]) => [(value || null) as CategorySlug | null, n]));
}

export async function countByTag(lgCode?: string): Promise<Map<string, number>> {
  return readCounts('tag', lgCode ?? '');
}

/** 都道府県・市区町村ページのタイル（同期した日の時点の件数。scripts/lib/case-counts.mjs） */
export type AreaCounts = { total: number; week: number; due7: number };

/** lgCode が '' なら全国、cityCode を渡すとその市区町村 */
export async function getAreaCounts(lgCode: string, cityCode?: string): Promise<AreaCounts> {
  const [total, week, due7] = await Promise.all([
    cityCode ? readCount('city', lgCode, cityCode) : readCount('all', lgCode, ''),
    readCount('week', lgCode, cityCode ?? ''),
    readCount('due7', lgCode, cityCode ?? ''),
  ]);
  return { total, week, due7 };
}

/** 市区町村の「市区町村コード:値」の集計（city_tag・city_org）。主キーの範囲で読む */
async function readCityCounts(dim: 'city_tag' | 'city_org', lgCode: string, cityCode: string): Promise<Map<string, number>> {
  const { results } = await db()
    .prepare('SELECT value, n FROM case_counts WHERE dim = ? AND lg_code = ? AND value > ? AND value < ?')
    .bind(dim, lgCode, `${cityCode}:`, `${cityCode};`)
    .all<{ value: string; n: number }>();
  return new Map(results.map((r) => [r.value.slice(cityCode.length + 1), r.n]));
}

/** 市区町村の業種ごとの件数 */
export async function countTagByCity(lgCode: string, cityCode: string): Promise<Map<string, number>> {
  return readCityCounts('city_tag', lgCode, cityCode);
}

/** 市区町村内の案件数が多い発注機関 */
export async function listTopOrgsInCity(lgCode: string, cityCode: string, limit: number): Promise<Org[]> {
  const counts = await readCityCounts('city_org', lgCode, cityCode);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (top.length === 0) return [];
  const { results } = await db()
    .prepare(`SELECT org_id, organization_name FROM org_stats WHERE org_id IN (${top.map(() => '?').join(', ')})`)
    .bind(...top.map(([id]) => id))
    .all<{ org_id: string; organization_name: string }>();
  const names = new Map(results.map((r) => [r.org_id, r.organization_name]));
  return top
    .filter(([id]) => names.has(id))
    .map(([id, n]) => ({ org_id: id, organization_name: names.get(id)!, case_count: n, lg_code: lgCode, pref_slug: null, prefecture_name: null }));
}

/** 都道府県内のすべての市区町村（案件が無い市区町村も含む。地元の選択に使う） */
export async function listAllCities(lgCode: string): Promise<(Area & { case_count: number })[]> {
  const { results } = await db()
    .prepare(
      `SELECT a.code, a.lg_code, a.kind, a.name, a.slug, COALESCE(k.n, 0) AS case_count
       FROM areas a LEFT JOIN case_counts k ON k.dim = 'city' AND k.lg_code = a.lg_code AND k.value = a.code
       WHERE a.code > ? AND a.code < ? AND +a.kind = 'city' AND a.lg_code = ? ORDER BY a.sort, a.code`,
    )
    // 市区町村コードは都道府県コード2桁から始まるので、主キーの範囲で読む（その都道府県の市区町村の行だけ）
    .bind(`${lgCode}000`, `${lgCode}999`, lgCode)
    .all<Area & { case_count: number }>();
  return results;
}

/** 業種ごとの都道府県別件数（キーは都道府県コード） */
export async function countTagByPref(tag: string): Promise<Map<string, number>> {
  const { results } = await db()
    .prepare("SELECT lg_code, n FROM case_counts WHERE dim = 'tag' AND value = ? AND lg_code != ''")
    .bind(tag)
    .all<{ lg_code: string; n: number }>();
  return new Map(results.map((r) => [r.lg_code, r.n]));
}

// ---------------------------------------------------------------------------
// 発注機関（org_stats。同期のときに計算する）

export type Org = {
  org_id: string;
  organization_name: string;
  case_count: number;
  lg_code: string;
  pref_slug: string | null;
  prefecture_name: string | null;
};

/** 発注機関（機関名は API の値そのまま。同じ名前が複数の都道府県にあれば、件数の多い県を代表にする） */
export async function getOrg(orgId: string): Promise<Org | null> {
  return db()
    .prepare(
      `SELECT o.org_id, o.organization_name, o.case_count, o.lg_code, p.slug AS pref_slug, p.name AS prefecture_name
       FROM org_stats o LEFT JOIN areas p ON p.code = o.lg_code WHERE o.org_id = ?`,
    )
    .bind(orgId)
    .first<Org>();
}

/** 都道府県内の案件数が多い発注機関（件数はその都道府県の分） */
export async function listTopOrgs(lgCode: string, limit = 30): Promise<Org[]> {
  const { results } = await db()
    .prepare(
      `SELECT o.org_id, o.organization_name, k.n AS case_count, k.lg_code, NULL AS pref_slug, NULL AS prefecture_name
       FROM case_counts k JOIN org_stats o ON o.org_id = k.value
       WHERE k.dim = 'org' AND k.lg_code = ? ORDER BY k.n DESC, o.organization_name LIMIT ?`,
    )
    .bind(lgCode, limit)
    .all<Org>();
  return results;
}

// ---------------------------------------------------------------------------
// 案件
//
// 並びは公告日の新しい順。公告日を含むインデックス（migrations/0001・0004）の順に読むので、
// 1ページ分（＋OFFSET）しか読まない。同じ公告日の中はインデックスの順（rowid）。
// source の条件は `+c.source` と書いてインデックスに使わせない（D1 には kkj しか無く、source のインデックスを
// 選ばれると全件を読んで並べ替えになるため）。

const ORDER_BY: Record<CaseSort, string> = {
  new: 'ORDER BY c.cft_issue_date DESC',
  deadline: 'ORDER BY c.effective_deadline, c.cft_issue_date DESC',
};

function buildWhere(filter: CaseFilter, sort: CaseSort = 'new'): { from: string; where: string; params: (string | number)[] } {
  // 締切順は effective_deadline の部分インデックス（期限が分かる数百件）から入る。
  // ほかの列の条件は `+` を付けてインデックスに使わせず、業種は case_tags を主キーで引く
  const byDeadline = sort === 'deadline';
  // 業種で絞るときは case_tags から入る（タグの件数ぶんだけ読む）
  const from = filter.tag
    ? byDeadline
      ? 'cases c CROSS JOIN case_tags t ON t.case_id = c.id'
      : 'case_tags t JOIN cases c ON c.id = t.case_id'
    : 'cases c';
  const col = (name: string) => (byDeadline ? `+c.${name}` : `c.${name}`);
  const conditions = ['+c.source = ?'];
  const params: (string | number)[] = [PUBLISHED_SOURCE];
  const add = (sql: string, ...values: (string | number)[]) => {
    conditions.push(sql);
    params.push(...values);
  };

  if (filter.tag) add('t.tag = ?', filter.tag);
  if (filter.lgCode) add(`${col('lg_code')} = ?`, filter.lgCode);
  if (filter.category) add(`${col('category')} = ?`, filter.category);
  if (filter.cityCode) add(`${col('city_code')} = ?`, filter.cityCode);
  if (filter.orgId) add(`${col('org_id')} = ?`, filter.orgId);
  if (filter.excludeId) add('c.id != ?', filter.excludeId);
  if (filter.issuedAfter) add(`${col('cft_issue_date')} > ?`, filter.issuedAfter);
  // 入札書の提出期限（API の値、なければ AI の抽出値）。同期のときに計算した派生列
  if (filter.deadlineFrom) add('c.effective_deadline >= ?', filter.deadlineFrom);
  else if (byDeadline) add('c.effective_deadline IS NOT NULL');
  // ラベルの付いた案件は AI で読んだ案件だけ（数百件）なので、ラベルから引く
  // 期限などのインデックスから入り、1件ずつ主キーでラベルの有無を見る（case_labels を全件読まない）
  if (filter.labeled) add('EXISTS (SELECT 1 FROM case_labels l WHERE l.case_id = c.id)');
  for (const label of filter.labels ?? []) add('c.id IN (SELECT case_id FROM case_labels WHERE label = ?)', label);
  for (const term of splitKeyword(filter.keyword)) {
    const like = `%${escapeLike(term)}%`;
    add(
      `(c.project_name LIKE ? ESCAPE '\\' OR c.organization_name LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM case_descriptions d WHERE d.case_id = c.id AND d.text LIKE ? ESCAPE '\\'))`,
      like,
      like,
      like,
    );
  }
  return { from, where: conditions.join(' AND '), params };
}

export function splitKeyword(keyword: string | undefined): string[] {
  return (keyword ?? '')
    .normalize('NFKC')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_KEYWORD_TERMS);
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * 件数を集計テーブルから引ける絞り込みなら、その件数を返す（D1 で COUNT しない）。
 * 引けない組み合わせ（検索・締切・除外など）は undefined
 */
async function countFromTable(filter: CaseFilter): Promise<number | undefined> {
  const { lgCode = '', category, cityCode, orgId, tag, keyword, deadlineFrom, labels, labeled, excludeId, issuedAfter } = filter;
  if (keyword || deadlineFrom || labels?.length || labeled || excludeId || issuedAfter) return undefined;
  const others = [category, cityCode, orgId, tag].filter(Boolean).length;
  if (others > 1) return undefined;
  if (category) return lgCode ? readCount('category', lgCode, category) : undefined;
  if (cityCode) return readCount('city', lgCode, cityCode);
  if (orgId) return lgCode ? undefined : readCount('org', '', orgId);
  if (tag) return readCount('tag', lgCode, tag);
  return readCount('all', lgCode, '');
}

export type CaseListResult = {
  cases: CaseSummary[];
  /** exact なら全体の件数、そうでなければ「このページまでの件数」（「◯件以上」と表示する） */
  total: number;
  exact: boolean;
  hasMore: boolean;
};

/**
 * 一覧。件数は集計テーブルから引ける絞り込みだけ正確に出す。引けない組み合わせ（検索・ラベル・締切など）は
 * D1 で COUNT せず、1件多く取って「次のページがあるか」だけを見る（読み取りを1ページ分に抑えるため）
 */
export async function listCases(
  filter: CaseFilter,
  { limit, offset = 0, sort = 'new', withTotal = true }: { limit: number; offset?: number; sort?: CaseSort; withTotal?: boolean },
): Promise<CaseListResult> {
  const { from, where, params } = buildWhere(filter, sort);
  const select = SUMMARY_SELECT.replace('FROM cases c', `FROM ${from}`);
  const run = (n: number) =>
    db().prepare(`${select} WHERE ${where} ${ORDER_BY[sort]} LIMIT ? OFFSET ?`).bind(...params, n, offset).all<CaseSummary>();
  const [{ results }, tableCount] = await Promise.all([
    run(limit + 1),
    withTotal && sort === 'new' ? countFromTable(filter) : Promise.resolve(undefined),
  ]);
  const cases = results.slice(0, limit);
  const hasMore = results.length > limit;
  if (tableCount !== undefined) return { cases, total: tableCount, exact: true, hasMore };
  return { cases, total: offset + cases.length, exact: !hasMore, hasMore };
}

/**
 * 条件に合う仕事のうち、公告日が since より後のものを最大 cap 件まで数える（お気に入りの保存した条件）。
 * 公告日の新しい順に読んで cap+1 件で打ち切るので、読む行は「新しい分＋1」程度に収まる
 */
export async function countIssuedAfter(filter: CaseFilter, since: string, cap: number): Promise<{ count: number; more: boolean }> {
  const { from, where, params } = buildWhere({ ...filter, issuedAfter: since }, 'new');
  const row = await db()
    .prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${from} WHERE ${where} ${ORDER_BY.new} LIMIT ?)`)
    .bind(...params, cap + 1)
    .first<{ n: number }>();
  const n = row?.n ?? 0;
  return { count: Math.min(n, cap), more: n > cap };
}

export async function getCase(id: string): Promise<CaseDetail | null> {
  return db().prepare('SELECT * FROM cases WHERE id = ? AND +source = ?').bind(id, PUBLISHED_SOURCE).first<CaseDetail>();
}

/**
 * 公告文の全文。D1 では case_descriptions に分割して持っている（migrations/0006）。
 * 分割した行が無いとき（同期前のデータなど）は cases.description を使う
 */
export async function getCaseDescription(item: Pick<CaseDetail, 'id' | 'description'>): Promise<string | null> {
  const { results } = await db()
    .prepare('SELECT text FROM case_descriptions WHERE case_id = ? ORDER BY seq')
    .bind(item.id)
    .all<{ text: string }>();
  return results.length > 0 ? results.map((r) => r.text).join('') : item.description;
}

export async function getCaseTags(id: string): Promise<{ tag: string; method: 'rule' | 'ai' }[]> {
  const { results } = await db()
    .prepare('SELECT tag, method FROM case_tags WHERE case_id = ? ORDER BY method DESC, tag')
    .bind(id)
    .all<{ tag: string; method: 'rule' | 'ai' }>();
  return results;
}

/** AI が公告から抽出した項目（scripts/lib/case-ai.mjs の形式） */
export type CaseAiExtracted = {
  category?: CategorySlug | null;
  tags?: string[];
  application_deadline?: string | null;
  tender_submission_deadline?: string | null;
  opening_tenders_event?: string | null;
  performance_period?: string | null;
  qualifications?: string | null;
  bid_method?: 'paper' | 'electronic' | 'both' | null;
  location?: string | null;
  project_name?: string | null;
  question_deadline?: string | null;
  bid_bond?: 'exempt' | 'required' | null;
  contract_bond?: 'exempt' | 'required' | 'partial' | null;
  local_requirement?: 'city' | 'prefecture' | 'region' | 'none' | null;
  local_requirement_text?: string | null;
  licenses?: { kind: 'zensho' | 'local' | 'kensetsu' | 'other'; name: string; grades: string[] | null }[] | null;
  experience_required?: boolean | null;
  estimated_price?: number | null;
  estimated_price_note?: string | null;
  tips?: string | null;
};

export type CaseAi = {
  summary: string | null;
  extracted: CaseAiExtracted;
  generated_by: string;
  generated_at: string;
};

export async function getCaseAi(id: string): Promise<CaseAi | null> {
  const row = await db()
    .prepare('SELECT summary, extracted, generated_by, generated_at FROM case_ai WHERE case_id = ?')
    .bind(id)
    .first<{ summary: string | null; extracted: string | null; generated_by: string; generated_at: string }>();
  if (!row) return null;
  return { ...row, extracted: parseJsonObject(row.extracted) as CaseAiExtracted };
}

// ---------------------------------------------------------------------------

export async function getDataVersion(): Promise<string> {
  const row = await db().prepare("SELECT value FROM site_meta WHERE key = 'data_version'").first<{ value: string }>();
  return row?.value ?? '0';
}

export function parseAttachments(json: string | null): Attachment[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Attachment[]).filter((a) => typeof a?.uri === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonObject(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// お気に入り（/favorites が /api/cases・/api/orgs 経由で使う）

/** 案件IDの一覧から一覧表示用の情報を取る（無い・非公開の ID は返さない） */
export async function listCasesByIds(ids: string[]): Promise<CaseSummary[]> {
  if (ids.length === 0) return [];
  const { results } = await db()
    .prepare(`${SUMMARY_SELECT} WHERE +c.source = ? AND c.id IN (${ids.map(() => '?').join(', ')})`)
    .bind(PUBLISHED_SOURCE, ...ids)
    .all<CaseSummary>();
  return results;
}

export type OrgWithNewCount = {
  org_id: string;
  organization_name: string;
  case_count: number;
  /** 登録した日の翌日以降に公告された件数 */
  new_count: number;
};

/** 発注機関ごとの件数と、since（YYYY-MM-DD）より後に公告された件数 */
export async function listOrgsWithNewCounts(entries: { id: string; since: string }[]): Promise<OrgWithNewCount[]> {
  if (entries.length === 0) return [];
  const statements = entries.map(({ id, since }) =>
    db()
      .prepare(
        `SELECT org_id, MAX(organization_name) AS organization_name, COUNT(*) AS case_count,
                SUM(cft_issue_date > ?) AS new_count
         FROM cases WHERE org_id = ? AND +source = ? GROUP BY org_id`,
      )
      .bind(since, id, PUBLISHED_SOURCE),
  );
  const results = await db().batch(statements);
  return results.flatMap((r) => (r.results as OrgWithNewCount[]).slice(0, 1));
}

// ---------------------------------------------------------------------------
// 統計（過去12か月。scripts/lib/stats.mjs が計算した JSON）

export type MonthlySeries = { months: string[]; monthly: number[]; total: number };
export type PeakMonth = { month: string; n: number };

export type OrgInsight = MonthlySeries & {
  by_category: Record<string, number>;
  by_tag: [string, number][];
  peak_months: PeakMonth[];
  days_to_deadline: { days: number; samples: number } | null;
  days_to_opening: { days: number; samples: number } | null;
};

export type PriceSummary = { samples: number; median: number; p25: number; p75: number; min: number; max: number };

export type AreaTagInsight = MonthlySeries & {
  top_orgs: { org_id: string; name: string; n: number }[];
  peak_months: PeakMonth[];
  /** 落札金額の目安（調達案件番号で照合できた案件。標本5件未満なら null） */
  award_prices?: PriceSummary | null;
};

export async function getOrgInsight(orgId: string): Promise<OrgInsight | null> {
  const row = await db().prepare('SELECT data FROM org_insights WHERE org_id = ?').bind(orgId).first<{ data: string }>();
  return row ? (parseJsonObject(row.data) as OrgInsight) : null;
}

/** lgCode が '' なら全国 */
export async function getAreaTagInsight(lgCode: string, tag: string): Promise<AreaTagInsight | null> {
  const row = await db()
    .prepare('SELECT data FROM area_tag_insights WHERE lg_code = ? AND tag = ?')
    .bind(lgCode, tag)
    .first<{ data: string }>();
  return row ? (parseJsonObject(row.data) as AreaTagInsight) : null;
}

/** ページのある発注機関（org_stats にある ID）だけを返す。統計の「主な発注機関」のリンク用 */
export async function existingOrgIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await db()
    .prepare(`SELECT org_id FROM org_stats WHERE org_id IN (${ids.map(() => '?').join(', ')})`)
    .bind(...ids)
    .all<{ org_id: string }>();
  return new Set(results.map((r) => r.org_id));
}

// ---------------------------------------------------------------------------
// 落札結果（調達ポータルの落札実績オープンデータ。migrations/0009）

export type CaseAward = {
  procurement_item_no: string;
  corporation_no: string;
  winner_name: string | null;
  award_price: number | null;
  award_date: string | null;
};

export async function getCaseAwards(caseId: string): Promise<CaseAward[]> {
  const { results } = await db()
    .prepare(
      'SELECT procurement_item_no, corporation_no, winner_name, award_price, award_date FROM case_awards WHERE case_id = ? ORDER BY corporation_no',
    )
    .bind(caseId)
    .all<CaseAward>();
  return results;
}

// ---------------------------------------------------------------------------
// サイトマップ（src/pages/sitemap.xml.ts・src/pages/sitemaps/*.xml.ts）
// インデックスの対象（src/lib/indexing.ts）と同じ条件のページだけを返す。エッジキャッシュ前提で、同期のあとに1回読まれる程度

/** AI で公告を読んだ案件（案件ページが noindex にならないもの） */
export async function listSitemapCases(): Promise<{ id: string; generated_at: string }[]> {
  const { results } = await db()
    .prepare('SELECT ai.case_id AS id, ai.generated_at FROM case_ai ai JOIN cases c ON c.id = ai.case_id')
    .all<{ id: string; generated_at: string }>();
  return results;
}

/** 統計が出せる（過去12か月で minYearly 件以上）発注機関。ページのある（org_stats にある）機関だけ */
export async function listSitemapOrgs(minYearly: number): Promise<string[]> {
  const { results } = await db()
    .prepare(
      `SELECT o.org_id FROM org_insights i JOIN org_stats o ON o.org_id = i.org_id
       WHERE json_extract(i.data, '$.total') >= ?`,
    )
    .bind(minYearly)
    .all<{ org_id: string }>();
  return results.map((r) => r.org_id);
}

/** 統計が出せる業種ページ。pref_slug が null なら全国（/gyoshu/{tag}） */
export async function listSitemapAreaTags(minYearly: number): Promise<{ pref_slug: string | null; tag: string }[]> {
  const { results } = await db()
    .prepare(
      `SELECT p.slug AS pref_slug, t.tag FROM area_tag_insights t
       LEFT JOIN areas p ON p.code = t.lg_code AND p.kind = 'pref'
       WHERE (t.lg_code = '' OR p.slug IS NOT NULL) AND json_extract(t.data, '$.total') >= ?`,
    )
    .bind(minYearly)
    .all<{ pref_slug: string | null; tag: string }>();
  return results;
}

/** 案件のある 都道府県・都道府県×種別・市区町村（case_counts から。ハブページ） */
export async function listSitemapAreas(): Promise<{ prefs: string[]; prefCategories: { pref_slug: string; category: string }[]; cities: { pref_slug: string; slug: string }[] }> {
  const [prefs, categories, cities] = await db().batch([
    db().prepare(
      `SELECT a.slug FROM case_counts k JOIN areas a ON a.code = k.lg_code
       WHERE k.dim = 'all' AND k.lg_code != '' AND k.value = '' AND k.n > 0 ORDER BY a.sort`,
    ),
    db().prepare(
      `SELECT a.slug AS pref_slug, k.value AS category FROM case_counts k JOIN areas a ON a.code = k.lg_code
       WHERE k.dim = 'category' AND k.lg_code != '' AND k.value != '' AND k.n > 0 ORDER BY a.sort, k.value`,
    ),
    db().prepare(
      `SELECT p.slug AS pref_slug, a.slug FROM case_counts k JOIN areas a ON a.code = k.value JOIN areas p ON p.code = k.lg_code
       WHERE k.dim = 'city' AND k.n > 0 ORDER BY p.sort, a.sort, a.code`,
    ),
  ]);
  return {
    prefs: (prefs.results as { slug: string }[]).map((r) => r.slug),
    prefCategories: categories.results as { pref_slug: string; category: string }[],
    cities: cities.results as { pref_slug: string; slug: string }[],
  };
}
