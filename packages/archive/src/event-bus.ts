import { EventEmitter } from 'node:events';
import { AppEvent, type AppEventName } from '@wa-archive/shared';

/**
 * Process-wide typed event bus (spec §68). Producers (archive engine, sync,
 * device manager) emit; consumers (LAN WebSocket bridge, UI IPC) subscribe.
 * Payloads are plain JSON-serializable objects.
 */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  emit(event: AppEventName, payload: unknown): void {
    this.emitter.emit(event, payload);
  }

  on(event: AppEventName, cb: (payload: unknown) => void): () => void {
    this.emitter.on(event, cb);
    return () => this.emitter.off(event, cb);
  }

  /** Subscribe to every known event (used by the LAN WebSocket bridge, spec §58). */
  onAny(cb: (event: AppEventName, payload: unknown) => void): () => void {
    const offs = Object.values(AppEvent).map((event) =>
      this.on(event, (payload) => cb(event, payload)),
    );
    return () => offs.forEach((off) => off());
  }
}
