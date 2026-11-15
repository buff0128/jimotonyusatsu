// 検索エンジンに載せるページのルール（docs/LOG_2026-11-05.md「インデックスの対象」）
//
// インデックスの対象にするのは、AI で公告を読んだ案件の詳細ページ・ハブページ・統計ページ・解説記事だけ。
// それ以外の案件ページ（API の値だけの案件）は noindex にする。
// ステージングの全体 noindex（src/lib/site.ts の STAGING_NOINDEX）とは別のルールで、両方を満たしたページだけがインデックスされる。

/** 案件ページを noindex にするか（AI で公告を読んでいない案件は noindex） */
export function caseNoindex({ hasAi }: { hasAi: boolean }): boolean {
  return !hasAi;
}
