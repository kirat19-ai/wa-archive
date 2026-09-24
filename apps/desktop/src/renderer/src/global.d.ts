import type { WaApi } from '../../shared-ipc/contract';

declare global {
  interface Window {
    wa: WaApi;
  }
}

export {};
