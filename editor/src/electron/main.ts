import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type OpenDialogOptions } from 'electron';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpath } from 'node:fs/promises';
import { atomicWrite, readFile, readResource } from './file-service';
import { isConversionRequest, isLibraryOperationRequest, isProtocolEnvelope, PROTOCOL_VERSION, type OpenGeneratedOutputRequest } from '../contracts';
import { NodeConversionHost } from '../conversion/node-host';
import { dispatchLibraryOperation, type LibraryHostRuntime } from '../libraries/host-runtime';
import { createElectronLibraryRuntime } from './library-runtime';
import { deniedWindowOpen, isAllowedRendererNavigation, isTrustedIpcSender, selectDevelopmentUrl, selectInitialDocumentArgument } from './security';

const currentDirectory = __dirname;
const rendererDirectory = join(currentDirectory, '..', 'dist', 'renderer');
let mainWindow: BrowserWindow | null = null;
let allowedRendererUrl: string | undefined;
let pendingPath: string | undefined;
let openedDocumentRoot: string | undefined;
let approvedDocumentPath: string | undefined;
const maxImportedResourceBytes = 4 * 1024 * 1024;
const runtimeRoot = app.isPackaged ? join(process.resourcesPath, 'conversion') : join(app.getAppPath(), 'src', 'conversion');
const coreLibraryPath = app.isPackaged ? join(process.resourcesPath, 'libraries', 'financial-types.struct.json') : join(app.getAppPath(), '..', 'vscode', 'test-fixtures', 'financial-types', 'schema.struct.json');
const coreLibraryEntry = { id: 'financial-types', name: 'Financial Types', description: 'A bundled JSON Structure type library sample.', versions: [{ version: '1.0.0', documentUri: coreLibraryPath, isDefault: true }] } as const;
let libraryRuntime: Promise<LibraryHostRuntime> | undefined;
const conversionHost = new NodeConversionHost({
  runtimeRoot,
  destination: async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose conversion output directory', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? undefined : result.filePaths[0];
  },
  launch: async (path) => { const error = await shell.openPath(path); if (error) throw new Error(error); },
  progress: (request, phase, completed, total, message) => mainWindow?.webContents.send('conversion:progress', { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, documentVersion: request.documentVersion, phase, percent: total > 0 ? Math.max(0, Math.min(100, completed / total * 100)) : undefined, message }),
});

function sendHostCommand(command: 'open' | 'save' | 'save-as' | 'show-commands'): void {
  mainWindow?.webContents.send('file:command', command);
}

function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => sendHostCommand('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendHostCommand('save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendHostCommand('save-as') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ label: 'Command Palette...', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendHostCommand('show-commands') }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [{ label: 'JSON Structure Website', click: () => { void shell.openExternal('https://json-structure.org/'); } }] },
  ];
  if (process.platform === 'darwin') template.unshift({ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function readInitialFile(): Promise<{ path: string; text: string } | null> {
  const candidate = pendingPath ?? selectInitialDocumentArgument(process.argv.slice(1));
  if (!candidate) return null;

  try {
    const file = await readFile(candidate);
    if (file) { approvedDocumentPath = await canonicalPath(file.path); openedDocumentRoot = dirname(approvedDocumentPath); return { ...file, path: approvedDocumentPath }; }
    return file;
  } catch {
    return null;
  } finally {
    pendingPath = undefined;
  }
}

function registerIpcHandlers(): void {
  const fileDialogOptions: OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'JSON Structure', extensions: ['json', 'struct.json'] }] };
  handleTrusted('file:open', async () => {
    const result = await dialog.showOpenDialog(fileDialogOptions);
    const path = result.canceled ? undefined : result.filePaths[0];
    const file = path ? await readFile(path) : null;
    if (file) { approvedDocumentPath = await canonicalPath(file.path); openedDocumentRoot = dirname(approvedDocumentPath); return { ...file, path: approvedDocumentPath }; }
    return file;
  });
  handleTrusted('file:save', async (_event, request: { path: string; text: string }) => {
    if (!approvedDocumentPath || await canonicalPath(request.path) !== approvedDocumentPath) throw new Error('Save destination was not approved by an open or save dialog.');
    await atomicWrite(approvedDocumentPath, request.text);
    return { path: approvedDocumentPath };
  });
  handleTrusted('file:save-as', async (_event, request: { text: string }) => {
    const result = await dialog.showSaveDialog({ filters: [{ name: 'JSON Structure', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    await atomicWrite(result.filePath, request.text);
    approvedDocumentPath = await canonicalPath(result.filePath);
    openedDocumentRoot = dirname(approvedDocumentPath);
    return { path: approvedDocumentPath };
  });
  handleTrusted('external:open', async (_event, url: string) => {
    if (new URL(url).protocol !== 'https:') throw new Error('Only HTTPS external links are allowed.');
    await shell.openExternal(url);
  });
  handleTrusted('resource:read', async (_event, uri: string) => {
    if (!openedDocumentRoot) throw new Error('Open a document before loading imported resources.');
    const resource = await readResource(uri, openedDocumentRoot, maxImportedResourceBytes);
    return { ...resource, contentHash: createHash('sha256').update(resource.content).digest('hex') };
  });
  handleTrusted('conversion:list', (_event, request: unknown) => {
    if (!isProtocolEnvelope(request)) throw new Error('Invalid conversion command request.');
    return conversionHost.listCommands();
  });
  handleTrusted('conversion:run', async (_event, request: unknown) => {
    if (!isConversionRequest(request)) throw new Error('Invalid conversion request.');
    return conversionHost.convert(request);
  });
  handleTrusted('conversion:cancel', (_event, request: unknown) => {
    if (!isProtocolEnvelope(request)) throw new Error('Invalid conversion cancellation request.');
    conversionHost.cancel(request.requestId);
  });
  handleTrusted('conversion:open', async (_event, request: OpenGeneratedOutputRequest) => {
    if (!isProtocolEnvelope(request) || request.kind !== 'open-generated-output' || !Array.isArray(request.outputs) || request.outputs.length !== 1) throw new Error('Invalid generated output request.');
    try {
      await conversionHost.open(request.outputs[0]);
      return { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, opened: true };
    } catch (error) {
      return { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, opened: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  handleTrusted('library:request', async (_event, request: unknown) => {
    if (!isLibraryOperationRequest(request)) throw new Error('Invalid library request.');
    return dispatchLibraryOperation(await getLibraryRuntime(), request.operation, request.payload);
  });
}

function handleTrusted(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, (event, ...args) => {
    const expectedWindow = mainWindow;
    const expectedUrl = allowedRendererUrl;
    const frame = event.senderFrame;
    if (!expectedWindow || !expectedUrl || !frame || !isTrustedIpcSender({
      senderId: event.sender.id,
      expectedSenderId: expectedWindow.webContents.id,
      senderDestroyed: event.sender.isDestroyed(),
      isMainFrame: frame === event.sender.mainFrame,
      frameUrl: frame.url,
      expectedUrl,
    })) throw new Error('IPC request rejected: untrusted renderer sender.');
    return listener(event, ...args);
  });
}

function getLibraryRuntime(): Promise<LibraryHostRuntime> {
  libraryRuntime ??= createElectronLibraryRuntime({
    userDataPath: app.getPath('userData'),
    bundledRoot: dirname(coreLibraryPath),
    documentRoot: () => openedDocumentRoot,
    safeStorage,
    bundledProvider: { id: 'financial-types', kind: 'bundled', location: dirname(coreLibraryPath), entries: [coreLibraryEntry] },
  });
  return libraryRuntime;
}

async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch { return join(await realpath(dirname(path)), path.split(/[\\/]/).pop()!); }
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const developmentUrl = selectDevelopmentUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL);
  allowedRendererUrl = developmentUrl ?? pathToFileURL(join(rendererDirectory, 'index.html')).href;
  const expectedUrl = allowedRendererUrl;
  mainWindow.webContents.setWindowOpenHandler(() => deniedWindowOpen);
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererNavigation(url, expectedUrl)) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    if (mainWindow?.webContents.id === eventWindowId) { mainWindow = null; allowedRendererUrl = undefined; }
  });
  const eventWindowId = mainWindow.webContents.id;
  const initialFile = await readInitialFile();
  if (developmentUrl) await mainWindow.loadURL(developmentUrl);
  else await mainWindow.loadFile(join(rendererDirectory, 'index.html'));
  if (initialFile) mainWindow.webContents.send('file:opened', initialFile);
}

app.on('open-file', (event, path) => {
  event.preventDefault();
  pendingPath = path;
  if (mainWindow) void readInitialFile().then((file) => file && mainWindow?.webContents.send('file:opened', file));
});

app.whenReady().then(() => {
  registerIpcHandlers();
  installApplicationMenu();
  void createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});