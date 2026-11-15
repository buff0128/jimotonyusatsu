// 案件詳細の「初めて参加するなら」：その仕事の内容に合わせて、解説記事（docs/content/guide）を2〜3本選ぶ
// 使うのは API の値と AI の抽出値だけ（ラベルと同じく、AI に選ばせない）
import type { CaseAiExtracted } from './db';

export type FirstGuide = { path: string; reason: string };

const MAX_GUIDES = 3;

export function pickFirstGuides(input: {
  extracted: CaseAiExtracted;
  certification: string | null;
  procedureType: string | null;
}): FirstGuide[] {
  const { extracted, certification, procedureType } = input;
  const needsQualification = Boolean(certification || extracted.qualifications || extracted.licenses?.length);
  const bidMethodReason =
    extracted.bid_method === 'paper'
      ? '紙で出すときに公告で確かめること'
      : extracted.bid_method === 'electronic'
        ? '電子入札の用語と、公告で確かめること'
        : '日程や金額の用語と、公告で確かめること';
  const guides: FirstGuide[] = [
    { path: '/guide/getting-started', reason: '資格の取得から契約までの流れ' },
    ...(needsQualification ? [{ path: '/guide/qualification', reason: 'この仕事は参加資格が必要です' }] : []),
    ...(procedureType ? [{ path: '/guide/bidding-methods', reason: `この仕事の方式は「${procedureType}」です` }] : []),
    { path: '/guide/reading-notices', reason: bidMethodReason },
  ];
  return guides.slice(0, MAX_GUIDES);
}
