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

export function actionAvailability(action: CommandAction, selectedPointer: string, document: unknown): ActionAvailability {
  const pointer = action.targets?.length === 1 && action.targets[0] === 'document' ? '' : selectedPointer;
  if (action.capability && action.capability !== 'core') {
    const capabilities = resolveCapabilities(document);
    if (!capabilities[CAPABILITY_STATE[action.capability]]) {
      return { enabled: false, pointer, reason: `Activate ${CAPABILITY_USE[action.capability]} in $uses to use this command.` };
    }
  }
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
  if (action.operation === 'remove' && action.keyword && !hasObjectMember(document, pointer, action.keyword)) {
    return { enabled: false, pointer, reason: `${action.keyword} is not set on the selected object.` };
  }
  return { enabled: true, pointer };
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