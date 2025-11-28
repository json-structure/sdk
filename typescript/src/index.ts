/**
 * JSON Structure SDK for TypeScript/JavaScript
 * 
 * Official SDK for validating JSON documents against JSON Structure schemas.
 */

export { SchemaValidator } from './schema-validator';
export { InstanceValidator } from './instance-validator';
export {
  ValidationResult,
  ValidationError,
  ValidationSeverity,
  JsonLocation,
  UNKNOWN_LOCATION,
  isKnownLocation,
  formatLocation,
  formatValidationError,
  SchemaValidatorOptions,
  InstanceValidatorOptions,
  JsonValue,
  JsonObject,
  JsonArray,
  JsonPrimitive,
  PRIMITIVE_TYPES,
  COMPOUND_TYPES,
  PrimitiveType,
  CompoundType,
  JsonStructureType,
} from './types';

// Error codes
export { ErrorCodes } from './error-codes';
export * from './error-codes';

// Source location tracking
export { JsonSourceLocator } from './json-source-locator';

// Validation error helpers
export {
  createValidationError,
  schemaError,
  instanceError,
  validationWarning,
} from './validation-errors';

// Serialization helpers for JSON Structure types
export {
  Int64,
  UInt64,
  Int128,
  UInt128,
  Decimal,
  Duration,
  DateOnly,
  TimeOnly,
  Binary,
  UUID,
  JSONPointer,
  jsonStructureReviver,
  jsonStructureReplacer,
} from './serialization';
