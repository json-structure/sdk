import {
  AddDefinitionCommand, AddNamespaceCommand, AddPropertyCommand, AddRelationCommand, DeleteDefinitionCommand, DeleteImportCommand, DeletePropertyCommand, DeleteRelationCommand,
  EditPropertyCommand, EditRelationCommand, RemoveIdentityCommand, RenameDefinitionCommand, RenamePropertyCommand, RenameRelationCommand,
  RemoveObjectMemberCommand, SetCoreMemberCommand,
  SetAlternateNamesKeywordCommand, SetBinaryAnnotationsCommand, SetCollectionMemberCommand, SetCompositionKeywordCommand,
  SetConditionalCompositionCommand, SetDescriptionCommand, SetIdentityCommand, SetImportCommand,
  SetRelationCardinalityCommand, SetRelationQualifierCommand, SetRelationScopeCommand, SetRequiredCommand, SetRootCommand,
  SetSemanticAnnotationCommand, SetTupleMembersCommand, SetTypeReferenceCommand, SetUnitsKeywordCommand, SetValidationKeywordCommand,
  type EditorCommand
} from '../commands.js';

export type ActionGroup = 'Document' | 'Root' | 'Definitions' | 'Properties' | 'Core' | 'References' | 'Imports' | 'Relations' | 'Validation' | 'Composition' | 'Units' | 'Alternate names' | 'Semantic annotations';
export type ActionCapability = 'core' | 'validation' | 'conditional-composition' | 'units' | 'alternate-names' | 'semantic-annotations' | 'import' | 'relations';
export type ActionTarget = 'document' | 'namespace' | 'declaration' | 'property' | 'relation';
export interface ActionOption { readonly value: string; readonly label: string; }
export type ActionControl =
  | { readonly kind: 'text'; readonly multiline?: boolean }
  | { readonly kind: 'number'; readonly integer?: boolean; readonly minimum?: number }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'select'; readonly options: readonly ActionOption[] }
  | { readonly kind: 'reference-picker' }
  | { readonly kind: 'property-multi-select' }
  | { readonly kind: 'relation-editor' }
  | { readonly kind: 'catalog'; readonly family: string }
  | { readonly kind: 'structured-list'; readonly item: 'text' | 'number' | 'reference' | 'schema' }
  | { readonly kind: 'structured-object'; readonly family?: string }
  | { readonly kind: 'advanced-json' };

export interface CommandAction {
  readonly id: string;
  readonly group: ActionGroup;
  readonly label: string;
  readonly help: string;
  readonly valueLabel?: string;
  readonly requiresValue?: boolean;
  readonly control?: ActionControl;
  readonly capability?: ActionCapability;
  readonly targets?: readonly ActionTarget[];
  readonly schemaTypes?: readonly string[];
  readonly operation?: 'set' | 'remove' | 'add' | 'rename' | 'delete';
  readonly removesActionId?: string;
  readonly keyword?: string;
  readonly create: (pointer: string, value: unknown, name?: string) => EditorCommand;
}

type CommandConstructor = new (...args: any[]) => EditorCommand;

const set = (Command: CommandConstructor, keyword: string): CommandAction['create'] =>
  (pointer, value) => new Command(pointer, keyword, value);
const named = (Command: CommandConstructor): CommandAction['create'] =>
  (pointer, value, name) => new Command(pointer, name ?? '', value as never);
const core = (id: string, keyword: ConstructorParameters<typeof SetCoreMemberCommand>[1], label: string, control: ActionControl, targets: readonly ActionTarget[] = ['declaration']): CommandAction => ({
  id: `core.${id}`, group: targets.length === 1 && targets[0] === 'document' ? 'Document' : 'Core', label, help: `Set ${keyword} on the selected ${targets.includes('document') ? 'document' : 'declaration'}.`,
  valueLabel: label, control, capability: 'core', targets, operation: 'set', removesActionId: `core.${id}.remove`, keyword,
  create: (pointer, value) => new SetCoreMemberCommand(pointer, keyword, value)
});
const remove = (action: CommandAction, keyword: string, Command?: CommandConstructor): CommandAction => ({
  id: action.removesActionId!, group: action.group, label: `Remove ${action.label.replace(/^Set /, '')}`, help: `Remove ${keyword} from the selected object.`,
  requiresValue: false, capability: action.capability, targets: action.targets, schemaTypes: action.schemaTypes, operation: 'remove', keyword,
  create: (pointer) => Command ? new Command(pointer, keyword, undefined) : new RemoveObjectMemberCommand(pointer, keyword)
});
const coreActions = [
  core('schema', '$schema', 'Set document schema', { kind: 'text' }, ['document']),
  core('uses', '$uses', 'Set document uses', { kind: 'structured-list', item: 'text' }, ['document']),
  core('offers', '$offers', 'Set document offers', { kind: 'structured-object', family: 'offers' }, ['document']),
  core('type', 'type', 'Set type', { kind: 'select', options: [
    'null', 'boolean', 'string', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'integer', 'float8', 'float', 'double', 'decimal',
    'number', 'date', 'datetime', 'time', 'duration', 'uuid', 'uri', 'binary', 'jsonpointer', 'object', 'array', 'map', 'set', 'tuple', 'choice'
  ].map((value) => ({ value, label: value })) }),
  core('enum', 'enum', 'Set enum', { kind: 'structured-list', item: 'text' }),
  core('const', 'const', 'Set const', { kind: 'advanced-json' }),
  core('abstract', 'abstract', 'Set abstract', { kind: 'boolean' }),
  core('extends', '$extends', 'Set extends', { kind: 'structured-list', item: 'reference' }),
  core('choice', 'type', 'Set choice type', { kind: 'select', options: [{ value: 'choice', label: 'choice' }] }),
  { ...core('choices', 'choices', 'Set choices', { kind: 'structured-object', family: 'choice' }), schemaTypes: ['choice'] },
  { ...core('selector', 'selector', 'Set selector', { kind: 'text' }), schemaTypes: ['choice'] },
  { ...core('additional-properties', 'additionalProperties', 'Set additional properties', { kind: 'advanced-json' }), schemaTypes: ['object'] },
  { ...core('precision', 'precision', 'Set precision', { kind: 'number', integer: true, minimum: 0 }), schemaTypes: ['number', 'decimal'] },
  { ...core('scale', 'scale', 'Set scale', { kind: 'number', integer: true, minimum: 0 }), schemaTypes: ['number', 'decimal'] },
  { ...core('properties', 'properties', 'Set properties', { kind: 'structured-object', family: 'properties' }), schemaTypes: ['object', 'tuple'] },
  { ...core('required', 'required', 'Set required', { kind: 'property-multi-select' }), schemaTypes: ['object'] },
  { ...core('items', 'items', 'Set items', { kind: 'structured-object', family: 'schema' }), schemaTypes: ['array', 'set'] },
  { ...core('values', 'values', 'Set values', { kind: 'structured-object', family: 'schema' }), schemaTypes: ['map'] },
  { ...core('tuple', 'tuple', 'Set tuple order', { kind: 'property-multi-select' }), schemaTypes: ['tuple'] },
  core('definitions', 'definitions', 'Create namespace', { kind: 'structured-object', family: 'namespace' }, ['document', 'namespace'])
] as const;

/** Declarative command surface used by the shared workbench and tests. */
export const commandActions: readonly CommandAction[] = [
  ...coreActions.flatMap((action) => [action, remove(action, action.keyword!)]),
  { id: 'root.set', group: 'Root', label: 'Set document root', help: 'Use the selected reusable definition as the document root.', requiresValue: false, targets: ['declaration'], create: (pointer) => new SetRootCommand(pointer) },
  { id: 'namespace.add', group: 'Definitions', label: 'Add namespace', help: 'Add a named namespace under definitions.', valueLabel: 'Namespace name', control: { kind: 'text' }, capability: 'core', targets: ['document', 'namespace'], operation: 'add', create: (pointer, value, name) => new AddNamespaceCommand(pointer, name ?? String(value)) },
  { id: 'definition.add', group: 'Definitions', label: 'Add definition', help: 'Add a named schema to the selected namespace.', valueLabel: 'Schema JSON', targets: ['document', 'namespace'], create: named(AddDefinitionCommand as unknown as CommandConstructor) },
  { id: 'definition.rename', group: 'Definitions', label: 'Rename definition', help: 'Rename the selected reusable definition when it has no references.', valueLabel: 'New name', targets: ['declaration'], create: (pointer, value) => new RenameDefinitionCommand(pointer, String(value)) },
  { id: 'definition.delete', group: 'Definitions', label: 'Delete definition', help: 'Delete the selected reusable definition when it has no references.', requiresValue: false, targets: ['declaration'], create: (pointer) => new DeleteDefinitionCommand(pointer) },
  { id: 'property.add', group: 'Properties', label: 'Add property', help: 'Add a named property schema to the selected object.', valueLabel: 'Schema JSON', targets: ['document', 'declaration'], schemaTypes: ['object'], create: named(AddPropertyCommand as unknown as CommandConstructor) },
  { id: 'property.rename', group: 'Properties', label: 'Rename property', help: 'Rename the selected property.', valueLabel: 'New name', targets: ['property'], create: (pointer, value) => new RenamePropertyCommand(pointer, String(value)) },
  { id: 'property.edit', group: 'Properties', label: 'Edit property', help: 'Replace the selected property schema.', valueLabel: 'Schema JSON', targets: ['property'], create: (pointer, value) => new EditPropertyCommand(pointer, value as never) },
  { id: 'property.delete', group: 'Properties', label: 'Delete property', help: 'Delete the selected property.', requiresValue: false, targets: ['property'], create: (pointer) => new DeletePropertyCommand(pointer) },
  { id: 'property.required', group: 'Properties', label: 'Set required properties', help: 'Set the selected object required property list.', valueLabel: 'Required names JSON', targets: ['document', 'declaration'], schemaTypes: ['object'], create: (pointer, value) => new SetRequiredCommand(pointer, value as never) },
  { id: 'property.description', group: 'Properties', label: 'Set description', help: 'Set or remove a schema description.', valueLabel: 'Description', targets: ['document', 'declaration', 'property'], create: (pointer, value) => new SetDescriptionCommand(pointer, value === undefined ? undefined : String(value)) },
  { id: 'property.collection-member', group: 'Properties', label: 'Set collection member', help: 'Set items or values for the selected collection.', valueLabel: 'Schema JSON', targets: ['document', 'declaration', 'property'], schemaTypes: ['array', 'set', 'map'], create: (pointer, value) => new SetCollectionMemberCommand(pointer, value as never) },
  { id: 'property.tuple-members', group: 'Properties', label: 'Set tuple members', help: 'Set tuple properties and their order.', valueLabel: 'Tuple JSON: {"properties":{},"order":[]}', targets: ['document', 'declaration', 'property'], schemaTypes: ['tuple'], create: (pointer, value) => { const tuple = value as { properties: Record<string, Record<string, unknown>>; order: string[] }; return new SetTupleMembersCommand(pointer, tuple.properties, tuple.order); } },
  { id: 'reference.type', group: 'References', label: 'Set type reference', help: 'Set the selected declaration type to a reusable local reference.', valueLabel: 'Reference', control: { kind: 'reference-picker' }, capability: 'core', targets: ['declaration', 'property'], operation: 'set', create: (pointer, value) => new SetTypeReferenceCommand(pointer, String(value)) },
  { id: 'import.set', group: 'Imports', label: 'Set import', help: 'Set $import or $importdefs on the selected namespace.', valueLabel: 'Import JSON: {"keyword":"$import","source":"https://..."}', capability: 'import', targets: ['document', 'namespace'], create: (pointer, value) => { const importValue = value as { keyword: '$import' | '$importdefs'; source: string }; return new SetImportCommand(pointer, importValue.keyword, importValue.source); } },
  { id: 'import.delete', group: 'Imports', label: 'Delete import', help: 'Remove an import from the selected namespace.', valueLabel: 'Keyword', capability: 'import', targets: ['document', 'namespace'], create: (pointer, value) => new DeleteImportCommand(pointer, String(value) as '$import' | '$importdefs') },
  { id: 'relation.add', group: 'Relations', label: 'Add relation', help: 'Add a named relation to the selected object.', valueLabel: 'Relation', control: { kind: 'relation-editor' }, capability: 'relations', targets: ['document', 'declaration'], schemaTypes: ['object', 'tuple'], create: named(AddRelationCommand as unknown as CommandConstructor) },
  { id: 'relation.edit', group: 'Relations', label: 'Edit relation', help: 'Replace the selected relation.', valueLabel: 'Relation', control: { kind: 'relation-editor' }, capability: 'relations', targets: ['relation'], create: (pointer, value) => new EditRelationCommand(pointer, value as never) },
  { id: 'relation.rename', group: 'Relations', label: 'Rename relation', help: 'Rename the selected relation.', valueLabel: 'New name', capability: 'relations', targets: ['relation'], create: (pointer, value) => new RenameRelationCommand(pointer, String(value)) },
  { id: 'relation.delete', group: 'Relations', label: 'Delete relation', help: 'Delete the selected relation.', requiresValue: false, capability: 'relations', targets: ['relation'], create: (pointer) => new DeleteRelationCommand(pointer) },
  { id: 'relation.identity', group: 'Relations', label: 'Set identity', help: 'Choose and order the properties that form the selected type identity.', valueLabel: 'Identity properties', control: { kind: 'property-multi-select' }, capability: 'relations', targets: ['document', 'declaration'], schemaTypes: ['object', 'tuple'], operation: 'set', removesActionId: 'relation.remove-identity', keyword: 'identity', create: (pointer, value) => new SetIdentityCommand(pointer, value as never) },
  { id: 'relation.remove-identity', group: 'Relations', label: 'Remove identity', help: 'Remove the selected identity when no inbound relation depends on it.', requiresValue: false, capability: 'relations', targets: ['document', 'declaration'], schemaTypes: ['object', 'tuple'], create: (pointer) => new RemoveIdentityCommand(pointer) },
  { id: 'relation.cardinality', group: 'Relations', label: 'Set relation cardinality', help: 'Set a relation to single or multiple.', valueLabel: 'Cardinality', control: { kind: 'select', options: [{ value: 'single', label: 'single' }, { value: 'multiple', label: 'multiple' }] }, capability: 'relations', targets: ['relation'], operation: 'set', keyword: 'cardinality', create: (pointer, value) => new SetRelationCardinalityCommand(pointer, String(value) as 'single' | 'multiple') },
  { id: 'relation.scope', group: 'Relations', label: 'Set relation scope', help: 'Choose one or more collection locations that contain relation targets.', valueLabel: 'Scope', control: { kind: 'structured-list', item: 'reference' }, capability: 'relations', targets: ['relation'], operation: 'set', keyword: 'scope', create: (pointer, value) => new SetRelationScopeCommand(pointer, value as never) },
  { id: 'relation.qualifier', group: 'Relations', label: 'Set relation qualifier', help: 'Set a reusable qualifier type reference.', valueLabel: 'Qualifier type', control: { kind: 'reference-picker' }, capability: 'relations', targets: ['relation'], operation: 'set', keyword: 'qualifiertype', create: (pointer, value) => new SetRelationQualifierCommand(pointer, String(value)) },
  ...keywordActions('Validation', 'validation', ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'minContains', 'maxContains', 'minProperties', 'maxProperties', 'minEntries', 'maxEntries', 'default', 'contains', 'propertyNames', 'keyNames', 'has', 'dependentRequired', 'patternProperties', 'patternKeys'], SetValidationKeywordCommand as unknown as CommandConstructor),
  ...keywordActions('Composition', 'composition', ['allOf', 'anyOf', 'oneOf', 'not'], SetCompositionKeywordCommand as unknown as CommandConstructor),
  { id: 'composition.conditional', group: 'Composition', label: 'Set conditional composition', help: 'Set if, then, and else as one structured value.', valueLabel: 'Conditional composition', control: { kind: 'structured-object', family: 'conditional-composition' }, capability: 'conditional-composition', targets: ['declaration', 'property'], operation: 'set', removesActionId: 'composition.conditional.remove', create: (pointer, value) => new SetConditionalCompositionCommand(pointer, value as never) },
  { id: 'composition.conditional.remove', group: 'Composition', label: 'Remove conditional composition', help: 'Remove if, then, and else from the selected schema.', requiresValue: false, capability: 'conditional-composition', targets: ['declaration', 'property'], operation: 'remove', create: (pointer) => new SetConditionalCompositionCommand(pointer, undefined) },
  ...keywordActions('Units', 'units', ['symbol', 'symbols', 'unit', 'ucumUnit', 'currency'], SetUnitsKeywordCommand as unknown as CommandConstructor),
  ...keywordActions('Alternate names', 'alternate-names', ['altnames'], SetAlternateNamesKeywordCommand as unknown as CommandConstructor),
  ...keywordActions('Alternate names', 'alternate-enums', ['altenums'], SetAlternateNamesKeywordCommand as unknown as CommandConstructor),
  ...keywordActions('Alternate names', 'localized-descriptions', ['descriptions'], SetAlternateNamesKeywordCommand as unknown as CommandConstructor),
  ...keywordActions('Semantic annotations', 'semantic', ['concepts', 'observedProperty', 'semanticRole', 'derivation', 'statistic', 'codedValues', 'measurementConditioning', 'referenceRole', 'phenomenonTimeRelation', 'supportPeriod', 'temporalReferenceSystem', 'cadence', 'coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames', 'frameTransforms', 'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands'], SetSemanticAnnotationCommand as unknown as CommandConstructor),
  ...keywordActions('Properties', 'binary', ['contentEncoding', 'contentCompression', 'contentMediaType'], SetBinaryAnnotationsCommand as unknown as CommandConstructor)
];

export function actionById(id: string): CommandAction | undefined { return commandActions.find((action) => action.id === id); }

function keywordActions(group: ActionGroup, prefix: string, keywords: readonly string[], Command: CommandConstructor): readonly CommandAction[] {
  const capability = prefix === 'validation' ? 'validation' : prefix === 'composition' ? 'conditional-composition' : prefix === 'units' ? 'units' :
    prefix.startsWith('alternate') || prefix === 'localized-descriptions' ? 'alternate-names' : prefix === 'semantic' ? 'semantic-annotations' : 'core';
  return keywords.flatMap((keyword) => {
    const control: ActionControl = keyword === 'uniqueItems' ? { kind: 'boolean' } :
      ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minContains', 'maxContains', 'minProperties', 'maxProperties', 'minEntries', 'maxEntries'].includes(keyword)
        ? { kind: 'number' } :
      ['ucumUnit', 'currency', 'observedProperty', 'semanticRole', 'derivation', 'statistic', 'codedValues', 'measurementConditioning', 'referenceRole', 'phenomenonTimeRelation', 'temporalReferenceSystem', 'cadence', 'coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames', 'frameTransforms', 'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands'].includes(keyword) ? { kind: 'catalog', family: keyword } :
      ['format', 'contentEncoding', 'contentCompression', 'pattern', 'symbol', 'unit', 'contentMediaType'].includes(keyword) ? { kind: 'text' } :
      ['allOf', 'anyOf', 'oneOf', 'concepts'].includes(keyword) ? { kind: 'structured-list', item: keyword === 'concepts' ? 'text' : 'schema' } :
      ['not', 'contains', 'propertyNames', 'keyNames', 'has'].includes(keyword) ? { kind: 'structured-object', family: 'schema' } :
      { kind: 'advanced-json' };
    const action: CommandAction = { id: `${prefix}.${keyword}`, group, label: `Set ${keyword}`, help: `Set ${keyword} on the selected schema.`, valueLabel: `Set ${keyword}`, control, capability, targets: ['declaration', 'property'], schemaTypes: schemaTypesForKeyword(prefix, keyword), operation: 'set', removesActionId: `${prefix}.${keyword}.remove`, create: set(Command, keyword) };
    return [action, remove(action, keyword, Command)];
  });
}

function schemaTypesForKeyword(prefix: string, keyword: string): readonly string[] | undefined {
  if (prefix === 'binary') return ['binary'];
  if (prefix === 'units') return ['number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal'];
  if (prefix !== 'validation' || keyword === 'default') return undefined;
  if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].includes(keyword)) return ['number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal'];
  if (['minLength', 'maxLength', 'pattern', 'format'].includes(keyword)) return ['string'];
  if (['minItems', 'maxItems', 'minContains', 'maxContains', 'contains'].includes(keyword)) return ['array', 'set'];
  if (keyword === 'uniqueItems') return ['array'];
  if (['minProperties', 'maxProperties', 'propertyNames', 'dependentRequired', 'patternProperties'].includes(keyword)) return ['object'];
  if (['minEntries', 'maxEntries', 'keyNames', 'patternKeys'].includes(keyword)) return ['map'];
  if (keyword === 'has') return ['object', 'map'];
  return undefined;
}