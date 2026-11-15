// 最近見た仕事（ログインなし。ブラウザの localStorage に保存。お気に入りと同じ仕組み：src/scripts/favorites-store.ts）
//
// 案件詳細を開いたときに、一覧に出すための最小限の情報（件名・地名・発注機関・締切）をページから写して保存する。
// サーバーには何も送らない。localStorage が使えない環境では読み出しは空、書き込みは何もしない。
import { isAvailable } from './favorites-store';

export type RecentEntry = {
  id: string;
  title: string;
  /** 地名（市区町村、なければ都道府県） */
  place: string;
  org: string;
  /** 入札書の提出期限（なければ参加申請の期限）。YYYY-MM-DD または ISO 8601。分からなければ null */
  deadline: string | null;
  /** 見た日時（ISO 8601） */
  viewedAt: string;
};

const STORAGE_KEY = 'jimoto:recent:v1';
const MAX_ENTRIES = 20;
export const RECENT_CHANGE_EVENT = 'jimoto:recent-change';

function isEntry(e: unknown): e is RecentEntry {
  const v = e as Partial<RecentEntry> | null;
  return typeof v?.id === 'string' && typeof v.title === 'string' && typeof v.viewedAt === 'string';
}

export function listRecent(): RecentEntry[] {
  if (!isAvailable()) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function write(entries: RecentEntry[]): void {
  if (!isAvailable()) return;
  try {
    if (entries.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(RECENT_CHANGE_EVENT));
}

/** 見た仕事を先頭に入れる（同じ仕事は前の記録を消して入れ直す） */
export function recordView(entry: Omit<RecentEntry, 'viewedAt'>): void {
  const rest = listRecent().filter((e) => e.id !== entry.id);
  write([{ ...entry, viewedAt: new Date().toISOString() }, ...rest].slice(0, MAX_ENTRIES));
}

export function clearRecent(): void {
  write([]);
}
