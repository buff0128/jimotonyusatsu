// 発注機関・地域×業種の統計（過去12か月）を手元で計算する。D1 には結果（JSON）だけを送る（scripts/sync-d1.mjs）
//
// 元データ：cases（今の掲載分、kkj）と cases_history（過去分。scripts/fetch-kkj-history.mjs）を案件IDで重ねたもの。
// 業種は、今の掲載分は case_tags（AI のタグを含む）、過去分は件名のキーワード（src/lib/gyoshu.ts）で判定する。
// 期間は「今月の前月までの12か月」（例：11月に計算すると前年11月〜今年10月）。
import { GYOSHU, classifyByKeywords } from '../../src/lib/gyoshu.ts';

/** 期間内の「都道府県×平日」のうち、取得済みがこの割合に満たなければ統計を送らない（途中の数字を出さない） */
export const MIN_COVERAGE = 0.95;

/** 年間この件数未満なら統計を出さない（ページは noindex） */
export const MIN_YEARLY_CASES = 5;
const TOP_ORGS = 5;

/** @returns {string[]} 'YYYY-MM' を古い順に12個 */
export function statsMonths(today = new Date()) {
  const ym = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(today);
  let [y, m] = ym.split('-').map(Number);
  const months = [];
  for (let i = 0; i < 12; i++) {
    m -= 1;
    if (m === 0) [y, m] = [y - 1, 12];
    months.unshift(`${y}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ orgIds: Set<string>, sources: string[] }} options orgIds は統計を作る発注機関（ページのある機関）
 */
export function computeInsights(db, { orgIds, sources }) {
  const months = statsMonths();
  const [first, last] = [`${months[0]}-01`, `${months.at(-1)}-31`];
  const tagsOf = new Map();
  for (const t of db.prepare('SELECT case_id, tag FROM case_tags').all()) {
    if (!tagsOf.has(t.case_id)) tagsOf.set(t.case_id, []);
    tagsOf.get(t.case_id).push(t.tag);
  }

  // 今の掲載分を優先して、過去分と重ねる
  const rows = new Map();
  const columns = 'id, project_name, organization_name, org_id, lg_code, category, cft_issue_date, tender_submission_deadline, opening_tenders_event';
  for (const r of db.prepare(`SELECT ${columns} FROM cases_history WHERE cft_issue_date BETWEEN ? AND ?`).iterate(first, last)) {
    rows.set(r.id, { ...r, tags: classifyByKeywords(r.project_name, r.category) });
  }
  const inSources = sources.map(() => '?').join(', ');
  for (const r of db.prepare(`SELECT ${columns} FROM cases WHERE source IN (${inSources}) AND cft_issue_date BETWEEN ? AND ?`).iterate(...sources, first, last)) {
    rows.set(r.id, { ...r, tags: tagsOf.get(r.id) ?? classifyByKeywords(r.project_name, r.category) });
  }

  // 落札金額（調達案件番号で照合できた今の掲載分。複数者落札は合計）
  const awardPrice = new Map();
  try {
    for (const a of db.prepare(`SELECT m.case_id, SUM(a.award_price) AS price FROM case_award_matches m
        JOIN awards a ON a.procurement_item_no = m.procurement_item_no WHERE m.method = 'number' GROUP BY m.case_id`).iterate()) {
      if (a.price > 0) awardPrice.set(a.case_id, a.price);
    }
  } catch {
    // 落札実績を取得していない環境（case_award_matches が無い）では金額の統計を出さない
  }
  for (const row of rows.values()) if (awardPrice.has(row.id)) row.award_price = awardPrice.get(row.id);

  const orgGroups = new Map();
  const areaTagGroups = new Map();
  const add = (map, key, row) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  };
  for (const row of rows.values()) {
    if (row.org_id && orgIds.has(row.org_id)) add(orgGroups, row.org_id, row);
    for (const tag of row.tags) {
      add(areaTagGroups, `${row.lg_code}|${tag}`, row);
      add(areaTagGroups, `|${tag}`, row);
    }
  }

  const orgs = [...orgGroups].map(([orgId, list]) => ({ org_id: orgId, data: JSON.stringify(orgInsight(list, months)) }));
  const areaTags = [...areaTagGroups].map(([key, list]) => {
    const [lgCode, tag] = key.split('|');
    return { lg_code: lgCode, tag, data: JSON.stringify(areaTagInsight(list, months)) };
  });
  return { months, orgs, areaTags, sourceRows: rows.size, coverage: coverage(db, first, last) };
}

/** 期間内の平日 × 47都道府県のうち、取得済み（history_runs か fetch_runs が ok）の割合 */
function coverage(db, first, last) {
  const done = new Set();
  for (const r of db.prepare("SELECT lg_code, issue_date FROM history_runs WHERE status = 'ok' AND issue_date BETWEEN ? AND ?").iterate(first, last)) {
    done.add(`${r.lg_code}:${r.issue_date}`);
  }
  for (const r of db.prepare("SELECT DISTINCT lg_code, issue_date FROM fetch_runs WHERE status = 'ok' AND issue_date BETWEEN ? AND ?").iterate(first, last)) {
    done.add(`${r.lg_code}:${r.issue_date}`);
  }
  let expected = 0;
  let covered = 0;
  for (let d = first; d <= last; d = nextDay(d)) {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (day === 0 || day === 6 || Number.isNaN(day)) continue;
    for (let lg = 1; lg <= 47; lg++) {
      expected++;
      if (done.has(`${String(lg).padStart(2, '0')}:${d}`)) covered++;
    }
  }
  return expected === 0 ? 0 : covered / expected;
}

function nextDay(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function monthlyCounts(list, months) {
  const counts = Object.fromEntries(months.map((m) => [m, 0]));
  for (const r of list) {
    const ym = r.cft_issue_date?.slice(0, 7);
    if (ym in counts) counts[ym]++;
  }
  return months.map((m) => counts[m]);
}

function topEntries(map, limit) {
  return [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

/** 公告日から、ある日時までの平均日数（両方が分かる案件だけ）。標本が3件未満なら null */
function averageDays(list, field) {
  const days = list
    .filter((r) => r.cft_issue_date && r[field])
    .map((r) => (Date.parse(r[field].slice(0, 10)) - Date.parse(r.cft_issue_date)) / 86_400_000)
    .filter((d) => Number.isFinite(d) && d >= 0 && d <= 365);
  if (days.length < 3) return null;
  return { days: Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10, samples: days.length };
}

function orgInsight(list, months) {
  const monthly = monthlyCounts(list, months);
  const byCategory = new Map();
  const byTag = new Map();
  for (const r of list) {
    byCategory.set(r.category ?? '', (byCategory.get(r.category ?? '') ?? 0) + 1);
    for (const t of r.tags) byTag.set(t, (byTag.get(t) ?? 0) + 1);
  }
  return {
    months,
    monthly,
    total: monthly.reduce((a, b) => a + b, 0),
    by_category: Object.fromEntries(topEntries(byCategory, 4)),
    by_tag: topEntries(byTag, 6),
    peak_months: peakMonths(months, monthly),
    days_to_deadline: averageDays(list, 'tender_submission_deadline'),
    days_to_opening: averageDays(list, 'opening_tenders_event'),
  };
}

function areaTagInsight(list, months) {
  const monthly = monthlyCounts(list, months);
  const byOrg = new Map();
  const names = new Map();
  for (const r of list) {
    if (!r.org_id) continue;
    byOrg.set(r.org_id, (byOrg.get(r.org_id) ?? 0) + 1);
    names.set(r.org_id, r.organization_name);
  }
  return {
    months,
    monthly,
    total: monthly.reduce((a, b) => a + b, 0),
    top_orgs: topEntries(byOrg, TOP_ORGS).map(([orgId, n]) => ({ org_id: orgId, name: names.get(orgId), n })),
    peak_months: peakMonths(months, monthly),
    award_prices: priceSummary(list.map((r) => r.award_price).filter((p) => p > 0)),
  };
}

/** 落札金額の目安（中央値と四分位）。標本が MIN_AWARD_SAMPLES 未満なら null */
export const MIN_AWARD_SAMPLES = 5;
function priceSummary(prices) {
  if (prices.length < MIN_AWARD_SAMPLES) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  return { samples: sorted.length, median: at(0.5), p25: at(0.25), p75: at(0.75), min: sorted[0], max: sorted.at(-1) };
}

/** 件数の多い月（最大3つ。件数0の月は入れない） */
function peakMonths(months, monthly) {
  return months
    .map((m, i) => ({ month: m, n: monthly[i] }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.month.localeCompare(b.month))
    .slice(0, 3);
}

export const GYOSHU_SLUGS = GYOSHU.map((g) => g.slug);
