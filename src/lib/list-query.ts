// 一覧ページ（docs/design/AfterList.dc.html の構成）の絞り込み条件。クエリ文字列で受け取る
//   ?city=mito          市区町村（都道府県の一覧だけ）
//   ?label=paper&label=no-bond  参加しやすさ（すべてを満たす）
//   ?tag=seiso          業種
//   ?open=1             締切前の仕事だけ（締切が分かるものに限る）
//   ?sort=deadline      締切が近い順（締切が分かる仕事だけ）。既定は新着順
//   ?page=2
// 絞り込んだ一覧はハブページの部分集合なので noindex にする（isFiltered）
import type { CaseSort } from './db';
import { findGyoshu, type Gyoshu } from './gyoshu';
import { findLabel, type Label } from './labels';
import { readPage } from './pagination';

export type ListQuery = {
  labels: Label[];
  tag?: Gyoshu;
  citySlug?: string;
  open: boolean;
  sort: CaseSort;
  page: number;
};

const SLUG = /^[a-z0-9-]+$/;

export function readListQuery(url: URL): ListQuery {
  const params = url.searchParams;
  const labels = [...new Set(params.getAll('label'))].map(findLabel).filter((l) => l !== undefined);
  const city = params.get('city') ?? '';
  return {
    labels,
    tag: findGyoshu(params.get('tag') ?? ''),
    citySlug: SLUG.test(city) ? city : undefined,
    open: params.get('open') === '1',
    sort: params.get('sort') === 'deadline' ? 'deadline' : 'new',
    page: readPage(url),
  };
}

/** ページ送り以外の条件が付いているか */
export function isFiltered(query: ListQuery): boolean {
  return query.labels.length > 0 || Boolean(query.tag) || Boolean(query.citySlug) || query.open || query.sort !== 'new';
}

/** 条件の説明（「締切前・紙で入札できる・清掃」） */
export function describeQuery(query: ListQuery, cityName?: string): string[] {
  return [
    cityName,
    query.open ? '締切前' : undefined,
    ...query.labels.map((l) => l.label),
    query.tag?.label,
  ].filter((s): s is string => Boolean(s));
}

/** お気に入りに保存する検索条件（page を除き、空の値を落として並びを揃えたクエリ文字列） */
export function savedQueryOf(params: URLSearchParams, extra: Record<string, string> = {}): string {
  const entries = [...params, ...Object.entries(extra)].filter(([key, value]) => key !== 'page' && value !== '');
  return new URLSearchParams(entries.sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))).toString();
}
