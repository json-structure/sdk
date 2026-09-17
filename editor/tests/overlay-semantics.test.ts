import { describe, expect, it } from 'vitest';
import { AddOverlayPropertyCommand, SetOverlayConstraintCommand, SetOverlayRequiredCommand, type EditorCommand } from '../src/commands.js';
import { DocumentSession } from '../src/session.js';
import { OverlayContextResolver, resolveOverlayContext } from '../src/overlay-context.js';
import { InstanceWorkspace } from '../src/phase4/instance-workspace.js';
const meta = 'https://json-structure.org/meta/validation/v0/#';
const base = { $schema: meta, $id: 'https://example.test/overlay-semantics', name: 'Bounded', type: 'int32', minimum: 10, maximum: 20 };
const session = (document: unknown) => new DocumentSession('memory://overlay-semantics', JSON.stringify(document));
const parsed = (s: DocumentSession) => JSON.parse(s.snapshot().text);
function apply(s: DocumentSession, command: EditorCommand): void {
  const context = { session: s, documentVersion: s.snapshot().documentVersion };
  expect(command.canExecute(context)).toBe(true);
  const result = command.execute(context), original = s.snapshot().text;
  s.applyTextEdits(result.edits, context.documentVersion + 1);
  const restored = [...result.inverseEdits].sort((a,b) => b.range.startOffset! - a.range.startOffset!).reduce((text, edit) => text.slice(0, edit.range.startOffset) + edit.newText + text.slice(edit.range.endOffset), s.snapshot().text);
  expect(restored).toBe(original);
}
const evaluate = (document: Record<string, unknown>, value: unknown) => new InstanceWorkspace(document, value).validate();

describe('issue #5: operator semantics and advisory compatibility', () => {
  it('models NOT as Base AND NOT Delta, separate from its positive authoring projection', () => {
    const document = { ...base, not: { minimum: 15 } };
    const context = resolveOverlayContext(document, '/not')!;
    expect(context.effective.operator).toBe('and-not');
    expect(context.effective).not.toHaveProperty('projection');
    expect(context.authoringProjection.schema.minimum).toBe(15);
    expect(context.base.schema.minimum).toBe(10);
    expect(context.diagnosticScope).toBe('operand-match');
    expect(evaluate(document, 12).status).toBe('valid');
    expect(evaluate(document, 16).status).toBe('invalid');
    expect(evaluate(document, 9).status).toBe('invalid');
    const updated = new OverlayContextResolver(document).withDelta(context, { maximum: 11 });
    expect(updated.effective.operator).toBe('and-not');
  });
  it('allows a conflicting NOT predicate: its match set is empty, but the enclosing NOT retains the base', () => {
    const s = session({ ...base, not: {} });
    apply(s, new SetOverlayConstraintCommand('/not', 'maximum', 9));
    const context = resolveOverlayContext(s.value, '/not')!;
    expect(context.classification).toBe('conflict');
    expect(context.effective.operator).toBe('and-not');
    expect(parsed(s).not).toEqual({ maximum: 9 });
    for (const value of [10, 15, 20]) expect(evaluate(parsed(s), value).status).toBe('valid');
    expect(evaluate(parsed(s), 9).status).toBe('invalid');
  });
  it('does not confuse an empty NOT operand with a no-op rule', () => {
    const document = { ...base, not: {} }, context = resolveOverlayContext(document, '/not')!;
    expect(context.classification).toBe('redundant'); // The MATCH constraints add nothing to Base.
    expect(context.effective.operator).toBe('and-not'); // The rule negates that match set.
    expect(evaluate(document, 15).status).toBe('invalid');
  });
  it('keeps IF as a predicate with exact authored paths, rather than asserting IF AND both branches', () => {
    const document = { ...base, if: { maximum: 15 }, then: { const: 13 }, else: { const: 19 } };
    const resolver = new OverlayContextResolver(document), condition = resolver.resolve('/if')!, then = resolver.resolve('/then')!, otherwise = resolver.resolve('/else')!;
    expect(condition.effective).toMatchObject({ operator: 'predicate', delta: { maximum: 15 }, then: { pointer: '/then', delta: { const: 13 } }, else: { pointer: '/else', delta: { const: 19 } } });
    expect(then.effective).toMatchObject({ operator: 'conditional-path', path: 'then', selectedWhen: 'matches', predicate: { pointer: '/if', delta: { maximum: 15 } } });
    expect(otherwise.effective).toMatchObject({ operator: 'conditional-path', path: 'else', selectedWhen: 'does-not-match', predicate: { pointer: '/if' } });
    expect(condition.base).toEqual(then.base); expect(condition.base).toEqual(otherwise.base);
    expect(evaluate(document, 13).status).toBe('valid'); expect(evaluate(document, 19).status).toBe('valid'); expect(evaluate(document, 14).status).toBe('invalid');
  });
  it('permits a predicate that conflicts with the base and selects ELSE for base-admissible inputs', () => {
    const s = session({ ...base, if: {}, then: { const: 10 }, else: { minimum: 15 } });
    apply(s, new SetOverlayConstraintCommand('/if', 'maximum', 9));
    expect(resolveOverlayContext(s.value, '/if')!.classification).toBe('conflict');
    expect(parsed(s).if).toEqual({ maximum: 9 });
    expect(evaluate(parsed(s), 16).status).toBe('valid'); expect(evaluate(parsed(s), 12).status).toBe('invalid');
    const trace = evaluate(parsed(s), 16).trace.children.find(t => t.keyword === 'if')!;
    expect(trace.children.find(t => t.schemaPointer === '/then')?.application).toBe('not-applied');
    expect(trace.children.find(t => t.schemaPointer === '/else')?.status).toBe('valid');
  });
  it('retains absent and standalone paths without synthetic IF pointers', () => {
    const condition = resolveOverlayContext({ ...base, if: {} }, '/if')!;
    expect(condition.effective).not.toHaveProperty('then'); expect(condition.effective).not.toHaveProperty('else');
    const document = { ...base, then: {} }, then = resolveOverlayContext(document, '/then')!;
    expect(then.effective).toMatchObject({ operator: 'conditional-path', path: 'then' });
    expect(then.effective).not.toHaveProperty('predicate');
    expect(evaluate(document, 15).status).toBe('indeterminate');
  });
  it('allows positive contradictory deltas too, but they fail instance evaluation rather than being rejected as schemas', () => {
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      const s = session({ ...base, [keyword]: [{}] });
      apply(s, new SetOverlayConstraintCommand('/' + keyword + '/0', 'maximum', 9));
      expect(resolveOverlayContext(s.value, '/' + keyword + '/0')!.effective.operator).toBe('and');
      expect(evaluate(parsed(s), 15).status).toBe('invalid');
      expect(s.snapshot().diagnostics.some(d => d.severity === 'error' && d.location?.pointer?.startsWith('/' + keyword))).toBe(false);
    }
  });
  it('authors attempted reopening/additions with diagnostics, never replacing the closed base or its requirements', () => {
    const s = session({ $schema: meta, type: 'object', name: 'Closed', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false, allOf: [{}] });
    apply(s, new SetOverlayConstraintCommand('/allOf/0', 'additionalProperties', true));
    apply(s, new AddOverlayPropertyCommand('/allOf/0', 'extra', { type: 'string' }));
    expect(parsed(s).additionalProperties).toBe(false); expect(parsed(s).required).toEqual(['id']);
    expect(resolveOverlayContext(s.value, '/allOf/0')!.classification).toBe('expansion');
    const resolver = new OverlayContextResolver(parsed(s)), property = resolver.resolve('/allOf/0/properties/extra')!;
    expect(resolver.withDelta(property, { type: 'string', minLength: 1 }).classification).toBe('expansion');
    expect(evaluate(parsed(s), { id: 'x' }).status).toBe('valid');
    expect(evaluate(parsed(s), { id: 'x', extra: 'y' }).status).toBe('invalid');
    apply(s, new SetOverlayRequiredCommand('/allOf/0', 'extra', true));
    expect(parsed(s).allOf[0].required).toEqual(['extra']);
    expect(evaluate(parsed(s), { id: 'x' }).status).toBe('invalid');
  });
  it('still enforces established facet value shapes, Core identifiers, source safety and immutable-base controls', () => {
    const s = session({ ...base, allOf: [{}] });
    for (const [keyword, value] of [['minimum', '9'], ['multipleOf', 0], ['minLength', 1], ['enum', []], ['enum', [10, 10]]] as const) {
      const command = new SetOverlayConstraintCommand('/allOf/0', keyword, value);
      expect(command.canExecute({ session: s, documentVersion: 1 }), keyword).toBe(false);
    }
    const object = session({ $schema: meta, type: 'object', properties: { id: { type: 'string' } }, required: ['id'], allOf: [{}] });
    expect(new AddOverlayPropertyCommand('/allOf/0', 'not-a-core-name').canExecute({ session: object, documentVersion: 1 })).toBe(false);
    expect(new SetOverlayRequiredCommand('/allOf/0', 'id', false).canExecute({ session: object, documentVersion: 1 })).toBe(false);
  });
});
