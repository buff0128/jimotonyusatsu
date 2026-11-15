// 締切の計算（サーバーの初期表示と、ブラウザでの再計算 src/scripts/countdown.ts の両方で使う）
// ページはエッジキャッシュされるので、「あと◯日」や締切が近いかどうかは最終的にブラウザで決める。

const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000;

/** 締切が近いとみなす日数（この日数以内なら柿色の面） */
export const SOON_DAYS = 7;

/** 新着とみなす日数（公告日から、日本時間の暦日でこの日数以内なら「新着」） */
export const NEW_DAYS = 3;

/** 締切の候補：[表示名, 日付（YYYY-MM-DD または ISO 8601）] */
export type DeadlineCandidate = [label: string, value: string];

/** 締切の時刻。日付だけならその日の終わり（日本時間 24:00 の直前） */
export function deadlineTime(value: string): number {
  return value.length === 10 ? Date.parse(`${value}T23:59:59+09:00`) : Date.parse(value);
}

/** 日本時間の暦日で数えた残り日数（今日が締切なら 0） */
export function daysLeft(deadline: number, now: number): number {
  const day = (t: number) => Math.floor((t + JST_MS) / DAY_MS);
  return day(deadline) - day(now);
}

/** 公告日（YYYY-MM-DD）が新着の範囲か。公告日の当日を0日目として NEW_DAYS 日目まで */
export function isNewIssue(issueDate: string, now: number): boolean {
  const time = Date.parse(`${issueDate.slice(0, 10)}T00:00:00+09:00`);
  if (Number.isNaN(time)) return false;
  const elapsed = -daysLeft(time, now);
  return elapsed >= 0 && elapsed <= NEW_DAYS;
}

export type NextDeadline =
  | { state: 'open'; label: string; value: string; days: number }
  | { state: 'closed' }
  | { state: 'unknown' };

/** 候補のうち、まだ過ぎていない最も早い締切 */
export function nextDeadline(candidates: DeadlineCandidate[], now: number): NextDeadline {
  const known = candidates
    .map(([label, value]) => ({ label, value, time: deadlineTime(value) }))
    .filter((c) => !Number.isNaN(c.time));
  if (known.length === 0) return { state: 'unknown' };
  const upcoming = known.filter((c) => c.time >= now).sort((a, b) => a.time - b.time)[0];
  if (!upcoming) return { state: 'closed' };
  return { state: 'open', label: upcoming.label, value: upcoming.value, days: daysLeft(upcoming.time, now) };
}

export function leftText(days: number): string {
  return days === 0 ? '今日まで' : `あと${days}日`;
}

const shortFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' });

/** "2026-11-09" → "11/9(月)" */
export function shortDate(value: string): string {
  const time = value.length === 10 ? Date.parse(`${value}T00:00:00+09:00`) : Date.parse(value);
  return Number.isNaN(time) ? value : shortFormatter.format(time);
}
