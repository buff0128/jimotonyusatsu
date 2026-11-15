// 地元の選択フォーム（トップ）の送信先。JavaScript が動く環境ではブラウザ側で保存して移動するので、
// ここに来るのはスクリプトが無効なときだけ。選んだ地域のページへ移動する（保存はしない）
import type { APIRoute } from 'astro';
import { getCityBySlug, getPrefBySlug } from '../lib/db';

export const GET: APIRoute = async ({ url, redirect }) => {
  const pref = await getPrefBySlug(url.searchParams.get('pref') ?? '');
  if (!pref) return redirect('/?home=1', 302);
  const citySlug = url.searchParams.get('city') ?? '';
  const city = citySlug ? await getCityBySlug(pref.lg_code, citySlug) : null;
  return redirect(city ? `/${pref.slug}/${city.slug}` : `/${pref.slug}`, 302);
};
