# Architecture

WA Archive separates two concepts that must never be conflated:

- **Live WhatsApp** — whatever the connected client can currently see.
- **Archive** — WA Archive's independent, permanent local copy.

The archive is authoritative. WhatsApp is only a feed.

## Data flow

```
WhatsApp  ─►  IWhatsAppAdapter  ─►  ArchiveEngine  ─►  SQLite + media  ─►  UI
              (normalizes)          (idempotent)       (authoritative)     (IPC / LAN)
```

## The adapter seam (`IWhatsAppAdapter`)

Nothing above the adapter depends on Baileys. The adapter converts raw client
objects into **normalized** types (`NormalizedMessage`, `NormalizedChat`, …) and
emits normalized events. Two implementations:

- `MockWhatsAppAdapter` — in-memory, seeded, for development and tests.
- `BaileysWhatsAppAdapter` — real linked-device connection *(Phase 2)*.

One adapter instance == one WhatsApp account. There is **no** global socket; the
`AppServices` account manager owns one adapter + one `ArchiveEngine` per account
so accounts connect, sync, and fail independently.

## The archive engine

`ArchiveEngine` subscribes to adapter events and writes to the account-isolated
repositories. All writes are idempotent (keyed by `(account_id, whatsapp_*_id)`),
so at-least-once delivery and reconnection replays are safe. Deletions from
WhatsApp only set flags (`whatsapp_deleted`), never delete rows.

## Transports share one core

`@wa-archive/app-core` holds `AppServices` (the account manager) and the
transport-agnostic `handlers`. Both the Electron IPC layer and the LAN HTTP
server call the same handlers, so account isolation and DTO shaping live in one
place. The React renderer talks to whichever transport is present (`window.wa`
via preload in Electron, or an HTTP/WebSocket client over the LAN).

## Events

A single typed `EventBus` (`whatsapp.*`, `archive.*`, `sync.*`, `device.*`)
decouples producers from consumers. The Electron IPC bridge and the LAN
WebSocket both fan the same events out to clients for live UI updates.
