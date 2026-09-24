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
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
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
