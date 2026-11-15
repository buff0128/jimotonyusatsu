import type { APIRoute } from 'astro';
import { SITE_URL } from '../lib/site';

// ステージングは各ページの noindex（meta と X-Robots-Tag）で検索結果から外す。
// Disallow にするとクローラーが noindex を読めず、URL だけがインデックスされることがあるので全許可のままにする。
export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
