export interface Evidence { readonly status: string; readonly reference: string; }
export interface CoverageFeature { readonly id?: string; readonly spec?: string; readonly feature?: string; readonly owner?: string; readonly status?: string; readonly evidence?: Partial<Record<'editing' | 'inspection' | 'diagnostics' | 'roundtrip' | 'tests', Evidence>>; }
const dimensions = ['editing', 'inspection', 'diagnostics', 'roundtrip', 'tests'] as const;
const statuses = new Set(['complete', 'partial', 'gap', 'unsupported', 'pending']);
const aggregatePatterns = [/^scalars?$/i, /^arrays?,?\s*maps?,?\s*tuples?$/i, /^annotations?$/i, /^forms?$/i, /^metadata$/i, /^identity,?\s*target/i, /^operators?$/i, /^placements?$/i];
export function coverageErrors(features: readonly CoverageFeature[], minimumCore = 5): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const feature of features) {
    if (!feature.id || ids.has(feature.id)) errors.push(`duplicate or missing feature ID: ${feature.id ?? '<missing>'}`);
    if (feature.id) ids.add(feature.id);
    for (const field of ['spec', 'feature', 'owner', 'status'] as const) if (!feature[field]) errors.push(`${feature.id ?? '<missing>'}: missing ${field}`);
    if (feature.status && !statuses.has(feature.status)) errors.push(`${feature.id ?? '<missing>'}: invalid status`);
    const id = feature.id;
    if (id && aggregatePatterns.some((pattern) => pattern.test(id) || pattern.test(feature.feature ?? ''))) errors.push(`${id}: aggregate feature records are not permitted; enumerate each normative item`);
    for (const dimension of dimensions) {
      const evidence = feature.evidence?.[dimension];
      if (!evidence || !evidence.status || !evidence.reference) errors.push(`${feature.id}: malformed ${dimension} evidence`);
      if (evidence && !['complete', 'partial', 'gap', 'unsupported', 'pending'].includes(evidence.status)) errors.push(`${feature.id}: invalid ${dimension} evidence status`);
      if (feature.status === 'complete' && evidence?.status !== 'complete') errors.push(`${feature.id}: completed claim lacks complete ${dimension} evidence`);
    }
  }
  if (features.filter((feature) => feature.spec === 'Core').length < minimumCore) errors.push(`at least ${minimumCore} owned Core feature records are required`);
  return errors;
}
