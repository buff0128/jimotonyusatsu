// お気に入り（ログインなし。ブラウザの localStorage に保存）
//
// 保存するのは「何を・いつ登録したか」だけ。案件・発注機関の中身は表示のたびに API から取る。
// localStorage が使えない環境（プライベートブラウズの一部・ストレージ無効化など）では isAvailable() が false になり、
// 読み出しは空、書き込みは何もしない。

export type FavoriteKind = 'case' | 'org' | 'search';

export type FavoriteEntry = {
  /** case: 案件ID / org: 発注機関ID / search: 検索のクエリ文字列（例 "q=清掃&pref=ibaraki"） */
  id: string;
  /** 登録日時（ISO 8601） */
  addedAt: string;
  /** search だけ：表示名（例「「清掃」・茨城県」） */
  label?: string;
};

type Store = Record<FavoriteKind, FavoriteEntry[]>;

const STORAGE_KEY = 'jimoto:favorites:v1';
const MAX_PER_KIND = 200;
export const CHANGE_EVENT = 'jimoto:favorites-change';

let available: boolean | undefined;

export function isAvailable(): boolean {
  if (available !== undefined) return available;
  try {
    const probe = `${STORAGE_KEY}:probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

function emptyStore(): Store {
  return { case: [], org: [], search: [] };
}

function read(): Store {
  if (!isAvailable()) return emptyStore();
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return emptyStore();
    const store = emptyStore();
    for (const kind of Object.keys(store) as FavoriteKind[]) {
      const list = (parsed as Record<string, unknown>)[kind];
      if (!Array.isArray(list)) continue;
      store[kind] = list.filter(
        (e): e is FavoriteEntry => typeof e?.id === 'string' && typeof e?.addedAt === 'string',
      );
    }
    return store;
  } catch {
    return emptyStore();
  }
}

function write(store: Store): void {
  if (!isAvailable()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 容量超過など。登録できなかっただけで、ページは壊さない
    return;
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function list(kind: FavoriteKind): FavoriteEntry[] {
  return read()[kind];
}

export function has(kind: FavoriteKind, id: string): boolean {
  return read()[kind].some((e) => e.id === id);
}

export function count(): number {
  const store = read();
  return store.case.length + store.org.length + store.search.length;
}

/** 登録していれば外し、していなければ登録する。登録後の状態（true = 登録済み）を返す */
export function toggle(kind: FavoriteKind, id: string, label?: string): boolean {
  const store = read();
  const exists = store[kind].some((e) => e.id === id);
  store[kind] = exists
    ? store[kind].filter((e) => e.id !== id)
    : [{ id, addedAt: new Date().toISOString(), ...(label && { label }) }, ...store[kind]].slice(0, MAX_PER_KIND);
  write(store);
  return !exists;
}

export function remove(kind: FavoriteKind, id: string): void {
  const store = read();
  store[kind] = store[kind].filter((e) => e.id !== id);
  write(store);
}
