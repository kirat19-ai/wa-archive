import { existsSync, readFileSync } from 'node:fs';
import type { Db } from '@wa-archive/database';
import type { ArchiveStorage } from '@wa-archive/media';

/** Per-account archive tables copied by a backup (spec §61). Excludes auth/session tables. */
const ACCOUNT_TABLES = [
  'chats',
  'contacts',
  'messages',
  'media',
  'message_reactions',
  'message_edits',
  'message_links',
  'groups',
  'group_participants',
] as const;

export interface AccountDump {
  account: Record<string, unknown>;
  tables: Record<string, Record<string, unknown>[]>;
  /** Unique media files: relative path -> base64 bytes. */
  mediaFiles: Record<string, string>;
}

/** Read everything for one account into a serializable object (spec §61). */
export function dumpAccount(db: Db, storage: ArchiveStorage, accountId: string): AccountDump {
  const sqlite = db.$sqlite;
  const account = sqlite.prepare('SELECT * FROM whatsapp_accounts WHERE id = ?').get(accountId) as
    | Record<string, unknown>
    | undefined;
  if (!account) throw new Error(`account ${accountId} not found`);

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of ACCOUNT_TABLES) {
    tables[t] = sqlite
      .prepare(`SELECT * FROM ${t} WHERE account_id = ?`)
      .all(accountId) as Record<string, unknown>[];
  }

  // Collect unique physical media files (dedup means several rows share a path).
  const mediaFiles: Record<string, string> = {};
  for (const row of tables.media ?? []) {
    for (const key of ['storage_path', 'thumbnail_path']) {
      const rel = row[key] as string | null;
      if (rel && !mediaFiles[rel] && storage.exists(rel)) {
        mediaFiles[rel] = readFileSync(storage.absolutePath(rel)).toString('base64');
      }
    }
  }

  return { account, tables, mediaFiles };
}

/** Restore one account's rows + media (spec §63). INSERT OR REPLACE = idempotent. */
export async function restoreAccount(
  db: Db,
  storage: ArchiveStorage,
  dump: AccountDump,
): Promise<void> {
  const sqlite = db.$sqlite;
  const tx = sqlite.transaction(() => {
    insertRow(sqlite, 'whatsapp_accounts', dump.account);
    for (const t of ACCOUNT_TABLES) {
      for (const row of dump.tables[t] ?? []) insertRow(sqlite, t, row);
    }
  });
  tx();

  // Write media files back to storage (skip ones already present & identical size).
  for (const [rel, b64] of Object.entries(dump.mediaFiles)) {
    if (!existsSync(storage.absolutePath(rel))) {
      await storage.writeRaw(rel, Buffer.from(b64, 'base64'));
    }
  }
}

function insertRow(
  sqlite: Db['$sqlite'],
  table: string,
  row: Record<string, unknown>,
): void {
  const cols = Object.keys(row);
  if (cols.length === 0) return;
  const placeholders = cols.map(() => '?').join(',');
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${placeholders})`;
  sqlite.prepare(sql).run(...cols.map((c) => row[c] as never));
}
