import { useEffect, useState } from 'react';
import type { DeviceDTO, LanInfoDTO } from '../../../shared-ipc/contract';

interface Props {
  onClose: () => void;
}

/** Admin: LAN pairing (URL + QR, spec §43) and connected-device management (spec §50, §83). */
export function DevicesPanel({ onClose }: Props) {
  const [lan, setLan] = useState<LanInfoDTO | null>(null);
  const [devices, setDevices] = useState<DeviceDTO[]>([]);

  const load = () => {
    void window.wa.admin?.lanInfo().then(setLan);
    void window.wa.admin?.devices().then(setDevices);
  };
  useEffect(load, []);

  const revoke = async (id: string) => {
    await window.wa.admin?.revokeDevice(id);
    load();
  };

  const active = devices.filter((d) => !d.revokedAt);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        <h3>Local access &amp; devices</h3>

        <div className="danger-box">
          <div className="danger-title">Access from a phone (same Wi-Fi)</div>
          {lan?.enabled ? (
            <>
              <p>Scan to open the archive on your phone. The QR contains only the URL — no secrets.</p>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                {lan.qr && <img src={lan.qr} width={160} height={160} alt="LAN URL QR" style={{ borderRadius: 8 }} />}
                <div style={{ fontSize: 13 }}>
                  {lan.urls.map((u) => (
                    <div key={u} style={{ color: 'var(--accent)' }}>{u}</div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p>
              LAN access is <strong>off</strong> (loopback only). Restart the server with
              <code> HOST=0.0.0.0 </code> to allow phones on your network.
            </p>
          )}
        </div>

        <div className="danger-title" style={{ marginTop: 6 }}>Authorized devices ({active.length})</div>
        <div className="device-list">
          {active.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No active devices.</div>}
          {active.map((d) => (
            <div className="device-row" key={d.id}>
              <div>
                <div style={{ fontWeight: 500 }}>{d.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {d.ipAddress ?? 'unknown IP'} · {d.accountScope ? 'account' : 'admin'} ·{' '}
                  {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}
                </div>
              </div>
              <button className="btn danger" onClick={() => revoke(d.id)}>
                Revoke
              </button>
            </div>
          ))}
        </div>

        <div className="actions">
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
