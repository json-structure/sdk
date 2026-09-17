import { describe, expect, it } from 'vitest';
import {
  DocumentSession,
  SetCurrencyCommand,
  SetSymbolCommand,
  SetSymbolsCommand,
  SetUcumUnitCommand,
  SetUnitCommand,
  parseDocument,
  type EditorCommand
} from '../src/index.js';

const validation = 'https://json-structure.org/meta/validation/v0/#';
const extended = 'https://json-structure.org/meta/extended/v0/#';
const active = (members: string): string => `{"$schema":"${extended}","$uses":["JSONStructureUnits"],${members}}`;
function apply(text: string, command: EditorCommand): { changed: string; restored: string } {
  const session = new DocumentSession('memory://units-edit', text);
  const result = command.execute({ session, documentVersion: 1 });
  const edit = result.edits[0];
  const changed = text.slice(0, edit.range.startOffset) + edit.newText + text.slice(edit.range.endOffset);
  const inverse = result.inverseEdits[0];
  return { changed, restored: changed.slice(0, inverse.range.startOffset) + inverse.newText + changed.slice(inverse.range.endOffset) };
}

describe('Units companion authoring', () => {
  it('uses one normative capability matrix for parser and all command families', () => {
    const matrix: ReadonlyArray<readonly [string, Record<string, unknown>, boolean]> = [
      ['validation-default', { $schema: validation }, true],
      ['extended-use', { $schema: extended, $uses: ['JSONStructureUnits'] }, true],
      ['extended-non-normative-alias', { $schema: extended, $uses: ['JSONSchemaUnits'] }, false],
      ['extended-no-use', { $schema: extended }, false],
      ['core-use', { $schema: 'https://json-structure.org/meta/core/v0/#', $uses: ['JSONStructureUnits'] }, false],
      ['arbitrary-use', { $schema: 'https://example.test/meta', $uses: ['JSONStructureUnits'] }, false],
      ['missing-schema', { $uses: ['JSONStructureUnits'] }, false]
    ];
    for (const [name, header, expected] of matrix) {
      const text = JSON.stringify({ ...header, type: 'number', unit: 'm' });
      const session = new DocumentSession(`memory://${name}`, text);
      expect(session.capabilities.unitsActive, `${name}: capability`).toBe(expected);
      expect(parseDocument(`memory://${name}`, text).model?.projections.definitions[0]?.units !== undefined, `${name}: projection`).toBe(expected);
      expect(new SetUnitCommand('', 's').canExecute({ session, documentVersion: 1 }), `${name}: command`).toBe(expected);
    }
  });

  it('provides typed add, replace, and remove commands for every keyword with byte-identical inverses', () => {
    const cases: ReadonlyArray<readonly [string, (value: never) => EditorCommand, unknown]> = [
      ['symbol', (value) => new SetSymbolCommand('', value), 'm²'],
      ['symbols', (value) => new SetSymbolsCommand('', value), { default: 'm²', 'lang:de-DE': 'Quadratmeter' }],
      ['unit', (value) => new SetUnitCommand('', value), 'm^2'],
      ['ucumUnit', (value) => new SetUcumUnitCommand('', value), 'm2'],
      ['currency', (value) => new SetCurrencyCommand('', value), 'X-CUSTOM']
    ];
    for (const [keyword, create, value] of cases) {
      const original = active('"type":"number","unknown":{"keep":"\\u0061"}');
      const added = apply(original, create(value as never));
      expect(added.restored, `${keyword}: add inverse`).toBe(original);
      expect(JSON.parse(added.changed).unknown.keep).toBe('a');
      const replaced = apply(added.changed, create((keyword === 'symbols' ? { display: 'custom' } : 'custom') as never));
      expect(replaced.restored, `${keyword}: replace inverse`).toBe(added.changed);
      const removed = apply(replaced.changed, create(undefined as never));
      expect(removed.restored, `${keyword}: remove inverse`).toBe(replaced.changed);
    }
  });

  it('enforces value shapes, language tags, numeric placement, unit syntax, and UCUM case sensitivity', () => {
    const numeric = new DocumentSession('memory://numeric', active('"type":"number"'));
    expect(new SetSymbolCommand('', '').canExecute({ session: numeric, documentVersion: 1 })).toBe(true);
    expect(new SetSymbolsCommand('', { custom: 'anything', 'lang:en-US': 'metres' }).canExecute({ session: numeric, documentVersion: 1 })).toBe(true);
    expect(new SetSymbolsCommand('', { 'lang:not_a_tag': 'bad' }).canExecute({ session: numeric, documentVersion: 1 })).toBe(false);
    expect(new SetUnitCommand('', 'kg*m/s^2').canExecute({ session: numeric, documentVersion: 1 })).toBe(true);
    expect(new SetUnitCommand('', 'kg m').canExecute({ session: numeric, documentVersion: 1 })).toBe(false);
    expect(new SetUcumUnitCommand('', 'Cel').canExecute({ session: numeric, documentVersion: 1 })).toBe(true);
    expect(new SetUcumUnitCommand('', '1').canExecute({ session: numeric, documentVersion: 1 })).toBe(true);
    expect(parseDocument('memory://ucum-unity', active('"type":"number","ucumUnit":"1"')).diagnostics.some((item) => item.location?.pointer === '/ucumUnit')).toBe(false);
    expect(new SetUcumUnitCommand('', 'm/s^2').canExecute({ session: numeric, documentVersion: 1 })).toBe(false);
    expect(new SetCurrencyCommand('', 'private-currency').canExecute({ session: numeric, documentVersion: 1 })).toBe(true);
    const text = new DocumentSession('memory://text', active('"type":"string"'));
    expect(new SetSymbolCommand('', 'items').canExecute({ session: text, documentVersion: 1 })).toBe(true);
    expect(new SetSymbolsCommand('', { default: 'items' }).canExecute({ session: text, documentVersion: 1 })).toBe(true);
    expect(new SetCurrencyCommand('', 'USD').canExecute({ session: text, documentVersion: 1 })).toBe(true);
    expect(new SetUnitCommand('', 'm').canExecute({ session: text, documentVersion: 1 })).toBe(false);
    expect(new SetUcumUnitCommand('', 'm').canExecute({ session: text, documentVersion: 1 })).toBe(false);
  });

  it('uses resolved local numeric types and remains indeterminate for external types and unions', () => {
    const local = new DocumentSession('memory://local', active('"definitions":{"Base":{"type":"decimal"},"Alias":{"type":{"$ref":"#/definitions/Base"}}}'));
    expect(new SetUnitCommand('/definitions/Alias', 'm').canExecute({ session: local, documentVersion: 1 })).toBe(true);
    const externalText = active('"type":{"$ref":"https://example.test/types#Number"},"unit":1');
    const external = parseDocument('memory://external', externalText);
    expect(external.diagnostics.some((item) => item.location?.pointer === '/unit')).toBe(false);
    expect(new SetUnitCommand('', 'm').canExecute({ session: new DocumentSession('memory://external-command', externalText), documentVersion: 1 })).toBe(false);
    const union = new DocumentSession('memory://union', active('"type":["number","string"]'));
    expect(new SetUnitCommand('', 'm').canExecute({ session: union, documentVersion: 1 })).toBe(false);
  });

  it('emits exact schema-owned diagnostics and excludes malformed values from inspection', () => {
    const source = active('"type":"object","properties":{"n":{"type":"number","unit":"m s","ucumUnit":"m/s^2","symbols":{"lang:bad_tag":"x"}},"s":{"type":"string","unit":"m"}},"default":{"type":"number","unit":1}');
    const result = parseDocument('memory://diagnostics', source);
    for (const pointer of ['/properties/n/unit', '/properties/n/ucumUnit', '/properties/n/symbols', '/properties/s/unit']) {
      const diagnostic = result.diagnostics.find((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === pointer);
      const node = result.model?.nodes.find((item) => item.pointer === pointer);
      expect(diagnostic, pointer).toBeDefined();
      expect(diagnostic?.location?.range).toEqual(node?.range);
    }
    expect(result.diagnostics.some((item) => item.location?.pointer?.startsWith('/default/'))).toBe(false);
    expect(result.model?.projections.definitions.find((item) => item.pointer === '/properties/n')?.units?.unit).toBeUndefined();
  });

  it('allows unit and ucumUnit together and warns, rather than rejects, known incompatible pairs', () => {
    const compatible = parseDocument('memory://compatible', active('"type":"number","unit":"m/s^2","ucumUnit":"m/s2"'));
    expect(compatible.diagnostics.some((item) => item.code === 'units.incompatible-pair')).toBe(false);
    expect(compatible.model?.projections.definitions[0]?.units?.preferredComputationalUnit).toEqual({ explicit: 'm/s2', effective: 'm/s2' });
    const incompatible = parseDocument('memory://incompatible', active('"type":"number","unit":"m","ucumUnit":"s"'));
    expect(incompatible.diagnostics.some((item) => item.code === 'units.incompatible-pair' && item.severity === 'warning')).toBe(true);
    expect(incompatible.model?.projections.definitions[0]?.units).toMatchObject({ unit: 'm', ucumUnit: 's' });
    const session = new DocumentSession('memory://pair-command', active('"type":"number","unit":"m"'));
    expect(new SetUcumUnitCommand('', 's').canExecute({ session, documentVersion: 1 })).toBe(true);
  });

  it('rejects stale, incomplete, duplicate, and escaped duplicate targets', () => {
    const valid = new DocumentSession('memory://stale', active('"type":"number"'));
    expect(new SetUnitCommand('', 'm').canExecute({ session: valid, documentVersion: 2 })).toBe(false);
    const incomplete = new DocumentSession('memory://incomplete', `{"$schema":"${extended}","$uses":["JSONStructureUnits"],"type":"number",`);
    expect(new SetUnitCommand('', 'm').canExecute({ session: incomplete, documentVersion: 1 })).toBe(false);
    const duplicate = new DocumentSession('memory://duplicate', active('"type":"number","unit":"m","unit":"s"'));
    expect(new SetUnitCommand('', 'kg').canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);
    expect(duplicate.model?.projections.definitions[0]?.units?.unit).toBeUndefined();
    const escaped = new DocumentSession('memory://escaped', active('"type":"number","unit":"m","un\\u0069t":"s"'));
    expect(new SetUnitCommand('', 'kg').canExecute({ session: escaped, documentVersion: 1 })).toBe(false);
  });
});