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
  it('presents import commands as modal launch tiles instead of inline configuration', () => {
    const importManifest: ConversionCommandsManifest = {
      ...manifest,
      commands: [{ ...manifest.commands[0]!, id: 'import.fixture', direction: 'import', sourceFormat: 'avro', targetFormat: 'json-structure' }],
    };
    const host = { listConversionCommands: async () => importManifest, selectConversionSource: async () => undefined, convert: async () => { throw new Error('not called'); } };
    const empty = conversionView(host, importManifest, 'import.fixture', undefined, undefined, '');
    expect(empty).toContain('data-conversion-command="import.fixture"');
    expect(empty).not.toContain('class="js-conversion-config"');
    expect(empty).not.toContain('data-conversion-source');
    expect(empty).not.toContain('data-conversion-run');
  });

  it('renders external-service imports as configuration workflows without a local file gate', () => {
    const externalManifest: ConversionCommandsManifest = {
      schemaVersion: 1,
      converters: [{
        id: 'structurize-cli', displayName: 'Structurize', version: '1', sourceFormats: ['kusto'], targetFormats: ['json-structure'],
        options: [
          { name: 'kusto_uri', type: 'string', default: '' },
          { name: 'kusto_database', type: 'string', default: '' },
          { name: 'table_name', type: 'string', default: '' },
        ],
      }],
      commands: [{
        id: 'import.structurize.k2s', converterId: 'structurize-cli', direction: 'import', label: 'Import Kusto',
        sourceFormat: 'kusto', targetFormat: 'json-structure', defaultAutoOpen: true, cliCommand: 'k2s',
        optionNames: ['kusto_uri', 'kusto_database', 'table_name'], availability: 'external-service',
        availabilityMessage: 'Kusto import requires a configured cluster URI, database, and table.',
        availabilityRequirements: ['kusto_uri', 'kusto_database', 'table_name'],
      }],
    };
    const host = { listConversionCommands: async () => externalManifest, selectConversionSource: async () => undefined, convert: async () => { throw new Error('not called'); } };
    const html = conversionView(host, externalManifest, 'import.structurize.k2s', undefined, undefined, '');
    expect(html).toContain('data-conversion-command="import.structurize.k2s"');
    expect(html).not.toContain('class="js-conversion-config"');
    expect(html).not.toContain('aria-label="External data source configuration"');
    expect(html).not.toContain('data-conversion-option="kusto_uri"');
    expect(html).not.toContain('data-conversion-source');
    expect(html).not.toContain('data-conversion-run');
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
    expect(html).toContain('aria-describedby="conversion-workbench-option-strict-description"');
    expect(html).toContain('data-conversion-reset');
    expect(html).toContain('class="js-conversion-tile"');
    expect(html).toContain('class="js-technology-icon"');
    expect(html).not.toContain('>B</span>');
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
    expect(html).toContain('a <span aria-hidden="true"><svg class="js-icon js-chevron"');
    expect(html).toContain('Committed atomically');
    expect(html).toContain('data-state="publishing"');
    expect(html).toContain('/properties/value');
    expect(html).toContain('Keyword: x-source');
    expect(html).toContain('42 B');
    expect(html).toContain('a'.repeat(64));
    expect(html).toContain('data-conversion-state="success"');
    expect(html).toContain('data-conversion-result="success" aria-label="Conversion succeeded"');
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
    expect(active).toContain('aria-valuetext="Writing outputs"');
    expect(active).toContain('aria-busy="true"');
    expect(active).toContain('data-conversion-cancel');
    expect(active).toContain('data-conversion-run disabled');
    expect(idle).not.toContain('data-conversion-cancel');
    expect(idle).not.toContain('<progress');

    const cancelling = conversionView(host, manifest, 'convert.fixture', undefined, undefined, 'Cancelling...', undefined, 'convert-1');
    expect(cancelling).toContain('data-conversion-state="cancelling"');
    expect(cancelling).toContain('data-conversion-cancel disabled');
    expect(cancelling).toContain('Cancelling...');
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