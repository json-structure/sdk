// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { mountJsonStructureEditor, type JsonStructureEditorHandle } from '../src/ui/index.js';

let handle: JsonStructureEditorHandle | undefined;

const fixture = {
  definitions: {
    Record: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string' },
      },
    },
  },
};

function setViewport(width: number, height: number, maxTouchPoints: number): void {
  window.happyDOM.setViewport({ width, height });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
}

function mountAt(width: number, height: number, maxTouchPoints = 0): HTMLElement {
  handle?.dispose();
  handle = undefined;
  document.body.innerHTML = '';
  setViewport(width, height, maxTouchPoints);
  const container = document.createElement('div');
  document.body.append(container);
  handle = mountJsonStructureEditor(container, { text: JSON.stringify(fixture), title: 'responsive.struct.json' });
  return container;
}

interface LayoutStyle {
  readonly display: string;
  readonly gridTemplateRows: string;
  readonly overflow: string;
  readonly cursor: string;
  readonly minHeight: string;
  readonly gridRow: string;
}

function element(root: HTMLElement, selector: string): HTMLElement {
  const value = root.querySelector(selector);
  if (!(value instanceof HTMLElement)) throw new Error(`Missing mounted element: ${selector}`);
  return value;
}

function computed(root: HTMLElement, selector: string): LayoutStyle {
  return window.getComputedStyle(element(root, selector));
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

afterEach(() => {
  handle?.dispose();
  handle = undefined;
  document.body.innerHTML = '';
  setViewport(1024, 768, 0);
});

describe('mounted responsive workbench layout', () => {
  it('keeps the inspector a stacked, scrollable grid at desktop and narrow widths', () => {
    const desktop = mountAt(1280, 800);
    const desktopInspector = computed(desktop, '.js-inspector');
    expect(desktopInspector.display).toBe('grid');
    expect(compact(desktopInspector.gridTemplateRows)).toContain('minmax(140px,260px)9pxminmax(180px,1fr)');
    expect(computed(desktop, '.js-inspector-body').overflow).toBe('auto');
    expect(computed(desktop, '.js-document-pane-body').overflow).toBe('auto');
    expect(computed(desktop, '[data-properties-pane-splitter]').cursor).toBe('row-resize');
    expect(computed(desktop, '[data-properties-pane-splitter]').minHeight).toBe('9px');
    const desktopSplitter = element(desktop, '[data-properties-pane-splitter]');
    expect(desktopSplitter.getAttribute('role')).toBe('separator');
    expect(desktopSplitter.getAttribute('aria-orientation')).toBe('horizontal');
    desktopSplitter.focus();
    expect(document.activeElement).toBe(desktopSplitter);

    const narrow = mountAt(800, 600);
    const inspectorToggle = element(narrow, '[data-mobile-drawer="inspector"]');
    inspectorToggle.click();
    const narrowInspector = computed(narrow, '.js-inspector');
    expect(element(narrow, '.js-inspector').classList.contains('js-drawer-open')).toBe(true);
    expect(narrowInspector.display).toBe('grid');
    expect(compact(narrowInspector.gridTemplateRows)).toContain('minmax(140px,260px)9pxminmax(180px,1fr)');
    expect(computed(narrow, '.js-inspector-body').minHeight).toBe('0');
    expect(computed(narrow, '.js-document-pane-body').minHeight).toBe('0');
    expect(computed(narrow, '.js-inspector-body').overflow).toBe('auto');
    expect(computed(narrow, '.js-document-pane-body').overflow).toBe('auto');
    expect(element(narrow, '.js-inspector').getAttribute('aria-label')).toBe('Properties and schema metadata');
    expect(element(narrow, '[data-properties-pane-splitter]').getAttribute('aria-label')).toBe('Resize Properties and Schema metadata panes');
    expect(computed(narrow, '[data-pane-splitter="inspector"]').display).toBe('none');
    expect(compact(window.getComputedStyle(element(narrow, '.js-row')).gridTemplateColumns)).toContain('72px');
  });

  it('gives touch tabs and every primary view the remaining center row', async () => {
    const root = mountAt(500, 600, 1);
    expect(compact(computed(root, '.js-center').gridTemplateRows)).toBe('44pxminmax(0,1fr)');
    expect(computed(root, '.js-editor-tab').minHeight).toBe('44px');
    expect(computed(root, '.js-mobile-mode').display).toBe('block');
    expect(computed(root, '.js-mobile-mode select').minHeight).toBe('44px');

    const inspectorToggle = element(root, '[data-mobile-drawer="inspector"]');
    inspectorToggle.click();
    await Promise.resolve();
    const inspector = element(root, '.js-inspector');
    expect(computed(root, '.js-inspector').display).toBe('grid');
    expect(compact(computed(root, '.js-inspector').gridTemplateRows)).toBe('minmax(140px,260px)44pxminmax(140px,1fr)');
    expect(computed(root, '[data-properties-pane-splitter]').minHeight).toBe('44px');
    const close = element(inspector, '[data-mobile-drawer-close]');
    expect(close.getAttribute('aria-label')).toBe('Close Properties and schema metadata');
    expect(document.activeElement).toBe(close);
    close.click();

    for (const mode of ['design', 'source'] as const) {
      const view = element(root, `[data-panel-mode="${mode}"]`);
      view.hidden = false;
      expect(computed(root, `[data-panel-mode="${mode}"]`).gridRow).toBe('2');
      expect(computed(root, `[data-panel-mode="${mode}"]`).minHeight).toBe('0');
      expect(computed(root, `[data-panel-mode="${mode}"]`).overflow).toBe(mode === 'design' ? 'auto' : 'hidden');
    }

    const graphButton = element(root, '[data-mode="graph"]');
    graphButton.click();
    expect(compact(computed(root, '.js-center').gridTemplateRows)).toBe('minmax(0,1fr)');
    expect(computed(root, '[data-panel-mode="graph"]').gridRow).toBe('1');
    expect(computed(root, '[data-panel-mode="graph"]').minHeight).toBe('0');
    expect(computed(root, '[data-panel-mode="graph"]').overflow).toBe('hidden');
  });
});
