import type { Repositories } from '@wa-archive/database';
import type { ArchiveStorage } from '@wa-archive/media';
import { createZip, type ZipEntry } from './zip.js';

export type ExportFormat = 'txt' | 'json' | 'html' | 'csv';

export interface ExportResult {
  filename: string;
  mimeType: string;
  content: string;
}

/**
 * Export a single chat's archived messages (spec §64). Text-based formats only
 * here; ZIP-with-media is produced by the app layer using the media store.
 */
export function exportChat(
  repos: Repositories,
  accountId: string,
  chatId: string,
  format: ExportFormat,
): ExportResult {
  const chat = repos.chats.get(accountId, chatId);
  if (!chat) throw new Error('chat not found');
  const messages = repos.messages.list(accountId, chatId, { limit: 1_000_000 });
  const name = (chat.name ?? chat.phoneNumber ?? 'chat').replace(/[^\w.-]+/g, '_');

  switch (format) {
    case 'txt':
      return {
        filename: `${name}.txt`,
        mimeType: 'text/plain; charset=utf-8',
        content: messages
          .map((m) => {
            const who = m.direction === 'OUTGOING' ? 'Me' : (m.senderId ?? 'Them');
            const body = m.text ?? m.caption ?? `<${m.messageType.toLowerCase()}>`;
            const del = m.whatsappDeleted ? ' (deleted from WhatsApp · archived)' : '';
            return `[${new Date(m.timestamp).toLocaleString()}] ${who}: ${body}${del}`;
          })
          .join('\n'),
      };
    case 'json':
      return {
        filename: `${name}.json`,
        mimeType: 'application/json; charset=utf-8',
        content: JSON.stringify({ chat, messages }, null, 2),
      };
    case 'csv':
      return {
        filename: `${name}.csv`,
        mimeType: 'text/csv; charset=utf-8',
        content: [
          'timestamp,direction,type,sender,text,whatsapp_deleted',
          ...messages.map((m) =>
            [
              new Date(m.timestamp).toISOString(),
              m.direction,
              m.messageType,
              csv(m.senderId ?? ''),
              csv(m.text ?? m.caption ?? ''),
              m.whatsappDeleted ? '1' : '0',
            ].join(','),
          ),
        ].join('\n'),
      };
    case 'html':
      return {
        filename: `${name}.html`,
        mimeType: 'text/html; charset=utf-8',
        content: renderHtml(chat.name ?? chat.phoneNumber ?? 'Chat', messages),
      };
  }
}

/** Export a chat as a ZIP bundle: messages.json + messages.html + media/ (spec §64). */
export async function exportChatBundle(
  repos: Repositories,
  storage: ArchiveStorage,
  accountId: string,
  chatId: string,
): Promise<{ filename: string; buffer: Buffer }> {
  const chat = repos.chats.get(accountId, chatId);
  if (!chat) throw new Error('chat not found');
  const name = (chat.name ?? chat.phoneNumber ?? 'chat').replace(/[^\w.-]+/g, '_');

  const jsonOut = exportChat(repos, accountId, chatId, 'json');
  const htmlOut = exportChat(repos, accountId, chatId, 'html');
  const entries: ZipEntry[] = [
    { name: 'messages.json', data: Buffer.from(jsonOut.content, 'utf8') },
    { name: 'messages.html', data: Buffer.from(htmlOut.content, 'utf8') },
  ];

  const messages = repos.messages.list(accountId, chatId, { limit: 1_000_000 });
  const seen = new Set<string>();
  for (const m of messages) {
    for (const media of repos.media.listByMessage(accountId, m.id)) {
      if (media.downloadStatus !== 'ARCHIVED' || !media.storagePath) continue;
      if (!storage.exists(media.storagePath)) continue;
      const ext = media.storagePath.split('.').pop() ?? 'bin';
      let fname = `media/${media.originalFilename ?? `${media.id}.${ext}`}`.replace(/[^\w./-]+/g, '_');
      // Avoid collisions on duplicate original filenames.
      if (seen.has(fname)) fname = `media/${media.id}.${ext}`;
      seen.add(fname);
      entries.push({ name: fname, data: await storage.read(media.storagePath) });
    }
  }

  return { filename: `${name}.zip`, buffer: createZip(entries) };
}

function csv(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderHtml(title: string, messages: { timestamp: number; direction: string; text: string | null; caption: string | null; messageType: string; whatsappDeleted: boolean }[]): string {
  const rows = messages
    .map((m) => {
      const out = m.direction === 'OUTGOING';
      const body = esc(m.text ?? m.caption ?? `<${m.messageType.toLowerCase()}>`);
      const del = m.whatsappDeleted ? '<div class="del">deleted from WhatsApp · archived copy</div>' : '';
      return `<div class="b ${out ? 'out' : 'in'}"><div class="t">${body}${del}</div><div class="ts">${new Date(m.timestamp).toLocaleString()}</div></div>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — WA Archive</title>
<style>
body{background:#0b141a;color:#e9edef;font-family:system-ui,sans-serif;margin:0;padding:24px}
h1{font-size:18px} .wrap{max-width:720px;margin:0 auto}
.b{max-width:75%;margin:6px 0;padding:6px 10px;border-radius:8px}
.b.in{background:#202c33} .b.out{background:#005c4b;margin-left:auto}
.ts{font-size:10px;color:#8696a0;text-align:right;margin-top:4px}
.del{font-size:10px;color:#f2c14e;margin-top:4px}
</style></head><body><div class="wrap"><h1>${esc(title)}</h1><p style="color:#8696a0;font-size:12px">Exported from WA Archive · ${messages.length} messages</p>${rows}</div></body></html>`;
}
