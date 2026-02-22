/**
 * db.ts — SQLite database layer
 *
 * Single source of truth for all persistent data:
 *   - conversation_history: per-chat message history
 *   - usage_log:           per-call token/cost/latency tracking
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

// Resolve path relative to this file so it works from any cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "gravity-claw.db");

export const db: import("better-sqlite3").Database = new Database(DB_PATH);

// ── Enable WAL mode for better concurrent read performance ──
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema ────────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id     INTEGER NOT NULL,
        role        TEXT    NOT NULL CHECK(role IN ('system','user','assistant','tool')),
        content     TEXT    NOT NULL,
        tool_name   TEXT,
        tool_calls  TEXT,       -- JSON string for assistant tool_calls
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_history_chat ON conversation_history(chat_id, created_at);

    CREATE TABLE IF NOT EXISTS usage_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id         INTEGER NOT NULL,
        model           TEXT    NOT NULL,
        input_tokens    INTEGER NOT NULL DEFAULT 0,
        output_tokens   INTEGER NOT NULL DEFAULT 0,
        latency_ms      INTEGER NOT NULL DEFAULT 0,
        cost_usd        REAL    NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_usage_chat ON usage_log(chat_id, created_at);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id         INTEGER NOT NULL,
        type            TEXT    NOT NULL DEFAULT 'reminder',
        message         TEXT    NOT NULL,
        scheduled_at    INTEGER NOT NULL, -- Unix timestamp
        is_completed    INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_time ON scheduled_tasks(scheduled_at, is_completed);
`);

console.log(`  💾 SQLite database ready at ${DB_PATH}`);
