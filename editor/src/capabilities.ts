export interface CapabilityResolution {
  readonly schema?: string;
  readonly activeCore: true;
  readonly validationActive: boolean;
  readonly unitsActive: boolean;
  readonly offeredExtensions: readonly string[];
  readonly unknown: readonly string[];
}
const EXTENDED_META_SCHEMA = 'https://json-structure.org/meta/extended/v0/#';
const VALIDATION_META_SCHEMA = 'https://json-structure.org/meta/validation/v0/#';

export function validationExtensionActive(value: unknown): boolean {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const schema = typeof root.$schema === 'string' ? root.$schema : undefined;
  const uses = Array.isArray(root.$uses) ? root.$uses : [];
  return schema === VALIDATION_META_SCHEMA || (schema === EXTENDED_META_SCHEMA && uses.includes('JSONSchemaValidation'));
}
export function unitsExtensionActive(value: unknown): boolean {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const schema = typeof root.$schema === 'string' ? root.$schema : undefined;
  const uses = Array.isArray(root.$uses) ? root.$uses : [];
  return schema === VALIDATION_META_SCHEMA || (schema === EXTENDED_META_SCHEMA && uses.includes('JSONStructureUnits'));
}
export function resolveCapabilities(value: unknown): CapabilityResolution {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const offers = Array.isArray(root.$offers) ? root.$offers.filter((item): item is string => typeof item === 'string') : [];
  const known = new Set(['Units', 'Validation', 'Alternate Names', 'Relations', 'Conditional Composition', 'Import', 'Semantic Annotations']);
  return {
    schema: typeof root.$schema === 'string' ? root.$schema : undefined,
    activeCore: true,
    validationActive: validationExtensionActive(root),
    unitsActive: unitsExtensionActive(root),
    offeredExtensions: offers.filter((offer) => known.has(offer)),
    unknown: offers.filter((offer) => !known.has(offer))
  };
}
