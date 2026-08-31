import { mountJsonStructureEditor, type JsonStructureEditorHandle } from './index.js';
import type { EditorHost } from '../contracts.js';

export const defaultUntitledDocument = JSON.stringify({
  $schema: 'https://json-structure.org/meta/core/v0/#',
  $id: 'urn:json-structure:untitled',
  name: 'UntitledStructure',
  definitions: {},
}, null, 2);

export type HostCommand = 'open' | 'save' | 'save-as' | 'show-commands';

/** Renderer-safe file bridge shape consumed by the shared UI bootstrap. */
export interface FileBridge {
  openFile(): Promise<{ path: string; text: string } | null>;
  saveFile(path: string, text: string): Promise<{ path: string }>;
  saveFileAs(text: string): Promise<{ path: string } | null>;
  onFileOpened(listener: (file: { path: string; text: string }) => void): () => void;
  onFileCommand(listener: (command: HostCommand) => void): () => void;
  readResource?(uri: string): Promise<{ uri: string; content: string; contentHash: string }>;
  listConversionCommands?: EditorHost['listConversionCommands'];
  convert?: EditorHost['convert'];
  onConversionProgress?: EditorHost['onConversionProgress'];
  cancelConversion?: EditorHost['cancelConversion'];
  openGeneratedOutput?: EditorHost['openGeneratedOutput'];
  libraryRequest?: EditorHost['libraryRequest'];
  listLibraryEntries?: EditorHost['listLibraryEntries'];
  readLibraryDocument?: EditorHost['readLibraryDocument'];
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
    readResource: bridge?.readResource ? async (uri) => ({ protocolVersion: 1, requestId: `resource-${Date.now()}`, ...await bridge.readResource!(uri) }) : undefined,
    onChange: () => { if (!controller?.replacing) { controller?.markDirty(); renderFileState(); } }
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
      const operation = command === 'open' ? controller?.open() : command === 'save' ? controller?.save() : controller?.saveAs();
      void operation?.then(renderFileState);
    };
    const unsubscribeCommand = bridge.onFileCommand(execute);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const command = event.key.toLowerCase() === 'o' && !event.shiftKey ? 'open' : event.key.toLowerCase() === 's' ? (event.shiftKey ? 'save-as' : 'save') : undefined;
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