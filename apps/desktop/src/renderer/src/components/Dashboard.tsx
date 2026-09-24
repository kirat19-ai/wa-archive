import type { AccountDTO } from '../../../shared-ipc/contract';

interface Props {
  accounts: AccountDTO[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}

const fmt = new Intl.NumberFormat('en-US');

/** MY WHATSAPP ACCOUNTS dashboard (spec §29). */
export function Dashboard({ accounts, onOpen, onAdd }: Props) {
  return (
    <div className="dash">
      <h1>My WhatsApp Accounts</h1>
      <div className="muted">
        {accounts.length} account{accounts.length === 1 ? '' : 's'} · permanent local archive
      </div>
      <div className="cards">
        {accounts.map((a) => (
          <div className="card" key={a.id} onClick={() => onOpen(a.id)}>
            <div className="row">
              <div className="avatar-circle">{initials(a.displayName)}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{a.displayName}</div>
                <div className="muted" style={{ margin: 0 }}>
                  {a.phoneNumber ?? 'No number yet'}
                </div>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <span className={`status-dot status-${a.connectionStatus}`} style={{ position: 'static', display: 'inline-block', border: 'none' }} />{' '}
                <span className="muted" style={{ margin: 0, fontSize: 12 }}>{a.connectionStatus.toLowerCase()}</span>
              </div>
            </div>
            <div className="stats">
              <div className="stat">
                <div className="n">{fmt.format(a.stats.chats)}</div>
                <div className="l">Chats</div>
              </div>
              <div className="stat">
                <div className="n">{fmt.format(a.stats.messages)}</div>
                <div className="l">Messages</div>
              </div>
              <div className="stat">
                <div className="n">{a.archiveStartedAt ? new Date(a.archiveStartedAt).toLocaleDateString() : '—'}</div>
                <div className="l">Archive since</div>
              </div>
            </div>
          </div>
        ))}
        <div className="card add-card" onClick={onAdd}>
          + Add WhatsApp Account
        </div>
      </div>
    </div>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
