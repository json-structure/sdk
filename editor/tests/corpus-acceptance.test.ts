import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureParsePerformance, parsePerformanceBudgetErrors, KUBERNETES_PARSE_BUDGET } from '../src/performance/parser-budget.js';
import { parseDocument } from '../src/parser.js';
import { summarizeCorpusMatrix, type CorpusObservation } from '../src/coverage.js';
import { readJson } from '../src/coverage-contract.mjs';

interface CorpusSchemaEntry {
  readonly id: string;
  readonly source: string;
  readonly path: string;
  readonly expected: 'pass' | 'diagnostic';
  readonly profile: string;
  readonly diagnosticCodes: readonly string[];
  readonly diagnosticExpectations: readonly string[];
  readonly externalExpected?: string;
}

interface CorpusInventory {
  readonly corpus: { readonly required: readonly string[]; readonly schemas: readonly CorpusSchemaEntry[] };
}

interface BaselineDiagnostic {
  readonly code: string;
  readonly pointer: string;
}

interface BaselineEntry {
  readonly id: string;
  readonly source: string;
  readonly path: string;
  readonly expected: 'pass' | 'diagnostic';
  readonly sha256: string;
  readonly diagnostics: readonly BaselineDiagnostic[];
  readonly category: string;
}

interface CorpusBaseline {
  readonly version: number;
  readonly roots: readonly { readonly source: string; readonly path: string; readonly pattern: string }[];
  readonly counts: { readonly total: number; readonly expected: { readonly pass: number; readonly diagnostic: number } };
  readonly fixtures: readonly BaselineEntry[];
}

interface PerformanceBaseline {
  readonly version: number;
  readonly fixture: { readonly source: string; readonly path: string; readonly sha256: string };
  readonly measurement: {
    readonly sourceBytes: number;
    readonly nodeCount: number;
    readonly definitionCount: number;
    readonly diagnosticCount: number;
    readonly jsonTraversalCount: number;
    readonly modelTraversalCount: number;
    readonly operationCount: number;
    readonly allocationCount: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCorpusSchemaEntry(value: unknown): value is CorpusSchemaEntry {
  return isRecord(value) && typeof value.id === 'string' && typeof value.source === 'string' &&
    typeof value.path === 'string' && (value.expected === 'pass' || value.expected === 'diagnostic') &&
    typeof value.profile === 'string' && Array.isArray(value.diagnosticCodes) &&
    value.diagnosticCodes.every((code) => typeof code === 'string') && Array.isArray(value.diagnosticExpectations) &&
    value.diagnosticExpectations.every((diagnostic) => typeof diagnostic === 'string') &&
    (value.externalExpected === undefined || typeof value.externalExpected === 'string');
}

function isCorpusInventory(value: unknown): value is CorpusInventory {
  if (!isRecord(value) || !isRecord(value.corpus) || !Array.isArray(value.corpus.required) ||
      !value.corpus.required.every((id) => typeof id === 'string') || !Array.isArray(value.corpus.schemas)) return false;
  return value.corpus.schemas.every(isCorpusSchemaEntry);
}

function isCorpusBaseline(value: unknown): value is CorpusBaseline {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.roots) || !isRecord(value.counts) ||
      !isRecord(value.counts.expected) || !Array.isArray(value.fixtures)) return false;
  return value.fixtures.every((fixture) => isRecord(fixture) && typeof fixture.id === 'string' &&
    typeof fixture.source === 'string' && typeof fixture.path === 'string' &&
    (fixture.expected === 'pass' || fixture.expected === 'diagnostic') && typeof fixture.sha256 === 'string' &&
    Array.isArray(fixture.diagnostics) && fixture.diagnostics.every((diagnostic) => isRecord(diagnostic) &&
      typeof diagnostic.code === 'string' && typeof diagnostic.pointer === 'string'));
}

function isPerformanceBaseline(value: unknown): value is PerformanceBaseline {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.fixture) || !isRecord(value.measurement) ||
      typeof value.fixture.source !== 'string' || typeof value.fixture.path !== 'string' || typeof value.fixture.sha256 !== 'string') return false;
  const measurement = value.measurement;
  return ['sourceBytes', 'nodeCount', 'definitionCount', 'diagnosticCount', 'jsonTraversalCount', 'modelTraversalCount', 'operationCount', 'allocationCount']
    .every((field) => typeof measurement[field] === 'number');
}

const inventoryValue: unknown = readJson(path.join(process.cwd(), 'coverage', 'inventory.json'));
const baselineValue: unknown = readJson(path.join(process.cwd(), 'coverage', 'corpus-baseline.json'));
const performanceBaselineValue: unknown = readJson(path.join(process.cwd(), 'coverage', 'performance-baseline.json'));
if (!isCorpusInventory(inventoryValue)) throw new Error('malformed corpus inventory');
if (!isCorpusBaseline(baselineValue)) throw new Error('malformed corpus diagnostic baseline');
if (!isPerformanceBaseline(performanceBaselineValue)) throw new Error('malformed performance baseline');
const inventory = inventoryValue;
const baseline = baselineValue;
const performanceBaseline = performanceBaselineValue;
const baselineById = new Map(baseline.fixtures.map((entry) => [entry.id, entry]));
const required = new Set(inventory.corpus.required);

function corpusResult(entry: (typeof inventory.corpus.schemas)[number]) {
  const authoritative = baselineById.get(entry.id);
  if (!authoritative || authoritative.source !== entry.source || authoritative.path !== entry.path || authoritative.expected !== entry.expected || authoritative.category !== entry.profile) throw new Error(`inventory fixture disagrees with authoritative baseline: ${entry.id}`);
  const baselineCodes = [...new Set(authoritative.diagnostics.map((diagnostic) => diagnostic.code))];
  const baselineExpectations = authoritative.diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.pointer}`);
  if (JSON.stringify(entry.diagnosticCodes) !== JSON.stringify(baselineCodes) || JSON.stringify(entry.diagnosticExpectations) !== JSON.stringify(baselineExpectations)) throw new Error(`inventory diagnostics disagree with authoritative baseline: ${entry.id}`);
  const file = path.resolve(process.cwd(), authoritative.path);
  const text = readFileSync(file, 'utf8');
  const sha256 = createHash('sha256').update(text).digest('hex');
  if (sha256 !== authoritative.sha256) throw new Error(`corpus fixture hash differs from authoritative baseline: ${entry.id}`);
  const parsed = parseDocument(`file://${file}`, text);
  return { entry, authoritative, file, text, parsed };
}

describe('real corpus acceptance matrix', { timeout: 120_000 }, () => {
  it('sweeps every inventoried schema through parser and projections against the independent baseline', () => {
    const rows = inventory.corpus.schemas.map(corpusResult);
    const observed: Array<CorpusObservation & { readonly diagnostics: string[] }> = rows.map(({ entry, authoritative, parsed }) => ({
      id: entry.id,
      expected: authoritative.expected,
      observed: parsed.diagnostics.length === 0 ? 'pass' : 'diagnostic',
      diagnostics: parsed.diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.location?.pointer ?? ''}`)
    }));
    const summary = summarizeCorpusMatrix(observed);
    const projectionRows = rows.filter(({ parsed }) => parsed.recovery === 'valid' && parsed.model?.projections !== undefined);
    const projectionDefinitions = projectionRows.reduce((total, row) => total + (row.parsed.model?.projections.definitions.length ?? 0), 0);
    console.log(`[corpus] total=${summary.total} pass=${summary.pass} expectedDiagnostic=${summary.expectedDiagnostic} fail=${summary.fail} projected=${projectionRows.length} definitions=${projectionDefinitions}`);
    const expectedDiagnostics = rows.map(({ entry, authoritative, parsed }) => ({
      id: entry.id,
      actual: parsed.diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.location?.pointer ?? ''}`),
      expected: authoritative.diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.pointer}`)
    })).filter((row) => JSON.stringify(row.actual) !== JSON.stringify(row.expected));
    const mismatches = observed.filter((row) => row.expected !== row.observed);
    expect(summary.mismatches).toEqual([]);
    expect(mismatches).toEqual([]);
    expect(expectedDiagnostics).toEqual([]);
    expect(projectionRows).toHaveLength(rows.length);
    expect(projectionDefinitions).toBeGreaterThan(0);
    expect(rows.filter(({ authoritative }) => authoritative.expected === 'pass')).not.toHaveLength(0);
    expect(rows.filter(({ authoritative }) => authoritative.expected === 'diagnostic')).not.toHaveLength(0);
  });

  it('keeps required Core, extension, and SDK cases structurally viewable', () => {
    const rows = inventory.corpus.schemas.filter((entry) => required.has(entry.id)).map(corpusResult);
    const missing = rows.filter(({ parsed }) => parsed.recovery !== 'valid' || !parsed.model || parsed.model.nodes.length === 0);
    expect(missing.map(({ entry }) => entry.id)).toEqual([]);
    const find = (needle: string) => rows.find(({ entry }) => entry.id.includes(needle));
    for (const needle of ['samples.core.', 'samples.relations.', 'samples.semantic-annotations.']) {
      expect(rows.some(({ entry, parsed }) => entry.id.includes(needle) && !!parsed.model?.projections.definitions.length), needle).toBe(true);
    }
    expect(find('semantic-annotations.01-observation-basics')?.parsed.model?.projections.semanticPlacements.length).toBeGreaterThan(0);
    expect(find('semantic-annotations.15-station-network-telemetry')?.parsed.model?.projections.semanticPlacements.length).toBeGreaterThan(0);
    expect(find('semantic-annotations.real-world.06-solar-xray-flare')?.parsed.model?.projections.semanticPlacements.length).toBeGreaterThan(0);
    expect(rows.some(({ parsed }) => parsed.model?.projections.definitions.some((definition) => definition.units !== undefined))).toBe(true);
    expect(rows.some(({ parsed }) => parsed.model?.projections.definitions.some((definition) => definition.alternateNames !== undefined))).toBe(true);
    expect(rows.some(({ parsed }) => parsed.model?.projections.definitions.some((definition) => definition.relations.length > 0))).toBe(true);
    expect(find('semantic-annotations.real-world.24-fogra-characterization-patch')?.parsed.model?.projections.definitions.some((definition) => definition.semantic?.colorSpaces !== undefined)).toBe(true);
    const namespaceImport = find('import.02-namespace-import');
    expect(namespaceImport?.parsed.diagnostics.some((diagnostic) => diagnostic.location?.pointer === '/definitions/People/$import' && diagnostic.code === 'json.keyword-invalid')).toBe(true);
    const validImport = parseDocument('memory://valid-import', JSON.stringify({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $id: 'urn:json-structure:valid-import',
      name: 'ValidImport',
      $import: 'https://example.org/library.struct.json',
      definitions: {}
    }));
    expect(validImport.model?.projections.imports).toContainEqual(expect.objectContaining({ keyword: '$import', source: 'https://example.org/library.struct.json' }));
    expect(find('schemas.adversarial.deeply-nested-allof')?.parsed.model?.projections.definitions.some((definition) => definition.composition?.allOf !== undefined)).toBe(true);
    expect(find('schemas.adversarial.oneof-all-match')?.parsed.model?.projections.definitions.some((definition) => definition.composition?.oneOf !== undefined)).toBe(true);
    expect(find('schemas.validation.object-dependentrequired-with-uses')?.parsed.model?.projections.definitions.some((definition) => definition.validation?.dependentRequired !== undefined)).toBe(true);
  });

  it('fails closed when a pass fixture is deliberately corrupted', () => {
    const entry = inventory.corpus.schemas.find((candidate) => candidate.expected === 'pass');
    if (!entry) throw new Error('corpus has no pass fixture');
    const authoritative = baselineById.get(entry.id);
    if (!authoritative) throw new Error(`missing authoritative fixture ${entry.id}`);
    const file = path.resolve(process.cwd(), authoritative.path);
    const parsed = parseDocument(`file://${file}`, `${readFileSync(file, 'utf8')}\n}`);
    const summary = summarizeCorpusMatrix([{ id: entry.id, expected: authoritative.expected, observed: parsed.diagnostics.length === 0 ? 'pass' : 'diagnostic' }]);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(summary).toEqual({ total: 1, pass: 0, expectedDiagnostic: 0, fail: 1, mismatches: [entry.id] });
  });

  it('enforces a budget using the supplied real Kubernetes fixture', () => {
    const fixturePath = path.resolve(process.cwd(), performanceBaseline.fixture.path);
    expect(performanceBaseline.fixture.source).toBe('avrotize');
    expect(performanceBaseline.fixture.path).toBe('..\\..\\avrotize\\test\\jsons\\kubernetes-definitions-ref.struct.json');
    expect(existsSync(fixturePath)).toBe(true);
    const source = readFileSync(fixturePath, 'utf8');
    expect(createHash('sha256').update(source).digest('hex')).toBe(performanceBaseline.fixture.sha256);
    const measurement = measureParsePerformance(`file://${fixturePath}`, source);
    console.log(`[performance] fixture=${performanceBaseline.fixture.path} source=${measurement.sourceBytes} nodes=${measurement.nodeCount} definitions=${measurement.definitionCount} diagnostics=${measurement.diagnosticCount} jsonTraversal=${measurement.jsonTraversalCount} modelTraversal=${measurement.modelTraversalCount} operations=${measurement.operationCount} allocations=${measurement.allocationCount} elapsedMs=${measurement.elapsedMs.toFixed(1)}`);
    expect(measurement.result.recovery).toBe('valid');
    expect(measurement.result.model?.projections.definitions.length).toBe(measurement.definitionCount);
    for (const field of ['sourceBytes', 'nodeCount', 'definitionCount', 'diagnosticCount', 'jsonTraversalCount', 'modelTraversalCount', 'operationCount', 'allocationCount'] as const) {
      expect(measurement[field]).toBe(performanceBaseline.measurement[field]);
    }
    expect(parsePerformanceBudgetErrors(measurement, KUBERNETES_PARSE_BUDGET)).toEqual([]);
    expect(measurement.elapsedMs).toBeLessThan(KUBERNETES_PARSE_BUDGET.maxWallClockMs);
  });
});