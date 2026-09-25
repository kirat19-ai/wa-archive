import type { Db } from '@wa-archive/database';
import type { ArchiveStorage } from '@wa-archive/media';
import { decryptBackup, encryptBackup } from './crypto.js';
import { dumpAccount, restoreAccount, type AccountDump } from './dump.js';

export interface BackupManifest {
  version: 1;
  createdAt: number;
  accounts: AccountDump[];
}

export interface BackupSummary {
  createdAt: number;
  accounts: { id: string; displayName: string; messages: number; media: number }[];
}

/** Create an encrypted backup of the given accounts (spec §61-62). */
export function createBackup(
  db: Db,
  storage: ArchiveStorage,
  accountIds: string[],
  password: string,
): Buffer {
  const manifest: BackupManifest = {
    version: 1,
    createdAt: Date.now(),
    accounts: accountIds.map((id) => dumpAccount(db, storage, id)),
  };
  return encryptBackup(Buffer.from(JSON.stringify(manifest), 'utf8'), password);
}

/** Decrypt + validate a backup and summarize its contents for selective restore (spec §63). */
export function inspectBackup(file: Buffer, password: string): BackupSummary {
  const manifest = parse(file, password);
  return {
    createdAt: manifest.createdAt,
    accounts: manifest.accounts.map((a) => ({
      id: String(a.account.id),
      displayName: String(a.account.display_name ?? 'Account'),
      messages: a.tables.messages?.length ?? 0,
      media: a.tables.media?.length ?? 0,
    })),
  };
}

/** Restore selected accounts from a backup (spec §63). Integrity is verified first. */
export async function restoreBackup(
  db: Db,
  storage: ArchiveStorage,
  file: Buffer,
  password: string,
  selectedAccountIds?: string[],
): Promise<{ restored: string[] }> {
  const manifest = parse(file, password);
  const restored: string[] = [];
  for (const dump of manifest.accounts) {
    const id = String(dump.account.id);
    if (selectedAccountIds && !selectedAccountIds.includes(id)) continue;
    await restoreAccount(db, storage, dump);
    restored.push(id);
  }
  return { restored };
}

function parse(file: Buffer, password: string): BackupManifest {
  const plain = decryptBackup(file, password); // throws BackupIntegrityError on bad pw/corruption
  const manifest = JSON.parse(plain.toString('utf8')) as BackupManifest;
  if (manifest.version !== 1) throw new Error(`unsupported backup version ${manifest.version}`);
  return manifest;
}
