import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { applyFtsSchema } from './fts.js';

export type Db = BetterSQLite3Database<typeof schema> & { $sqlite: Database.Database };

export interface OpenDbOptions {
  /** Absolute path to the SQLite file. Use ':memory:' for tests. */
  file: string;
  /** Folder containing generated Drizzle migrations. */
  migrationsFolder: string;
  /** Skip WAL for in-memory test databases. */
  readonly?: boolean;
}

/**
 * Open (and migrate) the archive database. Enables WAL and enforces foreign
 * keys so cascade deletes and isolation constraints actually hold (spec §12).
 */
export function openDatabase(opts: OpenDbOptions): Db {
  if (opts.file !== ':memory:') {
    const dir = dirname(opts.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(opts.file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');

  const db = drizzle(sqlite, { schema }) as unknown as Db;
  db.$sqlite = sqlite;

  if (existsSync(opts.migrationsFolder)) {
    migrate(db, { migrationsFolder: opts.migrationsFolder });
  }
  applyFtsSchema(sqlite);

  return db;
}

export function closeDatabase(db: Db): void {
  db.$sqlite.close();
}
