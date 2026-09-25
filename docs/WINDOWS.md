# WA Archive on Windows

Two ways to run it. **Option A (server + PWA) is the recommended, reliable path**
and is what the auto-start setup uses. Option B builds a native `.exe`.

---

## Option A — Server + PWA (recommended)

### 1. Install Node.js
Install **Node.js 20 or newer** from <https://nodejs.org> (the LTS build is fine).
Then get the code and dependencies:
```bat
git clone <your-repo-url> wa-archive
cd wa-archive
npm install
npm run build:web
```

### 2. Set your admin password (optional but recommended)
Copy `scripts\windows\wa-archive.env.example` to `scripts\windows\wa-archive.env`
and edit it (this file is git-ignored). Set `WA_ADMIN_PASSWORD`, and set `WA_REAL=1`
if you want to link a real WhatsApp account instead of demo data.

### 3. Start it
Double-click **`scripts\windows\start-wa-archive.bat`**, or run it from a terminal.
Then open **http://localhost:8787**. On the first real run, sign in as **admin**
and add your WhatsApp account (scan the QR from WhatsApp → Linked Devices).

### 4. Install it as an app (optional)
In Edge or Chrome, open `http://localhost:8787`, then **⋯ menu → Apps → Install
this site as an app** (or the install icon in the address bar). You now have a
"WA Archive" app window with its own icon and Start-menu entry — it's a PWA.

### 5. Access from your phone (same Wi-Fi)
The launcher binds to `0.0.0.0` by default. Find this PC's IP (`ipconfig`) and open
`http://<that-ip>:8787` on your phone; sign in with an account password. See
[LAN_ACCESS.md](LAN_ACCESS.md).

---

## Auto-start on every restart

This registers a **Scheduled Task** that launches WA Archive at **every boot**
(before anyone logs in), so it comes back on its own after a reboot — including
the reboot after power is restored.

Open **PowerShell as Administrator**, `cd` into the repo, and run:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
```
Start it immediately without rebooting:
```powershell
Start-ScheduledTask -TaskName "WA Archive"
```
Remove it later:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\uninstall-autostart.ps1
```

The task keeps the server running and auto-restarts it if it ever exits.

---

## Fully unattended after a power cut

"The PC should turn itself on when electricity comes back, and the app should be
running" needs **three** things — the software (above) plus two settings the OS
cannot set for you:

### 1. BIOS/UEFI — power on after AC loss  *(firmware, not scriptable)*
This lives in your motherboard firmware, not Windows, so it must be set by hand
(the name varies by vendor):
1. Reboot and enter BIOS/UEFI (usually **Del** or **F2** at power-on).
2. Find **Restore on AC Power Loss** / **AC Power Recovery** / **After Power
   Failure** / **State After Power Loss** (often under *Power*, *ACPI*, or
   *Advanced*).
3. Set it to **Power On** (or **Last State** if the PC was on when power was cut).
4. Save and exit.

> There is no reliable, universal Windows command for this — it is a hardware
> setting. Some business PCs ship a vendor tool that can script it (Dell
> `Command | Configure` / `cctk`, HP `BIOS Configuration Utility`, Lenovo
> `ThinkBIOS Config`); use those only if you have them.

### 2. Windows — reach the desktop without a login  *(so the task can run fully)*
The Scheduled Task above already runs at startup before login, so the server
starts even at the lock screen. If you also want the PC to land on the desktop
automatically (e.g. to keep the PWA window open):
1. Press **Win+R**, type **`netplwiz`**, Enter.
2. Untick **"Users must enter a user name and password to use this computer."**
3. Enter the password once to confirm.

> Auto-login means anyone with physical access reaches your desktop. Only enable
> it on a machine you physically trust.

### Test it
With all three done: shut the PC off at the wall, restore power — it should boot,
the task should start the server, and `http://localhost:8787` (and the LAN URL
from your phone) should work without you touching anything.

---

## Option B — Native `.exe` installer (advanced)

Build a standalone installer **on a Windows machine**:
```bat
cd apps\desktop
npm run rebuild        REM rebuild better-sqlite3 for Electron's ABI
npm run dist:win       REM output: apps\desktop\release\WA Archive-Setup-*.exe
```
Notes:
- `electron-builder` (config in `apps/desktop/electron-builder.yml`) produces an
  NSIS installer with desktop + Start-menu shortcuts.
- The native SQLite module (`better-sqlite3`) must be rebuilt for Electron; the
  build runs this, but if launching the installed app crashes on start, the
  Electron/Node ABI didn't match — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
  and prefer Option A.
- To auto-start the installed `.exe` instead of the server, point the Scheduled
  Task at the installed executable (or drop a shortcut in
  `shell:startup`) rather than `start-wa-archive.bat`.
