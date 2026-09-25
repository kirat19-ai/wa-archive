# WA Archive

A **local-first, multi-account WhatsApp archive platform**. WA Archive connects
to your own WhatsApp accounts through a WhatsApp-Web-compatible client, copies
accessible messages and media into a **permanent local database**, and gives you
a WhatsApp-style interface to browse, search, and open that archive — even after
the original chat is deleted from your phone.

> WhatsApp is treated as a **source**, never as the database. Once something is
> archived, the local copy is authoritative. Deleting a chat on your phone flags
> it as `deleted from WhatsApp` but **never** removes the archived copy.

Built in incremental, verified milestones (see [Roadmap](#roadmap)). **Phases 1–7
core are complete and verified** (Phase 7 has optional polish remaining).

---

## What works today

- **Monorepo** (`packages/*` + `apps/*`) with strict TypeScript — 11 packages.
- **SQLite archive** (Drizzle ORM, WAL) with the full schema: 18 tables +
  FTS5 full-text search, all indexes, cascade deletes.
- **Account isolation** — every WhatsApp-scoped query is keyed by `account_id`;
  cross-account contamination is impossible by construction (verified by test).
- **Archive engine** — idempotent, at-least-once sync; deletion preservation.
- **Real WhatsApp** via WhiskeySockets/Baileys v7 — QR linked-device auth, one
  isolated connection per account, live messages/edits/deletes/reactions,
  history import, media download. Plus a full **mock adapter** for dev/tests.
- **Media pipeline** — async download queue, SHA-256 dedup, per-account storage,
  exponential-backoff retries, inline viewers + fullscreen lightbox + a
  filterable media gallery.
- **WhatsApp-style UI** (React) — multi-account dashboard, account rail with live
  status, chat list, message thread, instant FTS search, dark/light theming.
- **LAN security** — per-account Argon2id passwords, admin account, HttpOnly
  sessions, per-account authorization (403 across accounts), device management,
  login rate limiting, audit log, private-range enforcement, login UI.
- **Backup / restore / export** — AES-256-GCM encrypted `.wabackup`, selective
  restore, chat export to TXT/JSON/HTML/CSV.
- **Account removal** — remove connection (keep archive) vs permanently delete.
- **PWA** — installable, offline app shell via a service worker.
- **Two transports for the same UI**:
  - **Electron desktop shell** (main/preload/renderer, secure `contextBridge`).
  - **LAN HTTP + WebSocket server** serving the UI as a web app / PWA.
- **Tests** (Vitest, 25): isolation, deletion preservation, FTS, persistence,
  Baileys normalization, media pipeline, auth/security, backup round-trip.

### See it running (no phone required)

```bash
npm install
npm run build:web          # build the web UI once
npm run dev:server         # boots backend under Node, seeds 3 mock accounts
# open http://127.0.0.1:8787
```

The server seeds **Personal / Business / Factory**, each with ~30 chats and
~4,500 archived messages, and pushes periodic live messages over WebSocket so you
can watch counts update in real time.

---

## Requirements

- **Node.js 20+** (developed and verified on Node 26).
- macOS / Linux / Windows.

## Install

```bash
npm install
```

`better-sqlite3` is pinned to `13.0.3`, which ships an **N-API** prebuilt binary
(ABI-stable across Node versions).

---

## Running

### Web / LAN server (recommended for now)

```bash
npm run build:web
npm run dev:server
```

- Binds to `127.0.0.1:8787` by default. LAN exposure is **off by default**
  (spec §42); binding to a private-network address, per-account passwords, device
  authorization and the QR pairing flow arrive in **Phase 5**.

### Electron desktop shell

```bash
npm run dev            # electron-vite dev
```

> **macOS native-module note.** The Electron desktop shell needs
> `better-sqlite3` built for Electron's ABI:
>
> ```bash
> npm run rebuild -w @wa-archive/desktop   # electron-rebuild for better-sqlite3
> ```
>
> On this project's toolchain (Node 26 host + the pinned Electron 33, whose
> bundled Node 20 exposes an older N-API level) loading the prebuilt binary can
> crash. The backend and web server are unaffected (they run under Node). If you
> hit this, use an Electron build whose bundled Node matches the prebuilt N-API
> level, or run the web server path above. This is a local-toolchain concern, not
> a product-code issue — the shared `@wa-archive/app-core` handlers are identical
> across both transports.

---

## Architecture

```
WhatsApp
   │
   ▼
Connection Layer      IWhatsAppAdapter  (BaileysWhatsAppAdapter | MockWhatsAppAdapter)
   │
   ▼
Archive Engine        idempotent sync, deletion preservation, event bus
   │
   ▼
Local Database        SQLite (Drizzle) + media storage + FTS5
   │
   ├── Electron IPC ──► Desktop renderer (React)
   └── LAN server  ──► Web / PWA (same React app)  + WebSocket live updates
```

| Package | Responsibility |
|---|---|
| `@wa-archive/shared` | Enums, normalized types, `IWhatsAppAdapter`, event names, ids |
| `@wa-archive/database` | Drizzle schema, migrations, WAL client, account-isolated repositories, FTS5 |
| `@wa-archive/whatsapp` | `BaileysWhatsAppAdapter` (v7) + `MockWhatsAppAdapter` + mock data generator |
| `@wa-archive/archive` | Typed event bus + `ArchiveEngine` |
| `@wa-archive/media` | Storage layout, SHA-256 dedup, download queue with backoff |
| `@wa-archive/auth` | Argon2id passwords, sessions, device management, rate limiter |
| `@wa-archive/backup` | Encrypted backup/restore + chat export |
| `@wa-archive/app-core` | `AppServices` (AccountConnectionManager), DTOs, transport-agnostic handlers |
| `@wa-archive/server` | LAN HTTP + WebSocket server (auth, per-account authorization) |
| `apps/desktop` | Electron shell + React renderer (also builds the web UI / PWA) |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DATABASE.md`](docs/DATABASE.md),
[`docs/MULTI_ACCOUNT.md`](docs/MULTI_ACCOUNT.md), [`docs/SECURITY.md`](docs/SECURITY.md),
[`docs/LAN_ACCESS.md`](docs/LAN_ACCESS.md), [`docs/BACKUP.md`](docs/BACKUP.md),
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md), [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md),
and [`docs/WINDOWS.md`](docs/WINDOWS.md) (run on Windows + auto-start on boot/power-restore).

---

## Scripts

| Command | Description |
|---|---|
| `npm test` | Run the Vitest suite |
| `npm run typecheck` | Typecheck every package |
| `npm run build:web` | Build the web UI into `apps/desktop/out/web` |
| `npm run dev:server` | Run the LAN server (seeds mock accounts on first run) |
| `npm run dev` | Run the Electron desktop shell |
| `npm run db:generate` | Regenerate Drizzle migrations from the schema |

---

## Roadmap

- **Phase 1 — Foundation + first vertical slice** ✅ *(verified)*
- **Phase 2 — Baileys v7 adapter**: QR linked-device auth, message/chat/contact
  sync, media download ✅ *(QR verified against live WhatsApp)*
- **Phase 3 — Media pipeline**: download queue, SHA-256 dedup, viewers,
  deletion preservation ✅ *(verified)*
- **Phase 4 — Multiple accounts + removal**: independent connections; remove
  connection vs delete archive ✅ *(verified)*
- **Phase 5 — LAN access & security**: per-account Argon2id passwords, sessions,
  device authorization, rate limiting, audit, private-range validation ✅
  *(full spec §99 flow verified)*
- **Phase 6 — Backup / restore / export**: AES-256-GCM encrypted backups,
  selective restore, TXT/JSON/HTML/CSV export ✅ *(round-trip verified)*
- **Phase 7 — Hardening / performance / packaging** 🚧
  - ✅ Global media library, PWA + offline service worker
  - ⏳ Remaining: LAN QR pairing screen + desktop "Enable Local Access" toggle,
    HTTPS/TLS for LAN, list virtualization for very large archives,
    ZIP-with-media export, Electron packaging (`electron-builder`), thumbnails.

### Known constraint

The Electron desktop shell needs `better-sqlite3` rebuilt for Electron's ABI
(`npm run rebuild -w @wa-archive/desktop`). On the current Node 26 + Electron 33
toolchain the prebuilt binary can crash inside Electron (N-API level mismatch);
the **web/LAN server path is unaffected** and is the recommended way to run today.
See [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

---

## Privacy & scope

WA Archive is for archiving **your own** WhatsApp accounts. It uses the normal
linked-device mechanism — it never asks for your WhatsApp password and never tries
to bypass WhatsApp's security. It only archives data the connected client can
legitimately access; it does not claim to recover arbitrary historical messages.
No telemetry, no cloud dependency — everything is local by default.
