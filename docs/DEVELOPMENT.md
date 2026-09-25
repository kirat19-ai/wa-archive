# Development

## Prerequisites
- Node.js 20+ (developed on Node 26).
- npm (workspaces). No pnpm/yarn required.

## Install
```bash
npm install
```
Native module: `better-sqlite3@13.0.3` ships an N-API prebuilt binary (no compile
under Node). For the Electron shell it must be rebuilt for Electron's ABI —
`npm run rebuild -w @wa-archive/desktop` (see TROUBLESHOOTING).

## Layout
```
apps/desktop        Electron shell + React renderer (+ web build of the same UI)
packages/shared     enums, normalized types, IWhatsAppAdapter, events
packages/database   Drizzle schema, migrations, WAL client, repositories, FTS5
packages/whatsapp   Baileys v7 adapter + mock adapter + mock data
packages/archive    event bus + ArchiveEngine
packages/media      storage, dedup, media download queue
packages/auth       Argon2id, sessions, devices, rate limiter
packages/backup     encrypted backup/restore + export
packages/app-core   AppServices (account manager) + transport-agnostic handlers
packages/server     LAN HTTP + WebSocket server
```

## Run

Web / LAN (recommended — verifiable in any browser):
```bash
npm run build:web
npm run dev:server          # http://127.0.0.1:8787  (mock data)
WA_REAL=1 npm run dev:server  # real WhatsApp via Baileys (scan QR in the UI)
HOST=0.0.0.0 npm run dev:server  # expose on the LAN (see docs/LAN_ACCESS.md)
```

Electron desktop:
```bash
npm run rebuild -w @wa-archive/desktop   # once, after install
npm run dev
```

## Environment variables
| Var | Meaning |
|---|---|
| `WA_REAL=1` | Use Baileys (real WhatsApp) instead of the mock adapter |
| `HOST` | Bind address (default `127.0.0.1`; `0.0.0.0` enables LAN) |
| `PORT` | Server port (default `8787`) |
| `WA_ADMIN_PASSWORD` | Pin the admin password on first run (else random, printed) |
| `WA_DEMO_PASSWORD` | Password for seeded mock accounts (else `<name>123`) |
| `WA_DATA_DIR` | Override the data directory (DB, media, auth) |
| `WA_AUTH=0` | Disable auth (dev only) |
| `WA_HTTPS=1` | Mark session cookies `Secure` (behind TLS) |

## Quality gates
```bash
npm test          # Vitest (25 tests)
npm run typecheck # all packages
npm run lint
```

## Database migrations
Edit `packages/database/src/schema.ts`, then:
```bash
npm run db:generate   # drizzle-kit generates SQL in packages/database/drizzle
```
Migrations apply automatically on `openDatabase()`; the FTS5 virtual table +
triggers are re-applied idempotently after every migration.
