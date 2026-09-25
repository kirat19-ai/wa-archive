# Troubleshooting

## Port 8787 already in use (`EADDRINUSE`)
A server is already running. Stop it:
```bash
pkill -f "tsx src/bin.ts"
```
or run on another port: `PORT=8788 npm run dev:server`.

## The web UI looks out of date after code changes
Rebuild the web bundle and restart the server (the server serves
`apps/desktop/out/web`, and the API code is loaded at process start):
```bash
npm run build:web && pkill -f "tsx src/bin.ts"; npm run dev:server
```

## I don't know the login password
On first run the server prints them:
```
[wa-archive] ADMIN created — username: admin  password: <...>
[wa-archive] seeded account "Personal"  password: personal123
```
Pin admin with `WA_ADMIN_PASSWORD=...`. To start clean, delete the data dir
(`rm -rf data`) and restart — this regenerates mock data and prints fresh
passwords. (Deleting `data/` destroys the local archive.)

## Electron crashes on launch / `better-sqlite3` segfault
`better-sqlite3` is a native module and must match the runtime's ABI.
```bash
npm run rebuild -w @wa-archive/desktop   # electron-rebuild for better-sqlite3
```
On the current **Node 26 + Electron 33** toolchain the prebuilt N-API binary can
still crash inside Electron because Electron 33's bundled Node 20 exposes an older
N-API level than the binary targets. Options:
- Use an Electron build whose bundled Node matches the prebuilt N-API level, or
- Run the **web/LAN server path** instead (`npm run dev:server`) — the backend
  runs under Node where the prebuilt binary works fine. This is the recommended
  way to run today.
This is a local-toolchain issue, not a product-code issue — the same
`@wa-archive/app-core` handlers back both transports.

## Electron says "Electron failed to install correctly"
The postinstall didn't run (e.g. blocked install scripts). Re-extract:
```bash
node node_modules/electron/install.js
```
If a partial `dist/` exists, remove `node_modules/electron/dist` and
`node_modules/electron/path.txt` first, then re-run.

## QR never appears in real mode
`WA_REAL=1` requires network access to WhatsApp servers. Add an account from the
UI (admin) and wait a moment; the QR is fetched live. Closing the connect dialog
stops the pending connection so it doesn't keep reconnecting.

## Media shows "could not be archived"
The download failed after all retries (`download_status = FAILED`, spec §24). It
will not be shown as archived. Reconnect the account to retry future media; failed
historical media currently needs the account connected to re-request.

## Phone can't reach the archive
- Confirm the server was started with `HOST=0.0.0.0` (LAN is off by default).
- Confirm the phone is on the same Wi-Fi and using the machine's LAN IP.
- Non-private client addresses are rejected by design (spec §56).
