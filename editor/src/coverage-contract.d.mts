export const CONTRACT_VERSION: number;
export const STATUSES: readonly string[];
export const DIMENSIONS: readonly string[];
export const TEST_FACETS: readonly string[];
export function loadCoverageInputs(projectRoot: string, environment?: NodeJS.ProcessEnv): Record<string, unknown>;
export function readJson(file: string): unknown;
export function validateCoverage(input: Record<string, unknown>): string[];