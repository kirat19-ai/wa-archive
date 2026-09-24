import { useState } from 'react';

interface Props {
  onCancel: () => void;
  onCreate: (input: { displayName: string; phoneNumber?: string }) => void;
  busy: boolean;
}

/**
 * Names the account, then hands off to the connection flow: in real mode a QR
 * appears to link the device (spec §5); in mock mode it fills with demo data.
 */
export function AddAccountModal({ onCancel, onCreate, busy }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
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
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 0 }}>
          Next you’ll link the device by scanning a QR from WhatsApp → Linked
          Devices. WA Archive never asks for your WhatsApp password.
        </p>
        <div className="actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!name.trim() || busy}
            onClick={() => onCreate({ displayName: name.trim(), phoneNumber: phone.trim() || undefined })}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
