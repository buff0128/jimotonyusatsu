// 調達ポータル（デジタル庁）の「落札実績オープンデータ」を取得して、手元の awards に入れる
//
//   node scripts/fetch-awards.mjs                         # 今年度の全件（前月末まで）＋今月の日次差分
//   node scripts/fetch-awards.mjs --year 2026 --diff-from 2026-11-01
//
// - 一覧: https://www.p-portal.go.jp/pps-web-biz/UAB02/OAB0201
// - 全件（年度ごと、zip の中に見出し無しの CSV）と、日次の差分（JSON）がある。差分は過去2か月分だけ置かれている
// - 列: 調達案件番号, 件名, 落札日, 落札金額, 府省コード, 入札方式コード, 落札者名, 法人番号（予定価格・落札率は無い）
// - 利用条件：政府標準利用規約（CC BY 4.0 互換）。表示には出典「調達ポータル」と、加工した旨を記載する
// - リクエストは1本ずつ、間隔2秒以上。取得したファイルは data/raw/awards/ に保存し、同じファイルは取り直さない
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR, openLocalDb } from './lib/local-db.mjs';

const BASE = 'https://api.p-portal.go.jp/pps-web-biz/UAB03';
const INTERVAL_MS = 2000;
const USER_AGENT = 'jimotonyusatsu-fetcher/0.1 (+https://jimotonyusatsu.jp)';
const RAW_DIR = join(DATA_DIR, 'raw', 'awards');

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
const fiscalYear = (ymd) => (Number(ymd.slice(5, 7)) >= 4 ? Number(ymd.slice(0, 4)) : Number(ymd.slice(0, 4)) - 1);
const { values: args } = parseArgs({
  options: {
    year: { type: 'string', default: String(fiscalYear(today)) },
    'diff-from': { type: 'string', default: `${today.slice(0, 7)}-01` },
  },
});

mkdirSync(RAW_DIR, { recursive: true });
const db = openLocalDb();
const upsert = db.prepare(`INSERT INTO awards (procurement_item_no, corporation_no, item_name, award_date, award_price, ministry_cd,
    bidding_method_cd, winner_name, source_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (procurement_item_no, corporation_no) DO UPDATE SET item_name = excluded.item_name, award_date = excluded.award_date,
    award_price = excluded.award_price, ministry_cd = excluded.ministry_cd, bidding_method_cd = excluded.bidding_method_cd,
    winner_name = excluded.winner_name, source_file = excluded.source_file`);

let lastRequestAt = 0;
let rows = 0;

// 年度の全件（zip → CSV）
const yearFile = `successful_bid_record_info_all_${args.year}.zip`;
const zipPath = await download(`${BASE}/OAB0301?fileversion=v001&filename=${yearFile}`, yearFile);
if (zipPath) {
  const csv = execFileSync('unzip', ['-p', zipPath], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8').replace(/^﻿/, '');
  rows += store(parseCsv(csv), yearFile);
}

// 日次の差分（JSON）。全件に入っていない今月分
for (let d = args['diff-from']; d <= today; d = addDays(d, 1)) {
  const name = `successful_bid_record_info_diff_${d.replaceAll('-', '')}.json`;
  const path = await download(`${BASE}/OAB0302?fileversion=v001&filename=${name}`, name);
  if (!path) continue;
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '').trim();
  if (!text) continue;
  const json = JSON.parse(text);
  const list = Array.isArray(json) ? json : (Object.values(json).find(Array.isArray) ?? []);
  rows += store(
    list.map((r) => [r.procurementItemNo, r.procurementItemNm, r.successfulBidDate, r.successfulBidPrice, r.ministryCd, r.biddingMethodCd, r.tradeNameKanji, r.corporationNo]),
    name,
  );
}
console.log(`[awards] ${rows} 行を取り込み。awards は計 ${db.prepare('SELECT COUNT(*) AS n FROM awards').get().n} 行`);
db.close();

// ---------------------------------------------------------------------------

function store(records, file) {
  db.exec('BEGIN');
  for (const [no, name, date, price, ministry, method, winner, corp] of records) {
    if (!no) continue;
    const yen = Number.parseFloat(price);
    upsert.run(no, corp ?? '', name ?? null, date ?? null, Number.isFinite(yen) ? Math.round(yen) : null, ministry ?? null, method ?? null, winner ?? null, file);
  }
  db.exec('COMMIT');
  console.log(`[awards] ${file}: ${records.length} 行`);
  return records.length;
}

/** 取得して data/raw/awards/ に保存する。保存済みなら取り直さない（当日の差分だけは取り直す） */
async function download(url, name) {
  const path = join(RAW_DIR, name);
  if (existsSync(path) && !name.includes(today.replaceAll('-', ''))) return path;
  const wait = lastRequestAt + INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    console.warn(`[awards] ${name}: HTTP ${res.status}`);
    return null;
  }
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

/** 見出し無し・全項目ダブルクォートの CSV */
function parseCsv(text) {
  const records = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((v) => v !== '')) records.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); records.push(row); }
  return records;
}

function addDays(ymd, delta) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
