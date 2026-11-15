// 統計（過去12か月）を文章にするための小さな関数。数字は scripts/lib/stats.mjs が計算した値をそのまま使う
import type { MonthlySeries, PeakMonth } from './db';

/** 年間この件数未満なら統計を出さず、ページは noindex（scripts/lib/stats.mjs と同じ値） */
export const MIN_YEARLY_CASES = 5;

export function hasEnoughData(series: MonthlySeries | null | undefined): series is MonthlySeries {
  return Boolean(series && series.total >= MIN_YEARLY_CASES);
}

export function monthLabel(ym: string): string {
  return `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`;
}

export function periodLabel(series: MonthlySeries): string {
  return `${monthLabel(series.months[0])}〜${monthLabel(series.months.at(-1)!)}`;
}

/** 月平均（小数1桁） */
export function monthlyAverage(series: MonthlySeries): number {
  return Math.round((series.total / series.months.length) * 10) / 10;
}

/** 直近3か月の月平均と、12か月平均との比較 */
export function recentTrend(series: MonthlySeries): { recent: number; comparison: string } {
  const recent = Math.round((series.monthly.slice(-3).reduce((a, b) => a + b, 0) / 3) * 10) / 10;
  const average = monthlyAverage(series);
  const ratio = average > 0 ? recent / average : 1;
  const comparison = ratio >= 1.2 ? '12か月平均より多め' : ratio <= 0.8 ? '12か月平均より少なめ' : '12か月平均と同じくらい';
  return { recent, comparison };
}

export function peakText(peaks: PeakMonth[]): string {
  return peaks.map((p) => `${Number(p.month.slice(5))}月（${p.n}件）`).join('、');
}
