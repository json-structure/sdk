import { describe, expect, it } from 'vitest';
import {
  AddCompositionOperandCommand,
  AddCompositionReferenceCommand,
  ConvertCompositionRuleCommand,
  DeleteCompositionOperandCommand,
  DocumentSession,
  DuplicateCompositionOperandCommand,
  MoveCompositionOperandCommand,
  NegateCompositionOperandCommand,
  SetAllOfCommand,
  SetAnyOfCommand,
  SetConditionalCompositionCommand,
  SetNotCommand,
  SetOneOfCommand,
  SetConditionalBranchCommand,
  UnwrapCompositionOperandCommand,
  WrapCompositionOperandCommand,
  parseDocument,
  resolveReferences,
  type EditorCommand,
  type TextEdit
} from '../src/index.js';

const extended = 'https://json-structure.org/meta/extended/v0/#';
const validation = 'https://json-structure.org/meta/validation/v0/#';

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  return [...edits].sort((left, right) => right.range.startOffset! - left.range.startOffset!).reduce(
    (text, edit) => text.slice(0, edit.range.startOffset) + edit.newText + text.slice(edit.range.endOffset),
    source
  );
}

function apply(source: string, command: EditorCommand): { changed: string; restored: string } {
  const session = new DocumentSession('memory://composition-edit', source);
  const result = command.execute({ session, documentVersion: 1 });
  const changed = applyEdits(source, result.edits);
  return { changed, restored: applyEdits(changed, result.inverseEdits) };
}

describe('Conditional Composition authoring', () => {
  it('uses the normative activation matrix', () => {
    const matrix: ReadonlyArray<readonly [Record<string, unknown>, boolean]> = [
      [{ $schema: validation }, true],
      [{ $schema: extended, $uses: ['JSONStructureConditionalComposition'] }, true],
      [{ $schema: extended, $uses: ['JSONSchemaConditionalComposition'] }, false],
      [{ $schema: extended, $uses: ['Conditional Composition'] }, false],
      [{ $schema: extended }, false],
      [{ $schema: 'https://json-structure.org/meta/core/v0/#', $uses: ['JSONStructureConditionalComposition'] }, false]
    ];
    for (const [header, expected] of matrix) {
      const session = new DocumentSession('memory://composition-activation', JSON.stringify({ ...header, type: 'string' }));
      expect(session.capabilities.conditionalCompositionActive).toBe(expected);
      expect(new SetAllOfCommand('', [{ type: 'string' }]).canExecute({ session, documentVersion: 1 })).toBe(expected);
    }
  });

  it('treats maxLength inside composition as Core-owned when Validation is inactive', () => {
    const session = new DocumentSession('memory://composition-core-max-length', JSON.stringify({
      $schema: extended,
      $uses: ['JSONStructureConditionalComposition'],
      type: 'string'
    }));
    expect(session.capabilities.conditionalCompositionActive).toBe(true);
    expect(session.capabilities.validationActive).toBe(false);
    expect(new SetAllOfCommand('', [{ type: 'string', maxLength: 32 }]).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetAllOfCommand('', [{ type: 'string', maxLength: -1 }]).canExecute({ session, documentVersion: 1 })).toBe(false);
  });

  it('provides typed add, replace, and remove commands with byte-identical inverses', () => {
    const original = `{"$schema":"${validation}","type":"string","unknown":{"keep":"\\u0061"}}`;
    const cases = [
      (value: readonly Record<string, unknown>[] | undefined) => new SetAllOfCommand('', value),
      (value: readonly Record<string, unknown>[] | undefined) => new SetAnyOfCommand('', value),
      (value: readonly Record<string, unknown>[] | undefined) => new SetOneOfCommand('', value)
    ];
    for (const create of cases) {
      const added = apply(original, create([{ type: 'string' }]));
      expect(added.restored).toBe(original);
      const replaced = apply(added.changed, create([{ type: 'number' }]));
      expect(replaced.restored).toBe(added.changed);
      const removed = apply(replaced.changed, create(undefined));
      expect(removed.restored).toBe(replaced.changed);
    }
    const addedNot = apply(original, new SetNotCommand('', { type: 'null' }));
    expect(addedNot.restored).toBe(original);
    const removedNot = apply(addedNot.changed, new SetNotCommand('', undefined));
    expect(removedNot.restored).toBe(addedNot.changed);
  });

  it('adds and replaces an atomic if/then/else group', () => {
    const original = `{"$schema":"${validation}","type":"object","properties":{"kind":{"type":"string"}},"x-note":true}`;
    const first = {
      if: { type: 'object', properties: { kind: { type: 'string' } } },
      then: { type: 'object', properties: { value: { type: 'string' } } },
      else: { type: 'object', properties: { value: { type: 'number' } } }
    };
    const added = apply(original, new SetConditionalCompositionCommand('', first));
    expect(added.restored).toBe(original);
    const second = {
      if: { type: 'object', properties: { kind: { type: 'string' } } },
      then: { type: 'object', properties: { value: { type: 'boolean' } } },
      else: { type: 'object', properties: { value: { type: 'null' } } }
    };
    const replaced = apply(added.changed, new SetConditionalCompositionCommand('', second));
    expect(replaced.restored).toBe(added.changed);
    const removed = apply(replaced.changed, new SetConditionalCompositionCommand('', undefined));
    expect(removed.restored).toBe(replaced.changed);
    const removedValue = JSON.parse(removed.changed) as Record<string, unknown>;
    expect(removedValue).not.toHaveProperty('if');
    expect(removedValue).not.toHaveProperty('then');
    expect(removedValue).not.toHaveProperty('else');
    expect(removedValue).toHaveProperty('x-note', true);
  });

  it('atomically transitions every valid conditional branch-key set with byte-identical inverse edits', () => {
    const branches = {
      if: { type: 'string' },
      then: { type: 'number' },
      else: { type: 'boolean' }
    };
    const groups = [
      { if: branches.if, then: branches.then },
      { if: branches.if, else: branches.else },
      branches
    ];
    for (const initial of groups) {
      const original = JSON.stringify({ $schema: validation, type: 'string', ...initial, untouched: { spelling: '\u0061' } });
      for (const desired of groups) {
        const session = new DocumentSession('memory://conditional-transition', original);
        const command = new SetConditionalCompositionCommand('', desired);
        expect(command.canExecute({ session, documentVersion: 1 })).toBe(true);
        const result = command.execute({ session, documentVersion: 1 });
        expect(result.edits.length).toBeGreaterThan(0);
        expect(result.inverseEdits.length).toBeGreaterThan(0);
        const changed = applyEdits(original, result.edits);
        expect(applyEdits(changed, result.inverseEdits)).toBe(original);
        expect(JSON.parse(changed)).toMatchObject({ ...desired, untouched: { spelling: 'a' } });
        for (const key of ['then', 'else'] as const) {
          expect(Object.prototype.hasOwnProperty.call(JSON.parse(changed), key)).toBe(Object.prototype.hasOwnProperty.call(desired, key));
        }
      }
    }
  });

  it('does not replace unrelated source text between conditional members', () => {
    const original = `{"$schema":"${validation}","type":"string","if":{"type":"string"},"x-note":{"spelling":"\\u0061"},"then":{"type":"number"}}`;
    const session = new DocumentSession('memory://conditional-minimal', original);
    const result = new SetConditionalCompositionCommand('', {
      if: { type: 'boolean' },
      else: { type: 'null' }
    }).execute({ session, documentVersion: 1 });
    const noteStart = original.indexOf('"x-note"');
    const noteEnd = original.indexOf(',"then"');
    expect(result.edits.every((edit) => edit.range.endOffset! <= noteStart || edit.range.startOffset! >= noteEnd)).toBe(true);
    const changed = applyEdits(original, result.edits);
    expect(changed).toContain('"x-note":{"spelling":"\\u0061"}');
    expect(applyEdits(changed, result.inverseEdits)).toBe(original);
  });

  it('accepts untyped composition constraints and rejects malformed or unsafe edits', () => {
    const source = JSON.stringify({ $schema: validation, type: 'object', properties: { kind: { type: 'string' } } });
    const session = new DocumentSession('memory://composition-negative', source);
    expect(new SetAllOfCommand('', []).canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetAllOfCommand('', [{ type: 'missing' }]).canExecute({ session, documentVersion: 1 })).toBe(false);
    expect(new SetConditionalCompositionCommand('', { if: { properties: { kind: { type: 'string' } } } }).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetConditionalCompositionCommand('', {
      if: { properties: { kind: { type: 'string' } } },
      then: { properties: { value: { type: 'string' } } }
    }).canExecute({ session, documentVersion: 1 })).toBe(true);

    const inactive = new DocumentSession('memory://composition-inactive', JSON.stringify({ $schema: extended, type: 'string' }));
    expect(new SetNotCommand('', { type: 'null' }).canExecute({ session: inactive, documentVersion: 1 })).toBe(false);
    expect(new SetNotCommand('', { type: 'null' }).canExecute({ session, documentVersion: 2 })).toBe(false);
    const incomplete = new DocumentSession('memory://composition-incomplete', '{');
    expect(new SetNotCommand('', { type: 'null' }).canExecute({ session: incomplete, documentVersion: 1 })).toBe(false);
    const duplicate = new DocumentSession('memory://composition-duplicate', `{"$schema":"${validation}","type":"string","allOf":[{"type":"string"}],"all\u004ff":[{"type":"number"}]}`);
    expect(new SetAllOfCommand('', [{ type: 'null' }]).canExecute({ session: duplicate, documentVersion: 1 })).toBe(false);
  });

  it('diagnoses activation, shapes, dependencies, nested declarations, and ignores literal data', () => {
    const inactive = parseDocument('memory://composition-inactive-diagnostic', JSON.stringify({
      $schema: extended,
      type: 'string',
      allOf: [{ type: 'missing', format: 'semantic-looking-payload' }]
    }));
    expect(inactive.diagnostics.some((item) => item.location?.pointer === '/allOf' && item.message.includes('requires'))).toBe(true);
    expect(inactive.diagnostics.some((item) => item.location?.pointer?.startsWith('/allOf/0'))).toBe(false);
    expect(inactive.model?.projections.references.some((item) => item.pointer.startsWith('/allOf'))).toBe(false);
    expect(inactive.model?.projections.semanticPlacements.some((item) => item.pointer.startsWith('/allOf'))).toBe(false);
    expect(inactive.model?.projections.definitions[0]?.composition).toBeUndefined();

    const validationOwned = parseDocument('memory://composition-in-validation', JSON.stringify({
      $schema: validation,
      type: 'array',
      contains: { type: 'string', then: { type: 'number' } }
    }));
    expect(validationOwned.diagnostics.some((item) => item.location?.pointer === '/contains/then' && item.message.includes('requires an if'))).toBe(false);

    const malformed = parseDocument('memory://composition-malformed', `{"$schema":"${validation}","type":"string","allOf":[],"anyOf":{},"oneOf":[1],"not":[],"if":{"type":"string"},"then":1}`);
    for (const pointer of ['/allOf', '/anyOf', '/oneOf', '/not', '/then']) {
      expect(malformed.diagnostics.some((item) => item.code === 'json.keyword-invalid' && item.location?.pointer === pointer), pointer).toBe(true);
    }
    const missingIf = parseDocument('memory://composition-missing-if', JSON.stringify({ $schema: validation, type: 'string', else: { type: 'number' } }));
    expect(missingIf.diagnostics.some((item) => item.location?.pointer === '/else' && item.message.includes('requires an if'))).toBe(false);
    const missingConsequent = parseDocument('memory://composition-missing-consequent', JSON.stringify({ $schema: validation, type: 'string', if: { type: 'number' } }));
    expect(missingConsequent.diagnostics.some((item) => item.location?.pointer === '/if' && item.message.includes('then or else'))).toBe(false);

    const nested = parseDocument('memory://composition-nested-validation', JSON.stringify({
      $schema: validation,
      type: 'object',
      properties: { kind: { type: 'string' } },
      if: { properties: { kind: { type: 'string' } }, required: ['kind'] },
      then: { allOf: [{ type: 'int8', minimum: 128 }], not: { type: 'missing' } },
      else: { type: 'string', default: { type: 'int8', minimum: 128, allOf: [] } }
    }));
    expect(nested.diagnostics.some((item) => item.location?.pointer === '/then/allOf/0/minimum')).toBe(true);
    expect(nested.diagnostics.some((item) => item.location?.pointer === '/then/not/type')).toBe(true);
    expect(nested.diagnostics.some((item) => item.location?.pointer?.startsWith('/else/default'))).toBe(false);
  });

  it('recognizes composition on structurally owned untyped namespace targets but not literal payloads', () => {
    const parsed = parseDocument('memory://composition-ownership', JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/ownership.json',
      name: 'Ownership',
      definitions: {
        Rules: {
          StringRule: { allOf: [{ type: 'string' }] },
          Nested: { NumberRule: { not: { type: 'number' } } },
          PayloadHolder: { type: 'string', default: { allOf: [] }, examples: [{ not: 1 }] }
        }
      }
    }));
    const stringRule = parsed.model?.projections.definitions.find((entry) => entry.pointer === '/definitions/Rules/StringRule');
    const numberRule = parsed.model?.projections.definitions.find((entry) => entry.pointer === '/definitions/Rules/Nested/NumberRule');
    expect(stringRule).toMatchObject({ coreForm: 'composed', reusable: false });
    expect(stringRule?.composition?.allOf).toEqual([{ type: 'string' }]);
    expect(numberRule).toMatchObject({ coreForm: 'composed', reusable: false });
    expect(numberRule?.composition?.not).toEqual({ type: 'number' });
    expect(parsed.diagnostics.some((item) => item.location?.pointer?.startsWith('/definitions/Rules/StringRule'))).toBe(false);
    expect(parsed.diagnostics.some((item) => item.location?.pointer?.includes('/default') || item.location?.pointer?.includes('/examples'))).toBe(false);

    const session = new DocumentSession('memory://composition-ownership-command', JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/ownership-command.json',
      name: 'OwnershipCommand',
      definitions: { Rules: { StringRule: { allOf: [{ type: 'string' }] } } }
    }));
    expect(new SetNotCommand('/definitions/Rules/StringRule', { type: 'null' }).canExecute({ session, documentVersion: 1 })).toBe(true);
    expect(new SetNotCommand('/definitions/Rules', { type: 'null' }).canExecute({ session, documentVersion: 1 })).toBe(false);
  });

  it('normalizes sparse authored inspection with exact emitted JSON', () => {
    const source = JSON.stringify({
      $schema: validation,
      type: 'string',
      oneOf: [{ type: 'string', minLength: 1 }, { type: 'number' }],
      not: { type: 'null' }
    });
    const composition = parseDocument('memory://composition-inspection', source).model?.projections.definitions[0]?.composition;
    expect(composition?.inspection.map((item) => item.keyword)).toEqual(['oneOf', 'not']);
    for (const item of composition?.inspection ?? []) {
      expect(item.effective).toEqual(item.authored);
      expect(JSON.parse(item.emittedJson)).toEqual(item.authored);
    }
  });

  it('discovers nested local and imported references exactly once without payload or cycle noise', () => {
    const externalParsed = parseDocument('https://example.test/library.json', JSON.stringify({
      $schema: 'https://json-structure.org/meta/core/v0/#',
      $id: 'https://example.test/library.json',
      name: 'Library',
      definitions: { External: { type: 'string' } }
    }));
    const parsed = parseDocument('memory://composition-references', JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/composition.json',
      name: 'Composition',
      type: 'object',
      properties: { value: { type: 'string' } },
      definitions: {
        Local: { type: 'string' },
        Library: { $importdefs: 'https://example.test/library.json' }
      },
      allOf: [{ type: { $ref: '#/definitions/Local' } }],
      if: { properties: { value: { type: { $ref: '#/definitions/Library/External' } } } },
      then: { not: { type: { $ref: '#/definitions/Local' } } },
      default: { type: { $ref: '#/definitions/Payload' }, allOf: [{ type: { $ref: '#/definitions/PayloadNested' } }] }
    }));
    const references = resolveReferences(parsed.model!, [externalParsed.model!]);
    expect(references.references.filter((item) => item.pointer === '/allOf/0/type/$ref')).toHaveLength(1);
    expect(references.references.filter((item) => item.pointer === '/if/properties/value/type/$ref')).toHaveLength(1);
    expect(references.references.filter((item) => item.pointer === '/then/not/type/$ref')).toHaveLength(1);
    expect(references.references.some((item) => item.pointer.startsWith('/default'))).toBe(false);
    expect(references.references.every((item) => item.status === 'resolved')).toBe(true);
    expect(references.diagnostics).toEqual([]);
  });

  it('accepts direct-reference branches only in composition positions and resolves local and imported sites once', () => {
    const externalParsed = parseDocument('https://example.test/direct-library.json', JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/direct-library.json',
      name: 'DirectLibrary',
      definitions: {
        Target: { type: 'string' },
        Rule: { type: 'string', anyOf: [{ $ref: '#/definitions/Target' }, { type: { $ref: '#/definitions/Target' } }] }
      }
    }));
    const parsed = parseDocument('memory://direct-composition-branches', JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/direct-owner.json',
      name: 'DirectOwner',
      definitions: {
        Local: { type: 'string' },
        Library: { $importdefs: 'https://example.test/direct-library.json' },
        Rule: {
          allOf: [{ $ref: '#/definitions/Local' }],
          not: { $ref: '#/definitions/Library/Target', description: 'imported branch' }
        },
        InvalidDeclaration: { $ref: '#/definitions/Local' }
      }
    }));
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/definitions/Rule/allOf/0')).toBe(false);
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/definitions/Rule/not')).toBe(false);
    expect(parsed.diagnostics.some((item) => item.location?.pointer === '/definitions/InvalidDeclaration' && item.code === 'core.declaration-invalid')).toBe(true);
    expect(parsed.model?.projections.definitions.some((entry) => entry.pointer === '/definitions/InvalidDeclaration')).toBe(false);
    const resolved = resolveReferences(parsed.model!, [externalParsed.model!]);
    for (const pointer of ['/definitions/Rule/allOf/0/$ref', '/definitions/Rule/not/$ref']) {
      expect(resolved.references.filter((item) => item.pointer === pointer)).toHaveLength(1);
      expect(resolved.references.find((item) => item.pointer === pointer)?.status).toBe('resolved');
    }
    expect(resolved.references.filter((item) => item.pointer === '/definitions/Library/Rule/anyOf/0/$ref')).toHaveLength(1);
    expect(resolved.references.find((item) => item.pointer === '/definitions/Library/Rule/anyOf/0/$ref')?.status).toBe('resolved');
    expect(resolved.references.filter((item) => item.pointer === '/definitions/Library/Rule/anyOf/1/type/$ref')).toHaveLength(1);

    const malformed = parseDocument('memory://malformed-direct-composition-branch', JSON.stringify({
      $schema: validation,
      $id: 'https://example.test/malformed-direct.json',
      name: 'MalformedDirect',
      allOf: [{ $ref: 'relative' }, { $ref: '#/definitions/Missing', extra: true }]
    }));
    expect(malformed.diagnostics.some((item) => item.location?.pointer === '/allOf/0/$ref')).toBe(true);
    expect(malformed.diagnostics.some((item) => item.location?.pointer === '/allOf/1/$ref')).toBe(true);
  });

  it('rejects every malformed structurally owned direct-reference branch exactly once', () => {
    const malformedBranches: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ['null', { $ref: null }],
      ['number', { $ref: 7 }],
      ['object', { $ref: { value: '#/definitions/Target' } }],
      ['fragment', { $ref: '#definitions/Target' }],
      ['shape', { $ref: '#/definitions/Target', extra: true }]
    ];
    for (const [label, branch] of malformedBranches) {
      const source = JSON.stringify({
        $schema: validation,
        $id: `https://example.test/malformed-${label}.json`,
        name: 'MalformedBranch',
        definitions: { Target: { type: 'string' } },
        allOf: [branch],
        default: branch
      });
      const pointer = '/allOf/0/$ref';
      const parsed = parseDocument(`memory://malformed-direct-${label}`, source);
      const diagnostics = parsed.diagnostics.filter((item) => item.location?.pointer === pointer);
      expect(diagnostics, label).toHaveLength(1);
      const diagnostic = diagnostics[0];
      if (!diagnostic?.location?.range) throw new Error(`Missing direct-reference diagnostic range for ${label}.`);
      const expectedText = JSON.stringify(branch.$ref);
      expect(source.slice(diagnostic.location.range.startOffset!, diagnostic.location.range.endOffset!), label).toBe(expectedText);
      expect(parsed.diagnostics.some((item) => item.location?.pointer?.startsWith('/default')), label).toBe(false);

      const session = new DocumentSession(`memory://malformed-direct-command-${label}`, JSON.stringify({
        $schema: validation,
        $id: `https://example.test/command-${label}.json`,
        name: 'MalformedCommand',
        definitions: { Target: { type: 'string' } },
        type: 'string'
      }));
      expect(new SetAllOfCommand('', [branch]).canExecute({ session, documentVersion: 1 }), label).toBe(false);
      expect(new SetNotCommand('', branch).canExecute({ session, documentVersion: 1 }), label).toBe(false);
    }
  });
  it('edits recursive operands structurally while preserving legacy and unsupported operand bytes', () => {
    const legacy = '{"$ref":"#/definitions/Text","description":"\\u0061"}';
    const unsupported = '{"x-legacy":{"spelling":"\\u0062"}}';
    const source = `{"$schema":"${validation}","definitions":{"Text":{"type":"string"}},"allOf":[${legacy},${unsupported},{"type":"number"}]}`;
    const session = new DocumentSession('memory://composition-structural', source);
    const context = () => ({ session, documentVersion: session.snapshot().documentVersion });

    const duplicate = new DuplicateCompositionOperandCommand('/allOf/0');
    expect(duplicate.canExecute(context())).toBe(true);
    session.applyTextEdits(duplicate.execute(context()).edits);
    expect(session.snapshot().text.split(legacy)).toHaveLength(3);
    expect(session.undo().text).toBe(source);
    session.redo();

    const move = new MoveCompositionOperandCommand('/allOf/1', 'down');
    session.applyTextEdits(move.execute(context()).edits);
    expect(session.snapshot().text).toContain(unsupported);
    expect(session.snapshot().text).toContain(legacy);

    const remove = new DeleteCompositionOperandCommand('/allOf/1');
    session.applyTextEdits(remove.execute(context()).edits);
    expect(session.snapshot().text).not.toContain(unsupported);
    expect(session.canUndo).toBe(true);
    expect(session.undo().text).toContain(unsupported);
  });

  it('converts, wraps, unwraps, and negates nested rules with exact inverse edits', () => {
    const source = `{"$schema":"${validation}","allOf":[{"type":"string","description":"\\u0061"}]}`;
    const converted = apply(source, new ConvertCompositionRuleCommand('', 'allOf', 'anyOf'));
    expect(converted.changed).toContain('"anyOf"');
    expect(converted.changed).toContain('"description":"\\u0061"');
    expect(converted.restored).toBe(source);

    const wrapped = apply(source, new WrapCompositionOperandCommand('/allOf/0', 'oneOf'));
    expect(JSON.parse(wrapped.changed).allOf[0]).toEqual({ oneOf: [{ type: 'string', description: 'a' }] });
    expect(wrapped.changed).toContain('"description":"\\u0061"');
    expect(wrapped.restored).toBe(source);

    const unwrapped = apply(wrapped.changed, new UnwrapCompositionOperandCommand('/allOf/0'));
    expect(unwrapped.changed).toBe(source);
    expect(unwrapped.restored).toBe(wrapped.changed);

    const negated = apply(source, new NegateCompositionOperandCommand('/allOf/0'));
    expect(JSON.parse(negated.changed).allOf[0]).toEqual({ not: { type: 'string', description: 'a' } });
    expect(negated.restored).toBe(source);
    expect(apply(negated.changed, new NegateCompositionOperandCommand('/allOf/0')).changed).toBe(source);
  });

  it('authors canonical typed refs and independently manages conditional branches', () => {
    const source = JSON.stringify({
      $schema: validation,
      definitions: { Text: { type: 'string' } },
      anyOf: [{ type: 'number' }],
      if: { type: 'string' }
    });
    const session = new DocumentSession('memory://composition-canonical-ref', source);
    const context = () => ({ session, documentVersion: session.snapshot().documentVersion });
    session.applyTextEdits(new AddCompositionReferenceCommand('', 'anyOf', '#/definitions/Text').execute(context()).edits);
    expect((JSON.parse(session.snapshot().text).anyOf as unknown[])[1]).toEqual({ type: { $ref: '#/definitions/Text' } });
    expect((JSON.parse(session.snapshot().text).anyOf as Record<string, unknown>[])[1]).not.toHaveProperty('$ref');

    session.applyTextEdits(new AddCompositionOperandCommand('', 'anyOf', { allOf: [{ type: 'boolean' }] }).execute(context()).edits);
    expect((JSON.parse(session.snapshot().text).anyOf as unknown[])[2]).toEqual({ allOf: [{ type: 'boolean' }] });

    session.applyTextEdits(new SetConditionalBranchCommand('', 'then', { type: 'number' }).execute(context()).edits);
    session.applyTextEdits(new SetConditionalBranchCommand('', 'if', undefined).execute(context()).edits);
    const independent = JSON.parse(session.snapshot().text) as Record<string, unknown>;
    expect(independent).not.toHaveProperty('if');
    expect(independent).toHaveProperty('then', { type: 'number' });
    expect(parseDocument('memory://conditional-independent', session.snapshot().text).diagnostics.some((item) => item.message.includes('requires an if'))).toBe(false);
  });
});
