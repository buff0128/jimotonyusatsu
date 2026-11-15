// 全国の都道府県・市区町村のスラッグ（ローマ字）を作り、migrations/0005_seed_all_areas.sql を書き出す
//
//   curl -L -o data/sources/geolonia-latest.csv \
//     https://raw.githubusercontent.com/geolonia/japanese-addresses/develop/data/latest.csv
//   node scripts/build-areas.mjs data/sources/geolonia-latest.csv
//
// ローマ字の出典：Geolonia 住所データ（CC BY 4.0）。同データのローマ字は日本郵便「郵便番号データ（ローマ字）」由来。
// 例 "MITO SHI" → mito、"ISHIKARI GUN TOBETSU CHO" → tobetsu、"SAPPORO SHI CHUO KU" → 札幌市（sapporo）
//
// - 政令指定都市は区ではなく市を1行にする（官公需APIの CityCode が市のコードのため）
// - 同じ都道府県内でスラッグが重なるときは、重なった全員に種別（-shi / -machi など）を付ける
// - 茨城県は 0002 で投入済み。既存の行は INSERT OR IGNORE で変えない（URL を変えないため）
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/local-db.mjs';

const csvPath = process.argv[2];
if (!csvPath) throw new Error('使い方: node scripts/build-areas.mjs <geolonia latest.csv>');

// 政令指定都市（2026年時点の20市）。区のデータから市の行を作る
const DESIGNATED_CITIES = {
  札幌市: '01100', 仙台市: '04100', さいたま市: '11100', 千葉市: '12100', 横浜市: '14100', 川崎市: '14130',
  相模原市: '14150', 新潟市: '15100', 静岡市: '22100', 浜松市: '22130', 名古屋市: '23100', 京都市: '26100',
  大阪市: '27100', 堺市: '27140', 神戸市: '28100', 岡山市: '33100', 広島市: '34100', 北九州市: '40100',
  福岡市: '40130', 熊本市: '43100',
};
// /{pref}/{slug} で種別・業種と重なるスラッグ（src/lib/categories.ts、src/pages/[pref]/）
const RESERVED_SLUGS = new Set(['buppin', 'koji', 'ekimu', 'gyoshu', 'orgs']);
const SUFFIXES = new Set(['SHI', 'KU', 'MACHI', 'CHO', 'MURA', 'SON']);
// 日本郵便の表記（撥音を m で書く）と、県が使う表記が違うもの
const PREF_SLUG_OVERRIDES = { '10': 'gunma' };

const prefs = new Map(); // code → { name, romaji }
const cities = new Map(); // code → { lgCode, name, romaji }
for (const line of readFileSync(csvPath, 'utf8').split('\n').slice(1)) {
  if (!line) continue;
  const [prefCode, prefName, , prefRomaji, cityCode, cityName, , cityRomaji] = parseCsvLine(line);
  prefs.set(prefCode, { name: prefName, romaji: prefRomaji });

  const ward = cityName.match(/^(.+?市)(.+区)$/);
  if (ward && DESIGNATED_CITIES[ward[1]]) {
    const code = DESIGNATED_CITIES[ward[1]];
    const romaji = cityRomaji.replace(/\s+\S+\s+KU$/, ''); // "SAPPORO SHI CHUO KU" → "SAPPORO SHI"
    cities.set(code, { lgCode: prefCode, name: ward[1], romaji });
  } else {
    cities.set(cityCode, { lgCode: prefCode, name: cityName, romaji: cityRomaji });
  }
}

const existing = readExistingSlugs();
const sql = [
  '-- 全国の都道府県・市区町村（scripts/build-areas.mjs で生成。手で編集しない）',
  '-- ローマ字：Geolonia 住所データ（CC BY 4.0、日本郵便「郵便番号データ（ローマ字）」由来）',
  '-- 茨城県（0002 で投入済み）は INSERT OR IGNORE でそのまま残す',
];

for (const [code, pref] of [...prefs].sort()) {
  const slug = PREF_SLUG_OVERRIDES[code] ?? pref.romaji.replace(/\s+(KEN|TO|FU)$/, '').toLowerCase();
  sql.push(insert(code, code, 'pref', pref.name, slug, Number(code)));
}

const report = { cities: 0, suffixed: [], existingDiff: [] };
const byPref = Map.groupBy([...cities].sort(), ([, c]) => c.lgCode);
for (const [lgCode, entries] of byPref) {
  const parsed = entries.map(([code, c]) => ({ code, ...c, ...splitRomaji(c.romaji) }));
  const counts = new Map();
  for (const c of parsed) counts.set(c.base, (counts.get(c.base) ?? 0) + 1);

  parsed.forEach((c, index) => {
    let slug = c.base;
    if (counts.get(c.base) > 1 || RESERVED_SLUGS.has(c.base)) {
      slug = `${c.base}-${c.suffix}`;
      report.suffixed.push(`${c.name}→${slug}`);
    }
    const old = existing.get(c.code);
    if (old && old !== slug) report.existingDiff.push(`${c.name}: 既存 ${old} / 生成 ${slug}（既存を維持）`);
    sql.push(insert(c.code, lgCode, 'city', c.name, old ?? slug, index + 1));
    report.cities++;
  });
}

const outPath = join(ROOT, 'migrations', '0005_seed_all_areas.sql');
writeFileSync(outPath, sql.join('\n') + '\n');
console.log(`[areas] 都道府県 ${prefs.size} / 市区町村 ${report.cities} → ${outPath}`);
console.log(`[areas] 種別を付けたスラッグ（${report.suffixed.length}）: ${report.suffixed.join('、')}`);
console.log(`[areas] 既存（茨城）との違い（${report.existingDiff.length}）: ${report.existingDiff.join('、')}`);

// ---------------------------------------------------------------------------

/** "ISHIKARI GUN TOBETSU CHO" → { base: 'tobetsu', suffix: 'cho' } */
function splitRomaji(romaji) {
  let tokens = romaji.trim().split(/\s+/);
  const gun = tokens.indexOf('GUN');
  if (gun >= 0) tokens = tokens.slice(gun + 1);
  const last = tokens.at(-1);
  const suffix = SUFFIXES.has(last) ? last.toLowerCase() : '';
  if (suffix) tokens = tokens.slice(0, -1);
  return { base: tokens.join('').toLowerCase().replace(/[^a-z0-9]/g, ''), suffix: suffix || 'x' };
}

function readExistingSlugs() {
  const text = readFileSync(join(ROOT, 'migrations', '0002_seed_ibaraki_areas.sql'), 'utf8');
  return new Map([...text.matchAll(/VALUES \('(\d{5})', '\d+', 'city', '[^']+', '([^']+)'/g)].map((m) => [m[1], m[2]]));
}

function insert(code, lgCode, kind, name, slug, sort) {
  const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
  return `INSERT OR IGNORE INTO areas (code, lg_code, kind, name, slug, sort) VALUES (${q(code)}, ${q(lgCode)}, ${q(kind)}, ${q(name)}, ${q(slug)}, ${sort});`;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
