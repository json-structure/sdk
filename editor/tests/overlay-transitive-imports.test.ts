import { describe, expect, it } from 'vitest';
import { OverlayContextResolver } from '../src/overlay-context.js';
import { InstanceWorkspace } from '../src/phase4/instance-workspace.js';

const meta = 'https://json-structure.org/meta/validation/v0/#';
const ref = (name: string) => ({ type: { $ref: '#/definitions/' + name } });
const header = { $schema: meta, $id: 'https://example.test/transitive-root', name: 'Root' };

describe('transitive imported decimal provenance', () => {
  for (const [keyword, limit, good, bad] of [['scale', 2, '1.23', '1.234'], ['precision', 3, '1.23', '12.34']] as const) {
    it('resolves B Money allOf ' + keyword + ' through A common and root shared namespaces', () => {
      const b = { $schema: meta, $id: 'https://example.test/B', definitions: { Money: { type: 'decimal', name: 'Money', precision: 40, scale: 10, allOf: [{ [keyword]: limit }] } } };
      const a = { $schema: meta, $id: 'https://example.test/A', definitions: { common: { $importdefs: b.$id }, Alias: ref('common/Money') } };
      const root = { ...header, ...ref('shared/Alias'), definitions: { shared: { $importdefs: a.$id } } };
      const options = { resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }] }, before = JSON.stringify([root, a, b]);
      expect(new InstanceWorkspace(root, good, options).validate().status).toBe('valid');
      const result = new InstanceWorkspace(root, bad, options).validate();
      expect(result.status).toBe('invalid');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/definitions/common/Money/allOf/0/' + keyword, instancePointer: '' }));
      expect(result.diagnostics.some(d => d.code === 'instance.contextual-type-indeterminate')).toBe(false);
      expect(JSON.stringify([root, a, b])).toBe(before);
    });
  }

  it('retains source provenance through more than one intermediate alias/import namespace', () => {
    const c = { $schema: meta, $id: 'https://example.test/C', definitions: { Money: { type: 'decimal', precision: 40, scale: 10, allOf: [{ scale: 2 }] } } };
    const b = { $schema: meta, $id: 'https://example.test/B', definitions: { units: { $importdefs: c.$id }, Alias: ref('units/Money') } };
    const a = { $schema: meta, $id: 'https://example.test/A', definitions: { common: { $importdefs: b.$id }, Alias: ref('common/Alias') } };
    const root = { ...header, ...ref('shared/Alias'), definitions: { shared: { $importdefs: a.$id } } };
    const options = { resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }, { uri: c.$id, document: c }] };
    expect(new InstanceWorkspace(root, '1.23', options).validate().status).toBe('valid');
    const result = new InstanceWorkspace(root, '1.234', options).validate();
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/definitions/units/Money/allOf/0/scale' }));
  });

  it('keeps conditional descendants in B contextual through A alias and the root import', () => {
    const b = { $schema: meta, $id: 'https://example.test/B', definitions: { Money: { type: 'decimal', precision: 40, scale: 10, if: { allOf: [{ scale: 2 }] }, then: { allOf: [{ precision: 3 }] }, else: { allOf: [{ precision: 4 }] } } } };
    const a = { $schema: meta, $id: 'https://example.test/A', definitions: { common: { $importdefs: b.$id }, Alias: ref('common/Money') } };
    const root = { ...header, ...ref('shared/Alias'), definitions: { shared: { $importdefs: a.$id } } };
    const options = { resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }] };
    for (const value of ['1.23', '1.234']) expect(new InstanceWorkspace(root, value, options).validate().status, value).toBe('valid');
    for (const [value, branch] of [['12.34', 'then'], ['12.345', 'else']]) {
      const result = new InstanceWorkspace(root, value, options).validate();
      expect(result.status).toBe('invalid');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/definitions/common/Money/' + branch + '/allOf/0/precision' }));
    }
  });
});

describe('origin-aware property-name probes', () => {
  it('evaluates the original source location without replacing the origin document root or dropping trace versions', () => {
    const b = { $schema: meta, $id: 'https://example.test/B', definitions: { Allowed: { type: 'string', pattern: '^extra_[a-z]+$' }, Name: { type: 'string', allOf: [ref('Allowed')] } } };
    const a = { $schema: meta, $id: 'https://example.test/A', $root: '#/definitions/Bag', definitions: { common: { $importdefs: b.$id }, Allowed: { type: 'string', pattern: '^shadow_only$' }, Bag: { type: 'object', properties: { id: { type: 'string' } }, propertyNames: ref('common/Name') } } };
    const before = JSON.stringify([a, b]);
    const workspace = new InstanceWorkspace(a, 'extra_good', { documentUri: a.$id, resolvedDocuments: [{ uri: b.$id, document: b }], documentVersion: 7, instanceVersion: 3 });
    expect(workspace.validate().status).toBe('invalid');
    const result = workspace.validateAt('/definitions/Bag/propertyNames');
    expect(result.status).toBe('valid');
    expect(result).toMatchObject({ documentVersion: 7, instanceVersion: 3, trace: { schemaPointer: '/definitions/Bag/propertyNames', instancePointer: '', documentVersion: 7, instanceVersion: 3, occurrencePath: '' } });
    expect(workspace.validate().status).toBe('invalid');
    expect(JSON.stringify([a, b])).toBe(before);
  });

  it('returns an explicit indeterminate result for missing or non-schema authored probe locations', () => {
    const workspace = new InstanceWorkspace({ ...header, type: 'string', default: { type: 'string' } }, 'extra_good');
    for (const pointer of ['/definitions/Missing', '/default']) {
      const result = workspace.validateAt(pointer);
      expect(result.status).toBe('indeterminate');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'instance.schema-indeterminate', schemaPointer: pointer }));
    }
    expect(workspace.validateAt('', 'https://example.test/missing-document').status).toBe('indeterminate');
  });

  it('does not fill a missing B Allowed reference from the A shadow definition', () => {
    const b = { $schema: meta, $id: 'https://example.test/B', definitions: { Name: { type: 'string', anyOf: [ref('Allowed')] } } };
    const a = { $schema: meta, $id: 'https://example.test/A', definitions: { common: { $importdefs: b.$id }, Allowed: { type: 'string' }, Bag: { type: 'object', properties: { id: { type: 'string' } }, propertyNames: ref('common/Name') } } };
    const root = { ...header, ...ref('shared/Bag'), definitions: { shared: { $importdefs: a.$id } }, allOf: [{}] };
    const resolver = new OverlayContextResolver(root, { resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }] }), owner = resolver.resolve('/allOf/0')!;
    expect(resolver.property(owner, 'extra_good', { type: 'string' }).diagnostics).toContainEqual(expect.objectContaining({ classification: 'indeterminate', message: expect.stringContaining('propertyNames') }));
  });

  for (const operator of ['allOf', 'anyOf', 'oneOf']) it('evaluates A propertyNames -> B Name -> B Allowed under ' + operator + ', not A Allowed', () => {
    const b = { $schema: meta, $id: 'https://example.test/B', definitions: {
      Allowed: { type: 'string', pattern: '^(id|extra_[a-z]+)$' }, Name: { type: 'string', [operator]: [ref('Allowed')] }
    } };
    const a = { $schema: meta, $id: 'https://example.test/A', $root: '#/definitions/Bag', definitions: {
      common: { $importdefs: b.$id }, Allowed: { type: 'string', pattern: '^shadow_only$' },
      Bag: { type: 'object', properties: { id: { type: 'string' } }, propertyNames: ref('common/Name') }
    } };
    const root = { ...header, ...ref('shared/Bag'), definitions: { shared: { $importdefs: a.$id }, Allowed: { type: 'string', pattern: '^root_only$' } }, allOf: [{}] };
    const options = { resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }] }, before = JSON.stringify([root, a, b]);
    const resolver = new OverlayContextResolver(root, options), owner = resolver.resolve('/allOf/0')!;
    expect(resolver.property(owner, 'extra_good', { type: 'string' }).diagnostics.some(d => d.classification === 'expansion' || d.classification === 'indeterminate')).toBe(false);
    for (const name of ['shadow_only', 'root_only']) expect(resolver.property(owner, name, { type: 'string' }).diagnostics, name).toContainEqual(expect.objectContaining({ classification: 'expansion' }));
    expect(JSON.stringify([root, a, b])).toBe(before);
  });

  it('preserves B-local references inside a conditional name predicate', () => {
    const b = { $schema: meta, $id: 'https://example.test/B', definitions: { Allowed: { type: 'string', enum: ['id', 'extra_good'] }, Name: { type: 'string', if: ref('Allowed'), then: {}, else: { not: {} } } } };
    const a = { $schema: meta, $id: 'https://example.test/A', definitions: { common: { $importdefs: b.$id }, Allowed: { type: 'string', enum: ['shadow_only'] }, Bag: { type: 'object', properties: { id: { type: 'string' } }, propertyNames: ref('common/Name') } } };
    const root = { ...header, ...ref('shared/Bag'), definitions: { shared: { $importdefs: a.$id } }, allOf: [{}] };
    const resolver = new OverlayContextResolver(root, { resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }] }), owner = resolver.resolve('/allOf/0')!;
    expect(resolver.property(owner, 'extra_good', { type: 'string' }).diagnostics.some(d => d.classification === 'expansion' || d.classification === 'indeterminate')).toBe(false);
    expect(resolver.property(owner, 'shadow_only', { type: 'string' }).diagnostics).toContainEqual(expect.objectContaining({ classification: 'expansion' }));
  });

  it('evaluates every propertyNames layer in its own origin rather than one merged display schema', () => {
    const b = { $schema: meta, $id: 'https://example.test/B', definitions: {
      Allowed: { type: 'string', pattern: '^extra_[a-z]+$' }, Name: { type: 'string', allOf: [ref('Allowed')] },
      Bag: { type: 'object', properties: { extra_id: { type: 'string' } }, propertyNames: ref('Name') }
    } };
    const a = { $schema: meta, $id: 'https://example.test/A', definitions: { common: { $importdefs: b.$id }, Allowed: { type: 'string', pattern: '^shadow_only$' }, Bag: { ...ref('common/Bag'), propertyNames: { type: 'string', maxLength: 10 } } } };
    const root = { ...header, ...ref('shared/Bag'), definitions: { shared: { $importdefs: a.$id } }, allOf: [{}] };
    const resolver = new OverlayContextResolver(root, { resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }] }), owner = resolver.resolve('/allOf/0')!;
    expect(resolver.property(owner, 'extra_ok', { type: 'string' }).diagnostics.some(d => d.classification === 'expansion' || d.classification === 'indeterminate')).toBe(false);
    for (const name of ['extra_toolong', 'short']) expect(resolver.property(owner, name, { type: 'string' }).diagnostics).toContainEqual(expect.objectContaining({ classification: 'expansion' }));
  });

  it('keeps related keyNames and patternKeys runtime checks origin-aware', () => {
    const b = { $schema: meta, $id: 'https://example.test/B', definitions: { Allowed: { type: 'string', pattern: '^extra_[a-z]+$' }, Name: { type: 'string', allOf: [ref('Allowed')] }, AllowedValue: { type: 'string', minLength: 3 }, Value: { type: 'string', allOf: [ref('AllowedValue')] } } };
    const a = { $schema: meta, $id: 'https://example.test/A', definitions: { common: { $importdefs: b.$id }, Allowed: { type: 'string', pattern: '^shadow_only$' }, AllowedValue: { type: 'int32' }, Bag: { type: 'map', values: { type: 'string' }, keyNames: ref('common/Name'), patternKeys: { '^extra_': ref('common/Value') } } } };
    const root = { ...header, ...ref('shared/Bag'), definitions: { shared: { $importdefs: a.$id } } };
    const options = { resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }] };
    expect(new InstanceWorkspace(root, { extra_good: 'abc' }, options).validate().status).toBe('valid');
    expect(new InstanceWorkspace(root, { shadow_only: 'abc' }, options).validate().status).toBe('invalid');
    expect(new InstanceWorkspace(root, { extra_good: 'ab' }, options).validate().status).toBe('invalid');
  });

  it('retains patternProperties value-layer provenance without executing its display projection', () => {
    const b = { $schema: meta, $id: 'https://example.test/B', definitions: { Allowed: { type: 'string', minLength: 3 }, Value: { type: 'string', allOf: [ref('Allowed')] } } };
    const a = { $schema: meta, $id: 'https://example.test/A', definitions: { common: { $importdefs: b.$id }, Allowed: { type: 'int32' }, Bag: { type: 'object', properties: { id: { type: 'string' } }, patternProperties: { '^extra_': ref('common/Value') } } } };
    const root = { ...header, ...ref('shared/Bag'), definitions: { shared: { $importdefs: a.$id } }, allOf: [{ properties: { extra_good: { minLength: 5 } } }] };
    const resolver = new OverlayContextResolver(root, { resolvedDocuments: [{ uri: a.$id, document: a }, { uri: b.$id, document: b }] });
    const property = resolver.resolve('/allOf/0/properties/extra_good')!;
    expect(property.base.types).toEqual({ types: ['string'], determinate: true });
    expect(property.base.schema.minLength).toBe(3); expect(property.classification).toBe('narrowing');
    expect(property.base.layers.some(layer => layer.documentUri === b.$id)).toBe(true);
  });
});
