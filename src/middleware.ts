import { defineMiddleware } from 'astro:middleware';
import { STAGING_NOINDEX } from './lib/site';

// ステージング（workers.dev）は検索エンジンに載せない。
// <meta name="robots"> は Base レイアウトで出し、ここでは HTML 以外も含めてヘッダーで止める。
// 本番でも noindex にするページ（/search）は、ページ側で X-Robots-Tag を付ける。
export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  if (STAGING_NOINDEX) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
});
