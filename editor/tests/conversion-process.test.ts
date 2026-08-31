import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NodeProcessExecutableLauncher, parseBundledCommandsManifest } from '../src/conversion/process.js';
import { PACKAGED_COMMANDS_MANIFEST_PATH } from '../src/conversion/assets.js';
import { readFile } from 'node:fs/promises';

const encoder = new TextEncoder();

describe('Phase 5 packaged process runtime', () => {
  it('parses bundled commands manifest from packaged assets', async () => {
    const manifest = parseBundledCommandsManifest(await readFile(PACKAGED_COMMANDS_MANIFEST_PATH));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.converters.map((converter) => converter.id)).toEqual(['jsonschema', 'avro']);
    expect(manifest.commands).toHaveLength(4);
  });

  it('invokes packaged worker script and forwards progress and result', async () => {
    const operationId = randomUUID();
    const progress = vi.fn();
    const launcher = new NodeProcessExecutableLauncher(resolve(process.cwd(), 'src/conversion'));
    const result = await launcher.invoke({
      executablePath: 'worker-runtime/converter-worker.cjs',
      arguments: [],
      request: {
        operationId,
        commandId: 'import.jsonschema.to-json-structure',
        sourceName: 'schema.json',
        source: encoder.encode('{"type":"object","properties":{"id":{"type":"integer"}}}'),
        options: { rootName: 'Order' },
        preview: true,
      },
      signal: new AbortController().signal,
      onProgress: progress,
    });
    expect(progress).toHaveBeenCalled();
    expect(result.lossiness).toBe('none');
    expect(Object.keys(result.files)).toEqual(['preview.json']);
  });

  it('surfaces worker conversion errors as runtime failures', async () => {
    const launcher = new NodeProcessExecutableLauncher(resolve(process.cwd(), 'src/conversion'));
    await expect(launcher.invoke({
      executablePath: 'worker-runtime/converter-worker.cjs',
      arguments: [],
      request: {
        operationId: randomUUID(),
        commandId: 'import.jsonschema.to-json-structure',
        sourceName: 'schema.json',
        source: encoder.encode('not json'),
        options: {},
        preview: true,
      },
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })).rejects.toThrow('conversion.failed');
  });
});
