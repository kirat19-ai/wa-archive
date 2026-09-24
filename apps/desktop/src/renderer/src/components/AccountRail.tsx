import type { AccountDTO } from '../../../shared-ipc/contract';
import { initials } from './Dashboard.js';

interface Props {
  accounts: AccountDTO[];
  activeId: string | null; // null = dashboard, 'ALL' = all accounts
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onToggleTheme: () => void;
  onLogout?: () => void;
}

/** Vertical account switcher (spec §30–31), always showing connection status. */
export function AccountRail({ accounts, activeId, onSelect, onAdd, onToggleTheme, onLogout }: Props) {
  return (
    <div className="rail">
      <div
        className={`avatar ${activeId === null ? 'active' : ''}`}
        title="Dashboard"
        onClick={() => onSelect(null)}
      >
        <div className="avatar-circle badge-ring" style={{ background: 'var(--accent-dim)' }}>
          🗂
        </div>
      </div>
      <div
        className={`avatar ${activeId === 'ALL' ? 'active' : ''}`}
        title="All accounts"
        onClick={() => onSelect('ALL')}
      >
        <div className="avatar-circle badge-ring">∀</div>
      </div>
      <div style={{ height: 1, width: 40, background: 'var(--border)' }} />
      {accounts.map((a) => (
        <div
          key={a.id}
          className={`avatar ${activeId === a.id ? 'active' : ''}`}
          title={`${a.displayName} · ${a.connectionStatus}`}
          onClick={() => onSelect(a.id)}
        >
          <div className="avatar-circle badge-ring">{initials(a.displayName)}</div>
          <span className={`status-dot status-${a.connectionStatus}`} />
        </div>
      ))}
      <button className="rail-btn" title="Add account" onClick={onAdd}>
        +
      </button>
      <div className="spacer" />
      <button className="icon-btn" title="Toggle theme" onClick={onToggleTheme}>
        ◐
      </button>
      {onLogout && (
        <button className="icon-btn" title="Sign out" onClick={onLogout}>
          ⏻
        </button>
      )}
    </div>
  );
}
