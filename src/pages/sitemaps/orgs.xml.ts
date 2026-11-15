// 発注機関のページ。統計が出せない（年間5件未満）機関は noindex なので載せない（src/pages/orgs/[id].astro と同じ条件）
import type { APIRoute } from 'astro';
import { listSitemapOrgs } from '../../lib/db';
import { MIN_YEARLY_CASES } from '../../lib/insights';
import { urlsetResponse } from '../../lib/sitemap';

export const GET: APIRoute = async () => {
  const ids = await listSitemapOrgs(MIN_YEARLY_CASES);
  return urlsetResponse(ids.map((id) => ({ path: `/orgs/${id}` })));
};
