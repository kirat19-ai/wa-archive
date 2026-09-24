interface ConnState {
  status: string;
  qr?: string;
  lastError?: string | null;
}

interface Props {
  accountName: string;
  state: ConnState | undefined;
  onClose: () => void;
}

/**
 * Linked-device connection flow (spec §5). Shows the QR the user scans from
 * WhatsApp → Linked Devices → Link a Device. No password is ever requested.
 */
export function ConnectModal({ accountName, state, onClose }: Props) {
  const status = state?.status ?? 'CONNECTING';
  const connected = status === 'CONNECTED';
  const loggedOut = status === 'LOGGED_OUT';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <h3>Connect {accountName}</h3>
        {connected ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48 }}>✅</div>
            <p>Connected. Your archive is syncing.</p>
          </div>
        ) : loggedOut ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <p style={{ color: 'var(--danger)' }}>Logged out from the phone.</p>
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              Remove and re-add the account to link again.
            </p>
          </div>
        ) : state?.qr ? (
          <>
            <ol style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6, paddingLeft: 18 }}>
              <li>Open WhatsApp on your phone</li>
              <li>Tap Settings → Linked Devices</li>
              <li>Tap “Link a Device” and scan this code</li>
            </ol>
            <div style={{ display: 'grid', placeItems: 'center', padding: 8 }}>
              {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
              <img src={state.qr} width={280} height={280} alt="WhatsApp linking QR code" />
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-dim)' }}>
            <div className="spinner" />
            <p>Preparing secure link… {status.toLowerCase()}</p>
          </div>
        )}
        {state?.lastError && !connected && (
          <p style={{ color: 'var(--warn)', fontSize: 12 }}>{state.lastError}</p>
        )}
        <div className="actions">
          <button className="btn primary" onClick={onClose}>
            {connected ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
