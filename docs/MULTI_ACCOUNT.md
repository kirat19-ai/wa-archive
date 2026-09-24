# Multi-account model

Multiple independent WhatsApp numbers are a core requirement, not an add-on.

## Identity

Each account is a `whatsapp_accounts` row with an immutable UUID `id`
(`account_id`). Phone number and WhatsApp JID are attributes that may change —
never the primary key.

## Independence

`AppServices` (the AccountConnectionManager) holds a map of
`account_id → { adapter, engine }`. Each account has:

- its own `IWhatsAppAdapter` instance and connection lifecycle;
- its own `ArchiveEngine`;
- its own chats, contacts, messages, media, and search scope;
- (Phase 5) its own archive password, sessions, and device grants.

Disconnecting or deleting one account never touches another. Connecting a new
account never blocks an existing one.

## Isolation guarantees

- Every repository method that reads WhatsApp data requires an `account_id` and
  filters on it.
- `(account_id, whatsapp_message_id)` / `(account_id, whatsapp_chat_id)` are
  unique — the same WhatsApp id in two accounts is two distinct rows.
- Cross-account search (`searchAccounts`) takes an explicit list of authorized
  account ids, and every hit carries its source `account_id` so results always
  show which account they came from.

This is verified by `packages/archive/test/data-layer.test.ts`, which archives
two accounts, deletes a chat in one, and asserts the other is untouched.

## LAN authorization (Phase 5)

Over the LAN, a session authenticated for one account must be rejected (`403`)
when requesting another account's data — enforced in the server, not the UI.
