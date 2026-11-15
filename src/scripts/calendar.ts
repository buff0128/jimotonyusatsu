// 「カレンダーに追加」の .ics をブラウザで組み立てて保存させる（src/components/CalendarAdd.astro の data-ics）
import { buildIcs, type CalendarEvent } from '../lib/calendar';

function parseEvent(json: string | undefined): CalendarEvent | null {
  try {
    const value = JSON.parse(json ?? 'null') as Partial<CalendarEvent> | null;
    return value && typeof value.uid === 'string' && typeof value.title === 'string' && typeof value.date === 'string' && typeof value.url === 'string'
      ? (value as CalendarEvent)
      : null;
  } catch {
    return null;
  }
}

document.addEventListener('click', (e) => {
  const button = (e.target as Element | null)?.closest?.<HTMLButtonElement>('button[data-ics]');
  if (!button) return;
  const event = parseEvent(button.dataset.ics);
  const ics = event && buildIcs(event);
  if (!event || !ics) return;
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `${event.uid}.ics` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  button.closest('details')?.removeAttribute('open');
});
