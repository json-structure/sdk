import { describe, expect, it } from 'vitest';
import {
  DocumentSession,
  InMemoryEditorHost,
  PROTOCOL_VERSION,
  SetValidationKeywordCommand,
  parseDocument,
  type ValidationKeyword,
  type ValidationKeywordMap
} from '../src/index.js';

const validationSchema = '"$schema":"https://json-structure.org/meta/validation/v0/#",';
const active = (members: string): string => `{${validationSchema}${members}}`;

const cases: ReadonlyArray<readonly [string, ValidationKeyword, ValidationKeywordMap[ValidationKeyword]]> = [
  ['number', 'minimum', 0], ['number', 'maximum', 10], ['number', 'exclusiveMinimum', 0], ['number', 'exclusiveMaximum', 10], ['number', 'multipleOf', 0.5],
  ['string', 'minLength', 1], ['string', 'maxLength', 10], ['string', 'pattern', '^[a-z]+$'], ['string', 'format', 'email'],
  ['array', 'minItems', 0], ['array', 'maxItems', 10], ['array', 'uniqueItems', true],
  ['array', 'contains', { type: 'string' }], ['array', 'minContains', 1], ['array', 'maxContains', 2],
  ['object', 'minProperties', 0], ['object', 'maxProperties', 10],
  ['map', 'minEntries', 0], ['map', 'maxEntries', 10],
  ['string', 'default', { literal: { $ref: '#/not-a-schema' } }],
  ['object', 'propertyNames', { type: 'string', pattern: '^[a-z]+$' }],
  ['map', 'keyNames', { type: 'string', pattern: '^[a-z]+$' }],
  ['object', 'has', { type: 'object' }],
  ['object', 'dependentRequired', { credit_card: ['billing_address'] }],
  ['object', 'patternProperties', { '^x': { type: 'string' } }],
  ['map', 'patternKeys', { '^x': { type: 'string' } }]
];

const invalidCases: ReadonlyArray<readonly [string, ValidationKeyword, unknown, string]> = [
  ['number', 'minimum', '0', ''], ['number', 'maximum', '10', ''], ['number', 'exclusiveMinimum', '0', ''], ['number', 'exclusiveMaximum', '10', ''], ['number', 'multipleOf', 0, ''],
  ['string', 'minLength', -1, ''], ['string', 'maxLength', 1.5, ''], ['string', 'pattern', '[', ''], ['string', 'format', 'text', ''],
  ['set', 'uniqueItems', true, ''], ['string', 'minItems', 0, ''], ['string', 'maxItems', 1, ''],
  ['array', 'contains', { pattern: 'x' }, ''], ['array', 'minContains', 1, ''], ['array', 'maxContains', 1, ''],
  ['map', 'minProperties', 0, ''], ['map', 'maxProperties', 1, ''], ['object', 'minEntries', 0, ''], ['object', 'maxEntries', 1, ''],
  ['object', 'propertyNames', { type: 'number' }, ''], ['map', 'keyNames', { type: 'number' }, ''], ['object', 'has', { type: 'string' }, ''],
  ['object', 'dependentRequired', { 'bad-name': ['also-bad'] }, ''], ['object', 'patternProperties', { '[': { type: 'string' } }, ''], ['map', 'patternKeys', { '^x': {} }, ''],
  ['string', 'default', null, 'remove']
];

describe('Validation editing and diagnostics', () => {
  it('provides a typed set command for every Validation ledger keyword', () => {
    for (const [type, keyword, value] of cases) {
      const extra = keyword === 'minContains' || keyword === 'maxContains' ? ',"contains":{"type":"string"}' : '';
      const session = new DocumentSession(`memory://${keyword}`, active(`"type":"${type}"${extra}`));
      expect(new SetValidationKeywordCommand('', keyword, value).canExecute({ session, documentVersion: 1 }), keyword).toBe(true);
    }
  });

  it('rejects an invalid edit for every Validation ledger keyword', () => {
    for (const [type, keyword, value, mode] of invalidCases) {
      const source = mode === 'remove' ? active('"type":"string"') : active(`"type":"${type}"`);
      const session = new DocumentSession(`memory://invalid-${keyword}`, source);
      expect(new SetValidationKeywordCommand('', keyword, mode === 'remove' ? undefined : value as never).canExecute({ session, documentVersion: 1 }), keyword).toBe(false);
    }
  });

  it('preserves unknown text and returns byte-identical direct inverses for add, replace, and remove', async () => {
    let text = '{\n  "$schema": "https://json-structure.org/meta/validation/v0/#",\n  "type": "string",\n  "unknown": { "keep": true }\n}';
    const operations = [
      new SetValidationKeywordCommand('', 'minLength', 2),
      new SetValidationKeywordCommand('', 'minLength', 3),
      new SetValidationKeywordCommand('', 'minLength', undefined)
    ];
    for (const [index, command] of operations.entries()) {
      const session = new DocumentSession(`memory://inverse-${index}`, text);
      const result = command.execute({ session, documentVersion: 1 });
      const host = new InMemoryEditorHost(`memory://inverse-${index}`, text);
      await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `edit-${index}`, documentVersion: 1, edits: result.edits });
      const changed = (await host.readDocument()).text;
      expect(changed).toContain('"unknown": { "keep": true }');
      await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: `undo-${index}`, documentVersion: 2, edits: result.inverseEdits });
      expect((await host.readDocument()).text).toBe(text);
      text = changed;
    }
  });

  it('enforces placements, domains, schema forms, and cross-key constraints', () => {
    const invalid = parseDocument('memory://invalid-validation', `{${validationSchema}"definitions":{\
      "S":{"type":"string","minLength":5,"maxLength":2,"pattern":"[","format":"text","minItems":1},\
      "A":{"type":"array","uniqueItems":"yes","contains":{"type":"string"},"minContains":2,"maxContains":1},\
      "O":{"type":"object","propertyNames":{"pattern":"x"},"has":{"type":"string"},"patternProperties":{"[":{"type":"string"}}},\
      "M":{"type":"map","minEntries":3,"maxEntries":2,"patternKeys":{"x":{}}}\
    }}`);
    const pointers = [
      '/definitions/S/pattern', '/definitions/S/format', '/definitions/S/minItems',
      '/definitions/A/uniqueItems',
      '/definitions/O/propertyNames', '/definitions/O/has', '/definitions/O/patternProperties',
      '/definitions/M/patternKeys'
    ];
    for (const pointer of pointers) {
      const diagnostic = invalid.diagnostics.find((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === pointer);
      const node = invalid.model?.nodes.find((item) => item.pointer === pointer);
      expect(diagnostic, pointer).toBeDefined();
      expect(diagnostic?.location?.range).toEqual(node?.range);
    }
    for (const pointer of ['/definitions/S/maxLength', '/definitions/A/maxContains', '/definitions/M/maxEntries']) {
      expect(invalid.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === pointer), pointer).toBe(false);
    }
  });

  it('enforces extended numeric strings and all lower/upper bound interactions', () => {
    const valid = parseDocument('memory://numeric-valid', active('"type":"decimal","minimum":"1.00","exclusiveMaximum":"2.00","multipleOf":"0.25"'));
    expect(valid.diagnostics.some((item) => item.code === 'json.keyword-invalid')).toBe(false);
    const invalid = parseDocument('memory://numeric-invalid', active('"type":"decimal","minimum":1,"exclusiveMinimum":"2.0","maximum":"2.0","multipleOf":"0.0"'));
    expect(invalid.diagnostics.some((item) => item.location?.pointer === '/minimum')).toBe(true);
    expect(invalid.diagnostics.some((item) => item.location?.pointer === '/maximum')).toBe(false);
    expect(invalid.diagnostics.some((item) => item.location?.pointer === '/multipleOf')).toBe(true);
    const precise = parseDocument('memory://numeric-precise', active('"type":"int128","minimum":"9007199254740993","maximum":"9007199254740992"'));
    expect(precise.diagnostics.some((item) => item.location?.pointer === '/maximum')).toBe(false);
    const effectiveContains = parseDocument('memory://contains-effective-cross-key', active('"type":"array","contains":{"type":"string"},"maxContains":0'));
    expect(effectiveContains.diagnostics.some((item) => item.location?.pointer === '/maxContains')).toBe(false);
  });

  it('enforces exact Core numeric syntax, signedness, and boundaries', () => {
    const boundaries: ReadonlyArray<readonly [string, unknown, boolean]> = [
      ['integer', -2147483648, true], ['integer', 2147483648, false], ['int8', -128, true], ['int8', 127, true], ['int8', 128, false],
      ['uint8', 0, true], ['uint8', -1, false], ['uint16', 65535, true], ['uint16', 65536, false],
      ['int32', 2147483647, true], ['uint32', 4294967295, true], ['uint32', 4294967296, false],
      ['int64', '-9223372036854775808', true], ['int64', '9223372036854775807', true], ['int64', '9223372036854775808', false],
      ['uint64', '18446744073709551615', true], ['uint64', '-1', false], ['uint64', '01', false], ['int128', '-170141183460469231731687303715884105728', true],
      ['uint128', '340282366920938463463374607431768211455', true], ['uint128', '340282366920938463463374607431768211456', false],
      ['decimal', '1.0', true], ['decimal', '1', false], ['decimal', '1e2', false], ['float8', 3400, true], ['float8', 3401, false]
    ];
    for (const [type, value, accepted] of boundaries) {
      const result = parseDocument(`memory://boundary-${type}-${String(value)}`, active(`"type":"${type}","minimum":${JSON.stringify(value)}`));
      expect(!result.diagnostics.some((item) => item.location?.pointer === '/minimum'), `${type}: ${String(value)}`).toBe(accepted);
    }
    const fractionalInteger = parseDocument('memory://fractional-integer', active('"type":"int8","minimum":1.5'));
    expect(fractionalInteger.diagnostics.some((item) => item.location?.pointer === '/minimum')).toBe(true);
  });

  it('uses effective local reference and extends types and stays conservative for unions or external references', () => {
    const referenced = parseDocument('memory://effective-ref', active('"definitions":{"Base":{"type":"int8"},"Alias":{"type":{"$ref":"#/definitions/Base"},"minimum":128},"Derived":{"type":"int8","$extends":"#/definitions/Base","minimum":-129}}'));
    expect(referenced.diagnostics.some((item) => item.location?.pointer === '/definitions/Alias/minimum')).toBe(true);
    expect(referenced.diagnostics.some((item) => item.location?.pointer === '/definitions/Derived/minimum')).toBe(true);
    const indeterminate = parseDocument('memory://effective-indeterminate', active('"type":{"$ref":"https://example.test/types#T"},"minimum":"not-known"'));
    expect(indeterminate.diagnostics.some((item) => item.location?.pointer === '/minimum')).toBe(false);
    const union = new DocumentSession('memory://effective-union', active('"type":["int8","string"]'));
    expect(new SetValidationKeywordCommand('', 'minimum', 1).canExecute({ session: union, documentVersion: 1 })).toBe(false);
    const mixedSource = active('"definitions":{"Local":{"type":"int8"},"Mixed":{"$extends":["#/definitions/Local","https://example.test/types#External"],"minimum":"not-known"}},"$root":"#/definitions/Mixed"');
    const mixed = parseDocument('memory://effective-mixed', mixedSource);
    expect(mixed.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === '/definitions/Mixed/minimum')).toBe(false);
    const mixedSession = new DocumentSession('memory://effective-mixed-command', active('"definitions":{"Local":{"type":"int8"},"Mixed":{"$extends":["#/definitions/Local","https://example.test/types#External"]}},"$root":"#/definitions/Mixed"'));
    expect(new SetValidationKeywordCommand('/definitions/Mixed', 'minimum', 1).canExecute({ session: mixedSession, documentVersion: 1 })).toBe(false);
  });

  it('distinguishes authored minContains from the normative contains minimum', () => {
    const implicit = parseDocument('memory://implicit-contains', active('"type":"array","contains":{"type":"string"}'));
    expect(implicit.model?.projections.definitions[0]?.validation?.minContains).toBeUndefined();
    expect(implicit.model?.projections.definitions[0]?.validation?.effectiveMinContains).toEqual({ effective: 1 });
    const explicit = parseDocument('memory://explicit-contains', active('"type":"array","contains":{"type":"string"},"minContains":0'));
    expect(explicit.model?.projections.definitions[0]?.validation?.effectiveMinContains).toEqual({ explicit: 0, effective: 0 });
  });

  it('keeps literal default payloads opaque while traversing declared schema values', () => {
    const result = parseDocument('memory://default-literal', active('"type":"string","default":{"type":{"$ref":"#/missing"},"contains":{"type":{"$ref":"#/also-missing"}}}'));
    expect(result.diagnostics.some((item) => item.location?.pointer?.startsWith('/default'))).toBe(false);
    expect(result.model?.projections.references.some((item) => item.pointer.startsWith('/default'))).toBe(false);
  });

  it('recursively validates schema-valued payloads without descending into default data', () => {
    const nested = parseDocument('memory://nested-validation', active('"type":"array","contains":{"type":"object","properties":{"value":{"type":"string"}},"patternProperties":{"^x":{"type":"int8","minimum":128}},"default":{"type":"int8","minimum":128}}'));
    expect(nested.diagnostics.some((item) => item.location?.pointer === '/contains/patternProperties/^x/minimum')).toBe(true);
    expect(nested.diagnostics.some((item) => item.location?.pointer?.startsWith('/contains/default'))).toBe(false);
    const session = new DocumentSession('memory://nested-command', active('"type":"array"'));
    const invalidPayload = { type: 'object', properties: { value: { type: 'string' } }, patternProperties: { '^x': { type: 'int8', minimum: 128 } } };
    expect(new SetValidationKeywordCommand('', 'contains', invalidPayload).canExecute({ session, documentVersion: 1 })).toBe(false);
  });

  it('round-trips representative scalar and structured keyword families through direct inverses', async () => {
    const representatives: ReadonlyArray<readonly [string, ValidationKeyword, unknown, unknown]> = [
      ['int32', 'minimum', -1, 1], ['string', 'pattern', '^a$', '^b$'],
      ['array', 'contains', { type: 'string', minLength: 1 }, { type: 'int32', minimum: 0 }],
      ['object', 'dependentRequired', { alpha: ['beta'] }, { beta: ['alpha'] }],
      ['object', 'patternProperties', { '^a': { type: 'string' } }, { '^b': { type: 'int32', maximum: 3 } }],
      ['string', 'default', { untouched: { minimum: 'data' } }, ['replacement']]
    ];
    for (const [type, keyword, first, replacement] of representatives) {
      let text = active(`"type":"${type}"`);
      for (const value of [first, replacement, undefined]) {
        const session = new DocumentSession(`memory://roundtrip-${keyword}`, text);
        const command = new SetValidationKeywordCommand('', keyword, value as never);
        expect(command.canExecute({ session, documentVersion: 1 }), `${keyword}: ${JSON.stringify(value)}`).toBe(true);
        const result = command.execute({ session, documentVersion: 1 });
        const host = new InMemoryEditorHost(`memory://roundtrip-${keyword}`, text);
        await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'edit', documentVersion: 1, edits: result.edits });
        const changed = (await host.readDocument()).text;
        await host.applyTextEdits({ protocolVersion: PROTOCOL_VERSION, requestId: 'undo', documentVersion: 2, edits: result.inverseEdits });
        expect((await host.readDocument()).text).toBe(text);
        text = changed;
      }
    }
  });

  it('supports escaped target pointers and rejects duplicate target ambiguity', () => {
    const escaped = new DocumentSession('memory://escaped-target', active('"definitions":{"A/B":{"type":"string"}}'));
    expect(new SetValidationKeywordCommand('/definitions/A~1B', 'minLength', 1).canExecute({ session: escaped, documentVersion: 1 })).toBe(true);
    const duplicate = new DocumentSession('memory://duplicate-target', active('"definitions":{"A/B":{"type":"string"},"A\\u002fB":{"type":"string"}}'));
    expect(new SetValidationKeywordCommand('/definitions/A~1B', 'minLength', 1).canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);
  });

  it('rejects stale, incomplete, duplicate, and escaped duplicate command targets', () => {
    const valid = new DocumentSession('memory://stale', active('"type":"string"'));
    expect(new SetValidationKeywordCommand('', 'minLength', 1).canExecute({ session: valid, documentVersion: 2 })).toBe(false);
    const incomplete = new DocumentSession('memory://incomplete', `{${validationSchema}"type":"string",`);
    expect(new SetValidationKeywordCommand('', 'minLength', 1).canExecute({ session: incomplete, documentVersion: 1 })).toBe(false);
    const duplicate = new DocumentSession('memory://duplicate', active('"type":"string","minLength":1,"minLength":2'));
    expect(new SetValidationKeywordCommand('', 'minLength', 3).canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);
    expect(duplicate.model?.projections.definitions[0]?.validation?.minLength).toBeUndefined();
    const escaped = new DocumentSession('memory://escaped', active('"type":"string","minLength":1,"minLengt\\u0068":2'));
    expect(new SetValidationKeywordCommand('', 'minLength', 3).canExecute({ session: escaped, documentVersion: 1 })).toBe(false);
  });

  it('does not diagnose extension-shaped data outside schema-owned traversal', () => {
    const result = parseDocument('memory://extension-payload', active('"type":"string","x-extension":{"minimum":"bad","contains":{"$ref":"#/missing"}},"default":{"pattern":"["}'));
    expect(result.diagnostics.some((item) => item.location?.pointer?.startsWith('/x-extension') || item.location?.pointer?.startsWith('/default'))).toBe(false);
  });

  it('uses one capability result for parser and command Validation activation', () => {
    const matrix: ReadonlyArray<readonly [string, Record<string, unknown>, boolean]> = [
      ['direct-validation', { $schema: 'https://json-structure.org/meta/validation/v0/#' }, true],
      ['extended-with-use', { $schema: 'https://json-structure.org/meta/extended/v0/#', $uses: ['JSONStructureValidation'] }, true],
      ['extended-without-use', { $schema: 'https://json-structure.org/meta/extended/v0/#' }, false],
      ['core-with-use', { $schema: 'https://json-structure.org/meta/core/v0/#', $uses: ['JSONStructureValidation'] }, false],
      ['arbitrary-with-use', { $schema: 'https://example.test/meta', $uses: ['JSONStructureValidation'] }, false],
      ['missing-schema-with-use', { $uses: ['JSONStructureValidation'] }, false]
    ];

    for (const [name, header, expectedActive] of matrix) {
      const text = JSON.stringify({ ...header, type: 'string', minLength: 1 });
      const session = new DocumentSession(`memory://${name}`, text);
      const parsed = parseDocument(`memory://${name}`, text);
      const invalid = parseDocument(`memory://${name}-invalid`, JSON.stringify({ ...header, type: 'string', minLength: -1 }));
      expect(session.capabilities.validationActive, `${name}: capability`).toBe(expectedActive);
      expect(parsed.model?.projections.definitions[0]?.validation !== undefined, `${name}: parser projection`).toBe(expectedActive);
      expect(invalid.diagnostics.some((item) => item.location?.pointer === '/minLength'), `${name}: parser diagnostic`).toBe(expectedActive);
      expect(new SetValidationKeywordCommand('', 'minLength', 1).canExecute({ session, documentVersion: 1 }), `${name}: command`).toBe(expectedActive);
    }
  });
});