// AI 抽出の対象案件（data/ai/targets.json）の公告・添付資料を取得し、テキストにする
//
//   node scripts/fetch-docs.mjs
//
// - リクエストは1本ずつ・間隔1.5秒以上（取得先は各発注機関のサイト）
// - 1案件あたり最大 MAX_FILES_PER_CASE ファイル、1ファイル MAX_BYTES まで
// - PDF は pdftotext（brew install poppler）、HTML・Word は macOS の textutil でテキスト化。ZIP・Excel は対象外
// - 出力：data/docs/{案件ID}/NN.拡張子、NN.txt、text.txt（AI が読むまとめ）、manifest.json
// - 取得済みのファイルは取り直さない
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, openLocalDb } from './lib/local-db.mjs';
import { parseAttachments } from './lib/attachments.mjs';

const REQUEST_INTERVAL_MS = 1500;
const TIMEOUT_MS = 30_000;
const MAX_FILES_PER_CASE = 8;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_CHARS_PER_FILE = 15_000;
const MAX_CHARS_TOTAL = 25_000;
const USER_AGENT = 'jimotonyusatsu-fetcher/0.1 (+https://jimotonyusatsu.jp)';

//   node scripts/fetch-docs.mjs targets-extra.json   # data/ai/ の下の別の対象ファイル
const targets = JSON.parse(readFileSync(join(DATA_DIR, 'ai', process.argv[2] ?? 'targets.json'), 'utf8'));
const db = openLocalDb();
const getCase = db.prepare(`
  SELECT id, project_name, organization_name, prefecture_name, city_name, category_raw, procedure_type, certification,
         cft_issue_date, tender_submission_deadline, opening_tenders_event, period_end_time, location,
         external_document_uri, attachments, description
  FROM cases WHERE id = ?`);

let lastRequestAt = 0;
const summary = { cases: 0, files: 0, ok: 0, skipped: 0, failed: 0 };
for (const target of targets) {
  const c = getCase.get(target.id);
  if (!c) continue;
  summary.cases++;
  const dir = join(DATA_DIR, 'docs', c.id);
  mkdirSync(dir, { recursive: true });

  const sources = [
    ...(c.external_document_uri ? [{ name: '公告', uri: c.external_document_uri }] : []),
    ...parseAttachments(c.attachments),
  ];
  const unique = [...new Map(sources.map((s) => [s.uri, s])).values()].slice(0, MAX_FILES_PER_CASE);

  const manifest = [];
  for (const [index, source] of unique.entries()) {
    summary.files++;
    const entry = await fetchAndConvert(dir, index, source);
    manifest.push(entry);
    summary[entry.status === 'ok' ? 'ok' : entry.status === 'skipped' ? 'skipped' : 'failed']++;
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'text.txt'), buildReadingText(c, manifest, dir));
  console.log(`[docs] ${c.id} ${manifest.map((m) => m.status).join(',')}  ${c.project_name.slice(0, 40)}`);
}
db.close();
console.log('[docs] 完了', summary);

// ---------------------------------------------------------------------------

async function fetchAndConvert(dir, index, source) {
  const nn = String(index + 1).padStart(2, '0');
  const base = { name: source.name, uri: source.uri };
  const existing = findExisting(dir, nn);
  if (existing) return { ...base, ...existing };

  let res;
  try {
    await waitForInterval();
    res = await fetch(source.uri, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { ...base, status: 'failed', error: String(err?.message ?? err) };
  }
  if (!res.ok) return { ...base, status: 'failed', error: `HTTP ${res.status}` };
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) {
    await res.body?.cancel();
    return { ...base, status: 'skipped', error: `too large (${length} bytes)` };
  }
  let bytes;
  try {
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return { ...base, status: 'failed', error: `body: ${err?.message ?? err}` };
  }
  if (bytes.length > MAX_BYTES) return { ...base, status: 'skipped', error: `too large (${bytes.length} bytes)` };

  const ext = detectExtension(bytes, res.headers.get('content-type'), source.uri);
  const file = join(dir, `${nn}.${ext}`);
  writeFileSync(file, bytes);
  const txt = join(dir, `${nn}.txt`);
  try {
    if (ext === 'pdf') execFileSync('pdftotext', ['-enc', 'UTF-8', file, txt], { stdio: 'ignore', timeout: 60_000 });
    else if (['html', 'docx', 'doc', 'rtf'].includes(ext)) execFileSync('textutil', ['-convert', 'txt', '-output', txt, file], { stdio: 'ignore', timeout: 60_000 });
    else return { ...base, status: 'skipped', file, error: `unsupported type: ${ext}` };
  } catch (err) {
    return { ...base, status: 'failed', file, error: `convert failed: ${err?.message ?? err}` };
  }
  const chars = existsSync(txt) ? readFileSync(txt, 'utf8').trim().length : 0;
  return { ...base, status: chars > 0 ? 'ok' : 'empty', file, text: txt, chars };
}

/** 取得・変換済みならその結果を返す（再実行時に取り直さない） */
function findExisting(dir, nn) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const prev = JSON.parse(readFileSync(manifestPath, 'utf8')).find((m) => m.file?.includes(`/${nn}.`));
  if (!prev || prev.status === 'failed') return null;
  const { name, uri, ...rest } = prev;
  return rest;
}

function detectExtension(bytes, contentType, uri) {
  const head = bytes.subarray(0, 8).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('PK')) {
    if (/\.docx(\?|$)/i.test(uri)) return 'docx';
    if (/\.xlsx(\?|$)/i.test(uri)) return 'xlsx';
    return 'zip';
  }
  if (head.startsWith('\xD0\xCF\x11\xE0')) return /\.xls(\?|$)/i.test(uri) ? 'xls' : 'doc';
  if (/html/i.test(contentType ?? '') || /<html|<!doctype/i.test(bytes.subarray(0, 512).toString('latin1'))) return 'html';
  return (uri.match(/\.(\w{2,4})(?:\?|$)/)?.[1] ?? 'bin').toLowerCase();
}

/** AI が読むためのまとめ。案件の基本情報と、各資料のテキスト（長いものは切る） */
function buildReadingText(c, manifest, dir) {
  const api = {
    件名: c.project_name, 発注機関: c.organization_name, 都道府県: c.prefecture_name, 市区町村: c.city_name,
    種別: c.category_raw, 入札方式: c.procedure_type, 資格等級: c.certification, 公告日: c.cft_issue_date,
    入札書提出期限: c.tender_submission_deadline, 開札日: c.opening_tenders_event, 納入期限: c.period_end_time,
    履行場所: c.location,
  };
  const parts = [
    `# 案件ID: ${c.id}`,
    '# 官公需APIの値（空欄は API で提供されていない）',
    ...Object.entries(api).map(([k, v]) => `- ${k}: ${v ?? ''}`),
    '',
  ];
  let total = 0;
  for (const [i, m] of manifest.entries()) {
    parts.push(`===== 資料${i + 1}: ${m.name ?? ''} (${m.uri}) [${m.status}${m.error ? `: ${m.error}` : ''}] =====`);
    if (m.status !== 'ok') continue;
    let text = readFileSync(m.text, 'utf8').replace(/\f/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const budget = Math.min(MAX_CHARS_PER_FILE, MAX_CHARS_TOTAL - total);
    if (budget <= 0) {
      parts.push('（文字数の上限のため省略）');
      continue;
    }
    if (text.length > budget) text = `${text.slice(0, budget)}\n…（以下省略）`;
    total += text.length;
    parts.push(text);
  }
  // 資料が1つも読めなかったときは、API の公告文（ProjectDescription。PDF から抽出された本文）で代える
  if (total === 0 && c.description) {
    parts.push('===== 官公需APIの公告文（資料が取得できなかったための代替） =====');
    parts.push(c.description.slice(0, MAX_CHARS_PER_FILE));
  }
  return parts.join('\n') + '\n';
}

async function waitForInterval() {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt > 0 && elapsed < REQUEST_INTERVAL_MS) await new Promise((r) => setTimeout(r, REQUEST_INTERVAL_MS - elapsed));
  lastRequestAt = Date.now();
}
