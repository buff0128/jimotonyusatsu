// 手元 SQLite（正本）から D1 へ、前回の同期から変わった分だけを送る（差分同期）
//
//   node scripts/sync-d1.mjs              # リモート D1（差分）
//   node scripts/sync-d1.mjs --local      # wrangler dev 用のローカル D1（差分）
//   node scripts/sync-d1.mjs --full       # 前回の記録を無視して全件を送り直す
//   node scripts/sync-d1.mjs --dry-run    # SQL を書き出すだけ（送らない・記録しない）
//   node scripts/sync-d1.mjs --seed       # 一度だけ使う：今の D1 が手元と同じ前提で記録を作る（下記）
//
// 送るもの（サイトに出してよい取得元 = kkj の案件だけ）
//   cases             … 変わった列だけ UPDATE（新しい行は INSERT）。D1 では description は NULL、effective_deadline を計算して入れる
//   case_descriptions … 公告文が変わった案件だけ、消してから分割して入れ直す
//   case_ai           … 変わった行を upsert
//   case_tags         … タグの組み合わせが変わった案件だけ、消してから入れ直す
//   case_awards       … 落札結果（調達案件番号で照合できたものだけ）。組み合わせが変わった案件だけ入れ直す
//   case_labels       … 参加しやすさのラベル（src/lib/labels.ts のルール）。組み合わせが変わった案件だけ入れ直す
//   case_counts / org_stats / org_insights / area_tag_insights … 同期のたびに計算し、変わった行だけ upsert、無くなった行は削除
//     （統計は過去12か月。過去分 cases_history は手元だけにあり、D1 には集計結果だけを送る）
//   手元から消えた案件は D1 からも消す（外部キーで case_ai などもまとめて消える）
//
// 「前回送った内容」は手元 SQLite の d1_sync_state に、送り先（local / remote）ごとに記録する。
// D1 の無料枠（1日の書き込み10万行）に配慮して、変わっていない列は送らない（インデックスの書き込みも増やさない）。
// SQL は BATCH_STATEMENTS 文ずつのファイルに分けて実行し、成功したファイルの分だけ記録を進める
// （上限などで途中で失敗しても、次回はその続きから送れる）。
//
// --seed：差分同期を入れる前に全件同期した D1 向け。cases（description と effective_deadline を除く）と case_tags は
// 「手元の今の値を送り済み」として記録し、それ以外（公告文・AI・集計）は未送信として扱う。
//
// areas はマイグレーションで投入するので対象外。先に pnpm db:migrate:remote / db:migrate:local を済ませること。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR, ROOT, openLocalDb } from './lib/local-db.mjs';
import { splitDescription } from './lib/description-chunks.mjs';
import { computeCounts, effectiveDeadline } from './lib/case-counts.mjs';
import { MIN_COVERAGE, computeInsights } from './lib/stats.mjs';
import { computeLabels } from '../src/lib/labels.ts';

const D1_DATABASE = 'jimotonyusatsu';
const SITE_URL = 'https://jimotonyusatsu.jp';
const MAX_STATEMENT_BYTES = 100_000; // D1 の1ステートメント上限
const BATCH_STATEMENTS = 3000;
// サイトに出してよい取得元だけを同期する。茨城県PPI（ibaraki_ppi_*）は利用規約の確認が済むまで入れない
const PUBLISHED_SOURCES = ['kkj'];
const IN_SOURCES = `IN (${PUBLISHED_SOURCES.map(() => '?').join(', ')})`;
const UNKNOWN = '\u0000unknown'; // --seed で「D1 の値が分からない」列に入れる印

const { values: args } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    seed: { type: 'boolean', default: false },
  },
});
const target = args.local ? 'local' : 'remote';

const db = openLocalDb();
db.exec(`CREATE TABLE IF NOT EXISTS d1_sync_state (
  target TEXT NOT NULL, tbl TEXT NOT NULL, key TEXT NOT NULL, snapshot TEXT NOT NULL,
  PRIMARY KEY (target, tbl, key))`);

if (args.seed) {
  seedState();
  db.close();
  process.exit(0);
}

const previous = args.full ? new Map() : loadState();
const units = []; // { statements: string[], state: [tbl, key, snapshot|null][] }  null = 記録を消す
const stats = {};
const count = (name) => (stats[name] = (stats[name] ?? 0) + 1);

planCases();
planCaseAi();
planCaseAwards();
const { counts, orgs } = computeCounts(db, PUBLISHED_SOURCES);
planDerived('case_counts', counts, (r) => `${r.dim}|${r.lg_code}|${r.value}`, ['dim', 'lg_code', 'value'], (key) => {
  const [dim, lg, value] = key.split('|');
  return `DELETE FROM case_counts WHERE dim = ${sqlLiteral(dim)} AND lg_code = ${sqlLiteral(lg)} AND value = ${sqlLiteral(value)};`;
});
planDerived('org_stats', orgs, (r) => r.org_id, ['org_id'], (key) => `DELETE FROM org_stats WHERE org_id = ${sqlLiteral(key)};`);
const insights = computeInsights(db, { orgIds: new Set(orgs.map((o) => o.org_id)), sources: PUBLISHED_SOURCES });
// 過去分の取得が終わっていない（期間の取得率が MIN_COVERAGE 未満）ときは、途中の数字を出さないよう統計を送らない
const insightsReady = insights.coverage >= MIN_COVERAGE;
console.log(`[sync] 統計の期間 ${insights.months[0]}〜${insights.months.at(-1)}：取得率 ${(insights.coverage * 100).toFixed(1)}%${insightsReady ? '' : `（${MIN_COVERAGE * 100}% 未満のため統計は送らない）`}`);
if (insightsReady) planInsights(insights);

function planInsights(insights) {
planDerived('org_insights', insights.orgs, (r) => r.org_id, ['org_id'], (key) => `DELETE FROM org_insights WHERE org_id = ${sqlLiteral(key)};`);
planDerived('area_tag_insights', insights.areaTags, (r) => `${r.lg_code}|${r.tag}`, ['lg_code', 'tag'], (key) => {
  const [lg, tag] = key.split('|');
  return `DELETE FROM area_tag_insights WHERE lg_code = ${sqlLiteral(lg)} AND tag = ${sqlLiteral(tag)};`;
});
}

if (units.length === 0) {
  console.log(`[sync] ${target}: 変更なし`);
  db.close();
  process.exit(0);
}
units.push({
  statements: [`INSERT INTO site_meta (key, value) VALUES ('data_version', '${new Date().toISOString()}') ON CONFLICT (key) DO UPDATE SET value = excluded.value;`],
  state: [],
});
console.log(`[sync] ${target}${args.full ? '（全件）' : '（差分）'}:`, stats);

const batches = toBatches(units);
const dir = join(DATA_DIR, 'd1-sync');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
batches.forEach((batch, i) => writeFileSync(batchPath(i), batch.statements.join('\n') + '\n'));
console.log(`[sync] ${batches.length} ファイル・${batches.reduce((n, b) => n + b.statements.length, 0)} 文を ${dir} に書き出し`);
if (args['dry-run']) {
  db.close();
  process.exit(0);
}

const saveState = db.prepare(`INSERT INTO d1_sync_state (target, tbl, key, snapshot) VALUES (?, ?, ?, ?)
  ON CONFLICT (target, tbl, key) DO UPDATE SET snapshot = excluded.snapshot`);
const dropState = db.prepare('DELETE FROM d1_sync_state WHERE target = ? AND tbl = ? AND key = ?');
for (const [i, batch] of batches.entries()) {
  console.log(`[sync] ${i + 1}/${batches.length}（${batch.statements.length} 文）`);
  execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', D1_DATABASE, args.local ? '--local' : '--remote', '--file', batchPath(i), '--yes'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  db.exec('BEGIN');
  for (const [tbl, key, snapshot] of batch.state) {
    if (snapshot === null) dropState.run(target, tbl, key);
    else saveState.run(target, tbl, key, snapshot);
  }
  db.exec('COMMIT');
}
db.close();
console.log('[sync] 完了');
if (!args.local) await purgeEdgeCache();

// ---------------------------------------------------------------------------
// 何を送るかを決める

function planCases() {
  const rows = db
    .prepare(`SELECT c.*, ai.extracted AS ai_extracted FROM cases c LEFT JOIN case_ai ai ON ai.case_id = c.id WHERE c.source ${IN_SOURCES}`)
    .all(...PUBLISHED_SOURCES);
  const tagsOf = groupTags();
  const seen = new Set();

  for (const { ai_extracted, ...row } of rows) {
    seen.add(row.id);
    const d1Row = { ...row, description: null, effective_deadline: effectiveDeadline(row.tender_submission_deadline, ai_extracted) };
    const before = previous.get(`cases\t${row.id}`);
    if (!before) {
      push('cases', row.id, [toUpsert('cases', d1Row, ['id'])], JSON.stringify(d1Row));
      count('cases 追加');
    } else {
      const old = JSON.parse(before);
      const changed = Object.keys(d1Row).filter((c) => old[c] !== d1Row[c]);
      if (changed.length > 0) {
        const sets = changed.map((c) => `${c} = ${sqlLiteral(d1Row[c])}`).join(', ');
        push('cases', row.id, [checkSize(`UPDATE cases SET ${sets} WHERE id = ${sqlLiteral(row.id)};`)], JSON.stringify(d1Row));
        count('cases 更新');
      }
    }

    // 公告文：分割して入れ直す（内容のハッシュで比較）
    const descriptionHash = hash(row.description ?? '');
    if (previous.get(`case_descriptions\t${row.id}`) !== descriptionHash) {
      const statements = [`DELETE FROM case_descriptions WHERE case_id = ${sqlLiteral(row.id)};`];
      splitDescription(row.description).forEach((text, seq) =>
        statements.push(checkSize(`INSERT INTO case_descriptions (case_id, seq, text) VALUES (${sqlLiteral(row.id)}, ${seq}, ${sqlLiteral(text)});`)),
      );
      push('case_descriptions', row.id, statements, descriptionHash);
      count('公告文');
    }

    // 業種タグ：組み合わせが変わった案件だけ入れ直す
    const tags = tagsOf.get(row.id) ?? [];
    const tagsKey = tags.map((t) => `${t.tag}:${t.method}`).join(',');
    if ((previous.get(`case_tags\t${row.id}`) ?? '') !== tagsKey || !previous.has(`case_tags\t${row.id}`)) {
      push('case_tags', row.id, [
        `DELETE FROM case_tags WHERE case_id = ${sqlLiteral(row.id)};`,
        ...tags.map((t) => `INSERT INTO case_tags (case_id, tag, method) VALUES (${sqlLiteral(row.id)}, ${sqlLiteral(t.tag)}, ${sqlLiteral(t.method)});`),
      ], tagsKey);
      count('業種タグ');
    }

    // 参加しやすさのラベル：AI の抽出値にルールを当てはめる
    const labels = computeLabels(ai_extracted ? JSON.parse(ai_extracted) : null);
    const labelsKey = labels.join(',');
    if ((previous.get(`case_labels\t${row.id}`) ?? '') !== labelsKey || (labels.length > 0 && !previous.has(`case_labels\t${row.id}`))) {
      push('case_labels', row.id, [
        `DELETE FROM case_labels WHERE case_id = ${sqlLiteral(row.id)};`,
        ...labels.map((l) => `INSERT INTO case_labels (case_id, label) VALUES (${sqlLiteral(row.id)}, ${sqlLiteral(l)});`),
      ], labelsKey);
      count('ラベル');
    }
  }

  // 手元から消えた（または非公開になった）案件は D1 からも消す
  for (const key of previous.keys()) {
    const [tbl, id] = key.split('\t');
    if (tbl !== 'cases' || seen.has(id)) continue;
    units.push({
      statements: [`DELETE FROM cases WHERE id = ${sqlLiteral(id)};`],
      state: ['cases', 'case_descriptions', 'case_tags', 'case_ai', 'case_labels', 'case_awards'].map((t) => [t, id, null]),
    });
    count('cases 削除');
  }
}

function planCaseAi() {
  const rows = db
    .prepare(`SELECT a.* FROM case_ai a JOIN cases c ON c.id = a.case_id WHERE c.source ${IN_SOURCES}`)
    .all(...PUBLISHED_SOURCES);
  for (const row of rows) {
    const snapshot = JSON.stringify(row);
    if (previous.get(`case_ai\t${row.case_id}`) === snapshot) continue;
    push('case_ai', row.case_id, [toUpsert('case_ai', row, ['case_id'])], snapshot);
    count('case_ai');
  }
}

function planCaseAwards() {
  const rows = db
    .prepare(
      `SELECT m.case_id, a.procurement_item_no, a.corporation_no, a.winner_name, a.award_price, a.award_date
       FROM case_award_matches m JOIN awards a ON a.procurement_item_no = m.procurement_item_no
       JOIN cases c ON c.id = m.case_id
       WHERE m.method = 'number' AND c.source ${IN_SOURCES} ORDER BY m.case_id, a.corporation_no`,
    )
    .all(...PUBLISHED_SOURCES);
  const byCase = Map.groupBy(rows, (r) => r.case_id);
  for (const [caseId, list] of byCase) {
    const snapshot = JSON.stringify(list);
    if (previous.get(`case_awards\t${caseId}`) === snapshot) continue;
    push('case_awards', caseId, [
      `DELETE FROM case_awards WHERE case_id = ${sqlLiteral(caseId)};`,
      ...list.map((r) => toUpsert('case_awards', r, ['case_id', 'corporation_no'])),
    ], snapshot);
    count('落札結果');
  }
  for (const key of previous.keys()) {
    const [tbl, caseId] = key.split('\t');
    if (tbl !== 'case_awards' || byCase.has(caseId)) continue;
    units.push({ statements: [`DELETE FROM case_awards WHERE case_id = ${sqlLiteral(caseId)};`], state: [['case_awards', caseId, null]] });
    count('落札結果 削除');
  }
}

/** 毎回計算し直す表：変わった行は upsert、前回あって今回無い行は削除 */
function planDerived(tbl, rows, keyOf, primaryKey, toDelete) {
  const seen = new Set();
  for (const row of rows) {
    const key = keyOf(row);
    seen.add(key);
    const snapshot = JSON.stringify(row);
    if (previous.get(`${tbl}\t${key}`) === snapshot) continue;
    push(tbl, key, [toUpsert(tbl, row, primaryKey)], snapshot);
    count(tbl);
  }
  for (const prevKey of previous.keys()) {
    const [t, key] = prevKey.split('\t');
    if (t !== tbl || seen.has(key)) continue;
    units.push({ statements: [toDelete(key)], state: [[tbl, key, null]] });
    count(`${tbl} 削除`);
  }
}

function groupTags() {
  const map = new Map();
  for (const t of db.prepare('SELECT case_id, tag, method FROM case_tags ORDER BY case_id, tag').all()) {
    if (!map.has(t.case_id)) map.set(t.case_id, []);
    map.get(t.case_id).push(t);
  }
  return map;
}

function push(tbl, key, statements, snapshot) {
  units.push({ statements, state: [[tbl, key, snapshot]] });
}

// ---------------------------------------------------------------------------
// 記録

function loadState() {
  const map = new Map();
  for (const r of db.prepare('SELECT tbl, key, snapshot FROM d1_sync_state WHERE target = ?').iterate(target)) {
    map.set(`${r.tbl}\t${r.key}`, r.snapshot);
  }
  return map;
}

function seedState() {
  const save = db.prepare('INSERT INTO d1_sync_state (target, tbl, key, snapshot) VALUES (?, ?, ?, ?)');
  const rows = db.prepare(`SELECT * FROM cases WHERE source ${IN_SOURCES}`).all(...PUBLISHED_SOURCES);
  const tagsOf = groupTags();
  db.exec('BEGIN');
  db.prepare('DELETE FROM d1_sync_state WHERE target = ?').run(target);
  for (const row of rows) {
    save.run(target, 'cases', row.id, JSON.stringify({ ...row, description: UNKNOWN, effective_deadline: UNKNOWN }));
    save.run(target, 'case_tags', row.id, (tagsOf.get(row.id) ?? []).map((t) => `${t.tag}:${t.method}`).join(','));
  }
  db.exec('COMMIT');
  console.log(`[sync] ${target}: ${rows.length} 件を「cases と業種タグは送信済み」として記録しました（公告文・AI・集計は次回の同期で送ります）`);
}

// ---------------------------------------------------------------------------
// SQL

function toBatches(list) {
  const batches = [];
  let current = { statements: [], state: [] };
  for (const unit of list) {
    if (current.statements.length > 0 && current.statements.length + unit.statements.length > BATCH_STATEMENTS) {
      batches.push(current);
      current = { statements: [], state: [] };
    }
    current.statements.push(...unit.statements);
    current.state.push(...unit.state);
  }
  if (current.statements.length > 0) batches.push(current);
  return batches;
}

function batchPath(i) {
  return join(DATA_DIR, 'd1-sync', `${String(i + 1).padStart(3, '0')}.sql`);
}

function toUpsert(table, row, primaryKey) {
  const columns = Object.keys(row);
  const updates = columns.filter((c) => !primaryKey.includes(c)).map((c) => `${c} = excluded.${c}`);
  const conflict = updates.length > 0 ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING';
  return checkSize(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => sqlLiteral(row[c])).join(', ')}) ON CONFLICT (${primaryKey.join(', ')}) ${conflict};`,
  );
}

/** D1 の上限を超える文は、途中で失敗させずに同期の前に止める */
function checkSize(sql) {
  const bytes = Buffer.byteLength(sql);
  if (bytes > MAX_STATEMENT_BYTES) throw new Error(`D1 の1ステートメント上限を超えます（${bytes} バイト）: ${sql.slice(0, 120)}…`);
  return sql;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

// ---------------------------------------------------------------------------

/**
 * 同期した内容がすぐ出るように、エッジキャッシュを消す（src/pages/api/cache-purge.ts）。
 * トークンは .dev.vars の CACHE_PURGE_TOKEN と、リモートの secret（wrangler secret put CACHE_PURGE_TOKEN）に同じ値を置く
 */
async function purgeEdgeCache() {
  const token = readDevVar('CACHE_PURGE_TOKEN');
  if (!token) {
    console.warn('[sync] .dev.vars に CACHE_PURGE_TOKEN が無いので、キャッシュは消していません（最大1時間、古い表示が残ります）');
    return;
  }
  for (const base of [SITE_URL]) {
    try {
      const res = await fetch(`${base}/api/cache-purge`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const body = (await res.text()).slice(0, 200);
      if (res.ok) console.log(`[sync] キャッシュを消去しました（${base}）: ${body}`);
      else console.warn(`[sync] キャッシュの消去に失敗（${base}）: HTTP ${res.status} ${body}（secret の CACHE_PURGE_TOKEN を確認。最大1時間、古い表示が残ります）`);
    } catch (error) {
      console.warn(`[sync] キャッシュの消去に失敗（${base}）: ${error instanceof Error ? error.message : error}`);
    }
  }
}

function readDevVar(name) {
  const path = join(ROOT, '.dev.vars');
  if (!existsSync(path)) return undefined;
  return readFileSync(path, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
}
