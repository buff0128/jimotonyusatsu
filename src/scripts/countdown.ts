// 締切の表示を、表示した時点の日時で計算し直す（ページはエッジキャッシュされるので、サーバーの計算は初期表示だけ）
//   [data-countdown="2026-11-20"]          … 「あと◯日」の文字（日付だけなら日本時間のその日の終わりまで）
//   [data-deadline-box] [data-deadlines]  … 案件カードの締切の箱（候補のうち次の締切。過ぎたらカードを薄くして一覧の下へ）
//   [data-timeline] [data-step-date]      … 日程の時系列（済んだ段階・次の段階）
//   [data-hero-deadline] [data-deadlines] … 案件詳細の「◯◯まで あと N 日」
//   [data-hero-cal]                       … 案件詳細の右の枠の「カレンダーに追加」（いまの締切のものだけ出す）
//   [data-new-issue="2026-11-06"]         … 「新着」のピル（公告日から NEW_DAYS 日以内なら出す）
import { formatDate } from '../lib/format';
import { SOON_DAYS, daysLeft, deadlineTime, isNewIssue, leftText, nextDeadline, shortDate, type DeadlineCandidate } from '../lib/deadlines';

function parseCandidates(el: HTMLElement): DeadlineCandidate[] {
  try {
    const value: unknown = JSON.parse(el.dataset.deadlines ?? '[]');
    return Array.isArray(value) ? value.filter((c): c is DeadlineCandidate => Array.isArray(c) && c.length === 2) : [];
  } catch {
    return [];
  }
}

function setText(root: Element, selector: string, text: string): void {
  const el = root.querySelector(selector);
  if (el) el.textContent = text;
}

function renderCountdowns(now: number): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-countdown]')) {
    const time = deadlineTime(el.dataset.countdown ?? '');
    if (Number.isNaN(time)) continue;
    el.textContent = time < now ? '締切済み' : leftText(daysLeft(time, now));
  }
}

function renderCards(now: number): void {
  const closedCards = new Map<Element, Element[]>();
  for (const box of document.querySelectorAll<HTMLElement>('[data-deadline-box]')) {
    const next = nextDeadline(parseCandidates(box), now);
    const card = box.closest('[data-case-card]');
    box.classList.toggle('soon', next.state === 'open' && next.days <= SOON_DAYS);
    card?.classList.toggle('is-closed', next.state === 'closed');
    if (next.state === 'open') {
      setText(box, '[data-dl-label]', next.label);
      setText(box, '[data-dl-left]', leftText(next.days));
      setText(box, '[data-dl-date]', shortDate(next.value));
    } else if (next.state === 'closed') {
      setText(box, '[data-dl-label]', '締切');
      setText(box, '[data-dl-left]', '受付終了');
      setText(box, '[data-dl-date]', '');
    }
    // 受付終了のカードは、その一覧（data-closed-last）の下にまとめる
    const item = card?.closest('[data-case-item]');
    const list = item?.parentElement;
    if (next.state === 'closed' && item && list?.hasAttribute('data-closed-last')) {
      closedCards.set(list, [...(closedCards.get(list) ?? []), item]);
    }
  }
  for (const [list, items] of closedCards) for (const item of items) list.appendChild(item);
}

function renderTimelines(now: number): void {
  for (const timeline of document.querySelectorAll<HTMLElement>('[data-timeline]')) {
    let nextFound = false;
    for (const step of timeline.querySelectorAll<HTMLElement>('[data-step-date]')) {
      const time = deadlineTime(step.dataset.stepDate ?? '');
      const done = !Number.isNaN(time) && time < now;
      const next = !done && !nextFound && !Number.isNaN(time);
      if (next) nextFound = true;
      step.classList.toggle('done', done);
      step.classList.toggle('next', next);
      const left = step.querySelector('[data-step-left]');
      if (left) left.textContent = next ? `　${leftText(daysLeft(time, now))}` : '';
    }
  }
}

function renderHero(now: number): void {
  for (const hero of document.querySelectorAll<HTMLElement>('[data-hero-deadline]')) {
    const next = nextDeadline(parseCandidates(hero), now);
    hero.dataset.state = next.state;
    for (const cal of document.querySelectorAll<HTMLElement>('[data-hero-cal]')) {
      cal.hidden = next.state !== 'open' || cal.dataset.heroCal !== next.label;
    }
    if (next.state !== 'open') continue;
    setText(hero, '[data-hero-label]', `${next.label}まで`);
    setText(hero, '[data-hero-days]', String(next.days));
    setText(hero, '[data-hero-unit]', next.days === 0 ? '日（今日まで）' : '日');
    setText(hero, '[data-hero-date]', formatDate(next.value) ?? '');
  }
}

function renderNewBadges(now: number): void {
  for (const badge of document.querySelectorAll<HTMLElement>('[data-new-issue]')) {
    badge.hidden = !isNewIssue(badge.dataset.newIssue ?? '', now);
  }
}

function render(): void {
  const now = Date.now();
  renderNewBadges(now);
  renderCountdowns(now);
  renderCards(now);
  renderTimelines(now);
  renderHero(now);
}

render();
