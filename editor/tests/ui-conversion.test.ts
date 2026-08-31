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
  it('renders typed options and committed result details', () => {
    const host = { listConversionCommands: async () => manifest, convert: async () => { throw new Error('not called'); }, openGeneratedOutput: async () => ({ protocolVersion: 1 as const, requestId: 'open', opened: true }) };
    const html = conversionView(host, manifest, 'convert.fixture', {
      protocolVersion: 1,
      requestId: 'result',
      documentVersion: 1,
      succeeded: true,
      outputs: [{ name: 'schema.json', uri: 'file:///output/schema.json' }],
      diagnostics: [{ code: 'conversion.warning.metadata', message: 'Metadata was approximated.', severity: 'warning' }]
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
  });

  it('renders progress and cancellation controls only while a conversion is active', () => {
    const host = {
      listConversionCommands: async () => manifest,
      convert: async () => { throw new Error('not called'); },
      cancelConversion: async () => undefined
    };
    const active = conversionView(host, manifest, 'convert.fixture', undefined, 'Writing outputs', {
      protocolVersion: 1,
      requestId: 'convert-1',
      documentVersion: 2,
      phase: 'write',
      percent: 75,
      message: 'Writing outputs'
    }, 'convert-1');
    const idle = conversionView(host, manifest, 'convert.fixture', undefined, 'Ready');

    expect(active).toContain('<progress max="100" value="75"');
    expect(active).toContain('data-conversion-cancel');
    expect(active).toContain('data-conversion-run disabled');
    expect(idle).not.toContain('data-conversion-cancel');
    expect(idle).not.toContain('<progress');
  });
});