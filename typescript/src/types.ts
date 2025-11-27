/**
 * JSON Structure SDK Types
 */

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
  /** JSON Pointer path to the error location. */
  path: string;
  /** Human-readable error message. */
  message: string;
  /** Error code for programmatic handling. */
  code?: string;
}

/**
 * Options for schema validation.
 */
export interface SchemaValidatorOptions {
  /** Enable extended validation features. */
  extended?: boolean;
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
