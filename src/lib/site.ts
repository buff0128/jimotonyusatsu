// サイト全体の定数。運営者情報などの仮置きはここ1か所にまとめる（docs/content/*.md の {{キー}} もここから埋める）
//
// 未確定の値は「【未設定：…】」のままにしてある。公開前にすべて埋めること。

export const SITE_NAME = 'じもと入札';
export const SITE_TAGLINE = '官公庁・自治体の入札情報を、登録なし・無料で';

/** 本番のURL（astro.config.mjs の site と scripts/*.mjs の User-Agent も同じ値にする） */
export const SITE_URL = 'https://jimotonyusatsu.jp';

/**
 * 公開までは全ページ noindex（jimotonyusatsu.jp も workers.dev も）。公開するときに false にし、
 * src/middleware.ts と public/_headers の X-Robots-Tag も外す
 */
export const STAGING_NOINDEX = true;

/** docs/content/*.md の {{キー}} を置き換える値（astro.config.mjs の remark プラグインが使う） */
export const PLACEHOLDERS = {
  運営会社名: '【未設定：運営会社名】',
  代表者名: '【未設定：代表者名】',
  所在地: '【未設定：所在地】',
  問い合わせ用メールアドレス: '【未設定：問い合わせ用メールアドレス】',
  公開日: '【未設定：公開日】',
  SITE_URL,
} as const satisfies Record<string, string>;

/** フッターに出す固定ページ（docs/content/*.md の path と合わせる） */
export const FIXED_PAGES = [
  { href: '/about', label: '運営者情報' },
  { href: '/disclaimer', label: '出典・免責事項' },
  { href: '/privacy', label: 'プライバシーポリシー' },
  { href: '/contact', label: 'お問い合わせ' },
] as const;
