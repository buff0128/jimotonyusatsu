// 「カレンダーに追加」の中身（終日の予定）。Google カレンダーのリンクはサーバーで、.ics はブラウザで組み立てる
// （.ics のための URL はサーバーに作らない：src/scripts/calendar.ts）

export type CalendarEvent = {
  /** 予定の ID の元（案件ID-段階） */
  uid: string;
  /** 予定の件名（「入札書の提出：〇〇業務委託」） */
  title: string;
  /** 日付（YYYY-MM-DD または ISO 8601。日本時間の日付で終日の予定にする） */
  date: string;
  /** 案件ページの URL */
  url: string;
};

export const CALENDAR_NOTE = '正式な日程は公告で確認してください。';

/** 日本時間の暦日 "20261120" と、その翌日 */
export function allDayRange(value: string): [string, string] | null {
  const time = value.length === 10 ? Date.parse(`${value}T00:00:00+09:00`) : Date.parse(value);
  if (Number.isNaN(time)) return null;
  const ymd = (t: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(t).replaceAll('-', '');
  return [ymd(time), ymd(time + 86_400_000)];
}

export function eventDetails(event: CalendarEvent): string {
  return `${event.url}\n${CALENDAR_NOTE}`;
}

export function googleCalendarUrl(event: CalendarEvent): string | null {
  const range = allDayRange(event.date);
  if (!range) return null;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates: range.join('/'), details: eventDetails(event) });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** ICS（RFC 5545）の値のエスケープ */
function escapeText(text: string): string {
  return text.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n');
}

/** 1行75オクテットで折り返す（マルチバイト文字の途中では切らない） */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74; // 2行目以降は先頭の空白の1オクテットぶん短く
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(event: CalendarEvent, now = new Date()): string | null {
  const range = allDayRange(event.date);
  if (!range) return null;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//jimotonyusatsu//calendar//JA',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.uid}@jimotonyusatsu`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${range[0]}`,
    `DTEND;VALUE=DATE:${range[1]}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(eventDetails(event))}`,
    `URL:${event.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
