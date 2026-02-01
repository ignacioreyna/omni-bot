import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { appConfig } from '../config.js';

let db: Database.Database | null = null;

const MIGRATIONS = [
  {
    version: 1,
    up: `
      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        status TEXT CHECK(status IN ('active', 'paused', 'terminated')) DEFAULT 'active',
        claude_session_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        last_message_at TEXT
      );

      -- Messages table
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT CHECK(role IN ('user', 'assistant', 'tool')) NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

      -- Full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content=messages,
        content_rowid=id
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;

      -- Schema version tracking
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `,
  },
];

export function initDatabase(): Database.Database {
  if (db) return db;

  const dbDir = path.dirname(appConfig.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(appConfig.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  const currentVersion = getCurrentVersion(db);

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      console.log(`Running migration v${migration.version}...`);
      db.exec(migration.up);
      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(
        migration.version
      );
    }
  }
}

function getCurrentVersion(db: Database.Database): number {
  try {
    const result = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined;
    return result?.version ?? 0;
  } catch {
    return 0;
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
