import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Opens the SQLite database and brings its schema up to date.
 * Plain ESM (no "server-only") because scripts/create-admin.mjs shares it with the app.
 */
const SCHEMA_VERSION = 1;

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS transfers (
    id            TEXT PRIMARY KEY,
    file_name     TEXT NOT NULL,
    analysed_at   INTEGER NOT NULL,          -- epoch milliseconds
    sender        TEXT,
    sender_folded TEXT,                      -- lower-case, accent-free copy used for searching
    amount        REAL,
    currency      TEXT,
    date          TEXT,                      -- operation date, YYYY-MM-DD
    needs_review  INTEGER NOT NULL DEFAULT 0,
    warnings      TEXT NOT NULL DEFAULT '[]' -- JSON array of warning codes
  );
  CREATE INDEX IF NOT EXISTS idx_transfers_date        ON transfers(date);
  CREATE INDEX IF NOT EXISTS idx_transfers_sender      ON transfers(sender_folded);
  CREATE INDEX IF NOT EXISTS idx_transfers_analysed_at ON transfers(analysed_at);
`;

const ROLES_SCHEMA = `
  CREATE TABLE users (
    id                   TEXT PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name         TEXT NOT NULL,
    role                 TEXT NOT NULL CHECK (role IN ('admin','employee')),
    password_hash        TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0,1)),
    is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    last_login_at        INTEGER
  );

  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE login_throttle (
    username_key      TEXT PRIMARY KEY,
    failures          INTEGER NOT NULL,
    window_started_at INTEGER NOT NULL,
    locked_until      INTEGER
  );

  CREATE TABLE audit_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    at             INTEGER NOT NULL,
    actor_id       TEXT REFERENCES users(id),  -- NULL = local command
    action         TEXT NOT NULL,
    target_user_id TEXT REFERENCES users(id),
    detail         TEXT NOT NULL DEFAULT '{}'  -- counts and codes only
  );
`;

export function dataDir() {
  return path.resolve(process.env.VIREMENTOCR_DATA_DIR || path.join(process.cwd(), "data"));
}

/** @param {import("better-sqlite3").Database} conn @param {string} dir */
function migrate(conn, dir) {
  if (conn.pragma("user_version", { simple: true }) >= SCHEMA_VERSION) return;

  // VACUUM INTO includes data still in the WAL, which a plain file copy would miss.
  const { n } = /** @type {{ n: number }} */ (conn.prepare("SELECT COUNT(*) AS n FROM transfers").get());
  if (n > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    conn.prepare("VACUUM INTO ?").run(path.join(dir, `backup-before-roles-${stamp}-${process.pid}.db`));
  }

  conn
    .transaction(() => {
      // Another process may have migrated while this one waited for the lock.
      if (conn.pragma("user_version", { simple: true }) >= SCHEMA_VERSION) return;
      conn.exec(ROLES_SCHEMA);
      const columns = /** @type {{ name: string }[]} */ (conn.pragma("table_info(transfers)"));
      if (!columns.some((c) => c.name === "owner_id")) {
        // Existing rows stay unowned: nothing records who uploaded them.
        conn.exec("ALTER TABLE transfers ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE RESTRICT");
      }
      conn.exec("CREATE INDEX IF NOT EXISTS idx_transfers_owner ON transfers(owner_id, analysed_at)");
      conn.pragma(`user_version = ${SCHEMA_VERSION}`);
    })
    .immediate();
}

/** @returns {import("better-sqlite3").Database} */
export function openDatabase() {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const conn = new Database(path.join(dir, "virementocr.db"));
  conn.pragma("journal_mode = WAL");
  conn.pragma("busy_timeout = 5000");
  conn.pragma("foreign_keys = ON");
  conn.exec(BASE_SCHEMA);
  migrate(conn, dir);
  return conn;
}
