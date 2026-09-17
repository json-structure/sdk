import { compileSafeRegex, MAX_SAFE_REGEX_PATTERN_LENGTH } from './safe-regex.js';

/**
 * Defines the validation keyword map shape.
 */
export interface ValidationKeywordMap {
  readonly minimum: number | string;
  readonly maximum: number | string;
  readonly exclusiveMinimum: number | string;
  readonly exclusiveMaximum: number | string;
  readonly multipleOf: number | string;
  readonly minLength: number;
  readonly maxLength: number;
  readonly pattern: string;
  readonly format: string;
  readonly minItems: number;
  readonly maxItems: number;
  readonly uniqueItems: boolean;
  readonly minContains: number;
  readonly maxContains: number;
  readonly minProperties: number;
  readonly maxProperties: number;
  readonly minEntries: number;
  readonly maxEntries: number;
  readonly default: unknown;
  readonly contains: Readonly<Record<string, unknown>>;
  readonly propertyNames: Readonly<Record<string, unknown>>;
  readonly keyNames: Readonly<Record<string, unknown>>;
  readonly has: Readonly<Record<string, unknown>>;
  readonly dependentRequired: Readonly<Record<string, readonly string[]>>;
  readonly patternProperties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly patternKeys: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * Type alias for validation keyword.
 */
export type ValidationKeyword = keyof ValidationKeywordMap;
/**
 * Defines the validation issue shape.
 */
export interface ValidationIssue { readonly keyword: ValidationKeyword; readonly message: string; }

/**
 * Constant for validation keywords.
 */
export const VALIDATION_KEYWORDS = [
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems', 'minContains', 'maxContains',
  'minProperties', 'maxProperties', 'minEntries', 'maxEntries', 'default',
  'contains', 'propertyNames', 'keyNames', 'has', 'dependentRequired',
  'patternProperties', 'patternKeys'
] as const satisfies readonly ValidationKeyword[];

const NUMERIC_TYPES = new Set([
  'number', 'integer', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
  'int64', 'uint64', 'int128', 'uint128', 'float8', 'float', 'double', 'decimal'
]);
const INTEGER_TEXT = /^-?(?:0|[1-9]\d*)$/;
const UNSIGNED_INTEGER_TEXT = /^(?:0|[1-9]\d*)$/;
const DECIMAL_TEXT = /^-?(?:0|[1-9]\d*)\.\d+$/;
const FORMATS = new Set([
  'ipv4', 'ipv6', 'email', 'idn-email', 'hostname', 'idn-hostname', 'iri',
  'iri-reference', 'uri-template', 'relative-json-pointer', 'regex'
]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function validPattern(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const compilation = compileSafeRegex(value);
  return compilation.status === 'ready' || compilation.status === 'unsupported';
}
function validSchema(value: unknown): value is Readonly<Record<string, unknown>> {
  return isRecord(value) && (Object.prototype.hasOwnProperty.call(value, 'type') ||
    ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'].some((keyword) => Object.prototype.hasOwnProperty.call(value, keyword)));
}
function validSchemaMap(value: unknown): value is Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  return isRecord(value) && Object.entries(value).every(([pattern, schema]) => validPattern(pattern) && validSchema(schema));
}
function numericValue(value: unknown, typeName: string | undefined, positive: boolean): boolean {
  if (!typeName || !NUMERIC_TYPES.has(typeName)) return false;
  const valid = numericValueInCoreSpace(value, typeName);
  if (!valid || !positive) return valid;
  return typeof value === 'string' ? compareNumericTextToZero(value) > 0 : typeof value === 'number' && value > 0;
}
function integerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}
function integerTextInRange(value: unknown, signed: boolean, minimum: bigint, maximum: bigint): boolean {
  if (typeof value !== 'string' || !(signed ? INTEGER_TEXT : UNSIGNED_INTEGER_TEXT).test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= minimum && parsed <= maximum;
}
function compareNumericTextToZero(value: string): number {
  return /^-?0(?:\.0+)?$/.test(value) ? 0 : value.startsWith('-') ? -1 : 1;
}
function numericValueInCoreSpace(value: unknown, typeName: string): boolean {
  switch (typeName) {
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
    case 'int32': return integerInRange(value, -2147483648, 2147483647);
    case 'int8': return integerInRange(value, -128, 127);
    case 'uint8': return integerInRange(value, 0, 255);
    case 'int16': return integerInRange(value, -32768, 32767);
    case 'uint16': return integerInRange(value, 0, 65535);
    case 'uint32': return integerInRange(value, 0, 4294967295);
    case 'int64': return integerTextInRange(value, true, -(2n ** 63n), 2n ** 63n - 1n);
    case 'uint64': return integerTextInRange(value, false, 0n, 2n ** 64n - 1n);
    case 'int128': return integerTextInRange(value, true, -(2n ** 127n), 2n ** 127n - 1n);
    case 'uint128': return integerTextInRange(value, false, 0n, 2n ** 128n - 1n);
    case 'decimal': return typeof value === 'string' && DECIMAL_TEXT.test(value);
    case 'float8': return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 3.4e3;
    case 'float': return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 3.4e38;
    case 'double': return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1.7e308;
    default: return false;
  }
}

/**
 * Defines the effective validation types shape.
 */
export interface EffectiveValidationTypes {
  readonly types: readonly string[];
  readonly determinate: boolean;
}

/** Returns the one value-bearing type, allowing null as an orthogonal nullable branch. */
export function singleEffectiveValidationType(effective: EffectiveValidationTypes): string | undefined {
  if (!effective.determinate) return undefined;
  const valueTypes = effective.types.filter((type) => type !== 'null');
  if (valueTypes.length === 1) return valueTypes[0];
  return valueTypes.length === 0 && effective.types.length === 1 ? 'null' : undefined;
}

function pointerValue(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  return pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((current, part) =>
    isRecord(current) ? current[part] : undefined, root);
}
/**
 * Computes the effective validation types for the declaration.
 */
export function effectiveValidationTypes(root: unknown, declaration: Readonly<Record<string, unknown>>): EffectiveValidationTypes {
  const types = new Set<string>();
  let determinate = true;
  const visited = new Set<Readonly<Record<string, unknown>>>();
  const visitReference = (reference: unknown): void => {
    if (typeof reference !== 'string' || !reference.startsWith('#/')) { determinate = false; return; }
    const target = pointerValue(root, reference.slice(1));
    if (!isRecord(target)) { determinate = false; return; }
    visitSchema(target);
  };
  const visitType = (type: unknown): void => {
    if (typeof type === 'string') { types.add(type); return; }
    if (Array.isArray(type)) { type.forEach(visitType); return; }
    if (isRecord(type) && typeof type.$ref === 'string') { visitReference(type.$ref); return; }
    if (isRecord(type) && typeof type.type === 'string') { types.add(type.type); return; }
    determinate = false;
  };
  const visitSchema = (schema: Readonly<Record<string, unknown>>): void => {
    if (visited.has(schema)) { determinate = false; return; }
    visited.add(schema);
    const hasType = Object.prototype.hasOwnProperty.call(schema, 'type');
    if (hasType) visitType(schema.type);
    const bases = typeof schema.$extends === 'string' ? [schema.$extends] : Array.isArray(schema.$extends) ? schema.$extends : [];
    if (!hasType && bases.length === 0) determinate = false;
    bases.forEach(visitReference);
  };
  visitSchema(declaration);
  return { types: [...types], determinate };
}

/**
 * Validates validation keyword issue and narrows the value type when applicable.
 */
export function validationKeywordIssue(
  keyword: ValidationKeyword,
  value: unknown,
  typeName: string | undefined
): string | undefined {
  if (keyword === 'default') return undefined;
  if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].includes(keyword)) {
    return numericValue(value, typeName, keyword === 'multipleOf') ? undefined :
      `${keyword} must use the numeric value representation of the declaration type${keyword === 'multipleOf' ? ' and be greater than zero' : ''}.`;
  }
  if (keyword === 'minLength') return typeName === 'string' && isNonNegativeInteger(value) ? undefined : 'minLength requires a string declaration and a non-negative integer value.';
  if (keyword === 'maxLength') return typeName === 'string' && isNonNegativeInteger(value) ? undefined : 'maxLength requires a string declaration and a non-negative integer value.';
  if (keyword === 'pattern') return typeName === 'string' && validPattern(value) ? undefined : `pattern requires a string declaration and a valid ECMAScript regular expression no longer than ${MAX_SAFE_REGEX_PATTERN_LENGTH} UTF-16 code units.`;
  if (keyword === 'format') return typeName === 'string' && typeof value === 'string' && FORMATS.has(value) ? undefined : 'format requires a string declaration and a format named by the Validation specification.';
  if (keyword === 'minItems' || keyword === 'maxItems' || keyword === 'minContains' || keyword === 'maxContains') return (typeName === 'array' || typeName === 'set') && isNonNegativeInteger(value) ? undefined : `${keyword} requires an array or set declaration and a non-negative integer value.`;
  if (keyword === 'uniqueItems') return typeName === 'array' && typeof value === 'boolean' ? undefined : 'uniqueItems requires an array declaration and a boolean value.';
  if (keyword === 'contains') return (typeName === 'array' || typeName === 'set') && validSchema(value) ? undefined : 'contains requires an array or set declaration and a typed JSON Structure schema.';
  if (keyword === 'minProperties' || keyword === 'maxProperties') return typeName === 'object' && isNonNegativeInteger(value) ? undefined : `${keyword} requires an object declaration and a non-negative integer value.`;
  if (keyword === 'minEntries' || keyword === 'maxEntries') return typeName === 'map' && isNonNegativeInteger(value) ? undefined : `${keyword} requires a map declaration and a non-negative integer value.`;
  if (keyword === 'propertyNames') return typeName === 'object' && validSchema(value) && value.type === 'string' ? undefined : 'propertyNames requires an object declaration and a string-typed schema.';
  if (keyword === 'keyNames') return typeName === 'map' && validSchema(value) && value.type === 'string' ? undefined : 'keyNames requires a map declaration and a string-typed schema.';
  if (keyword === 'has') return (typeName === 'object' || typeName === 'map') && validSchema(value) && value.type === 'object' ? undefined : 'has requires an object or map declaration and an object-typed schema.';
  if (keyword === 'dependentRequired') return typeName === 'object' && isRecord(value) && Object.entries(value).every(([name, entry]) => IDENTIFIER.test(name) && Array.isArray(entry) && entry.every((item) => typeof item === 'string' && IDENTIFIER.test(item))) ? undefined : 'dependentRequired requires an object declaration and an object map from identifiers to identifier arrays.';
  if (keyword === 'patternProperties') return typeName === 'object' && validSchemaMap(value) ? undefined : 'patternProperties requires an object declaration and a map from valid ECMAScript patterns to typed schemas.';
  if (keyword === 'patternKeys') return typeName === 'map' && validSchemaMap(value) ? undefined : 'patternKeys requires a map declaration and a map from valid ECMAScript patterns to typed schemas.';
  return 'Unsupported Validation keyword.';
}

/**
 * Validates validation issues and narrows the value type when applicable.
 */
export function validationIssues(declaration: Readonly<Record<string, unknown>>, effectiveTypes?: EffectiveValidationTypes): readonly ValidationIssue[] {
  const resolved = effectiveTypes ?? { types: typeof declaration.type === 'string' ? [declaration.type] : [], determinate: typeof declaration.type === 'string' };
  const typeName = resolved.determinate && resolved.types.length === 1 ? resolved.types[0] : undefined;
  const issues: ValidationIssue[] = [];
  for (const keyword of VALIDATION_KEYWORDS) {
    if (!Object.prototype.hasOwnProperty.call(declaration, keyword)) continue;
    if (typeName === undefined && keyword !== 'default') continue;
    const message = validationKeywordIssue(keyword, declaration[keyword], typeName);
    if (message) issues.push({ keyword, message });
  }
  for (const keyword of ['minContains', 'maxContains'] as const) {
    if (Object.prototype.hasOwnProperty.call(declaration, keyword) && !Object.prototype.hasOwnProperty.call(declaration, 'contains')) {
      issues.push({ keyword, message: `${keyword} requires contains.` });
    }
  }
  return issues;
}

/**
 * Validates validation value is schema backed and narrows the value type when applicable.
 */
export function validationValueIsSchemaBacked(keyword: ValidationKeyword, value: unknown): boolean {
  if (keyword === 'contains' || keyword === 'propertyNames' || keyword === 'keyNames' || keyword === 'has') return validSchema(value);
  if (keyword === 'patternProperties' || keyword === 'patternKeys') return validSchemaMap(value);
  return true;
}