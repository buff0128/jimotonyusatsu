// サイトマップの XML を組み立てる（https://www.sitemaps.org/protocol.html）
// 載せるのはインデックスの対象（src/lib/indexing.ts）のページだけ。noindex のページは載せない
import { SITE_URL } from './site';

export type SitemapEntry = { path: string; lastmod?: string | null };

/** 1ファイルの上限は 50,000 URL。超えそうになったらファイルを分ける */
export const SITEMAP_MAX_URLS = 50_000;

/** サイトマップインデックスに並べるファイル（src/pages/sitemaps/*.xml.ts） */
export const SITEMAP_FILES = ['/sitemaps/pages.xml', '/sitemaps/orgs.xml', '/sitemaps/cases.xml'] as const;

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const absolute = (path: string) => escapeXml(new URL(path, SITE_URL).href);

/** YYYY-MM-DD だけを lastmod にする（それ以外の形は付けない） */
const lastmodOf = (value: string | null | undefined) => {
  const date = value?.slice(0, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};

const xmlResponse = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });

export function urlsetResponse(entries: SitemapEntry[]): Response {
  const urls = entries.slice(0, SITEMAP_MAX_URLS).map((e) => {
    const lastmod = lastmodOf(e.lastmod);
    return `  <url><loc>${absolute(e.path)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  });
  return xmlResponse(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
}

export function sitemapIndexResponse(paths: readonly string[]): Response {
  const items = paths.map((p) => `  <sitemap><loc>${absolute(p)}</loc></sitemap>`);
  return xmlResponse(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>`);
}
