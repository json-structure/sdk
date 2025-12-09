import { describe, it, expect } from 'vitest';
import { SchemaValidator } from '../src/schema-validator';
import { InstanceValidator } from '../src/instance-validator';

describe('Validator Reentrancy and Thread Safety', () => {
  describe('SchemaValidator', () => {
    it('should not leak errors between sequential validations', () => {
      const validator = new SchemaValidator();
      
      // First validation - invalid schema (missing $id)
      const invalidSchema = {
        name: 'Test',
        type: 'string',
      };
      
      const result1 = validator.validate(invalidSchema);
      expect(result1.isValid).toBe(false);
      expect(result1.errors.length).toBeGreaterThan(0);
      
      // Second validation - valid schema
      const validSchema = {
        $id: 'urn:example:test',
        name: 'Test',
        type: 'string',
      };
      
      const result2 = validator.validate(validSchema);
      expect(result2.isValid).toBe(true);
      expect(result2.errors).toHaveLength(0);
      
      // Third validation - different invalid schema
      const invalidSchema2 = {
        $id: 'urn:example:test2',
        name: 'Test2',
        type: 'unknowntype',
      };
      
      const result3 = validator.validate(invalidSchema2);
      expect(result3.isValid).toBe(false);
      // Should only have errors from this validation, not from previous ones
      // The error should be about the unknown type, not about missing $id
      const hasOnlyTypeError = result3.errors.every(e => 
        e.code === 'SCHEMA_TYPE_INVALID' || e.path.includes('/type')
      );
      expect(hasOnlyTypeError).toBe(true);
    });

    it('should handle multiple validations with the same validator instance', () => {
      const validator = new SchemaValidator();
      const schema = {
        $id: 'urn:example:person',
        name: 'Person',
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'int32' },
        },
      };
      
      // Run the same validation multiple times
      for (let i = 0; i < 5; i++) {
        const result = validator.validate(schema);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('should not share seenRefs state between validations', () => {
      const validator = new SchemaValidator();
      
      // Schema with a circular reference
      const schemaWithRef = {
        $id: 'urn:example:circular',
        name: 'Node',
        type: 'object',
        properties: {
          value: { type: 'string' },
          next: { type: { $ref: '#' } },
        },
        definitions: {
          Test: {
            type: 'string'
          }
        }
      };
      
      // First validation
      const result1 = validator.validate(schemaWithRef);
      expect(result1.isValid).toBe(true);
      
      // Second validation with a different schema
      const differentSchema = {
        $id: 'urn:example:simple',
        name: 'Simple',
        type: 'string',
      };
      
      const result2 = validator.validate(differentSchema);
      expect(result2.isValid).toBe(true);
      
      // Third validation back to the circular one
      const result3 = validator.validate(schemaWithRef);
      expect(result3.isValid).toBe(true);
    });

    it('should not share warnings between validations', () => {
      const validator = new SchemaValidator({ warnOnUnusedExtensionKeywords: true });
      
      // Schema with validation keywords but no $uses
      const schemaWithWarning = {
        $id: 'urn:example:warn',
        name: 'WithWarning',
        type: 'string',
        minLength: 5, // Should generate a warning
      };
      
      const result1 = validator.validate(schemaWithWarning);
      expect(result1.warnings.length).toBeGreaterThan(0);
      
      // Schema without warnings
      const schemaNoWarning = {
        $id: 'urn:example:no-warn',
        name: 'NoWarning',
        type: 'string',
      };
      
      const result2 = validator.validate(schemaNoWarning);
      expect(result2.warnings).toHaveLength(0);
    });
  });

  describe('InstanceValidator', () => {
    it('should not leak errors between sequential validations', () => {
      const validator = new InstanceValidator();
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'int32' },
        },
        required: ['name'],
      };
      
      // First validation - invalid instance (missing required field)
      const result1 = validator.validate({ age: 30 }, schema);
      expect(result1.isValid).toBe(false);
      expect(result1.errors.length).toBeGreaterThan(0);
      
      // Second validation - valid instance
      const result2 = validator.validate({ name: 'Alice', age: 30 }, schema);
      expect(result2.isValid).toBe(true);
      expect(result2.errors).toHaveLength(0);
      
      // Third validation - different invalid instance
      const result3 = validator.validate({ name: 'Bob', age: 'not a number' }, schema);
      expect(result3.isValid).toBe(false);
      // Should only have type error for age, not the missing field error from first validation
      expect(result3.errors.length).toBe(1);
      expect(result3.errors[0].code).toBe('INSTANCE_TYPE_MISMATCH');
      expect(result3.errors[0].path).toBe('#/age');
    });

    it('should handle multiple validations with the same validator instance', () => {
      const validator = new InstanceValidator();
      const schema = { type: 'string' };
      
      // Run multiple validations
      for (let i = 0; i < 5; i++) {
        const result = validator.validate(`test${i}`, schema);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('should not share enabledExtensions state between validations', () => {
      const validator = new InstanceValidator({ extended: false });
      
      // Schema with validation extensions enabled
      const extendedSchema = {
        $uses: ['JSONStructureValidation'],
        type: 'string',
        minLength: 3,
      };
      
      // First validation with extended features
      const result1 = validator.validate('ab', extendedSchema);
      expect(result1.isValid).toBe(false);
      expect(result1.errors.some(e => e.message.includes('minLength'))).toBe(true);
      
      // Second validation without extended features
      const basicSchema = {
        type: 'string',
      };
      
      const result2 = validator.validate('x', basicSchema);
      expect(result2.isValid).toBe(true);
      
      // Third validation back to extended
      const result3 = validator.validate('abcd', extendedSchema);
      expect(result3.isValid).toBe(true);
    });

    it('should handle conditional validations without state leakage', () => {
      const validator = new InstanceValidator({ extended: true });
      
      // Schema with anyOf
      const schema = {
        $uses: ['JSONStructureConditionalComposition'],
        anyOf: [
          { type: 'string' },
          { type: 'int32' },
        ],
      };
      
      // Multiple validations with different types
      const result1 = validator.validate('hello', schema);
      expect(result1.isValid).toBe(true);
      
      const result2 = validator.validate(42, schema);
      expect(result2.isValid).toBe(true);
      
      const result3 = validator.validate(true, schema);
      expect(result3.isValid).toBe(false);
      
      // Another valid one to ensure no state leakage
      const result4 = validator.validate('world', schema);
      expect(result4.isValid).toBe(true);
    });
  });

  describe('Async simulation', () => {
    it('should handle interleaved schema validations safely', async () => {
      const validator = new SchemaValidator();
      
      const schemas = [
        {
          $id: 'urn:example:schema1',
          name: 'Schema1',
          type: 'string',
        },
        {
          $id: 'urn:example:schema2',
          name: 'Schema2',
          type: 'int32',
        },
        {
          $id: 'urn:example:schema3',
          name: 'Schema3',
          type: 'object',
          properties: {
            field: { type: 'string' },
          },
        },
      ];
      
      // Simulate async interleaving with Promise.all
      const results = await Promise.all(
        schemas.map(async (schema, i) => {
          // Add some artificial async delay
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          return validator.validate(schema);
        })
      );
      
      // All validations should succeed independently
      results.forEach((result, i) => {
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should handle interleaved instance validations safely', async () => {
      const validator = new InstanceValidator();
      
      const testCases = [
        { instance: 'hello', schema: { type: 'string' }, shouldBeValid: true },
        { instance: 42, schema: { type: 'int32' }, shouldBeValid: true },
        { instance: { name: 'Alice' }, schema: { type: 'object', properties: { name: { type: 'string' } } }, shouldBeValid: true },
        { instance: 'invalid', schema: { type: 'int32' }, shouldBeValid: false },
      ];
      
      // Simulate async interleaving
      const results = await Promise.all(
        testCases.map(async ({ instance, schema, shouldBeValid }) => {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          return { result: validator.validate(instance, schema), shouldBeValid };
        })
      );
      
      // Each validation should have the correct result
      results.forEach(({ result, shouldBeValid }) => {
        expect(result.isValid).toBe(shouldBeValid);
      });
    });
  });
});
