// 同期のときに計算する集計（migrations/0007_counts_and_indexes.sql）
//   case_counts : 全国・都道府県ごとの件数（全体・種別・業種・市区町村・発注機関）
//   org_stats   : 発注機関ごとの名前・件数・代表の都道府県
//   effective_deadline : 「締切前」の絞り込みに使う入札書の提出期限（API の値、なければ AI の抽出値）
// ページはこれらを読むだけにして、D1 で COUNT や GROUP BY をしない。
//
// 都道府県・市区町村ページのタイルと内訳（同期した日の日本時間で数える。ページには「◯月◯日時点」と出す）
//   week     : 公告日が直近7日（同期日を含む）の件数
//   due7     : 次の締切（参加申請の期限・入札書の提出期限のうち、同期日以降で最も早いもの）が7日以内の件数
//              week・due7 は lg_code=都道府県、value=''（都道府県）または市区町村コード。全国は lg_code='' value=''
//   city_tag : 市区町村×業種。lg_code=都道府県、value='市区町村コード:業種'
//   city_org : 市区町村×発注機関。lg_code=都道府県、value='市区町村コード:org_id'

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string[]} sources サイトに出す取得元
 * @returns {{ counts: { dim: string, lg_code: string, value: string, n: number }[], orgs: object[] }}
 */
export function computeCounts(db, sources) {
  const inSources = `c.source IN (${sources.map(() => '?').join(', ')})`;
  const counts = [];
  const push = (dim, rows) => {
    for (const r of rows) counts.push({ dim, lg_code: r.lg_code, value: r.value ?? '', n: r.n });
  };
  // 都道府県別（lg_code）と全国（''）の両方を作る
  const both = (dim, valueExpr, from, where = '') => {
    const base = `FROM ${from} WHERE ${inSources} ${where}`;
    push(dim, db.prepare(`SELECT c.lg_code AS lg_code, ${valueExpr} AS value, COUNT(*) AS n ${base} GROUP BY 1, 2`).all(...sources));
    push(dim, db.prepare(`SELECT '' AS lg_code, ${valueExpr} AS value, COUNT(*) AS n ${base} GROUP BY 2`).all(...sources));
  };
  both('all', "''", 'cases c');
  both('category', "COALESCE(c.category, '')", 'cases c');
  both('tag', 't.tag', 'case_tags t JOIN cases c ON c.id = t.case_id');
  // 市区町村は都道府県別だけ（市区町村コードは全国で一意だが、ページは都道府県の下にある）
  push('city', db.prepare(`SELECT c.lg_code AS lg_code, c.city_code AS value, COUNT(*) AS n FROM cases c WHERE ${inSources} AND c.city_code IS NOT NULL GROUP BY 1, 2`).all(...sources));
  // 発注機関：都道府県別（都道府県ページの「発注機関から探す」）と全国（お気に入り・発注機関ページの件数）
  both('org', 'c.org_id', 'cases c', 'AND c.org_id IS NOT NULL');
  push('city_tag', db.prepare(`SELECT c.lg_code AS lg_code, c.city_code || ':' || t.tag AS value, COUNT(*) AS n FROM case_tags t JOIN cases c ON c.id = t.case_id WHERE ${inSources} AND c.city_code IS NOT NULL GROUP BY 1, 2`).all(...sources));
  push('city_org', db.prepare(`SELECT c.lg_code AS lg_code, c.city_code || ':' || c.org_id AS value, COUNT(*) AS n FROM cases c WHERE ${inSources} AND c.city_code IS NOT NULL AND c.org_id IS NOT NULL GROUP BY 1, 2`).all(...sources));
  counts.push(...computeRecentCounts(db, sources));

  // 同じ機関名が複数の都道府県にあるときは、件数の多い都道府県を代表にする（同数ならコードの小さい方）
  const orgs = db
    .prepare(
      `SELECT org_id, organization_name, lg_code, case_count FROM (
         SELECT c.org_id, c.organization_name, c.lg_code,
                SUM(COUNT(*)) OVER (PARTITION BY c.org_id) AS case_count,
                ROW_NUMBER() OVER (PARTITION BY c.org_id ORDER BY COUNT(*) DESC, c.lg_code) AS rank
         FROM cases c WHERE ${inSources} AND c.org_id IS NOT NULL
         GROUP BY c.org_id, c.lg_code)
       WHERE rank = 1`,
    )
    .all(...sources);
  return { counts, orgs };
}

/** 日本時間の今日（YYYY-MM-DD）から days 日後 */
function jstDate(days = 0) {
  return new Date(Date.now() + 9 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

/** 次の締切：参加申請の期限（AI）と入札書の提出期限（API、なければ AI）のうち、today 以降で最も早い日（YYYY-MM-DD） */
export function nextDeadline(apiTender, aiExtractedJson, today) {
  let ai = {};
  try {
    ai = aiExtractedJson ? JSON.parse(aiExtractedJson) : {};
  } catch {
    ai = {};
  }
  const candidates = [ai.application_deadline, apiTender ?? ai.tender_submission_deadline]
    .filter((v) => typeof v === 'string' && v.length >= 10)
    .map((v) => v.slice(0, 10))
    .filter((d) => d >= today)
    .sort();
  return candidates[0] ?? null;
}

/** week・due7（上の説明を参照） */
function computeRecentCounts(db, sources) {
  const today = jstDate(0);
  const weekFrom = jstDate(-6);
  const dueTo = jstDate(7);
  const rows = db
    .prepare(
      `SELECT c.lg_code, c.city_code, c.cft_issue_date, c.tender_submission_deadline, ai.extracted
       FROM cases c LEFT JOIN case_ai ai ON ai.case_id = c.id
       WHERE c.source IN (${sources.map(() => '?').join(', ')})`,
    )
    .all(...sources);
  const tally = new Map();
  const add = (dim, lg, value) => {
    const key = `${dim}|${lg}|${value}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  };
  const addAll = (dim, r) => {
    add(dim, '', '');
    add(dim, r.lg_code, '');
    if (r.city_code) add(dim, r.lg_code, r.city_code);
  };
  for (const r of rows) {
    if (r.cft_issue_date && r.cft_issue_date.slice(0, 10) >= weekFrom) addAll('week', r);
    const next = nextDeadline(r.tender_submission_deadline, r.extracted, today);
    if (next && next <= dueTo) addAll('due7', r);
  }
  return [...tally].map(([key, n]) => {
    const [dim, lg_code, value] = key.split('|');
    return { dim, lg_code, value, n };
  });
}

/** 入札書の提出期限（API の値、なければ AI の抽出値）。どちらも無ければ null */
export function effectiveDeadline(apiDeadline, aiExtractedJson) {
  if (apiDeadline) return apiDeadline;
  if (!aiExtractedJson) return null;
  try {
    return JSON.parse(aiExtractedJson).tender_submission_deadline ?? null;
  } catch {
    return null;
  }
}
