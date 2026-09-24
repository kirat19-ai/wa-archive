import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountDTO, ChatDTO, MessageDTO, SearchHitDTO } from '../../shared-ipc/contract';
import { AccountRail } from './components/AccountRail.js';
import { Dashboard } from './components/Dashboard.js';
import { ChatList } from './components/ChatList.js';
import { MessageThread } from './components/MessageThread.js';
import { AddAccountModal } from './components/AddAccountModal.js';

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

  const refreshAccounts = useCallback(async () => {
    setAccounts(await window.wa.accounts.list());
  }, []);

  useEffect(() => {
    void refreshAccounts();
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

  const createAccount = async (input: { displayName: string; phoneNumber?: string }) => {
    setBusy(true);
    try {
      const acc = await window.wa.accounts.create(input);
      await refreshAccounts();
      setModal(false);
      setView(acc.id);
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

  return (
    <div className="app">
      <AccountRail
        accounts={accounts}
        activeId={view}
        onSelect={setView}
        onAdd={() => setModal(true)}
        onToggleTheme={toggleTheme}
      />

      {view === null ? (
        <Dashboard accounts={accounts} onOpen={setView} onAdd={() => setModal(true)} />
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
                      ? `${activeAccount.stats.messages.toLocaleString()} messages archived`
                      : ''}
                </span>
              </div>
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

          <MessageThread chat={activeChat} messages={messages} />
        </>
      )}

      {modal && (
        <AddAccountModal onCancel={() => setModal(false)} onCreate={createAccount} busy={busy} />
      )}
    </div>
  );
}
