const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** "2026-11-02" / ISO 8601 → "2026年11月2日(月)"。時刻が 00:00 でなければ時刻も出す */
export function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00+09:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  const hasTime = value.length > 10 && !/T00:00(:00)?/.test(value);
  return (hasTime ? dateTimeFormatter : dateFormatter).format(date);
}

export function formatFileSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 今日の日付（日本時間、YYYY-MM-DD） */
export function todayInJst(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}
