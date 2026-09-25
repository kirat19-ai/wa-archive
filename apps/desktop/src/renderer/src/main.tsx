import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { createWebClient } from './webClient.js';
import './styles.css';

// Dual transport: Electron preload injects window.wa; over the LAN we fall back
// to the HTTP/WebSocket client so the exact same UI runs in a browser (spec §44).
const isWeb = !window.wa;
if (isWeb) {
  window.wa = createWebClient();
}

// Register the PWA service worker for offline access when served over HTTP(S)
// (spec §91-92). Skipped in the Electron file:// renderer.
if (isWeb && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
