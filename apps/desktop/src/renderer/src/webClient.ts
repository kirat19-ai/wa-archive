import type {
  AccountDTO,
  ChatDTO,
  MediaDTO,
  MessageDTO,
  SearchHitDTO,
  WaApi,
} from '../../shared-ipc/contract';

/**
 * Web implementation of the WaApi contract used when the renderer is served
 * over the LAN by @wa-archive/server (spec §41, §44). Mirrors the Electron
 * preload API exactly, so App.tsx is agnostic to the transport.
 */
async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}
async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await postRaw(url, body);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}
/** POST that resolves even on non-2xx, so callers (login) can read {ok:false}. */
async function postRaw(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const q = (params: Record<string, unknown>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export function createWebClient(): WaApi {
  return {
    accounts: {
      list: () => get<AccountDTO[]>('/api/accounts'),
      create: (input) => post<AccountDTO>('/api/accounts', input),
      connect: (id) => post<void>(`/api/accounts/${id}/connect`, {}),
      disconnect: (id) => post<void>(`/api/accounts/${id}/disconnect`, {}),
      remove: (id, mode) => post<void>(`/api/accounts/${id}/remove`, { mode }),
    },
    chats: {
      list: (accountId, opts) =>
        get<ChatDTO[]>(`/api/accounts/${accountId}/chats?${q({ includeDeleted: opts?.includeDeleted })}`),
      listDeleted: (accountId) => get<ChatDTO[]>(`/api/accounts/${accountId}/chats/deleted`),
    },
    messages: {
      list: (accountId, chatId, opts) =>
        get<MessageDTO[]>(
          `/api/accounts/${accountId}/chats/${chatId}/messages?${q({ limit: opts?.limit, before: opts?.before })}`,
        ),
    },
    search: {
      account: (accountId, query) =>
        get<SearchHitDTO[]>(`/api/accounts/${accountId}/search?${q({ query })}`),
      all: (query) => get<SearchHitDTO[]>(`/api/search?${q({ query })}`),
    },
    media: {
      list: (accountId, type) => get<MediaDTO[]>(`/api/accounts/${accountId}/media?${q({ type })}`),
      url: (accountId, mediaId) => `/api/accounts/${accountId}/media/${mediaId}/file`,
    },
    imports: {
      preview: (accountId, text) =>
        post<{ senders: string[]; count: number }>(`/api/accounts/${accountId}/import/preview`, { text }),
      run: (accountId, chatId, text, myName) =>
        post<{ imported: number; total: number }>(`/api/accounts/${accountId}/import`, {
          chatId,
          text,
          myName,
        }),
    },
    files: {
      exportChat: (accountId, chatId, format) =>
        fetch(`/api/accounts/${accountId}/chats/${chatId}/export?format=${format}`, {
          credentials: 'same-origin',
        }).then(async (r) => {
          if (!r.ok) throw new Error(`export failed: ${r.status}`);
          const cd = r.headers.get('content-disposition') ?? '';
          const filename = /filename="(.+?)"/.exec(cd)?.[1] ?? `chat.${format}`;
          return { filename, mimeType: r.headers.get('content-type') ?? 'text/plain', content: await r.text() };
        }),
      exportChatZip: async (accountId, chatId) => {
        const r = await fetch(`/api/accounts/${accountId}/chats/${chatId}/export?format=zip`, {
          credentials: 'same-origin',
        });
        if (!r.ok) throw new Error(`export failed: ${r.status}`);
        const cd = r.headers.get('content-disposition') ?? '';
        const filename = /filename="(.+?)"/.exec(cd)?.[1] ?? 'chat.zip';
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = '';
        buf.forEach((b) => (bin += String.fromCharCode(b)));
        return { filename, base64: btoa(bin) };
      },
    },
    backups: {
      create: async (accountIds, password) => {
        const r = await fetch('/api/backup', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accountIds, password }),
        });
        if (!r.ok) throw new Error(`backup failed: ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = '';
        buf.forEach((b) => (bin += String.fromCharCode(b)));
        return { filename: 'WAArchiveBackup.wabackup', base64: btoa(bin) };
      },
      inspect: (base64, password) => post('/api/restore/inspect', { fileBase64: base64, password }),
      restore: (base64, password, accountIds) =>
        post('/api/restore', { fileBase64: base64, password, accountIds }),
    },
    admin: {
      lanInfo: () => get('/api/lan/info'),
      devices: () => get('/api/devices'),
      revokeDevice: async (id) => {
        await postRaw(`/api/devices/${id}/revoke`, {});
      },
    },
    auth: {
      me: () => get('/api/auth/me'),
      accounts: () => get('/api/auth/accounts'),
      loginAccount: async (accountId, password, remember) =>
        (await postRaw('/api/auth/login/account', { accountId, password, remember: remember ? '1' : '0' })).ok,
      loginAdmin: async (username, password, remember) =>
        (await postRaw('/api/auth/login/admin', { username, password, remember: remember ? '1' : '0' })).ok,
      logout: async () => {
        await postRaw('/api/auth/logout', {});
      },
      needsSetup: async () => (await get<{ needsSetup: boolean }>('/api/auth/needs-setup')).needsSetup,
      setup: async (password) => (await postRaw('/api/auth/setup', { password })).ok,
    },
    onEvent: (cb) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { event: string; payload: unknown };
          cb(msg.event, msg.payload);
        } catch {
          /* ignore malformed frames */
        }
      };
      return () => ws.close();
    },
  };
}
