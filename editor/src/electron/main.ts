import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import { join } from 'node:path';
import { atomicWrite, readFile } from './file-service';

const currentDirectory = __dirname;
const rendererDirectory = join(currentDirectory, '..', 'dist', 'renderer');
const developmentUrl = process.env.VITE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;
let pendingPath: string | undefined;

async function readInitialFile(): Promise<{ path: string; text: string } | null> {
  const candidate = pendingPath ?? process.argv.slice(1).find((argument) => !argument.startsWith('-') && argument !== '.');
  if (!candidate) return null;

  try {
    return await readFile(candidate);
  } catch {
    return null;
  } finally {
    pendingPath = undefined;
  }
}

function registerIpcHandlers(): void {
  const fileDialogOptions: OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'JSON Structure', extensions: ['json', 'struct.json'] }] };
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog(fileDialogOptions);
    const path = result.canceled ? undefined : result.filePaths[0];
    return path ? await readFile(path) : null;
  });
  ipcMain.handle('file:save', async (_event, request: { path: string; text: string }) => {
    await atomicWrite(request.path, request.text);
    return { path: request.path };
  });
  ipcMain.handle('file:save-as', async (_event, request: { text: string }) => {
    const result = await dialog.showSaveDialog({ filters: [{ name: 'JSON Structure', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    await atomicWrite(result.filePath, request.text);
    return { path: result.filePath };
  });
  ipcMain.handle('external:open', async (_event, url: string) => {
    await shell.openExternal(url);
  });
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
  void createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});