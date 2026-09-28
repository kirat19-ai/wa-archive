// Barrel: mock adapter + data only. The Baileys adapter and its normalize
// helpers are intentionally NOT re-exported here — they import
// @whiskeysockets/baileys at module load, which drags in a heavy (occasionally
// native-linked) dependency graph. Loading that at app startup, merely because
// someone imported the mock adapter, was crashing the packaged desktop app
// before it could show a window. Import the real adapter from the dedicated
// subpath instead:  import('@wa-archive/whatsapp/baileys')
export * from './mock-adapter.js';
export * from './mock-data.js';
