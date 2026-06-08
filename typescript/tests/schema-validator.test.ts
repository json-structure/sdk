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

  describe('adversarial and edge cases', () => {
    const validate = (schema: any) => new SchemaValidator().validate(schema);

    describe('$extends validation', () => {
      it('should accept $extends referencing an existing definition', () => {
        const schema = {
          $id: 'urn:example:extends-valid',
          name: 'Employee',
          type: 'object',
          definitions: {
            Person: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
          $extends: '#/definitions/Person',
          properties: {
            department: { type: 'string' },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject $extends referencing a non-existent definition', () => {
        const schema = {
          $id: 'urn:example:extends-missing',
          name: 'Employee',
          type: 'object',
          $extends: '#/definitions/MissingBase',
          properties: {
            department: { type: 'string' },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('$extends reference') && e.message.includes('not found'))).toBe(true);
      });

      it.skip('should reject $extends referencing a non-object definition', () => {
        // TODO: validator does not yet enforce object-only $extends targets.
        const schema = {
          $id: 'urn:example:extends-primitive',
          name: 'Employee',
          type: 'object',
          definitions: {
            StringAlias: {
              type: 'string',
            },
          },
          $extends: '#/definitions/StringAlias',
          properties: {
            department: { type: 'string' },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
      });

      it('should reject directly circular $extends chains', () => {
        const schema = {
          $id: 'urn:example:extends-direct-cycle',
          name: 'Root',
          type: 'object',
          definitions: {
            A: {
              type: 'object',
              $extends: '#/definitions/B',
              properties: {
                a: { type: 'string' },
              },
            },
            B: {
              type: 'object',
              $extends: '#/definitions/A',
              properties: {
                b: { type: 'string' },
              },
            },
          },
          properties: {
            value: { type: { $ref: '#/definitions/A' } },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('Circular $extends reference'))).toBe(true);
      });

      it('should reject deeply circular $extends chains', () => {
        const schema = {
          $id: 'urn:example:extends-deep-cycle',
          name: 'Root',
          type: 'object',
          definitions: {
            A: {
              type: 'object',
              $extends: '#/definitions/B',
              properties: {
                a: { type: 'string' },
              },
            },
            B: {
              type: 'object',
              $extends: '#/definitions/C',
              properties: {
                b: { type: 'string' },
              },
            },
            C: {
              type: 'object',
              $extends: '#/definitions/A',
              properties: {
                c: { type: 'string' },
              },
            },
          },
          properties: {
            value: { type: { $ref: '#/definitions/A' } },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('Circular $extends reference'))).toBe(true);
      });

      it('should reject non-string $extends values', () => {
        const schema = {
          $id: 'urn:example:extends-invalid-type',
          name: 'Employee',
          type: 'object',
          $extends: 42,
          properties: {
            department: { type: 'string' },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('$extends must be a string or array of strings'))).toBe(true);
      });

      it('should reject $extends arrays containing non-string entries', () => {
        const schema = {
          $id: 'urn:example:extends-invalid-array-item',
          name: 'Employee',
          type: 'object',
          $extends: ['#/definitions/Person', 42],
          definitions: {
            Person: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
          properties: {
            department: { type: 'string' },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('$extends array items must be strings'))).toBe(true);
      });
    });

    describe('nested invalid schemas', () => {
      it('should reject an invalid type nested inside properties', () => {
        const schema = {
          $id: 'urn:example:nested-invalid-properties',
          name: 'NestedInvalidProperties',
          type: 'object',
          properties: {
            bad: { type: true },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.path === '#/properties/bad/type' && e.message.includes('type must be a string, array, or object with $ref'))).toBe(true);
      });

      it('should reject an invalid type nested inside items', () => {
        const schema = {
          $id: 'urn:example:nested-invalid-items',
          name: 'NestedInvalidItems',
          type: 'array',
          items: { type: true },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.path === '#/items/type' && e.message.includes('type must be a string, array, or object with $ref'))).toBe(true);
      });

      it('should reject an invalid type nested inside values', () => {
        const schema = {
          $id: 'urn:example:nested-invalid-values',
          name: 'NestedInvalidValues',
          type: 'map',
          values: { type: true },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.path === '#/values/type' && e.message.includes('type must be a string, array, or object with $ref'))).toBe(true);
      });

      it('should reject an invalid type nested inside definitions', () => {
        const schema = {
          $id: 'urn:example:nested-invalid-definitions',
          name: 'NestedInvalidDefinitions',
          type: 'object',
          definitions: {
            Broken: { type: true },
          },
          properties: {
            value: { type: 'string' },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.path === '#/definitions/Broken/type' && e.message.includes('type must be a string, array, or object with $ref'))).toBe(true);
      });

      it.skip('should reject tuple entries that reference a type that does not exist', () => {
        // TODO: validator does not yet model tuple entries as type references.
        const schema = {
          $id: 'urn:example:tuple-missing-ref',
          name: 'TupleMissingRef',
          type: 'tuple',
          tuple: [{ $ref: '#/definitions/MissingType' }],
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
      });

      it('should report multiple independent nested errors', () => {
        const schema = {
          $id: 'urn:example:multiple-nested-errors',
          name: 'MultipleNestedErrors',
          type: 'object',
          definitions: {
            BrokenDefinition: { type: true },
          },
          properties: {
            childList: {
              type: 'array',
              items: { type: false },
            },
            metadata: {
              type: 'map',
              values: { type: 123 },
            },
            alias: {
              type: { $ref: '#/definitions/DoesNotExist' },
            },
          },
        };

        const result = validate(schema);
        const messages = result.errors.map(error => error.message).join('\n');

        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(4);
        expect(messages).toContain('type must be a string, array, or object with $ref');
        expect(messages).toContain("$ref '#/definitions/DoesNotExist' not found");
      });
    });

    describe('extension keywords nested under root $uses', () => {
      it.skip('should accept nested ucumUnit when the root enables JSONStructureUnits', () => {
        // TODO: validator does not yet inherit root-level $uses into nested schemas.
        const schema = {
          $id: 'urn:example:nested-ucum-with-root-uses',
          name: 'MeasurementEnvelope',
          $uses: ['JSONStructureUnits'],
          type: 'object',
          properties: {
            measurement: {
              type: 'object',
              properties: {
                value: {
                  type: 'number',
                  ucumUnit: 'm',
                },
              },
            },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
      });

      it.skip('should accept nested relations when the root enables JSONStructureRelations', () => {
        // TODO: validator does not yet inherit root-level $uses into nested schemas.
        const schema = {
          $id: 'urn:example:nested-relations-with-root-uses',
          name: 'OrderEnvelope',
          $uses: ['JSONStructureRelations'],
          type: 'object',
          definitions: {
            Customer: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
          properties: {
            order: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
              relations: {
                customer: {
                  cardinality: 'single',
                  targettype: { $ref: '#/definitions/Customer' },
                },
              },
            },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
      });

      it('should reject nested extension keywords when $uses is not enabled', () => {
        const schema = {
          $id: 'urn:example:nested-extension-without-uses',
          name: 'MeasurementEnvelope',
          type: 'object',
          properties: {
            measurement: {
              type: 'number',
              ucumUnit: 'm',
            },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.path === '#/properties/measurement/ucumUnit' && e.message.includes("requires 'JSONStructureUnits' in $uses"))).toBe(true);
      });
    });

    describe('adversarial $ref in complex positions', () => {
      it('should reject union members whose $ref points to a missing definition', () => {
        const schema = {
          $id: 'urn:example:union-ref-missing',
          name: 'UnionRefMissing',
          type: 'object',
          properties: {
            value: {
              type: ['string', { $ref: '#/definitions/MissingType' }],
            },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.path === '#/properties/value/type[1]' && e.message.includes('not found'))).toBe(true);
      });

      it('should reject relation targettype refs that point to missing definitions', () => {
        const schema = {
          $id: 'urn:example:relation-targettype-missing',
          name: 'Order',
          $uses: ['JSONStructureRelations'],
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          relations: {
            customer: {
              cardinality: 'single',
              targettype: { $ref: '#/definitions/Customer' },
            },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.path === '#/relations/customer/targettype/$ref' && e.message.includes('not found'))).toBe(true);
      });

      it('should reject relation qualifiertype refs that point to missing definitions', () => {
        const schema = {
          $id: 'urn:example:relation-qualifier-missing',
          name: 'Order',
          $uses: ['JSONStructureRelations'],
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          definitions: {
            Customer: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
          relations: {
            customer: {
              cardinality: 'single',
              targettype: { $ref: '#/definitions/Customer' },
              qualifiertype: { $ref: '#/definitions/MissingQualifier' },
            },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.path === '#/relations/customer/qualifiertype/$ref' && e.message.includes('not found'))).toBe(true);
      });

      it('should accept self-referencing property refs when the target definition exists', () => {
        const schema = {
          $id: 'urn:example:self-referencing-root',
          name: 'Tree',
          type: 'object',
          definitions: {
            Root: {
              type: 'object',
              properties: {
                child: { type: { $ref: '#/definitions/Root' } },
              },
            },
          },
          properties: {
            root: { type: { $ref: '#/definitions/Root' } },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('$id and name validation edge cases', () => {
      it('should reject missing $id', () => {
        const schema = {
          name: 'MissingId',
          type: 'string',
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes("Missing required '$id' keyword at root"))).toBe(true);
      });

      it.skip('should reject empty $id', () => {
        // TODO: validator does not yet enforce non-empty $id values.
        const schema = {
          $id: '',
          name: 'EmptyId',
          type: 'string',
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
      });

      it.skip('should reject relative $id values without a scheme', () => {
        // TODO: validator does not yet validate $id URI syntax.
        const schema = {
          $id: 'relative/path',
          name: 'RelativeId',
          type: 'string',
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
      });

      it('should accept a valid URN $id', () => {
        const schema = {
          $id: 'urn:example:test',
          name: 'ValidUrn',
          type: 'string',
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject missing name', () => {
        const schema = {
          $id: 'urn:example:missing-name',
          type: 'string',
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes("must have a 'name' property"))).toBe(true);
      });

      it.skip('should reject names starting with a digit', () => {
        // TODO: validator does not yet enforce identifier syntax for name.
        const schema = {
          $id: 'urn:example:digit-name',
          name: '1InvalidName',
          type: 'string',
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
      });

      it.skip('should reject names containing spaces', () => {
        // TODO: validator does not yet enforce identifier syntax for name.
        const schema = {
          $id: 'urn:example:space-name',
          name: 'Invalid Name',
          type: 'string',
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
      });

      it('should accept names containing underscores and dollar signs', () => {
        const schema = {
          $id: 'urn:example:underscore-dollar-name',
          name: 'Valid_Name$Type',
          type: 'string',
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('enum edge cases', () => {
      it('should accept enum values containing null for null types', () => {
        const schema = {
          $id: 'urn:example:enum-null',
          name: 'NullableOnly',
          type: 'null',
          enum: [null],
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it.skip('should reject mixed enum types when the schema type is string', () => {
        // TODO: validator does not yet enforce enum element types against the declared type.
        const schema = {
          $id: 'urn:example:enum-mixed-string',
          name: 'MixedStringEnum',
          type: 'string',
          enum: ['a', 1, true],
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
      });

      it('should accept boolean enum values for boolean types', () => {
        const schema = {
          $id: 'urn:example:enum-boolean',
          name: 'BooleanEnum',
          type: 'boolean',
          enum: [true, false],
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept single-element enums', () => {
        const schema = {
          $id: 'urn:example:enum-single',
          name: 'SingleEnum',
          type: 'string',
          enum: ['only'],
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject duplicate enum values', () => {
        const schema = {
          $id: 'urn:example:enum-duplicate',
          name: 'DuplicateEnum',
          type: 'string',
          enum: ['a', 'a'],
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('enum values must be unique'))).toBe(true);
      });
    });

    describe('choice type edge cases', () => {
      it('should reject empty choices arrays', () => {
        const schema = {
          $id: 'urn:example:choice-empty-array',
          name: 'EmptyChoiceArray',
          type: 'choice',
          choices: [],
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('choices must be an object'))).toBe(true);
      });

      it('should reject choice entries that are not objects or refs', () => {
        const schema = {
          $id: 'urn:example:choice-invalid-entry',
          name: 'InvalidChoiceEntry',
          type: 'choice',
          choices: {
            text: 'string',
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.path === '#/choices/text' && e.message.includes('Choice schema must be an object'))).toBe(true);
      });

      it('should accept choice types with multiple options', () => {
        const schema = {
          $id: 'urn:example:choice-multiple-options',
          name: 'ShapeChoice',
          type: 'choice',
          choices: {
            circle: {
              type: 'object',
              properties: {
                radius: { type: 'double' },
              },
            },
            square: {
              type: 'object',
              properties: {
                side: { type: 'double' },
              },
            },
            label: {
              type: 'string',
            },
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('unknown and extra keywords', () => {
      it('should ignore vendor extension keywords', () => {
        const schema = {
          $id: 'urn:example:unknown-keyword',
          name: 'UnknownKeyword',
          type: 'string',
          'x-vendor-extension': true,
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept deprecated as an annotation', () => {
        const schema = {
          $id: 'urn:example:deprecated-annotation',
          name: 'DeprecatedAnnotation',
          type: 'string',
          deprecated: true,
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should remain valid when multiple unknown keys are present', () => {
        const schema = {
          $id: 'urn:example:multiple-unknown-keys',
          name: 'MultipleUnknownKeys',
          type: 'object',
          properties: {
            value: {
              type: 'string',
              'x-extra-field': 'ignored',
            },
          },
          deprecated: false,
          'x-another-key': {
            nested: true,
          },
        };

        const result = validate(schema);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });
  });
});
