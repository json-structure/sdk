import { describe, it, expect } from 'vitest';
import { InstanceValidator } from '../src/instance-validator';

describe('InstanceValidator', () => {
  describe('primitive types', () => {
    it('should validate string type', () => {
      const schema = { type: 'string' };
      const validator = new InstanceValidator();

      expect(validator.validate('hello', schema).isValid).toBe(true);
      expect(validator.validate(123, schema).isValid).toBe(false);
    });

    it('should validate boolean type', () => {
      const schema = { type: 'boolean' };
      const validator = new InstanceValidator();

      expect(validator.validate(true, schema).isValid).toBe(true);
      expect(validator.validate(false, schema).isValid).toBe(true);
      expect(validator.validate('true', schema).isValid).toBe(false);
    });

    it('should validate null type', () => {
      const schema = { type: 'null' };
      const validator = new InstanceValidator();

      expect(validator.validate(null, schema).isValid).toBe(true);
      expect(validator.validate(undefined, schema).isValid).toBe(false);
    });

    it('should validate number type', () => {
      const schema = { type: 'number' };
      const validator = new InstanceValidator();

      expect(validator.validate(42, schema).isValid).toBe(true);
      expect(validator.validate(3.14, schema).isValid).toBe(true);
      expect(validator.validate('42', schema).isValid).toBe(false);
    });

    it('should validate int32 type', () => {
      const schema = { type: 'int32' };
      const validator = new InstanceValidator();

      expect(validator.validate(42, schema).isValid).toBe(true);
      expect(validator.validate(-2147483648, schema).isValid).toBe(true);
      expect(validator.validate(2147483647, schema).isValid).toBe(true);
      expect(validator.validate(2147483648, schema).isValid).toBe(false);
      expect(validator.validate(3.14, schema).isValid).toBe(false);
    });

    it('should validate int8 range', () => {
      const schema = { type: 'int8' };
      const validator = new InstanceValidator();

      expect(validator.validate(127, schema).isValid).toBe(true);
      expect(validator.validate(-128, schema).isValid).toBe(true);
      expect(validator.validate(128, schema).isValid).toBe(false);
      expect(validator.validate(-129, schema).isValid).toBe(false);
    });

    it('should validate uint8 range', () => {
      const schema = { type: 'uint8' };
      const validator = new InstanceValidator();

      expect(validator.validate(0, schema).isValid).toBe(true);
      expect(validator.validate(255, schema).isValid).toBe(true);
      expect(validator.validate(-1, schema).isValid).toBe(false);
      expect(validator.validate(256, schema).isValid).toBe(false);
    });

    it('should validate int64 as string', () => {
      const schema = { type: 'int64' };
      const validator = new InstanceValidator();

      expect(validator.validate('9223372036854775807', schema).isValid).toBe(true);
      expect(validator.validate('-9223372036854775808', schema).isValid).toBe(true);
      expect(validator.validate(123, schema).isValid).toBe(false); // Must be string
    });

    it('should validate uint64 as string', () => {
      const schema = { type: 'uint64' };
      const validator = new InstanceValidator();

      expect(validator.validate('18446744073709551615', schema).isValid).toBe(true);
      expect(validator.validate('0', schema).isValid).toBe(true);
      expect(validator.validate('-1', schema).isValid).toBe(false);
    });

    it('should validate decimal as string', () => {
      const schema = { type: 'decimal' };
      const validator = new InstanceValidator();

      expect(validator.validate('123.456', schema).isValid).toBe(true);
      expect(validator.validate('invalid', schema).isValid).toBe(false);
      expect(validator.validate(123.456, schema).isValid).toBe(false); // Must be string
    });
  });

  describe('date/time types', () => {
    it('should validate date format', () => {
      const schema = { type: 'date' };
      const validator = new InstanceValidator();

      expect(validator.validate('2024-01-15', schema).isValid).toBe(true);
      expect(validator.validate('2024-1-15', schema).isValid).toBe(false);
      expect(validator.validate('01/15/2024', schema).isValid).toBe(false);
    });

    it('should validate datetime format', () => {
      const schema = { type: 'datetime' };
      const validator = new InstanceValidator();

      expect(validator.validate('2024-01-15T10:30:00Z', schema).isValid).toBe(true);
      expect(validator.validate('2024-01-15T10:30:00+05:00', schema).isValid).toBe(true);
      expect(validator.validate('2024-01-15T10:30:00.123Z', schema).isValid).toBe(true);
      expect(validator.validate('2024-01-15', schema).isValid).toBe(false);
    });

    it('should validate time format', () => {
      const schema = { type: 'time' };
      const validator = new InstanceValidator();

      expect(validator.validate('10:30:00', schema).isValid).toBe(true);
      expect(validator.validate('10:30:00.123', schema).isValid).toBe(true);
      expect(validator.validate('10:30', schema).isValid).toBe(false);
    });

    it('should validate duration format', () => {
      const schema = { type: 'duration' };
      const validator = new InstanceValidator();

      expect(validator.validate('P1Y2M3D', schema).isValid).toBe(true);
      expect(validator.validate('PT1H30M', schema).isValid).toBe(true);
      expect(validator.validate('P1Y2M3DT4H5M6S', schema).isValid).toBe(true);
      expect(validator.validate('P2W', schema).isValid).toBe(true);
      expect(validator.validate('1 hour', schema).isValid).toBe(false);
    });
  });

  describe('other primitive types', () => {
    it('should validate uuid format', () => {
      const schema = { type: 'uuid' };
      const validator = new InstanceValidator();

      expect(validator.validate('550e8400-e29b-41d4-a716-446655440000', schema).isValid).toBe(true);
      expect(validator.validate('not-a-uuid', schema).isValid).toBe(false);
    });

    it('should validate uri format', () => {
      const schema = { type: 'uri' };
      const validator = new InstanceValidator();

      expect(validator.validate('https://example.com', schema).isValid).toBe(true);
      expect(validator.validate('ftp://files.example.com/path', schema).isValid).toBe(true);
      expect(validator.validate('not a uri', schema).isValid).toBe(false);
    });

    it('should validate jsonpointer format', () => {
      const schema = { type: 'jsonpointer' };
      const validator = new InstanceValidator();

      expect(validator.validate('#/definitions/Foo', schema).isValid).toBe(true);
      expect(validator.validate('#/a/b/c', schema).isValid).toBe(true);
      expect(validator.validate('not/a/pointer', schema).isValid).toBe(false);
    });
  });

  describe('object type', () => {
    it('should validate object properties', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'int32' },
        },
      };
      const validator = new InstanceValidator();

      expect(validator.validate({ name: 'Alice', age: 30 }, schema).isValid).toBe(true);
      expect(validator.validate({ name: 'Alice' }, schema).isValid).toBe(true);
      expect(validator.validate({ name: 123 }, schema).isValid).toBe(false);
    });

    it('should validate required properties', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'int32' },
        },
        required: ['name'],
      };
      const validator = new InstanceValidator();

      expect(validator.validate({ name: 'Alice' }, schema).isValid).toBe(true);
      expect(validator.validate({ age: 30 }, schema).isValid).toBe(false);
    });

    it('should validate additionalProperties: false', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      };
      const validator = new InstanceValidator();

      expect(validator.validate({ name: 'Alice' }, schema).isValid).toBe(true);
      expect(validator.validate({ name: 'Alice', extra: 'data' }, schema).isValid).toBe(false);
    });
  });

  describe('array type', () => {
    it('should validate array items', () => {
      const schema = {
        type: 'array',
        items: { type: 'string' },
      };
      const validator = new InstanceValidator();

      expect(validator.validate(['a', 'b', 'c'], schema).isValid).toBe(true);
      expect(validator.validate(['a', 1, 'c'], schema).isValid).toBe(false);
    });
  });

  describe('set type', () => {
    it('should validate unique items', () => {
      const schema = {
        type: 'set',
        items: { type: 'string' },
      };
      const validator = new InstanceValidator();

      expect(validator.validate(['a', 'b', 'c'], schema).isValid).toBe(true);
      expect(validator.validate(['a', 'b', 'a'], schema).isValid).toBe(false);
    });
  });

  describe('map type', () => {
    it('should validate map values', () => {
      const schema = {
        type: 'map',
        values: { type: 'int32' },
      };
      const validator = new InstanceValidator();

      expect(validator.validate({ a: 1, b: 2 }, schema).isValid).toBe(true);
      expect(validator.validate({ a: 'one' }, schema).isValid).toBe(false);
    });
  });

  describe('tuple type', () => {
    it('should validate tuple structure', () => {
      const schema = {
        type: 'tuple',
        properties: {
          x: { type: 'int32' },
          y: { type: 'int32' },
        },
        tuple: ['x', 'y'],
      };
      const validator = new InstanceValidator();

      expect(validator.validate([10, 20], schema).isValid).toBe(true);
      expect(validator.validate([10], schema).isValid).toBe(false);
      expect(validator.validate([10, 'twenty'], schema).isValid).toBe(false);
    });
  });

  describe('choice type', () => {
    it('should validate tagged union', () => {
      const schema = {
        type: 'choice',
        choices: {
          circle: { type: 'object', properties: { radius: { type: 'double' } } },
          square: { type: 'object', properties: { side: { type: 'double' } } },
        },
      };
      const validator = new InstanceValidator();

      expect(validator.validate({ circle: { radius: 5.0 } }, schema).isValid).toBe(true);
      expect(validator.validate({ square: { side: 10.0 } }, schema).isValid).toBe(true);
      expect(validator.validate({ triangle: {} }, schema).isValid).toBe(false);
      expect(validator.validate({ circle: {}, square: {} }, schema).isValid).toBe(false);
    });
  });

  describe('enum validation', () => {
    it('should validate enum values', () => {
      const schema = {
        type: 'string',
        enum: ['red', 'green', 'blue'],
      };
      const validator = new InstanceValidator();

      expect(validator.validate('red', schema).isValid).toBe(true);
      expect(validator.validate('yellow', schema).isValid).toBe(false);
    });
  });

  describe('const validation', () => {
    it('should validate const value', () => {
      const schema = {
        type: 'string',
        const: 'fixed',
      };
      const validator = new InstanceValidator();

      expect(validator.validate('fixed', schema).isValid).toBe(true);
      expect(validator.validate('other', schema).isValid).toBe(false);
    });
  });

  describe('$ref resolution', () => {
    it('should resolve $ref', () => {
      const schema = {
        definitions: {
          Address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
            },
          },
        },
        type: 'object',
        properties: {
          home: { type: { $ref: '#/definitions/Address' } },
        },
      };
      const validator = new InstanceValidator();

      expect(validator.validate({ home: { street: '123 Main St' } }, schema).isValid).toBe(true);
      expect(validator.validate({ home: { street: 123 } }, schema).isValid).toBe(false);
    });
  });

  describe('$root handling', () => {
    it('should use $root as entry point', () => {
      const schema = {
        $root: '#/definitions/Person',
        definitions: {
          Person: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
      };
      const validator = new InstanceValidator();

      expect(validator.validate({ name: 'Alice' }, schema).isValid).toBe(true);
      expect(validator.validate({}, schema).isValid).toBe(false);
    });
  });

  describe('extended validation', () => {
    it('should validate minLength/maxLength with extended=true', () => {
      const schema = {
        type: 'string',
        minLength: 2,
        maxLength: 5,
      };
      const validator = new InstanceValidator({ extended: true });

      expect(validator.validate('abc', schema).isValid).toBe(true);
      expect(validator.validate('a', schema).isValid).toBe(false);
      expect(validator.validate('abcdef', schema).isValid).toBe(false);
    });

    it('should validate pattern with extended=true', () => {
      const schema = {
        type: 'string',
        pattern: '^[a-z]+$',
      };
      const validator = new InstanceValidator({ extended: true });

      expect(validator.validate('abc', schema).isValid).toBe(true);
      expect(validator.validate('ABC', schema).isValid).toBe(false);
      expect(validator.validate('123', schema).isValid).toBe(false);
    });

    it('should validate minimum/maximum with extended=true', () => {
      const schema = {
        type: 'number',
        minimum: 0,
        maximum: 100,
      };
      const validator = new InstanceValidator({ extended: true });

      expect(validator.validate(50, schema).isValid).toBe(true);
      expect(validator.validate(-1, schema).isValid).toBe(false);
      expect(validator.validate(101, schema).isValid).toBe(false);
    });

    it('should validate multipleOf with extended=true', () => {
      const schema = {
        type: 'number',
        multipleOf: 5,
      };
      const validator = new InstanceValidator({ extended: true });

      expect(validator.validate(10, schema).isValid).toBe(true);
      expect(validator.validate(15, schema).isValid).toBe(true);
      expect(validator.validate(12, schema).isValid).toBe(false);
    });

    it('should validate minItems/maxItems with extended=true', () => {
      const schema = {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 3,
      };
      const validator = new InstanceValidator({ extended: true });

      expect(validator.validate(['a', 'b'], schema).isValid).toBe(true);
      expect(validator.validate([], schema).isValid).toBe(false);
      expect(validator.validate(['a', 'b', 'c', 'd'], schema).isValid).toBe(false);
    });
  });

  describe('conditional composition', () => {
    it('should validate allOf with extended=true', () => {
      const schema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        allOf: [
          { type: 'object', properties: { age: { type: 'int32' } }, required: ['age'] },
        ],
      };
      const validator = new InstanceValidator({ extended: true });

      expect(validator.validate({ name: 'Alice', age: 30 }, schema).isValid).toBe(true);
      expect(validator.validate({ name: 'Alice' }, schema).isValid).toBe(false);
    });

    it('should validate anyOf with extended=true', () => {
      const schema = {
        anyOf: [
          { type: 'string' },
          { type: 'int32' },
        ],
      };
      const validator = new InstanceValidator({ extended: true });

      expect(validator.validate('hello', schema).isValid).toBe(true);
      expect(validator.validate(42, schema).isValid).toBe(true);
      expect(validator.validate(true, schema).isValid).toBe(false);
    });

    it('should validate oneOf with extended=true', () => {
      const schema = {
        oneOf: [
          { type: 'string', minLength: 5 },
          { type: 'string', maxLength: 3 },
        ],
      };
      const validator = new InstanceValidator({ extended: true });

      expect(validator.validate('hello', schema).isValid).toBe(true); // matches first
      expect(validator.validate('hi', schema).isValid).toBe(true); // matches second
      expect(validator.validate('test', schema).isValid).toBe(false); // matches neither
    });

    it('should validate not with extended=true', () => {
      const schema = {
        type: 'string',
        not: { enum: ['forbidden'] },
      };
      const validator = new InstanceValidator({ extended: true });

      expect(validator.validate('allowed', schema).isValid).toBe(true);
      expect(validator.validate('forbidden', schema).isValid).toBe(false);
    });
  });

  describe('union types', () => {
    it('should validate union types', () => {
      const schema = {
        type: ['string', 'int32'],
      };
      const validator = new InstanceValidator();

      expect(validator.validate('hello', schema).isValid).toBe(true);
      expect(validator.validate(42, schema).isValid).toBe(true);
      expect(validator.validate(true, schema).isValid).toBe(false);
    });
  });
});
