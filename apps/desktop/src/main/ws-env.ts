// Side-effect module: MUST be the very first import in the main entry so these
// env vars are set before ANY module that pulls in `ws` is evaluated (ESM
// evaluates imported modules before the importing module's own top-level code,
// so setting these inline in index.ts runs too late). They force `ws` to its
// built-in pure-JS masking/validation, avoiding the native bufferutil/
// utf-8-validate addons whose interop breaks when bundled+packaged
// ("bufferUtil.mask is not a function") — for both the WhatsApp client and the
// embedded server's WebSocket.
process.env.WS_NO_BUFFER_UTIL = '1';
process.env.WS_NO_UTF_8_VALIDATE = '1';
