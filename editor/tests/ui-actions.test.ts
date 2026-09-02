import { describe, expect, it } from 'vitest';
import { commandActions, actionById } from '../src/ui/actions.js';
import { actionAvailability } from '../src/ui/action-runtime.js';
import { resolveCapabilities } from '../src/capabilities.js';
import { DocumentSession } from '../src/session.js';
import { collectionPointers } from '../src/ui/index.js';
import { parseActionValue } from '../src/ui/action-runtime.js';

describe('UI command action registry', () => {
  it('exposes every supported command family through metadata', () => {
    expect(new Set(commandActions.map((action) => action.group))).toEqual(new Set([
      'Document', 'Root', 'Definitions', 'Properties', 'Core', 'References', 'Imports', 'Relations', 'Validation', 'Composition', 'Units', 'Alternate names', 'Semantic annotations'
    ]));
  });

  it('creates a text-canonical root property command for an inline root schema', () => {
    const session = new DocumentSession('memory://ui-actions', '{"type":"object","properties":{"name":{"type":"string"}}}');
    const action = actionById('property.add')!;
    const command = action.create('', { type: 'integer' }, 'age');
    const context = { session, documentVersion: session.snapshot().documentVersion };
    expect(command.canExecute(context)).toBe(true);
    expect(command.execute(context).edits[0]?.newText).toContain('"age"');
  });

  it('removes a property description when the inline editor is cleared', () => {
    const session = new DocumentSession('memory://ui-description', '{"type":"object","properties":{"name":{"type":"string","description":"Display name"}}}');
    const action = actionById('property.description')!;
    const command = action.create('/properties/name', undefined);
    const context = { session, documentVersion: session.snapshot().documentVersion };
    expect(command.canExecute(context)).toBe(true);
    expect(command.execute(context).edits[0]?.newText).toBe('');
  });

  it('describes typed controls, targets, capabilities, and explicit removals', () => {
    expect(actionById('core.type')).toMatchObject({ control: { kind: 'select' }, capability: 'core', targets: ['declaration'], operation: 'set', removesActionId: 'core.type.remove' });
    expect(actionById('core.type')?.control).toMatchObject({ options: expect.arrayContaining([
      { value: 'any', label: 'any' },
      { value: 'int8', label: 'int8' }, { value: 'uint16', label: 'uint16' }, { value: 'float8', label: 'float8' },
      { value: 'decimal', label: 'decimal' }, { value: 'datetime', label: 'datetime' }, { value: 'binary', label: 'binary' }, { value: 'jsonpointer', label: 'jsonpointer' }
    ]) });
    expect(actionById('core.required')).toMatchObject({ control: { kind: 'property-multi-select' } });
    expect(actionById('core.max-length')).toMatchObject({ capability: 'core', schemaTypes: ['string'], keyword: 'maxLength' });
    expect(actionById('validation.maxLength')).toBeUndefined();
    expect(actionById('property.required-alternatives')).toMatchObject({ control: { kind: 'source-only' } });
    expect(actionById('definition.add')).toMatchObject({ control: { kind: 'schema-type' } });
    expect(actionById('core.extends')).toMatchObject({ control: { kind: 'structured-list', item: 'reference' } });
    expect(actionById('reference.type')).toMatchObject({ control: { kind: 'reference-picker' } });
    expect(actionById('relation.add')).toMatchObject({ control: { kind: 'relation-editor' }, capability: 'relations' });
    expect(actionById('relation.edit')).toMatchObject({ control: { kind: 'relation-editor' }, capability: 'relations' });
    expect(actionById('relation.identity')).toMatchObject({ control: { kind: 'property-multi-select' }, keyword: 'identity' });
    expect(actionById('relation.cardinality')).toMatchObject({ control: { kind: 'select' }, keyword: 'cardinality' });
    expect(actionById('relation.scope')).toMatchObject({ control: { kind: 'structured-list', item: 'reference' }, keyword: 'scope' });
    expect(actionById('relation.qualifier')).toMatchObject({ control: { kind: 'reference-picker' }, keyword: 'qualifiertype' });
    expect(actionById('units.ucumUnit')).toMatchObject({ control: { kind: 'catalog', family: 'ucumUnit' }, capability: 'units', operation: 'set', removesActionId: 'units.ucumUnit.remove' });
    expect(actionById('units.symbol')?.schemaTypes).toBeUndefined();
    expect(actionById('units.symbols')?.schemaTypes).toBeUndefined();
    expect(actionById('units.currency')?.schemaTypes).toBeUndefined();
    expect(actionById('units.unit.remove')).toMatchObject({ requiresValue: false, capability: 'units', operation: 'remove' });
    expect(commandActions.filter((action) => action.operation === 'set').every((action) => action.control || action.id === 'root.set')).toBe(true);
  });

  it('keeps type-agnostic Units annotations available while restricting unit expressions to numeric schemas', () => {
    const document = {
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $uses: ['JSONStructureUnits'],
      type: 'string'
    };
    expect(actionAvailability(actionById('units.symbol')!, '', document).enabled).toBe(true);
    expect(actionAvailability(actionById('units.symbols')!, '', document).enabled).toBe(true);
    expect(actionAvailability(actionById('units.currency')!, '', document).enabled).toBe(true);
    expect(actionAvailability(actionById('units.unit')!, '', document).enabled).toBe(false);
    expect(actionAvailability(actionById('units.ucumUnit')!, '', document).enabled).toBe(false);
  });

  it('disables hand-authored commands on incompatible selections', () => {
    const document = {
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureImport', 'JSONStructureRelations', 'JSONStructureValidation'],
      definitions: {
        Domain: {
          Person: { type: 'object', properties: { name: { type: 'string' } }, relations: { manager: { targettype: { $ref: '#/definitions/Domain/Person' } } } },
          Tiny: { type: 'int8' }, Numeric: { type: 'number' }, Unknown: { type: { $ref: '#/definitions/Missing' } }
        }
      }
    };
    const property = '/definitions/Domain/Person/properties/name';
    const relation = '/definitions/Domain/Person/relations/manager';
    const namespace = '/definitions/Domain';
    expect(actionAvailability(actionById('property.rename')!, property, document).enabled).toBe(true);
    expect(actionAvailability(actionById('property.rename')!, relation, document).enabled).toBe(false);
    expect(actionAvailability(actionById('relation.edit')!, relation, document).enabled).toBe(true);
    expect(actionAvailability(actionById('relation.edit')!, property, document).enabled).toBe(false);
    expect(actionAvailability(actionById('definition.add')!, namespace, document).enabled).toBe(true);
    expect(actionAvailability(actionById('definition.add')!, property, document).enabled).toBe(false);
    expect(actionAvailability(actionById('import.set')!, namespace, document).enabled).toBe(true);
    expect(actionAvailability(actionById('root.set')!, namespace, document).enabled).toBe(false);
    expect(actionAvailability(actionById('core.precision')!, '/definitions/Domain/Person', document).enabled).toBe(false);
    expect(actionAvailability(actionById('property.required')!, property, document).enabled).toBe(false);
    expect(actionAvailability(actionById('relation.add')!, property, document).enabled).toBe(false);
    expect(actionAvailability(actionById('validation.minimum')!, '/definitions/Domain/Person', document).enabled).toBe(false);
    expect(actionAvailability(actionById('validation.pattern')!, '/definitions/Domain/Person', document).enabled).toBe(false);
    expect(actionAvailability(actionById('validation.minItems')!, property, document).enabled).toBe(false);
    expect(actionAvailability(actionById('validation.default')!, property, document).enabled).toBe(true);
    expect(actionAvailability(actionById('validation.minimum')!, '/definitions/Domain/Tiny', document).enabled).toBe(true);
    expect(actionAvailability(actionById('validation.minimum')!, '/definitions/Domain/Unknown', document).enabled).toBe(false);
    expect(actionAvailability(actionById('core.precision')!, '/definitions/Domain/Numeric', document).enabled).toBe(true);
  });

  it('sets Core sample-relevant members with minimal edits and supports explicit removal', () => {
    const source = '{"type":"decimal","precision":10,"scale":2}';
    const session = new DocumentSession('memory://core-actions', source);
    const context = { session, documentVersion: session.snapshot().documentVersion };
    const precision = actionById('core.precision')!.create('', 18);
    expect(precision.canExecute(context)).toBe(true);
    expect(precision.execute(context).edits).toEqual([{ range: expect.objectContaining({ startOffset: source.indexOf('10'), endOffset: source.indexOf('10') + 2 }), newText: '18' }]);

    const removeScale = actionById('core.scale.remove')!.create('', undefined);
    expect(removeScale.canExecute(context)).toBe(true);
    expect(removeScale.execute(context).edits[0]?.newText).toBe('');

    const number = new DocumentSession('memory://number-actions', '{"type":"number"}');
    const numberPrecision = actionById('core.precision')!.create('', 15);
    expect(numberPrecision.canExecute({ session: number, documentVersion: number.snapshot().documentVersion })).toBe(true);
  });

  it('preserves exact string-backed numeric bounds through action parsing and command edits', () => {
    for (const [type, raw] of [['int128', '9007199254740993'], ['decimal', '1.2300']] as const) {
      const session = new DocumentSession(`memory://exact-${type}`, `{"$schema":"https://json-structure.org/meta/validation/v0/#","type":"${type}"}`);
      const action = actionById('validation.minimum')!;
      const value = parseActionValue(action, raw, false, type);
      const command = action.create('', value);
      const result = command.execute({ session, documentVersion: 1 });
      expect(result.edits[0]?.newText).toContain(`"minimum":"${raw}"`);
    }
  });

  it('creates document activation and compound Core commands', () => {
    const document = new DocumentSession('memory://document-actions', '{"$schema":"https://json-structure.org/meta/core/v0/#","type":"object","properties":{}}');
    const documentContext = { session: document, documentVersion: document.snapshot().documentVersion };
    for (const [id, value] of [
      ['core.schema', 'https://json-structure.org/meta/extended/v0/#'],
      ['core.id', 'https://example.test/schema'],
      ['core.uses', ['JSONStructureUnits']],
      ['core.offers', { Units: '#/definitions/Units' }]
    ] as const) expect(actionById(id)!.create('', value).canExecute(documentContext)).toBe(true);

    const choice = new DocumentSession('memory://choice-actions', '{"type":"choice","choices":{"text":{"type":"string"}},"selector":"kind"}');
    const choiceContext = { session: choice, documentVersion: choice.snapshot().documentVersion };
    expect(actionById('core.choices')!.create('', { text: { type: 'string' }, count: { type: 'integer' } }).canExecute(choiceContext)).toBe(true);
    expect(actionById('core.selector.remove')!.create('', undefined).canExecute(choiceContext)).toBe(true);

    const namespaces = new DocumentSession('memory://namespace-actions', '{"definitions":{"Existing":{"type":"string"}}}');
    const namespaceContext = { session: namespaces, documentVersion: namespaces.snapshot().documentVersion };
    const addNamespace = actionById('namespace.add')!.create('', 'Domain');
    expect(addNamespace.canExecute(namespaceContext)).toBe(true);
    expect(addNamespace.execute(namespaceContext).edits[0]?.newText).toContain('"Domain":{}');
  });

  it('does not alias experimental Characteristics to a distinct capability profile', () => {
    const capabilities = resolveCapabilities({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $uses: ['JSONStructureCharacteristics'],
      $offers: { Characteristics: '#/definitions/Characteristics' }
    });
    expect(capabilities.semanticAnnotationsActive).toBe(false);
    expect(capabilities.offeredExtensions).toContain('Characteristics');
    expect(capabilities.unknown).toContain('JSONStructureCharacteristics');
  });

  it('offers Relations from its canonical meta-schema and activates it through explicit uses', () => {
    expect(resolveCapabilities({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureRelations']
    })).toMatchObject({
      importActive: true,
      relationsActive: true
    });
  });

  it('discovers collection scopes without coercing reference-typed properties', () => {
    expect(collectionPointers({
      type: 'object',
      properties: {
        owner: { type: { $ref: '#/definitions/Person' } },
        people: { type: 'array', items: { type: { $ref: '#/definitions/Person' } } },
      },
      definitions: { Person: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] } },
    })).toEqual(['#/properties/people']);
  });

  it('uses the selected definition for the document root', () => {
    const session = new DocumentSession('memory://ui-actions', '{"definitions":{"Person":{"type":"object","properties":{}}}}');
    const command = actionById('root.set')!.create('/definitions/Person', undefined);
    const context = { session, documentVersion: session.snapshot().documentVersion };
    expect(command.canExecute(context)).toBe(true);
    expect(command.execute(context).edits[0]?.newText).toContain('"$root":"#/definitions/Person"');
  });

  it('removes the reusable document root selection', () => {
    const session = new DocumentSession('memory://ui-actions', '{"$root":"#/definitions/Person","definitions":{"Person":{"type":"object","properties":{}}}}');
    const command = actionById('root.remove')!.create('/definitions/Person', undefined);
    const context = { session, documentVersion: session.snapshot().documentVersion };
    expect(command.canExecute(context)).toBe(true);
    expect(command.execute(context).edits[0]?.newText).toBe('');
  });

  it('passes alternate-name values through the generic keyword factory', () => {
    const session = new DocumentSession('memory://ui-actions', '{"$schema":"https://json-structure.org/meta/extended/v0/#","$uses":["JSONStructureAlternateNames"],"type":"object","properties":{"name":{"type":"string"}}}');
    const command = actionById('alternate-names.altnames')!.create('/properties/name', { json: 'displayName' });
    const context = { session, documentVersion: session.snapshot().documentVersion };
    expect(command.canExecute(context)).toBe(true);
    expect(command.execute(context).edits[0]?.newText).toContain('"displayName"');
  });

  it('removes an active extension keyword without passing undefined to its setter', () => {
    const session = new DocumentSession('memory://remove-extension', '{"$schema":"https://json-structure.org/meta/extended/v0/#","$uses":["JSONStructureUnits"],"type":"decimal","unit":"m"}');
    const command = actionById('units.unit.remove')!.create('', undefined);
    const context = { session, documentVersion: session.snapshot().documentVersion };
    expect(command.canExecute(context)).toBe(true);
    expect(command.execute(context).edits[0]?.newText).toBe('');

    const smallNumeric = new DocumentSession('memory://small-numeric-unit', '{"$schema":"https://json-structure.org/meta/extended/v0/#","$uses":["JSONStructureUnits"],"type":"int8"}');
    const setUnit = actionById('units.unit')!.create('', 'm');
    expect(setUnit.canExecute({ session: smallNumeric, documentVersion: smallNumeric.snapshot().documentVersion })).toBe(true);
  });

  it('preserves Core and Validation invariants when removing members', () => {
    const core = new DocumentSession('memory://required-core', '{"type":"array","items":{"type":"string"}}');
    expect(actionById('core.items.remove')!.create('', undefined).canExecute({ session: core, documentVersion: core.snapshot().documentVersion })).toBe(false);

    const validation = new DocumentSession('memory://required-validation', '{"$schema":"https://json-structure.org/meta/extended/v0/#","$uses":["JSONStructureValidation"],"type":"array","items":{"type":"string"},"contains":{"type":"string"},"minContains":1}');
    expect(actionById('validation.contains.remove')!.create('', undefined).canExecute({ session: validation, documentVersion: validation.snapshot().documentVersion })).toBe(false);
  });
});