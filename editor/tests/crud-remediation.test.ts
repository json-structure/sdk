import { describe, expect, it } from 'vitest';
import {
  AddChoiceCommand,
  AddDefinitionCommand,
  AddNamespaceCommand,
  AddPropertyCommand,
  DeleteChoiceCommand,
  DeleteNamespaceCommand,
  DeletePropertyCommand,
  DocumentSession,
  EditPropertyCommand,
  RenameChoiceCommand,
  RenameDefinitionCommand,
  RenameNamespaceCommand,
  RenamePropertyCommand,
  SetCoreMemberCommand,
  SetDescriptionCommand,
  type EditorCommand,
} from '../src/index.js';

function apply(source: string, command: EditorCommand): string {
  const session = new DocumentSession('memory://crud-remediation', source);
  const context = { session, documentVersion: session.snapshot().documentVersion };
  expect(command.canExecute(context)).toBe(true);
  return applyEdits(source, command.execute(context).edits);
}

function applyEdits(source: string, edits: readonly { readonly range: { readonly startOffset?: number; readonly endOffset?: number }; readonly newText: string }[]): string {
  return [...edits]
    .sort((left, right) => right.range.startOffset! - left.range.startOffset!)
    .reduce((text, edit) => text.slice(0, edit.range.startOffset) + edit.newText + text.slice(edit.range.endOffset), source);
}

const relationsProfile = {
  $schema: 'https://json-structure.org/meta/relations/v0/#',
  $uses: ['JSONStructureRelations'],
};

describe('structured CRUD remediation commands', () => {
  it('atomically renames and deletes object members in required, identity, dependentRequired, and scopes', () => {
    const source = JSON.stringify({
      ...relationsProfile,
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' }, stable: { type: 'string' } }, identity: ['id', 'stable'] },
        Owners: { type: 'array', items: { type: { $ref: '#/definitions/Target' } } },
        Source: {
          type: 'object',
          properties: { id: { type: 'string' }, values: { type: 'array', items: { type: { $ref: '#/definitions/Target' } } } },
          required: ['id'],
          identity: ['id'],
          dependentRequired: { id: ['values'], values: ['id'] },
          relations: { target: { targettype: { $ref: '#/definitions/Target' }, cardinality: 'single', scope: '#/definitions/Source/properties/values' } },
        },
      },
    });
    const renamedText = apply(source, new RenamePropertyCommand('/definitions/Source/properties/values', 'entries'));
    const renamed = JSON.parse(renamedText);
    expect(renamed.definitions.Source.properties).toHaveProperty('entries');
    expect(renamed.definitions.Source.dependentRequired).toEqual({ id: ['entries'], entries: ['id'] });
    expect(renamed.definitions.Source.relations.target.scope).toBe('#/definitions/Source/properties/entries');

    const deletedText = apply(renamedText, new DeletePropertyCommand('/definitions/Source/properties/id'));
    const deleted = JSON.parse(deletedText);
    expect(deleted.definitions.Source.properties).not.toHaveProperty('id');
    expect(deleted.definitions.Source).not.toHaveProperty('required');
    expect(deleted.definitions.Source).not.toHaveProperty('identity');
    expect(deleted.definitions.Source.dependentRequired).toEqual({ entries: [] });
  });

  it('consolidates adjacent owner-member removals and restores byte-identical source', () => {
    const source = `{
  "$schema": "https://json-structure.org/meta/relations/v0/#",
  "$uses": ["JSONStructureRelations"],
  "definitions": {
    "Source": {
      "properties": {
        "id": { "type": "string" },
        "keep": { "type": "string" }
      },
      "required": ["id"],
      "identity": ["id"],
      "type": "object"
    }
  }
}`;
    const session = new DocumentSession('memory://adjacent-owner-removals', source);
    const command = new DeletePropertyCommand('/definitions/Source/properties/id');
    const context = { session, documentVersion: 1 };
    expect(command.canExecute(context)).toBe(true);
    const result = command.execute(context);
    const ordered = [...result.edits].sort((left, right) => left.range.startOffset! - right.range.startOffset!);
    for (let index = 1; index < ordered.length; index++) {
      expect(ordered[index - 1]!.range.endOffset).toBeLessThanOrEqual(ordered[index]!.range.startOffset!);
    }
    const changed = applyEdits(source, result.edits);
    expect(JSON.parse(changed).definitions.Source).toEqual({
      properties: { keep: { type: 'string' } },
      type: 'object',
    });
    expect(applyEdits(changed, result.inverseEdits)).toBe(source);
  });

  it('merges dependentRequired destination keys when a property is renamed', () => {
    const source = JSON.stringify({
      $schema: 'https://json-structure.org/meta/validation/v0/#',
      definitions: {
        Source: {
          type: 'object',
          properties: {
            old: { type: 'string' },
            x: { type: 'string' },
            y: { type: 'string' },
          },
          dependentRequired: {
            old: ['x'],
            renamed: ['y'],
          },
        },
      },
    });
    const renamed = JSON.parse(apply(source, new RenamePropertyCommand('/definitions/Source/properties/old', 'renamed')));
    expect(renamed.definitions.Source.dependentRequired).toEqual({ renamed: ['x', 'y'] });
  });

  it('keeps tuple membership and order synchronized through add, rename, reorder, and delete', () => {
    const source = JSON.stringify({
      definitions: {
        Pair: { type: 'tuple', properties: { first: { type: 'string' } }, tuple: ['first'] },
      },
    });
    const addedText = apply(source, new AddPropertyCommand('/definitions/Pair', 'second', { type: 'integer' }));
    expect(JSON.parse(addedText).definitions.Pair.tuple).toEqual(['first', 'second']);

    const renamedText = apply(addedText, new RenamePropertyCommand('/definitions/Pair/properties/first', 'primary'));
    expect(JSON.parse(renamedText).definitions.Pair.tuple).toEqual(['primary', 'second']);

    const deletedText = apply(renamedText, new DeletePropertyCommand('/definitions/Pair/properties/second'));
    const tuple = JSON.parse(deletedText).definitions.Pair;
    expect(tuple.properties).toEqual({ primary: { type: 'string' } });
    expect(tuple.tuple).toEqual(['primary']);
  });

  it('creates, renames, mutates, and deletes choice alternatives without Source mode', () => {
    const source = JSON.stringify({
      definitions: {
        Value: { type: 'choice', choices: { text: { type: 'string' } } },
      },
    });
    const addedText = apply(source, new AddChoiceCommand('/definitions/Value', 'count', { type: 'integer' }));
    const renamedText = apply(addedText, new RenameChoiceCommand('/definitions/Value/choices/count', 'quantity'));
    const mutatedText = apply(renamedText, new EditPropertyCommand('/definitions/Value/choices/quantity', { type: 'array', items: { type: 'string' } }));
    expect(JSON.parse(mutatedText).definitions.Value.choices.quantity).toEqual({ type: 'array', items: { type: 'string' } });
    const deletedText = apply(mutatedText, new DeleteChoiceCommand('/definitions/Value/choices/text'));
    expect(JSON.parse(deletedText).definitions.Value.choices).toEqual({ quantity: { type: 'array', items: { type: 'string' } } });
  });

  it('adds nested types and child namespaces directly without a definitions wrapper', () => {
    const source = JSON.stringify({ $schema: 'https://json-structure.org/meta/core/v0/#', $id: 'urn:nested-additions', name: 'NestedAdditions', definitions: { Domain: {} } });
    const session = new DocumentSession('memory://nested-additions', source);
    const typeCommand = new AddDefinitionCommand('/definitions/Domain', 'Thing', { type: 'string' });
    const context = { session, documentVersion: session.snapshot().documentVersion };
    expect(typeCommand.canExecute(context)).toBe(true);
    const typeResult = typeCommand.execute(context);
    const withType = applyEdits(source, typeResult.edits);
    expect(JSON.parse(withType).definitions.Domain).toEqual({ Thing: { type: 'string' } });

    expect(new DocumentSession('memory://nested-additions', withType).snapshot().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toHaveLength(0);
    expect(applyEdits(withType, typeResult.inverseEdits)).toBe(source);

    const childSession = new DocumentSession('memory://nested-additions', withType);
    const childCommand = new AddNamespaceCommand('/definitions/Domain', 'Child');
    const childContext = { session: childSession, documentVersion: childSession.snapshot().documentVersion };
    expect(childCommand.canExecute(childContext)).toBe(true);
    const childResult = childCommand.execute(childContext);
    const withChild = applyEdits(withType, childResult.edits);
    expect(JSON.parse(withChild).definitions.Domain).toEqual({ Thing: { type: 'string' }, Child: {} });
    expect(new DocumentSession('memory://nested-additions', withChild).snapshot().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toHaveLength(0);
    expect(applyEdits(withChild, childResult.inverseEdits)).toBe(withType);
  });
  it('does not edit relation scopes inside a deleted property subtree', () => {
    const source = JSON.stringify({
      $schema: 'https://json-structure.org/meta/relations/v0/#',
      $uses: ['JSONStructureRelations'],
      $id: 'urn:scope-deletion',
      name: 'ScopeDeletion',
      definitions: {
        Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        Owner: {
          type: 'object',
          properties: {
            doomed: {
              type: 'object',
              properties: { nested: { type: 'string' } },
              relations: { inner: { targettype: { $ref: '#/definitions/Target' }, cardinality: 'single', scope: '#/definitions/Owner/properties/doomed' } },
            },
            keep: { type: 'string' },
          },
        },
        External: {
          type: 'object',
          properties: { keep: { type: 'string' } },
          relations: { owner: { targettype: { $ref: '#/definitions/Target' }, cardinality: 'single', scope: ['#/definitions/Owner/properties/doomed', '#/definitions/External/properties/keep'] } },
        },
      },
    });
    const session = new DocumentSession('memory://scope-deletion', source);
    const command = new DeletePropertyCommand('/definitions/Owner/properties/doomed');
    const context = { session, documentVersion: session.snapshot().documentVersion };
    expect(command.canExecute(context)).toBe(true);
    const result = command.execute(context);
    const changed = applyEdits(source, result.edits);
    const value = JSON.parse(changed);
    expect(value.definitions.Owner.properties).toEqual({ keep: { type: 'string' } });
    expect(value.definitions.External.relations.owner.scope).toEqual(['#/definitions/External/properties/keep']);
    expect(applyEdits(changed, result.inverseEdits)).toBe(source);
  });
  it('renames namespaces with contained references and safely gates deletion', () => {
    const source = JSON.stringify({
      $root: '#/definitions/Domain/Thing',
      definitions: {
        Domain: { Thing: { type: 'object', properties: {} } },
        Alias: { type: { $ref: '#/definitions/Domain/Thing' } },
        Empty: {},
      },
    });
    const renamedText = apply(source, new RenameNamespaceCommand('/definitions/Domain', 'Model'));
    const renamed = JSON.parse(renamedText);
    expect(renamed.$root).toBe('#/definitions/Model/Thing');
    expect(renamed.definitions.Alias.type.$ref).toBe('#/definitions/Model/Thing');
    expect(renamed.definitions).not.toHaveProperty('Domain');

    const referenced = new DocumentSession('memory://namespace-delete', renamedText);
    expect(new DeleteNamespaceCommand('/definitions/Model', true).canExecute({ session: referenced, documentVersion: 1 })).toBe(false);
    const emptyDeleted = apply(renamedText, new DeleteNamespaceCommand('/definitions/Empty'));
    expect(JSON.parse(emptyDeleted).definitions).not.toHaveProperty('Empty');
  });

  it('rewrites only parser-owned references and leaves literal $ref payloads untouched', () => {
    const source = JSON.stringify({
      $schema: 'https://json-structure.org/meta/semantic-annotations/v0/#',
      $uses: ['JSONStructureRelations'],
      $root: '#/definitions/Domain/Target',
      definitions: {
        Domain: {
          Target: { type: 'object', properties: { id: { type: 'string' } }, identity: ['id'] },
        },
        Alias: { type: { $ref: '#/definitions/Domain/Target' } },
        Source: {
          type: 'object',
          properties: {
            old: { type: 'any' },
            payload: {
              type: 'any',
              default: { $ref: '#/definitions/Source/properties/old' },
              const: { $ref: '#/definitions/Choice/choices/old' },
              examples: [{ $ref: '#/definitions/Domain/Target' }],
              opaque: { nested: { $ref: '#/definitions/Domain/Target' } },
            },
          },
          relations: {
            target: {
              targettype: { $ref: '#/definitions/Domain/Target' },
              cardinality: 'single',
              scope: '#/definitions/Source/properties/old',
            },
          },
        },
        Choice: { type: 'choice', choices: { old: { type: 'string' } } },
      },
    });
    const namespaceRenamed = apply(source, new RenameNamespaceCommand('/definitions/Domain', 'Model'));
    const definitionRenamed = apply(namespaceRenamed, new RenameDefinitionCommand('/definitions/Model/Target', 'Entity'));
    const propertyRenamed = apply(definitionRenamed, new RenamePropertyCommand('/definitions/Source/properties/old', 'renamed'));
    const choiceRenamed = apply(propertyRenamed, new RenameChoiceCommand('/definitions/Choice/choices/old', 'renamed'));
    const value = JSON.parse(choiceRenamed);

    expect(value.$root).toBe('#/definitions/Model/Entity');
    expect(value.definitions.Alias.type.$ref).toBe('#/definitions/Model/Entity');
    expect(value.definitions.Source.relations.target).toMatchObject({
      targettype: { $ref: '#/definitions/Model/Entity' },
      scope: '#/definitions/Source/properties/renamed',
    });
    expect(value.definitions.Source.properties.payload).toMatchObject({
      default: { $ref: '#/definitions/Source/properties/old' },
      const: { $ref: '#/definitions/Choice/choices/old' },
      examples: [{ $ref: '#/definitions/Domain/Target' }],
      opaque: { nested: { $ref: '#/definitions/Domain/Target' } },
    });
  });

  it('changes declaration shapes transactionally while preserving legal metadata', () => {
    const source = JSON.stringify({
      definitions: {
        Value: {
          type: 'object',
          name: 'Value',
          description: 'Reusable value',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
          minProperties: 1,
        },
      },
    });
    const arrayText = apply(source, new SetCoreMemberCommand('/definitions/Value', 'type', 'array'));
    expect(JSON.parse(arrayText).definitions.Value).toEqual({
      type: 'array',
      name: 'Value',
      description: 'Reusable value',
      items: { type: 'string' },
    });
    const tupleText = apply(arrayText, new SetCoreMemberCommand('/definitions/Value', 'type', 'tuple'));
    expect(JSON.parse(tupleText).definitions.Value).toEqual({
      type: 'tuple',
      name: 'Value',
      description: 'Reusable value',
      properties: {},
      tuple: [],
    });
  });

  it('normalizes declaration, property, and choice type changes while preserving legal annotations', () => {
    const annotatedNumber = {
      type: 'number',
      description: 'Measured value',
      minimum: 0,
      precision: 3,
      unit: 'm',
      concepts: [{ reference: 'urn:concept:length', kind: 'custom-concept' }],
    };
    const source = JSON.stringify({
      $schema: 'https://json-structure.org/meta/semantic-annotations/v0/#',
      $uses: ['JSONStructureSemanticAnnotations'],
      definitions: {
        Measure: annotatedNumber,
        Holder: { type: 'object', properties: { measure: annotatedNumber } },
        Variant: { type: 'choice', choices: { measure: annotatedNumber } },
      },
    });
    const expected = {
      type: 'string',
      description: 'Measured value',
      concepts: [{ reference: 'urn:concept:length', kind: 'custom-concept' }],
    };
    expect(JSON.parse(apply(source, new SetCoreMemberCommand('/definitions/Measure', 'type', 'string'))).definitions.Measure).toEqual(expected);
    expect(JSON.parse(apply(source, new EditPropertyCommand('/definitions/Holder/properties/measure', { ...annotatedNumber, type: 'string' }))).definitions.Holder.properties.measure).toEqual(expected);
    expect(JSON.parse(apply(source, new EditPropertyCommand('/definitions/Variant/choices/measure', { ...annotatedNumber, type: 'string' }))).definitions.Variant.choices.measure).toEqual(expected);
  });

  it('atomically migrates multi-member shapes and restores the exact original source', () => {
    const source = `{
  "definitions": {
    "Value": {
      "type": "object",
      "description": "keep",
      "properties": { "id": { "type": "string" } },
      "required": ["id"],
      "additionalProperties": false,
      "minProperties": 1
    }
  }
}`;
    const session = new DocumentSession('memory://shape-round-trip', source);
    const command = new SetCoreMemberCommand('/definitions/Value', 'type', 'array');
    const context = { session, documentVersion: 1 };
    expect(command.canExecute(context)).toBe(true);
    const result = command.execute(context);
    expect(result.edits).toHaveLength(1);
    const changed = applyEdits(source, result.edits);
    expect(JSON.parse(changed).definitions.Value).toEqual({
      type: 'array',
      description: 'keep',
      items: { type: 'string' },
    });
    expect(applyEdits(changed, result.inverseEdits)).toBe(source);
  });

  it('sets and removes document descriptions on reference-root documents', () => {
    const source = JSON.stringify({ $root: '#/definitions/Root', definitions: { Root: { type: 'string' } } });
    const describedText = apply(source, new SetDescriptionCommand('', 'Document description'));
    expect(JSON.parse(describedText).description).toBe('Document description');
    const clearedText = apply(describedText, new SetDescriptionCommand('', undefined));
    expect(JSON.parse(clearedText)).not.toHaveProperty('description');
  });
});
