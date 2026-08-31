import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { ElectronBridge, FileCommand, FileOpenedEvent } from './contracts';

const bridge: ElectronBridge = {
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (path, text) => ipcRenderer.invoke('file:save', { path, text }),
  saveFileAs: (text) => ipcRenderer.invoke('file:save-as', { text }),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  onFileOpened: (listener) => {
    const handler = (_event: IpcRendererEvent, file: FileOpenedEvent) => listener(file);
    ipcRenderer.on('file:opened', handler);
    return () => ipcRenderer.removeListener('file:opened', handler);
  },
  onFileCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: FileCommand) => listener(command);
    ipcRenderer.on('file:command', handler);
    return () => ipcRenderer.removeListener('file:command', handler);
  },
};

// Expose a narrow, typed API; the renderer never receives Node.js or Electron primitives.
contextBridge.exposeInMainWorld('electronAPI', bridge);