export interface CapabilityResolution {
  readonly schema?: string;
  readonly activeCore: true;
  readonly offeredExtensions: readonly string[];
  readonly unknown: readonly string[];
}
export function resolveCapabilities(value: unknown): CapabilityResolution {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const offers = Array.isArray(root.$offers) ? root.$offers.filter((item): item is string => typeof item === 'string') : [];
  const known = new Set(['Units', 'Validation', 'Alternate Names', 'Relations', 'Conditional Composition', 'Import', 'Semantic Annotations']);
  return { schema: typeof root.$schema === 'string' ? root.$schema : undefined, activeCore: true, offeredExtensions: offers.filter((offer) => known.has(offer)), unknown: offers.filter((offer) => !known.has(offer)) };
}
