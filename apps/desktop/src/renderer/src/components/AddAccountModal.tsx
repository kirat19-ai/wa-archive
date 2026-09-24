import { useState } from 'react';

interface Props {
  onCancel: () => void;
  onCreate: (input: { displayName: string; phoneNumber?: string }) => void;
  busy: boolean;
}

/**
 * Phase 1 uses the mock adapter, so this just names the account. Phase 2 adds
 * the "Connect WhatsApp → scan QR" linked-device flow (spec §5) here.
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
          Phase 1 seeds this account with a local mock dataset. Linked-device QR
          connection arrives in Phase 2.
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
