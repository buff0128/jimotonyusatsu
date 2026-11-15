// 都道府県・市区町村ページのブラウザ側の表示（ページはエッジキャッシュされるので、今日の日付はここで入れる）
//   [data-today-date]     … 「11月8日（日）の」（日本時間）
//   [data-count-up="123"] … 件数のタイルの数字を 0 から数え上げる（動きを減らす設定のときはしない）
const COUNT_UP_MS = 700;

function renderToday(): void {
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  for (const el of document.querySelectorAll<HTMLElement>('[data-today-date]')) {
    el.textContent = `${get('month')}月${get('day')}日（${get('weekday')}）の`;
  }
}

function countUp(): void {
  if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  const targets = [...document.querySelectorAll<HTMLElement>('[data-count-up]')].map((el) => ({ el, n: Number(el.dataset.countUp) }));
  if (targets.length === 0) return;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / COUNT_UP_MS);
    const eased = 1 - (1 - t) ** 3;
    for (const { el, n } of targets) if (Number.isFinite(n)) el.textContent = Math.round(n * eased).toLocaleString('ja-JP');
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

renderToday();
countUp();
