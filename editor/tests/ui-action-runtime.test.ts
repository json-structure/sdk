import { describe, expect, it } from 'vitest';
import { actionById } from '../src/ui/actions.js';
import { actionAvailability, catalogFamilyForAction, parseActionValue, valueAtPointer } from '../src/ui/action-runtime.js';

describe('action runtime', () => {
  it('routes document actions to the root and explains inactive capabilities', () => {
    expect(actionAvailability(actionById('core.schema')!, '/definitions/Person', {}).pointer).toBe('');
    expect(actionAvailability(actionById('units.unit')!, '', { type: 'number' })).toEqual({
      enabled: false, pointer: '', reason: 'Activate JSONStructureUnits in $uses to use this command.'
    });
  });

  it('hides removal preconditions in metadata without executing commands', () => {
    const action = actionById('core.scale.remove')!;
    expect(actionAvailability(action, '', { type: 'decimal' }).enabled).toBe(false);
    expect(actionAvailability(action, '', { type: 'decimal', scale: 2 }).enabled).toBe(true);
  });

  it('does not offer invariant-breaking type or required shape removal actions', () => {
    expect(actionById('core.type.remove')).toBeUndefined();
    expect(actionById('core.choice.remove')).toBeUndefined();
    for (const [actionId, document] of [
      ['core.properties.remove', { type: 'object', properties: {} }],
      ['core.items.remove', { type: 'array', items: { type: 'string' } }],
      ['core.items.remove', { type: 'set', items: { type: 'string' } }],
      ['core.values.remove', { type: 'map', values: { type: 'string' } }],
      ['core.properties.remove', { type: 'tuple', properties: {}, tuple: [] }],
      ['core.tuple.remove', { type: 'tuple', properties: {}, tuple: [] }],
      ['core.choices.remove', { type: 'choice', choices: { text: { type: 'string' } } }],
    ] as const) {
      expect(actionAvailability(actionById(actionId)!, '', document), actionId).toMatchObject({ enabled: false });
    }
  });

  it('keeps mandatory document headers out of the removal surface', () => {
    const document = { $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'urn:test', name: 'Test' };
    for (const keyword of ['$schema', '$id', 'name']) {
      const action = actionById(`core.${keyword === '$schema' ? 'schema' : keyword === '$id' ? 'id' : keyword}.remove`)!;
      expect(actionAvailability(action, '', document)).toMatchObject({ enabled: false, pointer: '' });
    }
  });
  it('converts typed values and rejects invalid constrained numbers', () => {
    expect(parseActionValue(actionById('core.abstract')!, '', true)).toBe(true);
    expect(parseActionValue(actionById('core.precision')!, '12')).toBe(12);
    expect(parseActionValue(actionById('validation.minimum')!, '9007199254740993', false, 'int128')).toBe('9007199254740993');
    expect(parseActionValue(actionById('validation.multipleOf')!, '0.0100', false, 'decimal')).toBe('0.0100');
    expect(parseActionValue(actionById('validation.minimum')!, '12', false, 'int32')).toBe(12);
    expect(parseActionValue(actionById('core.required')!, '["name"]')).toEqual(['name']);
    expect(() => parseActionValue(actionById('core.precision')!, '-1')).toThrow('valid number');
  });

  it('maps catalog controls to supported catalog families', () => {
    expect(catalogFamilyForAction(actionById('units.unit')!)).toBe('unit');
    expect(catalogFamilyForAction(actionById('units.ucumUnit')!)).toBe('ucumUnit');
    expect(catalogFamilyForAction(actionById('semantic.concepts')!)).toBe('semanticConcept');
    expect(catalogFamilyForAction(actionById('validation.format')!)).toBeUndefined();
    expect(catalogFamilyForAction(actionById('semantic.semanticRole')!)).toBe('semanticRole');
    expect(parseActionValue(actionById('semantic.semanticRole')!, '{"reference":"urn:test"}')).toEqual({ reference: 'urn:test' });
    expect(parseActionValue(actionById('semantic.concepts')!, '[{"reference":"urn:test","kind":"custom"}]')).toEqual([{ reference: 'urn:test', kind: 'custom' }]);
  });

  it('resolves escaped JSON pointers', () => {
    expect(valueAtPointer({ properties: { 'a/b': { type: 'string' } } }, '/properties/a~1b')).toEqual({ type: 'string' });
  });
});