// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const monacoTest = vi.hoisted(() => {
  type Listener = () => void;
  class FakeModel {
    readonly uri: { toString(): string };
    private value: string;
    private disposed = false;
    private readonly undoStack: string[] = [];
    private readonly redoStack: string[] = [];
    private readonly listeners = new Set<Listener>();
    constructor(text: string, uri: string) { this.value = text; this.uri = { toString: () => uri }; }
    getValue(): string { return this.value; }
    getValueLength(): number { return this.value.length; }
    getLineCount(): number { return this.value.split(/\r?\n/).length; }
    getFullModelRange(): unknown { return undefined; }
    getPositionAt(offset: number): { lineNumber: number; column: number } { return { lineNumber: 1, column: offset + 1 }; }
    isDisposed(): boolean { return this.disposed; }
    dispose(): void { this.disposed = true; this.listeners.clear(); }
    onChange(listener: Listener): { dispose(): void } {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    }
    setUserText(text: string): void { this.undoStack.push(this.value); this.redoStack.length = 0; this.value = text; this.emit(); }
    pushEditOperations(_selections: unknown, edits: readonly { readonly text: string }[], _callback: () => unknown): unknown[] {
      this.undoStack.push(this.value);
      this.redoStack.length = 0;
      this.value = edits[0]?.text ?? this.value;
      this.emit();
      return [];
    }
    undo(): void {
      const previous = this.undoStack.pop();
      if (previous === undefined) return;
      this.redoStack.push(this.value);
      this.value = previous;
      this.emit();
    }
    redo(): void {
      const next = this.redoStack.pop();
      if (next === undefined) return;
      this.undoStack.push(this.value);
      this.value = next;
      this.emit();
    }
    private emit(): void { for (const listener of this.listeners) listener(); }
  }
  const actions: string[] = [];
  class FakeEditor {
    private focused = false;
    constructor(private readonly model: FakeModel) {}
    onDidChangeModelContent(listener: Listener): { dispose(): void } { return this.model.onChange(listener); }
    focus(): void { this.focused = true; }
    hasTextFocus(): boolean { return this.focused; }
    trigger(_source: string, action: string, _payload: unknown): void {
      actions.push(action);
      if (action === 'undo') this.model.undo();
      else if (action === 'redo') this.model.redo();
    }
    setSelection(_range: unknown): void { return; }
    revealRangeInCenter(_range: unknown): void { return; }
    dispose(): void { this.focused = false; }
  }
  const models: FakeModel[] = [];
  return {
    models,
    actions,
    createJsonModel(text: string, uri?: string): FakeModel {
      const model = new FakeModel(text, uri ?? 'inmemory://json-structure');
      models.push(model);
      return model;
    },
    createJsonEditor(_element: HTMLElement, model: FakeModel): FakeEditor { return new FakeEditor(model); },
  };
});

vi.mock('../src/ui/monaco.js', () => monacoTest);
import { mountJsonStructureEditor, type JsonStructureEditorHandle } from '../src/ui/index.js';

let handle: JsonStructureEditorHandle | undefined;
afterEach(() => { handle?.dispose(); handle = undefined; document.body.innerHTML = ''; monacoTest.models.length = 0; monacoTest.actions.length = 0; });

async function settle(): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 20)); }

function activeModel(): (typeof monacoTest.models)[number] {
  const model = [...monacoTest.models].reverse().find((candidate) => !candidate.isDisposed());
  if (!model) throw new Error('No active Monaco model.');
  return model;
}

describe('Source Monaco document identity', () => {
  it.each([
    ['f', 'actions.find'],
    ['h', 'editor.action.startFindReplaceAction'],
  ])('opens Monaco search action %s from the standard keyboard shortcut', async (key, action) => {
    const container = document.createElement('div');
    document.body.append(container);
    handle = mountJsonStructureEditor(container, { text: '{"type":"string"}', uri: 'memory://search-shortcut', chrome: 'integrated' });

    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
    await settle();

    expect(container.querySelector('[data-mode="source"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(monacoTest.actions).toContain(action);
  });

  it.each([
    ['find', 'actions.find'],
    ['replace', 'editor.action.startFindReplaceAction'],
  ])('opens Monaco search action from the Edit menu command %s', async (command, action) => {
    const container = document.createElement('div');
    document.body.append(container);
    handle = mountJsonStructureEditor(container, { text: '{"type":"string"}', uri: 'memory://search-menu', chrome: 'integrated' });
    const button = container.querySelector(`[data-chrome-command="${command}"]`);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing ${command} menu command.`);

    button.click();
    await settle();

    expect(container.querySelector('[data-mode="source"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(monacoTest.actions).toContain(action);
  });

  it('does not carry document A undo history into replacement document B', async () => {
    const documentA = '{"type":"string"}';
    const documentB = '{"type":"number"}';
    const container = document.createElement('div');
    document.body.append(container);
    handle = mountJsonStructureEditor(container, { text: documentA, uri: 'memory://document-a' });
    const sourceButton = container.querySelector('[data-mode="source"]');
    if (!(sourceButton instanceof HTMLButtonElement)) throw new Error('Missing Source tab.');
    sourceButton.click();
    await settle();

    const modelA = activeModel();
    const editedA = '{"type":"string","description":"A"}';
    modelA.setUserText(editedA);
    await settle();
    expect(handle.getText()).toBe(editedA);
    modelA.undo();
    await settle();
    expect(handle.getText()).toBe(documentA);
    expect(handle.dirty).toBe(false);

    handle.setUri('memory://document-b');
    handle.setText(documentB);
    handle.markSaved?.();
    await settle();
    const modelB = activeModel();
    expect(modelA.isDisposed()).toBe(true);
    expect(modelB.uri.toString()).toBe('memory://document-b');
    handle.undo?.();
    await settle();
    expect(handle.getText()).toBe(documentB);
    expect(handle.dirty).toBe(false);
  });
});