// 「参加しやすさ」のラベル（説明は docs/LABELS.md）
//
// AI が公告から抽出した値（case_ai.extracted）に、決まったルールを当てはめて付ける。AI にラベルを判定させない。
// サイト（詳細ページ）と同期スクリプト（D1 の case_labels を作る。scripts/sync-d1.mjs）の両方から使うので、
// 型注釈以外の TypeScript 固有構文は使わない。

export type LicenseInput = { kind?: string; name?: string; grades?: string[] | null };

/** ラベルの判定に使う抽出値（scripts/lib/case-ai.mjs の形式の一部） */
export type LabelInput = {
  bid_method?: string | null;
  bid_bond?: string | null;
  contract_bond?: string | null;
  local_requirement?: string | null;
  licenses?: LicenseInput[] | null;
  experience_required?: boolean | null;
  estimated_price?: number | null;
};

export type Label = {
  slug: string;
  label: string;
  /** ルールの説明（docs/LABELS.md と画面の注記に使う） */
  rule: string;
  test: (x: LabelInput) => boolean;
};

/** 「少額」の上限（予定価格。税込・税抜は区別しない） */
export const SMALL_PRICE_LIMIT = 3_000_000;

/** 全省庁統一資格で「C以下」とみなす等級 */
const LOW_GRADES = new Set(['C', 'D']);

export const LABELS = [
  {
    slug: 'paper',
    label: '紙で入札できる',
    rule: '入札方法が「紙のみ」または「電子・紙どちらも可」',
    test: (x) => x.bid_method === 'paper' || x.bid_method === 'both',
  },
  {
    slug: 'no-bond',
    label: '保証金が免除',
    rule: '入札保証金と契約保証金がどちらも「免除」',
    test: (x) => x.bid_bond === 'exempt' && x.contract_bond === 'exempt',
  },
  {
    slug: 'local',
    label: '地元業者向け',
    rule: '地域要件が「市区町村内」または「都道府県内」に本店・営業所などがあること',
    test: (x) => x.local_requirement === 'city' || x.local_requirement === 'prefecture',
  },
  {
    slug: 'zensho-c',
    label: '全省庁統一資格C以下で参加可',
    rule: '必要な資格に全省庁統一資格があり、参加できる等級にCまたはDが含まれる',
    test: (x) => (x.licenses ?? []).some((l) => l.kind === 'zensho' && (l.grades ?? []).some((g) => LOW_GRADES.has(g.trim().toUpperCase()))),
  },
  {
    slug: 'small',
    label: '少額',
    rule: `予定価格が公表されていて、${SMALL_PRICE_LIMIT / 10_000}万円以下`,
    test: (x) => typeof x.estimated_price === 'number' && x.estimated_price > 0 && x.estimated_price <= SMALL_PRICE_LIMIT,
  },
  {
    slug: 'no-experience',
    label: '実績要件なし',
    rule: '同種・類似業務の実績が参加条件になっていない',
    test: (x) => x.experience_required === false,
  },
] as const satisfies readonly Label[];

export type LabelSlug = (typeof LABELS)[number]['slug'];

export function findLabel(slug: string): Label | undefined {
  return LABELS.find((l) => l.slug === slug);
}

/** 抽出値に当てはまるラベルの slug（LABELS の並び順） */
export function computeLabels(extracted: LabelInput | null | undefined): string[] {
  if (!extracted) return [];
  return LABELS.filter((l) => l.test(extracted)).map((l) => l.slug);
}

/** 一覧の ?label= を読む（未定義の値は無視） */
export function readLabelParam(url: URL): Label | undefined {
  return findLabel(url.searchParams.get('label') ?? '');
}
