import { effectiveValidationTypes } from './validation.js';

/**
 * Defines the units keyword map shape.
 */
export interface UnitsKeywordMap {
  readonly symbol: string;
  readonly symbols: Readonly<Record<string, string>>;
  readonly unit: string;
  readonly ucumUnit: string;
  readonly currency: string;
}
/**
 * Type alias for units keyword.
 */
export type UnitsKeyword = keyof UnitsKeywordMap;
/**
 * Defines the units issue shape.
 */
export interface UnitsIssue { readonly keyword: UnitsKeyword; readonly message: string; readonly severity: 'error' | 'warning'; }

/**
 * Constant for units keywords.
 */
export const UNITS_KEYWORDS = ['symbol', 'symbols', 'unit', 'ucumUnit', 'currency'] as const satisfies readonly UnitsKeyword[];
const NUMERIC_TYPES = new Set([
  'number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
  'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal'
]);
const LANGUAGE_TAG = /^(?:[A-Za-z]{2,8})(?:-[A-Za-z0-9]{1,8})*$/;
const UNIT_TOKEN = "[^\\s*/^]+";
const UNIT_EXPRESSION = new RegExp(`^${UNIT_TOKEN}(?:\\^-?[0-9]+)?(?:[*/]${UNIT_TOKEN}(?:\\^-?[0-9]+)?)*$`, 'u');
const UCUM_EXPRESSION = /^(?:1|(?:[A-Za-z%][A-Za-z0-9%]*|\[[A-Za-z0-9_.]+\])(?:-?[0-9]+)?(?:[./](?:[A-Za-z%][A-Za-z0-9%]*|\[[A-Za-z0-9_.]+\])(?:-?[0-9]+)?)*)$/;
const EQUIVALENT_UNITS = new Map<string, string>([
  ['m', 'm'], ['m/s', 'm/s'], ['m/s^2', 'm/s2'], ['kg', 'kg'], ['s', 's'], ['K', 'K'], ['L', 'L'],
  ['J', 'J'], ['W', 'W'], ['A', 'A'], ['cd', 'cd'], ['m^2', 'm2'], ['m^3', 'm3'], ['bar', 'bar'], ['bit/s', 'bit/s']
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
/**
 * Validates valid symbols and narrows the value type when applicable.
 */
export function validSymbols(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.entries(value).every(([purpose, symbol]) =>
    typeof symbol === 'string' && (!purpose.startsWith('lang:') || LANGUAGE_TAG.test(purpose.slice(5))));
}
/**
 * Validates valid unit expression and narrows the value type when applicable.
 */
export function validUnitExpression(value: unknown): value is string {
  return typeof value === 'string' && UNIT_EXPRESSION.test(value);
}
/**
 * Validates valid ucum expression and narrows the value type when applicable.
 */
export function validUcumExpression(value: unknown): value is string {
  return typeof value === 'string' && UCUM_EXPRESSION.test(value);
}
/**
 * Performs units issues logic.
 */
export function unitsIssues(root: unknown, declaration: Readonly<Record<string, unknown>>): readonly UnitsIssue[] {
  const effective = effectiveValidationTypes(root, declaration);
  const numeric = effective.determinate && effective.types.length === 1 && NUMERIC_TYPES.has(effective.types[0]);
  const issues: UnitsIssue[] = [];
  if (Object.prototype.hasOwnProperty.call(declaration, 'symbol') && typeof declaration.symbol !== 'string') {
    issues.push({ keyword: 'symbol', message: 'symbol must be a JSON string.', severity: 'error' });
  }
  if (Object.prototype.hasOwnProperty.call(declaration, 'symbols') && !validSymbols(declaration.symbols)) {
    issues.push({ keyword: 'symbols', message: 'symbols must be a string map; lang: keys must contain an RFC 5646 language tag.', severity: 'error' });
  }
  if (Object.prototype.hasOwnProperty.call(declaration, 'unit') && effective.determinate && (!numeric || !validUnitExpression(declaration.unit))) {
    issues.push({ keyword: 'unit', message: 'unit requires one numeric underlying type and a unit expression using *, /, and ^ notation.', severity: 'error' });
  }
  if (Object.prototype.hasOwnProperty.call(declaration, 'ucumUnit') && effective.determinate && (!numeric || !validUcumExpression(declaration.ucumUnit))) {
    issues.push({ keyword: 'ucumUnit', message: 'ucumUnit requires one numeric underlying type and a case-sensitive UCUM expression.', severity: 'error' });
  }
  if (Object.prototype.hasOwnProperty.call(declaration, 'currency') && typeof declaration.currency !== 'string') {
    issues.push({ keyword: 'currency', message: 'currency must be a JSON string.', severity: 'error' });
  }
  if (typeof declaration.unit === 'string' && typeof declaration.ucumUnit === 'string') {
    const expected = EQUIVALENT_UNITS.get(declaration.unit);
    if (expected !== undefined && expected !== declaration.ucumUnit) {
      issues.push({ keyword: 'ucumUnit', message: 'unit and ucumUnit identify different well-known units.', severity: 'warning' });
    }
  }
  return issues;
}
/**
 * Validates units value valid and narrows the value type when applicable.
 */
export function unitsValueValid(root: unknown, declaration: Readonly<Record<string, unknown>>, keyword: UnitsKeyword, value: unknown): boolean {
  const candidate = { ...declaration, [keyword]: value };
  return unitsIssues(root, candidate).every((issue) => issue.severity !== 'error');
}