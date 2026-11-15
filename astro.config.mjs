// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';

// エッジキャッシュ（Workers の cache。wrangler.jsonc の cache.enabled）
// データ同期のあとは scripts/sync-d1.mjs が /api/cache-purge を呼んで全消去するので、TTL は「同期し忘れても古すぎない」長さにする
const LIST_CACHE = { maxAge: 600, swr: 300, tags: ['lists'] };
const CASE_CACHE = { maxAge: 3600, swr: 600, tags: ['cases'] };
const SITEMAP_CACHE = { maxAge: 3600, swr: 600, tags: ['lists', 'cases'] };

// https://astro.build/config
export default defineConfig({
  // src/lib/site.ts の SITE_URL と同じ値
  site: 'https://jimotonyusatsu.jp',
  output: 'server',
  // 静的ページ（/about など）を about.html で出力し、/about/ へのリダイレクトを起こさない
  build: { format: 'file' },
  // セッションは使わない（既定だと SESSION の KV namespace が自動作成される）
  session: false,
  adapter: cloudflare({
    // 画像変換は使わないので IMAGES バインディングを作らせない
    imageService: 'passthrough',
  }),
  cache: { provider: cacheCloudflare() },
  routeRules: {
    '/': LIST_CACHE,
    '/prefectures': LIST_CACHE,
    '/gyoshu': LIST_CACHE,
    '/gyoshu/[tag]': LIST_CACHE,
    '/orgs/[id]': LIST_CACHE,
    '/[pref]': LIST_CACHE,
    '/[pref]/[slug]': LIST_CACHE,
    '/[pref]/list': LIST_CACHE,
    '/api/cities': LIST_CACHE,
    '/[pref]/gyoshu/[tag]': LIST_CACHE,
    '/cases/[id]': CASE_CACHE,
    '/sitemap.xml': SITEMAP_CACHE,
    '/sitemaps/pages.xml': SITEMAP_CACHE,
    '/sitemaps/orgs.xml': SITEMAP_CACHE,
    '/sitemaps/cases.xml': SITEMAP_CACHE,
  },
});
