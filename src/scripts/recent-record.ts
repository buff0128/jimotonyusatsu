// 案件詳細を開いたら「最近見た仕事」に記録する（[data-recent-record] の JSON。src/scripts/recent-store.ts）
import { recordView, type RecentEntry } from './recent-store';

const el = document.querySelector<HTMLElement>('[data-recent-record]');
try {
  const entry = JSON.parse(el?.dataset.recentRecord ?? 'null') as Omit<RecentEntry, 'viewedAt'> | null;
  if (entry && typeof entry.id === 'string' && typeof entry.title === 'string') recordView(entry);
} catch {
  // 記録できなくてもページは壊さない
}
