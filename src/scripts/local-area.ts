// 地元の選択（docs/design/DESIGN.md「地元の選択」）。ブラウザの localStorage にだけ保存し、サーバーには送らない。
// 検索エンジン向けの HTML は地元の有無で変えない。変わるのはブラウザ側の表示（ヘッダーの地元ピルなど）だけ。
//
// トップを開いたときの移動は、表示が一瞬出ないよう src/pages/index.astro の <head> のインラインスクリプトで行う
// （キー名 LOCAL_KEY と形式は、そちらと揃えること）。

export const LOCAL_KEY = 'jimoto:local';

export type LocalArea = { prefSlug: string; prefName: string; citySlug?: string; cityName?: string };

const SLUG = /^[a-z0-9-]+$/;

export function readLocal(): LocalArea | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (typeof v.prefSlug !== 'string' || !SLUG.test(v.prefSlug) || typeof v.prefName !== 'string') return null;
    const hasCity = typeof v.citySlug === 'string' && SLUG.test(v.citySlug) && typeof v.cityName === 'string';
    return {
      prefSlug: v.prefSlug,
      prefName: v.prefName,
      ...(hasCity ? { citySlug: v.citySlug as string, cityName: v.cityName as string } : {}),
    };
  } catch {
    return null;
  }
}

export function saveLocal(area: LocalArea): boolean {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(area));
    return true;
  } catch {
    return false;
  }
}

export function localPath(area: LocalArea): string {
  return area.citySlug ? `/${area.prefSlug}/${area.citySlug}` : `/${area.prefSlug}`;
}

export function localName(area: LocalArea): string {
  return area.cityName ? `${area.prefName} ${area.cityName}` : area.prefName;
}

/** ヘッダーの地元ピル（data-local-pill）。未選択なら出さない */
function renderPill(): void {
  const area = readLocal();
  for (const pill of document.querySelectorAll<HTMLElement>('[data-local-pill]')) {
    const name = pill.querySelector('[data-local-name]');
    if (!area || !name) {
      pill.hidden = true;
      continue;
    }
    name.textContent = `地元：${localName(area)}`;
    pill.hidden = false;
  }
}

renderPill();
window.addEventListener('storage', (event) => {
  if (event.key === LOCAL_KEY) renderPill();
});
