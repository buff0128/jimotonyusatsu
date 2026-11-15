// トップの「地元を選ぶ」フォーム。都道府県を選ぶと市区町村の選択肢を読み込み、送信したら地元として保存して移動する。
// localStorage が使えないときは保存せずに移動するだけ（フォームの action=/local と同じ動き）
import { localPath, readLocal, saveLocal, type LocalArea } from './local-area';

type City = { slug: string; name: string; n: number };

const form = document.querySelector<HTMLFormElement>('[data-local-form]');
// HTMLSelectElement は Workers の型（worker-configuration.d.ts）の Element と remove() の型がぶつかるため、
// querySelector の型引数ではなく as で受ける
const prefSelect = form?.querySelector('select[name="pref"]') as HTMLSelectElement | null | undefined;
const citySelect = form?.querySelector('select[name="city"]') as HTMLSelectElement | null | undefined;

function option(value: string, text: string): HTMLOptionElement {
  const el = document.createElement('option');
  el.value = value;
  el.textContent = text;
  return el;
}

async function loadCities(prefSlug: string, selected?: string): Promise<void> {
  if (!citySelect) return;
  citySelect.replaceChildren(option('', prefSlug ? '読み込み中…' : '先に都道府県を選んでください'));
  citySelect.disabled = true;
  if (!prefSlug) return;
  try {
    const res = await fetch(`/api/cities?pref=${encodeURIComponent(prefSlug)}`, { headers: { Accept: 'application/json' } });
    const { cities } = (await res.json()) as { cities: City[] };
    citySelect.replaceChildren(
      option('', '都道府県全体'),
      ...cities.map((c) => {
        const el = option(c.slug, c.n > 0 ? `${c.name}（${c.n}件）` : c.name);
        el.dataset.name = c.name;
        return el;
      }),
    );
    if (selected) citySelect.value = selected;
  } catch {
    citySelect.replaceChildren(option('', '都道府県全体'));
  }
  citySelect.disabled = false;
}

function selectedArea(): LocalArea | null {
  const prefOption = prefSelect?.selectedOptions[0];
  if (!prefSelect?.value || !prefOption) return null;
  const cityOption = citySelect?.selectedOptions[0];
  const city = citySelect?.value && cityOption ? { citySlug: citySelect.value, cityName: cityOption.dataset.name ?? '' } : {};
  return { prefSlug: prefSelect.value, prefName: prefOption.textContent ?? '', ...city };
}

// 保存済みの地元があれば、その地域を選んだ状態にしておく（「変更」で戻ってきたとき）
const saved = readLocal();
if (prefSelect && saved) prefSelect.value = saved.prefSlug;
void loadCities(prefSelect?.value ?? '', saved?.citySlug);

prefSelect?.addEventListener('change', () => void loadCities(prefSelect.value));

form?.addEventListener('submit', (event) => {
  const area = selectedArea();
  if (!area) return; // 未選択ならサーバー側（/local）でトップに戻す
  event.preventDefault();
  saveLocal(area);
  location.href = localPath(area);
});

// 地域の一覧で、地元の地方を目立たせる
if (saved) {
  for (const box of document.querySelectorAll<HTMLElement>('[data-region-prefs]')) {
    box.classList.toggle('is-local', (box.dataset.regionPrefs ?? '').split(' ').includes(saved.prefSlug));
  }
}
