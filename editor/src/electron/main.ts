import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type OpenDialogOptions } from 'electron';
import type { HostCommand, OpenFileResult, WindowCommand } from './contracts';
import { classifyGeneratedOutputPaths, commonGeneratedOutputDirectory, createConversionDocumentContext, createFileDocumentContext, createUntitledDocumentContext, DocumentActivationLedger, type ConversionDocumentContext, type FileDocumentKind } from './document-workflow';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpath } from 'node:fs/promises';
import { atomicWrite, readBoundedFile, readFile, readResource } from './file-service';
import { discoverImportSources, loadExternalDocuments, materializeEffectiveImports, ResolvedSchemaContext } from '../host/effective-imports';
import { isConversionRequest, isLibraryOperationRequest, isProtocolEnvelope, PROTOCOL_VERSION, type OpenGeneratedOutputRequest } from '../contracts';
import { NodeConversionHost } from '../conversion/node-host';
import { dispatchLibraryOperation, type LibraryHostRuntime } from '../libraries/host-runtime';
import { createElectronLibraryRuntime, type ElectronLibraryApprovalRequest } from './library-runtime';
import { deniedWindowOpen, isAllowedRendererNavigation, isTrustedIpcSender, selectDevelopmentUrl, selectInitialDocumentArgument } from './security';
import { nextZoomFactor, windowCommandForShortcut } from './window-controls';

const currentDirectory = __dirname;
const rendererDirectory = join(currentDirectory, '..', 'dist', 'renderer');
const appIconPath = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'assets', 'icon.png');
let mainWindow: BrowserWindow | null = null;
let allowedRendererUrl: string | undefined;
let rendererReady = false;
let pendingPath: string | undefined;
let openedDocumentRoot: string | undefined;
let approvedDocumentPath: string | undefined;
const documentActivations = new DocumentActivationLedger();
const committedGeneratedPaths = new Set<string>();
let latestOpenRequest = 0;
let documentStateGeneration = 0;
let latestSaveAsRequest = 0;
const maxImportedResourceBytes = 4 * 1024 * 1024;
const maxConversionSourceBytes = 4 * 1024 * 1024;
const runtimeRoot = app.isPackaged ? join(process.resourcesPath, 'conversion') : join(app.getAppPath(), 'src', 'conversion');
const coreLibraryPath = app.isPackaged ? join(process.resourcesPath, 'libraries', 'financial-types.struct.json') : join(app.getAppPath(), '..', 'vscode', 'test-fixtures', 'financial-types', 'schema.struct.json');
const coreLibraryEntry = { id: 'financial-types', name: 'Financial Types', description: 'A bundled JSON Structure type library sample.', versions: [{ version: '1.0.0', documentUri: pathToFileURL(coreLibraryPath).toString(), isDefault: true }] } as const;
let libraryRuntime: Promise<LibraryHostRuntime> | undefined;
const approvedLibraryRequests = new Set<string>();
const approvedImportRoots = new Set<string>();
function activeMainWindow(): BrowserWindow | undefined {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

async function readDesktopResource(uri: string) {
  const libraryReader = async (requestedUri: string) => (await getLibraryRuntime()).readResource(requestedUri);
  let containmentError: Error | undefined;
  for (const root of [openedDocumentRoot, ...approvedImportRoots]) {
    if (!root) continue;
    try {
      return await readResource(uri, root, maxImportedResourceBytes, libraryReader);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('inside the opened document directory')) throw error;
      containmentError = error;
    }
  }
  if (!containmentError) return readResource(uri, openedDocumentRoot, maxImportedResourceBytes, libraryReader);

  const parsed = new URL(uri);
  if (parsed.protocol !== 'file:') throw containmentError;
  const canonicalPath = await realpath(fileURLToPath(parsed));
  const requestedRoot = dirname(canonicalPath);
  const options = {
    type: 'question' as const,
    buttons: ['Allow import', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Allow imported schema access?',
    message: 'This schema imports a file outside the opened document directory.',
    detail: `Allow access to imported schemas in:\n${requestedRoot}`,
  };
  const owner = activeMainWindow();
  const decision = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  if (decision.response !== 0) throw new Error('Imported resource access was not approved.');
  approvedImportRoots.add(requestedRoot);
  return readResource(uri, requestedRoot, maxImportedResourceBytes, libraryReader);
}

function captureConversionDocumentContext(): ConversionDocumentContext {
  return createConversionDocumentContext(approvedDocumentPath, openedDocumentRoot);
}

function createConversionHost(context: ConversionDocumentContext = { documentPath: undefined, documentRoot: undefined, documentUri: undefined }): NodeConversionHost {
  return new NodeConversionHost({
    runtimeRoot,
    destination: async () => {
      if (process.env.JSON_STRUCTURE_REAL_HOST_TEST === '1' && process.env.JSON_STRUCTURE_REAL_HOST_OUTPUT_DIR) return process.env.JSON_STRUCTURE_REAL_HOST_OUTPUT_DIR;
      const result = await dialog.showOpenDialog({ title: 'Choose conversion output directory', properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? undefined : result.filePaths[0];
    },
    progress: (request, phase, completed, total, message) => activeMainWindow()?.webContents.send('conversion:progress', { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, documentVersion: request.documentVersion, phase, percent: total > 0 ? Math.max(0, Math.min(100, completed / total * 100)) : undefined, message }),
    effectiveImports: {
      resolve: async ({ sourceName, source, signal }) => {
        if (signal.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
        const text = new TextDecoder().decode(source);
        let value: unknown;
        try { value = JSON.parse(text); } catch { return source; }
        if (!isRecord(value)) return source;
        const sources = discoverImportSources(value);
        if (sources.length === 0) return source;
        const documentUri = context.documentUri ?? 'memory://json-structure-conversion/' + encodeURIComponent(sourceName);
        const external = await loadExternalDocuments(documentUri, sources, async (uri) => {
          if (signal.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
          const resource = await readResource(uri, context.documentRoot, maxImportedResourceBytes, async (requestedUri) => (await getLibraryRuntime()).readResource(requestedUri));
          return { protocolVersion: PROTOCOL_VERSION, requestId: 'conversion-import-' + randomUUID(), uri: resource.uri, content: resource.content, contentHash: '' };
        });
        const resolved = new ResolvedSchemaContext(value, { documentUri, resolvedDocuments: external.flatMap((item) => item.value ? [{ uri: item.uri, document: item.value }] : []) });
        const materialized = materializeEffectiveImports(value, resolved);
        return new TextEncoder().encode(JSON.stringify(materialized));
      },
    },
  });
}

const conversionHost = createConversionHost();
const activeConversionHosts = new Map<string, NodeConversionHost>();

function sendHostCommand(command: HostCommand): void {
  activeMainWindow()?.webContents.send('file:command', command);
}

function executeWindowCommand(contents: Electron.WebContents, command: WindowCommand): void {
  const commands: Record<WindowCommand, () => void> = {
    undo: () => contents.undo(),
    redo: () => contents.redo(),
    cut: () => contents.cut(),
    copy: () => contents.copy(),
    paste: () => contents.paste(),
    'select-all': () => contents.selectAll(),
    'reset-zoom': () => contents.setZoomFactor(1),
    'zoom-in': () => contents.setZoomFactor(nextZoomFactor(contents.getZoomFactor(), 'in')),
    'zoom-out': () => contents.setZoomFactor(nextZoomFactor(contents.getZoomFactor(), 'out')),
    'toggle-fullscreen': () => {
      const window = BrowserWindow.fromWebContents(contents);
      if (window && !window.isDestroyed()) window.setFullScreen(!window.isFullScreen());
    },
    quit: () => app.quit(),
  };
  const execute = commands[command];
  if (!execute) throw new Error('Unknown window command.');
  execute();
}

function stageDocument(file: { path: string; text: string }, kind: FileDocumentKind): OpenFileResult & { readonly activationToken: string; readonly uri: string; readonly kind: FileDocumentKind } {
  const context = createFileDocumentContext(file.path, file.text, kind);
  const staged = documentActivations.stage(context);
  return staged;
}

function stageDocumentIfCurrent(file: { path: string; text: string }, kind: FileDocumentKind, expectedGeneration: number): (OpenFileResult & { readonly activationToken: string; readonly uri: string; readonly kind: FileDocumentKind }) | undefined {
  const context = createFileDocumentContext(file.path, file.text, kind);
  return documentActivations.stageIfCurrent(context, expectedGeneration, () => latestOpenRequest);
}

function activateDocument(path: string, activationToken?: string): void {
  if (activationToken) {
    const staged = documentActivations.activate(activationToken);
    if (!staged || staged.path !== path) throw new Error('The selected document is no longer available for activation.');
    approvedDocumentPath = staged.path;
    openedDocumentRoot = dirname(staged.path);
    approvedImportRoots.clear();
    documentStateGeneration += 1;
    ++latestSaveAsRequest;
    return;
  }
  const staged = documentActivations.activatePath(path);
  const current = staged ?? documentActivations.active;
  if (!current || current.path !== path) throw new Error('The selected document is no longer available for activation.');
  approvedDocumentPath = current.path;
  openedDocumentRoot = dirname(current.path);
  approvedImportRoots.clear();
  documentStateGeneration += 1;
  ++latestSaveAsRequest;
}

async function readStagedDocument(path: string, kind: FileDocumentKind, expectedGeneration?: number): Promise<OpenFileResult | null> {
  const file = await readFile(path);
  if (!file) return null;
  return expectedGeneration === undefined ? stageDocument(file, kind) : stageDocumentIfCurrent(file, kind, expectedGeneration) ?? null;
}

function installApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => sendHostCommand('new') },
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => sendHostCommand('open') },
        { label: 'Import...', click: () => sendHostCommand('import') },
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

async function readInitialFile(): Promise<OpenFileResult | null> {
  const candidate = pendingPath ?? selectInitialDocumentArgument(process.argv.slice(1));
  const requestGeneration = latestOpenRequest;
  if (!candidate) return null;
  const clearPendingIfCurrent = (): void => { if (requestGeneration === latestOpenRequest) pendingPath = undefined; };

  try {
    const file = await readFile(candidate);
    if (!file) { clearPendingIfCurrent(); return null; }
    const canonical = await canonicalPath(file.path);
    const opened = stageDocumentIfCurrent({ path: canonical, text: file.text }, 'file', requestGeneration);
    if (!opened) return null;
    pendingPath = undefined;
    activateDocument(opened.path, opened.activationToken);
    return { path: opened.path, text: opened.text, uri: opened.uri, kind: opened.kind };
  } catch {
    clearPendingIfCurrent();
    return null;
  }
}

function registerIpcHandlers(): void {
  const fileDialogOptions: OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'JSON Structure', extensions: ['json', 'struct.json'] }] };
  handleTrusted('file:open', async () => {
    const requestGeneration = ++latestOpenRequest;
    const result = await dialog.showOpenDialog(fileDialogOptions);
    if (result.canceled || !result.filePaths[0] || requestGeneration !== latestOpenRequest) return null;
    const opened = await readStagedDocument(result.filePaths[0], 'file', requestGeneration);
    if (!opened || requestGeneration !== latestOpenRequest) {
      if (opened?.activationToken) documentActivations.discard(opened.activationToken);
      return null;
    }
    return opened;
  });
  handleTrusted('file:activate', async (_event, request: { path: string; activationToken?: string }) => {
    if (typeof request.path !== 'string' || !request.path || (request.activationToken !== undefined && typeof request.activationToken !== 'string')) throw new Error('Invalid document activation request.');
    const path = await canonicalPath(request.path);
    activateDocument(path, request.activationToken);
  });
  handleTrusted('file:discard', (_event, request: { activationToken: string }) => {
    if (typeof request.activationToken !== 'string' || !request.activationToken) throw new Error('Invalid document discard request.');
    documentActivations.discard(request.activationToken);
  });
  handleTrusted('file:new', () => {
    ++latestOpenRequest;
    documentStateGeneration += 1;
    ++latestSaveAsRequest;
    documentActivations.clear();
    approvedDocumentPath = undefined;
    openedDocumentRoot = undefined;
    approvedImportRoots.clear();
    return createUntitledDocumentContext();
  });
  handleTrusted('file:save', async (_event, request: { path: string; text: string }) => {
    if (!approvedDocumentPath || await canonicalPath(request.path) !== approvedDocumentPath) throw new Error('Save destination was not approved by an open or save dialog.');
    await atomicWrite(approvedDocumentPath, request.text);
    return { path: approvedDocumentPath, uri: pathToFileURL(approvedDocumentPath).toString() };
  });
  handleTrusted('file:save-as', async (_event, request: { text: string }) => {
    const stateGeneration = documentStateGeneration;
    const saveAsRequest = ++latestSaveAsRequest;
    const result = await dialog.showSaveDialog({ filters: [{ name: 'JSON Structure', extensions: ['json'] }] });
    if (result.canceled || !result.filePath || stateGeneration !== documentStateGeneration || saveAsRequest !== latestSaveAsRequest) return null;
    await atomicWrite(result.filePath, request.text);
    if (stateGeneration !== documentStateGeneration || saveAsRequest !== latestSaveAsRequest) return null;
    approvedDocumentPath = await canonicalPath(result.filePath);
    openedDocumentRoot = dirname(approvedDocumentPath);
    approvedImportRoots.clear();
    documentActivations.setActive(createFileDocumentContext(approvedDocumentPath, request.text));
    documentStateGeneration += 1;
    return { path: approvedDocumentPath, uri: pathToFileURL(approvedDocumentPath).toString() };
  });
  handleTrusted('external:open', async (_event, url: string) => {
    if (new URL(url).protocol !== 'https:') throw new Error('Only HTTPS external links are allowed.');
    await shell.openExternal(url);
  });
  handleTrusted('window:command', (event, command: WindowCommand) => {
    executeWindowCommand(event.sender, command);
  });
  handleTrusted('window:titlebar-theme', (_event, theme: 'dark' | 'light' | 'contrast') => {
    if (!['dark', 'light', 'contrast'].includes(theme)) throw new Error('Unknown title-bar theme.');
    const colors = theme === 'light'
      ? { color: '#f3f3f3', symbolColor: '#333333' }
      : theme === 'contrast'
        ? { color: '#000000', symbolColor: '#ffffff' }
        : { color: '#181818', symbolColor: '#cccccc' };
    activeMainWindow()?.setTitleBarOverlay({ ...colors, height: 35 });
  });
  handleTrusted('resource:read', async (_event, uri: string) => {
    const resource = await readDesktopResource(uri);
    return { ...resource, contentHash: createHash('sha256').update(resource.content).digest('hex') };
  });
  handleTrusted('conversion:list', (_event, request: unknown) => {
    if (!isProtocolEnvelope(request)) throw new Error('Invalid conversion command request.');
    return conversionHost.listCommands();
  });
  handleTrusted('conversion:source', async (_event, request: unknown) => {
    if (!isProtocolEnvelope(request)) throw new Error('Invalid conversion source request.');
    const sourceRequest = request as unknown as Record<string, unknown>;
    if (sourceRequest.kind !== 'select-conversion-source' || !Array.isArray(sourceRequest.formats) || !sourceRequest.formats.every((format) => typeof format === 'string' && format.length > 0 && format.length <= 64)) throw new Error('Invalid conversion source request.');
    if (sourceRequest.extensions !== undefined && (!Array.isArray(sourceRequest.extensions) || !sourceRequest.extensions.every((extension) => typeof extension === 'string' && /^\.[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/.test(extension)))) throw new Error('Invalid conversion source extensions.');
    const acceptanceSource = process.env.JSON_STRUCTURE_REAL_HOST_TEST === '1'
      ? process.env.JSON_STRUCTURE_REAL_HOST_SOURCE_PATH
      : undefined;
    if (acceptanceSource) {
      const source = await readBoundedFile(acceptanceSource, maxConversionSourceBytes);
      return { uri: pathToFileURL(source.path).toString(), name: source.path.split(/[\\/]/).pop()!, text: source.text };
    }
    const extensions = Array.isArray(sourceRequest.extensions)
      ? sourceRequest.extensions.map((extension) => String(extension).replace(/^\./, ''))
      : ['json', 'avsc', 'yaml', 'yml', 'proto', 'xml', 'xsd'];
    const result = await dialog.showOpenDialog({ title: `Choose ${sourceRequest.formats.join(' or ')} source`, properties: ['openFile'], filters: [{ name: 'Supported source files', extensions }] });
    if (result.canceled || !result.filePaths[0]) return undefined;
    const source = await readBoundedFile(result.filePaths[0], maxConversionSourceBytes);
    return { uri: pathToFileURL(source.path).toString(), name: source.path.split(/[\\/]/).pop()!, text: source.text };
  });
  handleTrusted('conversion:run', async (_event, request: unknown) => {
    if (!isConversionRequest(request)) throw new Error('Invalid conversion request.');
    if (activeConversionHosts.has(request.requestId)) throw new Error('Conversion ' + request.requestId + ' is already running.');
    const host = createConversionHost(captureConversionDocumentContext());
    activeConversionHosts.set(request.requestId, host);
    try {
      const result = await host.convert(request);
      if (result.succeeded) {
        for (const output of result.outputs) committedGeneratedPaths.add(await canonicalPath(output.uri));
      }
      return result;
    } finally {
      activeConversionHosts.delete(request.requestId);
    }
  });
  handleTrusted('conversion:cancel', (_event, request: unknown) => {
    if (!isProtocolEnvelope(request)) throw new Error('Invalid conversion cancellation request.');
    activeConversionHosts.get(request.requestId)?.cancel(request.requestId);
  });
  handleTrusted('conversion:open', async (_event, request: OpenGeneratedOutputRequest) => {
    if (!isProtocolEnvelope(request) || request.kind !== 'open-generated-output' || !Array.isArray(request.outputs) || request.outputs.length === 0 || !request.outputs.every((output) => isRecord(output) && typeof output.uri === 'string' && output.uri.length > 0 && typeof output.name === 'string' && output.name.length > 0)) throw new Error('Invalid generated output request.');
    const requestGeneration = ++latestOpenRequest;
    try {
      const outputPaths = await Promise.all(request.outputs.map(async (output) => {
        const outputPath = await canonicalPath(output.uri);
        if (!committedGeneratedPaths.has(outputPath)) throw new Error('Generated output was not committed by this editor session.');
        return outputPath;
      }));
      const kind = classifyGeneratedOutputPaths(outputPaths);
      if (kind === 'json-structure') {
        const opened = await readStagedDocument(outputPaths[0]!, 'generated', requestGeneration);
        if (!opened) throw new Error('Generated output is no longer available.');
        activeMainWindow()?.webContents.send('file:opened', opened);
      } else {
        const target = kind === 'directory' ? commonGeneratedOutputDirectory(outputPaths) : outputPaths[0]!;
        const launchError = await shell.openPath(target);
        if (launchError) throw new Error(launchError);
      }
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
    if (!expectedWindow || expectedWindow.isDestroyed() || !expectedUrl || !frame || !isTrustedIpcSender({
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
    bundledProvider: { id: 'financial-types', kind: 'bundled', location: pathToFileURL(dirname(coreLibraryPath)).toString(), entries: [coreLibraryEntry] },
    approve: approveLibraryRequest,
  });
  return libraryRuntime;
}

async function approveLibraryRequest(request: ElectronLibraryApprovalRequest): Promise<boolean> {
  if (request.kind === 'operation') return true;
  const key = JSON.stringify(request);
  if (approvedLibraryRequests.has(key)) return true;
  const window = activeMainWindow();
  if (!window) return false;
  const detail = request.kind === 'provider'
    ? `Provider: ${request.providerId}`
    : request.kind === 'origin'
      ? `Origin: ${request.origin}`
      : request.kind === 'uri'
        ? `Provider: ${request.providerId}
Resource: ${request.uri}`
        : `Credential: ${request.request.credentialId}
From: ${request.request.source.origin}
To: ${request.request.target.origin}`;
  const result = await dialog.showMessageBox(window, {
    type: 'warning',
    title: 'Approve library access',
    message: request.kind === 'credential-binding' ? 'Allow this provider to use the stored credential?' : 'Trust this library provider or resource for this session?',
    detail,
    buttons: ['Cancel', 'Allow'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (result.response !== 1) return false;
  approvedLibraryRequests.add(key);
  return true;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch { return join(await realpath(dirname(path)), path.split(/[\\/]/).pop()!); }
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: appIconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: '#181818', symbolColor: '#cccccc', height: 35 } }),
    backgroundColor: '#181818',
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.JSON_STRUCTURE_REAL_HOST_TEST === '1') window.maximize();
  mainWindow = window;
  rendererReady = false;
  const developmentUrl = selectDevelopmentUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL);
  allowedRendererUrl = developmentUrl ?? pathToFileURL(join(rendererDirectory, 'index.html')).href;
  const expectedUrl = allowedRendererUrl;
  window.webContents.on('before-input-event', (event, input) => {
    const command = windowCommandForShortcut(input, process.platform);
    if (!command) return;
    event.preventDefault();
    executeWindowCommand(window.webContents, command);
  });
  window.webContents.setWindowOpenHandler(() => deniedWindowOpen);
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererNavigation(url, expectedUrl)) event.preventDefault();
  });
  window.on('closed', () => {
    if (mainWindow === window) { mainWindow = null; allowedRendererUrl = undefined; rendererReady = false; }
  });
  const initialReadGeneration = latestOpenRequest;
  const initialFile = await readInitialFile();
  if (window.isDestroyed()) return;
  try {
    if (developmentUrl) await window.loadURL(developmentUrl);
    else await window.loadFile(join(rendererDirectory, 'index.html'));
  } catch (error) {
    if (window.isDestroyed()) return;
    throw error;
  }
  rendererReady = true;
  const queuedFile = pendingPath ? await readInitialFile() : null;
  const fileToSend = queuedFile ?? (initialReadGeneration === latestOpenRequest ? initialFile : null);
  if (fileToSend && !window.isDestroyed()) window.webContents.send('file:opened', fileToSend);
}

app.on('open-file', (event, path) => {
  event.preventDefault();
  const window = activeMainWindow();
  if (!window || !rendererReady) {
    ++latestOpenRequest;
    pendingPath = path;
    return;
  }
  const requestGeneration = ++latestOpenRequest;
  void readStagedDocument(path, 'file', requestGeneration).then((file) => {
    if (!file) return;
    if (requestGeneration !== latestOpenRequest) {
      if (file.activationToken) documentActivations.discard(file.activationToken);
      return;
    }
    activeMainWindow()?.webContents.send('file:opened', file);
  }).catch(() => undefined);
});

app.whenReady().then(() => {
  app.setAppUserModelId('org.json-structure.editor');
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
