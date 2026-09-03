// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversionRequest, ConversionResult, SelectConversionSourceRequest } from '../src/contracts.js';
import { BUILTIN_CONVERSION_COMMANDS_MANIFEST } from '../src/conversion/manifest.js';
import { mountJsonStructureEditor, type JsonStructureEditorHandle } from '../src/ui/index.js';

const directCommands = ['fbs2s', 'j2s', 'k2s', 'json2s', 'xml2s', 'a2s', 'jtd2s', 'cddl2s', 'oas2s', 'cue2s', 'thrift2s', 'smithy2s', 'capnp2s', 'raml2s'] as const;

let handle: JsonStructureEditorHandle | undefined;

function mount(services: Parameters<typeof mountJsonStructureEditor>[1]['services']): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  handle = mountJsonStructureEditor(container, { text: '{}', title: 'start.struct.json', services });
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
  it('represents every direct *2s command and opens its manifest-defined source/options flow', async () => {
    const sourceRequests: SelectConversionSourceRequest[] = [];
    const root = mount({
      listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST,
      selectConversionSource: async (request) => { sourceRequests.push(request); return undefined; },
      convert: async () => { throw new Error('not called'); },
    });

    expect(root.querySelector('#start-conversion-title')?.textContent).toBe('Start from an existing schema or data source');
    expect([...root.querySelectorAll('[data-start-cli-command]')].map((element) => (element as HTMLElement).dataset.startCliCommand)).toEqual(directCommands);

    for (const cliCommand of directCommands) {
      const command = BUILTIN_CONVERSION_COMMANDS_MANIFEST.commands.find((candidate) => candidate.cliCommand === cliCommand)!;
      (root.querySelector(`[data-start-cli-command="${cliCommand}"]`) as HTMLButtonElement).click();
      await settle();
      const dialog = root.querySelector('[data-start-conversion-dialog]') as HTMLElement | null;
      expect(dialog?.dataset.startCommand).toBe(command.id);
      expect(dialog?.querySelector(`[data-format="${command.sourceFormat}"]`)).not.toBeNull();
      expect([...dialog!.querySelectorAll('[data-conversion-option]')].map((element) => (element as HTMLElement).dataset.conversionOption).sort()).toEqual([...(command.optionNames ?? [])].sort());
      if (command.availability === 'external-service') {
        expect(dialog?.querySelector('[data-conversion-source]')).toBeNull();
        expect(dialog?.textContent).toContain(command.availabilityMessage);
        for (const option of ['kusto_uri', 'kusto_database', 'table_name']) expect(dialog?.querySelector(`[data-conversion-option="${option}"]`)).not.toBeNull();
      } else {
        (dialog?.querySelector('[data-conversion-source]') as HTMLButtonElement).click();
        await settle();
        expect(sourceRequests.at(-1)).toMatchObject({
          kind: 'select-conversion-source',
          formats: [command.sourceFormat],
          extensions: command.sourceExtensions,
        });
      }
      (root.querySelector('[data-start-conversion-close]') as HTMLButtonElement).click();
    }
  }, 20_000);

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

    (root.querySelector('[data-conversion-run]') as HTMLButtonElement).click();
    await settle();
    expect(requests).toHaveLength(0);
    expect(root.querySelector('[data-start-conversion-dialog]')?.textContent).toContain('requires a cluster URI, database, and table');

    const dialog = root.querySelector('[data-start-conversion-dialog]') as HTMLElement;
    input(dialog, 'kusto_uri', 'https://cluster.kusto.windows.net');
    input(dialog, 'kusto_database', 'Telemetry');
    input(dialog, 'table_name', 'Events');
    (dialog.querySelector('[data-conversion-run]') as HTMLButtonElement).click();
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
  });

  it('cancels an import started from the empty-document dialog', async () => {
    let resolveConversion: ((result: ConversionResult) => void) | undefined;
    const cancelConversion = vi.fn(async () => undefined);
    const root = mount({
      listConversionCommands: async () => BUILTIN_CONVERSION_COMMANDS_MANIFEST,
      selectConversionSource: async () => ({ uri: 'file:///schema.fbs', name: 'schema.fbs', text: 'table Root {}' }),
      convert: async () => new Promise<ConversionResult>((resolve) => { resolveConversion = resolve; }),
      cancelConversion,
    });
    (root.querySelector('[data-start-cli-command="fbs2s"]') as HTMLButtonElement).click();
    await settle();
    (root.querySelector('[data-conversion-source]') as HTMLButtonElement).click();
    await settle();
    (root.querySelector('[data-conversion-run]') as HTMLButtonElement).click();
    await settle();
    (root.querySelector('[data-conversion-cancel]') as HTMLButtonElement).click();
    expect(cancelConversion).toHaveBeenCalledTimes(1);
    resolveConversion?.({
      protocolVersion: 1,
      requestId: 'cancelled',
      documentVersion: 1,
      succeeded: false,
      outputs: [],
      diagnostics: [{ code: 'cancelled', message: 'Cancelled.', severity: 'warning' }],
    });
  });
});
