// 公告文を D1 の1ステートメント上限（100KB）に収まる大きさに分ける（migrations/0006_case_descriptions.sql）
//
// 1片は UTF-8 で CHUNK_BYTES 以下。SQL の文字列リテラルでは ' が '' になるので、その分も数える。
// 検索語が境目をまたがないよう、上限の手前 SEARCH_BACK 文字の中に改行があれば、そこで切る。

const CHUNK_BYTES = 60_000;
const SEARCH_BACK = 2_000;

/** @returns {string[]} つなげると元の文字列に戻る片の配列（空文字列なら []） */
export function splitDescription(text) {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start;
    let bytes = 0;
    while (end < text.length) {
      const code = text.codePointAt(end);
      const width = code === 0x27 ? 2 : code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (bytes + width > CHUNK_BYTES) break;
      bytes += width;
      end += code > 0xffff ? 2 : 1;
    }
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end - 1);
      if (newline > start && end - newline <= SEARCH_BACK) end = newline + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
