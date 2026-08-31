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
  readonly offeredExtensions: readonly string[];
  readonly unknown: readonly string[];
}
const EXTENDED_META_SCHEMA = 'https://json-structure.org/meta/extended/v0/#';
const VALIDATION_META_SCHEMA = 'https://json-structure.org/meta/validation/v0/#';
const SEMANTIC_ANNOTATIONS_META_SCHEMA = 'https://json-structure.org/meta/semantic-annotations/v0/#';

/**
 * Validates validation extension active and narrows the value type when applicable.
 */
export function validationExtensionActive(value: unknown): boolean {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const schema = typeof root.$schema === 'string' ? root.$schema : undefined;
  const uses = Array.isArray(root.$uses) ? root.$uses : [];
  return schema === VALIDATION_META_SCHEMA || (schema === EXTENDED_META_SCHEMA && uses.includes('JSONSchemaValidation'));
}
/**
 * Performs conditional composition extension active logic.
 */
export function conditionalCompositionExtensionActive(value: unknown): boolean {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const schema = typeof root.$schema === 'string' ? root.$schema : undefined;
  const uses = Array.isArray(root.$uses) ? root.$uses : [];
  return schema === VALIDATION_META_SCHEMA ||
    (schema === EXTENDED_META_SCHEMA && uses.includes('JSONStructureConditionalComposition'));
}
/**
 * Performs units extension active logic.
 */
export function unitsExtensionActive(value: unknown): boolean {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const schema = typeof root.$schema === 'string' ? root.$schema : undefined;
  const uses = Array.isArray(root.$uses) ? root.$uses : [];
  return schema === VALIDATION_META_SCHEMA || (schema === EXTENDED_META_SCHEMA && uses.includes('JSONStructureUnits'));
}
/**
 * Performs semantic annotations extension active logic.
 */
export function semanticAnnotationsExtensionActive(value: unknown): boolean {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const schema = typeof root.$schema === 'string' ? root.$schema : undefined;
  const uses = Array.isArray(root.$uses) ? root.$uses : [];
  return schema === SEMANTIC_ANNOTATIONS_META_SCHEMA ||
    (schema === EXTENDED_META_SCHEMA && uses.includes('JSONStructureSemanticAnnotations'));
}
/**
 * Performs alternate names extension active logic.
 */
export function alternateNamesExtensionActive(value: unknown): boolean {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const schema = typeof root.$schema === 'string' ? root.$schema : undefined;
  const uses = Array.isArray(root.$uses) ? root.$uses : [];
  return schema === VALIDATION_META_SCHEMA ||
    (schema === EXTENDED_META_SCHEMA && uses.includes('JSONStructureAlternateNames'));
}
/**
 * Resolves capabilities for the current document.
 */
export function resolveCapabilities(value: unknown): CapabilityResolution {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const offers = Array.isArray(root.$offers) ? root.$offers.filter((item): item is string => typeof item === 'string') : [];
  const known = new Set(['Units', 'Validation', 'Alternate Names', 'Relations', 'Conditional Composition', 'Import', 'Semantic Annotations']);
  return {
    schema: typeof root.$schema === 'string' ? root.$schema : undefined,
    activeCore: true,
    validationActive: validationExtensionActive(root),
    conditionalCompositionActive: conditionalCompositionExtensionActive(root),
    unitsActive: unitsExtensionActive(root),
    semanticAnnotationsActive: semanticAnnotationsExtensionActive(root),
    alternateNamesActive: alternateNamesExtensionActive(root),
    offeredExtensions: offers.filter((offer) => known.has(offer)),
    unknown: offers.filter((offer) => !known.has(offer))
  };
}
