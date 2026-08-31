import { mountJsonStructureEditor, type JsonStructureEditorHandle } from './index.js';

/** Renderer-safe file bridge shape consumed by the shared UI bootstrap. */
export interface FileBridge {
  openFile(): Promise<{ path: string; text: string } | null>;
  saveFile(path: string, text: string): Promise<{ path: string }>;
  saveFileAs(text: string): Promise<{ path: string } | null>;
  onFileOpened(listener: (file: { path: string; text: string }) => void): () => void;
}

/** The editor operations required for ALPHA file lifecycle management. */
export interface AlphaEditorSurface {
  getText(): string;
  setText(text: string): void;
}

/** State and commands that connect an editor surface to an optional file bridge. */
export interface AlphaEditorController {
  readonly hasBridge: boolean;
  readonly path: string | undefined;
  readonly dirty: boolean;
  readonly replacing: boolean;
  open(): Promise<void>;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  acceptExternalFile(file: { path: string; text: string }): Promise<void>;
  markDirty(): void;
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
  let replacing = false;
  const replace = async (file: { path: string; text: string }): Promise<void> => {
    // An external open is allowed only after the user accepts losing dirty text.
    if (dirty && !confirmReplace(`Replace unsaved changes with ${fileName(file.path)}?`)) return;
    replacing = true;
    path = file.path;
    dirty = false;
    editor.setText(file.text);
    replacing = false;
    onStateChange();
  };
  const unsubscribe = bridge?.onFileOpened((file) => { void replace(file); });
  return {
    get hasBridge() { return bridge !== undefined; },
    get path() { return path; },
    get dirty() { return dirty; },
    get replacing() { return replacing; },
    async open() { if (bridge) { const file = await bridge.openFile(); if (file) await replace(file); } },
    async save() { if (bridge && path) { path = (await bridge.saveFile(path, editor.getText())).path; dirty = false; onStateChange(); } else await this.saveAs(); },
    async saveAs() { if (bridge) { const saved = await bridge.saveFileAs(editor.getText()); if (saved) { path = saved.path; dirty = false; onStateChange(); } } },
    acceptExternalFile: replace,
    markDirty() { dirty = true; onStateChange(); },
    dispose() { unsubscribe?.(); }
  };
}

/**
 * Mounts the ALPHA editor and adds bridge-backed file controls when available.
 * Without a bridge it mounts the same self-contained browser demonstration.
 */
export function bootstrapJsonStructureEditor(container: HTMLElement, demoText: string): JsonStructureEditorHandle {
  const bridge = (window as Window & { electronAPI?: FileBridge }).electronAPI;
  container.innerHTML = `<div class="js-alpha-filebar" hidden><button data-alpha-action="open">Open</button><button data-alpha-action="save">Save</button><button data-alpha-action="save-as">Save As</button><span data-alpha-title></span><span data-alpha-dirty></span></div><div data-alpha-editor></div>`;
  const fileBar = container.querySelector('.js-alpha-filebar') as HTMLElement;
  const title = container.querySelector('[data-alpha-title]') as HTMLElement;
  const dirty = container.querySelector('[data-alpha-dirty]') as HTMLElement;
  const mountPoint = container.querySelector('[data-alpha-editor]') as HTMLElement;
  let controller: AlphaEditorController | undefined;
  const editor = mountJsonStructureEditor(mountPoint, {
    text: demoText,
    onChange: () => { if (!controller?.replacing) { controller?.markDirty(); renderFileState(); } }
  });
  const renderFileState = (): void => {
    title.textContent = controller?.path ? fileName(controller.path) : 'Untitled JSON Structure';
    dirty.textContent = controller?.dirty ? 'Unsaved changes' : '';
  };
  controller = createAlphaEditorController(editor, bridge, window.confirm, renderFileState);
  if (bridge) {
    fileBar.hidden = false;
    fileBar.addEventListener('click', (event: Event) => {
      const action = (event.target as HTMLElement).dataset.alphaAction;
      if (action === 'open') void controller?.open().then(renderFileState);
      if (action === 'save') void controller?.save().then(renderFileState);
      if (action === 'save-as') void controller?.saveAs().then(renderFileState);
    });
  }
  renderFileState();
  return { ...editor, dispose: () => { controller?.dispose(); editor.dispose(); container.innerHTML = ''; } };
}

function fileName(path: string): string {
  return path.replace(/^.*[\\/]/, '');
}