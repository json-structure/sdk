import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { GeneratedImportRegistry, MAX_PRIMARY_DOCUMENT_NODES } from '../src/conversion/import-output.js';
import { NodeConversionHost } from '../src/conversion/node-host.js';
import { isConversionResult, type ConversionRequest } from '../src/contracts.js';

const request = (extra: Partial<ConversionRequest> = {}): ConversionRequest => ({ protocolVersion: 1, requestId: 'memory-import', kind: 'conversion', documentVersion: 3, commandId: 'import.jsonschema.to-json-structure', sourceName: 'input.json', sourceText: '{"type":"string"}', options: {}, ...extra });
const runtimeRoot = resolve(process.cwd(), 'src', 'conversion');

describe('in-memory import host workflow', () => {
  it('never selects a destination and retains approved generated content without a filesystem URI', async () => {
    const destination = vi.fn(async () => { throw new Error('Imports must not request a destination.'); });
    const openImport = vi.fn(async () => undefined);
    const host = new NodeConversionHost({ runtimeRoot, destination, openImport });
    const result = await host.convert(request());
    expect(result.succeeded).toBe(true); expect(isConversionResult(result)).toBe(true); expect(destination).not.toHaveBeenCalled();
    expect(result.review).toMatchObject({ outputMode: 'untitled-document', published: false, lifecycle: ['idle', 'preparing', 'running', 'completed'] });
    expect(result.outputs).toHaveLength(1); expect(result.outputs[0].uri).toMatch(/^generated-import:/);
    const imported = host.readImportedOutput(result.outputs[0]); expect(JSON.parse(imported.text).definitions.Root.type).toBe('string');
    expect(result.review!.manifest!.files[0].sha256).toBe(createHash('sha256').update(imported.text).digest('hex'));
    await host.open(result.outputs[0]); expect(openImport).toHaveBeenCalledWith(imported);
    expect(() => host.readImportedOutput(result.outputs[0])).toThrow('not generated');
    expect(() => host.readImportedOutput({ uri: 'C:\\Temp\\unapproved.struct.json', name: 'unapproved.struct.json' })).toThrow('not generated');
    expect(() => host.readImportedOutput({ ...result.outputs[0], name: 'forged.struct.json' })).toThrow('not generated');
  });

  it('cleans the exact internal Structurize workspace after staging output content, including external services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'json-structure-memory-import-')), marker = join(root, 'arguments.jsonl'), keep = join(root, 'keep.txt');
    const keys = ['STRUCTURIZE_EXECUTABLE', 'STRUCTURIZE_ALLOW_RUNTIME_OVERRIDE', 'STRUCTURIZE_TEST_ARGS'] as const;
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      await writeFile(keep, 'keep');
      process.env.STRUCTURIZE_EXECUTABLE = resolve(process.cwd(), 'tests', 'fixtures', 'structurize-memory.cjs');
      process.env.STRUCTURIZE_ALLOW_RUNTIME_OVERRIDE = '1'; process.env.STRUCTURIZE_TEST_ARGS = marker;
      const destination = vi.fn(async () => { throw new Error('Unexpected destination picker.'); });
      const host = new NodeConversionHost({ runtimeRoot, destination });
      const result = await host.convert(request({ commandId: 'import.structurize.k2s', sourceName: 'kusto-external-service', sourceText: '', options: { kusto_uri: 'https://cluster.example.test', kusto_database: 'Data', table_name: 'Events' } }));
      expect(result.succeeded, JSON.stringify(result.diagnostics)).toBe(true); expect(destination).not.toHaveBeenCalled();
      const args = JSON.parse((await readFile(marker, 'utf8')).trim()) as string[];
      const workspace = dirname(args[1]); expect(workspace).not.toBe(root);
      await expect(stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(keep, 'utf8')).toBe('keep');
      const imported = host.readImportedOutput(result.outputs[0]); expect(JSON.parse(imported.text).name).toBe('Observed');
      expect(result.outputs[0].uri).not.toContain(workspace); expect(result.review?.published).toBe(false);
    } finally {
      for (const key of keys) { const value = previous[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps export destination approval and publishes the provided unsaved text, not disk bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'json-structure-memory-export-')), sourcePath = join(root, 'current.struct.json'), destinationPath = join(root, 'output');
    try {
      const disk = { $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'urn:test:current', name: 'Current', type: 'string' };
      const unsaved = { ...disk, type: 'int32' }; await writeFile(sourcePath, JSON.stringify(disk));
      const destination = vi.fn(async () => destinationPath), host = new NodeConversionHost({ runtimeRoot, destination });
      const result = await host.convert(request({ commandId: 'export.json-structure.to-jsonschema', sourceName: 'current.struct.json', sourceText: JSON.stringify(unsaved) }));
      expect(result.succeeded).toBe(true); expect(destination).toHaveBeenCalledOnce();
      expect(result.review).toMatchObject({ outputMode: 'published-files', published: true });
      expect(result.review?.lifecycle).toContain('publishing');
      expect(JSON.parse(await readFile(result.outputs[0].uri, 'utf8')).type).toBe('integer');
      expect(JSON.parse(await readFile(sourcePath, 'utf8')).type).toBe('string');
      expect(result.review?.source?.sha256).toBe(createHash('sha256').update(JSON.stringify(unsaved)).digest('hex'));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('cannot register unsafe, multi-document, or non-JSON-Structure import handles', () => {
    const registry = new GeneratedImportRegistry(), bytes = new TextEncoder().encode('{}');
    expect(() => registry.register('../path', { 'schema.struct.json': bytes })).toThrow('host-issued');
    expect(() => registry.register('safe', { '../schema.struct.json': bytes })).toThrow('Unsafe');
    expect(() => registry.register('safe', { 'a.struct.json': bytes, 'b.struct.json': bytes })).toThrow('exactly one');
    expect(() => registry.register('safe', { 'schema.json': bytes })).toThrow('exactly one');
  });

  it('rejects generated imports that exceed primary-document limits', () => {
    const registry = new GeneratedImportRegistry();
    const oversized = new TextEncoder().encode('[' + Array.from({ length: MAX_PRIMARY_DOCUMENT_NODES + 1 }, () => '0').join(',') + ']');
    expect(() => registry.register('oversized', { 'schema.struct.json': oversized })).toThrow(`${MAX_PRIMARY_DOCUMENT_NODES}-node structural limit`);
  });

  it('retains independent pending imports, enforces its bound, and consumes opened content', () => {
    const registry = new GeneratedImportRegistry(2);
    const first = registry.register('first', { 'first.struct.json': new TextEncoder().encode('{}') })[0]!;
    const second = registry.register('second', { 'second.struct.json': new TextEncoder().encode('{}') })[0]!;
    expect(registry.has(first.uri)).toBe(true);
    expect(registry.has(second.uri)).toBe(true);
    expect(() => registry.register('third', { 'third.struct.json': new TextEncoder().encode('{}') })).toThrow('Too many generated imports');
    registry.consume(first);
    expect(registry.has(first.uri)).toBe(false);
    registry.consume(second);
    expect(registry.has(second.uri)).toBe(false);
  });
});
