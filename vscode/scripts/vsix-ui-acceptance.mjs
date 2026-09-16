import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { createVSIX } from '@vscode/vsce';
import WebSocket from '../../editor/node_modules/ws/wrapper.mjs';

const vscodeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vsixPath = path.resolve(process.argv[2] || process.env.JSON_STRUCTURE_VSIX_PATH || path.join(vscodeRoot, 'artifacts', 'json-structure-editor.vsix'));
const testRoot = path.resolve(process.env.JSON_STRUCTURE_VSIX_UI_ROOT || path.join(vscodeRoot, 'build', `vsix-ui-acceptance-${process.pid}`));
const userDataRoot = path.join(testRoot, 'user-data');
const extensionsRoot = path.join(testRoot, 'extensions');
const driverRoot = path.join(testRoot, 'driver');
const driverVsixPath = path.join(testRoot, 'json-structure-vsix-ui-driver.vsix');
const fixturePath = path.join(testRoot, 'installed-vsix.struct.json');
const initialText = `${JSON.stringify({
  $schema: 'https://json-structure.org/meta/validation/v0/#',
  name: 'InstalledVsixAcceptance',
  $root: '#/definitions/Root',
  definitions: {
    Root: { type: 'object', properties: { value: { type: 'string' } } },
    RulesTarget: {
      type: 'object',
      properties: { value: { type: 'string' } },
      allOf: [{ required: ['value'] }],
      if: { required: ['value'] },
      then: { type: 'object' },
    },
  },
}, null, 2)}\n`;
const editedText = initialText.replace('InstalledVsixAcceptance', 'InstalledVsixEdited');

function fail(message) {
  throw new Error(`Installed VSIX UI acceptance failed: ${message}`);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') fail('unable to reserve a remote-debugging port');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function vscodeExecutable() {
  const configured = process.env.JSON_STRUCTURE_VSCODE_EXECUTABLE;
  if (configured) {
    const executable = path.resolve(configured);
    if (!existsSync(executable)) fail(`configured VS Code executable does not exist: ${executable}`);
    return executable;
  }
  return downloadAndUnzipVSCode(process.env.JSON_STRUCTURE_VSCODE_VERSION || 'stable');
}

function runCli(executable, args) {
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable);
  const result = spawnSync(cli, [...cliArgs, ...args], {
    cwd: vscodeRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`VS Code CLI exited with ${result.status}: ${result.stderr || result.stdout}`);
}

class CdpClient {
  #nextId = 0;
  #pending = new Map();
  #contexts = new Map();
  #frameSessions = new Set();
  #attachedTargetIds = new Set();

  constructor(target) {
    this.target = target;
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.method === 'Target.detachedFromTarget') { this.#frameSessions.delete(message.params.sessionId); this.#contexts.delete(message.params.sessionId); }
      const sessionKey = message.sessionId || '';
      const contexts = this.#contexts.get(sessionKey) ?? new Set();
      if (message.method === 'Runtime.executionContextCreated') {
        contexts.add(message.params.context.id);
        this.#contexts.set(sessionKey, contexts);
      }
      if (message.method === 'Runtime.executionContextDestroyed') contexts.delete(message.params.executionContextId);
      if (message.method === 'Runtime.executionContextsCleared') contexts.clear();
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.on('close', () => {
      for (const pending of this.#pending.values()) pending.reject(new Error('CDP connection closed before the command completed.'));
      this.#pending.clear();
    });
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    await this.command('Runtime.enable');
    await this.command('Page.enable');
  }

  command(method, params = {}, sessionId) {
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async evaluate(expression, contextId, sessionId) {
    const result = await this.command('Runtime.evaluate', {
      expression,
      ...(contextId === undefined ? {} : { contextId }),
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, sessionId);
    if (result.exceptionDetails || result.result?.subtype === 'error') return undefined;
    return result.result?.value;
  }

  async evaluateChecked(expression, contextId, sessionId) {
    const response=await this.command('Runtime.evaluate',{expression,...(contextId===undefined?{}:{contextId}),awaitPromise:true,returnByValue:true,userGesture:true},sessionId);
    if(response.exceptionDetails||response.result?.subtype==='error')throw new Error(response.exceptionDetails?.exception?.description??response.result?.description??'Renderer evaluation failed');
    return response.result?.value;
  }

  async matchingContext(expression) {
    await this.refreshFrameSessions();
    for (const sessionId of [undefined, ...this.#frameSessions]) {
      const contexts = [undefined, ...(this.#contexts.get(sessionId || '') ?? [])];
      for (const contextId of contexts) {
        try { if (await this.evaluate(expression, contextId, sessionId)) return { contextId, sessionId }; } catch { /* A closed editor may destroy a webview context while the next file is opening. */ }
      }
    }
    return undefined;
  }

  async refreshFrameSessions() {
    const result = await this.command('Target.getTargets');
    for (const target of result.targetInfos ?? []) {
      if (target.type !== 'iframe' || !target.url?.startsWith('vscode-webview://') || this.#attachedTargetIds.has(target.targetId)) continue;
      const attached = await this.command('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      this.#attachedTargetIds.add(target.targetId);
      this.#frameSessions.add(attached.sessionId);
      await this.command('Runtime.enable', {}, attached.sessionId);
    }
  }

  async click(expression, contextId, sessionId) {
    const rect = await this.evaluate(`JSON.stringify((${expression})?.getBoundingClientRect().toJSON())`, contextId, sessionId);
    if (typeof rect !== 'string') return false;
    const bounds = JSON.parse(rect);
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    await this.command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return true;
  }

  async hover(expression, contextId, sessionId) {
    const rect = await this.evaluate(`JSON.stringify((${expression})?.getBoundingClientRect().toJSON())`, contextId, sessionId);
    if (typeof rect !== 'string') return false;
    const bounds = JSON.parse(rect);
    await this.command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
    return true;
  }

  close() {
    this.socket.close();
  }
}

async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) fail(`debug target endpoint returned HTTP ${response.status}`);
  return response.json();
}

async function waitForTargets(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await targets(port);
      if (value.some((target) => target.webSocketDebuggerUrl)) return value;
    } catch {
      // VS Code is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail('VS Code did not expose a Chrome DevTools Protocol endpoint');
}

async function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForWebview(port, clients = new Map(), timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      for (const target of await targets(port)) {
        if (target.type !== 'page') continue;
        if (!target.webSocketDebuggerUrl || clients.has(target.webSocketDebuggerUrl)) continue;
        const client = new CdpClient(target);
        try {
          await client.connect();
          clients.set(target.webSocketDebuggerUrl, client);
        } catch {
          client.close();
        }
      }
      for (const client of clients.values()) {
        const match = await client.matchingContext(`document.querySelector('.js-shell') !== null`);
        if (match) return { client, contextId: match.contextId, sessionId: match.sessionId, clients };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    fail('the installed extension did not render the JSON Structure workbench');
  } catch (error) {
    for (const client of clients.values()) client.close();
    throw error;
  }
}

async function waitFor(client, contextId, sessionId, description, expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression, contextId, sessionId)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`timed out waiting for ${description}`);
}

async function run() {
  if (!existsSync(vsixPath)) fail(`VSIX does not exist: ${vsixPath}`);
  await rm(testRoot, { recursive: true, force: true });
  await mkdir(driverRoot, { recursive: true });
  await writeFile(path.join(driverRoot, 'package.json'), JSON.stringify({
    name: 'json-structure-vsix-ui-driver',
    displayName: 'JSON Structure VSIX UI Driver',
    version: '0.0.0',
    publisher: 'jsonstructure-tests',
    engines: { vscode: '^1.110.0' },
    activationEvents: ['onStartupFinished'],
    main: './extension.js',
  }, null, 2), 'utf8');
  await writeFile(path.join(driverRoot, 'extension.js'), `
const vscode = require('vscode');
exports.activate = function activate(context) {
  const fixture = vscode.Uri.file(process.env.JSON_STRUCTURE_VSIX_UI_FIXTURE);
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (event.document.uri.toString() === fixture.toString() && event.document.getText().includes('InstalledVsixEdited')) {
      await event.document.save();
    }
  }));
  setTimeout(async () => {
    await vscode.commands.executeCommand('vscode.openWith', fixture, 'jsonStructure.editor');
  }, 1000);
};
`, 'utf8');
  await createVSIX({ cwd: driverRoot, packagePath: driverVsixPath, dependencies: false });
  await writeFile(fixturePath, initialText, 'utf8');
  const executable = await vscodeExecutable();
  runCli(executable, [
    '--user-data-dir', userDataRoot,
    '--extensions-dir', extensionsRoot,
    '--install-extension', vsixPath,
    '--force',
  ]);
  runCli(executable, [
    '--user-data-dir', userDataRoot,
    '--extensions-dir', extensionsRoot,
    '--install-extension', driverVsixPath,
    '--force',
  ]);
  const port = await freePort();
  const child = spawn(executable, [
    '--user-data-dir', userDataRoot,
    '--extensions-dir', extensionsRoot,
    '--new-window',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    `--remote-debugging-port=${port}`,
    testRoot,
  ], {
    cwd: vscodeRoot,
    env: { ...process.env, JSON_STRUCTURE_VSIX_UI_FIXTURE: fixturePath, JSON_STRUCTURE_VSIX_UI_ACCEPTANCE: '1' },
    stdio: 'ignore',
    windowsHide: true,
  });
  let clients;
  try {
    await waitForTargets(port);
    const initialTargets = await targets(port);
    const mainTarget = initialTargets.find((target) => target.type === 'page');
    if (!mainTarget) fail('VS Code did not expose its workbench page');
    const mainClient = new CdpClient(mainTarget);
    await mainClient.connect();
    const attachedClients = new Map([[mainTarget.webSocketDebuggerUrl, mainClient]]);
    const webview = await waitForWebview(port, attachedClients);
    clients = webview.clients;
    const { client, contextId, sessionId } = webview;
    const shell = await client.evaluate(`(() => {
      const styleSheets = [...document.styleSheets].map((sheet) => sheet.href).filter(Boolean);
      const shell = document.querySelector('.js-shell');
      return shell && {
        styleSheets,
        title: document.querySelector('[data-document-title]')?.textContent,
        renderer: document.documentElement.getAttribute('data-json-structure-renderer'),
      };
    })()`, contextId, sessionId);
    if (!shell?.styleSheets?.some((href) => href.includes('/media/editor/editor.css'))) fail(`Monaco stylesheet was not loaded: ${JSON.stringify(shell)}`);
    if (shell.title !== 'installed-vsix.struct.json') fail(`unexpected document title: ${JSON.stringify(shell)}`);
    await waitFor(client, contextId, sessionId, 'RulesTarget in the type navigator', `document.querySelector('[data-select="/definitions/RulesTarget"]') !== null`);
    if (!await client.evaluate(`(() => {
      const target = document.querySelector('[data-select="/definitions/RulesTarget"]');
      if (!(target instanceof HTMLButtonElement)) return false;
      target.click();
      return true;
    })()`, contextId, sessionId)) {
      fail('could not navigate to RulesTarget through the type navigator');
    }
    await waitFor(client, contextId, sessionId, 'primary Design renderer for the selected type', `document.querySelector('[data-schema-location-bar]') === null && document.querySelector('[data-schema-sheet]') === null && document.querySelector('[data-inline-definition-name]')?.value === 'RulesTarget' && document.querySelector('[data-rule-keyword="allOf"]') !== null && document.querySelector('[data-select="/definitions/RulesTarget"]')?.getAttribute('aria-current') === 'true'`);
    if (!await client.evaluate(`(() => { const button=document.querySelector('[data-rule-keyword="allOf"] [data-schema-open]');if(!button)return false;button.scrollIntoView({block:'center'});button.click();return true; })()`,contextId,sessionId)) fail('could not open the rule operand through its visible schema action');
    await waitFor(client,contextId,sessionId,'complete operand Schema Sheet',`document.querySelector('[data-schema-location-bar]')?.dataset.schemaPointer === '/definitions/RulesTarget/allOf/0' && document.querySelector('[data-schema-declaration]')?.dataset.declarationForm === 'no-type' && !document.querySelector('.js-composition-schema-editor')`);

    await client.evaluate(`document.querySelector('[data-mode="source"]')?.click(); true`, contextId, sessionId);
    await waitFor(client, contextId, sessionId, 'a visible Monaco source editor', `(() => {
      const editor = document.querySelector('.monaco-editor');
      const input = document.querySelector('.monaco-editor .ime-text-area');
      const rect = editor?.getBoundingClientRect();
      const style = input && getComputedStyle(input);
      return rect && rect.width > 300 && rect.height > 200 && input
        && style.position === 'absolute'
        && editor.textContent?.includes('InstalledVsixAcceptance');
    })()`);
    const acceptanceEdit = await client.evaluate(`(() => {
      const source = document.querySelector('[data-source]');
      if (!source || !document.querySelector('meta[name="json-structure-acceptance"][content="enabled"]')) return false;
      source.dispatchEvent(new CustomEvent('json-structure-acceptance-set-source', { detail: ${JSON.stringify(editedText)} }));
      return true;
    })()`, contextId, sessionId);
    if (!acceptanceEdit) fail('the packaged renderer did not enable its acceptance-only Monaco edit event');
    await waitFor(client, contextId, sessionId, 'the Monaco model edit', `document.querySelector('.monaco-editor')?.textContent?.includes('InstalledVsixEdited') === true`);

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && await readFile(fixturePath, 'utf8') !== editedText) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const persisted = await readFile(fixturePath, 'utf8');
    if (persisted !== editedText) fail('Source edits were not persisted by VS Code Save');
    console.log(`INSTALLED_VSIX_UI_ACCEPTANCE PASS: ${path.basename(vsixPath)} navigated to RulesTarget, opened its operand Schema Sheet, loaded Monaco, edited Source, and persisted ${Buffer.byteLength(persisted)} bytes`);
  } finally {
    for (const client of clients?.values() ?? []) {
      try {
        await client.command('Browser.close');
        break;
      } catch {
        // Try the next attached target.
      }
    }
    for (const client of clients?.values() ?? []) client.close();
    if (child.exitCode === null) child.kill();
    await waitForExit(child);
    if (process.env.JSON_STRUCTURE_VSIX_UI_KEEP !== '1') {
      try {
        await rm(testRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
      } catch (error) {
        console.warn(`VSIX UI acceptance cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.log(`VSIX UI acceptance retained test state: ${testRoot}`);
    }
  }
}

export { CdpClient, freePort, vscodeExecutable, runCli, waitForTargets, waitForWebview, waitFor, waitForExit };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
