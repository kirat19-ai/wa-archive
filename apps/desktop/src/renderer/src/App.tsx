import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountDTO, ChatDTO, MessageDTO, SearchHitDTO } from '../../shared-ipc/contract';
import { AccountRail } from './components/AccountRail.js';
import { Dashboard } from './components/Dashboard.js';
import { ChatList } from './components/ChatList.js';
import { MessageThread } from './components/MessageThread.js';
import { AddAccountModal } from './components/AddAccountModal.js';
import { ConnectModal } from './components/ConnectModal.js';
import { Lightbox } from './components/Lightbox.js';
import { LoginScreen } from './components/LoginScreen.js';
import { BackupsPanel } from './components/BackupsPanel.js';
import { AccountSettingsModal } from './components/AccountSettingsModal.js';
import { MediaGallery } from './components/MediaGallery.js';
import { DevicesPanel } from './components/DevicesPanel.js';
import type { AuthState, MediaDTO } from '../../shared-ipc/contract';

interface ConnState {
  status: string;
  qr?: string;
  lastError?: string | null;
}

type Tab = 'live' | 'archive' | 'deleted';
type View = string | null | 'ALL';

export function App() {
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [view, setView] = useState<View>(null);
  const [tab, setTab] = useState<Tab>('live');
  const [chats, setChats] = useState<ChatDTO[]>([]);
  const [activeChat, setActiveChat] = useState<ChatDTO | null>(null);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHitDTO[]>([]);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connStates, setConnStates] = useState<Record<string, ConnState>>({});
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<MediaDTO | null>(null);
  const [showBackups, setShowBackups] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [pane, setPane] = useState<'chats' | 'media'>('chats');
  const [showDevices, setShowDevices] = useState(false);
  // null = still checking; over the LAN this drives the login gate (spec §44).
  const [auth, setAuth] = useState<AuthState | null>(null);

  const checkAuth = useCallback(async () => {
    if (!window.wa.auth) {
      setAuth({ authenticated: true, isAdmin: true, accountScope: null }); // Electron: local trust
      return;
    }
    setAuth(await window.wa.auth.me());
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const refreshAccounts = useCallback(async () => {
    if (window.wa.auth && !auth?.authenticated) return; // wait for login over LAN
    setAccounts(await window.wa.accounts.list());
  }, [auth]);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  // Persistent subscription for connection state (QR + status) across accounts.
  useEffect(() => {
    const off = window.wa.onEvent((event, payload) => {
      if (event !== 'account.connection') return;
      const p = payload as ConnState & { accountId: string };
      setConnStates((prev) => ({
        ...prev,
        [p.accountId]: { status: p.status, qr: p.qr, lastError: p.lastError },
      }));
      if (p.status === 'CONNECTED' || p.status === 'LOGGED_OUT') void refreshAccounts();
    });
    return off;
  }, [refreshAccounts]);

  const accountId = typeof view === 'string' && view !== 'ALL' ? view : null;

  const loadChats = useCallback(async () => {
    if (!accountId) return;
    if (tab === 'deleted') setChats(await window.wa.chats.listDeleted(accountId));
    else setChats(await window.wa.chats.list(accountId, { includeDeleted: tab === 'archive' }));
  }, [accountId, tab]);

  useEffect(() => {
    setActiveChat(null);
    setMessages([]);
    void loadChats();
  }, [loadChats]);

  // Return to the chat pane whenever the selected account changes.
  useEffect(() => {
    setPane('chats');
  }, [accountId]);

  const openChat = useCallback(async (chat: ChatDTO) => {
    setActiveChat(chat);
    setMessages(await window.wa.messages.list(chat.accountId, chat.id, { limit: 200 }));
  }, []);

  // Live updates (spec §58): refresh the open chat/list on new archived messages.
  useEffect(() => {
    const off = window.wa.onEvent((event, payload) => {
      const p = payload as { accountId?: string; chatId?: string };
      if (event === 'archive.message.created') {
        if (accountId && p.accountId === accountId) {
          void loadChats();
          if (activeChat && p.chatId === activeChat.id) void openChat(activeChat);
        }
        void refreshAccounts();
      }
      if (event === 'whatsapp.chat.updated' || event === 'sync.completed') {
        void loadChats();
        void refreshAccounts();
      }
    });
    return off;
  }, [accountId, activeChat, loadChats, openChat, refreshAccounts]);

  // Search (debounced-ish; fires on query change).
  useEffect(() => {
    let cancelled = false;
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const run = async () => {
      const r =
        view === 'ALL' || accountId === null
          ? await window.wa.search.all(query)
          : await window.wa.search.account(accountId, query);
      if (!cancelled) setResults(r);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [query, view, accountId]);

  const createAccount = async (input: { displayName: string; phoneNumber?: string; password?: string }) => {
    setBusy(true);
    try {
      const acc = await window.wa.accounts.create(input);
      await refreshAccounts();
      setModal(false);
      // Real accounts need the linked-device QR flow; mock accounts connect instantly.
      if (acc.connectionStatus !== 'CONNECTED') setConnectingId(acc.id);
      else setView(acc.id);
    } finally {
      setBusy(false);
    }
  };

  const toggleTheme = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  };

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  const openResult = async (hit: SearchHitDTO) => {
    setView(hit.accountId);
    setQuery('');
    const list = await window.wa.chats.list(hit.accountId, { includeDeleted: true });
    const chat = list.find((c) => c.id === hit.chatId);
    if (chat) await openChat(chat);
  };

  if (auth === null) {
    return <div className="login-wrap"><div className="spinner" /></div>;
  }
  if (!auth.authenticated) {
    return <LoginScreen onAuthed={checkAuth} />;
  }

  const logout = async () => {
    await window.wa.auth?.logout();
    setView(null);
    setAccounts([]);
    await checkAuth();
  };

  return (
    <div className="app">
      <AccountRail
        accounts={accounts}
        activeId={view}
        onSelect={setView}
        onAdd={() => setModal(true)}
        onToggleTheme={toggleTheme}
        onLogout={window.wa.auth ? logout : undefined}
      />

      {view === null ? (
        <Dashboard
          accounts={accounts}
          onOpen={setView}
          onAdd={() => setModal(true)}
          onBackups={auth.isAdmin ? () => setShowBackups(true) : undefined}
          onManage={auth.isAdmin ? (id) => setSettingsId(id) : undefined}
          onDevices={auth.isAdmin && window.wa.admin ? () => setShowDevices(true) : undefined}
        />
      ) : (
        <>
          <div className="sidebar">
            <div className="sidebar-head">
              <div>
                <h2>{view === 'ALL' ? 'All Accounts' : (activeAccount?.displayName ?? '…')}</h2>
                <span className="sub">
                  {view === 'ALL'
                    ? 'Search across every archive'
                    : activeAccount
                      ? `${activeAccount.stats.messages.toLocaleString()} messages · ${activeAccount.stats.media.toLocaleString()} media`
                      : ''}
                </span>
              </div>
              {view !== 'ALL' && (
                <div className="tabs" style={{ padding: 0 }}>
                  <button className={`tab ${pane === 'chats' ? 'active' : ''}`} onClick={() => setPane('chats')}>
                    Chats
                  </button>
                  <button className={`tab ${pane === 'media' ? 'active' : ''}`} onClick={() => setPane('media')}>
                    Media
                  </button>
                </div>
              )}
            </div>
            <div className="search-box">
              <input
                placeholder={view === 'ALL' ? 'Search all accounts…' : 'Search this archive…'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {query.trim() ? (
              <div className="results">
                {results.length === 0 && <div className="empty">No matches.</div>}
                {results.map((h) => (
                  <div key={h.messageId} className="result-row" onClick={() => openResult(h)}>
                    {view === 'ALL' && (
                      <div className="acct">
                        {accounts.find((a) => a.id === h.accountId)?.displayName ?? h.accountId}
                      </div>
                    )}
                    <div className="chat">{h.chatName ?? 'Chat'}</div>
                    <div className="txt">{h.text}</div>
                  </div>
                ))}
              </div>
            ) : view === 'ALL' ? (
              <div className="empty">Type to search across all accounts.</div>
            ) : (
              <>
                <div className="tabs">
                  {(['live', 'archive', 'deleted'] as Tab[]).map((t) => (
                    <button
                      key={t}
                      className={`tab ${tab === t ? 'active' : ''}`}
                      onClick={() => setTab(t)}
                    >
                      {t === 'live' ? 'Live' : t === 'archive' ? 'Archive' : 'Deleted'}
                    </button>
                  ))}
                </div>
                <ChatList chats={chats} activeChatId={activeChat?.id ?? null} onSelect={openChat} />
              </>
            )}
          </div>

          {pane === 'media' && accountId ? (
            <MediaGallery
              accountId={accountId}
              accountName={activeAccount?.displayName ?? ''}
              onOpen={setLightbox}
            />
          ) : (
            <MessageThread chat={activeChat} messages={messages} onOpenMedia={setLightbox} />
          )}
        </>
      )}

      {lightbox && <Lightbox media={lightbox} onClose={() => setLightbox(null)} />}

      {showBackups && (
        <BackupsPanel
          accounts={accounts}
          onClose={() => setShowBackups(false)}
          onRestored={() => void refreshAccounts()}
        />
      )}

      {showDevices && <DevicesPanel onClose={() => setShowDevices(false)} />}

      {settingsId && accounts.find((a) => a.id === settingsId) && (
        <AccountSettingsModal
          account={accounts.find((a) => a.id === settingsId)!}
          onClose={() => setSettingsId(null)}
          onChanged={() => void refreshAccounts()}
        />
      )}

      {modal && (
        <AddAccountModal onCancel={() => setModal(false)} onCreate={createAccount} busy={busy} />
      )}

      {connectingId && (
        <ConnectModal
          accountName={accounts.find((a) => a.id === connectingId)?.displayName ?? 'account'}
          state={connStates[connectingId]}
          onClose={() => {
            const id = connectingId;
            const st = connStates[id]?.status;
            // If they never linked, stop the socket so it doesn't keep reconnecting.
            if (st !== 'CONNECTED') void window.wa.accounts.disconnect(id);
            setConnectingId(null);
            void refreshAccounts();
          }}
        />
      )}
    </div>
  );
}
