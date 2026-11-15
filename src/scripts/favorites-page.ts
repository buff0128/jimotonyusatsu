// /favorites の中身を描く。保存してあるのは ID と登録日時だけなので、案件・発注機関の情報は API から取る。
// データ由来の文字列は textContent で入れ、HTML として解釈させない
import { categoryLabel } from '../lib/categories';
import { formatDate } from '../lib/format';
import { CHANGE_EVENT, isAvailable, list, remove, type FavoriteEntry, type FavoriteKind } from './favorites-store';
import { cachedCount, saveCount, sinceOf } from './saved-search-store';

type CaseItem = {
  id: string;
  project_name: string;
  ai_project_name: string | null;
  organization_name: string | null;
  city_name: string | null;
  category: string | null;
  cft_issue_date: string | null;
  tender_submission_deadline: string | null;
  ai_tender_deadline: string | null;
};
type OrgItem = { org_id: string; organization_name: string; case_count: number; new_count: number };

const listEl = (kind: FavoriteKind) => document.querySelector<HTMLUListElement>(`[data-fav-list="${kind}"]`);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []) {
  const node: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  for (const child of children) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}

function removeButton(kind: FavoriteKind, id: string): HTMLButtonElement {
  const button = el('button', { type: 'button', className: 'remove', textContent: '外す' });
  button.addEventListener('click', () => remove(kind, id));
  return button;
}

function setCount(kind: FavoriteKind, n: number) {
  const target = document.querySelector(`[data-fav-section-count="${kind}"]`);
  if (target) target.textContent = n > 0 ? `（${n}件）` : '';
}

function showEmpty(kind: FavoriteKind, message: string) {
  listEl(kind)?.replaceChildren(el('li', { className: 'muted', textContent: message }));
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

async function renderCases(entries: FavoriteEntry[]) {
  setCount('case', entries.length);
  if (entries.length === 0) return showEmpty('case', 'まだ登録した仕事はありません。気になる仕事の ☆ を押すと、ここに集まります。');
  const data = await fetchJson<{ cases: CaseItem[] }>(`/api/cases?ids=${entries.map((e) => e.id).join(',')}`);
  if (!data) return showEmpty('case', '仕事の情報を読み込めませんでした。時間をおいて再読み込みしてください。');

  const byId = new Map(data.cases.map((c) => [c.id, c]));
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const rows = entries.map((entry) => {
    const item = byId.get(entry.id);
    const deadline = item ? (item.tender_submission_deadline ?? item.ai_tender_deadline) : null;
    const state = !deadline ? 'unknown' : deadline.slice(0, 10) < today ? 'past' : 'open';
    return { entry, item, deadline, state };
  });
  // 期限が近い順 → 期限不明 → 期限切れ（新しく切れたものから）→ 掲載終了
  const rank = { open: 0, unknown: 1, past: 2 } as const;
  rows.sort((a, b) => {
    if (!a.item || !b.item) return a.item ? -1 : b.item ? 1 : 0;
    const r = rank[a.state as keyof typeof rank] - rank[b.state as keyof typeof rank];
    if (r !== 0) return r;
    if (a.state === 'open') return a.deadline!.localeCompare(b.deadline!);
    if (a.state === 'past') return b.deadline!.localeCompare(a.deadline!);
    return b.entry.addedAt.localeCompare(a.entry.addedAt);
  });

  listEl('case')?.replaceChildren(
    ...rows.map(({ entry, item, deadline, state }) => {
      if (!item) {
        return el('li', { className: 'past' }, [
          el('div', { className: 'body' }, [el('span', { textContent: '掲載が終了した仕事です' })]),
          removeButton('case', entry.id),
        ]);
      }
      const deadlineText = deadline
        ? `入札書の提出期限 ${formatDate(deadline)}${item.tender_submission_deadline ? '' : '（AI抽出）'}${state === 'past' ? '・期限切れ' : ''}`
        : '提出期限は公告をご確認ください';
      return el('li', { className: state === 'past' ? 'past' : '' }, [
        el('div', { className: 'body' }, [
          el('a', { className: 'title', href: `/cases/${item.id}`, textContent: item.ai_project_name ?? item.project_name }),
          el('div', { className: 'meta' }, [
            el('span', { textContent: categoryLabel(item.category) }),
            el('span', { textContent: item.organization_name ?? '' }),
            ...(item.city_name ? [el('span', { textContent: item.city_name })] : []),
            el('span', { textContent: deadlineText }),
          ]),
        ]),
        removeButton('case', entry.id),
      ]);
    }),
  );
}

async function renderOrgs(entries: FavoriteEntry[]) {
  setCount('org', entries.length);
  if (entries.length === 0) return showEmpty('org', 'まだ登録した発注機関はありません。よく見る機関を登録しておくと、登録後に出た仕事の数が分かります。');
  const query = entries.map((e) => `${e.id}:${toJstDate(e.addedAt)}`).join(',');
  const data = await fetchJson<{ orgs: OrgItem[] }>(`/api/orgs?ids=${query}`);
  if (!data) return showEmpty('org', '発注機関の情報を読み込めませんでした。時間をおいて再読み込みしてください。');

  const byId = new Map(data.orgs.map((o) => [o.org_id, o]));
  listEl('org')?.replaceChildren(
    ...entries.map((entry) => {
      const org = byId.get(entry.id);
      if (!org) {
        return el('li', { className: 'past' }, [
          el('div', { className: 'body' }, [el('span', { textContent: '現在、仕事が掲載されていない発注機関です' })]),
          removeButton('org', entry.id),
        ]);
      }
      return el('li', {}, [
        el('div', { className: 'body' }, [
          el('a', { className: 'title', href: `/orgs/${org.org_id}`, textContent: org.organization_name }),
          el('div', { className: 'meta' }, [
            el('span', { className: org.new_count > 0 ? 'new' : '', textContent: `登録後の新着 ${org.new_count}件` }),
            el('span', { textContent: `掲載中 ${org.case_count}件` }),
            el('span', { textContent: `${formatDate(toJstDate(entry.addedAt))}に登録` }),
          ]),
        ]),
        removeButton('org', entry.id),
      ]);
    }),
  );
}

/** 新しい仕事の件数を数える保存条件の数（上から。API への問い合わせを抑えるため） */
const NEW_COUNT_LIMIT = 5;

function renderSearches(entries: FavoriteEntry[]) {
  setCount('search', entries.length);
  if (entries.length === 0) return showEmpty('search', 'まだ保存した条件はありません。地域のページや一覧の「お気に入りに保存」で、いつもの探し方を保存できます。');
  const savedIds = entries.map((e) => e.id);
  listEl('search')?.replaceChildren(
    ...entries.map((entry, i) => {
      const meta = el('div', { className: 'meta' }, [el('span', { textContent: `${formatDate(toJstDate(entry.addedAt))}に保存` })]);
      if (i < NEW_COUNT_LIMIT) void renderNewCount(meta, entry, savedIds);
      return el('li', {}, [
        el('div', { className: 'body' }, [
          el('a', { className: 'title', href: `/search?${entry.id}`, textContent: entry.label || '検索条件' }),
          meta,
        ]),
        removeButton('search', entry.id),
      ]);
    }),
  );
}

/** 「前回から◯件新しい」。同じ条件・同じ基準日は1日1回だけ数える（saved-search-store.ts にキャッシュ） */
async function renderNewCount(meta: HTMLElement, entry: FavoriteEntry, savedIds: string[]) {
  const since = sinceOf(entry.id, entry.addedAt);
  let value = cachedCount(entry.id, since);
  if (!value) {
    value = await fetchJson<{ count: number; more: boolean }>(`/api/cases?${new URLSearchParams({ saved: entry.id, since })}`);
    if (!value || typeof value.count !== 'number') return;
    saveCount(entry.id, since, value, savedIds);
  }
  const text = value.count === 0 ? '前回から新しく出た仕事はまだありません' : `前回から${value.count}件${value.more ? '以上' : ''}新しい`;
  // append/prepend は Workers の型とぶつかるので insertBefore で入れる
  meta.insertBefore(el('span', { className: value.count > 0 ? 'new' : '', textContent: text }), meta.firstChild);
}

function toJstDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '1970-01-01' : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(date);
}

function renderAll() {
  if (!isAvailable()) {
    document.querySelector<HTMLElement>('[data-fav-unavailable]')?.removeAttribute('hidden');
    for (const kind of ['case', 'org', 'search'] as const) showEmpty(kind, 'このブラウザでは利用できません。');
    return;
  }
  void renderCases(list('case'));
  void renderOrgs(list('org'));
  renderSearches(list('search'));
}

window.addEventListener(CHANGE_EVENT, renderAll);
window.addEventListener('storage', renderAll);
renderAll();
