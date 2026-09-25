import { useState } from 'react';
import type { AccountDTO } from '../../../shared-ipc/contract';

interface Props {
  account: AccountDTO;
  onClose: () => void;
  onChanged: () => void;
}

/**
 * Two clearly-separated destructive actions (spec §94):
 *  - Remove WhatsApp connection → preserves the archive.
 *  - Delete archived data → permanent, requires typing the account name (spec §27).
 */
export function AccountSettingsModal({ account, onClose, onChanged }: Props) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const removeConnection = async () => {
    setBusy(true);
    try {
      await window.wa.accounts.remove(account.id, 'connection');
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const deleteArchive = async () => {
    setBusy(true);
    try {
      await window.wa.accounts.remove(account.id, 'archive');
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const canDelete = confirmText.trim() === account.displayName;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
        <h3>{account.displayName} — settings</h3>

        <div className="danger-box">
          <div className="danger-title">Remove WhatsApp connection</div>
          <p>
            Stops syncing and unlinks the device. <strong>Your archive is kept</strong> — all
            {` ${account.stats.messages.toLocaleString()} messages and ${account.stats.media.toLocaleString()} media stay available offline.`}
          </p>
          <button className="btn ghost" disabled={busy} onClick={removeConnection}>
            Remove connection (keep archive)
          </button>
        </div>

        <div className="danger-box danger">
          <div className="danger-title">Delete archived data</div>
          <p>
            Permanently removes this account and{' '}
            <strong>
              {account.stats.messages.toLocaleString()} messages, {account.stats.media.toLocaleString()} media
            </strong>
            . This cannot be undone. Type <code>{account.displayName}</code> to confirm.
          </p>
          <input
            placeholder={account.displayName}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <button className="btn danger" disabled={busy || !canDelete} onClick={deleteArchive}>
            Delete archive permanently
          </button>
        </div>

        <div className="actions">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
