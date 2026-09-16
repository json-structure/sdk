import { describe, expect, it, vi } from 'vitest';
import { SetOverlayConstraintCommand } from '../src/commands.js';
import { OverlayContextResolver } from '../src/overlay-context.js';
import { InstanceWorkspace } from '../src/phase4/instance-workspace.js';
import { DocumentSession } from '../src/session.js';

const meta = 'https://json-structure.org/meta/validation/v0/#';
const header = { $schema: meta, $id: 'https://example.test/overlay-review', name: 'Review' };
const ref = (name: string) => ({ type: { $ref: '#/definitions/' + name } });
const evaluate = (schema: Record<string, unknown>, instance: unknown) => new InstanceWorkspace(schema, instance).validate();
function author(document: Record<string, unknown>, pointer: string, keyword: 'precision' | 'scale', value: number): Record<string, unknown> {
  const session = new DocumentSession('memory://overlay-review', JSON.stringify(document));
  const command = new SetOverlayConstraintCommand(pointer, keyword, value);
  const context = { session, documentVersion: session.snapshot().documentVersion };
  expect(command.canExecute(context)).toBe(true);
  session.applyTextEdits(command.execute(context).edits, context.documentVersion + 1);
  return JSON.parse(session.snapshot().text);
}

describe('re-review: imported constraint provenance', () => {
  it('retains imported origin when opening a schema-valued keyword delta', () => {
    const library = { $schema: meta, $id: 'https://example.test/keyword-library', definitions: { NameRule: { type: 'string', minLength: 3 }, Bag: { type: 'object', properties: { id: { type: 'string' } }, propertyNames: ref('NameRule') } } };
    const document = { ...header, ...ref('shared/Bag'), definitions: { shared: { $importdefs: library.$id }, NameRule: { type: 'int32' } }, allOf: [{ propertyNames: { minLength: 5 } }] };
    const resolver = new OverlayContextResolver(document, { resolvedDocuments: [{ uri: library.$id, document: library }] });
    const context = resolver.resolve('/allOf/0/propertyNames')!;
    expect(context.base.types).toEqual({ types: ['string'], determinate: true });
    expect(context.base.schema.minLength).toBe(3);
    expect(context.base.layers.every(layer => layer.documentUri === library.$id)).toBe(true);
    expect(context.basePointer).toBe('/definitions/Bag/propertyNames');
  });

  for (const shadow of [false, true]) it('resolves imported patternProperties refs in their source document' + (shadow ? ' despite root name shadowing' : ''), () => {
    const library = { $schema: meta, $id: 'https://example.test/pattern-library', definitions: {
      Value: { type: 'string', name: 'Value', minLength: 3 },
      Bag: { type: 'object', name: 'Bag', properties: { id: { type: 'string' } }, patternProperties: { '^extra_': ref('Value') } }
    } };
    const document = { ...header, ...ref('shared/Bag'), definitions: { shared: { $importdefs: library.$id }, ...(shadow ? { Value: { type: 'int32', name: 'Value' } } : {}) }, allOf: [{ properties: { extra_name: { minLength: 5 } } }] };
    const resolver = new OverlayContextResolver(document, { resolvedDocuments: [{ uri: library.$id, document: library }] });
    const owner = resolver.resolve('/allOf/0')!, property = resolver.resolve('/allOf/0/properties/extra_name')!;
    expect(owner.base.constraints).toContainEqual(expect.objectContaining({ keyword: 'patternProperties', documentUri: library.$id }));
    expect(property.base.types).toEqual({ types: ['string'], determinate: true });
    expect(property.base.schema.minLength).toBe(3); expect(property.classification).toBe('narrowing');
    expect(property.base.layers.every(layer => layer.documentUri === library.$id)).toBe(true);
    expect(document.allOf[0].properties.extra_name).toEqual({ minLength: 5 });
  });

  it('uses the imported document for propertyNames references and their nested predicates', () => {
    const library = { $schema: meta, $id: 'https://example.test/name-library', definitions: {
      AllowedName: { type: 'string', name: 'AllowedName', pattern: '^(id|extra_[a-z]+)$' },
      Name: { type: 'string', name: 'Name', allOf: [ref('AllowedName')] },
      Bag: { type: 'object', name: 'Bag', properties: { id: { type: 'string' } }, propertyNames: ref('Name') }
    } };
    const document = { ...header, ...ref('shared/Bag'), definitions: { shared: { $importdefs: library.$id }, Name: { type: 'string', pattern: '^wrong$' }, AllowedName: { type: 'string', pattern: '^wrong$' } }, allOf: [{}] };
    const resolver = new OverlayContextResolver(document, { resolvedDocuments: [{ uri: library.$id, document: library }] }), owner = resolver.resolve('/allOf/0')!;
    expect(resolver.property(owner, 'extra_name', { type: 'string' }).diagnostics.some(d => d.classification === 'expansion' || d.classification === 'indeterminate')).toBe(false);
    expect(resolver.property(owner, 'outside', { type: 'string' }).diagnostics).toContainEqual(expect.objectContaining({ classification: 'expansion', message: expect.stringContaining('propertyNames') }));
  });
});

describe('re-review: exact authored imported decimal locations', () => {
  it('distinguishes a direct imported source path from the same string used as an effective import prefix', () => {
    const library = { $schema: meta, $id: 'https://example.test/direct-source-library', definitions: {
      Money: { type: 'decimal', precision: 40, scale: 10 },
      Alias: { type: 'string', allOf: [{ minLength: 1 }] },
      shared: { Alias: { ...ref('Money'), allOf: [{ scale: 2 }] } },
      Dispatch: ref('shared/Alias')
    } };
    const document = { ...header, ...ref('shared/Dispatch'), definitions: { shared: { $importdefs: library.$id } } };
    const options = { resolvedDocuments: [{ uri: library.$id, document: library }] };
    expect(new InstanceWorkspace(document, '1.23', options).validate().status).toBe('valid');
    const result = new InstanceWorkspace(document, '1.234', options).validate();
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/definitions/shared/Alias/allOf/0/scale' }));
  });

  it('keeps authored origin when closure evaluates a materialized object operand', () => {
    const document = { ...header, $schema: 'https://json-structure.org/meta/relations/v0/#', $uses: ['JSONStructureConditionalComposition'], type: 'object', properties: { id: { type: 'string' } }, allOf: [{ type: 'object', identity: ['local'], properties: { local: { type: 'string' } }, additionalProperties: false }] };
    expect(evaluate(document, { id: 'x', local: 'z' })).toMatchObject({ status: 'valid', diagnostics: [] });
    const result = evaluate(document, { id: 'x', local: 'z', unknown: true });
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/allOf/0/additionalProperties', instancePointer: '/unknown' }));
  });

  for (const [keyword, limit, good, bad] of [['scale', 2, '1.23', '1.234'], ['precision', 3, '1.23', '12.34']] as const) {
    for (const collision of [false, true]) it('evaluates alias-local allOf ' + keyword + (collision ? ' despite an effective/source namespace collision' : ''), () => {
      const library = { $schema: meta, $id: 'https://example.test/alias-library', definitions: {
        Money: { type: 'decimal', name: 'Money', precision: 40, scale: 10 },
        Alias: { ...ref('Money'), allOf: [{ [keyword]: limit }] },
        ...(collision ? { shared: { Alias: { type: 'string', allOf: [{ minLength: 1 }] } } } : {})
      } };
      const document = { ...header, ...ref('shared/Alias'), definitions: { shared: { $importdefs: library.$id } } }, before = JSON.stringify(library);
      const options = { resolvedDocuments: [{ uri: library.$id, document: library }] };
      expect(new InstanceWorkspace(document, good, options).validate().status).toBe('valid');
      const result = new InstanceWorkspace(document, bad, options).validate();
      expect(result.status).toBe('invalid');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/definitions/shared/Alias/allOf/0/' + keyword, instancePointer: '' }));
      expect(result.diagnostics.some(d => d.code === 'instance.contextual-type-indeterminate')).toBe(false);
      expect(JSON.stringify(library)).toBe(before);
    });
  }

  for (const alias of [false, true]) it('maps IF/THEN/ELSE qualifier descendants on an imported ' + (alias ? 'alias' : 'literal decimal'), () => {
    const library = { $schema: meta, $id: 'https://example.test/conditional-library', definitions: {
      Money: { type: 'decimal', name: 'Money', precision: 40, scale: 10 },
      Rule: { ...(alias ? ref('Money') : { type: 'decimal', precision: 40, scale: 10 }), if: { allOf: [{ scale: 2 }] }, then: { allOf: [{ precision: 3 }] }, else: { allOf: [{ precision: 4 }] } }
    } };
    const document = { ...header, ...ref('shared/Rule'), definitions: { shared: { $importdefs: library.$id } } }, before = JSON.stringify(library);
    const options = { resolvedDocuments: [{ uri: library.$id, document: library }] };
    for (const value of ['1.23', '1.234']) expect(new InstanceWorkspace(document, value, options).validate().status, value).toBe('valid');
    for (const [value, branch] of [['12.34', 'then'], ['12.345', 'else']]) {
      const result = new InstanceWorkspace(document, value, options).validate();
      expect(result.status, value).toBe('invalid');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/definitions/shared/Rule/' + branch + '/allOf/0/precision' }));
      expect(result.diagnostics.some(d => d.code === 'instance.contextual-type-indeterminate')).toBe(false);
    }
    expect(JSON.stringify(library)).toBe(before);
  });
});

describe('re-review: additionalProperties true does not depend on projected members', () => {
  it('performs no overlay lookup for a literal true policy', () => {
    const lookup = vi.spyOn(OverlayContextResolver.prototype, 'resolve');
    try {
      expect(evaluate({ ...header, type: 'object', properties: { id: { type: 'string' } }, additionalProperties: true }, { id: 'x', extra: 42 }).status).toBe('valid');
      expect(lookup).not.toHaveBeenCalled();
    } finally { lookup.mockRestore(); }
  });
  it('keeps a no-op true delta valid when the owning recursive projection is incomplete', () => {
    const document = { ...header, ...ref('Recursive'), allOf: [{ additionalProperties: true }], definitions: { Recursive: { type: 'object', name: 'Recursive', properties: { id: { type: 'string' } }, additionalProperties: ref('Recursive'), allOf: [{ properties: { next: ref('Recursive') } }] } } };
    const result = evaluate(document, { id: 'x', other: { id: 'y' } });
    expect(result.status).toBe('valid');
    expect(result.diagnostics.some(d => d.code === 'instance.shape-indeterminate')).toBe(false);
  });
  it('preserves real unresolved-reference diagnostics without adding a shape diagnostic for true', () => {
    const document = { ...header, type: 'object', properties: { id: { type: 'string' } }, allOf: [{ ...ref('Missing'), additionalProperties: true }] };
    const result = evaluate(document, { id: 'x', extra: 42 });
    expect(result.status).toBe('indeterminate');
    expect(result.diagnostics.map(d => d.code)).toEqual(['instance.ref-unresolved']);
  });
  for (const policy of [false, { type: 'string' }] as const) it('still needs a known member set for ' + JSON.stringify(policy), () => {
    const document = { ...header, type: 'object', properties: { id: { type: 'string' } }, allOf: [{ ...ref('Missing'), additionalProperties: policy }] };
    const result = evaluate(document, { id: 'x', extra: 42 });
    expect(result.status).toBe('indeterminate');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'instance.shape-indeterminate', schemaPointer: '/allOf/0/additionalProperties' }));
  });
  it('reports malformed policies separately instead of pretending they are no-op true policies', () => {
    const result = evaluate({ ...header, type: 'object', properties: { id: { type: 'string' } }, allOf: [{ additionalProperties: 'true' }] }, { id: 'x', extra: 42 });
    expect(result.status).toBe('indeterminate');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'instance.schema-indeterminate', schemaPointer: '/allOf/0/additionalProperties' }));
    expect(result.diagnostics.some(d => d.code === 'instance.shape-indeterminate')).toBe(false);
  });
});

describe('review: bounded additional-property/reference projection', () => {
  it('bounds acyclic repeated-reference expansion without restarting its shared work budget', () => {
    const definitions: Record<string, unknown> = { Leaf: { type: 'string', name: 'Leaf' } };
    for (let index = 15; index >= 0; index--) {
      const next = index === 15 ? 'Leaf' : 'Level' + (index + 1);
      definitions['Level' + index] = { type: 'string', name: 'Level' + index, allOf: [ref(next), ref(next)] };
    }
    const document = { ...header, ...ref('Level0'), allOf: [{}], definitions }, before = JSON.stringify(document);
    const context = new OverlayContextResolver(document).resolve('/allOf/0')!;
    expect(context.classification).toBe('indeterminate'); expect(context.authorable).toBe(false);
    expect(context.diagnostics).toContainEqual(expect.objectContaining({ classification: 'indeterminate', message: expect.stringMatching(/budget/i) }));
    expect(JSON.stringify(document)).toBe(before);
  });

  it('returns indeterminate for a recursive additional-property layer used by an ALL member', () => {
    const document = { ...header, ...ref('Recursive'), allOf: [{}], definitions: { Recursive: { type: 'object', name: 'Recursive', properties: { id: { type: 'string' } }, additionalProperties: ref('Recursive'), allOf: [{ properties: { next: ref('Recursive') } }] } } };
    const before = JSON.stringify(document), resolver = new OverlayContextResolver(document);
    const context = resolver.resolve('/allOf/0')!;
    expect(context.classification).toBe('indeterminate'); expect(context.authorable).toBe(false);
    expect(context.diagnostics).toContainEqual(expect.objectContaining({ classification: 'indeterminate', message: expect.stringMatching(/cycle|budget/i) }));
    expect(resolver.resolve('/allOf/0')).toBe(context); expect(JSON.stringify(document)).toBe(before);
  });
  it('carries cycle tracking through an alias that adds members to its additional-property base', () => {
    const document = { ...header, ...ref('Alias'), allOf: [{}], definitions: {
      Base: { type: 'object', name: 'Base', properties: { id: { type: 'string' } }, additionalProperties: ref('Alias') },
      Alias: { ...ref('Base'), properties: { extra: { type: 'string' } } }
    } };
    const context = new OverlayContextResolver(document).resolve('/allOf/0')!;
    expect(context.classification).toBe('indeterminate'); expect(context.authoringProjection.types.determinate).toBe(false);
  });
  it('does not mistake independent uses of a reusable schema for a cycle', () => {
    const document = { ...header, type: 'string', allOf: [{}], anyOf: [ref('Text'), ref('Text')], definitions: { Text: { type: 'string', minLength: 1 } } };
    const resolver = new OverlayContextResolver(document);
    expect(resolver.resolve('/anyOf/0')!.determinate).toBe(true); expect(resolver.resolve('/anyOf/1')!.determinate).toBe(true);
  });
});

describe('review: typeless decimal qualifiers use their inherited type', () => {
  for (const [keyword, good, bad] of [['precision', '1.23', '12.34'], ['scale', '12.34', '1.234']] as const) {
    it('evaluates a command-authored ' + keyword + ' delta without serializing type', () => {
      const document = author({ ...header, type: 'decimal', precision: 12, scale: 8, allOf: [{}] }, '/allOf/0', keyword, keyword === 'precision' ? 3 : 2);
      expect(document.allOf).toEqual([{ [keyword]: keyword === 'precision' ? 3 : 2 }]); expect(document.type).toBe('decimal');
      expect(evaluate(document, good).status).toBe('valid');
      const result = evaluate(document, bad); expect(result.status).toBe('invalid');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/allOf/0/' + keyword, instancePointer: '' }));
    });
  }
  for (const [keyword, limit, outside] of [['precision', 3, '12.34'], ['scale', 2, '1.234']] as const) {
    it('evaluates ' + keyword + ' in NOT and IF predicates without asserting the excluded/conditional match', () => {
      const base = { ...header, type: 'decimal', precision: 12, scale: 8 };
      const not = author({ ...base, not: {} }, '/not', keyword, limit);
      expect(not.not).toEqual({ [keyword]: limit }); expect(evaluate(not, outside).status).toBe('valid'); expect(evaluate(not, '1.23').status).toBe('invalid');
      const conditional = author({ ...base, if: {}, then: { const: '1.23' }, else: { const: outside } }, '/if', keyword, limit);
      expect(conditional.if).toEqual({ [keyword]: limit }); expect(evaluate(conditional, '1.23').status).toBe('valid');
      const result = evaluate(conditional, outside); expect(result.status).toBe('valid');
      const trace = result.trace.children.find(entry => entry.keyword === 'if')!;
      expect(trace.children.find(entry => entry.schemaPointer === '/if')?.status).toBe('invalid');
      expect(trace.children.find(entry => entry.schemaPointer === '/then')?.application).toBe('not-applied');
      expect(trace.children.find(entry => entry.schemaPointer === '/else')?.status).toBe('valid');
    });
  }
  it('applies decimal qualifiers only on the selected THEN/ELSE path', () => {
    const document = { ...header, type: 'decimal', precision: 12, scale: 8, if: { maximum: '10.0' }, then: { precision: 3 }, else: { scale: 1 } };
    expect(evaluate(document, '1.23').status).toBe('valid'); expect(evaluate(document, '12.3').status).toBe('valid');
    expect(evaluate(document, '1.234').diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/then/precision' }));
    expect(evaluate(document, '12.34').diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/else/scale' }));
    expect(document.then).toEqual({ precision: 3 }); expect(document.else).toEqual({ scale: 1 });
  });
  it('inherits the other decimal parameter through a property reference and retains independent base limits', () => {
    const document = { ...header, type: 'object', properties: { amount: ref('Money') }, required: ['amount'], definitions: { Money: { type: 'decimal', name: 'Money', precision: 40, scale: 10 } }, allOf: [{ properties: { amount: { scale: 2 } } }] };
    expect(evaluate(document, { amount: '12345678901234567890123456789012345678.12' }).status).toBe('valid');
    const result = evaluate(document, { amount: '1.234' }); expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/allOf/0/properties/amount/scale', instancePointer: '/amount' }));
    expect(document.allOf[0].properties.amount).toEqual({ scale: 2 });
    expect(evaluate({ ...header, type: 'decimal', scale: 2, allOf: [{ scale: 4 }] }, '1.234').status).toBe('invalid');
  });

  it('preserves independently constrained decimal aliases and checks Core qualifiers without Validation activation', () => {
    const document = {
      ...header, $schema: 'https://json-structure.org/meta/extended/v0/#', $uses: ['JSONStructureConditionalComposition'], ...ref('Alias'),
      definitions: { Money: { type: 'decimal', name: 'Money', precision: 40, scale: 10 }, Alias: { ...ref('Money'), scale: 2 } },
      allOf: [{ scale: 4 }]
    };
    expect(evaluate(document, '12345678901234567890123456789012345678.12').status).toBe('valid');
    const result = evaluate(document, '1.234'); expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/definitions/Alias/scale' }));
  });

  it('resolves typeless qualifiers in imported decimal branches while retaining effective trace pointers', () => {
    const external = { $schema: meta, $id: 'https://example.test/decimal-library', definitions: { Money: { type: 'decimal', name: 'Money', precision: 40, scale: 10, allOf: [{ scale: 2 }] } } };
    const document = { ...header, ...ref('shared/Money'), definitions: { shared: { $importdefs: external.$id } } };
    const options = { resolvedDocuments: [{ uri: external.$id, document: external }] };
    expect(new InstanceWorkspace(document, '12345678901234567890123456789012345678.12', options).validate().status).toBe('valid');
    const result = new InstanceWorkspace(document, '1.234', options).validate();
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/definitions/shared/Money/allOf/0/scale' }));
    expect(external.definitions.Money.allOf[0]).toEqual({ scale: 2 });
  });

  it('surfaces indeterminate type/parameter input instead of silently ignoring qualifiers', () => {
    expect(evaluate({ ...header, allOf: [{ precision: 2 }] }, '1.23').status).toBe('indeterminate');
    const malformed = evaluate({ ...header, type: 'decimal', allOf: [{ scale: 'not-a-number' }] }, '1.23');
    expect(malformed.status).toBe('indeterminate');
    expect(malformed.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/allOf/0/scale', severity: 'indeterminate' }));
  });
});

describe('review: local closure includes reference-contributed operand members', () => {
  const document = (baseClosed = false, referencedClosed = false) => ({
    ...header, type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: !baseClosed,
    definitions: { Alias: ref('Extra'), Extra: { type: 'object', name: 'Extra', properties: { extra: { type: 'string' } }, additionalProperties: !referencedClosed } },
    allOf: [{ ...ref('Alias'), additionalProperties: false }]
  });
  it('allows declared base and canonical-reference members, but still rejects unrelated properties', () => {
    const schema = document(), before = JSON.stringify(schema);
    expect(evaluate(schema, { id: 'x', extra: 'y' }).status).toBe('valid');
    const result = evaluate(schema, { id: 'x', extra: 'y', unrelated: true }); expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/allOf/0/additionalProperties', instancePointer: '/unrelated' }));
    expect(JSON.stringify(schema)).toBe(before);
  });
  it('does not let reference contributions reopen an independently closed owning base', () => {
    const result = evaluate(document(true), { id: 'x', extra: 'y' }); expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/additionalProperties', instancePointer: '/extra' }));
  });
  it('does not let inherited members reopen an independently closed referenced schema', () => {
    const result = evaluate(document(false, true), { id: 'x', extra: 'y' }); expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/definitions/Extra/additionalProperties', instancePointer: '/id' }));
  });

  it('retains indeterminate closure when a reference-contributed shape cannot be resolved', () => {
    const schema = { ...header, type: 'object', properties: { id: { type: 'string' } }, allOf: [{ ...ref('Missing'), additionalProperties: false }] };
    const result = evaluate(schema, { id: 'x', unknown: 'y' });
    expect(result.status).toBe('indeterminate');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'instance.shape-indeterminate', schemaPointer: '/allOf/0/additionalProperties' }));
  });
});
