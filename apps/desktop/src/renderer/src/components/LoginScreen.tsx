import { useEffect, useState } from 'react';

interface Props {
  onAuthed: () => void;
}

/**
 * LAN login (spec §44-45): pick an account and enter its archive password, or
 * sign in as admin for full access. Passwords are independent from WhatsApp.
 */
export function LoginScreen({ onAuthed }: Props) {
  const [accounts, setAccounts] = useState<{ id: string; displayName: string }[]>([]);
  const [mode, setMode] = useState<'account' | 'admin'>('account');
  const [accountId, setAccountId] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.wa.auth?.accounts().then((a) => {
      setAccounts(a);
      if (a[0]) setAccountId(a[0].id);
    });
  }, []);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const ok =
        mode === 'account'
          ? await window.wa.auth!.loginAccount(accountId, password, remember)
          : await window.wa.auth!.loginAdmin(username, password, remember);
      if (ok) onAuthed();
      else setError('Incorrect password. Repeated failures are rate-limited.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">🗄️</div>
        <h1>WA Archive</h1>
        <p className="muted">Your private WhatsApp archive</p>

        <div className="tabs" style={{ justifyContent: 'center', marginBottom: 14 }}>
          <button className={`tab ${mode === 'account' ? 'active' : ''}`} onClick={() => setMode('account')}>
            Account
          </button>
          <button className={`tab ${mode === 'admin' ? 'active' : ''}`} onClick={() => setMode('admin')}>
            Admin
          </button>
        </div>

        {mode === 'account' ? (
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
        ) : (
          <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        )}

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <label className="remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember this device
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy || !password} onClick={submit}>
          {busy ? 'Signing in…' : 'Open Archive'}
        </button>
      </div>
    </div>
  );
}
