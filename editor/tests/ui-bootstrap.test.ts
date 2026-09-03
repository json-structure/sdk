import { describe, expect, it } from 'vitest';
import { createAlphaEditorController, defaultUntitledDocument, type AlphaEditorSurface, type FileBridge } from '../src/ui/bootstrap.js';

function editor(): AlphaEditorSurface & { text: string; uri?: string } {
  return { text: '{"version":1}', getText() { return this.text; }, setText(text) { this.text = text; }, setUri(uri) { this.uri = uri; } };
}

describe('ALPHA UI bootstrap', () => {
  it('starts with a minimal valid untitled document', () => {
    expect(JSON.parse(defaultUntitledDocument)).toEqual({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'urn:json-structure:untitled',
      name: 'UntitledStructure',
      definitions: {},
    });
  });

  it('opens, saves, and saves as through the bridge while tracking lifecycle state', async () => {
    const surface = editor();
    const calls: string[] = [];
    const bridge: FileBridge = {
      openFile: async () => ({ path: 'C:/schemas/opened.struct.json', text: '{"opened":true}' }),
      saveFile: async (path, text) => { calls.push(`${path}:${text}`); return { path }; },
      saveFileAs: async (text) => { calls.push(`as:${text}`); return { path: 'C:/schemas/saved.struct.json' }; },
      onFileOpened: () => () => undefined,
      onFileCommand: () => () => undefined
    };
    const controller = createAlphaEditorController(surface, bridge, () => true);
    await controller.open();
    expect(surface.text).toBe('{"opened":true}');
    expect(surface.uri).toBe('file:///C:/schemas/opened.struct.json');
    expect(controller.path).toBe('C:/schemas/opened.struct.json');
    controller.markDirty();
    await controller.save();
    expect(controller.dirty).toBe(false);
    await controller.saveAs();
    expect(controller.path).toBe('C:/schemas/saved.struct.json');
    expect(surface.uri).toBe('file:///C:/schemas/saved.struct.json');
    expect(calls).toEqual(['C:/schemas/opened.struct.json:{"opened":true}', 'as:{"opened":true}']);
  });

  it('retains dirty text when an external open is declined', async () => {
    const surface = editor();
    const controller = createAlphaEditorController(surface, undefined, () => false);
    controller.markDirty();
    await controller.acceptExternalFile({ path: 'C:/schemas/external.struct.json', text: '{"external":true}' });
    expect(surface.text).toBe('{"version":1}');
    expect(controller.path).toBeUndefined();
    expect(controller.dirty).toBe(true);
  });

  it('keeps an edit made during save dirty after the write completes', async () => {
    const surface = editor();
    let finishSave: ((value: { path: string }) => void) | undefined;
    const bridge: FileBridge = {
      openFile: async () => ({ path: 'C:/schemas/opened.struct.json', text: '{"saved":1}' }),
      saveFile: async () => new Promise((resolve) => { finishSave = resolve; }),
      saveFileAs: async () => null,
      onFileOpened: () => () => undefined,
      onFileCommand: () => () => undefined
    };
    const controller = createAlphaEditorController(surface, bridge, () => true);
    await controller.open();
    surface.text = '{"saved":0}';
    controller.markDirty();
    const saving = controller.save();
    surface.text = '{"saved":2}';
    controller.markDirty();
    finishSave?.({ path: 'C:/schemas/opened.struct.json' });
    await saving;

    expect(controller.dirty).toBe(true);
    expect(surface.text).toBe('{"saved":2}');
    surface.text = '{"saved":0}';
    controller.syncDirty();
    expect(controller.dirty).toBe(false);
    surface.text = '{"saved":1}';
    controller.syncDirty();
    expect(controller.dirty).toBe(true);
  });

  it('keeps an edit made during save-as dirty while adopting the selected path', async () => {
    const surface = editor();
    let finishSaveAs: ((value: { path: string }) => void) | undefined;
    const bridge: FileBridge = {
      openFile: async () => null,
      saveFile: async (path) => ({ path }),
      saveFileAs: async () => new Promise((resolve) => { finishSaveAs = resolve; }),
      onFileOpened: () => () => undefined,
      onFileCommand: () => () => undefined
    };
    const controller = createAlphaEditorController(surface, bridge, () => true);
    surface.text = '{"version":0}';
    controller.markDirty();
    const saving = controller.saveAs();
    surface.text = '{"version":2}';
    controller.markDirty();
    finishSaveAs?.({ path: 'C:/schemas/saved.struct.json' });
    await saving;

    expect(controller.path).toBe('C:/schemas/saved.struct.json');
    expect(surface.uri).toBe('file:///C:/schemas/saved.struct.json');
    expect(controller.dirty).toBe(true);
    surface.text = '{"version":0}';
    controller.syncDirty();
    expect(controller.dirty).toBe(false);
    surface.text = '{"version":1}';
    controller.syncDirty();
    expect(controller.dirty).toBe(true);
  });

  it('ignores a late save response after another file opens', async () => {
    const surface = editor();
    let finishSave: ((value: { path: string }) => void) | undefined;
    const bridge: FileBridge = {
      openFile: async () => ({ path: 'C:/schemas/first.struct.json', text: '{"first":true}' }),
      saveFile: async () => new Promise((resolve) => { finishSave = resolve; }),
      saveFileAs: async () => null,
      onFileOpened: () => () => undefined,
      onFileCommand: () => () => undefined
    };
    const controller = createAlphaEditorController(surface, bridge, () => true);
    await controller.open();
    controller.markDirty();
    const saving = controller.save();
    await controller.acceptExternalFile({ path: 'C:/schemas/second.struct.json', text: '{"second":true}' });

    finishSave?.({ path: 'C:/schemas/late-save.struct.json' });
    await saving;

    expect(controller.path).toBe('C:/schemas/second.struct.json');
    expect(surface.uri).toBe('file:///C:/schemas/second.struct.json');
    expect(surface.text).toBe('{"second":true}');
    expect(controller.dirty).toBe(false);
  });

  it('ignores a late save-as response after another file opens', async () => {
    const surface = editor();
    let finishSaveAs: ((value: { path: string }) => void) | undefined;
    const bridge: FileBridge = {
      openFile: async () => null,
      saveFile: async (path) => ({ path }),
      saveFileAs: async () => new Promise((resolve) => { finishSaveAs = resolve; }),
      onFileOpened: () => () => undefined,
      onFileCommand: () => () => undefined
    };
    const controller = createAlphaEditorController(surface, bridge, () => true);
    controller.markDirty();
    const saving = controller.saveAs();
    await controller.acceptExternalFile({ path: 'C:/schemas/second.struct.json', text: '{"second":true}' });

    finishSaveAs?.({ path: 'C:/schemas/late-save-as.struct.json' });
    await saving;

    expect(controller.path).toBe('C:/schemas/second.struct.json');
    expect(surface.uri).toBe('file:///C:/schemas/second.struct.json');
    expect(surface.text).toBe('{"second":true}');
    expect(controller.dirty).toBe(false);
  });

  it('activates accepted staged files and discards cancelled selections', async () => {
    const surface = editor();
    const activated: string[] = [];
    const discarded: string[] = [];
    const bridge: FileBridge = {
      openFile: async () => null,
      saveFile: async (path) => ({ path }),
      saveFileAs: async () => null,
      activateDocument: async (path, token) => { activated.push(`${path}:${token}`); },
      discardDocument: async (token) => { discarded.push(token); },
      onFileOpened: () => () => undefined,
      onFileCommand: () => () => undefined
    };
    const controller = createAlphaEditorController(surface, bridge, () => true);
    await controller.acceptExternalFile({ path: 'C:/schemas/accepted.struct.json', text: '{"accepted":true}', uri: 'file:///C:/schemas/accepted.struct.json', activationToken: 'accepted' });
    expect(activated).toEqual(['C:/schemas/accepted.struct.json:accepted']);
    expect(surface.uri).toBe('file:///C:/schemas/accepted.struct.json');

    const declined = createAlphaEditorController(surface, bridge, () => false);
    declined.markDirty();
    await declined.acceptExternalFile({ path: 'C:/schemas/declined.struct.json', text: '{}', activationToken: 'declined' });
    expect(discarded).toEqual(['declined']);
    declined.dispose();
  });

  it('creates an untitled document through the host bridge', async () => {
    const surface = editor();
    const bridge: FileBridge = {
      openFile: async () => null,
      saveFile: async (path) => ({ path }),
      saveFileAs: async () => null,
      newDocument: async () => ({ uri: 'untitled:json-structure-test.struct.json', title: 'Untitled JSON Structure' }),
      onFileOpened: () => () => undefined,
      onFileCommand: () => () => undefined
    };
    const controller = createAlphaEditorController(surface, bridge, () => true);
    controller.markDirty();
    await controller.newDocument();
    expect(controller.path).toBeUndefined();
    expect(controller.dirty).toBe(false);
    expect(surface.uri).toBe('untitled:json-structure-test.struct.json');
    expect(JSON.parse(surface.text)).toMatchObject({ definitions: {} });
  });
  it('subscribes to bridge-delivered external opens and releases the listener', async () => {
    const surface = editor();
    let listener: ((file: { path: string; text: string }) => void) | undefined;
    let disposed = false;
    const bridge: FileBridge = {
      openFile: async () => null,
      saveFile: async (path) => ({ path }),
      saveFileAs: async () => null,
      onFileOpened(nextListener) { listener = nextListener; return () => { disposed = true; }; },
      onFileCommand: () => () => undefined
    };
    const controller = createAlphaEditorController(surface, bridge, () => true);
    listener?.({ path: 'C:/schemas/external.struct.json', text: '{"external":true}' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.path).toBe('C:/schemas/external.struct.json');
    expect(surface.text).toBe('{"external":true}');
    controller.dispose();
    expect(disposed).toBe(true);
  });
});
