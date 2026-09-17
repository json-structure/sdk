import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = join(projectRoot, `.electron-conversion-acceptance-${process.pid}`);
const initialPath = join(testRoot, 'initial.struct.json');
const sourcePath = join(testRoot, 'address.avsc');

class CdpClient {
  #nextId = 0;
  #pending = new Map();
  #socket;

  constructor(url) {
    this.#socket = new WebSocket(url);
    this.#socket.on('message', data => {
      const message = JSON.parse(data.toString());
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async connect() {
    await new Promise((resolvePromise, reject) => {
      this.#socket.once('open', resolvePromise);
      this.#socket.once('error', reject);
    });
    await this.command('Runtime.enable');
  }

  command(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolvePromise, reject) => {
      this.#pending.set(id, { resolve: resolvePromise, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? 'Renderer evaluation failed.');
    return response.result?.value;
  }

  async click(selector) {
    const clicked = await this.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!(element instanceof HTMLElement)) return false; element.click(); return true; })()`);
    if (!clicked) throw new Error(`Missing clickable element: ${selector}`);
  }

  async waitFor(description, predicate, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(predicate)) return;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }

  dispose() {
    this.#socket.close();
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a debugging port.');
  await new Promise(resolvePromise => server.close(resolvePromise));
  return address.port;
}

async function waitForJson(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const value = await response.json();
        const page = value.find(item => item.type === 'page');
        if (page) return page;
      }
    } catch {
      // Electron is still starting.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error('Electron did not expose a renderer debugging target.');
}

await mkdir(testRoot, { recursive: true });
await writeFile(initialPath, JSON.stringify({
  $schema: 'https://json-structure.org/meta/core/v0/#',
  $id: 'urn:test:electron-conversion',
  name: 'BeforeImport',
  definitions: {},
}, null, 2));
await writeFile(sourcePath, JSON.stringify({
  type: 'record',
  name: 'Address',
  namespace: 'example',
  fields: [
    { name: 'street', type: 'string' },
    { name: 'postalCode', type: 'string' },
    { name: 'country', type: { type: 'enum', name: 'Country', symbols: ['BE', 'DE', 'NL'] } },
  ],
}, null, 2));

const port = await freePort();
const electron = join(projectRoot, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const child = spawn(electron, ['--headless', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${join(testRoot, 'user-data')}`, projectRoot, initialPath], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PATH: '',
    Path: '',
    PATHEXT: '',
    JSON_STRUCTURE_REAL_HOST_TEST: '1',
    JSON_STRUCTURE_REAL_HOST_SOURCE_PATH: sourcePath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', chunk => { stderr += chunk; });

let cdp;
try {
  const page = await waitForJson(`http://127.0.0.1:${port}/json`);
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.waitFor('initial document', `document.title.includes('initial.struct.json')`);
  await cdp.click('.js-app-menu summary');
  await cdp.click('[data-chrome-command="import"]');
  await cdp.waitFor('import chooser', `document.querySelector('[data-start-conversion-chooser][open]') !== null`);
  await cdp.click('[data-start-conversion-command="import.structurize.a2s"]');
  await cdp.waitFor('Avro import dialog', `document.querySelector('[data-start-conversion-dialog][data-start-command="import.structurize.a2s"][open]') !== null`);
  await cdp.click('[data-start-conversion-dialog] [data-conversion-source]');
  await cdp.waitFor('selected Avro source', `document.querySelector('[data-start-conversion-dialog]')?.textContent?.includes('address.avsc') === true`);
  await cdp.click('[data-start-conversion-dialog] [data-conversion-run]');
  await cdp.waitFor('untitled imported document', `document.title.startsWith('* Untitled JSON Structure')`);
  const state = JSON.parse(await cdp.evaluate(`JSON.stringify({
    title: document.title,
    status: document.querySelector('[data-start-conversion-dialog] [data-conversion-status]')?.textContent,
    dialogOpen: document.querySelector('[data-start-conversion-dialog][open]') !== null,
  })`));
  if (state.dialogOpen && !state.status?.includes('unsaved JSON Structure document')) throw new Error(`Import did not report an unsaved document: ${JSON.stringify(state)}`);
  if (state.dialogOpen) {
    await cdp.click('[data-start-conversion-dialog] [data-start-conversion-close]');
    await cdp.waitFor('closed import dialog', `document.querySelector('[data-start-conversion-dialog][open]') === null`);
  }
  await cdp.click('[data-mode="source"]');
  await cdp.waitFor('converted Address source', `document.querySelector('[data-panel-mode="source"] .monaco-editor')?.textContent?.includes('Address') === true`);
  if (await cdp.evaluate(`document.body.innerText.includes('conversion.failed')`)) throw new Error('The completed import still displayed a conversion failure.');
  console.log(`ELECTRON_CONVERSION_ACCEPTANCE PASS title=${JSON.stringify(state.title)} status=${JSON.stringify(state.status)}`);
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}${stderr ? `\nElectron stderr:\n${stderr}` : ''}`);
} finally {
  cdp?.dispose();
  if (child.exitCode === null) {
    child.kill();
    await new Promise(resolvePromise => child.once('exit', resolvePromise));
  }
  await rm(testRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
