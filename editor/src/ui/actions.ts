import type { ConditionalCompositionGroup } from '../composition.js';

import {
  AddChoiceCommand, AddDefinitionCommand, AddNamespaceCommand, AddPropertyCommand, AddRelationCommand, DeleteChoiceCommand, DeleteDefinitionCommand, DeleteImportCommand, DeleteNamespaceCommand, DeletePropertyCommand, DeleteRelationCommand,
  EditPropertyCommand, EditRelationCommand, RemoveIdentityCommand, RenameChoiceCommand, RenameDefinitionCommand, RenameNamespaceCommand, RenamePropertyCommand, RenameRelationCommand,
  RemoveObjectMemberCommand, SetCoreMemberCommand,
  SetAlternateNamesKeywordCommand, SetBinaryAnnotationsCommand, SetCollectionMemberCommand, SetCompositionKeywordCommand,
  SetConditionalCompositionCommand, SetDescriptionCommand, SetIdentityCommand, SetImportCommand,
  SetRelationCardinalityCommand, SetRelationQualifierCommand, SetRelationScopeCommand, SetRequiredCommand, SetRootCommand,
  SetSemanticAnnotationCommand, SetTupleMembersCommand, SetTypeReferenceCommand, SetUnitsKeywordCommand, SetValidationKeywordCommand,
  type EditorCommand, type PropertySchema, type RelationSchema, type RequiredProperties, type SchemaTypeValue
} from '../commands.js';

export type ActionGroup = 'Document' | 'Root' | 'Definitions' | 'Properties' | 'Core' | 'References' | 'Imports' | 'Relations' | 'Validation' | 'Composition' | 'Units' | 'Alternate names' | 'Semantic annotations';
export type ActionCapability = 'core' | 'validation' | 'conditional-composition' | 'units' | 'alternate-names' | 'semantic-annotations' | 'import' | 'relations';
export type ActionTarget = 'document' | 'namespace' | 'declaration' | 'property' | 'choice' | 'relation';
export interface ActionOption { readonly value: string; readonly label: string; }
export type ActionControl =
  | { readonly kind: 'text'; readonly multiline?: boolean }
  | { readonly kind: 'number'; readonly integer?: boolean; readonly minimum?: number; readonly schemaNumeric?: boolean }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'select'; readonly options: readonly ActionOption[] }
  | { readonly kind: 'schema-type' }
  | { readonly kind: 'reference-picker' }
  | { readonly kind: 'property-multi-select' }
  | { readonly kind: 'relation-editor' }
  | { readonly kind: 'catalog'; readonly family: string }
  | { readonly kind: 'structured-list'; readonly item: 'text' | 'number' | 'reference' | 'schema' }
  | { readonly kind: 'structured-object'; readonly family?: string }
  | { readonly kind: 'advanced-json' }
  | { readonly kind: 'source-only' };

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
const SCHEMA_TARGETS = ['declaration', 'property', 'choice'] as const satisfies readonly ActionTarget[];
const SELECTABLE_SCHEMA_TARGETS = ['document', ...SCHEMA_TARGETS] as const satisfies readonly ActionTarget[];

const set = (Command: CommandConstructor, keyword: string): CommandAction['create'] =>
  (pointer, value) => new Command(pointer, keyword, value);
const named = (Command: CommandConstructor): CommandAction['create'] =>
  (pointer, value, name) => new Command(pointer, name ?? '', value as never);
const core = (id: string, keyword: ConstructorParameters<typeof SetCoreMemberCommand>[1], label: string, control: ActionControl, targets: readonly ActionTarget[] = SCHEMA_TARGETS, removable = true): CommandAction => ({
  id: `core.${id}`, group: targets.length === 1 && targets[0] === 'document' ? 'Document' : 'Core', label, help: `Set ${keyword} on the selected ${targets.includes('document') ? 'document' : 'declaration'}.`,
  valueLabel: label, control, capability: 'core', targets, operation: 'set', ...(removable ? { removesActionId: `core.${id}.remove` } : {}), keyword,
  create: (pointer, value) => new SetCoreMemberCommand(pointer, keyword, value)
});
const remove = (action: CommandAction, keyword: string, Command?: CommandConstructor): CommandAction => ({
  id: action.removesActionId!, group: action.group, label: `Remove ${action.label.replace(/^Set /, '')}`, help: `Remove ${keyword} from the selected object.`,
  requiresValue: false, capability: action.capability, targets: action.targets, schemaTypes: action.schemaTypes, operation: 'remove', keyword,
  create: (pointer) => Command ? new Command(pointer, keyword, undefined) : new RemoveObjectMemberCommand(pointer, keyword)
});
const coreActions = [
  core('schema', '$schema', 'Set document schema', { kind: 'text' }, ['document']),
  core('id', '$id', 'Set document id', { kind: 'text' }, ['document']),
  core('name', 'name', 'Set document name', { kind: 'text' }, ['document']),
  core('description', 'description', 'Set document description', { kind: 'text', multiline: true }, ['document']),
  core('uses', '$uses', 'Set document uses', { kind: 'structured-list', item: 'text' }, ['document']),
  core('offers', '$offers', 'Set document offers', { kind: 'structured-object', family: 'offers' }, ['document']),
  core('type', 'type', 'Set type', { kind: 'select', options: [
    'any', 'null', 'boolean', 'string', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'integer', 'float8', 'float', 'double', 'decimal',
    'number', 'date', 'datetime', 'time', 'duration', 'uuid', 'uri', 'binary', 'jsonpointer', 'object', 'array', 'map', 'set', 'tuple', 'choice'
  ].map((value) => ({ value, label: value })) }, SCHEMA_TARGETS, false),
  core('enum', 'enum', 'Set enum', { kind: 'structured-list', item: 'text' }),
  core('const', 'const', 'Set const', { kind: 'advanced-json' }),
  core('abstract', 'abstract', 'Set abstract', { kind: 'boolean' }),
  core('extends', '$extends', 'Set extends', { kind: 'structured-list', item: 'reference' }),
  core('choice', 'type', 'Set choice type', { kind: 'select', options: [{ value: 'choice', label: 'choice' }] }, SCHEMA_TARGETS, false),
  { ...core('choices', 'choices', 'Set choices', { kind: 'structured-object', family: 'choice' }), schemaTypes: ['choice'] },
  { ...core('selector', 'selector', 'Set selector', { kind: 'text' }), schemaTypes: ['choice'] },
  { ...core('additional-properties', 'additionalProperties', 'Set additional properties', { kind: 'advanced-json' }), schemaTypes: ['object'] },
  { ...core('precision', 'precision', 'Set precision', { kind: 'number', integer: true, minimum: 0 }), schemaTypes: ['number', 'decimal'] },
  { ...core('scale', 'scale', 'Set scale', { kind: 'number', integer: true, minimum: 0 }), schemaTypes: ['number', 'decimal'] },
  { ...core('max-length', 'maxLength', 'Set maximum length', { kind: 'number', integer: true, minimum: 0 }), schemaTypes: ['string'] },
  { ...core('properties', 'properties', 'Set properties', { kind: 'structured-object', family: 'properties' }), schemaTypes: ['object', 'tuple'] },
  { ...core('required', 'required', 'Set required', { kind: 'property-multi-select' }), schemaTypes: ['object'] },
  { ...core('items', 'items', 'Set items', { kind: 'structured-object', family: 'schema' }), schemaTypes: ['array', 'set'] },
  { ...core('values', 'values', 'Set values', { kind: 'structured-object', family: 'schema' }), schemaTypes: ['map'] },
  { ...core('tuple', 'tuple', 'Set tuple order', { kind: 'property-multi-select' }), schemaTypes: ['tuple'] },
  core('definitions', 'definitions', 'Create namespace', { kind: 'structured-object', family: 'namespace' }, ['document', 'namespace'])
] as const;

/** Declarative command surface used by the shared workbench and tests. */
export const commandActions: readonly CommandAction[] = [
  ...coreActions.flatMap((action) => action.removesActionId ? [action, remove(action, action.keyword!)] : [action]),
  { id: 'root.set', group: 'Root', label: 'Set document root', help: 'Use the selected reusable definition as the document root.', requiresValue: false, targets: ['declaration'], create: (pointer) => new SetRootCommand(pointer) },
  { id: 'root.remove', group: 'Root', label: 'Remove document root', help: 'Remove the reusable document root selection.', requiresValue: false, targets: ['declaration'], create: () => new RemoveObjectMemberCommand('', '$root') },
  { id: 'namespace.add', group: 'Definitions', label: 'Add namespace', help: 'Add a named namespace under definitions.', valueLabel: 'Namespace name', control: { kind: 'text' }, capability: 'core', targets: ['document', 'namespace'], operation: 'add', create: (pointer, value, name) => new AddNamespaceCommand(pointer, name ?? String(value)) },
  { id: 'namespace.rename', group: 'Definitions', label: 'Rename namespace', help: 'Rename the selected namespace and atomically rewrite local references into it.', valueLabel: 'New name', control: { kind: 'text' }, capability: 'core', targets: ['namespace'], operation: 'rename', create: (pointer, value) => new RenameNamespaceCommand(pointer, String(value)) },
  { id: 'namespace.delete', group: 'Definitions', label: 'Delete empty namespace', help: 'Delete the selected namespace only when it is empty and unreferenced.', requiresValue: false, capability: 'core', targets: ['namespace'], operation: 'delete', create: (pointer) => new DeleteNamespaceCommand(pointer) },
  { id: 'namespace.delete-contents', group: 'Definitions', label: 'Delete namespace and contents', help: 'Explicitly delete the selected namespace subtree only when no external reference targets it.', requiresValue: false, capability: 'core', targets: ['namespace'], operation: 'delete', create: (pointer) => new DeleteNamespaceCommand(pointer, true) },
  { id: 'definition.add', group: 'Definitions', label: 'Add definition', help: 'Add a named schema to the selected namespace.', valueLabel: 'Type', control: { kind: 'schema-type' }, targets: ['document', 'namespace'], create: named(AddDefinitionCommand as unknown as CommandConstructor) },
  { id: 'definition.rename', group: 'Definitions', label: 'Rename definition', help: 'Rename the selected reusable definition and atomically rewrite local references.', valueLabel: 'New name', control: { kind: 'text' }, targets: ['declaration'], create: (pointer, value) => new RenameDefinitionCommand(pointer, String(value)) },
  { id: 'definition.delete', group: 'Definitions', label: 'Delete definition', help: 'Delete the selected reusable definition when it has no references.', requiresValue: false, targets: ['declaration'], create: (pointer) => new DeleteDefinitionCommand(pointer) },
  { id: 'property.add', group: 'Properties', label: 'Add property', help: 'Add a named member schema to the selected object or tuple.', valueLabel: 'Type', control: { kind: 'schema-type' }, targets: SELECTABLE_SCHEMA_TARGETS, schemaTypes: ['object', 'tuple'], create: (pointer, value, name) => { if (!isPropertySchema(value)) throw new Error('Properties require a schema value.'); return new AddPropertyCommand(pointer, name ?? '', value); } },
  { id: 'property.rename', group: 'Properties', label: 'Rename property', help: 'Rename the selected property.', valueLabel: 'New name', control: { kind: 'text' }, targets: ['property'], create: (pointer, value) => new RenamePropertyCommand(pointer, String(value)) },
  { id: 'property.edit', group: 'Properties', label: 'Edit property', help: 'Use the structured member controls, or open Source for the complete schema.', valueLabel: 'Property schema', control: { kind: 'source-only' }, targets: ['property', 'choice'], create: (pointer, value) => { if (!isPropertySchema(value)) throw new Error('Property edits require a schema value.'); return new EditPropertyCommand(pointer, value); } },
  { id: 'property.delete', group: 'Properties', label: 'Delete property', help: 'Delete the selected property.', requiresValue: false, targets: ['property'], create: (pointer) => new DeletePropertyCommand(pointer) },
  { id: 'property.required', group: 'Properties', label: 'Set required properties', help: 'Choose and order the required properties.', valueLabel: 'Required properties', control: { kind: 'property-multi-select' }, targets: SELECTABLE_SCHEMA_TARGETS, schemaTypes: ['object'], create: (pointer, value) => { if (!isRequiredProperties(value)) throw new Error('Required properties must be a string list or list of string lists.'); return new SetRequiredCommand(pointer, value); } },
  { id: 'property.required-alternatives', group: 'Properties', label: 'Edit alternative required sets', help: 'Author alternative required-property sets as structured JSON arrays.', valueLabel: 'Alternative required sets', control: { kind: 'structured-object', family: 'required-alternatives' }, targets: SELECTABLE_SCHEMA_TARGETS, schemaTypes: ['object'], create: (pointer, value) => { if (!isRequiredProperties(value)) throw new Error('Required properties must be a string list or list of string lists.'); return new SetRequiredCommand(pointer, value); } },
  { id: 'property.description', group: 'Properties', label: 'Set description', help: 'Set or remove a schema description.', valueLabel: 'Description', control: { kind: 'text', multiline: true }, targets: ['document', 'declaration', 'property', 'choice'], create: (pointer, value) => new SetDescriptionCommand(pointer, value === undefined ? undefined : String(value)) },
  { id: 'property.collection-member', group: 'Properties', label: 'Set collection member', help: 'Choose the item or value type for the selected collection.', valueLabel: 'Member type', control: { kind: 'schema-type' }, targets: SELECTABLE_SCHEMA_TARGETS, schemaTypes: ['array', 'set', 'map'], create: (pointer, value) => { if (!isRecord(value)) throw new Error('Collection members require a schema object.'); return new SetCollectionMemberCommand(pointer, value); } },
  { id: 'property.tuple-members', group: 'Properties', label: 'Set tuple members', help: 'Author tuple member schemas and order as one structured transaction.', valueLabel: 'Tuple members', control: { kind: 'structured-object', family: 'tuple-members' }, targets: SELECTABLE_SCHEMA_TARGETS, schemaTypes: ['tuple'], create: (pointer, value) => { const tuple = value as { properties: Record<string, Record<string, unknown>>; order: string[] }; return new SetTupleMembersCommand(pointer, tuple.properties, tuple.order); } },
  { id: 'choice.add', group: 'Properties', label: 'Add choice alternative', help: 'Add a named typed alternative to the selected choice.', valueLabel: 'Type', control: { kind: 'schema-type' }, targets: SELECTABLE_SCHEMA_TARGETS, schemaTypes: ['choice'], operation: 'add', create: (pointer, value, name) => { if (!isPropertySchema(value)) throw new Error('Choice alternatives require a schema value.'); return new AddChoiceCommand(pointer, name ?? String(value), value); } },
  { id: 'choice.rename', group: 'Properties', label: 'Rename choice alternative', help: 'Rename the selected choice alternative and update local references.', valueLabel: 'New name', control: { kind: 'text' }, targets: ['choice'], operation: 'rename', create: (pointer, value) => new RenameChoiceCommand(pointer, String(value)) },
  { id: 'choice.delete', group: 'Properties', label: 'Delete choice alternative', help: 'Delete the selected unreferenced choice alternative.', requiresValue: false, targets: ['choice'], operation: 'delete', create: (pointer) => new DeleteChoiceCommand(pointer) },
  { id: 'reference.type', group: 'References', label: 'Set type reference', help: 'Set the selected declaration type to a reusable local reference.', valueLabel: 'Reference', control: { kind: 'reference-picker' }, capability: 'core', targets: SCHEMA_TARGETS, operation: 'set', create: (pointer, value) => new SetTypeReferenceCommand(pointer, String(value)) },
  { id: 'import.set', group: 'Imports', label: 'Set import', help: 'Set a direct $import or $importdefs declaration on the selected namespace.', valueLabel: 'Import', control: { kind: 'structured-object', family: 'import' }, capability: 'import', targets: ['namespace'], create: (pointer, value) => { const importValue = value as { keyword: '$import' | '$importdefs'; source: string }; return new SetImportCommand(pointer, importValue.keyword, importValue.source); } },
  { id: 'import.delete', group: 'Imports', label: 'Delete import', help: 'Remove an import from the selected namespace.', valueLabel: 'Import kind', control: { kind: 'select', options: [{ value: '$import', label: 'Whole-schema import' }, { value: '$importdefs', label: 'Definitions-only import' }] }, capability: 'import', targets: ['namespace'], create: (pointer, value) => new DeleteImportCommand(pointer, String(value) as '$import' | '$importdefs') },
  { id: 'relation.add', group: 'Relations', label: 'Add relation', help: 'Add a named relation to the selected object.', valueLabel: 'Relation', control: { kind: 'relation-editor' }, capability: 'relations', targets: SELECTABLE_SCHEMA_TARGETS, schemaTypes: ['object', 'tuple'], create: (pointer, value, name) => { if (!isRelationSchema(value)) throw new Error('Relations require a relation value.'); return new AddRelationCommand(pointer, name ?? '', value); } },
  { id: 'relation.edit', group: 'Relations', label: 'Edit relation', help: 'Replace the selected relation.', valueLabel: 'Relation', control: { kind: 'relation-editor' }, capability: 'relations', targets: ['relation'], create: (pointer, value) => new EditRelationCommand(pointer, value as never) },
  { id: 'relation.rename', group: 'Relations', label: 'Rename relation', help: 'Rename the selected relation.', valueLabel: 'New name', capability: 'relations', targets: ['relation'], create: (pointer, value) => new RenameRelationCommand(pointer, String(value)) },
  { id: 'relation.delete', group: 'Relations', label: 'Delete relation', help: 'Delete the selected relation.', requiresValue: false, capability: 'relations', targets: ['relation'], create: (pointer) => new DeleteRelationCommand(pointer) },
  { id: 'relation.identity', group: 'Relations', label: 'Set identity', help: 'Choose and order the properties that form the selected type identity.', valueLabel: 'Identity properties', control: { kind: 'property-multi-select' }, capability: 'relations', targets: SELECTABLE_SCHEMA_TARGETS, schemaTypes: ['object', 'tuple'], operation: 'set', removesActionId: 'relation.remove-identity', keyword: 'identity', create: (pointer, value) => { if (!isStringArray(value)) throw new Error('Identity must be a string list.'); return new SetIdentityCommand(pointer, value); } },
  { id: 'relation.remove-identity', group: 'Relations', label: 'Remove identity', help: 'Remove the selected identity when no inbound relation depends on it.', requiresValue: false, capability: 'relations', targets: SELECTABLE_SCHEMA_TARGETS, schemaTypes: ['object', 'tuple'], create: (pointer) => new RemoveIdentityCommand(pointer) },
  { id: 'relation.cardinality', group: 'Relations', label: 'Set relation cardinality', help: 'Set a relation to single or multiple.', valueLabel: 'Cardinality', control: { kind: 'select', options: [{ value: 'single', label: 'single' }, { value: 'multiple', label: 'multiple' }] }, capability: 'relations', targets: ['relation'], operation: 'set', keyword: 'cardinality', create: (pointer, value) => new SetRelationCardinalityCommand(pointer, String(value) as 'single' | 'multiple') },
  { id: 'relation.scope', group: 'Relations', label: 'Set relation scope', help: 'Choose one or more collection locations that contain relation targets.', valueLabel: 'Scope', control: { kind: 'structured-list', item: 'reference' }, capability: 'relations', targets: ['relation'], operation: 'set', keyword: 'scope', create: (pointer, value) => new SetRelationScopeCommand(pointer, value as never) },
  { id: 'relation.qualifier', group: 'Relations', label: 'Set relation qualifier', help: 'Set a reusable qualifier type reference.', valueLabel: 'Qualifier type', control: { kind: 'reference-picker' }, capability: 'relations', targets: ['relation'], operation: 'set', keyword: 'qualifiertype', create: (pointer, value) => new SetRelationQualifierCommand(pointer, String(value)) },
  ...keywordActions('Validation', 'validation', ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'minContains', 'maxContains', 'minProperties', 'maxProperties', 'minEntries', 'maxEntries', 'default', 'contains', 'propertyNames', 'keyNames', 'has', 'dependentRequired', 'patternProperties', 'patternKeys'], SetValidationKeywordCommand as unknown as CommandConstructor),
  ...keywordActions('Composition', 'composition', ['allOf', 'anyOf', 'oneOf', 'not'], SetCompositionKeywordCommand as unknown as CommandConstructor),
  { id: 'composition.conditional', group: 'Composition', label: 'Set conditional composition', help: 'Set if, then, and else as one structured value.', valueLabel: 'Conditional composition', control: { kind: 'structured-object', family: 'conditional-composition' }, capability: 'conditional-composition', targets: SCHEMA_TARGETS, operation: 'set', removesActionId: 'composition.conditional.remove', create: (pointer, value) => { if (!isConditionalCompositionGroup(value)) throw new Error('Conditional composition requires an if schema.'); return new SetConditionalCompositionCommand(pointer, value); } },
  { id: 'composition.conditional.remove', group: 'Composition', label: 'Remove conditional composition', help: 'Remove if, then, and else from the selected schema.', requiresValue: false, capability: 'conditional-composition', targets: SCHEMA_TARGETS, operation: 'remove', create: (pointer) => new SetConditionalCompositionCommand(pointer, undefined) },
  ...keywordActions('Units', 'units', ['symbol', 'symbols', 'unit', 'ucumUnit', 'currency'], SetUnitsKeywordCommand as unknown as CommandConstructor),
  ...keywordActions('Alternate names', 'alternate-names', ['altnames'], SetAlternateNamesKeywordCommand as unknown as CommandConstructor),
  ...keywordActions('Alternate names', 'alternate-enums', ['altenums'], SetAlternateNamesKeywordCommand as unknown as CommandConstructor),
  ...keywordActions('Alternate names', 'localized-descriptions', ['descriptions'], SetAlternateNamesKeywordCommand as unknown as CommandConstructor),
  ...keywordActions('Semantic annotations', 'semantic', ['concepts', 'observedProperty', 'semanticRole', 'derivation', 'statistic', 'codedValues', 'measurementConditioning', 'referenceRole', 'phenomenonTimeRelation', 'supportPeriod', 'temporalReferenceSystem', 'cadence', 'coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames', 'frameTransforms', 'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands'], SetSemanticAnnotationCommand as unknown as CommandConstructor),
  ...keywordActions('Properties', 'binary', ['contentEncoding', 'contentCompression', 'contentMediaType'], SetBinaryAnnotationsCommand as unknown as CommandConstructor)
];

export function actionById(id: string): CommandAction | undefined { return commandActions.find((action) => action.id === id); }

function isPropertySchema(value: unknown): value is PropertySchema { return isRecord(value) && isSchemaTypeValue(value.type); }
function isRelationSchema(value: unknown): value is RelationSchema {
  if (!isRecord(value) || typeof value.targetTypeRef !== 'string' || typeof value.cardinality !== 'string' || !['single', 'multiple'].includes(value.cardinality)) return false;
  if (value.scope !== undefined && typeof value.scope !== 'string' && !(Array.isArray(value.scope) && value.scope.every((entry) => typeof entry === 'string'))) return false;
  return value.qualifierTypeRef === undefined || typeof value.qualifierTypeRef === 'string';
}
function isSchemaTypeValue(value: unknown): value is SchemaTypeValue { return typeof value === 'string' || isRecord(value) || Array.isArray(value) && value.every(isSchemaTypeValue); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isRequiredProperties(value: unknown): value is RequiredProperties {
  return Array.isArray(value) && (value.every((entry) => typeof entry === 'string') || value.every((entry) => Array.isArray(entry) && entry.every((name) => typeof name === 'string')));
}
function isStringArray(value: unknown): value is readonly string[] { return Array.isArray(value) && value.every((entry) => typeof entry === 'string'); }
function isConditionalCompositionGroup(value: unknown): value is ConditionalCompositionGroup {
  return isRecord(value) && isRecord(value.if) && (value.then === undefined || isRecord(value.then)) && (value.else === undefined || isRecord(value.else));
}

function keywordActions(group: ActionGroup, prefix: string, keywords: readonly string[], Command: CommandConstructor): readonly CommandAction[] {
  const capability = prefix === 'validation' ? 'validation' : prefix === 'composition' ? 'conditional-composition' : prefix === 'units' ? 'units' :
    prefix.startsWith('alternate') || prefix === 'localized-descriptions' ? 'alternate-names' : prefix === 'semantic' ? 'semantic-annotations' : 'core';
  return keywords.flatMap((keyword) => {
    const control: ActionControl = keyword === 'contentEncoding' ? { kind: 'select', options: [
      { value: 'base64', label: 'base64' },
      { value: 'base64url', label: 'base64url' },
      { value: 'base16', label: 'base16' },
      { value: 'base32', label: 'base32' },
      { value: 'base32hex', label: 'base32hex' },
    ] } :
      keyword === 'contentCompression' ? { kind: 'select', options: [
        { value: 'gzip', label: 'gzip' },
        { value: 'deflate', label: 'deflate' },
        { value: 'zlib', label: 'zlib' },
        { value: 'brotli', label: 'brotli' },
      ] } :
      keyword === 'uniqueItems' ? { kind: 'boolean' } :
      ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].includes(keyword)
        ? { kind: 'number', schemaNumeric: true } :
      ['minLength', 'minItems', 'maxItems', 'minContains', 'maxContains', 'minProperties', 'maxProperties', 'minEntries', 'maxEntries'].includes(keyword)
        ? { kind: 'number', integer: true, minimum: 0 } :
      ['unit', 'ucumUnit', 'currency', 'concepts', 'observedProperty', 'semanticRole', 'derivation', 'statistic', 'codedValues', 'measurementConditioning', 'referenceRole', 'phenomenonTimeRelation', 'temporalReferenceSystem', 'cadence', 'coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames', 'frameTransforms', 'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands'].includes(keyword) ? { kind: 'catalog', family: keyword } :
      ['format', 'contentEncoding', 'contentCompression', 'pattern', 'symbol', 'contentMediaType'].includes(keyword) ? { kind: 'text' } :
      keyword === 'descriptions' ? { kind: 'structured-object', family: 'localized-descriptions' } :
      keyword === 'altnames' ? { kind: 'structured-object', family: 'alternate-names' } :
      ['allOf', 'anyOf', 'oneOf', 'not', 'contains', 'propertyNames', 'keyNames', 'has', 'dependentRequired', 'patternProperties', 'patternKeys', 'default'].includes(keyword) ? { kind: 'advanced-json' } :
      { kind: 'advanced-json' };
    const propertyOnly = prefix === 'semantic' && ['phenomenonTimeRelation', 'supportPeriod'].includes(keyword);
    const alternateNameOnly = prefix.startsWith('alternate') && keyword === 'altnames';
    const alternateNamesFamily = prefix.startsWith('alternate') || prefix === 'localized-descriptions';
    const targets: readonly ActionTarget[] = propertyOnly
      ? ['property']
      : alternateNameOnly
        ? ['document', 'declaration', 'property']
        : alternateNamesFamily
          ? SELECTABLE_SCHEMA_TARGETS
          : SCHEMA_TARGETS;
    const action: CommandAction = { id: `${prefix}.${keyword}`, group, label: `Set ${keyword}`, help: `Set ${keyword} on the selected schema.`, valueLabel: `Set ${keyword}`, control, capability, targets, schemaTypes: schemaTypesForKeyword(prefix, keyword), operation: 'set', removesActionId: `${prefix}.${keyword}.remove`, keyword, create: set(Command, keyword) };
    return [action, remove(action, keyword, Command)];
  });
}

function schemaTypesForKeyword(prefix: string, keyword: string): readonly string[] | undefined {
  if (prefix === 'binary') return ['binary'];
  if (prefix === 'units' && (keyword === 'unit' || keyword === 'ucumUnit')) return ['number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal'];
  if (prefix === 'semantic' && keyword === 'codedValues') return ['string', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128'];
  if (prefix === 'semantic' && keyword === 'measurementConditioning') return ['number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal'];
  if (prefix !== 'validation' || keyword === 'default') return undefined;
  if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].includes(keyword)) return ['number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal'];
  if (['minLength', 'pattern', 'format'].includes(keyword)) return ['string'];
  if (['minItems', 'maxItems', 'minContains', 'maxContains', 'contains'].includes(keyword)) return ['array', 'set'];
  if (keyword === 'uniqueItems') return ['array'];
  if (['minProperties', 'maxProperties', 'propertyNames', 'dependentRequired', 'patternProperties'].includes(keyword)) return ['object'];
  if (['minEntries', 'maxEntries', 'keyNames', 'patternKeys'].includes(keyword)) return ['map'];
  if (keyword === 'has') return ['object', 'map'];
  return undefined;
}