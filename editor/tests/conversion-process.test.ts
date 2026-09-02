import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NodeProcessExecutableLauncher, parseBundledCommandsManifest, parseProcessWorkerEvent } from '../src/conversion/process.js';
import { ConversionWorkerQuotaTracker, validateWorkerOutputQuotas, type ConversionOptionValues } from '../src/conversion/types.js';
import { PACKAGED_COMMANDS_MANIFEST_PATH, PACKAGED_RUNTIME_DESCRIPTOR_PATH } from '../src/conversion/assets.js';
import { parsePackagedRuntimeDescriptor, verifyPackagedRuntime } from '../src/conversion/integrity.js';
import { NodeConversionHost } from '../src/conversion/node-host.js';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function runPackaged(commandId: string, source: unknown, options: ConversionOptionValues = {}) {
  return new NodeProcessExecutableLauncher(resolve(process.cwd(), 'src/conversion')).invoke({
    executablePath: 'worker-runtime/converter-worker.cjs',
    arguments: [],
    request: {
      operationId: randomUUID(),
      commandId,
      sourceName: 'schema.struct.json',
      source: encoder.encode(JSON.stringify(source)),
      options,
      preview: true,
    },
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
}

describe('Phase 5 packaged process runtime', () => {
  it('parses bundled commands manifest from packaged assets', async () => {
    const manifest = parseBundledCommandsManifest(await readFile(PACKAGED_COMMANDS_MANIFEST_PATH));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.converters.map((converter) => converter.id)).toEqual(['jsonschema', 'avro', 'protobuf', 'structurize-cli']);
    expect(manifest.commands).toHaveLength(33);
    expect(manifest.commands.filter((command) => command.direction === 'export')).toHaveLength(31);
  });

  it('keeps the packaged runtime descriptor hashes in parity with its assets', async () => {
    const runtimeRoot = resolve(process.cwd(), 'src/conversion');
    const descriptor = parsePackagedRuntimeDescriptor(JSON.parse(await readFile(PACKAGED_RUNTIME_DESCRIPTOR_PATH, 'utf8')));
    await expect(verifyPackagedRuntime(descriptor, (assetPath) => readFile(resolve(runtimeRoot, assetPath)))).resolves.toBeUndefined();
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
    expect(result.lossiness).toBe('precision');
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'jsonschema.integer.narrowed', lossiness: 'precision' }));
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

  it('rejects worker startup failures without an unhandled stdin error', async () => {
    const launcher = new NodeProcessExecutableLauncher(process.cwd());
    await expect(launcher.invoke({
      executablePath: 'tests/fixtures/missing-conversion-worker.cjs',
      arguments: [],
      request: { operationId: randomUUID(), commandId: 'fixture', sourceName: 'input.json', source: encoder.encode('{}'), options: {}, preview: true },
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })).rejects.toThrow(/exited|ENOENT|module/i);
  });

  it('fails closed for worker line, file, warning, per-file, and aggregate quotas', () => {
    const tiny = {
      maxExecutionMs: 1000,
      maxOldSpaceMb: 16,
      maxStdoutBytes: 16,
      maxStderrBytes: 8,
      maxLineBytes: 8,
      maxFiles: 1,
      maxWarnings: 1,
      maxFileBytes: 2,
      maxAggregateFileBytes: 3,
    };
    const tracker = new ConversionWorkerQuotaTracker(tiny);
    tracker.consume('stdout', 8);
    expect(() => tracker.consume('stdout', 9)).toThrow('stdout');
    expect(() => tracker.consume('stderr', 9)).toThrow('stderr');
    expect(() => tracker.validateLine('123456789')).toThrow('line');
    expect(() => validateWorkerOutputQuotas([{ path: 'a', contentBase64: 'YQ==' }, { path: 'b', contentBase64: 'Yg==' }], [], tiny)).toThrow('file quota');
    expect(() => validateWorkerOutputQuotas([], [{}, {}], tiny)).toThrow('warning quota');
    expect(() => validateWorkerOutputQuotas([{ path: 'a', contentBase64: 'YWJj' }], [], tiny)).toThrow('per-file');
    expect(() => validateWorkerOutputQuotas([{ path: 'a', contentBase64: 'YWI=' }, { path: 'b', contentBase64: 'YWI=' }], [], { ...tiny, maxFiles: 2 })).toThrow('aggregate');
    expect(() => parseProcessWorkerEvent('{"type":"result","operationId":"x","lossiness":"none","files":[{"path":"a","contentBase64":"%%%="}],"warnings":[]}', { ...tiny, maxFileBytes: 20 })).toThrow('base64');
  });

  it('spawns workers with host operation UUIDs, heap limits, deadlines, and stdout quotas', async () => {
    const baseLimits = {
      maxExecutionMs: 5_000,
      maxOldSpaceMb: 32,
      maxStdoutBytes: 64 * 1024,
      maxStderrBytes: 1024,
      maxLineBytes: 64 * 1024,
      maxFiles: 4,
      maxWarnings: 4,
      maxFileBytes: 64 * 1024,
      maxAggregateFileBytes: 64 * 1024,
    };
    const invoke = (launcher: NodeProcessExecutableLauncher, sourceName: string, operationId: string = randomUUID()) => launcher.invoke({
      executablePath: resolve(process.cwd(), 'tests/fixtures/conversion-quota-worker.cjs'),
      arguments: [],
      request: { operationId, commandId: 'fixture', sourceName, source: encoder.encode('{}'), options: {}, preview: true },
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });

    const rendererRequestId = 'renderer-request-id';
    const result = await invoke(new NodeProcessExecutableLauncher(process.cwd(), baseLimits), 'evidence.struct.json', rendererRequestId);
    const evidence = JSON.parse(decoder.decode(result.files['evidence.schema.json']));
    expect(evidence.operationId).toBe(rendererRequestId);
    expect(evidence.execArgv).toContain('--max-old-space-size=32');

    await expect(invoke(new NodeProcessExecutableLauncher(process.cwd(), { ...baseLimits, maxExecutionMs: 25 }), 'hang.struct.json')).rejects.toThrow('execution quota');
    await expect(invoke(new NodeProcessExecutableLauncher(process.cwd(), { ...baseLimits, maxStdoutBytes: 128, maxLineBytes: 128 }), 'stdout.struct.json')).rejects.toThrow(/stdout|line/);
  });

  it('imports JSON Schema recursively with canonical identity and escaped root pointers', async () => {
    const result = await runPackaged('import.jsonschema.to-json-structure', {
      $id: 'https://example.test/customer.schema.json',
      type: 'object',
      properties: {
        profile: {
          type: 'object',
          properties: { tags: { type: 'array', items: { type: 'string', minLength: 1 } } },
          required: ['tags'],
        },
      },
      required: ['profile'],
    }, { rootName: 'Customer/Profile', preserveUnknownKeywords: false });
    const output = JSON.parse(decoder.decode(result.files['preview.json']));
    expect(output).toMatchObject({
      $schema: 'https://json-structure.org/meta/validation/v0/#',
      $id: 'https://example.test/customer.schema.json',
      name: 'Customer_Profile',
      $root: '#/definitions/Customer_Profile',
      definitions: {
        Customer_Profile: {
          type: 'object',
          properties: {
            profile: {
              type: 'object',
              properties: { tags: { type: 'array', items: { type: 'string', minLength: 1 } } },
              required: ['tags'],
            },
          },
          required: ['profile'],
        },
      },
    });

    expect(result.lossiness).toBe('metadata');
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'jsonschema.name.normalized', lossiness: 'metadata' }));
  });

  it('maps JSON Schema string formats and encodings to native JSON Structure types', async () => {
    const result = await runPackaged('import.jsonschema.to-json-structure', {
      type: 'object',
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        id: { type: 'string', format: 'uuid' },
        resource: { type: 'string', format: 'uri' },
        relativeResource: { type: 'string', format: 'uri-reference' },
        pointer: { type: 'string', format: 'json-pointer' },
        payload: { type: 'string', contentEncoding: 'base64url', contentMediaType: 'application/octet-stream' },
        optionalCreatedAt: { type: ['string', 'null'], format: 'date-time' },
        optionalPayload: { type: ['string', 'null'], contentEncoding: 'base64url', contentMediaType: 'application/octet-stream' },
      },
    });
    const output = JSON.parse(decoder.decode(result.files['preview.json']));
    expect(output.definitions.Root.properties).toMatchObject({
      createdAt: { type: 'datetime' },
      id: { type: 'uuid' },
      resource: { type: 'uri' },
      relativeResource: { type: 'uri' },
      pointer: { type: 'jsonpointer' },
      payload: { type: 'binary', contentEncoding: 'base64url', contentMediaType: 'application/octet-stream' },
      optionalCreatedAt: { type: ['datetime', 'null'] },
      optionalPayload: { anyOf: [{ type: 'binary', contentEncoding: 'base64url', contentMediaType: 'application/octet-stream' }, { type: 'null' }] },
    });
  });

  it('implements unknown-keyword preservation without hiding conversion lossiness', async () => {
    const source = { type: 'string', examples: ['known'], xVendorRule: { enabled: true } };
    const omitted = await runPackaged('import.jsonschema.to-json-structure', source, { rootName: 'Root', preserveUnknownKeywords: false });
    const preserved = await runPackaged('import.jsonschema.to-json-structure', source, { rootName: 'Root', preserveUnknownKeywords: true });
    const preservedOutput = JSON.parse(decoder.decode(preserved.files['preview.json']));
    expect(omitted.warnings).toContainEqual(expect.objectContaining({ code: 'jsonschema.keyword.omitted', sourceLocation: '/xVendorRule' }));
    expect(preservedOutput.definitions.Root['x-json-schema-xVendorRule']).toEqual({ enabled: true });
    expect(preserved.warnings).toContainEqual(expect.objectContaining({ code: 'jsonschema.keyword.preserved', lossiness: 'metadata' }));
    expect(preserved.lossiness).not.toBe('none');
  });

  it('keeps unsupported JSON Schema references valid and visible', async () => {
    const omitted = await runPackaged('import.jsonschema.to-json-structure', { $ref: 'https://example.test/external.json' }, { preserveUnknownKeywords: false });
    const preserved = await runPackaged('import.jsonschema.to-json-structure', { $ref: '#named-anchor' }, { preserveUnknownKeywords: true });
    expect(JSON.parse(decoder.decode(omitted.files['preview.json'])).definitions.Root).toEqual({ type: 'any' });
    expect(JSON.parse(decoder.decode(preserved.files['preview.json'])).definitions.Root).toEqual({ type: 'any', 'x-json-schema-$ref': '#named-anchor' });
    expect(omitted.warnings).toContainEqual(expect.objectContaining({ code: 'jsonschema.reference.unsupported', lossiness: 'data-loss', sourceLocation: '/$ref' }));
    expect(preserved.lossiness).toBe('data-loss');
  });

  it('imports unconstrained arrays recursively and reports unsupported titles', async () => {
    const result = await runPackaged('import.jsonschema.to-json-structure', {
      title: 'Envelope schema',
      type: 'object',
      properties: {
        batches: { type: 'array', items: { type: 'array' } },
      },
    }, { rootName: 'Envelope', preserveUnknownKeywords: false });
    const output = JSON.parse(decoder.decode(result.files['preview.json']));
    expect(output.definitions.Envelope.properties.batches).toEqual({
      type: 'array',
      items: { type: 'array', items: { type: 'any' } },
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'jsonschema.keyword.omitted', sourceLocation: '/title' }));
    expect(result.lossiness).not.toBe('none');
  });

  it('normalizes colliding definition names and rewrites escaped local references', async () => {
    const result = await runPackaged('import.jsonschema.to-json-structure', {
      type: 'object',
      properties: {
        first: { $ref: '#/$defs/a~1b' },
        second: { $ref: '#/definitions/Root' },
      },
      $defs: { 'a/b': { type: 'string' } },
      definitions: { Root: { type: 'integer' } },
    }, { rootName: 'Root' });
    const output = JSON.parse(decoder.decode(result.files['preview.json']));
    expect(output).toMatchObject({
      name: 'Root',
      $root: '#/definitions/Root',
      definitions: {
        Root: { type: 'object', properties: {
          first: { type: { $ref: '#/definitions/a_b' } },
          second: { type: { $ref: '#/definitions/Root_2' } },
        } },
        Root_2: { type: 'integer' },
        a_b: { type: 'string' },
      },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'jsonschema.name.normalized', sourceLocation: '/$defs/a~1b' }),
      expect.objectContaining({ code: 'jsonschema.name.collision', sourceLocation: '/definitions/Root' }),
    ]));
  });

  it('imports recursive JSON Schema definitions without losing reference identity', async () => {
    const result = await runPackaged('import.jsonschema.to-json-structure', {
      $ref: '#/$defs/Node',
      $defs: {
        Node: {
          type: 'object',
          properties: {
            children: { type: 'array', items: { $ref: '#/$defs/Node' } },
          },
          required: ['children'],
        },
      },
    }, { rootName: 'Tree' });
    const output = JSON.parse(decoder.decode(result.files['preview.json']));
    expect(output.$root).toBe('#/definitions/Tree');
    expect(output.definitions.Tree).toEqual({ type: { $ref: '#/definitions/Node' } });
    expect(output.definitions.Node.properties.children.items).toEqual({ type: { $ref: '#/definitions/Node' } });
    expect(result.lossiness).toBe('none');
    expect(result.warnings).toEqual([]);
  });

  it('emits typed canonical schemas and maps required property identifiers without silent loss', async () => {
    const unconstrained = await runPackaged('import.jsonschema.to-json-structure', {}, { rootName: 'Anything' });
    expect(JSON.parse(decoder.decode(unconstrained.files['preview.json'])).definitions.Anything).toEqual({ type: 'any' });
    expect(unconstrained.lossiness).toBe('none');

    const renamed = await runPackaged('import.jsonschema.to-json-structure', {
      type: 'object',
      properties: { 'first-name': { type: 'string' }, first_name: { type: 'string' } },
      required: ['first-name', 'missing-value'],
    }, { rootName: 'Person' });
    const root = JSON.parse(decoder.decode(renamed.files['preview.json'])).definitions.Person;
    expect(root).toMatchObject({
      properties: {
        first_name: { type: 'string' },
        first_name_2: { type: 'string' },
        missing_value: { type: 'any' },
      },
      required: ['first_name', 'missing_value'],
    });
    expect(renamed.lossiness).toBe('data-loss');
    expect(renamed.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'jsonschema.property.normalized', lossiness: 'data-loss' }),
      expect.objectContaining({ code: 'jsonschema.property.collision', lossiness: 'data-loss' }),
      expect.objectContaining({ code: 'jsonschema.required.synthesized' }),
    ]));

    const emptyObject = await runPackaged('import.jsonschema.to-json-structure', { type: 'object' }, { rootName: 'Empty' });
    expect(JSON.parse(decoder.decode(emptyObject.files['preview.json'])).definitions.Empty).toEqual({ type: 'map', values: { type: 'any' } });
    await expect(runPackaged('import.jsonschema.to-json-structure', { type: 'object', properties: {}, additionalProperties: false }, { rootName: 'Empty' })).rejects.toThrow('no conforming JSON Structure Core representation');
  });

  it('selects canonical generated headers for validation and composition keywords', async () => {
    const core = await runPackaged('import.jsonschema.to-json-structure', { type: 'string', maxLength: 8 });
    const coreOutput = JSON.parse(decoder.decode(core.files['preview.json']));
    expect(coreOutput.$schema).toBe('https://json-structure.org/meta/core/v0/#');
    expect(coreOutput).not.toHaveProperty('$uses');

    const validation = await runPackaged('import.jsonschema.to-json-structure', { type: 'string', minLength: 1 });
    const validationOutput = JSON.parse(decoder.decode(validation.files['preview.json']));
    expect(validationOutput.$schema).toBe('https://json-structure.org/meta/validation/v0/#');
    expect(validationOutput).not.toHaveProperty('$uses');

    const composition = await runPackaged('import.jsonschema.to-json-structure', { oneOf: [{ type: 'string' }, { type: 'boolean' }] });
    const compositionOutput = JSON.parse(decoder.decode(composition.files['preview.json']));
    expect(compositionOutput.$schema).toBe('https://json-structure.org/meta/extended/v0/#');
    expect(compositionOutput.$uses).toEqual(['JSONStructureConditionalComposition']);
  });

  it('recurses through structured union members in their original order', async () => {
    const source = {
      name: 'StructuredUnion',
      type: [
        { type: 'array', items: { type: 'string' } },
        { type: 'map', values: { type: 'int32' } },
        { type: 'set', items: { type: 'boolean' } },
      ],
    };
    const jsonSchema = JSON.parse(decoder.decode((await runPackaged('export.json-structure.to-jsonschema', source)).files['preview.schema.json']));
    expect(jsonSchema.anyOf).toEqual([
      { type: 'array', items: { type: 'string' } },
      { type: 'object', additionalProperties: { type: 'integer', minimum: -2147483648, maximum: 2147483647 } },
      { type: 'array', uniqueItems: true, items: { type: 'boolean' } },
    ]);
    const avro = JSON.parse(decoder.decode((await runPackaged('export.json-structure.to-avro', source)).files['preview.avsc']));
    expect(avro).toEqual([
      { type: 'array', items: 'string' },
      { type: 'map', values: 'int' },
    ]);
    expect((await runPackaged('export.json-structure.to-avro', source)).warnings).toContainEqual(expect.objectContaining({ code: 'json-structure.set.uniqueness' }));
  });

  it('rejects empty Avro records instead of publishing an invalid empty object declaration', async () => {
    await expect(runPackaged('import.avro.to-json-structure', { type: 'record', name: 'Empty', fields: [] })).rejects.toThrow('no conforming JSON Structure Core representation');
  });

  it('generates checked-in deterministic Protocol Buffers source and number locks', async () => {
    const source = {
      name: 'Cell',
      type: 'object',
      properties: { value: { type: ['string', 'int32', 'boolean'] } },
      required: ['value'],
    };
    const result = await runPackaged('export.json-structure.to-protobuf', source);
    expect(decoder.decode(result.files['cell.proto'])).toBe([
      'syntax = "proto3";', '',
      'message Cell_value {',
      '  oneof value {',
      '    string string_value = 1;',
      '    int32 int32_value = 2;',
      '    bool bool_value = 3;',
      '  }',
      '}', '',
      'message Cell {',
      '  Cell_value value = 1;',
      '}', '',
    ].join('\n'));
    expect(JSON.parse(decoder.decode(result.files['proto-numbers.json']))).toEqual({
      version: 2,
      messages: {
        Cell_value: { fields: { string_value: 1, int32_value: 2, bool_value: 3 } },
        Cell: { fields: { value: 1 } },
      },
      enums: {},
    });
    expect(result.lossiness).toBe('none');
  });

  it('honors Protobuf number locks, comments, and strict open-record options', async () => {
    const source = {
      name: 'Account', type: 'object', description: 'Account contract.',
      properties: {
        inserted: { type: 'string' },
        id: { type: 'string', protoNumber: 1 },
        label: { type: 'string', default: 'new' },
      }, required: ['id'],
    };
    const numbers = { version: 2, messages: { Account: { fields: { id: 1, label: 4, retired: 6 }, reserved: [9] } }, enums: {} };
    const result = await runPackaged('export.json-structure.to-protobuf', source, { numbers: JSON.stringify(numbers), emit_comments: false });
    const proto = decoder.decode(result.files['account.proto']);
    expect(proto).toContain('optional string inserted = 2;');
    expect(proto).toContain('string id = 1;');
    expect(proto).toContain('optional string label = 4;');
    expect(proto).toContain('reserved 6, 9;');
    expect(proto).not.toContain('//');
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'protobuf.default.omitted' }));
    await expect(runPackaged('export.json-structure.to-protobuf', { name: 'Open', type: 'object', properties: { id: { type: 'string' } }, additionalProperties: true }, { additional_properties: 'error' })).rejects.toThrow('protobuf messages are closed');
  });

  it('imports nested Avro records, unions, arrays, maps, enums, fixed, and logical types', async () => {
    const result = await runPackaged('import.avro.to-json-structure', {
      type: 'record',
      name: 'Envelope',
      namespace: 'com.example',
      fields: [
        { name: 'id', type: { type: 'string', logicalType: 'uuid' } },
        { name: 'child', type: ['null', { type: 'record', name: 'Child', fields: [{ name: 'count', type: 'long' }] }], default: null },
        { name: 'tags', type: { type: 'array', items: 'string' } },
        { name: 'labels', type: { type: 'map', values: 'string' } },
        { name: 'state', type: { type: 'enum', name: 'State', symbols: ['OPEN', 'CLOSED'] } },
        { name: 'digest', type: { type: 'fixed', name: 'Digest', size: 16 } },
      ],
    }, { rootName: 'Ignored', preserveLogicalType: true });
    const output = JSON.parse(decoder.decode(result.files['preview.json']));
    const root = output.definitions.com.example.Envelope;
    expect(output.$root).toBe('#/definitions/com/example/Envelope');
    expect(root.properties).toMatchObject({
      id: { type: 'uuid' },
      tags: { type: 'array', items: { type: 'string' } },
      labels: { type: 'map', values: { type: 'string' } },
      state: { type: { $ref: '#/definitions/com/example/State' } },
      digest: { type: { $ref: '#/definitions/com/example/Digest' } },
    });
    expect(root.properties.child.type).toEqual(['null', { $ref: '#/definitions/com/example/Child' }]);
    expect(output.definitions.com.example.Child.properties.count).toEqual({ type: 'int64' });
    expect(output.definitions.com.example.State).toMatchObject({ type: 'string', enum: ['OPEN', 'CLOSED'] });
    expect(output.definitions.com.example.Digest).toMatchObject({ type: 'binary' });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'avro.logicalType.preserved', lossiness: 'metadata' }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'avro.fixed.constraint', lossiness: 'unsupported-feature' }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'avro.long.lexical', lossiness: 'precision' }));
  });

  it('makes preserveLogicalType effective when importing Avro', async () => {
    const source = { type: 'record', name: 'Event', fields: [{ name: 'at', type: { type: 'long', logicalType: 'timestamp-micros' } }] };
    const preserved = await runPackaged('import.avro.to-json-structure', source, { preserveLogicalType: true });
    const omitted = await runPackaged('import.avro.to-json-structure', source, { preserveLogicalType: false });
    const preservedOutput = JSON.parse(decoder.decode(preserved.files['preview.json']));
    const omittedOutput = JSON.parse(decoder.decode(omitted.files['preview.json']));
    expect(preservedOutput.definitions.Event.properties.at).toMatchObject({ type: 'datetime', 'x-avro-logicalType': 'timestamp-micros' });
    expect(omittedOutput.definitions.Event.properties.at).toEqual({ type: 'datetime' });
    expect(omitted.warnings).toContainEqual(expect.objectContaining({ code: 'avro.logicalType.omitted' }));
  });

  it('imports recursive Avro records and warns for every omitted attribute', async () => {
    const result = await runPackaged('import.avro.to-json-structure', {
      type: 'record',
      name: 'Node',
      aliases: ['LegacyNode'],
      fields: [
        { name: 'children', type: { type: 'array', items: 'Node' } },
        { name: 'label', type: { type: 'string', precision: 4 }, order: 'ignore' },
      ],
    });
    const output = JSON.parse(decoder.decode(result.files['preview.json']));
    expect(output.definitions.Node.properties.children).toEqual({
      type: 'array', items: { type: { $ref: '#/definitions/Node' } },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'avro.keyword.omitted', sourceLocation: '/aliases' }),
      expect.objectContaining({ code: 'avro.keyword.omitted', sourceLocation: '/fields/1/type/precision' }),
      expect.objectContaining({ code: 'avro.keyword.omitted', sourceLocation: '/fields/1/order' }),
    ]));
    expect(result.lossiness).not.toBe('none');
  });

  it('preserves nested JSON Schema shape and reports every omitted annotation', async () => {
    const result = await runPackaged('export.json-structure.to-jsonschema', {
      $root: '#/definitions/Root',
      definitions: {
        Root: {
          type: 'object',
          properties: {
            child: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], semanticRole: 'observationValue' },
          },
          required: ['child'],
        },
      },
    });
    const output = JSON.parse(decoder.decode(result.files['preview.schema.json']));
    expect(output.properties.child).toMatchObject({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] });
    expect(result.lossiness).toBe('metadata');
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'json-structure.keyword.omitted', lossiness: 'metadata', sourceLocation: '/definitions/Root/properties/child/semanticRole' }));
  });

  it('preserves nested Avro records and does not claim unsupported fields are lossless', async () => {
    const result = await runPackaged('export.json-structure.to-avro', {
      $root: '#/definitions/Root',
      definitions: {
        Root: {
          type: 'object',
          properties: { child: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], minimum: 1 } },
          required: ['child'],
        },
      },
    });
    const output = JSON.parse(decoder.decode(result.files['preview.avsc']));
    expect(output.fields[0]).toMatchObject({ name: 'child', type: { type: 'record', fields: [{ name: 'id', type: 'string' }] } });
    expect(result.lossiness).not.toBe('none');
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'json-structure.keyword.omitted', sourceLocation: '/definitions/Root/properties/child/minimum' }));
  });

  it('does not report canonical document identity as Avro conversion lossiness', async () => {
    const result = await runPackaged('export.json-structure.to-avro', {
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'https://example.test/order',
      name: 'Order',
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });
    expect(result.lossiness).toBe('none');
    expect(result.warnings).toEqual([]);
  });

  it('keeps a fully supported simple JSON Schema export lossless', async () => {
    const result = await runPackaged('export.json-structure.to-jsonschema', {
      $root: '#/definitions/Root',
      definitions: { Root: { type: 'object', properties: { id: { type: 'string', description: 'Identifier' } }, required: ['id'] } },
    });
    expect(result.lossiness).toBe('none');
    expect(result.warnings).toEqual([]);
  });

  it('maps inline JSON Structure identity without false JSON Schema lossiness', async () => {
    const result = await runPackaged('export.json-structure.to-jsonschema', {
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'https://example.test/person',
      name: 'Person',
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });
    const output = JSON.parse(decoder.decode(result.files['preview.schema.json']));
    expect(output).toMatchObject({ $id: 'https://example.test/person', title: 'Person', type: 'object' });
    expect(result.lossiness).toBe('none');
    expect(result.warnings).toEqual([]);
  });

  it('does not emit numeric JSON Schema constraints for string-backed wide numbers', async () => {
    const result = await runPackaged('export.json-structure.to-jsonschema', {
      $root: '#/definitions/Root',
      definitions: { Root: { type: 'object', properties: { amount: { type: 'decimal', minimum: '0.01', maximum: '999.99', precision: 5, scale: 2 } }, required: ['amount'] } },
    });
    const output = JSON.parse(decoder.decode(result.files['preview.schema.json']));
    expect(output.properties.amount).toMatchObject({ type: 'string' });
    expect(output.properties.amount).not.toHaveProperty('minimum');
    expect(output.properties.amount).not.toHaveProperty('maximum');
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'json-structure.numeric.constraint.omitted', lossiness: 'precision', sourceLocation: '/definitions/Root/properties/amount/minimum' }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'json-structure.numeric.constraint.omitted', lossiness: 'precision', sourceLocation: '/definitions/Root/properties/amount/precision' }));
  });

  it('emits referenced Avro definitions depth-first with normative wide-number and optional-field mappings', async () => {
    const result = await runPackaged('export.json-structure.to-avro', {
      $root: '#/definitions/Order',
      definitions: {
        Money: { type: 'object', properties: { units: { type: 'uint64' }, exact: { type: 'decimal', precision: 10, scale: 2 } }, required: ['units', 'exact'] },
        Order: {
          type: 'object',
          properties: {
            money: { type: { $ref: '#/definitions/Money' } },
            fallback: { type: 'int128' },
          },
          required: ['money'],
        },
      },
    });
    const output = JSON.parse(decoder.decode(result.files['preview.avsc']));
    expect(output).toMatchObject({
      type: 'record',
      name: 'Order',
      fields: [
        { name: 'money', type: { type: 'record', name: 'Money', fields: [
          { name: 'units', type: 'string' },
          { name: 'exact', type: { type: 'bytes', logicalType: 'decimal', precision: 10, scale: 2 } },
        ] } },
        { name: 'fallback', type: ['null', 'string'], default: null },
      ],
    });
    expect(result.warnings).not.toContainEqual(expect.objectContaining({ code: 'json-structure.definitions.omitted' }));
    expect(result.lossiness).toBe('none');
  });

  it('resolves repeated reference aliases to one loadable Avro named definition', async () => {
    const result = await runPackaged('export.json-structure.to-avro', {
      $root: '#/definitions/Holder',
      definitions: {
        Alias: { type: { $ref: '#/definitions/Target' } },
        Target: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        Holder: {
          type: 'object',
          properties: {
            first: { type: { $ref: '#/definitions/Alias' } },
            second: { type: { $ref: '#/definitions/Alias' } },
          },
          required: ['first', 'second'],
        },
      },
    });
    const output = JSON.parse(decoder.decode(result.files['preview.avsc']));
    expect(output.fields).toEqual([
      { name: 'first', type: { type: 'record', name: 'Target', fields: [{ name: 'id', type: 'string' }] } },
      { name: 'second', type: 'Target' },
    ]);
    expect(result.lossiness).toBe('none');
  });

  it('re-emits repeated unnamed definitions without creating undefined Avro names', async () => {
    const result = await runPackaged('export.json-structure.to-avro', {
      $root: '#/definitions/Holder',
      definitions: {
        Text: { type: 'string' },
        Numbers: { type: 'array', items: { type: 'int32' } },
        State: { type: 'string', enum: ['OPEN', 'CLOSED'] },
        Holder: {
          type: 'object',
          properties: {
            text1: { type: { $ref: '#/definitions/Text' } },
            text2: { type: { $ref: '#/definitions/Text' } },
            numbers1: { type: { $ref: '#/definitions/Numbers' } },
            numbers2: { type: { $ref: '#/definitions/Numbers' } },
            state1: { type: { $ref: '#/definitions/State' } },
            state2: { type: { $ref: '#/definitions/State' } },
          },
          required: ['text1', 'text2', 'numbers1', 'numbers2', 'state1', 'state2'],
        },
      },
    });
    const output = JSON.parse(decoder.decode(result.files['preview.avsc']));
    expect(output.fields).toEqual([
      { name: 'text1', type: 'string' },
      { name: 'text2', type: 'string' },
      { name: 'numbers1', type: { type: 'array', items: 'int' } },
      { name: 'numbers2', type: { type: 'array', items: 'int' } },
      { name: 'state1', type: { type: 'enum', name: 'State', symbols: ['OPEN', 'CLOSED'] } },
      { name: 'state2', type: 'State' },
    ]);
    expect(result.lossiness).toBe('none');
  });

  it('places required Avro union defaults on the first matching branch', async () => {
    const result = await runPackaged('export.json-structure.to-avro', {
      name: 'Cell',
      type: 'object',
      properties: { value: { type: ['string', 'int32', 'boolean'], default: 7 } },
      required: ['value'],
    });
    const output = JSON.parse(decoder.decode(result.files['preview.avsc']));
    expect(output.fields[0]).toEqual({ name: 'value', type: ['int', 'string', 'boolean'], default: 7 });
    await expect(runPackaged('export.json-structure.to-avro', {
      name: 'InvalidDefault',
      type: 'object',
      properties: { value: { type: ['int32', 'boolean'], default: 'seven' } },
      required: ['value'],
    })).rejects.toThrow('default does not match');
  });

  it('falls back to lexical strings for invalid Avro decimals with precision warnings', async () => {
    const result = await runPackaged('export.json-structure.to-avro', {
      name: 'Amounts',
      type: 'object',
      properties: {
        missingPrecision: { type: 'decimal' },
        invalidScale: { type: 'decimal', precision: 2, scale: 5 },
      },
      required: ['missingPrecision', 'invalidScale'],
    });
    const output = JSON.parse(decoder.decode(result.files['preview.avsc']));
    expect(output.fields).toEqual([
      { name: 'missingPrecision', type: 'string' },
      { name: 'invalidScale', type: 'string' },
    ]);
    expect(result.lossiness).toBe('precision');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'json-structure.decimal.lexical', lossiness: 'precision', sourceLocation: '/properties/missingPrecision' }),
      expect.objectContaining({ code: 'json-structure.decimal.lexical', lossiness: 'precision', sourceLocation: '/properties/invalidScale' }),
    ]);
  });

  it('fails rather than emitting unloadable Avro for external references', async () => {
    await expect(runPackaged('export.json-structure.to-avro', {
      name: 'Root',
      type: 'object',
      properties: { external: { type: { $ref: 'https://example.test/types.struct.json#/definitions/External' } } },
      required: ['external'],
    })).rejects.toThrow('consolidated local references');
  });

  it('rejects abstract Avro value types and strict open records', async () => {
    await expect(runPackaged('export.json-structure.to-avro', {
      $root: '#/definitions/Base',
      definitions: { Base: { name: 'Base', abstract: true, type: 'object', properties: {} } },
    })).rejects.toThrow('abstract types cannot be used');
    await expect(runPackaged('export.json-structure.to-avro', {
      name: 'Open', type: 'object', properties: {}, additionalProperties: true,
    }, { additional_properties: 'error' })).rejects.toThrow('Avro records are closed');
    await expect(runPackaged('export.json-structure.to-avro', {
      $root: '#/definitions/Derived',
      definitions: {
        Concrete: { type: 'object', properties: {} },
        Derived: { type: 'object', $extends: '#/definitions/Concrete', properties: {} },
      },
    })).rejects.toThrow('must be abstract');
  });

  it('warns about data loss when open records are exported in ignore mode', async () => {
    const result = await runPackaged('export.json-structure.to-avro', {
      name: 'Open', type: 'object', properties: {}, additionalProperties: { type: 'string' },
    });
    expect(result.lossiness).toBe('data-loss');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'json-structure.additionalProperties.dropped', lossiness: 'data-loss', sourceLocation: '/additionalProperties' }),
    ]);
  });

  it('implements normative Avro mode and emit_doc options independently', async () => {
    const source = {
      name: 'Reading',
      description: 'A reading.',
      type: 'object',
      properties: {
        at: { type: 'datetime', description: 'Observed at.', format: 'date-time' },
        code: { type: 'string', maxLength: 8 },
      },
      required: ['at', 'code'],
    };
    const compact = JSON.parse(decoder.decode((await runPackaged('export.json-structure.to-avro', source, { mode: 'compact', emit_doc: true })).files['preview.avsc']));
    expect(compact.doc).toBe('A reading.');
    expect(compact.fields[0]).toMatchObject({ name: 'at', type: 'string', doc: 'Observed at.' });
    expect(compact.fields[0]).not.toHaveProperty('annotations');

    const full = JSON.parse(decoder.decode((await runPackaged('export.json-structure.to-avro', source, { mode: 'full', emit_doc: false })).files['preview.avsc']));
    expect(full).not.toHaveProperty('doc');
    expect(full.fields[0]).toEqual({ name: 'at', type: { type: 'string', logicalType: 'rfc3339-timestamp-micros' } });
    expect(full.fields[1]).toEqual({ name: 'code', type: 'string', annotations: { maxLength: 8 } });
  });

  it('applies selected Avro add-ins in $offers order at the target position', async () => {
    const result = await runPackaged('export.json-structure.to-avro', {
      $root: '#/definitions/Document',
      $offers: { Auditable: '#/definitions/Auditable', Taggable: '#/definitions/Taggable' },
      definitions: {
        Document: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        Auditable: { abstract: true, type: 'object', $extends: '#/definitions/Document', properties: { createdBy: { type: 'string' } }, required: ['createdBy'] },
        Taggable: { abstract: true, type: 'object', $extends: '#/definitions/Document', properties: { tags: { type: 'array', items: { type: 'string' } } }, required: ['tags'] },
      },
    }, { uses: ['Taggable', 'Auditable'] });
    const output = JSON.parse(decoder.decode(result.files['preview.avsc']));
    expect(output.fields.map((field: { name: string }) => field.name)).toEqual(['title', 'createdBy', 'tags']);
    await expect(runPackaged('export.json-structure.to-avro', {
      $root: '#/definitions/Document', definitions: { Document: { type: 'object', properties: { title: { type: 'string' } } } },
    }, { uses: ['Missing'] })).rejects.toThrow('not offered');
  });

  it('flattens inherited object and tuple fields and preserves inline-choice selectors', async () => {
    const inherited = await runPackaged('export.json-structure.to-avro', {
      $root: '#/definitions/DerivedTuple',
      definitions: {
        BaseTuple: { abstract: true, type: 'tuple', properties: { x: { type: 'double' } }, tuple: ['x'] },
        DerivedTuple: { type: 'tuple', $extends: '#/definitions/BaseTuple', properties: { y: { type: 'double' } }, tuple: ['y'] },
      },
    });
    expect(JSON.parse(decoder.decode(inherited.files['preview.avsc'])).fields).toEqual([
      { name: 'x', type: 'double' },
      { name: 'y', type: 'double' },
    ]);

    const choice = await runPackaged('export.json-structure.to-avro', {
      $root: '#/definitions/Shape',
      definitions: {
        ShapeBase: { abstract: true, type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        Circle: { type: 'object', $extends: '#/definitions/ShapeBase', properties: { radius: { type: 'double' } }, required: ['radius'] },
        Square: { type: 'object', $extends: '#/definitions/ShapeBase', properties: { side: { type: 'double' } }, required: ['side'] },
        Shape: { type: 'choice', $extends: '#/definitions/ShapeBase', selector: 'kind', choices: {
          circle: { type: { $ref: '#/definitions/Circle' } },
          square: { type: { $ref: '#/definitions/Square' } },
        } },
      },
    });
    const output = JSON.parse(decoder.decode(choice.files['preview.avsc']));
    expect(output.map((branch: { fields: { name: string }[] }) => branch.fields.map((field) => field.name))).toEqual([
      ['kind', 'id', 'radius'],
      ['kind', 'id', 'side'],
    ]);
  });

  it('can cancel while destination selection is pending and never starts publication', async () => {
    let releaseDestination: ((value: string) => void) | undefined;
    const destination = new Promise<string>((resolveDestination) => { releaseDestination = resolveDestination; });
    const root = await mkdtemp(join(tmpdir(), 'json-structure-host-cancel-'));
    try {
      const host = new NodeConversionHost({ runtimeRoot: resolve(process.cwd(), 'src/conversion'), destination: async () => destination });
      const conversion = host.convert({
        protocolVersion: 1,
        requestId: 'cancel-during-dialog',
        kind: 'conversion',
        documentVersion: 1,
        commandId: 'import.jsonschema.to-json-structure',
        sourceName: 'schema.json',
        sourceText: '{"type":"string"}',
        options: {},
      });
      host.cancel('cancel-during-dialog');
      releaseDestination?.(join(root, 'output'));
      const result = await conversion;
      expect(result.succeeded).toBe(false);
      expect(result.outputs).toEqual([]);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'conversion.cancelled' }));
      await expect(readFile(join(root, 'output', 'conversion-output-manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not expose renderer request IDs as host operation or staging IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'json-structure-host-operation-'));
    const destination = join(root, 'output');
    const runtimeRoot = join(root, 'runtime');
    const phases: string[] = [];
    try {
      await mkdir(join(runtimeRoot, 'worker-runtime'), { recursive: true });
      await copyFile(resolve(process.cwd(), 'tests/fixtures/conversion-quota-worker.cjs'), join(runtimeRoot, 'worker-runtime', 'converter-worker.cjs'));
      const host = new NodeConversionHost({
        runtimeRoot,
        destination: async () => destination,
        progress: (_request, phase) => phases.push(phase),
      });
      const requestId = 'renderer-request-must-not-be-an-operation-id';
      const result = await host.convert({
        protocolVersion: 1,
        requestId,
        kind: 'conversion',
        documentVersion: 1,
        commandId: 'export.json-structure.to-jsonschema',
        sourceName: 'evidence.struct.json',
        sourceText: '{}',
        options: {},
      });
      expect(result.succeeded).toBe(true);
      expect(phases).toEqual([]);
      const evidence = JSON.parse(await readFile(join(destination, 'evidence.schema.json'), 'utf8'));
      expect(evidence.operationId).not.toBe(requestId);
      expect(evidence.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect((await readdir(root)).some((entry) => entry.includes(requestId))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns review evidence that matches the atomically published manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'json-structure-host-review-'));
    const destination = join(root, 'output');
    try {
      const host = new NodeConversionHost({ runtimeRoot: resolve(process.cwd(), 'src/conversion'), destination: async () => destination });
      const result = await host.convert({
        protocolVersion: 1,
        requestId: 'host-review',
        kind: 'conversion',
        documentVersion: 7,
        commandId: 'import.jsonschema.to-json-structure',
        sourceName: 'schema.json',
        sourceText: '{"type":"object","properties":{"id":{"type":"integer","minimum":0}}}',
        options: { rootName: 'Order' },
      });

      expect(result.succeeded).toBe(true);
      expect(result.review).toMatchObject({
        commandId: 'import.jsonschema.to-json-structure',
        converter: { id: 'jsonschema', displayName: 'JSON Schema Converter', version: '1.0.0-node' },
        sourceFormat: 'json-schema',
        targetFormat: 'json-structure',
        lifecycle: ['idle', 'preparing', 'running', 'publishing', 'completed'],
        published: true,
        lossiness: 'precision',
        warnings: [expect.objectContaining({ code: 'jsonschema.integer.narrowed', lossiness: 'precision' })],
        effectiveOptions: { rootName: 'Order', preserveUnknownKeywords: false },
        source: {
          name: 'schema.json',
          bytes: 68,
          sha256: '65befccc346ccbd219e60c09758ab83e9cf9f8ccd9122bf36caabb95f801e368',
        },
      });
      const publishedManifest = JSON.parse(await readFile(join(destination, 'conversion-output-manifest.json'), 'utf8'));
      expect(result.review?.manifest).toEqual(publishedManifest);
      expect(result.review?.manifest?.files[0]).toMatchObject({ path: 'Order.struct.json', bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
