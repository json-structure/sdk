import type { ElectronBridge } from './contracts';

declare global {
  interface Window {
    electronAPI: ElectronBridge;
  }
}

export {};