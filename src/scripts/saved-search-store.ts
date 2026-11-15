// 保存した条件（お気に入りの search）の「最後に見た日時」と「新しい仕事の件数」のキャッシュ（localStorage）
//
// - 最後に見た日時：その条件の保存ボタン（data-fav-kind="search"）があるページを開いたときに記録する
//   （/search の結果・都道府県や市区町村のページ・一覧）。記録が無ければ保存した日時を使う
// - 件数：/api/cases?saved=…&since=… で数える。同じ条件・同じ「最後に見た日」は1日1回だけ数え、結果をここに置く
// お気に入り本体（favorites-store.ts）とはキーを分け、記録しても☆ボタンの再描画（CHANGE_EVENT）は起こさない
import { isAvailable } from './favorites-store';

type NewCount = { count: number; more: boolean };
type Record_ = {
  /** 最後に見た日時（ISO 8601） */
  seenAt?: string;
  /** 件数のキャッシュ（since：数えたときの基準日、on：数えた日。どちらも日本時間の YYYY-MM-DD） */
  cache?: NewCount & { since: string; on: string };
};

const STORAGE_KEY = 'jimoto:saved-search:v1';

function readAll(): Record<string, Record_> {
  if (!isAvailable()) return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Record_>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Record_>, keep: Set<string>): void {
  if (!isAvailable()) return;
  // 外した条件の記録は残さない
  const pruned = Object.fromEntries(Object.entries(all).filter(([id]) => keep.has(id)));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    return;
  }
}

export function toJstDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '1970-01-01' : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(date);
}

/** 条件を見たことを記録する。savedIds は保存中の条件の ID（外した条件の記録を消すため） */
export function markSeen(id: string, savedIds: string[]): void {
  const all = readAll();
  all[id] = { ...all[id], seenAt: new Date().toISOString() };
  writeAll(all, new Set(savedIds));
}

/** 「前回」の基準日（日本時間の YYYY-MM-DD）。見た記録が無ければ保存した日 */
export function sinceOf(id: string, addedAt: string): string {
  return toJstDate(readAll()[id]?.seenAt ?? addedAt);
}

/** 今日すでに同じ基準日で数えていれば、その件数 */
export function cachedCount(id: string, since: string): NewCount | null {
  const cache = readAll()[id]?.cache;
  const today = toJstDate(new Date().toISOString());
  return cache && cache.since === since && cache.on === today ? { count: cache.count, more: cache.more } : null;
}

export function saveCount(id: string, since: string, value: NewCount, savedIds: string[]): void {
  const all = readAll();
  all[id] = { ...all[id], cache: { ...value, since, on: toJstDate(new Date().toISOString()) } };
  writeAll(all, new Set(savedIds));
}
