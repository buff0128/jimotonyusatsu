// エッジキャッシュの全消去（scripts/sync-d1.mjs がリモート同期のあとに呼ぶ）
//   POST /api/cache-purge  Authorization: Bearer <CACHE_PURGE_TOKEN>
// トークンは wrangler secret（CACHE_PURGE_TOKEN）。手元では .dev.vars に置く
import type { APIRoute } from 'astro';
import { cache, env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request }) => {
  // .dev.vars が無い環境の wrangler types では型に出ないので、任意の値として読む
  const token = (env as { CACHE_PURGE_TOKEN?: string }).CACHE_PURGE_TOKEN;
  if (!token || request.headers.get('Authorization') !== `Bearer ${token}`) {
    return new Response('Forbidden', { status: 403 });
  }
  const result = await cache.purge({ purgeEverything: true });
  return Response.json(result, { status: result.success ? 200 : 502 });
};
