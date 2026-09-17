import { parseDocument, type ParseResult } from '../parser.js';

/** Conservative fixed limits for the supplied real Kubernetes document. */
export const KUBERNETES_PARSE_BUDGET = Object.freeze({
  maxSourceBytes: 600_000,
  maxDefinitions: 5_000,
  maxOperationCount: 8_000_000,
  maxAllocationCount: 250_000,
  maxWallClockMs: 15_000
});

export interface ParsePerformanceMeasurement {
  readonly result: ParseResult;
  readonly sourceBytes: number;
  readonly nodeCount: number;
  readonly definitionCount: number;
  readonly diagnosticCount: number;
  /** Actual values visited in the parsed JSON and normalized model projections. */
  readonly jsonTraversalCount: number;
  readonly modelTraversalCount: number;
  /** Traversal units over the parser's actual JSON and projection outputs. */
  readonly operationCount: number;
  /** Count of actual object/array containers exposed by the parser and projections. */
  readonly allocationCount: number;
  readonly elapsedMs: number;
}

function traversalUnits(value: unknown, seen = new Set<object>()): number {
  if (value === null || typeof value !== 'object') return 1;
  if (seen.has(value)) return 0;
  seen.add(value);
  let units = 1;
  if (Array.isArray(value)) {
    for (const item of value) units += 1 + traversalUnits(item, seen);
  } else {
    for (const item of Object.values(value)) units += 2 + traversalUnits(item, seen);
  }
  return units;
}

function containerAllocations(value: unknown, seen = new Set<object>()): number {
  if (value === null || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  let allocations = 1;
  if (Array.isArray(value)) {
    for (const item of value) allocations += containerAllocations(item, seen);
  } else {
    for (const item of Object.values(value)) allocations += containerAllocations(item, seen);
  }
  return allocations;
}

export function measureParsePerformance(uri: string, text: string): ParsePerformanceMeasurement {
  const started = globalThis.performance.now();
  const result = parseDocument(uri, text);
  const elapsedMs = globalThis.performance.now() - started;
  const nodeCount = result.model?.nodes.length ?? 0;
  const definitionCount = result.model?.projections.definitions.length ?? 0;
  const diagnosticCount = result.diagnostics.length;
  const sourceBytes = new TextEncoder().encode(text).length;
  const jsonTraversalCount = traversalUnits(result.value);
  const modelTraversalCount = result.model ? traversalUnits(result.model) : traversalUnits(result.diagnostics);
  return {
    result,
    sourceBytes,
    nodeCount,
    definitionCount,
    diagnosticCount,
    jsonTraversalCount,
    modelTraversalCount,
    operationCount: jsonTraversalCount + modelTraversalCount,
    allocationCount: containerAllocations(result.value) + (result.model ? containerAllocations(result.model) : containerAllocations(result.diagnostics)),
    elapsedMs
  };
}

export function parsePerformanceBudgetErrors(
  measurement: ParsePerformanceMeasurement,
  budget = KUBERNETES_PARSE_BUDGET
): readonly string[] {
  const errors: string[] = [];
  if (measurement.sourceBytes > budget.maxSourceBytes) errors.push(`source is ${measurement.sourceBytes} bytes; budget is ${budget.maxSourceBytes}`);
  if (measurement.definitionCount > budget.maxDefinitions) errors.push(`projection has ${measurement.definitionCount} definitions; budget is ${budget.maxDefinitions}`);
  if (measurement.operationCount > budget.maxOperationCount) errors.push(`actual traversal work is ${measurement.operationCount}; budget is ${budget.maxOperationCount}`);
  if (measurement.allocationCount > budget.maxAllocationCount) errors.push(`observed object/array allocations are ${measurement.allocationCount}; budget is ${budget.maxAllocationCount}`);
  if (measurement.elapsedMs > budget.maxWallClockMs) errors.push(`parse/projection took ${measurement.elapsedMs.toFixed(1)}ms; budget is ${budget.maxWallClockMs}ms`);
  return errors;
}