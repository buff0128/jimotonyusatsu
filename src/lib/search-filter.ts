// 検索（/search）のクエリ文字列から、一覧の絞り込み条件（CaseFilter）を作る。
// /search のページと、お気に入りの保存した条件の新着件数（/api/cases?saved=…）で同じ条件を使うためにまとめている
import { findCategory } from './categories';
import type { CaseFilter } from './db';
import { todayInJst } from './format';
import type { ListQuery } from './list-query';

const MAX_KEYWORD_LENGTH = 100;

export function readKeyword(params: URLSearchParams): string {
  return (params.get('q') ?? '').trim().slice(0, MAX_KEYWORD_LENGTH);
}

/** 地域はページ側で slug から引いたコードを渡す（都道府県が無ければ市区町村も無視する） */
export function searchFilterOf(
  params: URLSearchParams,
  query: ListQuery,
  area: { lgCode?: string; cityCode?: string },
): CaseFilter {
  const q = readKeyword(params);
  return {
    keyword: q || undefined,
    lgCode: area.lgCode,
    cityCode: area.lgCode ? area.cityCode : undefined,
    category: findCategory(params.get('category') ?? '')?.slug,
    tag: query.tag?.slug,
    labels: query.labels.map((l) => l.slug),
    deadlineFrom: query.open || query.sort === 'deadline' ? todayInJst() : undefined,
  };
}

/** 何か条件が付いているか（条件の無い検索は一覧を出さない） */
export function hasSearchCondition(filter: CaseFilter, query: ListQuery): boolean {
  return Boolean(filter.keyword || filter.lgCode || filter.category || filter.tag || filter.deadlineFrom || filter.labels?.length || query.sort === 'deadline');
}
