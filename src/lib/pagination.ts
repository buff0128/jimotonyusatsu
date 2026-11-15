export const PAGE_SIZE = 50;

/** ?page= を 1 以上の整数として読む。不正値は 1 */
export function readPage(url: URL): number {
  const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
  return Number.isFinite(page) && page >= 1 ? page : 1;
}

export function totalPages(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
