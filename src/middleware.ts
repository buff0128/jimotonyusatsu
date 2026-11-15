import { defineMiddleware } from 'astro:middleware';
import { SITE_URL, STAGING_HOST, STAGING_NOINDEX } from './lib/site';

// 1. 旧ステージング（workers.dev）へのアクセスは、本番ドメインの同じ URL へ 301 で転送する。
//    静的ファイル（/about などの事前生成ページ）は Worker を通らないので転送されないが、canonical が本番を指している
// 2. 公開前（STAGING_NOINDEX）は HTML 以外も含めてヘッダーで noindex にする。<meta name="robots"> は Base レイアウトで出す。
//    本番でも noindex にするページ（/search など）は、ページ側で X-Robots-Tag を付ける。
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.hostname === STAGING_HOST) {
    return Response.redirect(new URL(`${context.url.pathname}${context.url.search}`, SITE_URL).href, 301);
  }
  const response = await next();
  if (STAGING_NOINDEX) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
});
