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
