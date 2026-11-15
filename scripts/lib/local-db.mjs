// 手元の SQLite（正本）を開き、D1 と同じ migrations/*.sql を未適用分だけ流す
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orgId } from './cases-repo.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = join(ROOT, 'data');
export const LOCAL_DB_PATH = join(DATA_DIR, 'jimoto.sqlite');
const MIGRATIONS_DIR = join(ROOT, 'migrations');

export function openLocalDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(LOCAL_DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  applyMigrations(db);
  applyLocalOnlySchema(db);
  backfillOrgIds(db);
  return db;
}

function applyMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
      db.exec('COMMIT');
      console.log(`[local-db] applied ${file}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

// D1 には持たせない、取得処理の記録用テーブル
function applyLocalOnlySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fetch_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      lg_code      TEXT NOT NULL,
      issue_date   TEXT NOT NULL,
      search_hits  INTEGER,
      returned     INTEGER,
      raw_path     TEXT,
      status       TEXT NOT NULL,   -- ok / error
      error        TEXT,
      fetched_at   TEXT NOT NULL
    );

    -- 統計用の過去分（官公需API、過去12か月）。サイトには出さず、D1 にも送らない（scripts/fetch-kkj-history.mjs）
    -- 統計に使う列だけを持つ（公告文・添付は持たない）
    CREATE TABLE IF NOT EXISTS cases_history (
      id                          TEXT PRIMARY KEY,   -- cases と同じ作り方（sha256(Key) の先頭16桁）
      project_name                TEXT NOT NULL,
      organization_name           TEXT,
      org_id                      TEXT,
      lg_code                     TEXT NOT NULL,
      city_code                   TEXT,
      category                    TEXT,
      procedure_type              TEXT,
      certification               TEXT,
      cft_issue_date              TEXT,
      tender_submission_deadline  TEXT,
      opening_tenders_event       TEXT,
      fetched_at                  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cases_history_org ON cases_history (org_id, cft_issue_date);
    CREATE INDEX IF NOT EXISTS idx_cases_history_lg_issue ON cases_history (lg_code, cft_issue_date);

    -- 調達ポータルの落札実績オープンデータ（scripts/fetch-awards.mjs）。複数者落札は事業者ごとに1行
    CREATE TABLE IF NOT EXISTS awards (
      procurement_item_no TEXT NOT NULL,   -- 調達案件番号（19桁）
      corporation_no      TEXT NOT NULL,   -- 法人番号（無ければ ''）
      item_name           TEXT,
      award_date          TEXT,
      award_price         INTEGER,         -- 落札金額（円）
      ministry_cd         TEXT,
      bidding_method_cd   TEXT,
      winner_name         TEXT,
      source_file         TEXT NOT NULL,
      PRIMARY KEY (procurement_item_no, corporation_no)
    );

    -- 過去分の取得の進み具合（途中再開用）
    CREATE TABLE IF NOT EXISTS history_runs (
      lg_code     TEXT NOT NULL,
      issue_date  TEXT NOT NULL,
      search_hits INTEGER,
      returned    INTEGER,
      status      TEXT NOT NULL,   -- ok / error
      error       TEXT,
      fetched_at  TEXT NOT NULL,
      PRIMARY KEY (lg_code, issue_date)
    );
  `);
}

// 0004 より前に取り込んだ行の org_id を埋める
function backfillOrgIds(db) {
  db.function('make_org_id', { deterministic: true }, (name) => orgId(name));
  db.exec('UPDATE cases SET org_id = make_org_id(organization_name) WHERE org_id IS NULL AND organization_name IS NOT NULL');
}
