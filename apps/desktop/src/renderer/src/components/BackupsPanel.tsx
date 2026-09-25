import { useState } from 'react';
import type { AccountDTO, BackupSummary } from '../../../shared-ipc/contract';
import { downloadBase64 } from '../download.js';

interface Props {
  accounts: AccountDTO[];
  onClose: () => void;
  onRestored: () => void;
}

/** Admin backup / restore panel (spec §61-63). Encrypted, password-protected. */
export function BackupsPanel({ accounts, onClose, onRestored }: Props) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [pendingBase64, setPendingBase64] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const backupAll = async () => {
    if (!password) return setMsg('Enter a backup password first.');
    setBusy(true);
    setMsg('');
    try {
      const { filename, base64 } = await window.wa.backups.create(
        accounts.map((a) => a.id),
        password,
      );
      downloadBase64(filename, 'application/octet-stream', base64);
      setMsg('Backup downloaded.');
    } catch (e) {
      setMsg(`Backup failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    buf.forEach((b) => (bin += String.fromCharCode(b)));
    const base64 = btoa(bin);
    setPendingBase64(base64);
    setMsg('');
    if (!password) return setMsg('Enter the backup password, then choose the file again.');
    try {
      const s = await window.wa.backups.inspect(base64, password);
      setSummary(s);
      setSelected(Object.fromEntries(s.accounts.map((a) => [a.id, true])));
    } catch (e) {
      setMsg(`Cannot read backup: ${(e as Error).message}`);
    }
  };

  const doRestore = async () => {
    setBusy(true);
    try {
      const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
      const r = await window.wa.backups.restore(pendingBase64, password, ids);
      setMsg(`Restored ${r.restored.length} account(s).`);
      onRestored();
    } catch (e) {
      setMsg(`Restore failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
        <h3>Backup &amp; Restore</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 0 }}>
          Backups are encrypted with this password (Argon2/AES-GCM). Keep it safe — it
          cannot be recovered.
        </p>
        <input
          type="password"
          placeholder="Backup password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="dash-actions">
          <button className="btn primary" disabled={busy} onClick={backupAll}>
            Back up all accounts
          </button>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>
            Choose backup to restore…
            <input
              type="file"
              accept=".wabackup"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
        </div>

        {summary && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
              Backup from {new Date(summary.createdAt).toLocaleString()} — select accounts:
            </div>
            {summary.accounts.map((a) => (
              <label key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={selected[a.id] ?? false}
                  onChange={(e) => setSelected((s) => ({ ...s, [a.id]: e.target.checked }))}
                />
                {a.displayName} — {a.messages} messages, {a.media} media
              </label>
            ))}
            <button className="btn primary" style={{ marginTop: 10 }} disabled={busy} onClick={doRestore}>
              Restore selected
            </button>
          </div>
        )}

        {msg && <div style={{ fontSize: 13, color: 'var(--accent)', margin: '8px 0' }}>{msg}</div>}
        <div className="actions">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
