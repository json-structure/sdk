import { describe, expect, it } from 'vitest';
import { AddOverlayPropertyCommand, SetOverlayConstraintCommand, SetOverlayRequiredCommand, type EditorCommand } from '../src/commands.js';
import { DocumentSession } from '../src/session.js';
import { OverlayContextResolver, resolveOverlayContext } from '../src/overlay-context.js';
import { InstanceWorkspace } from '../src/phase4/instance-workspace.js';
import { actionAvailability } from '../src/ui/action-runtime.js';
import { actionById } from '../src/ui/actions.js';
const meta = 'https://json-structure.org/meta/validation/v0/#';
const object = (extra: Record<string, unknown> = {}) => ({ $schema: meta, $id: 'https://example.test/Account', type: 'object', name: 'Account', properties: { id: { type: 'uuid' }, age: { type: 'int32', minimum: 0, maximum: 120 }, title: { type: 'string', minLength: 2, maxLength: 40 } }, required: ['id'], additionalProperties: true, allOf: [{}], ...extra });
function session(value: unknown): DocumentSession { return new DocumentSession('memory://overlay', JSON.stringify(value)); }
function apply(s: DocumentSession, command: EditorCommand): void {
  const context = { session: s, documentVersion: s.snapshot().documentVersion };
  expect(command.canExecute(context)).toBe(true);
  const result = command.execute(context), before = s.snapshot().text;
  s.applyTextEdits(result.edits, context.documentVersion + 1);
  const restored = [...result.inverseEdits].sort((a, b) => b.range.startOffset! - a.range.startOffset!).reduce((text, edit) => text.slice(0, edit.range.startOffset) + edit.newText + text.slice(edit.range.endOffset), s.snapshot().text);
  expect(restored).toBe(before);
}
const current = (s: DocumentSession) => JSON.parse(s.snapshot().text);

describe('production contextual overlay projections and commands', () => {
  it('resolves effective inherited members, aliases, required state and active facets without changing source', () => {
    const document = object({ $extends: '#/definitions/Entity', definitions: { Entity: { type: 'object', abstract: true, name: 'Entity', properties: { code: { type: 'string', minLength: 3 } }, required: ['code'], maxProperties: 10 } } });
    const before = JSON.stringify(document), context = resolveOverlayContext(document, '/allOf/0')!;
    expect(context.basePointer).toBe(''); expect(context.ownerPointer).toBe(''); expect(context.determinate).toBe(true);
    expect(Object.keys(context.base.properties)).toEqual(['code', 'id', 'age', 'title']);
    expect(context.base.required).toEqual(expect.arrayContaining(['code', 'id']));
    expect(context.base.properties.code.layers[0].pointer).toBe('/definitions/Entity/properties/code');
    expect(context.base.constraints).toContainEqual(expect.objectContaining({ keyword: 'maxProperties', value: 10 }));
    expect(context.effective.operator).toBe('and'); expect(context.delta).toEqual({});
    expect(context.operations.changeBase.enabled).toBe(false); expect(JSON.stringify(document)).toBe(before);
  });
  it('constrains an inherited primitive recursively without copying its type or shape', () => {
    const s = session(object()); apply(s, new AddOverlayPropertyCommand('/allOf/0', 'age'));
    apply(s, new SetOverlayConstraintCommand('/allOf/0/properties/age', 'minimum', 18));
    expect(current(s).allOf[0]).toEqual({ properties: { age: { minimum: 18 } } });
    expect(current(s).properties.age).toEqual({ type: 'int32', minimum: 0, maximum: 120 });
    const context = resolveOverlayContext(s.value, '/allOf/0/properties/age')!;
    expect(context.basePointer).toBe('/properties/age'); expect(context.authoringProjection.schema.minimum).toBe(18);
    expect(context.authoringProjection.schema.maximum).toBe(120); expect(context.classification).toBe('narrowing');
    expect(s.snapshot().diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(new InstanceWorkspace(current(s), { id, age: 19 }).validate().status).toBe('valid');
    expect(new InstanceWorkspace(current(s), { id, age: 17 }).validate().status).toBe('invalid');
  });
  it('adds a required property to an open object, storing only the added requirement', () => {
    const s = session(object()); apply(s, new AddOverlayPropertyCommand('/allOf/0', 'note', { type: 'string' }));
    apply(s, new SetOverlayRequiredCommand('/allOf/0', 'note', true));
    apply(s, new SetOverlayConstraintCommand('/allOf/0/properties/note', 'minLength', 1));
    expect(current(s).allOf[0]).toEqual({ properties: { note: { type: 'string', minLength: 1 } }, required: ['note'] });
    expect(resolveOverlayContext(s.value, '/allOf/0')!.authoringProjection.required).toEqual(['id', 'note']);
    apply(s, new SetOverlayRequiredCommand('/allOf/0', 'note', false));
    expect(current(s).allOf[0]).not.toHaveProperty('required'); expect(current(s).required).toEqual(['id']);
  });
  it('authors closed-base property deltas with advisory expansion diagnostics and no base mutation', () => {
    const s = session(object({ additionalProperties: false }));
    const command = new AddOverlayPropertyCommand('/allOf/0', 'extra', { type: 'string' });
    apply(s, command);
    expect(current(s).allOf[0].properties.extra).toEqual({ type: 'string' });
    expect(current(s).additionalProperties).toBe(false);
    expect(resolveOverlayContext(s.value, '/allOf/0')!.classification).toBe('expansion');
    const document = object({ additionalProperties: false, allOf: [{ properties: { extra: { type: 'string' } } }] });
    const before = JSON.stringify(document), overlay = resolveOverlayContext(document, '/allOf/0')!;
    expect(overlay.classification).toBe('expansion');
    expect(overlay.diagnostics).toContainEqual(expect.objectContaining({ pointer: '/allOf/0/properties/extra', classification: 'expansion' }));
    expect(JSON.stringify(document)).toBe(before);
  });
  it('keeps inherited additional-property schemas active while diagnosing incompatible source additions', () => {
    const s = session(object({ additionalProperties: { type: 'string', minLength: 3 } }));
    apply(s, new AddOverlayPropertyCommand('/allOf/0', 'count', { type: 'int32' }));
    expect(resolveOverlayContext(s.value, '/allOf/0')!.classification).toBe('conflict');
    apply(s, new AddOverlayPropertyCommand('/allOf/0', 'note'));
    apply(s, new SetOverlayConstraintCommand('/allOf/0/properties/note', 'minLength', 5));
    expect(current(s).allOf[0].properties.note).toEqual({ minLength: 5 });
    expect(resolveOverlayContext(s.value, '/allOf/0/properties/note')!.base.schema.minLength).toBe(3);
  });
  it('cannot remove base requirements and never interprets missing delta names as removal', () => {
    const s = session(object());
    const command = new SetOverlayRequiredCommand('/allOf/0', 'id', false);
    expect(command.canExecute({ session: s, documentVersion: 1 })).toBe(false);
    expect(command.reason({ session: s, documentVersion: 1 })).toContain('implicitly required');
    expect(resolveOverlayContext(s.value, '/allOf/0')!.authoringProjection.required).toEqual(['id']);
    apply(s, new SetOverlayRequiredCommand('/allOf/0', 'title', true));
    expect(current(s).allOf[0].required).toEqual(['title']);
  });
  it('classifies weaker, redundant, contradictory, and attempted expansion without normalization', () => {
    const document = { $schema: meta, type: 'int32', minimum: 10, maximum: 20, anyOf: [{ minimum: 5 }, { minimum: 10 }, { maximum: 9 }, { type: 'any' }, { type: 'string' }] };
    const resolver = new OverlayContextResolver(document);
    expect([0, 1, 2, 3, 4].map(i => resolver.resolve('/anyOf/' + i)!.classification)).toEqual(['redundant', 'redundant', 'conflict', 'expansion', 'conflict']);
    expect(resolver.resolve('/anyOf/0')!.authoringProjection.schema.minimum).toBe(10);
    expect(document.anyOf[0]).toEqual({ minimum: 5 });
    const s = session({ ...document, anyOf: [{}] });
    const contradiction = new SetOverlayConstraintCommand('/anyOf/0', 'maximum', 9);
    apply(s, contradiction);
    expect(current(s).anyOf[0]).toEqual({ maximum: 9 });
    expect(resolveOverlayContext(s.value, '/anyOf/0')!.classification).toBe('conflict');
    apply(s, new SetOverlayConstraintCommand('/anyOf/0', 'minimum', 5));
    expect(current(s).anyOf[0]).toEqual({ maximum: 9, minimum: 5 });
  });
  it('uses exact wire-number comparisons for string-backed numeric bounds', () => {
    const document = { $schema: meta, type: 'int64', minimum: '9007199254740992', maximum: '9007199254741000', allOf: [{ maximum: '9007199254740991' }] };
    expect(resolveOverlayContext(document, '/allOf/0')!.classification).toBe('conflict');
  });
  it('gives every ANY candidate the same immutable base and independent delta', () => {
    const document = object({ anyOf: [{ properties: { age: { minimum: 21 } } }, { properties: { title: { minLength: 5 } } }], allOf: undefined });
    const resolver = new OverlayContextResolver(document), a = resolver.resolve('/anyOf/0')!, b = resolver.resolve('/anyOf/1')!;
    expect(a.base).toEqual(b.base); expect(a.delta).not.toEqual(b.delta);
    expect(a.base.schema).not.toHaveProperty('anyOf');
    expect(a.authoringProjection.schema.properties).not.toEqual(b.authoringProjection.schema.properties);
    expect(resolver.resolve('/anyOf/1/properties/title')!.base.schema.minLength).toBe(2);
  });
  it('gives IF, THEN and ELSE the owning base, not one another or synthetic conditions', () => {
    const document = object({ if: { properties: { age: { minimum: 18 } } }, then: { required: ['title'] }, else: {} });
    const resolver = new OverlayContextResolver(document), condition = resolver.resolve('/if')!;
    for (const keyword of ['then', 'else']) expect(resolver.resolve('/' + keyword)!.base).toEqual(condition.base);
    expect(condition.base.schema).not.toHaveProperty('then'); expect(condition.base.schema).not.toHaveProperty('if');
    expect(resolveOverlayContext(object({ then: {} }), '/then')!.basePointer).toBe('');
  });
  it('recursively retains nested object and nested-rule base constraints', () => {
    const s = session(object({ properties: { address: { type: 'object', name: 'Address', properties: { city: { type: 'string', minLength: 2 } }, required: ['city'] } } }));
    apply(s, new AddOverlayPropertyCommand('/allOf/0', 'address')); apply(s, new AddOverlayPropertyCommand('/allOf/0/properties/address', 'city'));
    apply(s, new SetOverlayConstraintCommand('/allOf/0/properties/address/properties/city', 'minLength', 3));
    expect(current(s).allOf[0]).toEqual({ properties: { address: { properties: { city: { minLength: 3 } } } } });
    const document = { $schema: meta, type: 'string', minLength: 2, allOf: [{ minLength: 5, anyOf: [{ maxLength: 8 }, { maxLength: 9 }] }] };
    const nested = resolveOverlayContext(document, '/allOf/0/anyOf/0')!;
    expect(nested.base.schema.minLength).toBe(5); expect(nested.ownerPointer).toBe('/allOf/0');
  });
  it('reuses actionAvailability and effectiveValidationTypes through local and imported references', () => {
    const document = object({ properties: { age: { type: { $ref: '#/definitions/Age' } } }, definitions: { Age: { type: 'int32', name: 'Age', minimum: 1 } }, allOf: [{ properties: { age: {} } }] });
    const resolver = new OverlayContextResolver(document), context = resolver.resolve('/allOf/0/properties/age')!, projected = resolver.applicabilityDocument(context);
    expect(context.base.references).toEqual(['#/definitions/Age']);
    expect(actionAvailability(actionById('validation.minimum')!, context.pointer, projected).enabled).toBe(true);
    expect(actionAvailability(actionById('validation.pattern')!, context.pointer, projected).enabled).toBe(false);
    const unresolved = resolveOverlayContext({ $schema: meta, type: { $ref: '#/definitions/Missing' }, allOf: [{}] }, '/allOf/0')!;
    expect(unresolved.authorable).toBe(false); expect(unresolved.reason).toContain('Unresolved');
  });
  it('leaves indeterminate, legacy and malformed operands visible and never treats payload data as a context', () => {
    const document = { $schema: meta, allOf: [{ type: 'string' }, 7, { $ref: '#/definitions/A' }], definitions: { A: { type: 'string' } }, default: { type: 'string', allOf: [{}] } };
    expect(resolveOverlayContext(document, '/allOf/0')!.authorable).toBe(false);
    expect(resolveOverlayContext(document, '/allOf/1')!.delta).toBe(7);
    expect(resolveOverlayContext(document, '/allOf/2')!.delta).toEqual({ $ref: '#/definitions/A' });
    expect(resolveOverlayContext(document, '/default/allOf/0')).toBeUndefined();
  });
  it('classifies inclusive/exclusive and finite const/enum constraints using Validate semantics', () => {
    for (const [baseSchema, delta, expected] of [
      [{ type: 'int32', exclusiveMinimum: 10 }, { minimum: 10 }, 'redundant'],
      [{ type: 'int32', minimum: 10 }, { exclusiveMaximum: 10 }, 'conflict'],
      [{ type: 'string', const: 'abc' }, { maxLength: 2 }, 'conflict'],
      [{ type: 'string', enum: ['abc', 'def'] }, { minLength: 2 }, 'redundant'],
      [{ type: 'int32', minimum: 10 }, { const: 5 }, 'conflict'],
      [{ type: 'string', enum: ['a', 'b'] }, { enum: ['a', 'b', 'c'] }, 'redundant'],
      [{ type: 'int32' }, { type: 'int8' }, 'narrowing'],
      [{ type: 'int8' }, { type: 'int32' }, 'expansion'],
      [{ type: 'string' }, { enum: [] }, 'conflict'],
    ] as const) {
      const context = resolveOverlayContext({ $schema: meta, ...baseSchema, allOf: [delta] }, '/allOf/0')!;
      expect(context.classification, JSON.stringify({ baseSchema, delta })).toBe(expected);
    }
  });
  it('retains the stronger inherited property projection even for authored weaker or incompatible deltas', () => {
    const context = resolveOverlayContext(object({ allOf: [{ properties: { age: { minimum: -10 }, title: { type: 'int32' } } }] }), '/allOf/0')!;
    expect(context.authoringProjection.properties.age.schema.minimum).toBe(0);
    expect(context.authoringProjection.properties.title.schema.type).toBe('string');
  });
  it('respects active companions and preserves inactive facet source instead of treating it as a base constraint', () => {
    const document = { $schema: 'https://json-structure.org/meta/extended/v0/#', $uses: ['JSONStructureConditionalComposition'], type: 'string', minLength: 10, maxLength: 20, allOf: [{ minLength: 12 }] };
    const context = resolveOverlayContext(document, '/allOf/0')!;
    expect(context.base.constraints.some(c => c.keyword === 'minLength')).toBe(false);
    expect(context.base.constraints.some(c => c.keyword === 'maxLength')).toBe(true);
    expect(context.classification).toBe('redundant'); expect(context.delta).toEqual({ minLength: 12 });
    const s = session(document), command = new SetOverlayConstraintCommand('/allOf/0', 'minLength', 14);
    expect(command.canExecute({ session: s, documentVersion: 1 })).toBe(false); expect(command.reason({ session: s, documentVersion: 1 })).toContain('Activate');
  });
  it('diagnoses matching pattern-property incompatibility without prohibiting authoring', () => {
    const s = session(object({ patternProperties: { '^extra_': { type: 'string', minLength: 2 } } }));
    const invalid = new AddOverlayPropertyCommand('/allOf/0', 'extra_count', { type: 'int32' });
    apply(s, invalid);
    expect(resolveOverlayContext(s.value, '/allOf/0')!.diagnostics).toContainEqual(expect.objectContaining({ classification: 'conflict', pointer: '/allOf/0/properties/extra_count/type' }));
    apply(s, new AddOverlayPropertyCommand('/allOf/0', 'extra_note'));
    expect(resolveOverlayContext(s.value, '/allOf/0/properties/extra_note')!.base.schema.minLength).toBe(2);
  });
  it('resolves array/set items, map values, tuple members and choice alternatives without enabling structural widening', () => {
    for (const kind of ['array', 'set', 'map']) {
      const keyword = kind === 'map' ? 'values' : 'items';
      const document = { $schema: meta, type: kind, [keyword]: { type: 'int32', minimum: 1 }, allOf: [{ [keyword]: { minimum: 5 }, allOf: [{ [keyword]: { maximum: 10 } }] }] };
      const context = resolveOverlayContext(document, '/allOf/0/allOf/0/' + keyword)!;
      expect(context.base.types.types).toEqual(['int32']); expect(context.base.schema.minimum).toBe(5);
      expect(context.authoringProjection.schema.maximum).toBe(10); expect(context.operations.addProperty.enabled).toBe(false);
    }
    const tuple = resolveOverlayContext({ $schema: meta, type: 'tuple', tuple: ['x'], properties: { x: { type: 'double' } }, allOf: [{ properties: { x: { minimum: 0 } } }] }, '/allOf/0')!;
    expect(tuple.base.tuple).toEqual(['x']); expect(tuple.base.required).toEqual(['x']);
    const choice = resolveOverlayContext({ $schema: meta, type: 'choice', choices: { text: { type: 'string' } }, allOf: [{ choices: { text: { maxLength: 5 } } }] }, '/allOf/0/choices/text')!;
    expect(choice.base.types.types).toEqual(['string']);
  });
  it('keeps added fields with prototype-like names and escaped inherited pointers safe and exact', () => {
    const s = session(object({ properties: { 'a/b~c': { type: 'string', maxLength: 20 } } }));
    apply(s, new AddOverlayPropertyCommand('/allOf/0', 'a/b~c'));
    apply(s, new SetOverlayConstraintCommand('/allOf/0/properties/a~1b~0c', 'maxLength', 10));
    expect(current(s).allOf[0].properties['a/b~c']).toEqual({ maxLength: 10 });
    for (const name of ['constructor', '__proto__', 'toString']) {
      apply(s, new AddOverlayPropertyCommand('/allOf/0', name, { type: 'string' }));
      apply(s, new SetOverlayRequiredCommand('/allOf/0', name, true));
    }
    expect(Object.keys(resolveOverlayContext(s.value, '/allOf/0')!.authoringProjection.properties)).toEqual(expect.arrayContaining(['constructor', '__proto__', 'toString']));
  });
  it('resolves imported alias constraints and offered add-in member requirements through shared infrastructure', () => {
    const external = { $schema: meta, $id: 'https://example.test/common', definitions: { Text: { type: 'string', name: 'Text', minLength: 3 } } };
    const document = object({ definitions: { shared: { $importdefs: external.$id } }, properties: { title: { type: { $ref: '#/definitions/shared/Text' } } }, allOf: [{ properties: { title: { minLength: 5 } } }] });
    const context = resolveOverlayContext(document, '/allOf/0/properties/title', { resolvedDocuments: [{ uri: external.$id, document: external }] })!;
    expect(context.base.types.types).toEqual(['string']); expect(context.base.schema.minLength).toBe(3); expect(context.classification).toBe('narrowing');
    const s = session({ $schema: meta, $offers: { Audited: '#/definitions/Audited' }, definitions: { Document: { type: 'object', name: 'Document', properties: { title: { type: 'string' } }, allOf: [{}] }, Audited: { type: 'object', name: 'Audited', abstract: true, $extends: '#/definitions/Document', properties: { author: { type: 'string' } }, required: ['author'] } } });
    const owner = '/definitions/Document/allOf/0';
    const overlay = resolveOverlayContext(s.value, owner, { addIns: ['Audited'] })!;
    expect(overlay.base.required).toContain('author');
    apply(s, new AddOverlayPropertyCommand(owner, 'author', {}, ['Audited']));
    expect(new SetOverlayRequiredCommand(owner, 'author', false, ['Audited']).canExecute({ session: s, documentVersion: s.snapshot().documentVersion })).toBe(false);
  });
  it('applies branch-local closure to the inherited effective object shape and preserves Validate trace pointers', () => {
    const document = { $schema: meta, type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: true, allOf: [{ additionalProperties: false }] };
    expect(new InstanceWorkspace(document, { id: 'x' }).validate().status).toBe('valid');
    const result = new InstanceWorkspace(document, { id: 'x', extra: true }).validate();
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ schemaPointer: '/allOf/0/additionalProperties', instancePointer: '/extra' }));
  });

  it('diagnoses property-name incompatibility without prohibiting source authoring', () => {
    const s = session(object({ propertyNames: { type: 'string', pattern: '^(id|age|title|extra_.*)$' } }));
    const command = new AddOverlayPropertyCommand('/allOf/0', 'outside', { type: 'string' });
    apply(s, command);
    expect(resolveOverlayContext(s.value, '/allOf/0')!.diagnostics).toContainEqual(expect.objectContaining({ classification: 'expansion', pointer: '/allOf/0/properties/outside' }));
    apply(s, new AddOverlayPropertyCommand('/allOf/0', 'extra_note', { type: 'string' }));
    expect(resolveOverlayContext(object({ propertyNames: { type: 'string', enum: ['id'] }, allOf: [{ properties: { extra: { type: 'string' } } }] }), '/allOf/0')!.diagnostics).toContainEqual(expect.objectContaining({ classification: 'expansion', pointer: '/allOf/0/properties/extra' }));
  });
  it('diagnoses impossible property and required-size combinations without inventing validity bans', () => {
    const s = session(object({ maxProperties: 1 }));
    apply(s, new AddOverlayPropertyCommand('/allOf/0', 'extra', { type: 'string' }));
    const requireTitle = new SetOverlayRequiredCommand('/allOf/0', 'title', true);
    apply(s, requireTitle);
    expect(resolveOverlayContext(s.value, '/allOf/0')!.diagnostics).toContainEqual(expect.objectContaining({ classification: 'conflict', pointer: '/allOf/0/required' }));
    expect(current(s).required).toEqual(['id']);
  });

});
