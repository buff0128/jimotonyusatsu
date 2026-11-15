// お気に入り（/favorites）が使う API
//   GET /api/cases?ids=0011415b8dc6b44a,040d8c2ef9968f6d
//       … 登録した仕事の一覧表示用の情報
//   GET /api/cases?saved=pref%3Dibaraki%26q%3D清掃&since=2026-11-05
//       … 保存した条件（/search のクエリ文字列）に合う仕事のうち、公告日が since より後の件数（最大 NEW_CAP 件まで数える）
import type { APIRoute } from 'astro';
import { countIssuedAfter, getCityBySlug, getPrefBySlug, listCasesByIds } from '../../lib/db';
import { readListQuery } from '../../lib/list-query';
import { hasSearchCondition, searchFilterOf } from '../../lib/search-filter';

const MAX_IDS = 200;
const CASE_ID = /^[0-9a-f]{16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SAVED_LENGTH = 500;
const NEW_CAP = 99;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function countSaved(saved: string, since: string): Promise<Response> {
  const params = new URLSearchParams(saved);
  const query = readListQuery(new URL(`https://local/search?${params}`));
  const pref = params.get('pref') ? await getPrefBySlug(params.get('pref')!) : null;
  const city = pref && query.citySlug ? await getCityBySlug(pref.lg_code, query.citySlug) : null;
  const filter = searchFilterOf(params, query, { lgCode: pref?.lg_code, cityCode: city?.code });
  if (!hasSearchCondition(filter, query)) return json({ error: 'no condition' }, 400);
  return json(await countIssuedAfter(filter, since, NEW_CAP));
}

export const GET: APIRoute = async ({ url }) => {
  const saved = url.searchParams.get('saved');
  if (saved !== null) {
    const since = url.searchParams.get('since') ?? '';
    if (!DATE.test(since) || saved.length > MAX_SAVED_LENGTH) return json({ error: 'bad request' }, 400);
    return countSaved(saved, since);
  }
  const ids = [...new Set((url.searchParams.get('ids') ?? '').split(','))].filter((id) => CASE_ID.test(id)).slice(0, MAX_IDS);
  const cases = await listCasesByIds(ids);
  return json({ cases });
};
