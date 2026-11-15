// ☆ボタン（data-fav-kind / data-fav-id / data-fav-label）とヘッダーの件数を、localStorage の状態に合わせる。
// ページはエッジキャッシュされるので、登録状態はすべてここ（ブラウザ側）で反映する。
import { CHANGE_EVENT, count, has, isAvailable, list, toggle, type FavoriteKind } from './favorites-store';
import { markSeen } from './saved-search-store';

const KINDS: readonly string[] = ['case', 'org', 'search'];

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('button[data-fav-kind]')];
}

function render(): void {
  const usable = isAvailable();
  for (const button of buttons()) {
    const kind = button.dataset.favKind as FavoriteKind;
    const id = button.dataset.favId ?? '';
    const on = usable && has(kind, id);
    button.disabled = !usable;
    button.setAttribute('aria-pressed', String(on));
    if (button.classList.contains('fav-btn--icon')) button.setAttribute('aria-label', on ? 'お気に入りから外す' : 'お気に入りに追加');
    button.title = usable
      ? on ? 'お気に入りから外す' : 'お気に入りに登録'
      : 'このブラウザではお気に入りを使えません（保存領域が無効になっています）';
    const icon = button.querySelector('[data-fav-icon]');
    if (icon) icon.textContent = on ? '★' : '☆';
    const text = button.querySelector('[data-fav-text]');
    if (text) text.textContent = on ? (button.dataset.favOnText ?? '登録済み') : (button.dataset.favOffText ?? 'お気に入り');
  }
  const n = usable ? count() : 0;
  for (const badge of document.querySelectorAll<HTMLElement>('[data-fav-count]')) {
    badge.textContent = String(n);
    badge.hidden = n === 0;
  }
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest?.<HTMLButtonElement>('button[data-fav-kind]');
  if (!button || !KINDS.includes(button.dataset.favKind ?? '') || !isAvailable()) return;
  event.preventDefault();
  const on = toggle(button.dataset.favKind as FavoriteKind, button.dataset.favId ?? '', button.dataset.favLabel);
  // 登録したときだけ、☆がピンのように刺さる短い動き（FavoriteButton.astro の .is-pinning。動きを減らす設定では CSS で止める）
  if (on) {
    button.classList.remove('is-pinning');
    void button.offsetWidth;
    button.classList.add('is-pinning');
    button.addEventListener('animationend', () => button.classList.remove('is-pinning'), { once: true });
  }
});

// 保存した条件のページを開いたら「最後に見た日時」を記録する（/favorites の「前回から◯件新しい」の基準）
function markSavedSearchesSeen(): void {
  if (!isAvailable()) return;
  const savedIds = list('search').map((e) => e.id);
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-fav-kind="search"]')) {
    const id = button.dataset.favId ?? '';
    if (savedIds.includes(id)) markSeen(id, savedIds);
  }
}

window.addEventListener(CHANGE_EVENT, render);
// 別のタブで登録・解除したとき
window.addEventListener('storage', render);
render();
markSavedSearchesSeen();
