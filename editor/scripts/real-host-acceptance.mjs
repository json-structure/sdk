import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import axeCore from 'axe-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import WebSocket from 'ws';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = join(projectRoot, `.real-host-acceptance-${process.pid}`);
const outputDirectory = join(testRoot, 'generated');
const visualBaselineDirectory = join(projectRoot, 'tests', 'visual-baselines', `${process.platform}-${process.arch}`);
const visualArtifactDirectory = join(projectRoot, 'artifacts', 'ux-visual', `${process.platform}-${process.arch}`);
const updateVisuals = process.argv.includes('--update-visuals');
const compareVisuals = process.platform === 'win32';
const initialPath = join(testRoot, 'initial.struct.json');
const conversionSourcePath = join(testRoot, 'source.json');
const generatedPath = join(outputDirectory, 'schema.struct.json');
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

async function auditAccessibility(cdp, label) {
  await cdp.evaluate(`${axeCore.source}; true`);
  const result = await cdp.evaluateJson(`axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    resultTypes: ['violations']
  })`);
  if (result.violations.length) {
    const detail = result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target),
    }));
    throw new Error(`Accessibility audit failed for ${label}: ${JSON.stringify(detail)}`);
  }
}

async function captureVisualRegression(cdp, name) {
  await cdp.evaluate(`(() => {
    let style = document.querySelector('style[data-ux-snapshot]');
    if (!style) {
      style = document.createElement('style');
      style.dataset.uxSnapshot = 'true';
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
      document.head.append(style);
    }
    document.activeElement instanceof HTMLElement && document.activeElement.blur();
    return true;
  })()`);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  const screenshot = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const current = Buffer.from(screenshot.data, 'base64');
  const baselinePath = join(visualBaselineDirectory, `${name}.png`);
  if (updateVisuals) {
    await mkdir(visualBaselineDirectory, { recursive: true });
    await writeFile(baselinePath, current);
    return;
  }
  if (!compareVisuals) return;
  if (!existsSync(baselinePath)) throw new Error(`Missing visual baseline ${baselinePath}; run npm run test:ux:update-visuals on Windows.`);
  const baseline = PNG.sync.read(await readFile(baselinePath));
  const actual = PNG.sync.read(current);
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    throw new Error(`Visual dimensions changed for ${name}: expected ${baseline.width}x${baseline.height}, received ${actual.width}x${actual.height}.`);
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const changed = pixelmatch(baseline.data, actual.data, diff.data, actual.width, actual.height, { threshold: 0.12 });
  const ratio = changed / (actual.width * actual.height);
  if (ratio > 0.002) {
    await mkdir(visualArtifactDirectory, { recursive: true });
    await writeFile(join(visualArtifactDirectory, `${name}-actual.png`), current);
    await writeFile(join(visualArtifactDirectory, `${name}-diff.png`), PNG.sync.write(diff));
    throw new Error(`Visual regression in ${name}: ${changed} pixels changed (${(ratio * 100).toFixed(3)}%); artifacts are in ${visualArtifactDirectory}.`);
  }
}

async function probeInternationalization(cdp) {
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 500, height: 600, deviceScaleFactor: 1, mobile: false, screenWidth: 500, screenHeight: 600 });
  const result = await cdp.evaluateJson(`(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    const replacements = [
      ['[data-document-title]', 'Adressverwaltung und internationale Zustellungsinformationen — العنوان — 住所情報'],
      ['[data-mobile-drawer="outline"]', 'Navigationsstruktur und wiederverwendbare Typdefinitionen'],
      ['[data-mobile-drawer="inspector"]', 'Eigenschaften und Metadaten — الخصائص والبيانات الوصفية'],
    ];
    for (const [selector, text] of replacements) {
      const element = document.querySelector(selector);
      if (element) element.textContent = text;
    }
    const focusTarget = document.querySelector('.js-mobile-mode select');
    if (focusTarget instanceof HTMLElement) focusTarget.focus();
    const rect = (element) => element?.getBoundingClientRect().toJSON();
    const active = document.activeElement;
    return {
      direction: getComputedStyle(document.documentElement).direction,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      activeTag: active?.tagName,
      activeRect: rect(active),
      titleRect: rect(document.querySelector('[data-document-title]')),
      bodyText: document.body.innerText,
    };
  })()`);
  if (result.direction !== 'rtl' || result.documentOverflow > 1 || !['BUTTON', 'SELECT'].includes(result.activeTag) ||
      !result.bodyText.includes('Adressverwaltung') || !result.bodyText.includes('العنوان') || !result.bodyText.includes('住所情報') ||
      !result.activeRect || result.activeRect.width <= 0 || result.activeRect.height < 40) {
    throw new Error(`Internationalized narrow layout failed: ${JSON.stringify(result)}`);
  }
  await captureVisualRegression(cdp, 'rtl-narrow');
  await cdp.evaluate(`document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; true`);
  await cdp.command('Emulation.clearDeviceMetricsOverride');
}

async function probeResponsiveLayout(cdp, evidenceDirectory) {
  const probes = [
    { width: 1280, height: 800, touch: false },
    { width: 800, height: 600, touch: false },
    { width: 500, height: 600, touch: true },
  ];
  const results = [];
  for (const probe of probes) {
    await cdp.command('Emulation.setDeviceMetricsOverride', { width: probe.width, height: probe.height, deviceScaleFactor: 1, mobile: false, screenWidth: probe.width, screenHeight: probe.height });
    await cdp.command('Emulation.setTouchEmulationEnabled', probe.touch ? { enabled: true, maxTouchPoints: 1 } : { enabled: false });
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    const result = await cdp.evaluateJson(`(() => {
      const center = document.querySelector('.js-center');
      const mobileMode = document.querySelector('.js-mobile-mode');
      const inspector = document.querySelector('.js-inspector');
      const inspectorBody = document.querySelector('.js-inspector-body');
      const documentButton = document.querySelector('[data-document-open]');
      if (!(center instanceof HTMLElement) || !(mobileMode instanceof HTMLElement) || !(inspector instanceof HTMLElement) || !(inspectorBody instanceof HTMLElement) || !(documentButton instanceof HTMLButtonElement)) return { missing: true };
      const centerStyle = getComputedStyle(center);
      return {
        centerRows: centerStyle.gridTemplateRows,
        centerWidth: center.clientWidth,
        centerScrollWidth: center.scrollWidth,
        inspectorDisplay: getComputedStyle(inspector).display,
        inspectorRows: getComputedStyle(inspector).gridTemplateRows,
        inspectorBodyOverflow: getComputedStyle(inspectorBody).overflow,
        documentButtonVisible: documentButton.getBoundingClientRect().height > 0,
        mobileModeDisplay: getComputedStyle(mobileMode).display,
        documentScrollTop: document.scrollingElement.scrollTop,
      };
    })()`);
    if (result.missing || result.documentScrollTop !== 0 || result.centerWidth <= 0 || result.centerScrollWidth > result.centerWidth + 1 || result.inspectorBodyOverflow !== 'auto' || (probe.width > 860 && !result.documentButtonVisible)) throw new Error(`Final Electron responsive probe failed at ${probe.width}x${probe.height}: ${JSON.stringify(result)}`);
    if (probe.width <= 620 && (result.centerRows.trim().split(/\s+/).length !== 2 || Number.parseFloat(result.centerRows) < 44 || result.mobileModeDisplay === 'none')) throw new Error(`Final Electron touch layout did not expose the mobile mode row at ${probe.width}x${probe.height}: ${JSON.stringify(result)}`);
    if (probe.width <= 860 && result.inspectorDisplay !== 'none' && result.inspectorDisplay !== 'grid') throw new Error(`Final Electron narrow inspector layout was invalid at ${probe.width}x${probe.height}: ${JSON.stringify(result)}`);
    results.push({ ...probe, ...result });
    if (probe.width === 500) await captureVisualRegression(cdp, 'responsive-500x600-touch');
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      const screenshot = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await writeFile(join(evidenceDirectory, `electron-responsive-${probe.width}x${probe.height}${probe.touch ? '-touch' : ''}.png`), Buffer.from(screenshot.data, 'base64'));

    }
  }
  await cdp.command('Emulation.clearDeviceMetricsOverride');
  await cdp.command('Emulation.setTouchEmulationEnabled', { enabled: false });
  return results;
}
function locatePackagedElectron() {
  const configured = process.env.JSON_STRUCTURE_ELECTRON_EXECUTABLE;
  if (configured) {
    const executable = resolve(configured);
    if (!existsSync(executable)) throw new Error(`Configured packaged Electron executable does not exist: ${executable}`);
    return executable;
  }
  const releaseRoot = resolve(process.env.JSON_STRUCTURE_ELECTRON_RELEASE_ROOT || join(projectRoot, 'release'));
  const candidates = process.platform === 'win32'
    ? [join(releaseRoot, 'win-unpacked', 'JSON Structure Editor.exe')]
    : process.platform === 'linux'
      ? [join(releaseRoot, 'linux-unpacked', 'JSON Structure Editor'), join(releaseRoot, 'linux-unpacked', 'json-structure-editor')]
      : readdirSync(releaseRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith('mac')).flatMap((entry) => [
        join(releaseRoot, entry.name, 'JSON Structure Editor.app', 'Contents', 'MacOS', 'JSON Structure Editor'),
        join(releaseRoot, entry.name, 'JSON Structure Editor.app', 'Contents', 'MacOS', 'json-structure-editor'),
      ]);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error(`No final packaged Electron executable was found below ${releaseRoot}; run electron-builder --dir first. Checked: ${candidates.join(', ')}`);
  return executable;
}
async function run() {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(initialPath, initialText, 'utf8');
  await writeFile(conversionSourcePath, conversionSource, 'utf8');
  const port = await freePort();
  const electronBinary = locatePackagedElectron();
  const child = spawn(electronBinary, ['--headless', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${join(testRoot, 'user-data')}`, initialPath], {
    cwd: dirname(electronBinary),
    env: (() => {
      const value = {
        ...process.env,
        PATH: '',
        Path: '',
        PATHEXT: '',
        JSON_STRUCTURE_REAL_HOST_TEST: '1',
        JSON_STRUCTURE_REAL_HOST_OUTPUT_DIR: outputDirectory,
        JSON_STRUCTURE_REAL_HOST_SOURCE_PATH: conversionSourcePath,
      };
      delete value.STRUCTURIZE_RUNTIME_ROOT;
      delete value.STRUCTURIZE_EXECUTABLE;
      return value;
    })(),
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
  const evidenceDirectory = process.env.JSON_STRUCTURE_EVIDENCE_DIR;
  const record = (persona, workflow, detail) => {
    evidence.push({ persona, workflow, detail });
    console.log(`PASS ${persona}: ${workflow} — ${detail}`);
  };
  try {
    await cdp.waitFor('initial file activation', `document.title.includes('initial.struct.json')`);
    record('Schema author', 'initial file activation', 'BrowserWindow renderer received the real IPC file:opened event.');
    await auditAccessibility(cdp, 'initial design workbench');
    await captureVisualRegression(cdp, 'design-dark');
    await cdp.click('[data-theme-choice="light"]');
    await cdp.waitFor('light theme', `document.querySelector('.json-structure-editor')?.getAttribute('data-theme') === 'light'`);
    await captureVisualRegression(cdp, 'design-light');
    await cdp.click('[data-theme-choice="dark"]');
    await cdp.waitFor('dark theme restored', `document.querySelector('.json-structure-editor')?.getAttribute('data-theme') === 'dark'`);
    record('Keyboard and assistive technology user', 'automated accessibility gate', 'The initial rendered workbench passed WCAG A/AA axe rules.');

    const windowState = await cdp.evaluateJson(`({outerWidth, outerHeight, availWidth: screen.availWidth, availHeight: screen.availHeight, scrollTop: document.scrollingElement.scrollTop})`);
    if (windowState.scrollTop !== 0 || windowState.outerWidth < windowState.availWidth * 0.9 || windowState.outerHeight < windowState.availHeight * 0.85) {
      throw new Error(`Electron window was not maximized and scroll-locked: ${JSON.stringify(windowState)}`);
    }
    record('Schema author', 'maximized viewport containment', `${windowState.outerWidth}x${windowState.outerHeight}; document scrollTop remained ${windowState.scrollTop}.`);
    const responsiveEvidence = await probeResponsiveLayout(cdp, evidenceDirectory);
    await probeInternationalization(cdp);
    await cdp.click('[data-mode="design"]');
    record('International author', 'RTL and text expansion', 'Arabic, CJK, bidirectional, and expanded German text remained contained and keyboard reachable at 500x600.');

    await cdp.click('[data-problems-toggle]');
    await cdp.waitFor('open problems pane', `document.querySelector('.js-workbench')?.dataset.problemsOpen === 'true'`);
    const scrollEvidence = await cdp.evaluateJson(`(() => {
      const selectors = ['.js-tree', '[data-panel-mode="design"]', '.js-inspector-body', '.js-problem-list'];
      return selectors.map(selector => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) return { selector, missing: true };
        if (element.clientHeight === 0 || getComputedStyle(element).display === 'none') return { selector, skipped: true, reason: 'pane is intentionally hidden in the active mode' };
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
    if (scrollEvidence.some(entry => !entry.skipped && (entry.missing || entry.paneScrollTop <= 0 || entry.documentScrollTop !== 0 || entry.beforeDocument !== 0))) {
      throw new Error(`Independent pane scrolling escaped to the document: ${JSON.stringify(scrollEvidence)}`);
    }
    record('Schema author', 'independent pane scrolling', 'Visible tree, design, inspector, and problems panes scrolled independently while document scrollTop stayed zero; intentionally hidden panes were skipped.');
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
    await cdp.waitFor('schema atlas before drill-in', `document.querySelector('[data-graph-node="/definitions/Source"], [data-graph-node^="graph:namespace:"]') !== null`);
    if (!(await cdp.evaluate(`document.querySelector('[data-graph-node="/definitions/Source"]') !== null`))) {
      const namespaceNode = await cdp.evaluate(`document.querySelector('[data-graph-node^="graph:namespace:"]')?.getAttribute('data-graph-node')`);
      if (typeof namespaceNode !== 'string') throw new Error('The schema atlas did not expose the Source declaration or a namespace node.');
      await cdp.doubleClick(`[data-graph-node="${namespaceNode.replaceAll('"', '\\"')}"]`);
    }
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

    await cdp.click('.js-app-menu summary');
    await cdp.click('[data-chrome-command="import"]');
    await cdp.waitFor('import chooser', `document.querySelector('[data-start-conversion-chooser][open]') !== null`);
    await cdp.click('[data-start-conversion-command="import.structurize.j2s"]');
    await cdp.waitFor('JSON Schema import dialog', `document.querySelector('[data-start-conversion-dialog][data-start-command="import.structurize.j2s"][open]') !== null`);
    await auditAccessibility(cdp, 'JSON Schema import dialog');
    await captureVisualRegression(cdp, 'conversion-dialog-dark');
    await cdp.click('[data-start-conversion-dialog] [data-conversion-source]');
    await cdp.waitFor('selected conversion source', `document.querySelector('[data-start-conversion-dialog]')?.textContent?.includes('source.json') === true`);
    const configured = await cdp.evaluate(`(() => {
      const input = document.querySelector('[data-start-conversion-dialog] [data-conversion-option="root_class_name"]');
      if (!(input instanceof HTMLInputElement)) return false;
      input.value = 'Address';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!configured) throw new Error('The JSON Schema import option was not editable.');
    await cdp.click('[data-start-conversion-dialog] [data-conversion-run]');
    await cdp.waitFor('generated document activation', `document.title.includes('schema.struct.json')`);
    try {
      await cdp.waitFor('visible generated source editor', `(() => {
        const panel = document.querySelector('[data-panel-mode="source"]');
        const editor = panel?.querySelector('.monaco-editor');
        const rect = editor?.getBoundingClientRect();
        return panel instanceof HTMLElement && !panel.hidden && editor instanceof HTMLElement
          && rect.width > 300 && rect.height > 200
          && editor.textContent?.includes('"$schema"')
          && editor.textContent?.includes('ConvertedPerson');
      })()`, 30_000);
    } catch (error) {
      const state = await cdp.evaluateJson(`(() => {
        const panel = document.querySelector('[data-panel-mode="source"]');
        const source = panel?.querySelector('[data-source]');
        const editor = source?.querySelector('.monaco-editor');
        const rect = (element) => element?.getBoundingClientRect().toJSON();
        return {
          title: document.title,
          activeMode: document.querySelector('[data-mode][aria-pressed="true"]')?.getAttribute('data-mode'),
          panelHidden: panel instanceof HTMLElement ? panel.hidden : null,
          panelRect: rect(panel),
          sourceRect: rect(source),
          sourceHtml: source?.innerHTML.slice(0, 500),
          editorRect: rect(editor),
          editorText: editor?.textContent?.slice(0, 500),
          alerts: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent),
        };
      })()`);
      throw new Error(`${error instanceof Error ? error.message : String(error)} State: ${JSON.stringify(state)}`);
    }
    await auditAccessibility(cdp, 'generated source editor');
    await captureVisualRegression(cdp, 'conversion-result-source');
    record('Existing-schema adopter', 'visible conversion UI journey', 'File > Import selected JSON Schema, configured the root class, ran the packaged converter, opened the output, and rendered non-empty Monaco content.');

    await insertSourceText(cdp, '\n');
    await cdp.click('[data-chrome-command="save"]');
    await cdp.waitFor('saved document clean marker', `!document.title.startsWith('* ')`);
    const persisted = await readFile(generatedPath, 'utf8');
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
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(join(evidenceDirectory, 'electron-acceptance.json'), JSON.stringify({ platform: `${process.platform}-${process.arch}`, windowState, responsive: responsiveEvidence, evidence }, null, 2), 'utf8');
    }
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
