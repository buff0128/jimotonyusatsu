// 地元の選択（トップ）で、都道府県を選んだときに市区町村の選択肢を返す
//   GET /api/cities?pref=ibaraki → { cities: [{ slug, name, n }] }（案件の無い市区町村も含む）
import type { APIRoute } from 'astro';
import { getPrefBySlug, listAllCities } from '../../lib/db';

export const GET: APIRoute = async ({ url }) => {
  const pref = await getPrefBySlug(url.searchParams.get('pref') ?? '');
  if (!pref) return Response.json({ cities: [] }, { status: 404 });
  const cities = (await listAllCities(pref.lg_code)).map((c) => ({ slug: c.slug, name: c.name, n: c.case_count }));
  return Response.json({ cities }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
};
