import { describe, expect, it } from 'vitest';
import { parseDocument, resolveDocumentReferences, resolveReferences } from '../src/index.js';

function diagnosticAt(source: string, pointer: string, code?: string) {
  const parsed = parseDocument('memory://core-declarations', source);
  const diagnostic = parsed.diagnostics.find((entry) => entry.location?.pointer === pointer && (!code || entry.code === code));
  expect(diagnostic, `${code ?? 'diagnostic'} at ${pointer}`).toBeDefined();
  return { parsed, diagnostic: diagnostic! };
}

describe('Core declaration diagnostics', () => {
  it('accepts inline and reusable roots, nested namespaces, typed references, and extension keywords', () => {
    const inline = parseDocument('memory://inline', JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'https://example.org/inline',
      name: 'Inline',
      type: 'object',
      properties: { valid_1: { type: 'string', 'x-vendor': { keep: true } } },
      'x-document': true
    }));
    expect(inline.diagnostics.filter((entry) => entry.code.startsWith('core.'))).toEqual([]);
    expect(inline.model?.unknownKeysPreserved).toBe(true);

    const reusable = parseDocument('memory://reusable', JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'https://example.org/reusable',
      name: 'Reusable',
      $root: '#%2Fdefinitions%2FDomain%2Fdisplay%20namespace%2FNested%2FEntity',
      definitions: {
        Domain: {
          'display namespace': {
            Nested: {
              Entity: { type: 'object', properties: { id: { type: 'uuid' } } },
              Alias: { type: { $ref: '#/definitions/Domain/display namespace/Nested/Entity' } }
            }
          }
        }
      }
    }));
    expect(reusable.diagnostics.filter((entry) => entry.code.startsWith('core.'))).toEqual([]);
    expect(reusable.model?.projections.definitions.map((entry) => entry.pointer)).toEqual(expect.arrayContaining([
      '/definitions/Domain/display namespace/Nested/Entity',
      '/definitions/Domain/display namespace/Nested/Alias'
    ]));
    expect(reusable.model?.rootPointer).toBe('/definitions/Domain/display namespace/Nested/Entity');
  });

  it('requires normative document metadata and validates each value form', () => {
    const missing = parseDocument('memory://missing-headers', '{"definitions":{}}');
    expect(missing.diagnostics.map((entry) => [entry.code, entry.location?.pointer])).toEqual(expect.arrayContaining([
      ['core.declaration-invalid', '/$schema'],
      ['core.declaration-invalid', '/$id'],
      ['core.declaration-invalid', '/name']
    ]));

    const invalid = parseDocument('memory://invalid-headers', '{"$schema":"relative","$id":7,"name":"bad-name","type":"string"}');
    for (const pointer of ['/$schema', '/$id', '/name']) {
      expect(invalid.diagnostics.some((entry) => entry.code === 'core.declaration-invalid' && entry.location?.pointer === pointer)).toBe(true);
    }
  });

  it('rejects direct-ref objects in declaration and property schema positions', () => {
    const source = JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'https://example.org/direct-ref',
      name: 'DirectRef',
      definitions: {
        Target: { type: 'string' },
        Alias: { $ref: '#/definitions/Target' },
        Container: { type: 'object', properties: { value: { $ref: '#/definitions/Target' } } }
      }
    });
    const parsed = parseDocument('memory://direct-ref', source);
    for (const pointer of ['/definitions/Alias', '/definitions/Container/properties/value']) {
      expect(parsed.diagnostics.some((entry) => entry.code === 'core.declaration-invalid' && entry.location?.pointer === pointer)).toBe(true);
      expect(parsed.model?.projections.definitions.some((entry) => entry.pointer === pointer)).toBe(false);
    }
  });

  it('keeps namespace containers distinct from declarations and diagnoses non-object members', () => {
    const parsed = parseDocument('memory://namespace-classification', JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'https://example.org/namespaces',
      name: 'Namespaces',
      definitions: {
        Vendor: {
          'x-note': true,
          Nested: { type: 'string' }
        }
      }
    }));
    expect(parsed.diagnostics.some((entry) => entry.code === 'core.declaration-invalid' && entry.location?.pointer === '/definitions/Vendor/x-note')).toBe(true);
    expect(parsed.model?.projections.definitions.some((entry) => entry.pointer === '/definitions/Vendor')).toBe(false);
    expect(parsed.model?.projections.definitions.some((entry) => entry.pointer === '/definitions/Vendor/Nested')).toBe(true);
  });

  it('requires composition-bearing declarations to retain a type member', () => {
    const parsed = parseDocument('memory://composition-without-type', JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'https://example.org/composition',
      name: 'Composition',
      definitions: {
        Invalid: { allOf: [{ type: 'string' }] },
        Valid: { type: 'string', allOf: [{ type: 'string' }] }
      }
    }));
    expect(parsed.diagnostics.some((entry) => entry.code === 'core.declaration-invalid' && entry.location?.pointer === '/definitions/Invalid')).toBe(true);
    expect(parsed.model?.projections.definitions.some((entry) => entry.pointer === '/definitions/Invalid')).toBe(false);
    expect(parsed.model?.projections.definitions.some((entry) => entry.pointer === '/definitions/Valid')).toBe(true);
  });

  it('diagnoses non-object roots and malformed root forms at exact values', () => {
    const arrayRoot = parseDocument('memory://array-root', '[]');
    const rootDiagnostic = arrayRoot.diagnostics.find((entry) => entry.code === 'core.document-root-invalid');
    expect(arrayRoot.model).toBeUndefined();
    expect(arrayRoot.value).toEqual([]);
    expect(arrayRoot.diagnostics).toHaveLength(1);
    expect('[]'.slice(rootDiagnostic!.location!.range!.startOffset, rootDiagnostic!.location!.range!.endOffset)).toBe('[]');
    expect(arrayRoot.model).toBeUndefined();

    const cases = [
      ['{"$root":1,"definitions":{}}', '/$root', '1'],
      ['{"$root":"#/properties/x","definitions":{}}', '/$root', '"#/properties/x"'],
      ['{"$root":"#/definitions/T","type":"string","definitions":{"T":{"type":"string"}}}', '', undefined],
      ['{"definitions":[]}', '/definitions', '[]']
    ] as const;
    for (const [source, pointer, expectedText] of cases) {
      const { diagnostic } = diagnosticAt(source, pointer, 'core.declaration-invalid');
      const range = diagnostic.location!.range!;
      if (expectedText !== undefined) expect(source.slice(range.startOffset, range.endOffset)).toBe(expectedText);
      else expect(source.slice(range.startOffset, range.endOffset)).toBe(source);
    }
  });

  it('leaves local $root target existence and ambiguity to the resolver', () => {
    const missing = parseDocument('memory://missing-root', '{"$root":"#/definitions/Missing","definitions":{"Present":{"type":"string"}}}');
    expect(missing.diagnostics.some((entry) => entry.location?.pointer === '/$root')).toBe(false);
    const resolution = resolveReferences(missing.model!);
    expect(resolution.diagnostics.filter((entry) => entry.location?.pointer === '/$root')).toHaveLength(1);
    expect(resolution.references[0]).toEqual(expect.objectContaining({ kind: 'root', status: 'unresolved' }));

    const integrated = resolveDocumentReferences(missing.model!);
    expect(integrated.projections.diagnostics.filter((entry) => entry.pointer === '/$root')).toHaveLength(1);
  });

  it('diagnoses malformed definitions, declaration names, nested definitions, and type forms', () => {
    const source = '{"definitions":{"bad-type":{"type":"string"},"Broken":7,"Malformed":{"type":{}},"Namespace":{"definitions":{"Inner":{"type":"string"}}}}}';
    const parsed = parseDocument('memory://definitions-invalid', source);
    for (const pointer of [
      '/definitions/bad-type',
      '/definitions/Broken',
      '/definitions/Malformed/type',
      '/definitions/Namespace/definitions'
    ]) {
      expect(parsed.diagnostics.some((entry) => entry.location?.pointer === pointer), pointer).toBe(true);
    }
    const nameDiagnostic = parsed.diagnostics.find((entry) => entry.location?.pointer === '/definitions/bad-type' && entry.code === 'core.identifier-invalid')!;
    expect(source.slice(nameDiagnostic.location!.range!.startOffset, nameDiagnostic.location!.range!.endOffset)).toBe('"bad-type"');
    expect(parsed.diagnostics.filter((entry) => entry.location?.pointer === '/definitions/Malformed/type')).toHaveLength(1);
  });

  it('enforces object properties placement, shape, identifier, and schema value invariants', () => {
    const cases = [
      ['{"type":"object"}', '', undefined],
      ['{"type":"object","properties":[]}', '/properties', '[]'],
      ['{"type":"object","properties":{}}', '/properties', '{}'],
      ['{"type":"string","properties":{"x":{"type":"string"}}}', '/properties', '{"x":{"type":"string"}}'],
      ['{"type":"object","properties":{"bad-name":{"type":"string"}}}', '/properties/bad-name', '"bad-name"'],
      ['{"type":"object","properties":{"x":1}}', '/properties/x', '1'],
      ['{"type":"object","properties":{"x":{}}}', '/properties/x', '{}'],
      ['{"type":"object","properties":{"x":{"type":false}}}', '/properties/x/type', 'false']
    ] as const;
    for (const [source, pointer, expectedText] of cases) {
      const { diagnostic } = diagnosticAt(source, pointer);
      const range = diagnostic.location!.range!;
      if (expectedText !== undefined) expect(source.slice(range.startOffset, range.endOffset)).toBe(expectedText);
    }
  });

  it('tracks escaped property keys and duplicate ambiguity with exact key ranges', () => {
    const escaped = '{"type":"object","properties":{"bad\\u002dname":{"type":"string"}}}';
    const { parsed, diagnostic } = diagnosticAt(escaped, '/properties/bad-name', 'core.identifier-invalid');
    const node = parsed.model?.nodes.find((entry) => entry.pointer === '/properties/bad-name');
    expect(diagnostic.location?.range).toEqual(node?.keyRange);
    expect(escaped.slice(node!.keyRange!.startOffset, node!.keyRange!.endOffset)).toBe('"bad\\u002dname"');

    const duplicate = '{"type":"object","properties":{"id":{"type":"string"},"\\u0069d":{"type":"uuid"}}}';
    const duplicateResult = parseDocument('memory://duplicate-property', duplicate);
    const duplicateDiagnostic = duplicateResult.diagnostics.find((entry) => entry.code === 'json.duplicate-pointer' && entry.location?.pointer === '/properties/id')!;
    expect(duplicate.slice(duplicateDiagnostic.location!.range!.startOffset, duplicateDiagnostic.location!.range!.endOffset)).toBe('"id"');
    expect(duplicate.slice(duplicateDiagnostic.related![0].range!.startOffset, duplicateDiagnostic.related![0].range!.endOffset)).toBe('"\\u0069d"');
  });

  it('recovers incomplete Core declarations without speculative model diagnostics', () => {
    for (const source of ['{', '{"definitions":', '{"type":"object","properties":{"id":']) {
      const parsed = parseDocument('memory://incomplete', source);
      expect(parsed.recovery).toBe('incomplete');
      expect(parsed.model).toBeUndefined();
      expect(parsed.diagnostics).toHaveLength(1);
      expect(parsed.diagnostics[0]?.code).toBe('json.incomplete');
    }
  });
});