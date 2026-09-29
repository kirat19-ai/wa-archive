import { describe, expect, it } from 'vitest';
import { MessageDirection, MessageType } from '@wa-archive/shared';
import { buildImportPlan, parseWhatsAppExport } from '../src/import-chat.js';

const IOS = `[15/01/2024, 14:30:22] John Doe: Hey there
[15/01/2024, 14:31:00] Me: Hi! how are you
this is a wrapped second line
[15/01/2024, 14:32:10] John Doe: ‎<Media omitted>`;

const ANDROID = `15/01/2024, 14:30 - John Doe: Hey there
15/01/2024, 14:31 - Me: all good
16/01/2024, 09:05 - Messages and calls are end-to-end encrypted.`;

describe('WhatsApp export parser', () => {
  it('parses the iOS bracket format, wrapped lines and media', () => {
    const p = parseWhatsAppExport(IOS);
    expect(p.lines).toHaveLength(3);
    expect(p.lines[0]!.sender).toBe('John Doe');
    expect(p.lines[0]!.body).toBe('Hey there');
    // wrapped continuation joined
    expect(p.lines[1]!.body).toContain('wrapped second line');
    expect(p.lines[2]!.isMedia).toBe(true);
    expect(p.senders).toContain('John Doe');
    expect(p.senders).toContain('Me');
  });

  it('parses the Android dash format and flags system notices', () => {
    const p = parseWhatsAppExport(ANDROID);
    const real = p.lines.filter((l) => !l.isSystem);
    expect(real).toHaveLength(2);
    const sys = p.lines.filter((l) => l.isSystem);
    expect(sys).toHaveLength(1);
    expect(sys[0]!.body).toContain('end-to-end encrypted');
  });

  it('assigns direction by "which name is me" and is dedup-stable', () => {
    const p = parseWhatsAppExport(IOS);
    const plan = buildImportPlan(
      p,
      { whatsappChatId: '123@s.whatsapp.net', name: 'John Doe', phoneNumber: null },
      'Me',
    );
    // 3 lines, 0 system → 3 messages
    expect(plan.messages).toHaveLength(3);
    const mine = plan.messages.find((m) => m.direction === MessageDirection.OUTGOING);
    expect(mine).toBeTruthy();
    expect(plan.messages[0]!.direction).toBe(MessageDirection.INCOMING);
    expect(plan.messages[2]!.messageType).toBe(MessageType.IMAGE);
    // Re-parsing/rebuilding yields the SAME synthetic ids (idempotent import).
    const plan2 = buildImportPlan(
      p,
      { whatsappChatId: '123@s.whatsapp.net', name: 'John Doe', phoneNumber: null },
      'Me',
    );
    expect(plan2.messages.map((m) => m.whatsappMessageId)).toEqual(
      plan.messages.map((m) => m.whatsappMessageId),
    );
  });
});

import { buildBulkImportPlan, looksLikeExporterJson } from '../src/import-chat.js';

const EXPORTER_JSON = {
  '919000000000@s.whatsapp.net': {
    name: 'Mom',
    type: 'IOS',
    messages: {
      '1': { from_me: false, timestamp: 1705329022, data: 'Beta khana khaya?', media: false, key_id: 'AAA111' },
      '2': { from_me: true, timestamp: 1705329060, data: 'haan mummy', media: false, key_id: 'BBB222' },
      '3': { from_me: false, timestamp: 1705329070, meta: true, data: 'security code changed' },
      '4': { from_me: false, timestamp: 1705329090, media: true, mime: 'image/jpeg', caption: 'pic', key_id: 'CCC333' },
    },
  },
  '120363000@g.us': {
    name: 'Family Group',
    type: 'IOS',
    messages: {
      '1': { from_me: false, timestamp: 1705330000, data: 'hi all', sender: 'Uncle', media: false, key_id: 'G1' },
    },
  },
  'status@broadcast': { name: null, type: 'IOS', messages: { '1': { timestamp: 1, data: 'x' } } },
};

describe('bulk exporter JSON import', () => {
  it('detects exporter JSON', () => {
    expect(looksLikeExporterJson(JSON.stringify(EXPORTER_JSON))).toBe(true);
    expect(looksLikeExporterJson('[15/01/2024, 14:30:22] A: hi')).toBe(false);
  });

  it('builds per-chat plans, skips meta + status, maps groups/media/direction', () => {
    const plans = buildBulkImportPlan(EXPORTER_JSON as never);
    // status@broadcast skipped → 2 chats
    expect(plans).toHaveLength(2);
    const mom = plans.find((p) => p.chat.name === 'Mom')!;
    // meta message skipped → 3 messages (text, text, media)
    expect(mom.messages).toHaveLength(3);
    expect(mom.chat.chatType).toBe('INDIVIDUAL');
    expect(mom.chat.phoneNumber).toBe('+919000000000');
    expect(mom.messages[0]!.direction).toBe(MessageDirection.INCOMING);
    expect(mom.messages[1]!.direction).toBe(MessageDirection.OUTGOING);
    expect(mom.messages[2]!.messageType).toBe(MessageType.IMAGE);
    // uses WhatsApp key id (dedups against live)
    expect(mom.messages[0]!.whatsappMessageId).toBe('AAA111');
    const grp = plans.find((p) => p.chat.name === 'Family Group')!;
    expect(grp.chat.chatType).toBe('GROUP');
  });
});
