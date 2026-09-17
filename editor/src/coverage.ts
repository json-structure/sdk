import { DIMENSIONS, STATUSES, TEST_FACETS } from './coverage-contract.mjs';

/**
 * Defines the evidence shape.
 */
export interface Evidence { readonly status: string; readonly ids: readonly string[]; }
/**
 * Defines the test evidence shape.
 */
export interface TestEvidence extends Evidence { readonly facets?: Partial<Record<'positive' | 'negative' | 'incomplete' | 'hostParity', Evidence>>; }
/**
 * Defines the coverage feature shape.
 */
export interface CoverageFeature { readonly id?: string; readonly spec?: string; readonly requirement?: string; readonly status?: string; readonly evidence?: Partial<Record<'editing' | 'inspection' | 'diagnostics' | 'roundtrip', Evidence>> & { readonly tests?: TestEvidence }; }
const statuses = new Set(STATUSES);
const aggregatePatterns = [/^scalars?$/i, /^arrays?,?\s*maps?,?\s*tuples?$/i, /^annotations?$/i, /^forms?$/i, /^metadata$/i, /^identity,?\s*target/i, /^operators?$/i, /^placements?$/i];
/**
 * Performs lightweight compatibility validation for callers of the original coverage API.
 *
 * @deprecated Use the authoritative v5 coverage gate in `coverage-contract.mjs` for release decisions.
 */
export function coverageErrors(features: readonly CoverageFeature[], minimumCore = 5): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const feature of features) {
    if (!feature.id || ids.has(feature.id)) errors.push(`duplicate or missing feature ID: ${feature.id ?? '<missing>'}`);
    if (feature.id) ids.add(feature.id);
    for (const field of ['spec', 'requirement', 'status'] as const) if (!feature[field]) errors.push(`${feature.id ?? '<missing>'}: missing ${field}`);
    if (feature.status && !statuses.has(feature.status)) errors.push(`${feature.id ?? '<missing>'}: invalid status`);
    const id = feature.id;
    if (id && aggregatePatterns.some((pattern) => pattern.test(id) || pattern.test(feature.requirement ?? ''))) errors.push(`${id}: aggregate feature records are not permitted; enumerate each normative item`);
    for (const dimension of DIMENSIONS as readonly ('editing' | 'inspection' | 'diagnostics' | 'roundtrip' | 'tests')[]) {
      const evidence = feature.evidence?.[dimension];
      if (!evidence || !evidence.status || !evidence.ids?.length) errors.push(`${feature.id}: malformed ${dimension} evidence`);
      if (evidence && !STATUSES.includes(evidence.status)) errors.push(`${feature.id}: invalid ${dimension} evidence status`);
      if (feature.status === 'complete' && evidence?.status !== 'complete') errors.push(`${feature.id}: completed claim lacks complete ${dimension} evidence`);
    }
    for (const facet of TEST_FACETS as readonly ('positive' | 'negative' | 'incomplete' | 'hostParity')[]) {
      const facetEvidence = feature.evidence?.tests?.facets?.[facet];
      if (!facetEvidence?.ids.length || !statuses.has(facetEvidence.status)) errors.push(`${feature.id}: malformed ${facet} test facet`);
      if (feature.status === 'complete' && facetEvidence?.status !== 'complete') errors.push(`${feature.id}: completed claim lacks complete ${facet} test facet`);
    }
  }
  if (features.filter((feature) => feature.spec === 'Core').length < minimumCore) errors.push(`at least ${minimumCore} owned Core feature records are required`);
  return errors;
}

export type CorpusExpectation = 'pass' | 'diagnostic';
export interface CorpusObservation {
  readonly id: string;
  readonly expected: CorpusExpectation;
  readonly observed: CorpusExpectation;
}
export interface CorpusMatrixSummary {
  readonly total: number;
  readonly pass: number;
  readonly expectedDiagnostic: number;
  readonly fail: number;
  readonly mismatches: readonly string[];
}

/** Summarizes a corpus sweep without conflating expected external diagnostics with parser failures. */
export function summarizeCorpusMatrix(observations: readonly CorpusObservation[]): CorpusMatrixSummary {
  let pass = 0;
  let expectedDiagnostic = 0;
  const mismatches: string[] = [];
  for (const observation of observations) {
    if (observation.expected === observation.observed) {
      if (observation.observed === 'pass') pass++;
      else expectedDiagnostic++;
    } else mismatches.push(observation.id);
  }
  return {
    total: observations.length,
    pass,
    expectedDiagnostic,
    fail: mismatches.length,
    mismatches
  };
}
