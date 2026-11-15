import { getCollection } from 'astro:content';

// 解説記事の並び順（初めての人が読む順）。ここに無い記事は末尾に追加される
const ORDER = ['/guide/getting-started', '/guide/qualification', '/guide/reading-notices', '/guide/bidding-methods'];

/** トップの「入札が初めての方へ」に出す短い説明 */
const SUMMARIES: Record<string, string> = {
  '/guide/getting-started': '資格の取得から契約までの流れ',
  '/guide/qualification': '国と自治体の資格の違い',
  '/guide/reading-notices': '開札日・予定価格などの意味',
  '/guide/bidding-methods': '一般競争・随意契約・プロポーザル',
};

export type GuideLink = { path: string; title: string; shortTitle: string; description: string; summary: string };

export async function listGuides(): Promise<GuideLink[]> {
  const entries = await getCollection('pages', (e) => e.data.path.startsWith('/guide/'));
  const rank = (path: string) => (ORDER.includes(path) ? ORDER.indexOf(path) : ORDER.length);
  return entries
    .map((e) => ({
      path: e.data.path,
      title: e.data.title,
      shortTitle: e.data.title.split('｜')[0],
      description: e.data.description,
      summary: SUMMARIES[e.data.path] ?? e.data.description,
    }))
    .sort((a, b) => rank(a.path) - rank(b.path));
}
