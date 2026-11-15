// 茨城県の入札情報公開サービスから発注情報（公告）を取得し、SQLite の cases に取り込む（試作）
//
//   node scripts/fetch-ppi.mjs                                  # 両方・直近3平日（今日を除く）
//   node scripts/fetch-ppi.mjs --system koji --from 2026-10-30 --to 2026-11-04
//   node scripts/fetch-ppi.mjs --system koji --org 0201ZZZZZZ   # 調達機関を絞る（試験用）
//
//   --system koji   : いばらき電子入札共同利用 入札情報公開サービス（建設工事・コンサル）
//                     調達機関の「指定しない」が使えないため、機関 × 業務区分ごとに検索する
//   --system buppin : 茨城県電子調達システム 入札情報サービス（物品・役務）。全機関を1回で検索できる
//
// リクエストは常に1本ずつ、間隔は2.5秒。公告PDFなどの添付は取得しない。
// 利用規約上の注意は docs/SOURCES_IBARAKI.md を参照（サイトへの表示・リンクの前に確認が必要）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { caseId, prepareCaseUpsert } from './lib/cases-repo.mjs';
import { DATA_DIR, openLocalDb } from './lib/local-db.mjs';
import {
  PpiSession,
  PpiSessionError,
  parseHiddenValue,
  parseListHeaders,
  parseOrgOptions,
  parseRecordNum,
  parseResultRows,
} from './lib/ppi.mjs';

const REQUEST_INTERVAL_MS = 2500;
const PER_PAGE = 100; // 表示件数の最大（A300=040）
const LG_CODE = '08';
const PREFECTURE_NAME = '茨城県';

// 一覧の見出し → cases の列
const FIELD_BY_HEADER = {
  工事名: 'project_name',
  件名: 'project_name',
  業務名: 'project_name',
  工事番号: 'case_number',
  案件番号: 'case_number',
  業務番号: 'case_number',
  入札方式: 'procedure_type',
  種別: 'work_type', // 建設工事側の「種別」は工種（土木一式工事など）
  営業種目: 'category_raw', // 物品・役務側の「営業種目」は 物品の販売 / 役務等の提供
  希望営業種目: 'work_type',
  工事場所: 'location',
  業務場所: 'location',
  履行場所: 'location',
  工事概要: 'description',
  業務概要: 'description',
  備考: 'description',
  公開年月日: 'cft_issue_date',
  公開日: 'cft_issue_date',
  開札年月日: 'opening_tenders_event',
  開札日: 'opening_tenders_event',
  '予定価格（税込み）': 'estimated_price',
  予定価格: 'estimated_price',
  課所名: 'organization_name',
};

const BUPPIN_CATEGORY = { 物品の販売: 'buppin', 物品の製造: 'buppin', 役務等の提供: 'ekimu' };

const SYSTEMS = {
  koji: {
    source: 'ibaraki_ppi_koji',
    baseUrl: 'http://ppi.cals-ibaraki.lg.jp/koukai/do/',
    // 業務区分。コンサル（測量・設計など）は官公需ポータルの分類に合わせて役務扱いにする
    supplyTypes: [
      { code: '00', label: '工事', category: 'koji' },
      { code: '01', label: 'コンサル', category: 'ekimu' },
    ],
  },
  buppin: {
    source: 'ibaraki_ppi_buppin',
    baseUrl: 'http://ppi2.cals-ibaraki.lg.jp/koukai/do/',
  },
};

const { values: args } = parseArgs({
  options: {
    system: { type: 'string', default: 'all' },
    from: { type: 'string' },
    to: { type: 'string' },
    days: { type: 'string', default: '3' },
    org: { type: 'string' },
  },
});

const range = resolveRange(args);
const systems = args.system === 'all' ? ['koji', 'buppin'] : [args.system];
for (const name of systems) if (!SYSTEMS[name]) throw new Error(`--system は koji / buppin / all: ${name}`);

const db = openLocalDb();
const upsert = prepareCaseUpsert(db);
const areas = db.prepare("SELECT code, name FROM areas WHERE kind = 'city' AND lg_code = ?").all(LG_CODE);
const fetchedAt = new Date().toISOString();
console.log(`[ppi] 公開日 ${range.from} 〜 ${range.to}`);

for (const name of systems) {
  const system = SYSTEMS[name];
  const session = new PpiSession({ baseUrl: system.baseUrl, intervalMs: REQUEST_INTERVAL_MS });
  const rawDir = join(DATA_DIR, 'raw', 'ppi', system.source, `${range.from}_${range.to}`);
  mkdirSync(rawDir, { recursive: true });
  const saveRaw = (label, bytes) => writeFileSync(join(rawDir, `${label}.html`), bytes);

  const results = name === 'koji' ? await fetchKoji(session, system, saveRaw) : await fetchBuppin(session, system, saveRaw);

  db.exec('BEGIN');
  for (const row of results) upsert(row);
  db.exec('COMMIT');
  console.log(`[ppi] ${system.source}: ${results.length} 件を取り込み（リクエスト ${session.requestCount} 回）`);
}

const summary = db
  .prepare(
    `SELECT source, cft_issue_date, COUNT(*) AS n FROM cases
     WHERE source != 'kkj' AND cft_issue_date BETWEEN ? AND ? GROUP BY 1, 2 ORDER BY 1, 2`,
  )
  .all(range.from, range.to);
console.table(summary);
db.close();

// ---------------------------------------------------------------------------
// 建設工事・コンサル

async function fetchKoji(session, system, saveRaw) {
  const start = async () => {
    session.reset();
    const { html } = await session.get('KF001ShowAction');
    return parseOrgOptions(html);
  };
  let orgs = await start();
  if (args.org) orgs = orgs.filter((o) => args.org.split(',').includes(o.code));
  console.log(`[ppi] ${system.source}: 調達機関 ${orgs.length} 件 × 業務区分 ${system.supplyTypes.length}`);

  const out = [];
  for (const org of orgs) {
    for (const supply of system.supplyTypes) {
      const label = `${org.code}-${supply.code}`;
      const searchOnce = () => searchKoji(session, org, supply, label, saveRaw);
      let found;
      try {
        found = await searchOnce();
      } catch (err) {
        if (!(err instanceof PpiSessionError)) throw err;
        console.warn(`[ppi] ${org.name} ${supply.label}: ${err.message} → セッションを作り直して再試行`);
        await start();
        found = await searchOnce();
      }
      console.log(`[ppi]   ${org.name} ${supply.label}: ${found.length} 件`);
      for (const record of found) {
        out.push(toCaseRow(system.source, record, { category: supply.category, categoryRaw: supply.label, body: org.name }));
      }
    }
  }
  return out;
}

async function searchKoji(session, org, supply, label, saveRaw) {
  // 調達機関名などの日本語の hidden は表示用なので送らない（Shift_JIS で送る手段がないため）
  await session.post('KK000ShowAction', {
    hachukikan: org.code,
    bukyoku: '',
    kakakari: '',
    kasho_name: '',
    supplytype: supply.code,
    hachukikan_name: '',
  });
  const search = await session.post('KK301SearchAction', {
    A046: '',
    koujimei: '',
    koujibasho: '',
    date_start: range.from.replaceAll('-', '/'),
    date_end: range.to.replaceAll('-', '/'),
    A300: '040',
    perPage: '0',
    curPage: '0',
    recordnumstart: '0',
    recordnumend: '0',
    recordNum: '',
  });
  saveRaw(`${label}-search`, search.bytes);
  return readAllPages(session, search.html, { framePath: 'KFK301FrameShow', pagePath: 'KK301SearchAction', label, saveRaw });
}

// ---------------------------------------------------------------------------
// 物品・役務

async function fetchBuppin(session, system, saveRaw) {
  const searchAll = async () => {
    session.reset();
    await session.get('KF000ShowAction');
    // 調達機関「指定しない」＝全機関。業務区分 11 = 物品・役務
    await session.post('KK000ShowAction', { hachukikan: '', bukyoku: '', kakakari: '', kasho_name: '', supplytype: '11' });
    const form = await session.post('KB301ShowAction', { select_kikan: '' });
    const token = parseHiddenValue(form.html, 'screen_validate');
    if (!token) throw new Error('screen_validate が見つかりません（画面が変わった可能性）');

    const [fy, fm, fd] = range.from.split('-').map(Number);
    const [ty, tm, td] = range.to.split('-').map(Number);
    const search = await session.post('KB301SearchAction', {
      A046: '',
      koujimei: '',
      YEARBEGIN: String(fy),
      koukokubi_kaishi_tsuki: String(fm),
      koukokubi_kaishi_nichi: String(fd),
      YEAREND: String(ty),
      koukokubi_owari_tsuki: String(tm),
      koukokubi_owari_nichi: String(td),
      koukokubi_kaishi: `${fy}/${fm}/${fd}`,
      koukokubi_owari: `${ty}/${tm}/${td}`,
      A300: '040',
      perPage: '0',
      curPage: '0',
      recordnumstart: '0',
      recordnumend: '0',
      recordNum: '',
      screen_validate: token,
      searchflg: '1',
      postconv_flg: '1',
    });
    saveRaw('all-11-search', search.bytes);
    return readAllPages(session, search.html, { framePath: 'KFB301FrameShow', pagePath: 'KB301SearchAction', label: 'all-11', saveRaw });
  };

  let found;
  try {
    found = await searchAll();
  } catch (err) {
    if (!(err instanceof PpiSessionError)) throw err;
    console.warn(`[ppi] ${err.message} → セッションを作り直して再試行`);
    found = await searchAll();
  }
  return found.map((record) => {
    const categoryRaw = record.fields.category_raw ?? null;
    const body = record.fields.organization_name?.split(' ')[0];
    return toCaseRow(system.source, record, { category: BUPPIN_CATEGORY[categoryRaw] ?? null, categoryRaw, body });
  });
}

// ---------------------------------------------------------------------------
// 共通

/** 検索結果の全ページを読み、見出しで列を対応づけた { controlNo, fields } を返す */
async function readAllPages(session, searchHtml, { framePath, pagePath, label, saveRaw }) {
  const total = parseRecordNum(searchHtml);
  if (total === undefined) throw new Error(`${label}: 検索結果の件数が読めません（画面が変わった可能性）`);
  if (total === 0) return [];

  const headers = parseListHeaders(searchHtml);
  const fieldNames = headers.map((h) => FIELD_BY_HEADER[h]);
  const unknown = headers.filter((h) => !FIELD_BY_HEADER[h]);
  if (unknown.length > 0) console.warn(`[ppi] ${label}: 未対応の見出し ${unknown.join(', ')}（無視します）`);

  const records = [];
  const pageCount = Math.ceil(total / PER_PAGE);
  for (let page = 1; page <= pageCount; page++) {
    if (page > 1) await session.get(`${pagePath}?page=${page}`);
    const frame = await session.get(framePath);
    saveRaw(`${label}-frame-p${page}`, frame.bytes);
    for (const row of parseResultRows(frame.html)) {
      if (row.cells.length !== headers.length) {
        console.warn(`[ppi] ${label}: 列数が見出しと合わない行をスキップ（${row.controlNo}）`);
        continue;
      }
      const fields = {};
      row.cells.forEach((value, i) => {
        if (fieldNames[i]) fields[fieldNames[i]] = blankToNull(value);
      });
      records.push({ controlNo: row.controlNo, fields });
    }
  }
  if (records.length !== total) console.warn(`[ppi] ${label}: 件数 ${total} に対して ${records.length} 行しか読めませんでした`);
  return records;
}

function toCaseRow(source, { controlNo, fields }, { category, categoryRaw, body }) {
  const city = findCity(body, fields.location);
  return {
    id: caseId(source, controlNo),
    source,
    source_key: controlNo,
    project_name: fields.project_name ?? '(件名なし)',
    organization_name: fields.organization_name,
    lg_code: LG_CODE,
    prefecture_name: PREFECTURE_NAME,
    city_code: city?.code ?? null,
    city_name: city?.name ?? null,
    category,
    category_raw: categoryRaw,
    procedure_type: fields.procedure_type,
    cft_issue_date: toIsoDate(fields.cft_issue_date),
    opening_tenders_event: toIsoDate(fields.opening_tenders_event),
    location: fields.location,
    description: fields.description,
    case_number: fields.case_number,
    estimated_price: toYen(fields.estimated_price),
    work_type: fields.work_type,
    fetched_at: fetchedAt,
  };
}

/**
 * 市区町村：発注者が市町村ならその市町村。県の案件は工事場所に市町村名があればそれを使う
 * （「つくばみらい市」を「つくば市」と取り違えないよう、長い名前から照合する）
 */
function findCity(body, location) {
  const byName = areas.find((a) => a.name === body);
  if (byName) return byName;
  if (!location) return null;
  return [...areas].sort((a, b) => b.name.length - a.name.length).find((a) => location.includes(a.name)) ?? null;
}

function blankToNull(value) {
  const v = value?.trim();
  return !v || v === '-' ? null : v;
}

function toIsoDate(value) {
  const m = value?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

// 「11,352,000」→ 11352000。「*********」（非公表）や空は NULL
function toYen(value) {
  if (!value || !/^[\d,]+$/.test(value)) return null;
  return Number(value.replaceAll(',', ''));
}

/** --from/--to が無ければ、今日を除く直近 N 平日（祝日は考慮しない） */
function resolveRange({ from, to, days }) {
  if (from || to) {
    if (!from || !to) throw new Error('--from と --to は両方指定してください');
    return { from, to };
  }
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const weekdays = [];
  for (let d = addDays(today, -1); weekdays.length < Number(days); d = addDays(d, -1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) weekdays.push(d);
  }
  return { from: weekdays.at(-1), to: weekdays[0] };
}

function addDays(ymd, delta) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
