/**
 * Defines the capability resolution shape.
 */
export interface CapabilityResolution {
  readonly schema?: string;
  readonly activeCore: true;
  readonly validationActive: boolean;
  readonly conditionalCompositionActive: boolean;
  readonly unitsActive: boolean;
  readonly semanticAnnotationsActive: boolean;
  readonly alternateNamesActive: boolean;
  readonly importActive: boolean;
  readonly relationsActive: boolean;
  readonly offeredExtensions: readonly string[];
  readonly unknown: readonly string[];
}

export type CanonicalMetaSchemaMode = 'core' | 'validation' | 'semantic-annotations' | 'relations' | 'extended';
export type CapabilityUse = typeof CAPABILITY_USES[keyof typeof CAPABILITY_USES];

export interface MetaSchemaCapabilityProfile {
  readonly mode: CanonicalMetaSchemaMode | 'unknown';
  readonly schema?: string;
  readonly activeUses: ReadonlySet<CapabilityUse>;
  readonly offeredUses: ReadonlySet<CapabilityUse>;
  readonly unknownUses: readonly string[];
}

export const CAPABILITY_USES = {
  validation: 'JSONStructureValidation',
  conditionalComposition: 'JSONStructureConditionalComposition',
  units: 'JSONStructureUnits',
  semanticAnnotations: 'JSONStructureSemanticAnnotations',
  alternateNames: 'JSONStructureAlternateNames',
  imports: 'JSONStructureImport',
  relations: 'JSONStructureRelations'
} as const;

interface CanonicalMetaSchema {
  readonly mode: CanonicalMetaSchemaMode;
  readonly parent?: string;
  readonly uses: readonly CapabilityUse[];
  readonly offers: readonly CapabilityUse[];
}

const CORE_META_SCHEMA = 'https://json-structure.org/meta/core/v0/#';
const EXTENDED_META_SCHEMA = 'https://json-structure.org/meta/extended/v0/#';
const VALIDATION_META_SCHEMA = 'https://json-structure.org/meta/validation/v0/#';
const SEMANTIC_ANNOTATIONS_META_SCHEMA = 'https://json-structure.org/meta/semantic-annotations/v0/#';
const RELATIONS_META_SCHEMA = 'https://json-structure.org/meta/relations/v0/#';

const CANONICAL_META_SCHEMAS: Readonly<Record<string, CanonicalMetaSchema>> = {
  [CORE_META_SCHEMA]: { mode: 'core', uses: [], offers: [] },
  [EXTENDED_META_SCHEMA]: {
    mode: 'extended',
    parent: CORE_META_SCHEMA,
    uses: [CAPABILITY_USES.imports],
    offers: [
      CAPABILITY_USES.alternateNames,
      CAPABILITY_USES.units,
      CAPABILITY_USES.imports,
      CAPABILITY_USES.conditionalComposition,
      CAPABILITY_USES.validation
    ]
  },
  [VALIDATION_META_SCHEMA]: {
    mode: 'validation',
    parent: EXTENDED_META_SCHEMA,
    uses: [CAPABILITY_USES.alternateNames, CAPABILITY_USES.units, CAPABILITY_USES.imports, CAPABILITY_USES.conditionalComposition, CAPABILITY_USES.validation],
    offers: []
  },
  [SEMANTIC_ANNOTATIONS_META_SCHEMA]: {
    mode: 'semantic-annotations',
    parent: EXTENDED_META_SCHEMA,
    uses: [CAPABILITY_USES.units, CAPABILITY_USES.imports, CAPABILITY_USES.conditionalComposition, CAPABILITY_USES.validation],
    offers: [CAPABILITY_USES.semanticAnnotations, CAPABILITY_USES.relations]
  },
  [RELATIONS_META_SCHEMA]: {
    mode: 'relations',
    parent: EXTENDED_META_SCHEMA,
    uses: [CAPABILITY_USES.imports],
    offers: [CAPABILITY_USES.relations]
  }
};

const KNOWN_USES = new Set<CapabilityUse>(Object.values(CAPABILITY_USES));

/** Resolves the canonical meta-schema's transitive uses plus explicit document uses. */
export function resolveMetaSchemaCapabilityProfile(value: unknown): MetaSchemaCapabilityProfile {
  const root = asRoot(value);
  const schema = typeof root.$schema === 'string' ? root.$schema : undefined;
  const canonical = schema === undefined ? CANONICAL_META_SCHEMAS[CORE_META_SCHEMA] : CANONICAL_META_SCHEMAS[schema];
  const mode = canonical?.mode ?? 'unknown';
  const activeUses = canonical ? transitiveUses(schema ?? CORE_META_SCHEMA) : new Set<CapabilityUse>();
  const offeredUses = canonical ? transitiveOffers(schema ?? CORE_META_SCHEMA) : new Set<CapabilityUse>();
  const authoredUses = Array.isArray(root.$uses) ? root.$uses.filter((entry): entry is string => typeof entry === 'string') : [];
  if (canonical) {
    for (const use of authoredUses) {
      if (isCapabilityUse(use) && offeredUses.has(use)) activeUses.add(use);
    }
  }
  return {
    mode,
    schema,
    activeUses,
    offeredUses,
    unknownUses: authoredUses.filter((use) => !KNOWN_USES.has(use as CapabilityUse))
  };
}

/**
 * Validates validation extension active and narrows the value type when applicable.
 */
export function validationExtensionActive(value: unknown): boolean {
  return resolveMetaSchemaCapabilityProfile(value).activeUses.has(CAPABILITY_USES.validation);
}
/**
 * Performs conditional composition extension active logic.
 */
export function conditionalCompositionExtensionActive(value: unknown): boolean {
  return resolveMetaSchemaCapabilityProfile(value).activeUses.has(CAPABILITY_USES.conditionalComposition);
}
/**
 * Performs units extension active logic.
 */
export function unitsExtensionActive(value: unknown): boolean {
  return resolveMetaSchemaCapabilityProfile(value).activeUses.has(CAPABILITY_USES.units);
}
/**
 * Performs semantic annotations extension active logic.
 */
export function semanticAnnotationsExtensionActive(value: unknown): boolean {
  return resolveMetaSchemaCapabilityProfile(value).activeUses.has(CAPABILITY_USES.semanticAnnotations);
}
/**
 * Performs alternate names extension active logic.
 */
export function alternateNamesExtensionActive(value: unknown): boolean {
  return resolveMetaSchemaCapabilityProfile(value).activeUses.has(CAPABILITY_USES.alternateNames);
}
/**
 * Resolves capabilities for the current document.
 */
export function resolveCapabilities(value: unknown): CapabilityResolution {
  const root = asRoot(value);
  const profile = resolveMetaSchemaCapabilityProfile(root);
  const offers = asRoot(root.$offers);
  const offerNames = Object.keys(offers);
  return {
    schema: profile.schema,
    activeCore: true,
    validationActive: profile.activeUses.has(CAPABILITY_USES.validation),
    conditionalCompositionActive: profile.activeUses.has(CAPABILITY_USES.conditionalComposition),
    unitsActive: profile.activeUses.has(CAPABILITY_USES.units),
    semanticAnnotationsActive: profile.activeUses.has(CAPABILITY_USES.semanticAnnotations),
    alternateNamesActive: profile.activeUses.has(CAPABILITY_USES.alternateNames),
    importActive: profile.activeUses.has(CAPABILITY_USES.imports),
    relationsActive: profile.activeUses.has(CAPABILITY_USES.relations),
    offeredExtensions: offerNames,
    unknown: profile.unknownUses
  };
}

function transitiveUses(schema: string, visiting = new Set<string>()): Set<CapabilityUse> {
  const result = new Set<CapabilityUse>();
  const descriptor = CANONICAL_META_SCHEMAS[schema];
  if (!descriptor || visiting.has(schema)) return result;
  visiting.add(schema);
  if (descriptor.parent) for (const use of transitiveUses(descriptor.parent, visiting)) result.add(use);
  for (const use of descriptor.uses) result.add(use);
  return result;
}

function transitiveOffers(schema: string, visiting = new Set<string>()): Set<CapabilityUse> {
  const result = new Set<CapabilityUse>();
  const descriptor = CANONICAL_META_SCHEMAS[schema];
  if (!descriptor || visiting.has(schema)) return result;
  visiting.add(schema);
  if (descriptor.parent) for (const offer of transitiveOffers(descriptor.parent, visiting)) result.add(offer);
  for (const offer of descriptor.offers) result.add(offer);
  return result;
}

function isCapabilityUse(value: string): value is CapabilityUse {
  return KNOWN_USES.has(value as CapabilityUse);
}

function asRoot(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
