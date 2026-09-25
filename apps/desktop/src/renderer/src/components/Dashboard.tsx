import type { AccountDTO } from '../../../shared-ipc/contract';

interface Props {
  accounts: AccountDTO[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  onBackups?: () => void;
}

const fmt = new Intl.NumberFormat('en-US');

function humanBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

/** MY WHATSAPP ACCOUNTS dashboard (spec §29). */
export function Dashboard({ accounts, onOpen, onAdd, onBackups }: Props) {
  return (
    <div className="dash">
      <h1>My WhatsApp Accounts</h1>
      <div className="muted">
        {accounts.length} account{accounts.length === 1 ? '' : 's'} · permanent local archive
      </div>
      {onBackups && (
        <div className="dash-actions">
          <button className="btn ghost" onClick={onBackups}>
            🔐 Backup &amp; Restore
          </button>
        </div>
      )}
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
                <div className="n">{fmt.format(a.stats.media)}</div>
                <div className="l">Media</div>
              </div>
              <div className="stat">
                <div className="n">{humanBytes(a.stats.storageBytes)}</div>
                <div className="l">Storage</div>
              </div>
              <div className="stat">
                <div className="n">{a.archiveStartedAt ? new Date(a.archiveStartedAt).toLocaleDateString() : '—'}</div>
                <div className="l">Since</div>
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
