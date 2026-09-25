# LAN access

Access your archive from phones/tablets on the **same Wi-Fi** (spec §41–44).

## Off by default (spec §42)
The server binds to loopback (`127.0.0.1`) unless you opt in. Nothing is exposed
to the network until you set `HOST=0.0.0.0`.

## Enable LAN access
```bash
npm run build:web
HOST=0.0.0.0 PORT=8787 WA_ADMIN_PASSWORD=<pick-one> npm run dev:server
```
Find your machine's LAN IP (e.g. `192.168.1.25`) and open from a phone on the same
network:
```
http://192.168.1.25:8787
```
Only private-network clients are accepted (spec §56); public addresses are
rejected.

## Logging in (spec §44–45)
The phone sees a login screen. Choose an **account** and enter that account's
archive password, or use the **Admin** tab for full access. Sessions are
per-device; "Remember this device" extends the session to 30 days.

## Live updates (spec §58)
The web app opens a WebSocket; new archived messages and connection changes push
to the phone automatically — no refresh. Events are filtered so a device only
receives data for accounts it is authorized to see.

## Offline (spec §40, §92)
The web app is a PWA with an offline app shell (service worker). Once loaded, the
UI opens without a network; archived data is served by the desktop while it is on
the LAN.

## Security notes
- Prefer HTTPS/TLS for production LAN use (spec §57). Terminate TLS in front and
  run with `WA_HTTPS=1` so cookies are marked `Secure`.
- Revoke a lost device from **Admin → devices** (`/api/devices`), which
  immediately kills its sessions.
- mDNS (`wa-archive.local`, spec §85) is optional and not required — the IP URL
  always works.
