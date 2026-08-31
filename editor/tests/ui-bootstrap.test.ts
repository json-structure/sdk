import { describe, expect, it } from 'vitest';
import { createAlphaEditorController, defaultUntitledDocument, type AlphaEditorSurface, type FileBridge } from '../src/ui/bootstrap.js';

function editor(): AlphaEditorSurface & { text: string } {
  return { text: '{"version":1}', getText() { return this.text; }, setText(text) { this.text = text; } };
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
    expect(controller.path).toBe('C:/schemas/opened.struct.json');
    controller.markDirty();
    await controller.save();
    expect(controller.dirty).toBe(false);
    await controller.saveAs();
    expect(controller.path).toBe('C:/schemas/saved.struct.json');
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