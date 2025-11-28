/**
 * Helper functions for creating validation errors with consistent structure.
 */

import { ValidationError, ValidationSeverity, JsonLocation, UNKNOWN_LOCATION } from './types';

/**
 * Creates a validation error with all fields.
 */
export function createValidationError(
  code: string,
  message: string,
  path: string = '',
  severity: ValidationSeverity = 'error',
  location: JsonLocation = UNKNOWN_LOCATION,
  schemaPath?: string
): ValidationError {
  return { code, message, path, severity, location, schemaPath };
}

/**
 * Creates a schema validation error.
 */
export function schemaError(
  code: string,
  message: string,
  path: string = '',
  location: JsonLocation = UNKNOWN_LOCATION
): ValidationError {
  return { code, message, path, severity: 'error', location };
}

/**
 * Creates an instance validation error.
 */
export function instanceError(
  code: string,
  message: string,
  path: string = '',
  location: JsonLocation = UNKNOWN_LOCATION,
  schemaPath?: string
): ValidationError {
  return { code, message, path, severity: 'error', location, schemaPath };
}

/**
 * Creates a validation warning.
 */
export function validationWarning(
  code: string,
  message: string,
  path: string = '',
  location: JsonLocation = UNKNOWN_LOCATION,
  schemaPath?: string
): ValidationError {
  return { code, message, path, severity: 'warning', location, schemaPath };
}
