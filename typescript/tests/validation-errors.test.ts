import { describe, it, expect } from 'vitest';
import {
  createValidationError,
  schemaError,
  instanceError,
  validationWarning
} from '../src/validation-errors';
import { UNKNOWN_LOCATION } from '../src/types';

describe('Validation Error Helpers', () => {
  describe('createValidationError', () => {
    it('should create error with all fields', () => {
      const error = createValidationError(
        'TEST_CODE',
        'Test message',
        '/path',
        'error',
        { line: 5, column: 10 },
        '/schema/path'
      );

      expect(error.code).toBe('TEST_CODE');
      expect(error.message).toBe('Test message');
      expect(error.path).toBe('/path');
      expect(error.severity).toBe('error');
      expect(error.location.line).toBe(5);
      expect(error.location.column).toBe(10);
      expect(error.schemaPath).toBe('/schema/path');
    });

    it('should use default values for optional fields', () => {
      const error = createValidationError('CODE', 'Message');

      expect(error.code).toBe('CODE');
      expect(error.message).toBe('Message');
      expect(error.path).toBe('');
      expect(error.severity).toBe('error');
      expect(error.location).toEqual(UNKNOWN_LOCATION);
      expect(error.schemaPath).toBeUndefined();
    });

    it('should create warning when severity is warning', () => {
      const error = createValidationError(
        'WARN_CODE',
        'Warning message',
        '/path',
        'warning'
      );

      expect(error.severity).toBe('warning');
    });
  });

  describe('schemaError', () => {
    it('should create schema error with path and location', () => {
      const error = schemaError(
        'SCHEMA_ERROR',
        'Schema error message',
        '/definitions/Foo',
        { line: 10, column: 5 }
      );

      expect(error.code).toBe('SCHEMA_ERROR');
      expect(error.message).toBe('Schema error message');
      expect(error.path).toBe('/definitions/Foo');
      expect(error.severity).toBe('error');
      expect(error.location.line).toBe(10);
      expect(error.location.column).toBe(5);
    });

    it('should use defaults for optional fields', () => {
      const error = schemaError('CODE', 'Message');

      expect(error.path).toBe('');
      expect(error.location).toEqual(UNKNOWN_LOCATION);
      expect(error.severity).toBe('error');
    });
  });

  describe('instanceError', () => {
    it('should create instance error with all fields', () => {
      const error = instanceError(
        'INSTANCE_ERROR',
        'Instance error message',
        '/data/name',
        { line: 15, column: 3 },
        '/properties/name'
      );

      expect(error.code).toBe('INSTANCE_ERROR');
      expect(error.message).toBe('Instance error message');
      expect(error.path).toBe('/data/name');
      expect(error.severity).toBe('error');
      expect(error.location.line).toBe(15);
      expect(error.schemaPath).toBe('/properties/name');
    });

    it('should use defaults for optional fields', () => {
      const error = instanceError('CODE', 'Message');

      expect(error.path).toBe('');
      expect(error.location).toEqual(UNKNOWN_LOCATION);
      expect(error.schemaPath).toBeUndefined();
      expect(error.severity).toBe('error');
    });
  });

  describe('validationWarning', () => {
    it('should create warning with all fields', () => {
      const warning = validationWarning(
        'WARNING_CODE',
        'Warning message',
        '/properties/extra',
        { line: 20, column: 8 },
        '/additionalProperties'
      );

      expect(warning.code).toBe('WARNING_CODE');
      expect(warning.message).toBe('Warning message');
      expect(warning.path).toBe('/properties/extra');
      expect(warning.severity).toBe('warning');
      expect(warning.location.line).toBe(20);
      expect(warning.schemaPath).toBe('/additionalProperties');
    });

    it('should use defaults for optional fields', () => {
      const warning = validationWarning('CODE', 'Message');

      expect(warning.path).toBe('');
      expect(warning.location).toEqual(UNKNOWN_LOCATION);
      expect(warning.schemaPath).toBeUndefined();
      expect(warning.severity).toBe('warning');
    });

    it('should always have warning severity', () => {
      const warning = validationWarning('CODE', 'Any message');
      expect(warning.severity).toBe('warning');
    });
  });
});
