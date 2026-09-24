# WA Archive

A **local-first, multi-account WhatsApp archive platform**. WA Archive connects
to your own WhatsApp accounts through a WhatsApp-Web-compatible client, copies
accessible messages and media into a **permanent local database**, and gives you
a WhatsApp-style interface to browse, search, and open that archive — even after
the original chat is deleted from your phone.

> WhatsApp is treated as a **source**, never as the database. Once something is
> archived, the local copy is authoritative. Deleting a chat on your phone flags
> it as `deleted from WhatsApp` but **never** removes the archived copy.

This repository is being built in incremental, verified milestones (see
[Roadmap](#roadmap)). **Phase 1 (foundation + first vertical slice) is complete
and verified.**

---

## What works today (Phase 1)

- **Monorepo** (`packages/*` + `apps/*`) with strict TypeScript.
- **SQLite archive** (Drizzle ORM, WAL) with the full schema: 18 tables +
  FTS5 full-text search, all indexes, cascade deletes.
- **Account isolation** — every WhatsApp-scoped query is keyed by `account_id`;
  cross-account contamination is impossible by construction (verified by test).
- **Archive engine** — idempotent, at-least-once sync from a normalized adapter
  into the DB; deletion-preservation semantics.
- **Mock WhatsApp adapter** — a full in-memory `IWhatsAppAdapter` with a seeded
  data generator (groups, replies, media, deleted items), so the whole product
  runs and is testable without linking a phone.
- **WhatsApp-style UI** (React) — multi-account dashboard, account rail with live
  status, chat list, message thread with media chips and day separators, and
  instant FTS search. Dark/light theming.
- **Two transports for the same UI**:
  - **Electron desktop shell** (main/preload/renderer, secure `contextBridge`).
  - **LAN HTTP + WebSocket server** (foundation of Phase 5) serving the UI as a
    web app with live updates.
- **Tests** (Vitest): multi-account isolation, deletion preservation, FTS search,
  restart persistence — all passing.

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
| `@wa-archive/whatsapp` | `MockWhatsAppAdapter` + mock data generator (Baileys adapter: Phase 2) |
| `@wa-archive/archive` | Typed event bus + `ArchiveEngine` |
| `@wa-archive/app-core` | `AppServices` (AccountConnectionManager), DTOs, transport-agnostic handlers |
| `@wa-archive/server` | LAN HTTP + WebSocket server |
| `apps/desktop` | Electron shell + React renderer (also builds the web UI) |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DATABASE.md`](docs/DATABASE.md),
and [`docs/MULTI_ACCOUNT.md`](docs/MULTI_ACCOUNT.md).

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

- **Phase 1 — Foundation + first vertical slice** ✅ *(done, verified)*
- **Phase 2 — Baileys adapter**: QR linked-device auth, single real account,
  message/chat/contact sync.
- **Phase 3 — Media pipeline**: download workers, dedup (SHA-256), thumbnails,
  viewers, deletion preservation for media.
- **Phase 4 — Multiple real accounts**: independent connections end-to-end.
- **Phase 5 — LAN access & security**: per-account passwords (Argon2id),
  sessions, device authorization, QR pairing, PWA, private-range validation.
- **Phase 6 — Backup / restore / export**: encrypted backups, selective restore.
- **Phase 7 — Hardening, performance, packaging.**

---

## Privacy & scope

WA Archive is for archiving **your own** WhatsApp accounts. It uses the normal
linked-device mechanism — it never asks for your WhatsApp password and never tries
to bypass WhatsApp's security. It only archives data the connected client can
legitimately access; it does not claim to recover arbitrary historical messages.
No telemetry, no cloud dependency — everything is local by default.
