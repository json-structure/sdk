/**
 * JSON Structure SDK Types
 */

/**
 * Represents a location in a JSON document with line and column information.
 */
export interface JsonLocation {
  /** The 1-based line number. */
  line: number;
  /** The 1-based column number. */
  column: number;
}

/**
 * An unknown location (line 0, column 0).
 */
export const UNKNOWN_LOCATION: JsonLocation = { line: 0, column: 0 };

/**
 * Checks if a location is known (non-zero).
 */
export function isKnownLocation(location: JsonLocation): boolean {
  return location.line > 0 && location.column > 0;
}

/**
 * Formats a location as a string like "(line:column)".
 */
export function formatLocation(location: JsonLocation): string {
  return isKnownLocation(location) ? `(${location.line}:${location.column})` : '';
}

/**
 * Severity of a validation message.
 */
export type ValidationSeverity = 'error' | 'warning';

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  /** Whether the validation passed. */
  isValid: boolean;
  /** List of validation errors (empty if valid). */
  errors: ValidationError[];
}

/**
 * A single validation error.
 */
export interface ValidationError {
  /** Error code for programmatic handling. */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** JSON Pointer path to the error location. */
  path: string;
  /** Severity of the error. */
  severity?: ValidationSeverity;
  /** Source location in the JSON document. */
  location?: JsonLocation;
  /** Path in the schema that caused the error (for instance validation). */
  schemaPath?: string;
}

/**
 * Formats a validation error as a string.
 */
export function formatValidationError(error: ValidationError): string {
  const parts: string[] = [];
  
  if (error.path) {
    parts.push(error.path);
  }
  
  if (error.location && isKnownLocation(error.location)) {
    parts.push(formatLocation(error.location));
  }
  
  parts.push(`[${error.code}]`);
  parts.push(error.message);
  
  if (error.schemaPath) {
    parts.push(`(schema: ${error.schemaPath})`);
  }
  
  return parts.join(' ');
}

/**
 * Options for schema validation.
 */
export interface SchemaValidatorOptions {
  /** Enable extended validation features. */
  extended?: boolean;
  /** Allow $ in property names (required for validating metaschemas). */
  allowDollar?: boolean;
  /** Enable processing of $import/$importdefs. */
  allowImport?: boolean;
  /** Map of URIs to schema objects for import resolution. */
  externalSchemas?: Map<string, JsonValue>;
}

/**
 * Options for instance validation.
 */
export interface InstanceValidatorOptions {
  /** Enable extended validation features (maxLength, pattern, etc.). */
  extended?: boolean;
  /** Enable processing of $import/$importdefs. */
  allowImport?: boolean;
  /** Map of URIs to schema objects for import resolution. */
  externalSchemas?: Map<string, JsonValue>;
}

/**
 * JSON value types.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * All primitive types supported by JSON Structure Core.
 */
export const PRIMITIVE_TYPES = [
  'string', 'boolean', 'null',
  'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
  'int64', 'uint64', 'int128', 'uint128',
  'float', 'float8', 'double', 'decimal',
  'number', 'integer',
  'date', 'datetime', 'time', 'duration',
  'uuid', 'uri', 'binary', 'jsonpointer',
] as const;

export type PrimitiveType = typeof PRIMITIVE_TYPES[number];

/**
 * All compound types supported by JSON Structure Core.
 */
export const COMPOUND_TYPES = [
  'object', 'array', 'set', 'map', 'tuple', 'choice', 'any',
] as const;

export type CompoundType = typeof COMPOUND_TYPES[number];

/**
 * All valid JSON Structure types.
 */
export type JsonStructureType = PrimitiveType | CompoundType;
