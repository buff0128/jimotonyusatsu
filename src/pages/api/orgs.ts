// お気に入りの発注機関を表示するための API（/favorites が使う）
//   GET /api/orgs?ids=da880451cc:2026-11-05,0123456789:2026-11-01
// 「:日付」は登録日。その翌日以降に公告された件数を new_count で返す
import type { APIRoute } from 'astro';
import { listOrgsWithNewCounts } from '../../lib/db';

const MAX_IDS = 200;
const ENTRY = /^([0-9a-f]{10}):(\d{4}-\d{2}-\d{2})$/;

export const GET: APIRoute = async ({ url }) => {
  const entries = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.match(ENTRY))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ id: m[1], since: m[2] }))
    .slice(0, MAX_IDS);
  const orgs = await listOrgsWithNewCounts(entries);
  return Response.json({ orgs }, { headers: { 'Cache-Control': 'no-store' } });
};
