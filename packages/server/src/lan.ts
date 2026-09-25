import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

/** Enumerate this machine's private LAN IPv4 addresses (spec §41, §56). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

export interface LanInfo {
  enabled: boolean;
  urls: string[];
  /** QR encoding the primary LAN URL — contains NO secrets (spec §43). */
  qr: string | null;
}

/** Build LAN access info + a QR of the URL for phone pairing (spec §43). */
export async function lanInfo(host: string, port: number, https: boolean): Promise<LanInfo> {
  const scheme = https ? 'https' : 'http';
  const enabled = host === '0.0.0.0' || (!host.startsWith('127.') && host !== 'localhost');
  const urls = enabled
    ? lanAddresses().map((ip) => `${scheme}://${ip}:${port}`)
    : [`${scheme}://127.0.0.1:${port}`];
  const primary = urls[0] ?? null;
  const qr = primary ? await QRCode.toDataURL(primary, { margin: 1, width: 240 }) : null;
  return { enabled, urls, qr };
}
