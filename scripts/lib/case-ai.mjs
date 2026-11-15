// AI 抽出結果（data/ai/results/{案件ID}.json）の形式と検証
//
// {
//   "id": "案件ID",
//   "category": "buppin" | "koji" | "ekimu",          // 種別（物品・工事・役務）
//   "tags": ["seiso"],                                  // 業種タグ（src/lib/gyoshu.ts の slug。1〜3個）
//   "application_deadline": "2026-11-12T17:00:00+09:00" | "2026-11-12" | null,  // 参加申請の期限
//   "tender_submission_deadline": 同上 | null,         // 入札書（提案書）の提出期限
//   "opening_tenders_event": 同上 | null,              // 開札日
//   "performance_period": "令和9年4月1日から令和10年3月31日まで" | null,  // 履行期間・納入期限（公告の表記）
//   "qualifications": "…" | null,                     // 必要な資格（箇条書きを改行区切り）
//   "bid_method": "paper" | "electronic" | "both" | null,  // 入札方法
//   "location": "…" | null,                           // 履行場所・納入場所
//   "project_name": "正しい件名" | null,              // API の件名がファイル名・お知らせ文などの場合だけ
//   "question_deadline": 日付 | null,                  // 質問の受付期限
//   "bid_bond": "exempt" | "required" | null,          // 入札保証金
//   "contract_bond": "exempt" | "required" | "partial" | null,  // 契約保証金
//   "local_requirement": "city" | "prefecture" | "region" | "none" | null,  // 地域要件の範囲
//   "local_requirement_text": "…" | null,
//   "licenses": [{ "kind": "zensho" | "local" | "kensetsu" | "other", "name": "…", "grades": ["C","D"] | null }] | null,
//   "experience_required": true | false | null,       // 実績要件
//   "estimated_price": 1234000 | null,                 // 予定価格（円。公表されているときだけ）
//   "estimated_price_note": "税込" | null,
//   "tips": "参加のポイント（1〜2文）",
//   "summary": "200〜300字の要約",
//   "source_files": ["読んだ資料のURL"],
//   "notes": "判断に迷った点など（サイトには出さない）"
// }
import { GYOSHU } from '../../src/lib/gyoshu.ts';

const TAG_SLUGS = new Set(GYOSHU.map((g) => g.slug));
const CATEGORIES = new Set(['buppin', 'koji', 'ekimu']);
const BID_METHODS = new Set(['paper', 'electronic', 'both']);
const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?\+09:00)?$/;
const DATE_FIELDS = ['application_deadline', 'question_deadline', 'tender_submission_deadline', 'opening_tenders_event'];
const TEXT_FIELDS = ['performance_period', 'qualifications', 'location', 'project_name', 'local_requirement_text', 'estimated_price_note', 'tips'];
const ENUMS = {
  bid_bond: ['exempt', 'required'],
  contract_bond: ['exempt', 'required', 'partial'],
  local_requirement: ['city', 'prefecture', 'region', 'none'],
};
const LICENSE_KINDS = new Set(['zensho', 'local', 'kensetsu', 'other']);

/** @returns {{ errors: string[], warnings: string[] }} */
export function validateAiResult(result) {
  const errors = [];
  const warnings = [];
  if (typeof result.id !== 'string') errors.push('id がない');
  if (result.category != null && !CATEGORIES.has(result.category)) errors.push(`category が不正: ${result.category}`);
  if (!Array.isArray(result.tags) || result.tags.length === 0 || result.tags.length > 3) errors.push('tags は1〜3個');
  for (const tag of result.tags ?? []) if (!TAG_SLUGS.has(tag)) errors.push(`未定義の業種タグ: ${tag}`);
  for (const f of DATE_FIELDS) if (result[f] != null && !DATE.test(result[f])) errors.push(`${f} の形式が不正: ${result[f]}`);
  for (const f of TEXT_FIELDS) if (result[f] != null && typeof result[f] !== 'string') errors.push(`${f} は文字列か null`);
  if (result.bid_method != null && !BID_METHODS.has(result.bid_method)) errors.push(`bid_method が不正: ${result.bid_method}`);
  for (const [f, values] of Object.entries(ENUMS)) {
    if (result[f] != null && !values.includes(result[f])) errors.push(`${f} が不正: ${result[f]}`);
  }
  if (result.licenses != null) {
    if (!Array.isArray(result.licenses)) errors.push('licenses は配列か null');
    else for (const l of result.licenses) {
      if (!LICENSE_KINDS.has(l?.kind)) errors.push(`licenses.kind が不正: ${l?.kind}`);
      if (typeof l?.name !== 'string') errors.push('licenses.name がない');
      if (l?.grades != null && !(Array.isArray(l.grades) && l.grades.every((g) => typeof g === 'string'))) errors.push('licenses.grades は文字列の配列か null');
    }
  }
  if (result.experience_required != null && typeof result.experience_required !== 'boolean') errors.push('experience_required は true / false / null');
  if (result.estimated_price != null && !Number.isInteger(result.estimated_price)) errors.push('estimated_price は整数（円）か null');
  if (typeof result.summary !== 'string' || result.summary.length === 0) errors.push('summary がない');
  else if (result.summary.length < 150 || result.summary.length > 350) warnings.push(`summary が ${result.summary.length} 字`);
  return { errors, warnings };
}

/** case_ai.extracted に入れる項目（要約・メモ・ID は別に持つ） */
export function toExtracted(result) {
  const { id, summary, notes, source_files, ...extracted } = result;
  return Object.fromEntries(Object.entries(extracted).filter(([, v]) => v !== undefined));
}

// ---------------------------------------------------------------------------
// 取り込み時の補正（AI の出力をバッチ間で揃える。元の JSON ファイルは書き換えない）
//
// 1. 予定価格ではない金額（提案上限額・予算額・伺い額・設計金額・見積限度額など）は estimated_price に入れない。
//    金額は estimated_price_note に移す（「少額」ラベルの誤判定を防ぐ）
// 2. 地域要件 region のうち、本店・営業所など所在地の条件が書かれていないもの（全省庁統一資格の「競争参加地域」など）は none にする
const NOT_ESTIMATED_PRICE = /上限|限度|伺い|設計金額|予算|見積/;
const LOCATION_CONDITION = /本店|営業所|支店|事業所|所在|拠点|営業/;

/** @returns {{ result: object, changes: string[] }} */
export function normalizeAiResult(input) {
  const result = { ...input };
  const changes = [];
  if (typeof result.estimated_price === 'number' && NOT_ESTIMATED_PRICE.test(result.estimated_price_note ?? '')) {
    result.estimated_price_note = `${result.estimated_price_note} ${result.estimated_price.toLocaleString('ja-JP')}円（予定価格ではない）`;
    result.estimated_price = null;
    changes.push('予定価格ではない金額を備考へ');
  }
  if (result.local_requirement === 'region' && !LOCATION_CONDITION.test(result.local_requirement_text ?? '')) {
    result.local_requirement = 'none';
    result.local_requirement_text = null;
    changes.push('所在地の条件のない地域区分を none に');
  }
  return { result, changes };
}
