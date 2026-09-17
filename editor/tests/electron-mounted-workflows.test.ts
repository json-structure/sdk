// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapJsonStructureEditor } from '../src/ui/bootstrap.js';
import type { FileBridge } from '../src/ui/bootstrap.js';
import type { JsonStructureEditorHandle } from '../src/ui/index.js';

let handle: JsonStructureEditorHandle | undefined;
let emitOpened: ((file: { path: string; text: string }) => void) | undefined;
let emitCommand: ((command: 'new' | 'open' | 'save' | 'save-as' | 'show-commands' | 'close') => void) | undefined;
let closeRequests: { readonly dirty: boolean; readonly text: string }[] = [];
let closeApproved = false;
let finalizedClose = 0;

function mount(initialText: string): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const openedListeners = new Set<(file: { path: string; text: string }) => void>();
  const bridge: FileBridge & { newDocument(): Promise<{ readonly uri: string; readonly title: string }>; activateDocument(path: string, activationToken?: string): Promise<void>; discardDocument(activationToken: string): Promise<void> } = {
    openFile: async () => null,
    saveFile: async (path) => ({ path }),
    saveFileAs: async () => null,
    newDocument: async () => ({ uri: 'untitled:mounted.struct.json', title: 'Untitled JSON Structure' }),
    activateDocument: async () => undefined,
    discardDocument: async () => undefined,
    closeWindow: async (request) => { closeRequests.push(request); return { approved: closeApproved }; },
    finalizeWindowClose: async () => { finalizedClose += 1; },
    onFileOpened(listener) {
      openedListeners.add(listener);
      return () => openedListeners.delete(listener);
    },
    onFileCommand(listener) { emitCommand = listener; return () => { emitCommand = undefined; }; },
  };
  emitOpened = (file) => openedListeners.forEach((listener) => listener(file));
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: bridge });
  handle = bootstrapJsonStructureEditor(container, initialText);
  return container;
}

function select(root: HTMLElement, selector: string, value: string): void {
  const control = root.querySelector(selector);
  if (!(control instanceof HTMLSelectElement)) throw new Error(`Missing select: ${selector}`);
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

afterEach(() => {
  handle?.dispose();
  handle = undefined;
  emitOpened = undefined;
  emitCommand = undefined;
  closeRequests = [];
  closeApproved = false;
  finalizedClose = 0;
  document.body.innerHTML = '';
  Reflect.deleteProperty(window, 'electronAPI');
});

describe('mounted Electron document workflows', () => {
  it('sends the latest dirty editor text through the guarded native close workflow', async () => {
    mount('{"before":true}');
    handle?.setText('{"unsaved":true}');
    emitCommand?.('close');
    await settle();
    expect(closeRequests).toEqual([{ dirty: true, text: '{"unsaved":true}' }]);
    expect(finalizedClose).toBe(0);
  });

  it('finalizes an approved close only after the editor is made inert', async () => {
    const root = mount('{"clean":true}');
    closeApproved = true;
    emitCommand?.('close');
    await settle();
    expect(root.inert).toBe(true);
    expect(finalizedClose).toBe(1);
  });

  it('delivers an external file through the typed bridge with a new URI-backed session', async () => {
    const root = mount('{"before":true}');
    if (!emitOpened) throw new Error('Bridge event is not installed.');
    emitOpened({ path: 'C:\\schemas\\opened.struct.json', text: '{"opened":true}' });
    await settle();

    expect(handle?.getText()).toBe('{"opened":true}');
    expect(root.querySelector('[data-document-title]')?.textContent).toBe('opened.struct.json');
    expect(document.title).toContain('opened.struct.json');
  });

  it('persists array, set, and map member edits across navigation', async () => {
    const root = mount(JSON.stringify({
      definitions: {
        ArrayValues: { type: 'array', items: { type: 'string' } },
        SetValues: { type: 'set', items: { type: 'integer' } },
        MapValues: { type: 'map', values: { type: 'boolean' } },
      },
    }));

    const selectDefinition = async (pointer: string): Promise<void> => {
      const button = root.querySelector(`[data-select="${pointer}"]`);
      if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing definition: ${pointer}`);
      button.click();
      await settle();
    };

    await selectDefinition('/definitions/ArrayValues');
    select(root, '[data-property-pointer="/definitions/ArrayValues/items"][data-inline-type-replace]', 'type:number');
    await settle();
    await selectDefinition('/definitions/SetValues');
    select(root, '[data-property-pointer="/definitions/SetValues/items"][data-inline-type-replace]', 'type:string');
    await settle();
    await selectDefinition('/definitions/MapValues');
    select(root, '[data-property-pointer="/definitions/MapValues/values"][data-inline-type-replace]', 'type:date');
    await settle();

    await selectDefinition('/definitions/ArrayValues');
    expect(JSON.parse(handle!.getText()).definitions.ArrayValues.items).toEqual({ type: 'number' });
    await selectDefinition('/definitions/SetValues');
    expect(JSON.parse(handle!.getText()).definitions.SetValues.items).toEqual({ type: 'string' });
    await selectDefinition('/definitions/MapValues');
    expect(JSON.parse(handle!.getText()).definitions.MapValues.values).toEqual({ type: 'date' });
  });
});
