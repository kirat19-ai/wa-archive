# Third-party notices

WA Archive uses the following third-party software. Each is the property of its
respective authors and is used under its stated license. This list covers the
primary direct dependencies; run `npm ls` / a license tool for the full
transitive tree before distributing a build.

## Runtime

| Package | License | Purpose |
|---|---|---|
| [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) | MIT | WhatsApp Web (linked-device) client |
| whatsapp-rust-bridge | MIT | Native crypto/signal bridge used by Baileys v7 |
| **libsignal** (via Baileys) | **GPL-3.0** | Signal protocol — see note below |
| better-sqlite3 | MIT | SQLite driver (bundles SQLite) |
| SQLite | Public Domain | Embedded database engine |
| drizzle-orm | Apache-2.0 | Type-safe query builder / schema |
| ws | MIT | WebSocket server |
| pino (via Baileys) | MIT | Logger (silenced in WA Archive) |
| hash-wasm | MIT | Argon2id (WASM) for password hashing |
| qrcode | MIT | Render the linked-device QR |
| zod | MIT | Runtime validation |
| react, react-dom | MIT | UI |
| electron | MIT | Desktop shell |

Node.js built-ins (`node:crypto` AES-256-GCM / scrypt, `node:zlib`,
`node:sqlite`, `node:http`) are used under the Node.js license.

## Build / dev

| Package | License |
|---|---|
| typescript | Apache-2.0 |
| vite, @vitejs/plugin-react | MIT |
| electron-vite | MIT |
| drizzle-kit | MIT |
| vitest | MIT |
| eslint, prettier | MIT |
| @electron/rebuild | MIT |

## Important note on libsignal / GPL-3.0

The WhatsApp integration (Baileys) depends on **libsignal**, which is licensed
under **GPL-3.0**. Linking GPL-3.0 code into a distributed application generally
imposes copyleft obligations on the combined work. Before distributing a packaged
build of WA Archive, review this with the project's licensing requirements — you
may need to license the distributed application under a compatible (copyleft)
license, or isolate the WhatsApp connector.

The WA Archive source in this repository (the `@wa-archive/*` packages and
`apps/*`) is the project's own code; see the repository `LICENSE`.

## Regenerating this file

```bash
npx license-checker --production --summary   # or npm ls --all
```
Verify each dependency's license and provenance (spec §110–111) before installing
new packages or shipping a release.
