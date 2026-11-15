export const CATEGORIES = [
  { slug: 'buppin', label: '物品' },
  { slug: 'koji', label: '工事' },
  { slug: 'ekimu', label: '役務' },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]['slug'];

export const UNCATEGORIZED_LABEL = '未分類';

export function findCategory(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function categoryLabel(slug: string | null): string {
  return (slug && findCategory(slug)?.label) ?? UNCATEGORIZED_LABEL;
}
