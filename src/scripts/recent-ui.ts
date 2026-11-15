// 「最近見た仕事」の欄を描く（src/components/RecentViewed.astro と /favorites）
//   [data-recent-box]                 … 欄。data-recent-hide-empty があれば0件のときは欄ごと隠す
//   [data-recent-list] data-recent-limit … 一覧を入れる <ul>
//   [data-recent-clear]               … 消去ボタン
// データ由来の文字列は textContent で入れ、HTML として解釈させない
import { deadlineTime, shortDate } from '../lib/deadlines';
import { RECENT_CHANGE_EVENT, clearRecent, listRecent, type RecentEntry } from './recent-store';
import { isAvailable } from './favorites-store';

function item(entry: RecentEntry, now: number): HTMLLIElement {
  const li = document.createElement('li');
  const link = Object.assign(document.createElement('a'), { className: 'recent-title', href: `/cases/${entry.id}`, textContent: entry.title });
  const closed = entry.deadline ? deadlineTime(entry.deadline) < now : false;
  const deadline = entry.deadline ? `締切 ${shortDate(entry.deadline)}${closed ? '・受付終了' : ''}` : null;
  const meta = Object.assign(document.createElement('span'), {
    className: 'recent-meta',
    textContent: [entry.place, entry.org, deadline].filter(Boolean).join('・'),
  });
  if (closed) li.classList.add('is-closed');
  li.appendChild(link);
  li.appendChild(meta);
  return li;
}

function render(): void {
  const entries = listRecent();
  const now = Date.now();
  for (const box of document.querySelectorAll<HTMLElement>('[data-recent-box]')) {
    if (box.hasAttribute('data-recent-hide-empty')) box.hidden = entries.length === 0;
    const list = box.querySelector<HTMLElement>('[data-recent-list]');
    if (!list) continue;
    const limit = Number(list.dataset.recentLimit) || entries.length;
    if (entries.length === 0) {
      const message = isAvailable() ? 'まだありません。仕事のページを開くと、ここに表示されます。' : 'このブラウザでは利用できません。';
      list.replaceChildren(Object.assign(document.createElement('li'), { className: 'muted', textContent: message }));
    } else {
      list.replaceChildren(...entries.slice(0, limit).map((e) => item(e, now)));
    }
    for (const button of box.querySelectorAll<HTMLButtonElement>('[data-recent-clear]')) button.hidden = entries.length === 0;
  }
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest?.('[data-recent-clear]');
  if (!button) return;
  if (window.confirm('最近見た仕事の記録をすべて消します。よろしいですか？')) clearRecent();
});

window.addEventListener(RECENT_CHANGE_EVENT, render);
window.addEventListener('storage', render);
render();
