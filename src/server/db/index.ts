import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const sqlite = new Database(path.join(dataDir, "starshot.sqlite"));
export const db = drizzle(sqlite, { schema });

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export function migrate() {
  const migrationPath = path.join(__dirname, "migration.sql");
  sqlite.exec(fs.readFileSync(migrationPath, "utf8"));
  ensureGithubRepoColumns();
  ensureSyncRunColumns();
}

function ensureGithubRepoColumns() {
  const existing = new Set(
    sqlite.prepare("PRAGMA table_info(github_repos)").all().map((column) => (column as { name: string }).name)
  );
  const columns: Array<[string, string]> = [
    ["owner_login", "TEXT"],
    ["html_url", "TEXT"],
    ["homepage", "TEXT"],
    ["language", "TEXT"],
    ["forks_count", "INTEGER"],
    ["open_issues_count", "INTEGER"],
    ["updated_at", "TEXT"],
    ["pushed_at", "TEXT"],
    ["latest_commit_sha", "TEXT"],
    ["latest_commit_url", "TEXT"],
    ["latest_commit_message", "TEXT"],
    ["latest_commit_author_login", "TEXT"],
    ["latest_commit_author_avatar_url", "TEXT"],
    ["latest_commit_author_url", "TEXT"],
    ["latest_commit_author_name", "TEXT"],
    ["latest_commit_at", "TEXT"]
  ];

  for (const [name, type] of columns) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE github_repos ADD COLUMN ${name} ${type}`);
  }
}

function ensureSyncRunColumns() {
  const existing = new Set(
    sqlite.prepare("PRAGMA table_info(sync_runs)").all().map((column) => (column as { name: string }).name)
  );
  if (!existing.has("mode")) {
    sqlite.exec("ALTER TABLE sync_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'smart'");
  }
  ensureSyncRunModeConstraint();
}

function ensureSyncRunModeConstraint() {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_runs'")
    .get() as { sql: string } | undefined;
  if (!row?.sql.includes("CHECK(mode IN") || (row.sql.includes("'clear'") && !row.sql.includes("'quick'"))) return;

  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.exec(`
      BEGIN;

      CREATE TABLE sync_runs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        mode TEXT NOT NULL DEFAULT 'smart' CHECK(mode IN ('smart', 'full', 'profiles', 'clear')),
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'success', 'error')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        scanned_count INTEGER NOT NULL DEFAULT 0,
        active_count INTEGER NOT NULL DEFAULT 0,
        removed_count INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO sync_runs_new (
        id, user_id, source_id, mode, status, started_at, finished_at, error, scanned_count, active_count, removed_count
      )
      SELECT id, user_id, source_id, CASE WHEN mode = 'quick' THEN 'smart' ELSE COALESCE(mode, 'smart') END, status, started_at, finished_at, error, scanned_count, active_count, removed_count
      FROM sync_runs;

      DROP TABLE sync_runs;
      ALTER TABLE sync_runs_new RENAME TO sync_runs;

      COMMIT;
    `);
  } catch (error) {
    if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
    throw error;
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}
