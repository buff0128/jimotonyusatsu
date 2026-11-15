import { getCollection } from 'astro:content';

// 解説記事の並び順（初めての人が読む順）。ここに無い記事は末尾に追加される
const ORDER = [
  '/guide/getting-started',
  '/guide/qualification',
  '/guide/reading-notices',
  '/guide/bidding-methods',
  '/guide/small-contracts',
  '/guide/e-bidding',
  '/guide/construction',
  '/guide/goods-services',
  '/guide/award-results',
  '/guide/checklist',
];

/** 記事一覧で STEP 番号を付ける「基本の流れ」の記事（ORDER の先頭から順に読む前提のもの）。それ以外は目的別の記事として、TAGS の見出しを付けて並べる */
export const STEP_PATHS: readonly string[] = ['/guide/getting-started', '/guide/qualification', '/guide/reading-notices', '/guide/bidding-methods'];

/** 目的別の記事に付ける小見出し（STEP の代わりに出す） */
export const GUIDE_TAGS: Record<string, string> = {
  '/guide/small-contracts': '最初の仕事を探す',
  '/guide/e-bidding': '入札の準備',
  '/guide/construction': '工事の会社向け',
  '/guide/goods-services': '物品・サービスの会社向け',
  '/guide/award-results': '金額を決める',
  '/guide/checklist': '提出の前に',
};

/** トップの「入札が初めての方へ」に出す短い説明 */
const SUMMARIES: Record<string, string> = {
  '/guide/getting-started': '資格の取得から契約までの流れ',
  '/guide/qualification': '国と自治体の資格の違い',
  '/guide/reading-notices': '開札日・予定価格などの意味',
  '/guide/bidding-methods': '一般競争・随意契約・プロポーザル',
  '/guide/small-contracts': '小さな会社が最初に取りやすい仕事',
  '/guide/e-bidding': 'ICカードの準備から提出まで',
  '/guide/goods-services': '清掃・警備・印刷・ITの見どころ',
  '/guide/construction': '建設業許可・経審・業者登録の順番',
  '/guide/award-results': '過去の結果から相場をつかむ',
  '/guide/checklist': '提出前に確認するポイント',
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
