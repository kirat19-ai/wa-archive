import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { createWebClient } from './webClient.js';
import './styles.css';

// Dual transport: Electron preload injects window.wa; over the LAN we fall back
// to the HTTP/WebSocket client so the exact same UI runs in a browser (spec §44).
if (!window.wa) {
  window.wa = createWebClient();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
