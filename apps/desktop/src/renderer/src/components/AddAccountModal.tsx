import { useState } from 'react';

interface Props {
  onCancel: () => void;
  onCreate: (input: { displayName: string; phoneNumber?: string; password?: string }) => void;
  busy: boolean;
}

/**
 * Names the account and sets its private password, then hands off to the
 * connection flow: a QR appears to link the device (spec §5). The password
 * locks this profile everywhere — in the app and over the network (spec §45).
 */
export function AddAccountModal({ onCancel, onCreate, busy }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const pwOk = password.length >= 6 && password === confirm;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add WhatsApp Account</h3>
        <input
          autoFocus
          placeholder="Display name (e.g. Personal, Business)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="Phone number (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          type="password"
          placeholder="Profile password (min 6 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {password.length > 0 && !pwOk && (
          <p style={{ color: 'var(--danger, #e06c6c)', fontSize: 12, marginTop: 0 }}>
            {password.length < 6 ? 'Password must be at least 6 characters.' : 'Passwords do not match.'}
          </p>
        )}
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 0 }}>
          This password keeps the profile private — it’s required to open it in
          the app and from your phone. Next you’ll link the device by scanning a
          QR from WhatsApp → Linked Devices. WA Archive never asks for your
          WhatsApp password.
        </p>
        <div className="actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!name.trim() || !pwOk || busy}
            onClick={() =>
              onCreate({
                displayName: name.trim(),
                phoneNumber: phone.trim() || undefined,
                password,
              })
            }
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
