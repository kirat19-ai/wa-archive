import { describe, expect, it } from 'vitest';
import type { WAMessage } from '@whiskeysockets/baileys';
import { MessageDirection, MessageType, MediaType } from '@wa-archive/shared';
import { contentKeyToMessageType, normalizeMessage } from '../src/baileys/normalize.js';

/**
 * Unit tests for Baileys → normalized mapping (spec §11, §20). These run without
 * a socket or a phone: we feed fixture proto objects shaped like Baileys output.
 */
describe('Baileys normalize', () => {
  it('maps content keys to normalized message types', () => {
    expect(contentKeyToMessageType('conversation')).toBe(MessageType.TEXT);
    expect(contentKeyToMessageType('extendedTextMessage')).toBe(MessageType.TEXT);
    expect(contentKeyToMessageType('imageMessage')).toBe(MessageType.IMAGE);
    expect(contentKeyToMessageType('videoMessage')).toBe(MessageType.VIDEO);
    expect(contentKeyToMessageType('documentMessage')).toBe(MessageType.DOCUMENT);
    expect(contentKeyToMessageType('stickerMessage')).toBe(MessageType.STICKER);
    expect(contentKeyToMessageType(undefined)).toBe(MessageType.UNKNOWN);
    expect(contentKeyToMessageType('somethingNew' as never)).toBe(MessageType.UNKNOWN);
  });

  it('normalizes a simple incoming text message', () => {
    const wa = {
      key: { remoteJid: '919812345678@s.whatsapp.net', fromMe: false, id: 'ABC123' },
      messageTimestamp: 1_700_000_000,
      pushName: 'Rahul',
      message: { conversation: 'Send me the invoice.' },
    } as unknown as WAMessage;

    const res = normalizeMessage(wa)!;
    expect(res).not.toBeNull();
    expect(res.message.whatsappMessageId).toBe('ABC123');
    expect(res.message.direction).toBe(MessageDirection.INCOMING);
    expect(res.message.messageType).toBe(MessageType.TEXT);
    expect(res.message.text).toBe('Send me the invoice.');
    expect(res.message.timestamp).toBe(1_700_000_000 * 1000);
    expect(res.pushName).toBe('Rahul');
  });

  it('normalizes an outgoing image with caption and media ref', () => {
    const wa = {
      key: { remoteJid: '919812345678@s.whatsapp.net', fromMe: true, id: 'IMG1' },
      messageTimestamp: 1_700_000_100,
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'the invoice',
          fileLength: 204800,
          width: 1080,
          height: 1350,
        },
      },
    } as unknown as WAMessage;

    const { message } = normalizeMessage(wa)!;
    expect(message.direction).toBe(MessageDirection.OUTGOING);
    expect(message.messageType).toBe(MessageType.IMAGE);
    expect(message.caption).toBe('the invoice');
    expect(message.media).toMatchObject({
      mediaType: MediaType.IMAGE,
      mimeType: 'image/jpeg',
      fileSize: 204800,
      width: 1080,
      height: 1350,
    });
    expect(message.media?.downloadToken).toBe(wa); // original msg retained for download
  });

  it('classifies a voice note (ptt audio) distinctly from plain audio', () => {
    const base = (ptt: boolean) =>
      ({
        key: { remoteJid: 'g@g.us', fromMe: false, id: `A${ptt}`, participant: '55@s.whatsapp.net' },
        messageTimestamp: 1,
        message: { audioMessage: { mimetype: 'audio/ogg', ptt, seconds: 7 } },
      }) as unknown as WAMessage;

    expect(normalizeMessage(base(true))!.message.media?.mediaType).toBe(MediaType.VOICE_NOTE);
    expect(normalizeMessage(base(false))!.message.media?.mediaType).toBe(MediaType.AUDIO);
  });

  it('extracts group participant and reply/forward context', () => {
    const wa = {
      key: {
        remoteJid: '120363000000000000@g.us',
        fromMe: false,
        id: 'GRP1',
        participant: '919800000001@s.whatsapp.net',
      },
      messageTimestamp: 2,
      message: {
        extendedTextMessage: {
          text: 'replying',
          contextInfo: { stanzaId: 'ORIGINAL_ID', isForwarded: true },
        },
      },
    } as unknown as WAMessage;

    const { message } = normalizeMessage(wa)!;
    expect(message.participantId).toBe('919800000001@s.whatsapp.net');
    expect(message.senderId).toBe('919800000001@s.whatsapp.net');
    expect(message.quotedMessageId).toBe('ORIGINAL_ID');
    expect(message.forwarded).toBe(true);
  });

  it('never throws on an unknown/empty message type (spec §20)', () => {
    const wa = {
      key: { remoteJid: 'x@s.whatsapp.net', fromMe: false, id: 'UNK' },
      messageTimestamp: 3,
      message: { someFutureMessage: { foo: 1 } },
    } as unknown as WAMessage;
    const { message } = normalizeMessage(wa)!;
    expect(message.messageType).toBe(MessageType.UNKNOWN);
    expect(message.media).toBeNull();
  });

  it('returns null when key is unusable', () => {
    expect(normalizeMessage({ key: {} } as unknown as WAMessage)).toBeNull();
  });
});
