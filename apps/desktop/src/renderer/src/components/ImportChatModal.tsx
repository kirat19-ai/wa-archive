import { useState } from 'react';
import type { ChatDTO } from '../../../shared-ipc/contract';

interface Props {
  accountId: string;
  chats: ChatDTO[];
  onClose: () => void;
  onDone: () => void;
}

const label = (c: ChatDTO) => c.name ?? c.phoneNumber ?? c.id.slice(0, 8);

type Mode = 'txt' | 'bulk';

/** Detect whether the uploaded text is whatsapp-chat-exporter JSON (all chats). */
function detectBulk(fileName: string, text: string): number | null {
  if (!fileName.toLowerCase().endsWith('.json') && !text.trimStart().startsWith('{')) return null;
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const chatKeys = Object.entries(obj).filter(
      ([, v]) => v && typeof v === 'object' && 'messages' in (v as object),
    );
    return chatKeys.length > 0 ? chatKeys.length : null;
  } catch {
    return null;
  }
}

/**
 * Import WhatsApp history. Two modes, auto-detected from the file:
 *  - Bulk JSON (from whatsapp-chat-exporter): every chat at once, no picking.
 *  - Single "Export Chat" .txt: pick the chat + which sender name is you.
 */
export function ImportChatModal({ accountId, chats, onClose, onDone }: Props) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<Mode>('txt');
  const [bulkChats, setBulkChats] = useState(0);
  const [senders, setSenders] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [chatId, setChatId] = useState(chats[0]?.id ?? '');
  const [myName, setMyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setResult('');
    setSenders([]);
    setCount(0);
    setBulkChats(0);
    try {
      const t = await file.text();
      setText(t);
      setFileName(file.name);
      const bulkCount = detectBulk(file.name, t);
      if (bulkCount != null) {
        setMode('bulk');
        setBulkChats(bulkCount);
        return;
      }
      setMode('txt');
      const pv = await window.wa.imports!.preview(accountId, t);
      setSenders(pv.senders);
      setCount(pv.count);
      setMyName(pv.senders[0] ?? '');
    } catch (e) {
      setError(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const run = async () => {
    if (!text) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'bulk') {
        const r = await window.wa.imports!.bulk(accountId, text);
        setResult(`Imported ${r.imported.toLocaleString()} messages across ${r.chats} chats.`);
      } else {
        if (!chatId) return;
        const r = await window.wa.imports!.run(accountId, chatId, text, myName || null);
        setResult(`Imported ${r.imported} new message${r.imported === 1 ? '' : 's'} (of ${r.total}).`);
      }
      onDone();
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const canImport = Boolean(text) && !busy && !result && (mode === 'bulk' ? bulkChats > 0 : Boolean(chatId));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import chat history</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 0 }}>
          <b>Bulk:</b> upload the <code>.json</code> from whatsapp-chat-exporter to
          import <b>every chat at once</b>. <b>Single chat:</b> upload a WhatsApp
          “Export Chat” <code>.txt</code> and pick who it’s from. Re-importing never
          duplicates.
        </p>

        <label className="btn ghost" style={{ display: 'inline-block', cursor: 'pointer' }}>
          {fileName || 'Choose .json or .txt file…'}
          <input
            type="file"
            accept=".txt,.json,text/plain,application/json"
            style={{ display: 'none' }}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>

        {mode === 'bulk' && bulkChats > 0 && (
          <p style={{ fontSize: 13, margin: '10px 0 4px' }}>
            📦 Bulk file detected — <b>{bulkChats.toLocaleString()} chats</b> will be
            imported (chats are created automatically).
          </p>
        )}

        {mode === 'txt' && count > 0 && (
          <>
            <p style={{ fontSize: 13, margin: '10px 0 4px' }}>{count.toLocaleString()} messages found.</p>
            <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Import into which chat?</label>
            <select value={chatId} onChange={(e) => setChatId(e.target.value)}>
              {chats.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c)}
                </option>
              ))}
            </select>
            <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Which name is you?</label>
            <select value={myName} onChange={(e) => setMyName(e.target.value)}>
              <option value="">(none — import all as received)</option>
              {senders.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </>
        )}

        {error && <div className="login-error">{error}</div>}
        {result && <div style={{ color: 'var(--accent, #25d366)', fontSize: 13, marginTop: 8 }}>{result}</div>}

        <div className="actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {result ? 'Close' : 'Cancel'}
          </button>
          <button className="btn primary" disabled={!canImport} onClick={run}>
            {busy ? 'Importing…' : mode === 'bulk' ? 'Import all' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
