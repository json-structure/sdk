import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createOutputManifest, parsePackagedRuntimeDescriptor, sha256, verifyPackagedRuntime } from '../src/conversion/integrity.js';
import { ConversionLifecycle } from '../src/conversion/lifecycle.js';
import { NodeFilesystemConversionStorage } from '../src/conversion/node-host.js';
import { ConversionRuntime } from '../src/conversion/runtime.js';
import { publishAtomically, type ConversionStorage } from '../src/conversion/storage.js';
import { conversionOptionsForCommand, parseCommandsManifest, validateOptionValues } from '../src/conversion/types.js';
import { DeterministicInProcessWorker, PackagedExecutableWorkerAdapter, type ConversionWorkerResult } from '../src/conversion/worker.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MemoryStorage implements ConversionStorage {
  readonly directories = new Map<string, Map<string, Uint8Array>>();
  failWrite = false;
  published = 0;
  async createStagingDirectory(_destination: string, operationId: string): Promise<string> {
    const path = `.stage-${operationId}`;
    this.directories.set(path, new Map());
    return path;
  }
  async writeFile(directory: string, path: string, content: Uint8Array): Promise<void> {
    if (this.failWrite) throw new Error('disk full');
    this.directories.get(directory)!.set(path, content.slice());
  }
  async publishDirectory(staging: string, destination: string, _signal: AbortSignal): Promise<void> {
    this.directories.set(destination, this.directories.get(staging)!);
    this.directories.delete(staging);
    this.published++;
  }
  async removeDirectory(directory: string): Promise<void> { this.directories.delete(directory); }
}

function successfulWorker(result?: Partial<ConversionWorkerResult>): DeterministicInProcessWorker {
  return new DeterministicInProcessWorker((_request, context) => {
    context.reportProgress({ phase: 'convert', completed: 1, total: 1 });
    return { files: { 'result.json': encoder.encode('{"ok":true}') }, warnings: [], lossiness: 'none', ...result };
  });
}

describe('conversion metadata and packaged runtime', () => {
  it('parses typed converter options and commands with auto-open by default', () => {
    const manifest = parseCommandsManifest({ schemaVersion: 1, converters: [{
      id: 'jsonschema', displayName: 'JSON Schema', version: '1.0.0', sourceFormats: ['schema'], targetFormats: ['structure'],
      options: [{ name: 'strict', type: 'boolean', default: true }, { name: 'dialect', type: 'string', allowedValues: ['2020-12'] }, { name: 'depth', type: 'number', minimum: 1 }],
    }], commands: [{ id: 'import.jsonschema', converterId: 'jsonschema', direction: 'import', label: 'Import', sourceFormat: 'schema', targetFormat: 'structure' }] });
    expect(manifest.commands[0].defaultAutoOpen).toBe(true);
    expect(validateOptionValues(manifest.converters[0], { depth: 2, dialect: '2020-12' })).toEqual({ strict: true, dialect: '2020-12', depth: 2 });
    expect(() => validateOptionValues(manifest.converters[0], { depth: 0 })).toThrow('minimum');
    expect(() => parseCommandsManifest({ schemaVersion: 1, converters: [], commands: [{ converterId: 'missing' }] })).toThrow('unknown converter');
  });

  it('scopes options to a command and preserves ordered string lists', () => {
    const manifest = parseCommandsManifest({ schemaVersion: 1, converters: [{
      id: 'fixture', displayName: 'Fixture', version: '1', sourceFormats: ['a'], targetFormats: ['b'],
      options: [{ name: 'importOnly', type: 'boolean', default: true }, { name: 'uses', type: 'string-list', default: [] }],
    }], commands: [{ id: 'export.fixture', converterId: 'fixture', direction: 'export', label: 'Export', sourceFormat: 'a', targetFormat: 'b', optionNames: ['uses'] }] });
    const command = manifest.commands[0];
    const converter = manifest.converters[0];
    expect(conversionOptionsForCommand(converter, command).map((option) => option.name)).toEqual(['uses']);
    expect(validateOptionValues(converter, { uses: ['Second', 'First'] }, command.optionNames)).toEqual({ uses: ['Second', 'First'] });
    expect(() => validateOptionValues(converter, { importOnly: false }, command.optionNames)).toThrow('Unknown option');
  });

  it('requires integrity hashes and explicitly prohibits system Python', async () => {
    expect(() => parsePackagedRuntimeDescriptor({ schemaVersion: 1, kind: 'packaged-executable', executable: 'python.exe', files: [] })).toThrow('System Python');
    const executable = encoder.encode('standalone');
    const descriptor = parsePackagedRuntimeDescriptor({ schemaVersion: 1, kind: 'packaged-executable', executable: 'bin/converter.exe', files: [{ path: 'bin/converter.exe', sha256: sha256(executable) }] });
    await expect(verifyPackagedRuntime(descriptor, async () => executable)).resolves.toBeUndefined();
    await expect(verifyPackagedRuntime(descriptor, async () => encoder.encode('tampered'))).rejects.toThrow('integrity');
  });
});

describe('conversion lifecycle and worker transports', () => {
  it('enforces lifecycle transitions', () => {
    const lifecycle = new ConversionLifecycle();
    lifecycle.transition('preparing');
    lifecycle.transition('running');
    expect(() => lifecycle.transition('launching')).toThrow('Invalid conversion transition');
  });

  it('forwards progress and cancellation through the in-process worker', async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    const worker = new DeterministicInProcessWorker((_request, context) => {
      context.reportProgress({ phase: 'read', completed: 1, total: 2 });
      controller.abort();
      return { files: {}, warnings: [], lossiness: 'none' };
    });
    const result = await new ConversionRuntime({ worker }).run({ operationId: 'cancel', commandId: 'x', sourceName: 'x', source: encoder.encode('x'), preview: true, signal: controller.signal, onProgress: progress });
    expect(result.state).toBe('cancelled');
    expect(progress).toHaveBeenCalledWith({ phase: 'read', completed: 1, total: 2 });
  });

  it('defines a packaged executable launcher contract without process assumptions', async () => {
    const invocations: string[][] = [];
    const launcher = { invoke: vi.fn(async (invocation: { arguments: readonly string[] }) => {
      invocations.push([...invocation.arguments]);
      return { files: {}, warnings: [], lossiness: 'none' as const };
    }) };
    const worker = new PackagedExecutableWorkerAdapter('runtime/converter.exe', launcher);
    await worker.execute({ operationId: '1', commandId: 'x', sourceName: 'x', source: encoder.encode('x'), options: {}, preview: false }, { signal: new AbortController().signal, reportProgress: vi.fn() });
    expect(invocations).toEqual([['--json-lines']]);
    expect(() => new PackagedExecutableWorkerAdapter('python.exe', launcher)).toThrow('non-Python');
  });

  it('never reports lossiness none when a worker returns a lossy warning', async () => {
    const result = await new ConversionRuntime({ worker: successfulWorker({
      lossiness: 'none',
      warnings: [{ code: 'omitted', message: 'Metadata was omitted.', lossiness: 'metadata' }],
    }) }).run({ operationId: 'lossiness', commandId: 'x', sourceName: 'x', source: encoder.encode('{}'), preview: true });
    expect(result.lossiness).toBe('metadata');
  });
});

describe('conversion publication and preview', () => {
  it('previews imports without publishing or mutating source', async () => {
    const source = encoder.encode('{"source":true}');
    const before = source.slice();
    const storage = new MemoryStorage();
    const result = await new ConversionRuntime({ worker: successfulWorker(), storage }).run({ operationId: 'preview', commandId: 'import', sourceName: 'source.json', source, destination: 'output', preview: true });
    expect(result.state).toBe('completed');
    expect(result.published).toBe(false);
    expect(storage.directories.size).toBe(0);
    expect(source).toEqual(before);
  });

  it('publishes files and a deterministic SHA-256 manifest atomically', async () => {
    const storage = new MemoryStorage();
    const progress = vi.fn();
    const result = await new ConversionRuntime({ worker: successfulWorker(), storage }).run({ operationId: 'publish', commandId: 'export', sourceName: 'source.json', source: encoder.encode('{}'), destination: 'output', launch: { autoOpen: false }, onProgress: progress });
    expect(result.state).toBe('completed');
    expect(result.published).toBe(true);
    expect(storage.published).toBe(1);
    const output = storage.directories.get('output')!;
    expect([...output.keys()]).toEqual(['result.json', 'conversion-output-manifest.json']);
    expect(JSON.parse(decoder.decode(output.get('conversion-output-manifest.json')))).toEqual(createOutputManifest({ 'result.json': encoder.encode('{"ok":true}') }));
    expect(progress).toHaveBeenCalled();
  });

  it('removes staging and exposes no partial output when a write fails', async () => {
    const storage = new MemoryStorage();
    storage.failWrite = true;
    const result = await new ConversionRuntime({ worker: successfulWorker(), storage }).run({ operationId: 'failed', commandId: 'export', sourceName: 'source.json', source: encoder.encode('{}'), destination: 'output' });
    expect(result.state).toBe('failed');
    expect(result.published).toBe(false);
    expect(storage.directories.size).toBe(0);
  });

  it('publishes generated files without replacing unrelated destination contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'json-structure-conversion-'));
    const destination = join(root, 'selected');
    try {
      await mkdir(destination);
      await writeFile(join(destination, 'unrelated.txt'), 'keep');
      await writeFile(join(destination, 'result.json'), 'old');
      await publishAtomically(new NodeFilesystemConversionStorage(), destination, 'preserve', { 'result.json': encoder.encode('new') }, encoder.encode('{}'), new AbortController().signal);
      await expect(readFile(join(destination, 'unrelated.txt'), 'utf8')).resolves.toBe('keep');
      await expect(readFile(join(destination, 'result.json'), 'utf8')).resolves.toBe('new');
      await expect(readFile(join(destination, 'conversion-output-manifest.json'), 'utf8')).resolves.toBe('{}');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rolls back created and replaced files when publication fails', async () => {
    class FailingStorage extends NodeFilesystemConversionStorage {
      private stagedMoves = 0;
      protected override async publishPath(source: string, destination: string, overwrite: boolean): Promise<void> {
        if (++this.stagedMoves === 2) throw new Error('injected publication failure');
        await super.publishPath(source, destination, overwrite);
      }
    }
    const root = await mkdtemp(join(tmpdir(), 'json-structure-conversion-'));
    const destination = join(root, 'selected');
    try {
      await mkdir(destination);
      await writeFile(join(destination, 'a.json'), 'old');
      await writeFile(join(destination, 'unrelated.txt'), 'keep');
      await expect(publishAtomically(new FailingStorage(), destination, 'rollback', { 'a.json': encoder.encode('new'), 'b.json': encoder.encode('new') }, encoder.encode('{}'), new AbortController().signal)).rejects.toThrow('injected publication failure');
      await expect(readFile(join(destination, 'a.json'), 'utf8')).resolves.toBe('old');
      await expect(readFile(join(destination, 'unrelated.txt'), 'utf8')).resolves.toBe('keep');
      await expect(readFile(join(destination, 'b.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal and case-colliding outputs before staging', async () => {
    const storage = new MemoryStorage();
    await expect(publishAtomically(storage, 'output', 'unsafe', { '../escape.json': encoder.encode('x') }, encoder.encode('{}'), new AbortController().signal)).rejects.toThrow('Unsafe output path');
    await expect(publishAtomically(storage, 'output', 'collision', { 'A.json': encoder.encode('x'), 'a.json': encoder.encode('y') }, encoder.encode('{}'), new AbortController().signal)).rejects.toThrow('case-colliding');
    expect(storage.directories.size).toBe(0);
  });

  it('creates and removes staging directories inside the selected destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'json-structure-conversion-cleanup-'));
    const destination = join(root, 'selected');
    const unrelated = join(root, 'unrelated');
    const storage = new NodeFilesystemConversionStorage();
    try {
      await mkdir(unrelated);
      const staging = await storage.createStagingDirectory(destination, 'renderer-controlled');
      expect(staging).not.toContain('renderer-controlled');
      expect(dirname(staging)).toBe(resolve(destination));
      await expect(storage.removeDirectory(unrelated)).rejects.toThrow('registered staging parent');
      await expect(readFile(unrelated)).rejects.toMatchObject({ code: 'EISDIR' });
      await storage.removeDirectory(staging);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rolls back publication when cancellation is observed between files', async () => {
    const controller = new AbortController();
    class CancellingStorage extends NodeFilesystemConversionStorage {
      protected override async publishPath(source: string, destination: string, overwrite: boolean): Promise<void> {
        await super.publishPath(source, destination, overwrite);
        controller.abort();
      }
    }
    const root = await mkdtemp(join(tmpdir(), 'json-structure-conversion-'));
    const destination = join(root, 'selected');
    try {
      await mkdir(destination);
      await writeFile(join(destination, 'a.json'), 'old');
      await expect(publishAtomically(new CancellingStorage(), destination, 'cancel', { 'a.json': encoder.encode('new'), 'b.json': encoder.encode('new') }, encoder.encode('{}'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
      await expect(readFile(join(destination, 'a.json'), 'utf8')).resolves.toBe('old');
      await expect(readFile(join(destination, 'b.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves completed publication and reports launch failure after default auto-open', async () => {
    const storage = new MemoryStorage();
    const launch = vi.fn(async () => { throw new Error('no associated application'); });
    const result = await new ConversionRuntime({ worker: successfulWorker({ warnings: [{ code: 'precision', message: 'Rounded', lossiness: 'precision', targetPath: '/value' }], lossiness: 'precision' }), storage, launcher: { launch } }).run({ operationId: 'launch', commandId: 'export', sourceName: 'source.json', source: encoder.encode('{}'), destination: 'output' });
    expect(launch).toHaveBeenCalledWith('output', undefined);
    expect(result).toMatchObject({ state: 'completed', published: true, lossiness: 'precision' });
    expect(result.states).toEqual(['idle', 'preparing', 'running', 'publishing', 'launching', 'completed']);
    expect(result.launchError?.message).toBe('no associated application');
    expect(result.error).toBeUndefined();
    expect(storage.directories.has('output')).toBe(true);
  });
});