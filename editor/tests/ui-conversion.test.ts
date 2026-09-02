import { describe, expect, it } from 'vitest';
import type { ConversionCommandsManifest } from '../src/conversion/types.js';
import { conversionView } from '../src/ui/index.js';

const manifest: ConversionCommandsManifest = {
  schemaVersion: 1,
  converters: [{ id: 'fixture', displayName: 'Fixture', version: '1', sourceFormats: ['a'], targetFormats: ['b'], options: [
    { name: 'strict', type: 'boolean', default: true, description: 'Reject unsupported input.' },
    { name: 'dialect', type: 'string', allowedValues: ['one', 'two'], default: 'two' },
    { name: 'depth', type: 'number', default: 3, minimum: 1, maximum: 5 }
  ] }],
  commands: [{ id: 'convert.fixture', converterId: 'fixture', direction: 'export', label: 'Convert fixture', sourceFormat: 'a', targetFormat: 'b', defaultAutoOpen: false }]
};

describe('conversion workbench view', () => {
  it('requires a selected external source for import commands', () => {
    const importManifest: ConversionCommandsManifest = {
      ...manifest,
      commands: [{ ...manifest.commands[0]!, id: 'import.fixture', direction: 'import', sourceFormat: 'avro', targetFormat: 'json-structure' }],
    };
    const host = { listConversionCommands: async () => importManifest, selectConversionSource: async () => undefined, convert: async () => { throw new Error('not called'); } };
    const empty = conversionView(host, importManifest, 'import.fixture', undefined, undefined, '');
    const selected = conversionView(host, importManifest, 'import.fixture', { uri: 'file:///order.avsc', name: 'order.avsc', text: '{}' }, undefined, 'Selected order.avsc.');
    expect(empty).toContain('data-conversion-source');
    expect(empty).toContain('No file selected');
    expect(empty).toContain('data-conversion-run disabled');
    expect(selected).toContain('order.avsc');
    expect(selected).not.toContain('data-conversion-run disabled');
  });

  it('renders typed options and committed result details', () => {
    const host = { listConversionCommands: async () => manifest, convert: async () => { throw new Error('not called'); }, openGeneratedOutput: async () => ({ protocolVersion: 1 as const, requestId: 'open', opened: true }) };
    const html = conversionView(host, manifest, 'convert.fixture', undefined, {
      protocolVersion: 1,
      requestId: 'result',
      documentVersion: 1,
      succeeded: true,
      outputs: [{ name: 'schema.json', uri: 'file:///output/schema.json' }],
      diagnostics: [{ code: 'conversion.warning.metadata', message: 'Metadata was approximated.', severity: 'warning' }],
      review: {
        commandId: 'convert.fixture',
        converter: { id: 'fixture', displayName: 'Fixture', version: '1' },
        sourceFormat: 'a',
        targetFormat: 'b',
        lifecycle: ['idle', 'preparing', 'running', 'publishing', 'completed'],
        published: true,
        lossiness: 'metadata',
        warnings: [{ code: 'metadata', message: 'Metadata was approximated.', lossiness: 'metadata', targetPath: '/properties/value', details: { keyword: 'x-source' } }],
        manifest: { algorithm: 'sha256', files: [{ path: 'schema.json', bytes: 42, sha256: 'a'.repeat(64) }] },
      },
    }, 'Generated 1 output.');

    expect(html).toContain('data-option-type="boolean" checked');
    expect(html).toContain('class="js-conversion-tile"');
    expect(html).toContain('data-conversion-command="convert.fixture" aria-pressed="true"');
    expect(html).toContain('Create b files from the current structure.');
    expect(html).toContain('Convert to b');
    expect(html).not.toContain('<select class="js-service-select" data-conversion-command>');
    expect(html).not.toContain('Load converters');
    expect(html).toContain('<option value="two" selected>two</option>');
    expect(html).toContain('min="1" max="5"');
    expect(html).toContain('schema.json');
    expect(html).toContain('conversion.warning.metadata');
    expect(html).toContain('data-conversion-open');
    expect(html).toContain('aria-label="Conversion review"');
    expect(html).toContain('data-lossiness="metadata"');
    expect(html).toContain('Fixture <span class="js-code">1</span>');
    expect(html).toContain('a <span aria-hidden="true">→</span> b');
    expect(html).toContain('Committed atomically');
    expect(html).toContain('data-state="publishing"');
    expect(html).toContain('/properties/value');
    expect(html).toContain('Keyword: x-source');
    expect(html).toContain('42 B');
    expect(html).toContain('a'.repeat(64));
  });

  it('renders progress and cancellation controls only while a conversion is active', () => {
    const host = {
      listConversionCommands: async () => manifest,
      convert: async () => { throw new Error('not called'); },
      cancelConversion: async () => undefined
    };
    const active = conversionView(host, manifest, 'convert.fixture', undefined, undefined, 'Writing outputs', {
      protocolVersion: 1,
      requestId: 'convert-1',
      documentVersion: 2,
      phase: 'write',
      percent: 75,
      message: 'Writing outputs'
    }, 'convert-1');
    const idle = conversionView(host, manifest, 'convert.fixture', undefined, undefined, 'Ready');

    expect(active).toContain('<progress max="100" value="75"');
    expect(active).toContain('data-conversion-cancel');
    expect(active).toContain('data-conversion-run disabled');
    expect(idle).not.toContain('data-conversion-cancel');
    expect(idle).not.toContain('<progress');
  });

  it('renders only options selected by the active command', () => {
    const scoped: ConversionCommandsManifest = {
      ...manifest,
      commands: [{ ...manifest.commands[0]!, optionNames: ['dialect'] }],
    };
    const host = { listConversionCommands: async () => scoped, convert: async () => { throw new Error('not called'); } };
    const html = conversionView(host, scoped, 'convert.fixture', undefined, undefined, '');
    expect(html).toContain('data-conversion-option="dialect"');
    expect(html).not.toContain('data-conversion-option="strict"');
    expect(html).not.toContain('data-conversion-option="depth"');
  });
});