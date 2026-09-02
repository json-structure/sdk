import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { ElectronBridge, HostCommand, FileOpenedEvent } from './contracts';
import type { LibraryOperation } from '../contracts';

let libraryRequestId = 0;

function libraryRequest<T>(operation: LibraryOperation, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke('library:request', { protocolVersion: 1, requestId: `library-${++libraryRequestId}`, kind: 'library-request', operation, payload });
}

const bridge: ElectronBridge = {
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (path, text) => ipcRenderer.invoke('file:save', { path, text }),
  saveFileAs: (text) => ipcRenderer.invoke('file:save-as', { text }),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  readResource: (uri) => ipcRenderer.invoke('resource:read', uri),
  listConversionCommands: () => ipcRenderer.invoke('conversion:list', { protocolVersion: 1, requestId: `commands-${Date.now()}` }),
  selectConversionSource: (request) => ipcRenderer.invoke('conversion:source', request),
  convert: (request) => ipcRenderer.invoke('conversion:run', request),
  onConversionProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on('conversion:progress', handler);
    return () => ipcRenderer.removeListener('conversion:progress', handler);
  },
  cancelConversion: (requestId) => ipcRenderer.invoke('conversion:cancel', { protocolVersion: 1, requestId }),
  openGeneratedOutput: (request) => ipcRenderer.invoke('conversion:open', request),
  libraryRequest,
  listLibraryEntries: async () => (await libraryRequest<readonly import('../libraries/host-runtime').LibraryCatalogEntry[]>('listCatalog')).map(({ providerId: _providerId, ...entry }) => entry),
  readLibraryDocument: async (entryId, version) => {
    const catalog = await libraryRequest<readonly import('../libraries/host-runtime').LibraryCatalogEntry[]>('listCatalog');
    const entry = catalog.find((candidate) => candidate.id === entryId && candidate.versions.some((candidateVersion) => candidateVersion.version === version));
    if (!entry) throw new Error(`Library document '${entryId}@${version}' is not available.`);
    const resolved = await libraryRequest<import('../libraries/host-runtime').LibraryHostResolution>('resolve', { providerId: entry.providerId, entryId, selector: { kind: 'pinned', version }, offline: false });
    return { entryId, version, uri: resolved.documentUri, value: resolved.document };
  },
  onFileOpened: (listener) => {
    const handler = (_event: IpcRendererEvent, file: FileOpenedEvent) => listener(file);
    ipcRenderer.on('file:opened', handler);
    return () => ipcRenderer.removeListener('file:opened', handler);
  },
  onFileCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: HostCommand) => listener(command);
    ipcRenderer.on('file:command', handler);
    return () => ipcRenderer.removeListener('file:command', handler);
  },
  executeWindowCommand: (command) => ipcRenderer.invoke('window:command', command),
  setTitleBarTheme: (theme) => ipcRenderer.invoke('window:titlebar-theme', theme),
};

// Expose a narrow, typed API; the renderer never receives Node.js or Electron primitives.
contextBridge.exposeInMainWorld('electronAPI', bridge);