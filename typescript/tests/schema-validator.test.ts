import { describe, it, expect } from 'vitest';
import { SchemaValidator } from '../src/schema-validator';

describe('SchemaValidator', () => {
  describe('basic validation', () => {
    it('should validate a valid schema', () => {
      const schema = {
        $schema: 'https://json-structure.org/meta/core/v0/#',
        $id: 'https://example.com/person',
        name: 'Person',
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'int32' },
        },
        required: ['name'],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject non-object schema', () => {
      const validator = new SchemaValidator();
      const result = validator.validate('not an object');

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('must be an object');
    });

    it('should reject schema without type', () => {
      const schema = {
        $schema: 'https://json-structure.org/meta/core/v0/#',
        name: 'NoType',
        properties: {
          foo: { type: 'string' },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.message.includes('type'))).toBe(true);
    });

    it('should reject unknown type', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'unknowntype',
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain("Unknown type 'unknowntype'");
    });
  });

  describe('primitive types', () => {
    const primitiveTypes = [
      'string', 'boolean', 'null',
      'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
      'int64', 'uint64', 'int128', 'uint128',
      'float', 'float8', 'double', 'decimal',
      'number', 'integer',
      'date', 'datetime', 'time', 'duration',
      'uuid', 'uri', 'binary', 'jsonpointer',
    ];

    it.each(primitiveTypes)('should accept primitive type: %s', (type) => {
      const schema = { $id: 'urn:example:test-schema', name: 'TestType', type };
      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });
  });

  describe('compound types', () => {
    it('should validate object type with properties', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject object with empty properties', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        properties: {},
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('at least one entry');
    });

    it('should validate array type with items', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'array',
        items: { type: 'string' },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject array without items', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'array',
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('items');
    });

    it('should validate map type with values', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'map',
        values: { type: 'string' },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject map without values', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'map',
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('values');
    });

    it('should validate tuple type', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'tuple',
        properties: {
          x: { type: 'int32' },
          y: { type: 'int32' },
        },
        tuple: ['x', 'y'],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject tuple without tuple array', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'tuple',
        properties: {
          x: { type: 'int32' },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('tuple');
    });

    it('should validate choice type', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'choice',
        choices: {
          circle: { type: 'object', properties: { radius: { type: 'double' } } },
          square: { type: 'object', properties: { side: { type: 'double' } } },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });
  });

  describe('union types', () => {
    it('should validate union with primitive type strings', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: ['string', 'number', 'boolean'],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should validate union with $ref objects', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        definitions: {
          TextContent: {
            type: 'object',
            properties: { text: { type: 'string' } },
          },
          BinaryContent: {
            type: 'object',
            properties: { data: { type: 'binary' } },
          },
        },
        properties: {
          content: {
            type: [
              { $ref: '#/definitions/TextContent' },
              { $ref: '#/definitions/BinaryContent' },
            ],
          },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should validate union mixing strings and $ref objects', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        definitions: {
          CustomType: {
            type: 'object',
            properties: { value: { type: 'string' } },
          },
        },
        properties: {
          field: {
            type: [
              'string',
              'number',
              { $ref: '#/definitions/CustomType' },
            ],
          },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject empty union array', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: [],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('empty');
    });

    it('should reject union with invalid type string', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: ['string', 'invalidtype'],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('Unknown type');
    });

    it('should reject union with object missing $ref', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: [
          'string',
          { notRef: 'something' },
        ],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('must have $ref');
    });

    it('should reject union with invalid element type', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: ['string', 123],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('must be strings or $ref objects');
    });
  });

  describe('validation constraints', () => {
    it('should validate minLength/maxLength', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'string',
        minLength: 1,
        maxLength: 100,
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject negative minLength', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'string',
        minLength: -1,
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('non-negative');
    });

    it('should reject minLength > maxLength', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'string',
        minLength: 10,
        maxLength: 5,
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('minLength cannot exceed maxLength');
    });

    it('should validate minimum/maximum', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'number',
        minimum: 0,
        maximum: 100,
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject minimum > maximum', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'number',
        minimum: 100,
        maximum: 0,
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('minimum cannot exceed maximum');
    });

    it('should reject invalid pattern regex', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'string',
        pattern: '[invalid',
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('Invalid regular expression');
    });

    it('should reject multipleOf <= 0', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'number',
        multipleOf: 0,
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('greater than 0');
    });

    it('should validate minItems/maxItems', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject minItems > maxItems', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'array',
        items: { type: 'string' },
        minItems: 10,
        maxItems: 5,
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('minItems cannot exceed maxItems');
    });
  });

  describe('enum validation', () => {
    it('should validate valid enum', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'string',
        enum: ['red', 'green', 'blue'],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject empty enum', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'string',
        enum: [],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('at least one value');
    });

    it('should reject enum with duplicates', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'string',
        enum: ['a', 'b', 'a'],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('unique');
    });
  });

  describe('$ref validation', () => {
    it('should validate valid $ref', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
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

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject undefined $ref', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        properties: {
          home: { type: { $ref: '#/definitions/NotFound' } },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('not found');
    });

    it('should detect direct circular references', () => {
      // Direct circular ref with no other content is invalid
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        definitions: {
          recursive: { type: { $ref: '#/definitions/recursive' } },
        },
        type: 'object',
        properties: {
          value: { type: { $ref: '#/definitions/recursive' } },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      // Direct circular refs without base case are detected
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Circular'))).toBe(true);
    });
  });

  describe('required validation', () => {
    it('should validate required properties', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'int32' },
        },
        required: ['name'],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
    });

    it('should reject required property not in properties', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name', 'notexist'],
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('notexist');
    });

    it('should reject non-array required', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: 'name',
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('must be an array');
    });
  });

  describe('union types with $ref', () => {
    it('should accept union type with $ref and null', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        definitions: {
          coordinates: {
            type: 'object',
            properties: {
              lat: { type: 'double' },
              lon: { type: 'double' },
            },
            required: ['lat', 'lon'],
          },
        },
        properties: {
          location: {
            type: [
              { $ref: '#/definitions/coordinates' },
              'null',
            ],
          },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept union type with multiple $refs', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        definitions: {
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
            },
          },
          coordinates: {
            type: 'object',
            properties: {
              lat: { type: 'double' },
              lon: { type: 'double' },
            },
          },
        },
        properties: {
          location: {
            type: [
              { $ref: '#/definitions/address' },
              { $ref: '#/definitions/coordinates' },
            ],
          },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept union type with $ref, primitives, and null', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        definitions: {
          coordinates: {
            type: 'object',
            properties: {
              lat: { type: 'double' },
              lon: { type: 'double' },
            },
          },
        },
        properties: {
          value: {
            type: [
              { $ref: '#/definitions/coordinates' },
              'string',
              'int32',
              'null',
            ],
          },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject union type with $ref object missing $ref property', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        properties: {
          location: {
            type: [
              { notRef: '#/definitions/coordinates' },
              'null',
            ],
          },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('must have $ref');
    });
  });

  describe('warnOnUnusedExtensionKeywords option', () => {
    it('should emit warnings for extension keywords without $uses (default behavior)', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.code === 'SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED')).toBe(true);
    });

    it('should suppress warnings when warnOnUnusedExtensionKeywords is false', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        name: 'TestType',
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
        },
      };

      const validator = new SchemaValidator({ warnOnUnusedExtensionKeywords: false });
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.warnings.filter(w => w.code === 'SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED')).toHaveLength(0);
    });

    it('should not emit warnings when $uses includes JSONStructureValidation', () => {
      const schema = {
        $id: 'urn:example:test-schema',
        $uses: ['JSONStructureValidation'],
        name: 'TestType',
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.warnings.filter(w => w.code === 'SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED')).toHaveLength(0);
    });
  });

  describe('ucumUnit keyword', () => {
    const createUcumUnitSchema = (type: string, ucumUnit: unknown, extra: Record<string, unknown> = {}) => ({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $id: `urn:example:ucum-${type}`,
      name: `${type}WithUcumUnit`,
      $uses: ['JSONStructureUnits'],
      type,
      ucumUnit,
      ...extra,
    });

    it('should accept a numeric type with ucumUnit', () => {
      const validator = new SchemaValidator();
      const result = validator.validate(createUcumUnitSchema('number', 'm'));

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept unit and ucumUnit together on a numeric type', () => {
      const validator = new SchemaValidator();
      const result = validator.validate(createUcumUnitSchema('number', 'm', { unit: 'meter' }));

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it.each(['int32', 'float', 'double', 'decimal'])('should accept %s with ucumUnit', (type) => {
      const validator = new SchemaValidator();
      const result = validator.validate(createUcumUnitSchema(type, 'm'));

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('invalid ucumUnit schema checks', () => {
    const createUcumUnitSchema = (type: string, ucumUnit: unknown) => ({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $id: 'urn:example:invalid-ucum',
      name: 'InvalidUcumUnitSchema',
      $uses: ['JSONStructureUnits'],
      type,
      ucumUnit,
    });

    it('should reject ucumUnit on non-numeric types', () => {
      const validator = new SchemaValidator();
      const result = validator.validate(createUcumUnitSchema('string', 'm'));

      expect(result.isValid).toBe(false);
    });

    it('should reject numeric ucumUnit values', () => {
      const validator = new SchemaValidator();
      const result = validator.validate(createUcumUnitSchema('number', 42));

      expect(result.isValid).toBe(false);
    });

    it('should reject array ucumUnit values', () => {
      const validator = new SchemaValidator();
      const result = validator.validate(createUcumUnitSchema('number', ['m']));

      expect(result.isValid).toBe(false);
    });

    it('should reject object ucumUnit values', () => {
      const validator = new SchemaValidator();
      const result = validator.validate(createUcumUnitSchema('number', { code: 'm' }));

      expect(result.isValid).toBe(false);
    });
  });

  describe('Relations extension', () => {
    const createRelationsSchema = () => ({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $id: 'urn:example:relations-schema',
      name: 'Order',
      $uses: ['JSONStructureRelations'],
      type: 'object',
      properties: {
        id: { type: 'string' },
        tenantId: { type: 'string' },
        customerId: { type: 'string' },
        itemIds: { type: 'array', items: { type: 'string' } },
        qualifier: { type: 'string' },
      },
      definitions: {
        Customer: {
          name: 'Customer',
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
        Item: {
          name: 'Item',
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
        RelationQualifier: {
          name: 'RelationQualifier',
          type: 'string',
        },
      },
    });

    it('should accept identity arrays on object types', () => {
      const schema = createRelationsSchema();
      schema.identity = ['id', 'tenantId'];

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid relation declarations', () => {
      const schema = createRelationsSchema();
      schema.relations = {
        customer: {
          cardinality: 'single',
          targettype: { $ref: '#/definitions/Customer' },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept single-cardinality relations with targettype refs', () => {
      const schema = createRelationsSchema();
      schema.relations = {
        customer: {
          cardinality: 'single',
          targettype: { $ref: '#/definitions/Customer' },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept multiple-cardinality relations with scope', () => {
      const schema = createRelationsSchema();
      schema.relations = {
        items: {
          cardinality: 'multiple',
          targettype: { $ref: '#/definitions/Item' },
          scope: 'line-items',
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept relations with qualifiertype', () => {
      const schema = createRelationsSchema();
      schema.relations = {
        qualifiedCustomer: {
          cardinality: 'single',
          targettype: { $ref: '#/definitions/Customer' },
          qualifiertype: { $ref: '#/definitions/RelationQualifier' },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('invalid Relations schema checks', () => {
    const createRelationsSchema = () => ({
      $schema: 'https://json-structure.org/meta/extended/v0/#',
      $id: 'urn:example:invalid-relations-schema',
      name: 'InvalidRelationsSchema',
      $uses: ['JSONStructureRelations'],
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      definitions: {
        Customer: {
          name: 'Customer',
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      },
    });

    it('should reject identity on non-object types', () => {
      const validator = new SchemaValidator();
      const result = validator.validate({
        $schema: 'https://json-structure.org/meta/extended/v0/#',
        $id: 'urn:example:identity-non-object',
        name: 'IdentityOnString',
        $uses: ['JSONStructureRelations'],
        type: 'string',
        identity: ['id'],
      });

      expect(result.isValid).toBe(false);
    });

    it('should reject identity values that are not arrays', () => {
      const schema = createRelationsSchema();
      schema.identity = 'id';

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
    });

    it('should reject identity values that reference unknown properties', () => {
      const schema = createRelationsSchema();
      schema.identity = ['missing'];

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
    });

    it('should reject relations on non-object types', () => {
      const validator = new SchemaValidator();
      const result = validator.validate({
        $schema: 'https://json-structure.org/meta/extended/v0/#',
        $id: 'urn:example:relations-non-object',
        name: 'StringWithRelations',
        $uses: ['JSONStructureRelations'],
        type: 'string',
        relations: {},
      });

      expect(result.isValid).toBe(false);
    });

    it('should reject invalid relation cardinality values', () => {
      const schema = createRelationsSchema();
      schema.relations = {
        customer: {
          cardinality: 'many',
          targettype: { $ref: '#/definitions/Customer' },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
    });

    it('should reject relations missing targettype', () => {
      const schema = createRelationsSchema();
      schema.relations = {
        customer: {
          cardinality: 'single',
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
    });

    it('should reject relations missing cardinality', () => {
      const schema = createRelationsSchema();
      schema.relations = {
        customer: {
          targettype: { $ref: '#/definitions/Customer' },
        },
      };

      const validator = new SchemaValidator();
      const result = validator.validate(schema);

      expect(result.isValid).toBe(false);
    });
  });
});
