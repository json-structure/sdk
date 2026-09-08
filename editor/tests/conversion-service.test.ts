import { describe, expect, it, vi } from 'vitest';
import { ConversionService } from '../src/conversion/service.js';
import { cloneBuiltInCommandsManifest } from '../src/conversion/manifest.js';
import { DeterministicInProcessWorker, type ConversionWorkerRequest, type ConversionWorkerResult } from '../src/conversion/worker.js';
import type { ConversionStorage } from '../src/conversion/storage.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MemoryStorage implements ConversionStorage {
  readonly directories = new Map<string, Map<string, Uint8Array>>();
  failWrite = false;
  async createStagingDirectory(_destination: string, operationId: string): Promise<string> {
    const path = `.stage-${operationId}`;
    this.directories.set(path, new Map());
    return path;
  }
  async writeFile(directory: string, path: string, content: Uint8Array): Promise<void> {
    if (this.failWrite) throw new Error('disk full');
    this.directories.get(directory)?.set(path, content.slice());
  }
  async publishDirectory(stagingDirectory: string, destination: string, _signal: AbortSignal): Promise<void> {
    const source = this.directories.get(stagingDirectory);
    if (!source) throw new Error(`Missing staging directory ${stagingDirectory}.`);
    this.directories.set(destination, source);
    this.directories.delete(stagingDirectory);
  }
  async removeDirectory(directory: string): Promise<void> {
    this.directories.delete(directory);
  }
}

function conversionFixtureWorker(): DeterministicInProcessWorker {
  return new DeterministicInProcessWorker((request, context) => {
    context.reportProgress({ phase: 'read', completed: 1, total: 3, message: 'Read input.' });
    context.reportProgress({ phase: 'convert', completed: 2, total: 3, message: 'Transform.' });
    context.reportProgress({ phase: 'finalize', completed: 3, total: 3, message: 'Finalize output.' });
    return fixtureResult(request);
  });
}

function fixtureResult(request: ConversionWorkerRequest): ConversionWorkerResult {
  if (request.commandId === 'import.jsonschema.to-json-structure') {
    return {
      lossiness: 'metadata',
      warnings: [{
        code: 'jsonschema.keyword.unsupported',
        message: 'keyword not is not represented directly',
        lossiness: 'unsupported-feature',
        targetPath: '/definitions/Root/properties/value',
      }],
      files: {
        'Root.struct.json': encoder.encode('{"$schema":"https://json-structure.org/meta/core/v0/#","$id":"urn:test:root","name":"Root","$root":"#/definitions/Root","definitions":{"Root":{"type":"object","properties":{"id":{"type":"string"}}}}}\n'),
      },
    };
  }
  if (request.commandId === 'export.json-structure.to-jsonschema') {
    return {
      lossiness: 'none',
      warnings: [],
      files: {
        'schema.json': encoder.encode('{"$schema":"https://json-schema.org/draft/2020-12/schema"}\n'),
      },
    };
  }
  if (request.commandId === 'import.avro.to-json-structure') {
    return {
      lossiness: 'unsupported-feature',
      warnings: [{
        code: 'avro.union.coerced',
        message: 'Union coercion applied',
        lossiness: 'unsupported-feature',
        targetPath: '/definitions/Order/properties/id',
      }],
      files: {
        'Order.struct.json': encoder.encode('{"$schema":"https://json-structure.org/meta/core/v0/#","$id":"urn:test:order","name":"Order","$root":"#/definitions/Order","definitions":{"Order":{"type":"object","properties":{"id":{"type":"string"}}}}}\n'),
      },
    };
  }
  if (request.commandId === 'export.json-structure.to-avro') {
    return {
      lossiness: 'precision',
      warnings: [{
        code: 'json-structure.optional.field',
        message: 'Optional field represented as nullable union',
        lossiness: 'metadata',
        targetPath: '/fields/amount',
      }],
      files: {
        'Order.avsc': encoder.encode('{"type":"record","name":"Order"}\n'),
      },
    };
  }
  if (request.commandId === 'export.json-structure.to-protobuf') {
    return {
      lossiness: 'none',
      warnings: [],
      files: {
        'order.proto': encoder.encode('syntax = "proto3";\n\nmessage Order {\n  string id = 1;\n}\n'),
        'proto-numbers.json': encoder.encode('{"version":2,"messages":{"Order":{"fields":{"id":1}}},"enums":{}}\n'),
      },
    };
  }
  throw new Error(`Unsupported fixture command ${request.commandId}.`);
}

describe('Phase 5 conversion service', () => {
  it('lists a concrete built-in commands manifest', () => {
    const service = new ConversionService({ worker: conversionFixtureWorker() });
    const manifest = service.listCommands();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.commands.filter((command) => command.direction === 'export')).toHaveLength(40);
    expect(manifest.commands.find((command) => command.id === 'import.structurize.p2s')?.cliPipeline?.map((step) => step.cliCommand)).toEqual(['p2a', 'a2s']);
    expect(manifest.commands.find((command) => command.id === 'export.structurize.s2mongo')?.cliPipeline?.map((step) => step.cliCommand)).toEqual(['s2a', 'a2mongo']);
    expect(manifest.commands.find((command) => command.cliCommand === 's2sql')?.optionNames).toEqual(['dialect']);
    expect(manifest.commands.find((command) => command.cliCommand === 'oas2s')?.optionNames).toEqual(['namespace', 'preserve_composition', 'detect_discriminators', 'lift_inline_schemas']);
    expect(service.prepare('import.structurize.oas2s', { detect_discriminators: false }).effectiveOptions.detect_discriminators).toBe(false);
  });

  it('runs import preview with progress and lossiness diagnostics without publishing', async () => {
    const progress = vi.fn();
    const storage = new MemoryStorage();
    const service = new ConversionService({ worker: conversionFixtureWorker(), storage });
    const result = await service.execute({
      operationId: 'import-preview',
      commandId: 'import.jsonschema.to-json-structure',
      sourceName: 'schema.json',
      source: encoder.encode('{"type":"object"}'),
      preview: true,
      onProgress: progress,
      optionValues: { rootName: 'Root' },
    });
    expect(result.runtime.state).toBe('completed');
    expect(result.runtime.published).toBe(false);
    expect(storage.directories.size).toBe(0);
    expect(progress).toHaveBeenNthCalledWith(1, { phase: 'read', completed: 1, total: 3, message: 'Read input.' });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('conversion.warning.jsonschema.keyword.unsupported');
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === 'conversion.warning.jsonschema.keyword.unsupported')?.severity).toBe('warning');
  });

  it('publishes export output atomically and records manifest integrity', async () => {
    const storage = new MemoryStorage();
    const service = new ConversionService({ worker: conversionFixtureWorker(), storage });
    const result = await service.execute({
      operationId: 'export-avro',
      commandId: 'export.json-structure.to-avro',
      sourceName: 'order.struct.json',
      source: encoder.encode('{"$root":"#/definitions/Order"}'),
      preview: false,
      destination: 'out/order-avro',
      launch: { autoOpen: false },
      optionValues: { mode: 'compact' },
    });
    expect(result.runtime.state).toBe('completed');
    expect(result.runtime.published).toBe(true);
    const output = storage.directories.get('out/order-avro');
    expect(output).toBeDefined();
    expect(output?.has('Order.avsc')).toBe(true);
    expect(output?.has('conversion-output-manifest.json')).toBe(true);
    const manifest = JSON.parse(decoder.decode(output?.get('conversion-output-manifest.json')));
    expect(manifest.algorithm).toBe('sha256');
    expect(manifest.files[0].path).toBe('Order.avsc');
  });

  it('supports cancellation and exposes an informational diagnostic', async () => {
    const controller = new AbortController();
    const worker = new DeterministicInProcessWorker(async (request, context) => {
      context.reportProgress({ phase: 'read', completed: 1, total: 2 });
      controller.abort();
      return fixtureResult(request);
    });
    const service = new ConversionService({ worker });
    const result = await service.execute({
      operationId: 'cancel',
      commandId: 'import.avro.to-json-structure',
      sourceName: 'order.avsc',
      source: encoder.encode('{"type":"record"}'),
      preview: true,
      signal: controller.signal,
    });
    expect(result.runtime.state).toBe('cancelled');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('conversion.runtime.cancelled');
  });

  it('keeps published output and reports launch failures as warnings', async () => {
    const storage = new MemoryStorage();
    const launch = vi.fn(async () => { throw new Error('app not found'); });
    const service = new ConversionService({ worker: conversionFixtureWorker(), storage, launcher: { launch } });
    const result = await service.execute({
      operationId: 'launch-failure',
      commandId: 'export.json-structure.to-jsonschema',
      sourceName: 'order.struct.json',
      source: encoder.encode('{"$root":"#/definitions/Order"}'),
      preview: false,
      destination: 'out/schema',
    });
    expect(result.runtime.state).toBe('completed');
    expect(result.runtime.published).toBe(true);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('conversion.launch.failed');
  });

  it('validates option values against command converter metadata', async () => {
    const service = new ConversionService({ worker: conversionFixtureWorker() }, cloneBuiltInCommandsManifest());
    await expect(service.execute({
      operationId: 'invalid-option',
      commandId: 'import.jsonschema.to-json-structure',
      sourceName: 'schema.json',
      source: encoder.encode('{"type":"object"}'),
      preview: true,
      optionValues: { preserveUnknownKeywords: 'yes' as unknown as boolean },
    })).rejects.toThrow('must be a boolean');
  });

  it('rejects invalid generated output before publication', async () => {
    const storage = new MemoryStorage();
    const worker = new DeterministicInProcessWorker(() => ({
      files: { 'Root.struct.json': encoder.encode('{"$schema":"https://json-structure.org/meta/core/v0"}') },
      warnings: [],
      lossiness: 'none',
    }));
    const service = new ConversionService({ worker, storage });
    const result = await service.execute({
      operationId: 'invalid-generated-output',
      commandId: 'import.jsonschema.to-json-structure',
      sourceName: 'schema.json',
      source: encoder.encode('{}'),
      preview: false,
      destination: 'output',
    });
    expect(result.runtime.state).toBe('failed');
    expect(result.runtime.published).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'conversion.runtime.failed', severity: 'error' }));
    expect(storage.directories.size).toBe(0);
  });

  it('runs canonical full-schema validation before publication', async () => {
    const storage = new MemoryStorage();
    const worker = new DeterministicInProcessWorker(() => ({
      files: { 'Root.struct.json': encoder.encode('{"$schema":"https://json-structure.org/meta/core/v0/#","$id":"urn:test:root","name":"Root","$root":"#/definitions/Root","definitions":{"Root":{"type":"object","properties":{}}}}') },
      warnings: [],
      lossiness: 'none',
    }));
    const result = await new ConversionService({ worker, storage }).execute({
      operationId: 'canonical-validation',
      commandId: 'import.jsonschema.to-json-structure',
      sourceName: 'schema.json',
      source: encoder.encode('{}'),
      preview: false,
      destination: 'output',
    });
    expect(result.runtime.state).toBe('failed');
    expect(result.runtime.error?.message).toContain('failed canonical validation');
    expect(storage.directories.size).toBe(0);
  });

  it('accepts valid primitive and union Avro roots', async () => {
    for (const [operationId, output] of [['primitive-avro', '"string"'], ['union-avro', '["null","string"]']] as const) {
      const worker = new DeterministicInProcessWorker(() => ({
        files: { 'schema.avsc': encoder.encode(output) }, warnings: [], lossiness: 'none',
      }));
      const result = await new ConversionService({ worker }).execute({
        operationId,
        commandId: 'export.json-structure.to-avro',
        sourceName: 'schema.struct.json',
        source: encoder.encode('{"type":"string"}'),
        preview: true,
      });
      expect(result.runtime.state).toBe('completed');
    }
  });

  it('uses the typed effective-import capability only when imports are declared', async () => {
    const resolveImports = vi.fn(async (request: { source: Uint8Array }) => {
      expect(new TextDecoder().decode(request.source)).toContain('$import');
      return encoder.encode('{"name":"Order","type":"object","properties":{}}');
    });
    const service = new ConversionService({ worker: conversionFixtureWorker(), effectiveImports: { resolve: resolveImports } });
    const result = await service.execute({
      operationId: 'effective-imports',
      commandId: 'export.json-structure.to-avro',
      sourceName: 'order.struct.json',
      source: encoder.encode('{"$import":"https://example.test/base.struct.json","$root":"#/definitions/Order"}'),
      preview: true,
    });
    expect(result.runtime.state).toBe('completed');
    expect(resolveImports).toHaveBeenCalledTimes(1);
  });

  it('discovers only root and namespace-definition imports, not payload literal keys', async () => {
    const resolveImports = vi.fn(async () => encoder.encode('{"name":"Order","type":"object","properties":{}}'));
    const service = new ConversionService({ worker: conversionFixtureWorker(), effectiveImports: { resolve: resolveImports } });
    const payload = await service.execute({
      operationId: 'payload-import-literals',
      commandId: 'export.json-structure.to-avro',
      sourceName: 'payload.struct.json',
      source: encoder.encode(JSON.stringify({ name: 'Order', type: 'object', properties: { payload: { type: 'string', default: { $import: 'literal' }, const: { $importdefs: 'literal' } } } })),
      preview: true,
    });
    expect(payload.runtime.state).toBe('completed');
    expect(resolveImports).not.toHaveBeenCalled();

    const namespace = await service.execute({
      operationId: 'namespace-import',
      commandId: 'export.json-structure.to-avro',
      sourceName: 'namespace.struct.json',
      source: encoder.encode(JSON.stringify({ definitions: { Api: { $import: 'https://example.test/api.struct.json' } }, $root: '#/definitions/Api' })),
      preview: true,
    });
    expect(namespace.runtime.state).toBe('completed');
    expect(resolveImports).toHaveBeenCalledTimes(1);
  });

  it('returns cancellation state when effective-import resolution is aborted and permits retry', async () => {
    let calls = 0;
    const resolveImports = vi.fn(({ signal }: { signal: AbortSignal }) => {
      calls++;
      if (calls === 1) return new Promise<Uint8Array>((_resolve, reject) => signal.addEventListener('abort', () => { const error = new Error('deferred import aborted'); error.name = 'AbortError'; reject(error); }, { once: true }));
      return Promise.resolve(encoder.encode('{"name":"Order","type":"object","properties":{}}'));
    });
    const service = new ConversionService({ worker: conversionFixtureWorker(), effectiveImports: { resolve: resolveImports } });
    const controller = new AbortController();
    const pending = service.execute({
      operationId: 'deferred-import-cancel',
      commandId: 'export.json-structure.to-avro',
      sourceName: 'deferred.struct.json',
      source: encoder.encode('{"$import":"https://example.test/base.struct.json","$root":"#/definitions/Order"}'),
      preview: true,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    const cancelled = await pending;
    expect(cancelled.runtime.state).toBe('cancelled');
    expect(cancelled.runtime.states).toEqual(['idle', 'preparing', 'cancelled']);
    expect(cancelled.diagnostics).toContainEqual(expect.objectContaining({ code: 'conversion.runtime.cancelled', severity: 'info' }));

    const retry = await service.execute({
      operationId: 'deferred-import-retry',
      commandId: 'export.json-structure.to-avro',
      sourceName: 'deferred.struct.json',
      source: encoder.encode('{"$import":"https://example.test/base.struct.json","$root":"#/definitions/Order"}'),
      preview: true,
      signal: new AbortController().signal,
    });
    expect(retry.runtime.state).toBe('completed');
    expect(resolveImports).toHaveBeenCalledTimes(2);
  });

});
