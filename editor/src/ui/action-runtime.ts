import type { CatalogFamily } from '../catalogs.js';
import { resolveCapabilities } from '../capabilities.js';
import { effectiveValidationTypes } from '../validation.js';
import type { ActionCapability, ActionTarget, CommandAction } from './actions.js';

export interface ActionAvailability {
  readonly enabled: boolean;
  readonly reason?: string;
  readonly pointer: string;
}

const CAPABILITY_STATE: Record<Exclude<ActionCapability, 'core'>, keyof ReturnType<typeof resolveCapabilities>> = {
  validation: 'validationActive',
  'conditional-composition': 'conditionalCompositionActive',
  units: 'unitsActive',
  'alternate-names': 'alternateNamesActive',
  'semantic-annotations': 'semanticAnnotationsActive',
  import: 'importActive',
  relations: 'relationsActive'
};

const CAPABILITY_USE: Record<Exclude<ActionCapability, 'core'>, string> = {
  validation: 'JSONStructureValidation',
  'conditional-composition': 'JSONStructureConditionalComposition',
  units: 'JSONStructureUnits',
  'alternate-names': 'JSONStructureAlternateNames',
  'semantic-annotations': 'JSONStructureSemanticAnnotations',
  import: 'JSONStructureImport',
  relations: 'JSONStructureRelations'
};

const CATALOG_FAMILIES = new Set<CatalogFamily>([
  'symbol', 'unit', 'ucumUnit', 'currency', 'semanticConcept', 'observedProperty', 'semanticRole', 'derivation',
  'statistic', 'codedValues', 'measurementConditioning', 'referenceRole', 'phenomenonTimeRelation',
  'temporalReferenceSystem', 'cadence', 'coordinateReferenceSystem', 'vectorReferenceFrame', 'tensorReferenceFrame',
  'frameTransform', 'linearReferenceSystem', 'colorSpace', 'audioChannelLayout', 'spectralBandSet'
]);

const CATALOG_ALIASES: Readonly<Record<string, CatalogFamily>> = {
  concepts: 'semanticConcept',
  vectorReferenceFrames: 'vectorReferenceFrame',
  tensorReferenceFrames: 'tensorReferenceFrame',
  frameTransforms: 'frameTransform',
  colorSpaces: 'colorSpace',
  audioChannels: 'audioChannelLayout',
  spectralBands: 'spectralBandSet'
};

const TYPE_REQUIRED_SHAPE_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  object: ['properties'],
  array: ['items'],
  set: ['items'],
  map: ['values'],
  tuple: ['properties', 'tuple'],
  choice: ['choices']
};

export function actionAvailability(action: CommandAction, selectedPointer: string, document: unknown): ActionAvailability {
  const pointer = action.targets?.length === 1 && action.targets[0] === 'document' ? '' : selectedPointer;
  if (action.targets?.length) {
    const target = targetForPointer(pointer, document);
    const rootDeclaration = pointer === '' && action.targets.includes('declaration');
    if (!rootDeclaration && !action.targets.includes(target)) {
      return { enabled: false, pointer, reason: `Select a ${action.targets.join(' or ')} to use this command.` };
    }
  }
  if (action.schemaTypes?.length) {
    const value = valueAtPointer(document, pointer);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { enabled: false, pointer, reason: 'Select a typed schema to use this command.' };
    }
    const effectiveTypes = effectiveValidationTypes(document, value as Record<string, unknown>);
    if (!effectiveTypes.determinate || effectiveTypes.types.length !== 1) {
      return { enabled: false, pointer, reason: 'This command requires one determinable schema type.' };
    }
    const schemaType = effectiveTypes.types[0];
    if (!action.schemaTypes.includes(schemaType)) {
      return { enabled: false, pointer, reason: `This command requires a ${action.schemaTypes.join(' or ')} schema.` };
    }
  }
  const contextualReason = contextualAvailabilityReason(action, pointer, document);
  if (contextualReason) return { enabled: false, pointer, reason: contextualReason };
  if (action.capability && action.capability !== 'core') {
    const capabilities = resolveCapabilities(document);
    if (!capabilities[CAPABILITY_STATE[action.capability]]) {
      return { enabled: false, pointer, reason: `Activate ${CAPABILITY_USE[action.capability]} in $uses to use this command.` };
    }
  }
  if (action.operation === 'remove' && action.keyword) {
    if (pointer === '' && (action.keyword === '$schema' || action.keyword === '$id' || action.keyword === 'name')) {
      return { enabled: false, pointer, reason: 'Required document headers cannot be removed.' };
    }
    const value = valueAtPointer(document, pointer);
    if (action.keyword === 'type' && value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'type')) {
      return { enabled: false, pointer, reason: 'type is required on the selected declaration.' };
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).type === 'string' &&
      TYPE_REQUIRED_SHAPE_MEMBERS[String((value as Record<string, unknown>).type)]?.includes(action.keyword)) {
      return { enabled: false, pointer, reason: `${action.keyword} is required for the selected schema type.` };
    }
    if (!hasObjectMember(document, pointer, action.keyword)) {
      return { enabled: false, pointer, reason: `${action.keyword} is not set on the selected object.` };
    }
  }
  return { enabled: true, pointer };
}

function contextualAvailabilityReason(action: CommandAction, pointer: string, document: unknown): string | undefined {
  const declaration = valueAtPointer(document, pointer);
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) return undefined;
  const schema = declaration as Readonly<Record<string, unknown>>;
  if (action.id === 'core.additional-properties' && schema.abstract === true) return 'Abstract object schemas cannot declare additionalProperties.';
  if ((action.id === 'validation.minContains' || action.id === 'validation.maxContains') && !Object.prototype.hasOwnProperty.call(schema, 'contains')) return 'Set contains before adding a contains count.';
  if (action.id === 'alternate-enums.altenums') {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || !schema.enum.every((entry) => typeof entry === 'string') || new Set(schema.enum).size !== schema.enum.length) {
      return 'Alternate enum names require a non-empty distinct string enum.';
    }
  }
  if (action.id === 'alternate-names.altnames' && !namedSchemaTarget(pointer, document)) return 'Alternate names require a named document, reusable type, or property.';
  if (action.id === 'semantic.statistic' && schema.derivation !== 'statistic') return 'Set derivation to statistic before adding statistic metadata.';
  if (action.id === 'semantic.supportPeriod' && schema.phenomenonTimeRelation === undefined) return 'Set phenomenonTimeRelation before adding supportPeriod.';
  if (action.id.startsWith('semantic.') && !semanticActionPlacementValid(action.keyword, pointer, document, schema)) return 'This semantic annotation does not apply at the selected schema position.';
  return undefined;
}

function namedSchemaTarget(pointer: string, document: unknown): boolean {
  if (pointer === '') return !!document && typeof document === 'object' && !Array.isArray(document) && typeof (document as Record<string, unknown>).name === 'string';
  if (targetForPointer(pointer, document) === 'property') return true;
  return /(?:^|\/)definitions\/[^/]+$/.test(pointer) && targetForPointer(pointer, document) === 'declaration';
}

const SEMANTIC_PROPERTY_OR_COLLECTION = new Set([
  'observedProperty', 'semanticRole', 'derivation', 'statistic', 'temporalReferenceSystem', 'cadence', 'codedValues', 'measurementConditioning'
]);
const SEMANTIC_PROPERTY_ONLY = new Set(['phenomenonTimeRelation', 'supportPeriod', 'referenceRole']);
const SEMANTIC_RECORD_ONLY = new Set([
  'coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames', 'frameTransforms',
  'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands'
]);

function semanticActionPlacementValid(keyword: string | undefined, pointer: string, document: unknown, schema: Readonly<Record<string, unknown>>): boolean {
  if (!keyword || keyword === 'concepts') return true;
  const memberPosition = semanticMemberPosition(pointer, document);
  if (SEMANTIC_PROPERTY_ONLY.has(keyword)) return memberPosition === 'property';
  if (SEMANTIC_PROPERTY_OR_COLLECTION.has(keyword)) {
    if (memberPosition !== undefined) return true;
    const effective = effectiveValidationTypes(document, schema);
    const type = effective.determinate && effective.types.length === 1 ? effective.types[0] : undefined;
    return (type === 'object' || type === 'tuple') && (keyword === 'observedProperty' || keyword === 'temporalReferenceSystem');
  }
  if (!SEMANTIC_RECORD_ONLY.has(keyword)) return false;
  const effective = effectiveValidationTypes(document, schema);
  const type = effective.determinate && effective.types.length === 1 ? effective.types[0] : undefined;
  return type === 'object' || type === 'tuple';
}

function semanticMemberPosition(pointer: string, document: unknown): 'property' | 'collection' | undefined {
  for (const [marker, ownerTypes, position] of [
    ['/properties/', ['object', 'tuple'], 'property'],
    ['/choices/', ['choice'], 'collection']
  ] as const) {
    const index = pointer.lastIndexOf(marker);
    if (index >= 0 && !pointer.slice(index + marker.length).includes('/')) {
      const owner = valueAtPointer(document, pointer.slice(0, index));
      if (owner && typeof owner === 'object' && !Array.isArray(owner) && ownerTypes.includes((owner as Record<string, unknown>).type as never)) return position;
    }
  }
  for (const [suffix, ownerTypes] of [['/items', ['array', 'set']], ['/values', ['map']]] as const) {
    if (!pointer.endsWith(suffix)) continue;
    const owner = valueAtPointer(document, pointer.slice(0, -suffix.length));
    if (owner && typeof owner === 'object' && !Array.isArray(owner) && ownerTypes.includes((owner as Record<string, unknown>).type as never)) return 'collection';
  }
  return undefined;
}

export function catalogFamilyForAction(action: CommandAction): CatalogFamily | undefined {
  if (action.control?.kind !== 'catalog') return undefined;
  const family = action.control.family;
  return CATALOG_ALIASES[family] ?? (CATALOG_FAMILIES.has(family as CatalogFamily) ? family as CatalogFamily : undefined);
}

export function parseActionValue(action: CommandAction, raw: string, checked = false, schemaType?: string): unknown {
  const control = action.control;
  if (!control) return raw.trim() === '' ? undefined : JSON.parse(raw);
  switch (control.kind) {
    case 'boolean': return checked;
    case 'schema-type': return { type: raw };
    case 'source-only': return undefined;
    case 'number': {
      if (control.schemaNumeric && ['int64', 'uint64', 'int128', 'uint128', 'decimal'].includes(schemaType ?? '')) return raw;
      const value = Number(raw);
      if (!Number.isFinite(value) || control.integer && !Number.isInteger(value) || control.minimum !== undefined && value < control.minimum) {
        throw new Error('Enter a valid number.');
      }
      return value;
    }
    case 'advanced-json':
    case 'structured-object':
    case 'relation-editor': return JSON.parse(raw);
    case 'structured-list':
    case 'property-multi-select': return JSON.parse(raw);
    case 'catalog': return /^[\[{]/.test(raw.trim()) ? JSON.parse(raw) : raw;
    default: return raw;
  }
}

function targetForPointer(pointer: string, document: unknown): ActionTarget {
  if (pointer === '') return 'document';
  if (/(?:^|\/)relations\/(?:[^/]+)$/.test(pointer)) return 'relation';
  if (/(?:^|\/)properties\/(?:[^/]+)$/.test(pointer)) return 'property';
  if (/(?:^|\/)choices\/(?:[^/]+)$/.test(pointer)) return 'choice';
  const value = valueAtPointer(document, pointer);
  if (value && typeof value === 'object' && !Array.isArray(value) && !Object.prototype.hasOwnProperty.call(value, 'type')) return 'namespace';
  return 'declaration';
}

function hasObjectMember(document: unknown, pointer: string, keyword: string): boolean {
  const value = valueAtPointer(document, pointer);
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, keyword);
}

export function valueAtPointer(document: unknown, pointer: string): unknown {
  if (pointer === '') return document;
  return pointer.split('/').slice(1).reduce<unknown>((value, token) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[token.replace(/~1/g, '/').replace(/~0/g, '~')];
  }, document);
}