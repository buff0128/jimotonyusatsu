// ハブ（トップ・都道府県・市区町村・種別・業種）、統計のある業種ページ、解説記事、固定ページ
// 絞り込み・ページ送り（?page=）・検索・お気に入りは noindex なので載せない
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { listSitemapAreas, listSitemapAreaTags } from '../../lib/db';
import { findGyoshu } from '../../lib/gyoshu';
import { MIN_YEARLY_CASES } from '../../lib/insights';
import { type SitemapEntry, urlsetResponse } from '../../lib/sitemap';

export const GET: APIRoute = async () => {
  const [areas, areaTags, docs] = await Promise.all([
    listSitemapAreas(),
    listSitemapAreaTags(MIN_YEARLY_CASES),
    getCollection('pages'),
  ]);
  const paths: string[] = [
    '/',
    '/prefectures',
    '/gyoshu',
    '/guide',
    '/guide/labels',
    ...docs.map((d) => d.data.path).sort(),
    ...areas.prefs.flatMap((pref) => [`/${pref}`, `/${pref}/list`]),
    ...areas.prefCategories.map((r) => `/${r.pref_slug}/${r.category}`),
    ...areas.cities.map((r) => `/${r.pref_slug}/${r.slug}`),
    ...areaTags
      .filter((r) => findGyoshu(r.tag))
      .map((r) => (r.pref_slug ? `/${r.pref_slug}/gyoshu/${r.tag}` : `/gyoshu/${r.tag}`)),
  ];
  const entries: SitemapEntry[] = [...new Set(paths)].map((path) => ({ path }));
  return urlsetResponse(entries);
};
