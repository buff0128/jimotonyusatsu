// サイトマップインデックス（robots.txt から参照）。中身は src/pages/sitemaps/*.xml.ts に種類ごとに分ける
import type { APIRoute } from 'astro';
import { SITEMAP_FILES, sitemapIndexResponse } from '../lib/sitemap';

export const GET: APIRoute = () => sitemapIndexResponse(SITEMAP_FILES);
