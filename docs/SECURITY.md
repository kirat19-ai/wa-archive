# Security

WA Archive stores highly private communication. Security model (spec §80–84):

## Authentication
- **Passwords** are hashed with **Argon2id** (`hash-wasm`, pure WASM — no native
  build), self-describing PHC strings embedding salt + params. Plaintext
  passwords are never stored or logged.
- **Per-account archive passwords** (spec §45) are independent from WhatsApp and
  from each other. An **admin** account (spec §47) has full access.
- **Sessions** are opaque random tokens; only their SHA-256 is stored. Delivered
  as `HttpOnly; SameSite=Lax` cookies (`Secure` when served over HTTPS).

## Authorization (spec §48)
Enforced in the server, never by hiding UI:
- Account-scoped routes require a session whose `accountScope` matches, or admin.
  A mismatch returns **403** (verified end-to-end).
- The account list and search are scoped to what the session may see.
- WebSocket events are filtered per account before delivery.

## Devices (spec §50–52)
Each login creates a device row (label from user-agent, IP, last-seen). Admin can
list and **revoke** devices; revoking a device immediately invalidates its
sessions.

## Brute-force protection (spec §84)
Escalating lockout keyed by client IP: 5 failures → 10s, 10 → 2m, 15 → 15m.
Configurable in `@wa-archive/auth`'s `LoginRateLimiter`.

## Network (spec §55–57)
- LAN access is **off by default** — the server binds to `127.0.0.1` unless
  `HOST=0.0.0.0` is set explicitly.
- Inbound connections from non-private addresses are rejected
  (`isPrivateAddress`, spec §56: 10/8, 172.16/12, 192.168/16, link-local, IPv6
  ULA/loopback).
- No UPnP, port-forwarding, tunneling, or public hosting is ever configured.
- Development uses HTTP; production LAN should use HTTPS/TLS (spec §57) — set
  `WA_HTTPS=1` to mark cookies `Secure` once TLS is terminated in front.

## Audit log (spec §82)
Records `login_success`, `login_failed`, `account_added`, `account_removed`,
`account_password_changed`, `device_added`, `device_revoked`, `backup_created`,
`backup_restored`, `archive_deleted`, `LAN_enabled`, `LAN_disabled`. **Never**
stores message contents.

## Never logged (spec §81)
Message text, media bytes, passwords, QR/auth data, session keys, WhatsApp
credentials, private keys. The Baileys logger is silenced by default.

## Other protections
- Path-traversal guard on static + media serving (spec §80).
- Parameterized SQL everywhere (Drizzle / bound statements) — no injection.
- Electron: `contextIsolation` on, `nodeIntegration` off, a narrow
  `contextBridge` surface, CSP restricting scripts to `self`.
- Backups are authenticated-encrypted; integrity is verified before restore.
