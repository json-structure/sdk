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

  it('converts typed values and rejects invalid constrained numbers', () => {
    expect(parseActionValue(actionById('core.abstract')!, '', true)).toBe(true);
    expect(parseActionValue(actionById('core.precision')!, '12')).toBe(12);
    expect(parseActionValue(actionById('core.required')!, '["name"]')).toEqual(['name']);
    expect(() => parseActionValue(actionById('core.precision')!, '-1')).toThrow('valid number');
  });

  it('maps catalog controls to supported catalog families', () => {
    expect(catalogFamilyForAction(actionById('units.ucumUnit')!)).toBe('ucumUnit');
    expect(catalogFamilyForAction(actionById('validation.format')!)).toBeUndefined();
    expect(catalogFamilyForAction(actionById('semantic.semanticRole')!)).toBe('semanticRole');
    expect(parseActionValue(actionById('semantic.semanticRole')!, '{"reference":"urn:test"}')).toEqual({ reference: 'urn:test' });
  });

  it('resolves escaped JSON pointers', () => {
    expect(valueAtPointer({ properties: { 'a/b': { type: 'string' } } }, '/properties/a~1b')).toEqual({ type: 'string' });
  });
});