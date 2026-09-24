import type Database from 'better-sqlite3';

/**
 * Full-text search over messages using SQLite FTS5 (spec §33, §88).
 *
 * Drizzle has no first-class support for FTS5 virtual tables or triggers, so we
 * manage them with idempotent raw DDL applied after every migration. The
 * external-content pattern keeps the index in lockstep with `messages` while
 * storing text only once.
 */
export function applyFtsSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text,
      caption,
      content='messages',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, text, caption)
      VALUES (new.rowid, new.text, new.caption);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text, caption)
      VALUES ('delete', old.rowid, old.text, old.caption);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text, caption)
      VALUES ('delete', old.rowid, old.text, old.caption);
      INSERT INTO messages_fts(rowid, text, caption)
      VALUES (new.rowid, new.text, new.caption);
    END;
  `);
}
