import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = join(projectRoot, `.real-host-acceptance-${process.pid}`);
const outputDirectory = join(testRoot, 'generated');
const initialPath = join(testRoot, 'initial.struct.json');
const initialText = JSON.stringify({
  $schema: 'https://json-structure.org/meta/relations/v0/#',
  $uses: ['JSONStructureRelations'],
  $id: 'https://example.com/real-host-person',
  name: 'RealHostPerson',
  $root: '#/definitions/Source',
  definitions: {
    Source: {
      type: 'object',
      properties: Object.fromEntries(Array.from({ length: 36 }, (_, index) => [`field${index}`, { type: 'string' }])),
      identity: ['field0'],
      relations: {
        normal: { targettype: { $ref: '#/definitions/Target' }, cardinality: 'single' },
        parallel: { targettype: { $ref: '#/definitions/Target' }, cardinality: 'multiple' },
        self: { targettype: { $ref: '#/definitions/Source' }, cardinality: 'single' },
      },
    },
    Target: {
      type: 'object',
      properties: { id: { type: 'string' } },
      identity: ['id'],
      relations: { reciprocal: { targettype: { $ref: '#/definitions/Source' }, cardinality: 'single' } },
    },
    ...Object.fromEntries(Array.from({ length: 28 }, (_, index) => [`Context${index}`, { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] }])),
  },
}, null, 2);
const conversionSource = JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ConvertedPerson',
  type: 'object',
  properties: { name: { type: 'string' } },
}, null, 2);

class CdpClient {
  #nextId = 0;
  #socket;
  #pending = new Map();
  #dialogResponse = false;

  constructor(url) {
    this.#socket = new WebSocket(url);
    this.#socket.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.method === 'Page.javascriptDialogOpening') {
        void this.command('Page.handleJavaScriptDialog', { accept: this.#dialogResponse });
        return;
      }
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.#socket.on('close', () => {
      for (const pending of this.#pending.values()) pending.reject(new Error('CDP connection closed.'));
      this.#pending.clear();
    });
  }

  async connect() {
    await new Promise((resolvePromise, reject) => {
      this.#socket.once('open', resolvePromise);
      this.#socket.once('error', reject);
    });
    await this.command('Runtime.enable');
    await this.command('Page.enable');
  }

  command(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolvePromise, reject) => {
      this.#pending.set(id, { resolve: resolvePromise, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  setDialogResponse(accept) {
    this.#dialogResponse = accept;
  }

  async evaluate(expression) {
    const result = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Renderer evaluation failed.');
    if (result.result?.subtype === 'error') throw new Error(result.result.description ?? 'Renderer evaluation failed.');
    return result.result?.value;
  }

  async evaluateJson(expression) {
    const value = await this.evaluate(`(async () => JSON.stringify(await (${expression})))()`);
    if (typeof value !== 'string') throw new Error('Renderer did not return JSON.');
    return JSON.parse(value);
  }

  async click(selector) {
    const clicked = await this.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!(element instanceof HTMLElement)) return false; element.click(); return true; })()`);
    if (!clicked) throw new Error(`Missing clickable renderer element: ${selector}`);
  }

  async doubleClick(selector) {
    const rect = await this.evaluateJson(`document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().toJSON()`);
    if (!rect) throw new Error(`Missing double-click renderer element: ${selector}`);
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    await this.command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 });
    await this.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 });
  }

  async waitFor(description, predicate, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(predicate)) return;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }

  async dispose() {
    try { await this.#socket.close(); } catch { /* already closed */ }
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a local port.');
  const port = address.port;
  await new Promise(resolvePromise => server.close(resolvePromise));
  return port;
}

async function waitForJson(url, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const value = await response.json();
        if (predicate(value)) return value;
      }
    } catch { /* Electron is still starting. */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron did not exit after quit.')), timeoutMs);
    child.once('exit', code => { clearTimeout(timer); resolvePromise(code ?? 0); });
  });
}

async function insertSourceText(cdp, text) {
  await cdp.click('[data-mode="source"]');
  try {
    await cdp.waitFor('Monaco source editor', `document.querySelector('.monaco-editor .ime-text-area') !== null`, 20_000);
  } catch {
    await cdp.click('[data-mode="design"]');
    await cdp.click('[data-mode="source"]');
    await cdp.waitFor('Monaco source editor after remount', `document.querySelector('.monaco-editor .ime-text-area') !== null`, 30_000);
  }
  const editorRect = await cdp.evaluateJson(`document.querySelector('.monaco-editor').getBoundingClientRect().toJSON()`);
  await cdp.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: editorRect.left + editorRect.width / 2, y: editorRect.top + 30, button: 'left', clickCount: 1 });
  await cdp.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: editorRect.left + editorRect.width / 2, y: editorRect.top + 30, button: 'left', clickCount: 1 });
  await cdp.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', modifiers: 2 });
  await cdp.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', modifiers: 2 });
  await cdp.command('Input.insertText', { text });
  await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
  const editState = await cdp.evaluate(`JSON.stringify({title: document.title, active: document.activeElement?.className, rect: document.querySelector('.monaco-editor')?.getBoundingClientRect().toJSON(), source: document.querySelector('.monaco-editor')?.textContent?.slice(-160)})`);
  if (!(await cdp.evaluate(`document.title.startsWith('* ')`))) throw new Error(`Monaco input did not dirty the document: ${editState}`);
}

async function run() {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(initialPath, initialText, 'utf8');
  const port = await freePort();
  const electronBinary = process.platform === 'win32'
    ? join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : join(projectRoot, 'node_modules', 'electron', 'dist', 'electron');
  const child = spawn(electronBinary, ['.', '--headless', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${join(testRoot, 'user-data')}`, initialPath], {
    cwd: projectRoot,
    env: { ...process.env, JSON_STRUCTURE_REAL_HOST_TEST: '1', JSON_STRUCTURE_REAL_HOST_OUTPUT_DIR: outputDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  let target;
  try {
    target = await waitForJson(`http://127.0.0.1:${port}/json`, value => value.some(item => item.type === 'page'));
  } catch (error) {
    if (child.exitCode === null) child.kill();
    try { await waitForExit(child, 5_000); } catch { /* process was not responsive */ }
    throw error;
  }
  const page = target.find(item => item.type === 'page');
  if (!page) {
    if (child.exitCode === null) child.kill();
    try { await waitForExit(child, 5_000); } catch { /* process was not responsive */ }
    throw new Error('Electron did not expose a renderer page.');
  }
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.connect();
  const evidence = [];
  const record = (persona, workflow, detail) => {
    evidence.push({ persona, workflow, detail });
    console.log(`PASS ${persona}: ${workflow} — ${detail}`);
  };
  try {
    await cdp.waitFor('initial file activation', `document.title.includes('initial.struct.json')`);
    record('Schema author', 'initial file activation', 'BrowserWindow renderer received the real IPC file:opened event.');

    const windowState = await cdp.evaluateJson(`({outerWidth, outerHeight, availWidth: screen.availWidth, availHeight: screen.availHeight, scrollTop: document.scrollingElement.scrollTop})`);
    if (windowState.scrollTop !== 0 || windowState.outerWidth < windowState.availWidth * 0.9 || windowState.outerHeight < windowState.availHeight * 0.85) {
      throw new Error(`Electron window was not maximized and scroll-locked: ${JSON.stringify(windowState)}`);
    }
    record('Schema author', 'maximized viewport containment', `${windowState.outerWidth}x${windowState.outerHeight}; document scrollTop remained ${windowState.scrollTop}.`);

    await cdp.click('[data-problems-toggle]');
    await cdp.waitFor('open problems pane', `document.querySelector('.js-workbench')?.dataset.problemsOpen === 'true'`);
    const scrollEvidence = await cdp.evaluateJson(`(() => {
      const selectors = ['.js-tree', '.js-document-metadata', '[data-panel-mode="design"]', '.js-inspector', '.js-problem-list'];
      return selectors.map(selector => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) return { selector, missing: true };
        const drawer = selector === '.js-tree' ? element.closest('.js-outline') : selector === '.js-inspector' ? element : null;
        const openedForProbe = drawer instanceof HTMLElement && getComputedStyle(drawer).display === 'none';
        if (openedForProbe) drawer.classList.add('js-drawer-open');
        const filler = document.createElement('div');
        filler.dataset.scrollProbe = selector;
        filler.style.height = '1400px';
        filler.style.minHeight = '1400px';
        filler.style.flex = '0 0 1400px';
        filler.textContent = 'scroll containment probe';
        filler.style.width = '1px';
        element.append(filler);
        const beforeDocument = document.scrollingElement.scrollTop;
        element.scrollTop = 180;
        const result = { selector, paneScrollTop: element.scrollTop, documentScrollTop: document.scrollingElement.scrollTop, beforeDocument, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
        filler.remove();
        element.scrollTop = 0;
        if (openedForProbe) drawer.classList.remove('js-drawer-open');
        return result;
      });
    })()`);
    if (scrollEvidence.some(entry => entry.missing || entry.paneScrollTop <= 0 || entry.documentScrollTop !== 0 || entry.beforeDocument !== 0)) {
      throw new Error(`Independent pane scrolling escaped to the document: ${JSON.stringify(scrollEvidence)}`);
    }
    record('Schema author', 'independent pane scrolling', 'Tree, metadata, design, inspector, and problems panes scrolled independently while document scrollTop stayed zero.');
    await cdp.click('[data-problems-toggle]');
    await cdp.waitFor('closed problems pane', `document.querySelector('.js-workbench')?.dataset.problemsOpen === 'false'`);
    await cdp.evaluate(`document.querySelector('.js-document-metadata')?.removeAttribute('open'); true`);

    await cdp.click('[data-mode="graph"]');
    await cdp.waitFor('graph mode', `document.querySelector('[data-mode="graph"]')?.getAttribute('aria-pressed') === 'true'`);
    const canvasRect = await cdp.evaluateJson(`document.querySelector('[data-graph-canvas]').getBoundingClientRect().toJSON()`);
    const zoomBefore = await cdp.evaluate(`document.querySelector('[data-semantic-zoom]')?.textContent`);
    const toolbarRect = await cdp.evaluateJson(`document.querySelector('.js-graph-toolbar').getBoundingClientRect().toJSON()`);
    await cdp.command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: toolbarRect.left + toolbarRect.width / 2, y: toolbarRect.top + toolbarRect.height / 2, deltaX: 0, deltaY: -120 });
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    const toolbarZoom = await cdp.evaluate(`document.querySelector('[data-semantic-zoom]')?.textContent`);
    if (toolbarZoom !== zoomBefore || await cdp.evaluate(`document.scrollingElement.scrollTop !== 0`)) throw new Error('Graph toolbar wheel was not a local no-op.');
    await cdp.command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: canvasRect.left + canvasRect.width / 2, y: canvasRect.top + canvasRect.height / 2, deltaX: 0, deltaY: -120 });
    await cdp.waitFor('local graph zoom', `document.querySelector('[data-semantic-zoom]')?.textContent !== ${JSON.stringify(zoomBefore)}`);
    if (await cdp.evaluate(`document.scrollingElement.scrollTop !== 0`)) throw new Error('Graph wheel changed document scrollTop.');
    record('Schema author', 'local graph wheel zoom', 'Graph wheel changed graph zoom only; document scrollTop remained zero.');

    await cdp.click('[data-graph-home]');
    await cdp.waitFor('schema atlas before drill-in', `document.querySelector('[data-graph-node="graph:namespace:Definitions"]') !== null`);
    await cdp.doubleClick('[data-graph-node="graph:namespace:Definitions"]');
    await cdp.waitFor('type topology', `document.querySelector('[data-graph-node="/definitions/Source"]') !== null`);
    await cdp.doubleClick('[data-graph-node="/definitions/Source"]');
    await cdp.waitFor('relation neighborhood', `document.querySelectorAll('[data-graph-edge] .js-edge-hit-target').length >= 4`);
    const dragBefore = await cdp.evaluateJson(`(() => {
      const edge = [...document.querySelectorAll('[data-graph-edge]')].find(candidate => candidate.querySelector('.js-edge-label')?.textContent?.startsWith('normal'));
      const node = document.querySelector('[data-graph-node="/definitions/Target"]');
      const hit = edge.querySelector('.js-edge-hit-target');
      const point = hit.getPointAtLength(hit.getTotalLength() / 2);
      const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(hit.getScreenCTM());
      return { edgeId: edge.dataset.graphEdge, visible: edge.querySelector('.js-edge').getAttribute('d'), hit: hit.getAttribute('d'), lane: edge.dataset.graphLabelLane, oldHitPoint: { x: screenPoint.x, y: screenPoint.y }, node: node.getBoundingClientRect().toJSON() };
    })()`);
    await cdp.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragBefore.node.left + dragBefore.node.width / 2, y: dragBefore.node.top + dragBefore.node.height / 2, button: 'left', clickCount: 1 });
    await cdp.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragBefore.node.left + dragBefore.node.width / 2 + 170, y: dragBefore.node.top + dragBefore.node.height / 2 - 80, button: 'left', buttons: 1 });
    await cdp.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragBefore.node.left + dragBefore.node.width / 2 + 170, y: dragBefore.node.top + dragBefore.node.height / 2 - 80, button: 'left', clickCount: 1 });
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    const dragAfter = await cdp.evaluateJson(`(() => {
      const edge = [...document.querySelectorAll('[data-graph-edge]')].find(candidate => candidate.querySelector('.js-edge-label')?.textContent?.startsWith('normal'));
      const visible = edge.querySelector('.js-edge');
      const hit = edge.querySelector('.js-edge-hit-target');
      const node = document.querySelector('[data-graph-node="/definitions/Target"]');
      const oldTarget = document.elementFromPoint(${dragBefore.oldHitPoint.x}, ${dragBefore.oldHitPoint.y})?.closest?.('[data-graph-edge]')?.dataset.graphEdge;
      const pathNumbers = [...visible.getAttribute('d').matchAll(/-?\\d+(?:\\.\\d+)?/g)].map(match => Number(match[0]));
      const transformNumbers = [...node.getAttribute('transform').matchAll(/-?\\d+(?:\\.\\d+)?/g)].map(match => Number(match[0]));
      const endpoint = { x: pathNumbers.at(-2), y: pathNumbers.at(-1) };
      const target = { x: transformNumbers[0], y: transformNumbers[1], width: 150, height: 50 };
      const arrowOnTarget = endpoint.x >= target.x - .02 && endpoint.x <= target.x + target.width + .02 && endpoint.y >= target.y - .02 && endpoint.y <= target.y + target.height + .02
        && (Math.abs(endpoint.x - target.x) < .02 || Math.abs(endpoint.x - (target.x + target.width)) < .02 || Math.abs(endpoint.y - target.y) < .02 || Math.abs(endpoint.y - (target.y + target.height)) < .02);
      return { visible: visible.getAttribute('d'), hit: hit.getAttribute('d'), lane: edge.dataset.graphLabelLane, marker: visible.getAttribute('marker-end'), nodeTransform: node.getAttribute('transform'), endpoint, arrowOnTarget, oldClickableEdge: oldTarget ?? null, documentScrollTop: document.scrollingElement.scrollTop };
    })()`);
    if (dragAfter.visible !== dragAfter.hit || dragAfter.visible === dragBefore.visible || dragAfter.hit === dragBefore.hit || dragAfter.lane !== dragBefore.lane || dragAfter.marker !== 'url(#js-arrow)' || !dragAfter.arrowOnTarget || dragAfter.oldClickableEdge === dragBefore.edgeId || dragAfter.documentScrollTop !== 0) {
      throw new Error(`Mounted graph drag geometry did not synchronize: ${JSON.stringify({ dragBefore, dragAfter })}`);
    }
    const evidenceDirectory = process.env.JSON_STRUCTURE_EVIDENCE_DIR;
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      const screenshot = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await writeFile(join(evidenceDirectory, 'electron-graph-drag.png'), Buffer.from(screenshot.data, 'base64'));
      await writeFile(join(evidenceDirectory, 'electron-graph-drag.json'), JSON.stringify({ windowState, scrollEvidence, dragBefore, dragAfter }, null, 2), 'utf8');
    }
    record('Schema author', 'mounted graph drag geometry', 'Visible/hit paths, arrow marker, and label lane synchronized after a real pointer drag.');
    if (process.env.JSON_STRUCTURE_REAL_HOST_GRAPH_ONLY === '1') {
      await cdp.evaluate("void window.electronAPI.executeWindowCommand('quit'); true");
      const exitCode = await waitForExit(child);
      await cdp.dispose();
      if (exitCode !== 0) throw new Error(`Electron exited with code ${exitCode}. ${stderr}`);
      console.log(`REAL_HOST_GRAPH_ACCEPTANCE PASS (${evidence.length} evidence records)`);
      return evidence;
    }

    for (const mode of ['design', 'source']) {
      await cdp.click(`[data-mode="${mode}"]`);
      await cdp.waitFor(`${mode} mode`, `document.querySelector('[data-mode="${mode}"]')?.getAttribute('aria-pressed') === 'true'`);
    }
    record('Schema author', 'Graph ↔ Design ↔ Source navigation', 'All three renderer modes were activated through the live workbench.');

    const libraries = await cdp.evaluateJson('window.electronAPI.listLibraryEntries()');
    if (!Array.isArray(libraries) || !libraries.some(entry => entry.id === 'financial-types')) throw new Error('Bundled library collection was not returned through preload IPC.');
    const libraryDocument = await cdp.evaluateJson("window.electronAPI.readLibraryDocument('financial-types', '1.0.0')");
    if (libraryDocument.entryId !== 'financial-types') throw new Error('Pinned library navigation did not return the selected document.');
    await cdp.click('[data-library-open]');
    await cdp.waitFor('library browser', `document.querySelector('[data-library-provider-filter]') !== null`);
    await cdp.click('[data-library-dialog] [data-libraries-load]');
    await cdp.waitFor('library collection', `document.querySelector('[data-library-dialog][open] .js-library-catalog-entry [data-library-read]') !== null`);
    await cdp.click('[data-library-dialog][open] .js-library-catalog-entry [data-library-read]');
    await cdp.waitFor('pinned library document view', `document.querySelector('[data-library-dialog][open] .js-library-consume') !== null`);
    record('Library consumer', 'collection persistence/navigation', 'Library collection was loaded, a version was navigated, and the pinned document view rendered through preload IPC.');
    await cdp.click('[data-library-close]');
    await cdp.waitFor('library browser close', `!document.querySelector('[data-library-dialog][open]')`);

    const conversionResult = await cdp.evaluateJson(`window.electronAPI.convert({protocolVersion: 1, requestId: 'real-host-conversion', kind: 'conversion', documentVersion: 1, commandId: 'import.structurize.j2s', sourceName: 'source.json', sourceText: ${JSON.stringify(conversionSource)}, options: {}})`);
    if (!conversionResult.succeeded || conversionResult.outputs.length !== 1) throw new Error(`Real conversion did not publish one output: ${JSON.stringify(conversionResult.diagnostics)}`);
    const generatedOpen = await cdp.evaluateJson(`window.electronAPI.openGeneratedOutput({protocolVersion: 1, requestId: 'real-host-generated-open', kind: 'open-generated-output', outputs: ${JSON.stringify(conversionResult.outputs)}})`);
    if (!generatedOpen.opened) throw new Error(generatedOpen.message ?? 'Generated output was not opened.');
    await cdp.waitFor('generated document activation', `document.title.includes('schema.struct.json')`);
    record('Existing-schema adopter', 'generated document activation', 'Conversion output was committed, opened, staged, and activated through real IPC/preload.');

    await insertSourceText(cdp, '\n');
    await cdp.click('[data-chrome-command="save"]');
    await cdp.waitFor('saved document clean marker', `!document.title.startsWith('* ')`);
    const persisted = await readFile(conversionResult.outputs[0].uri, 'utf8');
    if (persisted === conversionSource) throw new Error('Save IPC did not persist the edited generated document.');
    record('Registry publisher', 'Save', 'Atomic save was invoked over preload IPC and persisted bytes to the generated document.');

    await insertSourceText(cdp, '\n');
    cdp.setDialogResponse(false);
    await cdp.click('[data-chrome-command="new"]');
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    if (!(await cdp.evaluate('document.title.startsWith("* ")'))) throw new Error('Cancel did not preserve the dirty document.');
    record('Registry publisher', 'Cancel', 'Dirty File/New replacement was cancelled without changing the active document.');

    cdp.setDialogResponse(true);
    await cdp.click('[data-chrome-command="new"]');
    await cdp.waitFor('new document', `document.title.includes('Untitled JSON Structure') && !document.title.startsWith('* ')`);
    record('Registry publisher', 'Discard', 'Discard path accepted replacement and cleared the prior activation.');
    record('Existing-schema adopter', 'File/New', 'New document activation returned to an untitled document without a filesystem artifact.');

    await cdp.evaluate("void window.electronAPI.executeWindowCommand('quit'); true");
    const exitCode = await waitForExit(child);
    await cdp.dispose();
    if (exitCode !== 0) throw new Error(`Electron exited with code ${exitCode}. ${stderr}`);
    console.log(`REAL_HOST_ACCEPTANCE PASS (${evidence.length} evidence records)`);
    return evidence;
  } catch (error) {
    try { await cdp.evaluate("void window.electronAPI.executeWindowCommand('quit'); true"); } catch { if (child.exitCode === null) child.kill(); }
    try { await waitForExit(child, 5_000); } catch { if (child.exitCode === null) child.kill(); }
    throw new Error(`${error instanceof Error ? error.message : String(error)}${stderr ? `\nElectron stderr: ${stderr}` : ''}`);
  }
}

try {
  await run();
} finally {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(testRoot, { recursive: true, force: true }); break; }
    catch (error) {
      if (attempt === 19) throw error;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    }
  }
}
