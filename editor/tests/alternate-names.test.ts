import { describe, expect, it } from 'vitest';
import {
  DocumentSession,
  SetAltEnumsCommand,
  SetAltNamesCommand,
  SetLocalizedDescriptionsCommand,
  parseDocument,
  type EditorCommand
} from '../src/index.js';

const extended = 'https://json-structure.org/meta/extended/v0/#';
const validation = 'https://json-structure.org/meta/validation/v0/#';

function apply(text: string, command: EditorCommand): { changed: string; restored: string } {
  const session = new DocumentSession('memory://alternate-names-edit', text);
  const result = command.execute({ session, documentVersion: 1 });
  const edit = result.edits[0];
  const changed = text.slice(0, edit.range.startOffset) + edit.newText + text.slice(edit.range.endOffset);
  const inverse = result.inverseEdits[0];
  return { changed, restored: changed.slice(0, inverse.range.startOffset) + inverse.newText + changed.slice(inverse.range.endOffset) };
}

describe('Alternate Names authoring', () => {
  it('uses the canonical activation token and direct Validation activation', () => {
    const matrix: ReadonlyArray<readonly [Record<string, unknown>, boolean]> = [
      [{ $schema: validation }, true],
      [{ $schema: extended, $uses: ['JSONStructureAlternateNames'] }, true],
      [{ $schema: extended, $uses: ['JSONSchemaAlternateNames'] }, false],
      [{ $schema: extended }, false],
      [{ $schema: 'https://json-structure.org/meta/core/v0/#', $uses: ['JSONStructureAlternateNames'] }, false]
    ];
    for (const [header, expected] of matrix) {
      const source = JSON.stringify({ ...header, type: 'object', properties: { value: { type: 'string' } } });
      const session = new DocumentSession('memory://alternate-activation', source);
      expect(session.capabilities.alternateNamesActive).toBe(expected);
      expect(new SetAltNamesCommand('/properties/value', { json: 'external-value' }).canExecute({ session, documentVersion: 1 })).toBe(expected);
      const projection = parseDocument('memory://alternate-activation-parser', source.replace('{"type":"string"}', '{"type":"string","altnames":{"json":"external-value"}}'))
        .model?.projections.definitions.find((item) => item.pointer === '/properties/value')?.alternateNames;
      expect(projection !== undefined).toBe(expected);
    }
    const root = new DocumentSession('memory://named-root', JSON.stringify({ $schema: validation, name: 'Root', type: 'string' }));
    expect(new SetAltNamesCommand('', { json: 'root-value' }).canExecute({ session: root, documentVersion: 1 })).toBe(true);
  });

  it('provides typed add, replace, and remove with byte-identical inverses', () => {
    const original = `{"$schema":"${extended}","$uses":["JSONStructureAlternateNames"],"type":"string","enum":["A","B"],"unknown":{"keep":"\\u0061"}}`;
    const cases: ReadonlyArray<readonly [(value: never) => EditorCommand, unknown, unknown]> = [
      [(value) => new SetAltNamesCommand('/definitions/Kind', value), { json: 'kind-a' }, { 'lang:de': 'Art' }],
      [(value) => new SetAltEnumsCommand('/definitions/Kind', value), { json: { A: 'a', B: 'b' } }, { custom: { A: '1', B: '2' } }],
      [(value) => new SetLocalizedDescriptionsCommand('/definitions/Kind', value), { 'lang:en': 'Kind' }, { documentation: 'A kind' }]
    ];
    const wrap = (schema: string) => `{"$schema":"${extended}","$uses":["JSONStructureAlternateNames"],"$id":"https://example.test/schema","name":"Example","definitions":{"Kind":${schema}}}`;
    for (const [create, first, second] of cases) {
      const base = wrap(original.slice(original.indexOf(',"type"') + 1, -1).replace(/^"type"/, '{"type"') + '}');
      const added = apply(base, create(first as never));
      expect(added.restored).toBe(base);
      const replaced = apply(added.changed, create(second as never));
      expect(replaced.restored).toBe(added.changed);
      const removed = apply(replaced.changed, create(undefined as never));
      expect(removed.restored).toBe(replaced.changed);
    }
  });

  it('projects sparse authored values and exact emitted JSON without changing Core description', () => {
    const source = JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/schema',
      name: 'Example',
      type: 'object',
      description: 'Core description',
      descriptions: { 'lang:en': 'Localized description' },
      properties: { state: { type: 'string', enum: ['on', 'off'], altenums: { json: { on: 1, off: 0 } } } }
    });
    const parsed = parseDocument('memory://alternate-inspection', source);
    const root = parsed.model?.projections.definitions.find((item) => item.pointer === '');
    expect(root?.description).toBe('Core description');
    expect(root?.alternateNames).toEqual({
      descriptions: { 'lang:en': 'Localized description' },
      inspection: [{
        keyword: 'descriptions',
        authored: { 'lang:en': 'Localized description' },
        effective: { 'lang:en': 'Localized description' },
        emittedJson: '{"lang:en":"Localized description"}'
      }]
    });
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/properties/state/altenums')).toBe(true);
  });

  it('enforces placement, values, language tags, and exact enum coverage with exact pointers', () => {
    const source = JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/schema',
      name: 'Example',
      type: 'object',
      altnames: { json: 'root' },
      properties: {
        badLanguage: { type: 'string', altnames: { 'lang:not_a_tag': 'Bad' } },
        missingEnum: { type: 'string', altenums: { json: { A: 'a' } } },
        incompleteEnum: { type: 'string', enum: ['A', 'B'], altenums: { json: { A: 'a' } } },
        extraEnum: { type: 'string', enum: ['A'], altenums: { json: { A: 'a', B: 'b' } } }
      }
    });
    const invalidPointers = parseDocument('memory://alternate-invalid', source).diagnostics
      .filter((item) => item.code === 'json.keyword-invalid').map((item) => item.location?.pointer);
    expect(invalidPointers).toEqual(expect.arrayContaining([
      '/properties/badLanguage/altnames/lang:not_a_tag',
      '/properties/missingEnum/altenums',
      '/properties/incompleteEnum/altenums',
      '/properties/extraEnum/altenums'
    ]));
    expect(invalidPointers).not.toContain('/altnames');
  });

  it('allows altenums on enum-bearing root, property, and item schemas but rejects a schema without enum', () => {
    const source = JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/schema',
      name: 'Example',
      type: 'array',
      enum: ['root'],
      altenums: { json: { root: 'ROOT' } },
      items: {
        type: 'object',
        enum: ['item'],
        altenums: { json: { item: 'ITEM' } },
        properties: {
          state: { type: 'string', enum: ['on'], altenums: { json: { on: 'ON' } } },
          missing: { type: 'string', altenums: { json: { no: 'NO' } } }
        }
      }
    });
    const parsed = parseDocument('memory://altenums-placement', source);
    const invalidPointers = parsed.diagnostics.filter((item) => item.code === 'json.keyword-invalid').map((item) => item.location?.pointer);
    expect(invalidPointers).toContain('/items/properties/missing/altenums');
    expect(invalidPointers).not.toEqual(expect.arrayContaining(['/altenums', '/items/altenums', '/items/properties/state/altenums']));

    const session = new DocumentSession('memory://altenums-placement-command', source);
    expect(new SetAltEnumsCommand('', { json: { root: 'R' } }).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetAltEnumsCommand('/items', { json: { item: 'I' } }).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetAltEnumsCommand('/items/properties/state', { json: { on: '1' } }).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetAltEnumsCommand('/items/properties/missing', { json: { no: '0' } }).canExecute({ session, documentVersion: 1 })).toBe(false);
  });

  it('derives named ownership structurally across namespaces and escaped names', () => {
    const source = JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/schema',
      name: 'Example',
      type: 'object',
      properties: {
        'a/b~c': { type: 'string', altnames: { json: 'escaped' } },
        list: { type: 'array', items: { type: 'string', altnames: { json: 'anonymous-item' } } }
      },
      definitions: {
        Outer: {
          Inner: { type: 'string', altnames: { json: 'inner' } },
          List: { type: 'array', items: { type: 'string', altnames: { json: 'anonymous-definition-item' } } }
        }
      }
    });
    const parsed = parseDocument('memory://alternate-ownership', source);
    const invalidPointers = parsed.diagnostics.filter((item) => item.code === 'json.keyword-invalid').map((item) => item.location?.pointer);
    expect(invalidPointers).toEqual(expect.arrayContaining([
      '/properties/list/items/altnames',
      '/definitions/Outer/List/items/altnames'
    ]));
    expect(invalidPointers).not.toEqual(expect.arrayContaining([
      '/properties/a~1b~0c/altnames',
      '/definitions/Outer/Inner/altnames'
    ]));

    const session = new DocumentSession('memory://alternate-ownership-command', source);
    expect(new SetAltNamesCommand('/properties/a~1b~0c', { json: 'changed' }).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetAltNamesCommand('/definitions/Outer/Inner', { json: 'changed' }).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetAltNamesCommand('/properties/list/items', { json: 'changed' }).canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetAltNamesCommand('/definitions/Outer/List/items', { json: 'changed' }).canExecute({ session, documentVersion: 1 })).toBe(false);
  });

  it('enforces RFC 5646 variant and extension singleton uniqueness', () => {
    const source = (tag: string) => JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/schema',
      name: 'Example',
      type: 'string',
      altnames: { [`lang:${tag}`]: 'label' }
    });
    for (const tag of ['en-Latn-US-variant-variant', 'en-a-foo-a-bar']) {
      expect(parseDocument(`memory://invalid-${tag}`, source(tag)).diagnostics.some((item) => item.code === 'json.keyword-invalid')).toBe(true);
    }
    for (const tag of ['en-Latn-US-variant-a-foo-b-bar-x-private', 'x-private-use', 'de-CH-1901']) {
      expect(parseDocument(`memory://valid-${tag}`, source(tag)).diagnostics.some((item) => item.code === 'json.keyword-invalid')).toBe(false);
      const session = new DocumentSession(`memory://command-${tag}`, source('en'));
      expect(new SetAltNamesCommand('', { [`lang:${tag}`]: 'label' }).canExecute({ session, documentVersion: 1 })).toBe(true);
    }
  });

  it('rejects stale, duplicate, incomplete, and invalid edits while preserving escaped custom values', () => {
    const source = `{"$schema":"${validation}","$id":"https://example.test/schema","name":"Example","type":"object","properties":{"x":{"type":"string","unknown":"\\u0061"}}}`;
    const session = new DocumentSession('memory://alternate-guards', source);
    expect(() => new SetAltNamesCommand('/properties/x', { custom: 'x' }).execute({ session, documentVersion: 2 })).toThrow();
    const duplicate = source.replace('"unknown"', '"altnames":{"json":"x"},"alt\\u006eames":{"json":"y"},"unknown"');
    expect(() => apply(duplicate, new SetAltNamesCommand('/properties/x', { json: 'z' }))).toThrow();
    const incomplete = source.slice(0, -2);
    expect(() => apply(incomplete, new SetLocalizedDescriptionsCommand('/properties/x', { custom: 'x' }))).toThrow();
    expect(() => apply(source, new SetAltNamesCommand('/properties/x', { 'lang:bad_tag': 'x' }))).toThrow();
    const edited = apply(source, new SetAltNamesCommand('/properties/x', { custom: 'custom/value' }));
    expect(edited.changed).toContain('"unknown":"\\u0061"');
    expect(edited.restored).toBe(source);
  });

  it('does not traverse description text, semantic payloads, or defaults as Alternate Names schemas', () => {
    const source = JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/schema',
      name: 'Example',
      type: 'object',
      description: 'altnames descriptions altenums',
      default: { altnames: { 'lang:bad_tag': 1 } },
      concepts: [{ altnames: { 'lang:bad_tag': 1 } }],
      properties: { value: { type: 'string' } }
    });
    const parsed = parseDocument('memory://alternate-payloads', source);
    expect(parsed.diagnostics.some((item) => item.location?.pointer?.includes('/default/') || item.location?.pointer?.includes('/concepts/'))).toBe(false);
  });
});