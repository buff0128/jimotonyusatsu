// サイト全体の定数。運営者情報などの仮置きはここ1か所にまとめる（docs/content/*.md の {{キー}} もここから埋める）
//
// 運営者は屋号（じもと入札 運営事務局）で表示し、代表者名と住所は載せない方針（2026-11-15）

export const SITE_NAME = 'じもと入札';
export const SITE_TAGLINE = '官公庁・自治体の入札情報を、登録なし・無料で';

/** 本番のURL（astro.config.mjs の site と scripts/*.mjs の User-Agent も同じ値にする） */
export const SITE_URL = 'https://jimotonyusatsu.jp';

/** 旧ステージングのホスト。ここへのアクセスは本番へ 301 転送する（src/middleware.ts） */
export const STAGING_HOST = 'jimotonyusatsu.ishikawa-onore.workers.dev';

/**
 * 公開までは全ページ noindex。公開するときはこの1行を false にしてデプロイするだけ
 * （<meta name="robots"> は Base レイアウト、X-Robots-Tag は src/middleware.ts がこの値を見る）
 */
export const STAGING_NOINDEX = true;

/** docs/content/*.md の {{キー}} を置き換える値（astro.config.mjs の remark プラグインが使う） */
export const PLACEHOLDERS = {
  運営会社名: 'じもと入札 運営事務局',
  所在地: 'お問い合わせいただいた方に、メールでお知らせします',
  問い合わせ用メールアドレス: 'contact@jimotonyusatsu.jp',
  公開日: '2026年11月15日',
  SITE_URL,
} as const satisfies Record<string, string>;

/** フッターに出す固定ページ（docs/content/*.md の path と合わせる） */
export const FIXED_PAGES = [
  { href: '/about', label: '運営者情報' },
  { href: '/disclaimer', label: '出典・免責事項' },
  { href: '/privacy', label: 'プライバシーポリシー' },
  { href: '/contact', label: 'お問い合わせ' },
] as const;
