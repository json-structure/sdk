import { mountJsonStructureEditor, type JsonStructureEditorHandle } from './index.js';
import type { EditorHost } from '../contracts.js';

export const defaultUntitledDocument = JSON.stringify({
  $schema: 'https://json-structure.org/meta/core/v0/#',
  $id: 'urn:json-structure:untitled',
  name: 'UntitledStructure',
  definitions: {},
}, null, 2);

export type HostCommand = 'new' | 'open' | 'save' | 'save-as' | 'show-commands';
export type WindowCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select-all' | 'reset-zoom' | 'zoom-in' | 'zoom-out' | 'toggle-fullscreen' | 'quit';

/** Renderer-safe file bridge shape consumed by the shared UI bootstrap. */
export interface FileBridge {
  readonly platform?: string;
  openFile(): Promise<FileBridgeDocument | null>;
  saveFile(path: string, text: string): Promise<{ path: string; uri?: string }>;
  saveFileAs(text: string): Promise<{ path: string; uri?: string } | null>;
  newDocument?(): Promise<{ readonly uri: string; readonly title: string }>;
  openExternal?(url: string): Promise<void>;
  activateDocument?(path: string, activationToken?: string): Promise<void>;
  discardDocument?(activationToken: string): Promise<void>;
  onFileOpened(listener: (file: FileBridgeDocument) => void): () => void;
  onFileCommand(listener: (command: HostCommand) => void): () => void;
  executeWindowCommand?(command: WindowCommand): Promise<void>;
  setTitleBarTheme?(theme: 'dark' | 'light' | 'contrast'): Promise<void>;
  readResource?(uri: string): Promise<{ uri: string; content: string; contentHash: string }>;
  listConversionCommands?: EditorHost['listConversionCommands'];
  selectConversionSource?: EditorHost['selectConversionSource'];
  convert?: EditorHost['convert'];
  onConversionProgress?: EditorHost['onConversionProgress'];
  cancelConversion?: EditorHost['cancelConversion'];
  openGeneratedOutput?: EditorHost['openGeneratedOutput'];
  libraryRequest?: EditorHost['libraryRequest'];
  listLibraryEntries?: EditorHost['listLibraryEntries'];
  readLibraryDocument?: EditorHost['readLibraryDocument'];
}

/** The editor operations required for ALPHA file lifecycle management. */
export interface FileBridgeDocument {
  readonly path: string;
  readonly text: string;
  readonly uri?: string;
  readonly activationToken?: string;
  readonly kind?: 'file' | 'generated';
}

export interface AlphaEditorSurface {
  getText(): string;
  setText(text: string): void;
  setUri?(uri: string): void;
  /** Optional clean marker supplied by the shared editor surface. */
  markSaved?(): void;
}

/** State and commands that connect an editor surface to an optional file bridge. */
export interface AlphaEditorController {
  readonly hasBridge: boolean;
  readonly path: string | undefined;
  readonly dirty: boolean;
  readonly replacing: boolean;
  open(): Promise<void>;
  newDocument(): Promise<void>;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  acceptExternalFile(file: FileBridgeDocument): Promise<void>;
  markDirty(): void;
  /** Recomputes dirty state against the last successfully saved bytes. */
  syncDirty(): void;
  /** Explicitly marks the current editor bytes as saved. */
  markClean(): void;
  dispose(): void;
}

/**
 * Creates the host adapter responsible for file lifecycle and dirty state.
 *
 * The bridge is structural rather than an Electron import, so the editor
 * remains usable by a browser demo and other renderer hosts.
 */
export function createAlphaEditorController(editor: AlphaEditorSurface, bridge: FileBridge | undefined, confirmReplace: (message: string) => boolean = window.confirm, onStateChange: () => void = () => undefined): AlphaEditorController {
  let path: string | undefined;
  let dirty = false;
  let savedText = editor.getText();
  let replacing = false;
  let revision = 0;
  let documentGeneration = 0;
  let replacementRequest = 0;
  const discardStaged = async (file: FileBridgeDocument): Promise<void> => {
    if (file.activationToken) await bridge?.discardDocument?.(file.activationToken);
  };
  const replace = async (file: FileBridgeDocument): Promise<void> => {
    // An external open is allowed only after the user accepts losing dirty text.
    if (dirty && !confirmReplace(`Replace unsaved changes with ${fileName(file.path)}?`)) {
      await discardStaged(file);
      return;
    }
    const request = ++replacementRequest;
    replacing = true;
    documentGeneration += 1;
    try {
      if (file.activationToken) await bridge?.activateDocument?.(file.path, file.activationToken);
      if (request !== replacementRequest) {
        await discardStaged(file);
        return;
      }
      revision += 1;
      path = file.path;
      dirty = false;
      savedText = file.text;
      editor.setUri?.(file.uri ?? filePathUri(file.path));
      editor.setText(file.text);
      editor.markSaved?.();
    } catch {
      await discardStaged(file);
    } finally {
      if (request === replacementRequest) {
        replacing = false;
        onStateChange();
      }
    }
  };
  const createNew = async (): Promise<void> => {
    if (dirty && !confirmReplace('Replace unsaved changes with a new document?')) return;
    const request = ++replacementRequest;
    replacing = true;
    documentGeneration += 1;
    try {
      const next = await bridge?.newDocument?.();
      if (request !== replacementRequest) return;
      revision += 1;
      path = undefined;
      dirty = false;
      savedText = defaultUntitledDocument;
      editor.setUri?.(next?.uri ?? `untitled:json-structure-${Date.now()}.struct.json`);
      editor.setText(defaultUntitledDocument);
      editor.markSaved?.();
    } finally {
      if (request === replacementRequest) {
        replacing = false;
        onStateChange();
      }
    }
  };
  const unsubscribe = bridge?.onFileOpened((file) => { void replace(file); });
  return {
    get hasBridge() { return bridge !== undefined; },
    get path() { return path; },
    get dirty() { return dirty; },
    get replacing() { return replacing; },
    async open() { if (bridge) { const file = await bridge.openFile(); if (file) await replace(file); } },
    newDocument: createNew,
    async save() {
      if (!bridge || !path) { await this.saveAs(); return; }
      const savedGeneration = documentGeneration;
      const textAtSave = editor.getText();
      const saved = await bridge.saveFile(path, textAtSave);
      if (documentGeneration !== savedGeneration) return;
      path = saved.path;
      editor.setUri?.(saved.uri ?? filePathUri(saved.path));
      savedText = textAtSave;
      dirty = editor.getText() !== savedText;
      if (!dirty) editor.markSaved?.();
      onStateChange();
    },
    async saveAs() {
      if (!bridge) return;
      const savedGeneration = documentGeneration;
      const textAtSave = editor.getText();
      const saved = await bridge.saveFileAs(textAtSave);
      if (saved && documentGeneration === savedGeneration) {
        path = saved.path;
        editor.setUri?.(saved.uri ?? filePathUri(saved.path));
        savedText = textAtSave;
        dirty = editor.getText() !== savedText;
        if (!dirty) editor.markSaved?.();
        onStateChange();
      }
    },
    acceptExternalFile: replace,
    markDirty() { revision += 1; dirty = true; onStateChange(); },
    syncDirty() { revision += 1; const next = editor.getText() !== savedText; if (dirty !== next) { dirty = next; onStateChange(); } },
    markClean() { savedText = editor.getText(); dirty = false; editor.markSaved?.(); onStateChange(); },
    dispose() { unsubscribe?.(); }
  };
}

/**
 * Mounts the editor and connects native host file commands when available.
 * Without a bridge it mounts the same self-contained browser demonstration.
 */
export function bootstrapJsonStructureEditor(container: HTMLElement, demoText: string): JsonStructureEditorHandle {
  const bridge = (window as Window & { electronAPI?: FileBridge }).electronAPI;
  container.innerHTML = `<style>.js-alpha-host,.js-alpha-editor{height:100%;min-height:0}</style><div class="js-alpha-host"><div class="js-alpha-editor" data-alpha-editor></div></div>`;
  const mountPoint = container.querySelector('[data-alpha-editor]') as HTMLElement;
  let controller: AlphaEditorController | undefined;
  const editor = mountJsonStructureEditor(mountPoint, {
    text: demoText,
    services: bridge,
    chrome: bridge?.platform === 'darwin' ? 'document' : 'integrated',
    onChromeCommand: (command) => {
      if (command === 'new') return controller?.newDocument();
      if (command === 'open') return controller?.open();
      if (command === 'save') return controller?.save();
      if (command === 'save-as') return controller?.saveAs();
      if (command === 'show-commands') { editor.showCommandPalette(); return; }
      if (command === 'undo' || command === 'redo') {
        // Design history is session-owned. Only delegate to the host when Monaco
        // has text focus, so its native source stack remains authoritative.
        if (editor.isSourceEditorFocused?.()) return bridge?.executeWindowCommand?.(command) ?? (command === 'undo' ? editor.undo?.() : editor.redo?.());
        return command === 'undo' ? editor.undo?.() : editor.redo?.();
      }
      if (command === 'website') return bridge?.openExternal?.('https://json-structure.org/');
      return bridge?.executeWindowCommand?.(command);
    },
    onThemeChange: (theme) => bridge?.setTitleBarTheme?.(theme),
    readResource: bridge?.readResource ? async (uri) => ({ protocolVersion: 1, requestId: `resource-${Date.now()}`, ...await bridge.readResource!(uri) }) : undefined,
    onChange: () => { if (!controller?.replacing) { controller?.syncDirty(); renderFileState(); } }
  });
  const renderFileState = (): void => {
    const title = controller?.path ? fileName(controller.path) : 'Untitled JSON Structure';
    document.title = `${controller?.dirty ? '* ' : ''}${title} - JSON Structure`;
    editor.setTitle(title);
  };
  controller = createAlphaEditorController(editor, bridge, window.confirm, renderFileState);
  if (bridge) {
    const execute = (command: HostCommand): void => {
      if (command === 'show-commands') { editor.showCommandPalette(); return; }
      const operation = command === 'new' ? controller?.newDocument() : command === 'open' ? controller?.open() : command === 'save' ? controller?.save() : controller?.saveAs();
      void operation?.then(renderFileState);
    };
    const unsubscribeCommand = bridge.onFileCommand(execute);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const command = event.key.toLowerCase() === 'n' && !event.shiftKey ? 'new' : event.key.toLowerCase() === 'o' && !event.shiftKey ? 'open' : event.key.toLowerCase() === 's' ? (event.shiftKey ? 'save-as' : 'save') : undefined;
      if (command) { event.preventDefault(); execute(command); }
    };
    window.addEventListener('keydown', onKeyDown);
    const originalDispose = controller.dispose.bind(controller);
    controller.dispose = () => { unsubscribeCommand(); window.removeEventListener('keydown', onKeyDown); originalDispose(); };
  }
  renderFileState();
  return { ...editor, dispose: () => { controller?.dispose(); editor.dispose(); container.innerHTML = ''; } };
}

function fileName(path: string): string {
  return path.replace(/^.*[\\/]/, '');
}

function filePathUri(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('//')) return `file:${encodeURI(normalized)}`;
  return `file://${normalized.startsWith('/') ? '' : '/'}${encodeURI(normalized)}`;
}