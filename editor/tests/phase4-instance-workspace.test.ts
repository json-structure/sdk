import { describe, expect, it } from 'vitest';
import { InstanceWorkspace, createInstanceWorkspace } from '../src/phase4/instance-workspace.js';

const validate = (schema: Record<string, unknown>, instance: unknown, depthBudget?: number) =>
  createInstanceWorkspace(schema, instance, depthBudget === undefined ? {} : { depthBudget }).validate();

describe('phase 4 instance workspace', () => {
  it('validates Core scalar value spaces and exact values', () => {
    const accepted: ReadonlyArray<readonly [string, unknown]> = [
      ['string', 'text'], ['number', 1.5], ['integer', 42], ['boolean', false], ['null', null],
      ['int8', -128], ['uint32', 4294967295], ['int64', '9223372036854775807'],
      ['uint128', '340282366920938463463374607431768211455'], ['decimal', '-10.25'],
      ['date', '2024-02-29'], ['datetime', '2024-01-01T12:00:00Z'], ['time', '12:00:00Z'],
      ['duration', 'P1DT2H'], ['uuid', '123e4567-e89b-12d3-a456-426614174000'], ['jsonpointer', '/a~1b']
    ];
    for (const [type, value] of accepted) expect(validate({ type }, value).status, type).toBe('valid');
    for (const [type, value] of [['int8', 128], ['uint64', '-1'], ['decimal', '1'], ['date', '2023-02-29'], ['integer', 1.5]] as const) {
      const result = validate({ type }, value);
      expect(result.status, type).toBe('invalid');
      expect(result.diagnostics[0]).toMatchObject({ code: 'instance.type', instancePointer: '', schemaPointer: '/type' });
    }
    expect(validate({ type: 'string', enum: ['a', 'b'] }, 'c').diagnostics[0]?.schemaPointer).toBe('/enum');
    expect(validate({ type: 'string', const: 'a' }, 'a').status).toBe('valid');
  });

  it('validates objects, required alternatives, additional properties, and escaped pointers', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, 'a/b': { type: 'int8' }, fins: { type: 'int8' }, legs: { type: 'int8' } },
      required: [['name', 'fins'], ['name', 'legs']],
      additionalProperties: false
    };
    expect(validate(schema, { name: 'fish', fins: 2, 'a/b': 1 }).status).toBe('valid');
    expect(validate(schema, { name: 'hybrid', fins: 2, legs: 4 }).diagnostics[0]?.code).toBe('instance.required-alternative');
    const invalid = validate(schema, { name: 'fish', fins: 2, 'a/b': 128, extra: true });
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'instance.type', instancePointer: '/a~1b', schemaPointer: '/properties/a~1b/type' }),
      expect.objectContaining({ code: 'instance.additional-property', instancePointer: '/extra', schemaPointer: '/additionalProperties' })
    ]));
  });

  it('validates arrays, sets, maps, tuples, and tagged and inline choices', () => {
    expect(validate({ type: 'array', items: { type: 'int8' } }, [1, 128]).diagnostics[0]?.instancePointer).toBe('/1');
    expect(validate({ type: 'set', items: { type: 'string' } }, ['x', 'x']).diagnostics.some((item) => item.code === 'instance.set-duplicate')).toBe(true);
    expect(validate({ type: 'map', values: { type: 'boolean' } }, { yes: true, no: 0 }).diagnostics[0]?.instancePointer).toBe('/no');
    const tuple = { type: 'tuple', tuple: ['name', 'age'], properties: { name: { type: 'string' }, age: { type: 'int8' } } };
    expect(validate(tuple, ['Ada', 42]).status).toBe('valid');
    expect(validate(tuple, ['Ada']).diagnostics[0]?.code).toBe('instance.tuple-length');
    const tagged = { type: 'choice', choices: { text: { type: 'string' }, count: { type: 'int8' } } };
    expect(validate(tagged, { text: 'hello' }).status).toBe('valid');
    expect(validate(tagged, { text: 'hello', count: 1 }).status).toBe('invalid');
    const inline = { type: 'choice', selector: 'kind', choices: { cat: { type: 'object', properties: { kind: { const: 'cat' }, lives: { type: 'int8' } }, required: ['lives'] } } };
    expect(validate(inline, { kind: 'cat', lives: 9 }).status).toBe('valid');
    expect(validate(inline, { kind: 'dog' }).diagnostics[0]?.schemaPointer).toBe('/selector');
  });

  it('applies numeric, string, collection, and object Validation constraints', () => {
    expect(validate({ type: 'decimal', minimum: '1.10', exclusiveMaximum: '2.00', multipleOf: '0.05' }, '1.25').status).toBe('valid');
    expect(validate({ type: 'number', minimum: 1, maximum: 2, multipleOf: 0.25 }, 2.1).diagnostics.map((item) => item.code)).toContain('instance.maximum');
    expect(validate({ type: 'string', minLength: 2, maxLength: 3, pattern: '^[a-z]+$', format: 'email' }, 'A').diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(['instance.minLength', 'instance.pattern', 'instance.format']));
    const arrays = validate({ type: 'array', minItems: 2, maxItems: 3, uniqueItems: true, contains: { type: 'string' }, minContains: 2 }, ['x', 1, 1]);
    expect(arrays.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(['instance.uniqueItems', 'instance.contains']));
    const object = validate({
      type: 'object', minProperties: 2, maxProperties: 3,
      dependentRequired: { card: ['address'] },
      patternProperties: { '^x': { type: 'int8' } },
      propertyNames: { type: 'string', pattern: '^[a-z]+$' },
      has: { type: 'boolean' }
    }, { card: 1, xValue: 128 });
    expect(object.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(['instance.dependentRequired', 'instance.type', 'instance.pattern', 'instance.has']));
    expect(validate({ type: 'map', minEntries: 1, maxEntries: 1, keyNames: { type: 'string', pattern: '^x' }, patternKeys: { '^x': { type: 'string' } } }, { x: 'ok' }).status).toBe('valid');
  });

  it('evaluates composition and conditional traces without leaking discarded branch errors', () => {
    const composed = validate({
      type: 'object',
      allOf: [{ required: ['a'] }],
      anyOf: [{ properties: { a: { type: 'string' } }, required: ['a'] }, { required: ['b'] }],
      oneOf: [{ required: ['a'] }, { required: ['c'] }],
      not: { required: ['forbidden'] },
      if: { properties: { a: { const: 'x' } }, required: ['a'] },
      then: { required: ['thenValue'] },
      else: { required: ['elseValue'] }
    }, { a: 'x', thenValue: true });
    expect(composed.status).toBe('valid');
    expect(composed.diagnostics).toEqual([]);
    expect(composed.trace.children.map((item) => item.keyword)).toEqual(expect.arrayContaining(['allOf', 'anyOf', 'oneOf', 'not', 'if']));
    const ambiguous = validate({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 1);
    expect(ambiguous.diagnostics[0]?.code).toBe('instance.oneOf');
    expect(ambiguous.trace.children.find((item) => item.keyword === 'oneOf')?.children).toHaveLength(2);
  });

  it('resolves local type references and terminates unresolved refs, cycles, and depth exhaustion', () => {
    const schema = { definitions: { Node: { type: 'object', properties: { value: { type: 'string' }, next: { type: { $ref: '#/definitions/Node' } } } } }, type: { $ref: '#/definitions/Node' } };
    expect(validate(schema, { value: 'last' }).status).toBe('valid');
    expect(validate(schema, { value: 'first', next: { value: 1 } }).diagnostics.some((item) => item.instancePointer === '/next/value')).toBe(true);
    expect(validate({ type: { $ref: '#/missing' } }, 1).status).toBe('indeterminate');
    const self = { type: { $ref: '#' } };
    expect(validate(self, 1).diagnostics[0]?.code).toBe('instance.cycle');
    expect(validate(schema, { value: 'first', next: { value: 'last' } }, 1).diagnostics.some((item) => item.code === 'instance.depth-budget')).toBe(true);
  });

  it('marks composition indeterminate when an unknown branch can affect the answer', () => {
    expect(validate({ anyOf: [{ type: 'boolean' }, { type: { $ref: 'https://example.test/T' } }] }, 1).status).toBe('indeterminate');
    expect(validate({ anyOf: [{ type: 'number' }, { type: { $ref: 'https://example.test/T' } }] }, 1).status).toBe('valid');
    expect(validate({ oneOf: [{ type: 'number' }, { type: { $ref: 'https://example.test/T' } }] }, 1).status).toBe('indeterminate');
    expect(validate({ not: { type: { $ref: '#/missing' } } }, 1).status).toBe('indeterminate');
    expect(validate({ if: { type: { $ref: '#/missing' } }, then: { type: 'number' } }, 1).status).toBe('indeterminate');
  });

  it('keeps bidirectional instance/schema selection and diagnostic navigation state', () => {
    const workspace = new InstanceWorkspace({ type: 'object', properties: { age: { type: 'int8' } } }, { age: 128 });
    workspace.selectSchema('/properties/age', '/age');
    expect(workspace.selection).toEqual({ source: 'schema', instancePointer: '/age', schemaPointer: '/properties/age' });
    workspace.selectInstance('/age');
    expect(workspace.selection).toEqual({ source: 'instance', instancePointer: '/age', schemaPointer: '/properties/age' });
    expect(workspace.selectDiagnostic(0)).toEqual({ source: 'diagnostic', instancePointer: '/age', schemaPointer: '/properties/age/type', diagnosticIndex: 0 });
    expect(workspace.selectDiagnostic(99)).toBeUndefined();
  });

  it('validates resolved imported types and instance-selected add-ins', () => {
    const imported = {
      $id: 'https://example.test/shared.struct.json',
      definitions: { Address: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }
    };
    const schema = {
      $offers: { Tracking: '#/definitions/Tracking' },
      definitions: {
        shared: { $importdefs: 'https://example.test/shared.struct.json' },
        Parcel: { type: 'object', properties: { destination: { type: { $ref: '#/definitions/shared/Address' } } }, required: ['destination'], additionalProperties: false },
        Tracking: { abstract: true, type: 'object', $extends: '#/definitions/Parcel', properties: { trackingId: { type: 'string' } }, required: ['trackingId'] }
      },
      type: { $ref: '#/definitions/Parcel' }
    };
    const options = { documentUri: 'https://example.test/root.struct.json', resolvedDocuments: [{ uri: 'https://example.test/shared.struct.json', document: imported }] };

    expect(createInstanceWorkspace(schema, { destination: { city: 'Brussels' } }, options).validate().status).toBe('valid');
    const invalid = createInstanceWorkspace(schema, { $uses: ['Tracking'], destination: { city: 'Brussels' } }, options).validate();
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'instance.required', instancePointer: '/trackingId' })]));
    expect(createInstanceWorkspace(schema, { $uses: ['Tracking'], destination: { city: 'Brussels' }, trackingId: 'p-1' }, options).validate().status).toBe('valid');
  });

  it('validates relation cardinality, ordered identity values, and qualifiers', () => {
    const schema = {
      definitions: {
        Person: { type: 'object', properties: { tenant: { type: 'string' }, id: { type: 'int32' } }, identity: ['tenant', 'id'] },
        Role: { type: 'object', properties: { role: { type: 'string' } }, required: ['role'] },
        Project: {
          type: 'object',
          relations: {
            owner: { cardinality: 'single', targettype: { $ref: '#/definitions/Person' } },
            contributors: { cardinality: 'multiple', targettype: { $ref: '#/definitions/Person' }, qualifiertype: { $ref: '#/definitions/Role' } }
          }
        }
      },
      type: { $ref: '#/definitions/Project' }
    };
    const externalRelationResolver = () => 'valid' as const;
    expect(createInstanceWorkspace(schema, { owner: { identity: ['acme', 7] }, contributors: [{ identity: ['acme', 8], qualifier: { role: 'dev' } }] }, { externalRelationResolver }).validate().status).toBe('valid');
    const invalid = createInstanceWorkspace(schema, { owner: [{ identity: ['acme', 7] }], contributors: [{ identity: ['acme', 'bad'] }] }, { externalRelationResolver }).validate();
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'instance.relation-cardinality', instancePointer: '/owner' }),
      expect.objectContaining({ code: 'instance.type', instancePointer: '/contributors/0/identity/1' }),
      expect.objectContaining({ code: 'instance.relation-qualifier', instancePointer: '/contributors/0/qualifier' })
    ]));
  });

  it('resolves scoped relations through array and map values and reports missing or ambiguous identities', () => {
    const schema = {
      $root: '#/definitions/Library',
      definitions: {
        Author: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Book: { type: 'object', relations: { author: { cardinality: 'single', targettype: { $ref: '#/definitions/Author' }, scope: ['#/definitions/Library/properties/authors', '#/definitions/Library/properties/guests'] } } },
        Library: {
          type: 'object',
          properties: {
            authors: { type: 'array', items: { type: { $ref: '#/definitions/Author' } } },
            guests: { type: 'map', values: { type: { $ref: '#/definitions/Author' } } },
            book: { type: { $ref: '#/definitions/Book' } }
          }
        }
      },
      type: { $ref: '#/definitions/Library' }
    };
    const valid = { authors: [{ id: 'a' }], guests: { b: { id: 'b' } }, book: { author: { identity: 'b' } } };
    expect(createInstanceWorkspace(schema, valid).validate().status).toBe('valid');
    expect(createInstanceWorkspace(schema, { ...valid, book: { author: { identity: 'missing' } } }).validate().diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'instance.relation-scope-missing' })]));
    expect(createInstanceWorkspace(schema, { authors: [{ id: 'a' }], guests: { duplicate: { id: 'a' } }, book: { author: { identity: 'a' } } }).validate().diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'instance.relation-scope-ambiguous' })]));
  });

  it('uses tri-state external relation resolution and defaults to indeterminate', () => {
    const schema = {
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Source: { type: 'object', relations: { target: { cardinality: 'single', targettype: { $ref: '#/definitions/Target' } } } }
      },
      type: { $ref: '#/definitions/Source' }
    };
    const instance = { target: { identity: 't-1' } };
    expect(createInstanceWorkspace(schema, instance).validate().status).toBe('indeterminate');
    expect(createInstanceWorkspace(schema, instance, { externalRelationResolver: () => 'valid' }).validate().status).toBe('valid');
    expect(createInstanceWorkspace(schema, instance, { externalRelationResolver: () => 'invalid' }).validate().diagnostics[0]?.code).toBe('instance.relation-external-missing');
  });
});