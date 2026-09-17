// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversionRequest, ConversionResult, SelectConversionSourceRequest } from '../src/contracts.js';
import { BUILTIN_CONVERSION_COMMANDS_MANIFEST } from '../src/conversion/manifest.js';
import { createAlphaEditorController, type FileBridge } from '../src/ui/bootstrap.js';
import { mountJsonStructureEditor, type JsonStructureEditorHandle } from '../src/ui/index.js';

let handle: JsonStructureEditorHandle | undefined;

function mount(services: Parameters<typeof mountJsonStructureEditor>[1]['services'], text = '{}', chrome: 'integrated' | 'document' | 'embedded' = 'document'): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  handle = mountJsonStructureEditor(container, { text, title: 'start.struct.json', services, chrome });
  return container;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 35));
}

function input(root: HTMLElement, name: string, value: string): void {
  const control = root.querySelector(`[data-conversion-option="${name}"]`) as HTMLInputElement | null;
  if (!control) throw new Error(`Missing conversion option ${name}`);
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  handle?.dispose();
  handle = undefined;
  document.body.innerHTML = '';
});

describe('empty-document Structurize starting points', () => {
  it('automatically loads import content as untitled and dirty even when auto-open metadata is false', async () => {
    const text = JSON.stringify({ $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'urn:test:loaded', name: 'Loaded', type: 'string' });
    const manifest = { ...BUILTIN_CONVERSION_COMMANDS_MANIFEST, commands: BUILTIN_CONVERSION_COMMANDS_MANIFEST.commands.map(command => ({ ...command, defaultAutoOpen: false })) };
    const saveFile = vi.fn(async (path: string) => ({ path })), saveFileAs = vi.fn(async () => ({ path: 'C:\\chosen\\result.struct.json' }));
    const bridge: FileBridge = { openFile: async () => null, saveFile, saveFileAs, activateDocument: async () => undefined, onFileOpened: () => () => undefined, onFileCommand: () => () => undefined };
    let controller: ReturnType<typeof createAlphaEditorController>;
    const openGeneratedOutput = vi.fn(async () => { await controller.acceptExternalFile({ kind: 'generated-import', name: 'schema.struct.json', uri: 'untitled:converted.struct.json', text, activationToken: 'import-token' }); return { protocolVersion: 1 as const, requestId: 'opened', opened: true }; });
    const root = mount({ listConversionCommands: async () => manifest, selectConversionSource: async () => ({ uri: 'file:///source/input.json', name: 'input.json', text: '{"type":"string"}' }), convert: async request => ({ protocolVersion: 1, requestId: request.requestId, documentVersion: request.documentVersion, succeeded: true, outputs: [{ uri: 'generated-import:approved/schema.struct.json', name: 'schema.struct.json' }], diagnostics: [] }), openGeneratedOutput });
    controller = createAlphaEditorController(handle!, bridge, () => true);
    (root.querySelector('[data-start-conversion-command="import.jsonschema.to-json-structure"]') as HTMLButtonElement).click(); await settle();
    (root.querySelector('[data-start-conversion-dialog] [data-conversion-source]') as HTMLButtonElement).click(); await settle();
    expect(root.querySelector('[data-start-conversion-dialog]')?.textContent).toContain('new unsaved JSON Structure document');
    (root.querySelector('[data-start-conversion-dialog] [data-conversion-run]') as HTMLButtonElement).click(); await settle();
    expect(openGeneratedOutput).toHaveBeenCalledOnce(); expect(handle!.getText()).toBe(text); expect(controller.path).toBeUndefined(); expect(controller.dirty).toBe(true);
    await controller.save(); expect(saveFile).not.toHaveBeenCalled(); expect(saveFileAs).toHaveBeenCalledWith(text); controller.dispose();
  });

  it('exports the latest unsaved editor snapshot without selecting an input file', async () => {
    const requests: ConversionRequest[] = [], selectSource = vi.fn(async () => { throw new Error('Export must not select an input file.'); });
    const original = JSON.stringify({ $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'urn:test:export', name: 'Original', type: 'string' });
    const root = mount({ listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST, selectConversionSource: selectSource, convert: async request => { requests.push(request); return { protocolVersion: 1, requestId: request.requestId, documentVersion: request.documentVersion, succeeded: true, outputs: [], diagnostics: [] }; } }, original);
    const unsaved = original.replace('Original', 'Unsaved'); handle!.setText(unsaved); handle!.setUri('untitled:current.struct.json');
    (root.querySelector('[data-mode="conversion"]') as HTMLButtonElement).click(); await settle();
    (root.querySelector('[data-conversion-command="export.json-structure.to-jsonschema"]') as HTMLButtonElement).click(); await settle();
    expect(root.querySelector('[data-conversion-source]')).toBeNull();
    (root.querySelector('[data-conversion-run]') as HTMLButtonElement).click(); await settle();
    expect(selectSource).not.toHaveBeenCalled(); expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ sourceName: 'current.struct.json', sourceText: unsaved, documentUri: 'untitled:current.struct.json' });
  });

  it('does not reopen a completed import after a later document replacement', async () => {
    const openGeneratedOutput = vi.fn(async () => ({ protocolVersion: 1 as const, requestId: 'declined-open', opened: false, message: 'Replacement declined.' }));
    const root = mount({ listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST, selectConversionSource: async () => ({ uri: 'file:///input.json', name: 'input.json', text: '{"type":"string"}' }), convert: async request => ({ protocolVersion: 1, requestId: request.requestId, documentVersion: request.documentVersion, succeeded: true, outputs: [{ uri: 'generated-import:ready/schema.struct.json', name: 'schema.struct.json' }], diagnostics: [] }), openGeneratedOutput });
    (root.querySelector('[data-start-conversion-command="import.jsonschema.to-json-structure"]') as HTMLButtonElement).click(); await settle();
    (root.querySelector('[data-conversion-source]') as HTMLButtonElement).click(); await settle(); (root.querySelector('[data-conversion-run]') as HTMLButtonElement).click(); await settle();
    expect(openGeneratedOutput).toHaveBeenCalledOnce();
    const text = '{"$schema":"https://json-structure.org/meta/core/v0/#","$id":"urn:other","name":"Other","type":"string"}'; handle!.setText(text);
    (root.querySelector('[data-mode="conversion"]') as HTMLButtonElement).click(); await settle();
    (root.querySelector('[data-conversion-open]') as HTMLButtonElement).click(); await settle();
    expect(openGeneratedOutput).toHaveBeenCalledOnce(); expect(handle!.getText()).toBe(text); expect(root.textContent).toContain('stale import result');
  });

  it('does not auto-open an import result after the document changed while the worker was running', async () => {
    let finish!: (result: ConversionResult) => void; let request!: ConversionRequest;
    const openGeneratedOutput = vi.fn(async () => ({ protocolVersion: 1 as const, requestId: 'open-stale', opened: true }));
    const root = mount({ listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST, selectConversionSource: async () => ({ uri: 'file:///input.json', name: 'input.json', text: '{"type":"string"}' }), convert: async value => { request = value; return new Promise(resolve => { finish = resolve; }); }, openGeneratedOutput });
    (root.querySelector('[data-start-conversion-command="import.jsonschema.to-json-structure"]') as HTMLButtonElement).click(); await settle();
    (root.querySelector('[data-conversion-source]') as HTMLButtonElement).click(); await settle(); (root.querySelector('[data-conversion-run]') as HTMLButtonElement).click(); await settle();
    const changed = '{"$schema":"https://json-structure.org/meta/core/v0/#","$id":"urn:new","name":"Newer","type":"string"}'; handle!.setText(changed);
    finish({ protocolVersion: 1, requestId: request.requestId, documentVersion: request.documentVersion, succeeded: true, outputs: [{ uri: 'generated-import:old/schema.struct.json', name: 'schema.struct.json' }], diagnostics: [] }); await settle();
    expect(openGeneratedOutput).not.toHaveBeenCalled(); expect(handle!.getText()).toBe(changed);
  });

  it('represents every import command and opens its manifest-defined source/options flow', async () => {
    const sourceRequests: SelectConversionSourceRequest[] = [];
    const root = mount({
      listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST,
      selectConversionSource: async (request) => { sourceRequests.push(request); return undefined; },
      convert: async () => { throw new Error('not called'); },
    });

    expect(root.querySelector('#start-conversion-title')?.textContent).toBe('Start from an existing schema or data source');
    const importCommands = BUILTIN_CONVERSION_COMMANDS_MANIFEST.commands.filter((command) => command.direction === 'import');
    expect([...root.querySelectorAll('[data-start-conversion-command]')].map((element) => (element as HTMLElement).dataset.startConversionCommand)).toEqual(importCommands.map((command) => command.id));

    for (const command of importCommands) {
      (root.querySelector(`[data-start-conversion-command="${command.id}"]`) as HTMLButtonElement).click();
      await settle();
      const dialog = root.querySelector('[data-start-conversion-dialog]') as HTMLElement | null;
      expect(dialog?.dataset.startCommand).toBe(command.id);
      expect(dialog?.getAttribute('aria-labelledby')).toBe('start-conversion-dialog-title');
      expect(document.activeElement).toBe(dialog?.querySelector('[data-conversion-source]') ?? dialog?.querySelector('[data-conversion-option]') ?? dialog?.querySelector('[data-start-conversion-close]'));
      expect(dialog?.querySelector(`[data-format="${command.sourceFormat}"]`)).not.toBeNull();
      expect([...dialog!.querySelectorAll('[data-conversion-option]')].map((element) => (element as HTMLElement).dataset.conversionOption).sort()).toEqual([...(command.optionNames ?? [])].sort());
      if (command.availability === 'external-service') {
        expect(dialog?.querySelector('[data-conversion-source]')).toBeNull();
        expect(dialog?.textContent).toContain(command.availabilityMessage);
        for (const option of command.availabilityRequirements ?? []) {
          const control = dialog?.querySelector(`[data-conversion-option="${option}"]`) as HTMLInputElement | null;
          expect(control?.required).toBe(true);
          expect(control?.getAttribute('aria-required')).toBe('true');
        }
        if (command.id === 'import.structurize.sql2s') {
          expect((dialog?.querySelector('[data-conversion-option="password"]') as HTMLInputElement | null)?.type).toBe('password');
        }
      } else {
        (dialog?.querySelector('[data-conversion-source]') as HTMLButtonElement).click();
        await settle();
        expect(sourceRequests.at(-1)).toMatchObject({
          kind: 'select-conversion-source',
          formats: [command.sourceFormat],
          ...(command.sourceExtensions ? { extensions: command.sourceExtensions } : {}),
        });
        const refreshedDialog = root.querySelector('[data-start-conversion-dialog]') as HTMLElement;
        expect(refreshedDialog.querySelector('[data-conversion-status]')?.textContent).toBe('Source selection was cancelled.');
        expect((refreshedDialog.querySelector('[data-conversion-run]') as HTMLButtonElement).disabled).toBe(true);
        expect(document.activeElement).toBe(refreshedDialog.querySelector('[data-conversion-source]'));
      }
      (root.querySelector('[data-start-conversion-close]') as HTMLButtonElement).click();
      await Promise.resolve();
      expect(document.activeElement).toBe(root.querySelector(`[data-start-conversion-command="${command.id}"]`));
    }
  }, 40_000);

  it('opens the complete import list from File while a document is loaded', async () => {
    const root = mount({
      listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST,
      selectConversionSource: async () => undefined,
      convert: async () => { throw new Error('not called'); },
    }, '{"name":"Loaded","type":"object","properties":{}}', 'integrated');

    expect(root.querySelector('#start-conversion-title')).toBeNull();
    (root.querySelector('[data-chrome-command="import"]') as HTMLButtonElement).click();
    await settle();

    const chooser = root.querySelector('[data-start-conversion-chooser]') as (HTMLElement & { readonly open: boolean }) | null;
    const importCommands = BUILTIN_CONVERSION_COMMANDS_MANIFEST.commands.filter((command) => command.direction === 'import');
    expect(chooser?.open).toBe(true);
    expect(chooser?.getAttribute('aria-labelledby')).toBe('start-conversion-chooser-title');
    expect(document.activeElement).toBe(chooser?.querySelector('[data-start-conversion-command]'));
    expect([...chooser!.querySelectorAll('[data-start-conversion-command]')].map((element) => (element as HTMLElement).dataset.startConversionCommand)).toEqual(importCommands.map((command) => command.id));
    const chooserClose = chooser!.querySelector('[data-start-conversion-chooser-close]') as HTMLButtonElement;
    const chooserLast = chooser!.querySelectorAll('[data-start-conversion-command]').item(importCommands.length - 1) as HTMLButtonElement;
    chooserClose.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(chooserLast);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(chooserClose);

    (chooser!.querySelector(`[data-start-conversion-command="${importCommands.at(-1)!.id}"]`) as HTMLButtonElement).click();
    await settle();
    expect(root.querySelector('[data-start-conversion-chooser]')).toBeNull();
    expect((root.querySelector('[data-start-conversion-dialog]') as HTMLElement | null)?.dataset.startCommand).toBe(importCommands.at(-1)!.id);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
    expect(root.querySelector('[data-start-conversion-dialog]')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-chrome-command="import"]'));
  });

  it('opens Convert workspace import tiles in a modal dialog', async () => {
    const root = mount({
      listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST,
      selectConversionSource: async () => undefined,
      convert: async () => { throw new Error('not called'); },
    }, '{"name":"Loaded","type":"object","properties":{}}');

    (root.querySelector('[data-mode="conversion"]') as HTMLButtonElement).click();
    await settle();
    const command = BUILTIN_CONVERSION_COMMANDS_MANIFEST.commands.find((candidate) => candidate.direction === 'import')!;
    const tile = root.querySelector(`[data-conversion-command="${command.id}"]`) as HTMLButtonElement;
    tile.click();
    await settle();

    const dialog = root.querySelector('[data-start-conversion-dialog]') as (HTMLElement & { readonly open: boolean }) | null;
    expect(dialog?.open).toBe(true);
    expect(dialog?.dataset.startCommand).toBe(command.id);
    expect(dialog?.querySelector('[data-conversion-source]')).not.toBeNull();
    expect(root.querySelector('[data-panel-mode="conversion"] .js-conversion-config')).toBeNull();

    (dialog?.querySelector('[data-start-conversion-close]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(root.querySelector('[data-start-conversion-dialog]')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector(`[data-conversion-command="${command.id}"]`));
  });

  it('validates and executes the Kusto external-source workflow, then opens its result', async () => {
    const requests: ConversionRequest[] = [];
    const result: ConversionResult = {
      protocolVersion: 1,
      requestId: 'kusto-result',
      documentVersion: 1,
      succeeded: true,
      outputs: [{ name: 'schema.struct.json', uri: 'file:///generated/schema.struct.json' }],
      diagnostics: [],
    };
    const openGeneratedOutput = vi.fn(async () => ({ protocolVersion: 1 as const, requestId: 'open-kusto', opened: true }));
    const root = mount({
      listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST,
      selectConversionSource: async () => { throw new Error('Kusto must not open a local file picker.'); },
      convert: async (request) => { requests.push(request); return result; },
      openGeneratedOutput,
    });
    (root.querySelector('[data-start-cli-command="k2s"]') as HTMLButtonElement).click();
    await settle();

    (root.querySelector('[data-start-conversion-dialog] [data-conversion-run]') as HTMLButtonElement).click();
    await settle();
    expect(requests).toHaveLength(0);
    expect(root.querySelector('[data-start-conversion-dialog]')?.textContent).toContain('Missing configuration: kusto_uri, kusto_database, table_name');
    expect(root.querySelector('[data-start-conversion-dialog] [data-conversion-status]')?.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(root.querySelector('[data-start-conversion-dialog] [data-conversion-option="kusto_uri"]'));
    expect(root.querySelector('[data-start-conversion-dialog] [data-conversion-option="kusto_uri"]')?.getAttribute('aria-invalid')).toBe('true');

    const dialog = root.querySelector('[data-start-conversion-dialog]') as HTMLElement;
    input(dialog, 'kusto_uri', 'http://cluster.kusto.windows.net');
    input(dialog, 'kusto_database', 'Telemetry');
    (dialog.querySelector('[data-conversion-run]') as HTMLButtonElement).click();
    await settle();
    expect((root.querySelector('[data-start-conversion-dialog] [data-conversion-option="kusto_uri"]') as HTMLInputElement).value).toBe('http://cluster.kusto.windows.net');
    expect((root.querySelector('[data-start-conversion-dialog] [data-conversion-option="kusto_database"]') as HTMLInputElement).value).toBe('Telemetry');
    expect(document.activeElement).toBe(root.querySelector('[data-start-conversion-dialog] [data-conversion-option="table_name"]'));

    input(root.querySelector('[data-start-conversion-dialog]') as HTMLElement, 'table_name', 'Events');
    (root.querySelector('[data-start-conversion-dialog] [data-conversion-run]') as HTMLButtonElement).click();
    await settle();
    expect(root.querySelector('[data-start-conversion-dialog] [data-conversion-status]')?.textContent).toContain('must use HTTPS');
    expect(document.activeElement).toBe(root.querySelector('[data-start-conversion-dialog] [data-conversion-option="kusto_uri"]'));
    expect((root.querySelector('[data-start-conversion-dialog] [data-conversion-option="table_name"]') as HTMLInputElement).value).toBe('Events');

    input(root.querySelector('[data-start-conversion-dialog]') as HTMLElement, 'kusto_uri', 'https://cluster.kusto.windows.net');
    (root.querySelector('[data-start-conversion-dialog] [data-conversion-run]') as HTMLButtonElement).click();
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      commandId: 'import.structurize.k2s',
      sourceName: 'kusto-external-service',
      sourceText: '',
      options: {
        kusto_uri: 'https://cluster.kusto.windows.net',
        kusto_database: 'Telemetry',
        table_name: 'Events',
      },
    });
    expect(openGeneratedOutput).toHaveBeenCalledWith(expect.objectContaining({ outputs: result.outputs }));
    expect(root.querySelector('[data-start-conversion-dialog] [data-conversion-result="success"]')?.getAttribute('aria-label')).toBe('Conversion succeeded');
    expect(root.querySelector('[data-start-conversion-dialog] [data-conversion-status]')?.getAttribute('role')).toBe('status');
  });

  it('selects a local import source, preserves configured options, and submits the mounted source journey', async () => {
    const requests: ConversionRequest[] = [];
    const sourceRequests: SelectConversionSourceRequest[] = [];
    const root = mount({
      listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST,
      selectConversionSource: async (request) => {
        sourceRequests.push(request);
        return { uri: 'file:///schema.fbs', name: 'schema.fbs', text: 'table Root {}' };
      },
      convert: async (request) => {
        requests.push(request);
        return {
          protocolVersion: 1,
          requestId: request.requestId,
          documentVersion: request.documentVersion,
          succeeded: true,
          outputs: [{ name: 'schema.struct.json', uri: 'file:///generated/schema.struct.json' }],
          diagnostics: [],
        };
      },
      openGeneratedOutput: async () => ({ protocolVersion: 1 as const, requestId: 'open', opened: true }),
    });

    (root.querySelector('[data-start-cli-command="fbs2s"]') as HTMLButtonElement).click();
    await settle();
    expect((root.querySelector('[data-start-conversion-dialog] [data-conversion-run]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('[data-start-conversion-dialog] [data-conversion-source]'));

    (root.querySelector('[data-start-conversion-dialog] [data-conversion-source]') as HTMLButtonElement).click();
    await settle();
    expect(sourceRequests[0]).toMatchObject({ formats: ['flatbuffers'], extensions: ['.fbs'] });
    expect(root.querySelector('[data-start-conversion-dialog]')?.textContent).toContain('schema.fbs');
    expect((root.querySelector('[data-start-conversion-dialog] [data-conversion-run]') as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(root.querySelector('[data-start-conversion-dialog] [data-conversion-source]'));

    input(root.querySelector('[data-start-conversion-dialog]') as HTMLElement, 'namespace', 'Example.Contracts');
    (root.querySelector('[data-start-conversion-dialog] [data-conversion-run]') as HTMLButtonElement).click();
    await settle();
    expect(requests[0]).toMatchObject({
      commandId: 'import.structurize.fbs2s',
      sourceName: 'schema.fbs',
      sourceText: 'table Root {}',
      options: { namespace: 'Example.Contracts' },
    });
    expect((root.querySelector('[data-start-conversion-dialog] [data-conversion-option="namespace"]') as HTMLInputElement).value).toBe('Example.Contracts');
    expect(root.querySelector('[data-start-conversion-dialog] [data-conversion-result="success"]')).not.toBeNull();
  });

  it('cancels an import started from the empty-document dialog', async () => {
    let resolveConversion: ((result: ConversionResult) => void) | undefined;
    let conversionRequest: ConversionRequest | undefined;
    let progressListener: ((event: import('../src/contracts.js').ProgressEvent) => void) | undefined;
    const cancelConversion = vi.fn(async () => undefined);
    const root = mount({
      listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST,
      selectConversionSource: async () => ({ uri: 'file:///schema.fbs', name: 'schema.fbs', text: 'table Root {}' }),
      convert: async (request) => {
        conversionRequest = request;
        return new Promise<ConversionResult>((resolve) => { resolveConversion = resolve; });
      },
      onConversionProgress: (listener) => { progressListener = listener; return () => { progressListener = undefined; }; },
      cancelConversion,
    });
    (root.querySelector('[data-start-cli-command="fbs2s"]') as HTMLButtonElement).click();
    await settle();
    (root.querySelector('[data-start-conversion-dialog] [data-conversion-source]') as HTMLButtonElement).click();
    await settle();
    (root.querySelector('[data-start-conversion-dialog] [data-conversion-run]') as HTMLButtonElement).click();
    await settle();
    progressListener?.({
      protocolVersion: 1,
      requestId: conversionRequest!.requestId,
      documentVersion: conversionRequest!.documentVersion,
      phase: 'convert',
      percent: 45,
      message: 'Reading FlatBuffers schema',
    });
    await settle();
    expect(root.querySelector('[data-start-conversion-dialog] progress')?.getAttribute('value')).toBe('45');
    expect(root.querySelector('[data-start-conversion-dialog] progress')?.getAttribute('aria-valuetext')).toBe('Reading FlatBuffers schema');
    expect(root.querySelector('[data-start-conversion-dialog] .js-start-conversion-dialog-body')?.getAttribute('aria-busy')).toBe('true');
    (root.querySelector('[data-start-conversion-dialog] [data-conversion-cancel]') as HTMLButtonElement).click();
    await settle();
    expect(cancelConversion).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-start-conversion-dialog] [data-conversion-status]')?.textContent).toBe('Cancelling...');
    expect((root.querySelector('[data-start-conversion-dialog] [data-conversion-cancel]') as HTMLButtonElement).disabled).toBe(true);
    (root.querySelector('[data-start-conversion-dialog] [data-conversion-cancel]') as HTMLButtonElement).click();
    expect(cancelConversion).toHaveBeenCalledTimes(1);
    resolveConversion?.({
      protocolVersion: 1,
      requestId: conversionRequest!.requestId,
      documentVersion: conversionRequest!.documentVersion,
      succeeded: false,
      outputs: [],
      diagnostics: [{ code: 'cancelled', message: 'Cancelled.', severity: 'warning' }],
    });
    await settle();
    expect(root.querySelector('[data-start-conversion-dialog] [data-conversion-result="failure"]')?.getAttribute('aria-label')).toBe('Conversion failed');
    expect(root.querySelector('[data-start-conversion-dialog] [data-conversion-status]')?.getAttribute('role')).toBe('alert');
  });
});
