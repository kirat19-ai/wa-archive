import { useState } from 'react';
import type { ChatDTO } from '../../../shared-ipc/contract';

interface Props {
  accountId: string;
  chats: ChatDTO[];
  onClose: () => void;
  onDone: () => void;
}

const label = (c: ChatDTO) => c.name ?? c.phoneNumber ?? c.id.slice(0, 8);

/**
 * Import a WhatsApp "Export Chat" .txt into an existing chat (full history).
 * You pick the file, the chat it belongs to, and which sender name is you.
 */
export function ImportChatModal({ accountId, chats, onClose, onDone }: Props) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
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
    try {
      const t = await file.text();
      setText(t);
      setFileName(file.name);
      const pv = await window.wa.imports!.preview(accountId, t);
      setSenders(pv.senders);
      setCount(pv.count);
      setMyName(pv.senders[0] ?? '');
    } catch {
      setError('Could not read that file.');
    }
  };

  const run = async () => {
    if (!chatId || !text) return;
    setBusy(true);
    setError('');
    try {
      const r = await window.wa.imports!.run(accountId, chatId, text, myName || null);
      setResult(`Imported ${r.imported} new message${r.imported === 1 ? '' : 's'} (of ${r.total} in the file).`);
      onDone();
    } catch {
      setError('Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import chat history</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 0 }}>
          Upload a WhatsApp “Export Chat” .txt (on your phone: open a chat → contact
          name → Export Chat → Without Media). Pick who it belongs to; it merges into
          that chat. Re-importing the same file adds nothing new.
        </p>

        <label className="btn ghost" style={{ display: 'inline-block', cursor: 'pointer' }}>
          {fileName || 'Choose .txt file…'}
          <input
            type="file"
            accept=".txt,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>

        {count > 0 && (
          <>
            <p style={{ fontSize: 13, margin: '10px 0 4px' }}>
              {count.toLocaleString()} messages found.
            </p>
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
          <button className="btn primary" disabled={!chatId || !text || busy || Boolean(result)} onClick={run}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
