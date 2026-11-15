// 案件ページ。AI で公告を読んだ案件だけ（src/lib/indexing.ts の caseNoindex と同じ条件）
import type { APIRoute } from 'astro';
import { listSitemapCases } from '../../lib/db';
import { urlsetResponse } from '../../lib/sitemap';

export const GET: APIRoute = async () => {
  const rows = await listSitemapCases();
  return urlsetResponse(rows.map((r) => ({ path: `/cases/${encodeURIComponent(r.id)}`, lastmod: r.generated_at })));
};
