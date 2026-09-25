# Backup, restore & export

## Encrypted backups (spec §61–62)
A backup is a single `WAArchiveBackup.wabackup` file containing, per selected
account: the account config, all archive tables (chats, contacts, messages, media
metadata, reactions, edits, links, groups, participants), and the physical media
files. Auth/session tables are **not** included.

Container format:
```
[magic 'WAB01'][salt 16][iv 12][GCM authTag 16][ciphertext]
ciphertext = AES-256-GCM( gzip( JSON manifest ) )
key = scrypt(password, salt, N=16384, r=8, p=1)
```
The GCM auth tag is the integrity check: a wrong password or any tampering fails
decryption with `BackupIntegrityError` **before** anything is restored (spec §62).

Passwords are never stored in the backup in plaintext (spec §46) — the account
password *hash* travels with the account config so a restored account keeps its
login.

## Create a backup (admin)
From the desktop/web UI: **Dashboard → 🔐 Backup & Restore → Back up all accounts**
(enter a backup password; the `.wabackup` downloads). Or via API:
```
POST /api/backup   { "password": "...", "accountIds": ["..."] }  → binary
```

## Selective restore (spec §63)
**Backup & Restore → Choose backup → select accounts → Restore.** The file is
decrypted and *inspected* first, showing each account with its message/media
counts, so you pick exactly which to restore. Restore is idempotent
(`INSERT OR REPLACE`); the FTS index rebuilds via triggers and media files are
written back to storage.
```
POST /api/restore/inspect  { "fileBase64": "...", "password": "..." }  → summary
POST /api/restore          { "fileBase64": "...", "password": "...", "accountIds": [...] }
```

## Export a chat (spec §64)
From a chat header, use the **Export ▾** menu: **TXT**, **JSON**, **HTML**, or
**CSV**. Or:
```
GET /api/accounts/:id/chats/:chatId/export?format=txt|json|html|csv
```
ZIP-with-media export is planned (Phase 7 polish).

## Verify / storage
Storage usage per account (DB, media, totals) is shown on the dashboard cards
(spec §65). Round-trip integrity is covered by `packages/backup/test`.
