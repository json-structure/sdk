/**
 * JSON Structure Schema Validator
 * 
 * Validates JSON Structure schema documents for correctness against the
 * JSON Structure Core specification.
 */

import {
  ValidationResult,
  ValidationError,
  SchemaValidatorOptions,
  JsonValue,
  JsonObject,
  JsonLocation,
  UNKNOWN_LOCATION,
  PRIMITIVE_TYPES,
  COMPOUND_TYPES,
} from './types';
import { JsonSourceLocator } from './json-source-locator';
import * as ErrorCodes from './error-codes';

const ALL_TYPES = [...PRIMITIVE_TYPES, ...COMPOUND_TYPES] as const;

/**
 * Validates JSON Structure schema documents.
 */
export class SchemaValidator {
  private errors: ValidationError[] = [];
  private schema: JsonObject | null = null;
  private seenRefs: Set<string> = new Set();
  private sourceLocator: JsonSourceLocator | null = null;

  constructor(_options: SchemaValidatorOptions = {}) {
    // Options reserved for future use
  }

  /**
   * Validates a JSON Structure schema document.
   * @param schema The schema to validate.
   * @param schemaJson Optional raw JSON string for source location tracking.
   * @returns Validation result with any errors.
   */
  validate(schema: JsonValue, schemaJson?: string): ValidationResult {
    this.errors = [];
    this.seenRefs = new Set();
    
    // Set up source locator if JSON string provided
    if (schemaJson) {
      this.sourceLocator = new JsonSourceLocator(schemaJson);
    } else {
      this.sourceLocator = null;
    }

    if (!this.isObject(schema)) {
      this.addError('#', 'Schema must be an object', ErrorCodes.SCHEMA_INVALID_TYPE);
      return this.result();
    }

    this.schema = schema;
    this.validateSchemaDocument(schema, '#');

    return this.result();
  }

  private validateSchemaDocument(schema: JsonObject, path: string): void {
    // Validate definitions if present
    if ('definitions' in schema) {
      this.validateDefinitions(schema.definitions, `${path}/definitions`);
    }
    if ('$defs' in schema) {
      this.validateDefinitions(schema.$defs, `${path}/$defs`);
    }

    // If there's a $root, validate that the referenced type exists
    if ('$root' in schema) {
      const root = schema.$root;
      if (typeof root !== 'string') {
        this.addError(`${path}/$root`, '$root must be a string', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (root.startsWith('#/')) {
        const resolved = this.resolveRef(root);
        if (resolved === null) {
          this.addError(`${path}/$root`, `$root reference '${root}' not found`, ErrorCodes.SCHEMA_REF_NOT_FOUND);
        }
      }
      // If $root is present, no need for root-level type
      return;
    }

    // Validate the root type if present
    if ('type' in schema) {
      this.validateTypeDefinition(schema, path);
    } else {
      // No type at root level and no $root - error unless it's just definitions with no properties
      const hasOnlyMeta = Object.keys(schema).every(k => 
        k.startsWith('$') || k === 'definitions' || k === 'name' || k === 'description'
      );
      // Must have type OR $root, OR just definitions
      // If it has only meta+definitions, it needs to have definitions content
      if (!hasOnlyMeta || !('definitions' in schema || '$defs' in schema)) {
        this.addError(path, "Schema must have a 'type' property or '$root' reference", ErrorCodes.SCHEMA_ROOT_MISSING_TYPE);
      }
    }
    
    // Validate conditional keywords at root level
    this.validateConditionalKeywords(schema, path);
  }

  private validateDefinitions(defs: JsonValue, path: string): void {
    if (!this.isObject(defs)) {
      this.addError(path, 'definitions must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      return;
    }

    for (const [name, def] of Object.entries(defs)) {
      if (!this.isObject(def)) {
        this.addError(`${path}/${name}`, 'Definition must be an object', ErrorCodes.SCHEMA_INVALID_TYPE);
        continue;
      }
      this.validateTypeDefinition(def, `${path}/${name}`);
    }
  }

  private validateTypeDefinition(schema: JsonObject, path: string): void {
    const type = schema.type;

    // Handle $ref
    if ('$ref' in schema) {
      this.validateRef(schema.$ref, path);
      return;
    }

    // Type is required unless it's a conditional-only schema or has $ref
    if (type === undefined) {
      const conditionalKeywords = ['allOf', 'anyOf', 'oneOf', 'not', 'if'];
      const hasConditional = conditionalKeywords.some(k => k in schema);
      if (!hasConditional && !('$root' in schema)) {
        this.addError(path, "Schema must have a 'type' property", ErrorCodes.SCHEMA_MISSING_TYPE);
        return;
      }
      return;
    }

    // Type can be a string, array (union), or object with $ref
    if (typeof type === 'string') {
      this.validateSingleType(type, schema, path);
    } else if (Array.isArray(type)) {
      this.validateUnionType(type, schema, path);
    } else if (this.isObject(type)) {
      if ('$ref' in type) {
        this.validateRef(type.$ref, `${path}/type`);
      } else {
        this.addError(`${path}/type`, 'type object must have $ref', ErrorCodes.SCHEMA_TYPE_OBJECT_MISSING_REF);
      }
    } else {
      this.addError(`${path}/type`, 'type must be a string, array, or object with $ref', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
    }
  }

  private validateSingleType(type: string, schema: JsonObject, path: string): void {
    if (!ALL_TYPES.includes(type as any)) {
      this.addError(`${path}/type`, `Unknown type '${type}'`, ErrorCodes.SCHEMA_TYPE_INVALID);
      return;
    }

    // Validate type-specific constraints
    switch (type) {
      case 'object':
        this.validateObjectType(schema, path);
        break;
      case 'array':
      case 'set':
        this.validateArrayType(schema, path);
        break;
      case 'map':
        this.validateMapType(schema, path);
        break;
      case 'tuple':
        this.validateTupleType(schema, path);
        break;
      case 'choice':
        this.validateChoiceType(schema, path);
        break;
      default:
        // Primitive types
        this.validatePrimitiveConstraints(type, schema, path);
        break;
    }
  }

  private validateUnionType(types: JsonValue[], _schema: JsonObject, path: string): void {
    if (types.length === 0) {
      this.addError(`${path}/type`, 'Union type array cannot be empty', ErrorCodes.SCHEMA_TYPE_ARRAY_EMPTY);
      return;
    }

    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      if (typeof t === 'string') {
        // String type name
        if (!ALL_TYPES.includes(t as any)) {
          this.addError(`${path}/type[${i}]`, `Unknown type '${t}'`, ErrorCodes.SCHEMA_TYPE_INVALID);
        }
      } else if (this.isObject(t)) {
        // Type reference object with $ref
        if ('$ref' in t) {
          this.validateRef(t.$ref, `${path}/type[${i}]`);
        } else {
          this.addError(`${path}/type[${i}]`, 'Union type object must have $ref', ErrorCodes.SCHEMA_TYPE_OBJECT_MISSING_REF);
        }
      } else {
        this.addError(`${path}/type[${i}]`, 'Union type elements must be strings or $ref objects', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      }
    }
  }

  private validateObjectType(schema: JsonObject, path: string): void {
    // properties validation
    if ('properties' in schema) {
      const props = schema.properties;
      if (!this.isObject(props)) {
        this.addError(`${path}/properties`, 'properties must be an object', ErrorCodes.SCHEMA_PROPERTIES_NOT_OBJECT);
      } else if (Object.keys(props).length === 0 && !('$extends' in schema)) {
        this.addError(`${path}/properties`, 'properties must have at least one entry', ErrorCodes.SCHEMA_KEYWORD_EMPTY);
      } else {
        for (const [propName, propSchema] of Object.entries(props)) {
          if (!this.isObject(propSchema)) {
            this.addError(`${path}/properties/${propName}`, 'Property schema must be an object', ErrorCodes.SCHEMA_INVALID_TYPE);
          } else {
            this.validateTypeDefinition(propSchema, `${path}/properties/${propName}`);
          }
        }
      }
    }

    // required validation
    if ('required' in schema) {
      const required = schema.required;
      if (!Array.isArray(required)) {
        this.addError(`${path}/required`, 'required must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        const props = this.isObject(schema.properties) ? schema.properties : {};
        for (let i = 0; i < required.length; i++) {
          const r = required[i];
          if (typeof r !== 'string') {
            this.addError(`${path}/required[${i}]`, 'required elements must be strings', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
          } else if (!(r in props) && !('$extends' in schema)) {
            this.addError(`${path}/required[${i}]`, `Required property '${r}' not found in properties`, ErrorCodes.SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED);
          }
        }
      }
    }
  }

  private validateArrayType(schema: JsonObject, path: string): void {
    if (!('items' in schema)) {
      this.addError(path, "Array type must have 'items' property", ErrorCodes.SCHEMA_ARRAY_MISSING_ITEMS);
      return;
    }

    const items = schema.items;
    if (!this.isObject(items)) {
      this.addError(`${path}/items`, 'items must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
    } else {
      this.validateTypeDefinition(items, `${path}/items`);
    }

    // Validate array constraints
    this.validateArrayConstraints(schema, path);
  }

  private validateMapType(schema: JsonObject, path: string): void {
    if (!('values' in schema)) {
      this.addError(path, "Map type must have 'values' property", ErrorCodes.SCHEMA_MAP_MISSING_VALUES);
      return;
    }

    const values = schema.values;
    if (!this.isObject(values)) {
      this.addError(`${path}/values`, 'values must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
    } else {
      this.validateTypeDefinition(values, `${path}/values`);
    }
  }

  private validateTupleType(schema: JsonObject, path: string): void {
    if (!('tuple' in schema)) {
      this.addError(path, "Tuple type must have 'tuple' property defining element order", ErrorCodes.SCHEMA_TUPLE_MISSING_ORDER);
      return;
    }

    const tuple = schema.tuple;
    if (!Array.isArray(tuple)) {
      this.addError(`${path}/tuple`, 'tuple must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      return;
    }

    const props = this.isObject(schema.properties) ? schema.properties : {};
    for (let i = 0; i < tuple.length; i++) {
      const name = tuple[i];
      if (typeof name !== 'string') {
        this.addError(`${path}/tuple[${i}]`, 'tuple elements must be strings', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (!(name in props)) {
        this.addError(`${path}/tuple[${i}]`, `Tuple element '${name}' not found in properties`, ErrorCodes.SCHEMA_TUPLE_PROPERTY_NOT_DEFINED);
      }
    }
  }

  private validateChoiceType(schema: JsonObject, path: string): void {
    if (!('choices' in schema)) {
      this.addError(path, "Choice type must have 'choices' property", ErrorCodes.SCHEMA_CHOICE_MISSING_CHOICES);
      return;
    }

    const choices = schema.choices;
    if (!this.isObject(choices)) {
      this.addError(`${path}/choices`, 'choices must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
    } else {
      for (const [choiceName, choiceSchema] of Object.entries(choices)) {
        if (!this.isObject(choiceSchema)) {
          this.addError(`${path}/choices/${choiceName}`, 'Choice schema must be an object', ErrorCodes.SCHEMA_INVALID_TYPE);
        } else {
          this.validateTypeDefinition(choiceSchema, `${path}/choices/${choiceName}`);
        }
      }
    }
  }

  private validatePrimitiveConstraints(type: string, schema: JsonObject, path: string): void {
    // Validate enum
    if ('enum' in schema) {
      const enumVal = schema.enum;
      if (!Array.isArray(enumVal)) {
        this.addError(`${path}/enum`, 'enum must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (enumVal.length === 0) {
        this.addError(`${path}/enum`, 'enum must have at least one value', ErrorCodes.SCHEMA_KEYWORD_EMPTY);
      } else {
        // Check for duplicates
        const seen = new Set();
        for (let i = 0; i < enumVal.length; i++) {
          const serialized = JSON.stringify(enumVal[i]);
          if (seen.has(serialized)) {
            this.addError(`${path}/enum`, 'enum values must be unique', ErrorCodes.SCHEMA_ENUM_DUPLICATE_VALUE);
            break;
          }
          seen.add(serialized);
        }
      }
    }

    // Validate constraint type matching (e.g., minLength on string, minimum on numeric)
    this.validateConstraintTypeMatch(type, schema, path);

    // Validate string constraints
    if (type === 'string') {
      this.validateStringConstraints(schema, path);
    }

    // Validate numeric constraints
    const numericTypes = [
      'number', 'integer', 'float', 'double', 'decimal', 'float8',
      'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
      'int64', 'uint64', 'int128', 'uint128',
    ];
    if (numericTypes.includes(type)) {
      this.validateNumericConstraints(schema, path);
    }
  }

  private validateStringConstraints(schema: JsonObject, path: string): void {
    if ('minLength' in schema) {
      const minLength = schema.minLength;
      if (typeof minLength !== 'number' || !Number.isInteger(minLength)) {
        this.addError(`${path}/minLength`, 'minLength must be an integer', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (minLength < 0) {
        this.addError(`${path}/minLength`, 'minLength must be non-negative', ErrorCodes.SCHEMA_CONSTRAINT_VALUE_INVALID);
      }
    }

    if ('maxLength' in schema) {
      const maxLength = schema.maxLength;
      if (typeof maxLength !== 'number' || !Number.isInteger(maxLength)) {
        this.addError(`${path}/maxLength`, 'maxLength must be an integer', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (maxLength < 0) {
        this.addError(`${path}/maxLength`, 'maxLength must be non-negative', ErrorCodes.SCHEMA_CONSTRAINT_VALUE_INVALID);
      }
    }

    // Check minLength <= maxLength
    if ('minLength' in schema && 'maxLength' in schema) {
      const min = schema.minLength as number;
      const max = schema.maxLength as number;
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        this.addError(path, 'minLength cannot exceed maxLength', ErrorCodes.SCHEMA_CONSTRAINT_RANGE_INVALID);
      }
    }

    if ('pattern' in schema) {
      const pattern = schema.pattern;
      if (typeof pattern !== 'string') {
        this.addError(`${path}/pattern`, 'pattern must be a string', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        try {
          new RegExp(pattern);
        } catch {
          this.addError(`${path}/pattern`, `Invalid regular expression: ${pattern}`, ErrorCodes.SCHEMA_PATTERN_INVALID);
        }
      }
    }
  }

  private validateNumericConstraints(schema: JsonObject, path: string): void {
    if ('minimum' in schema) {
      if (typeof schema.minimum !== 'number') {
        this.addError(`${path}/minimum`, 'minimum must be a number', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      }
    }

    if ('maximum' in schema) {
      if (typeof schema.maximum !== 'number') {
        this.addError(`${path}/maximum`, 'maximum must be a number', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      }
    }

    // Check minimum <= maximum
    if ('minimum' in schema && 'maximum' in schema) {
      const min = schema.minimum as number;
      const max = schema.maximum as number;
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        this.addError(path, 'minimum cannot exceed maximum', ErrorCodes.SCHEMA_CONSTRAINT_RANGE_INVALID);
      }
    }

    if ('multipleOf' in schema) {
      const multipleOf = schema.multipleOf;
      if (typeof multipleOf !== 'number') {
        this.addError(`${path}/multipleOf`, 'multipleOf must be a number');
      } else if (multipleOf <= 0) {
        this.addError(`${path}/multipleOf`, 'multipleOf must be greater than 0', ErrorCodes.SCHEMA_CONSTRAINT_VALUE_INVALID);
      }
    }
  }

  private validateArrayConstraints(schema: JsonObject, path: string): void {
    if ('minItems' in schema) {
      const minItems = schema.minItems;
      if (typeof minItems !== 'number' || !Number.isInteger(minItems)) {
        this.addError(`${path}/minItems`, 'minItems must be an integer', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (minItems < 0) {
        this.addError(`${path}/minItems`, 'minItems must be non-negative', ErrorCodes.SCHEMA_CONSTRAINT_VALUE_INVALID);
      }
    }

    if ('maxItems' in schema) {
      const maxItems = schema.maxItems;
      if (typeof maxItems !== 'number' || !Number.isInteger(maxItems)) {
        this.addError(`${path}/maxItems`, 'maxItems must be an integer', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (maxItems < 0) {
        this.addError(`${path}/maxItems`, 'maxItems must be non-negative', ErrorCodes.SCHEMA_CONSTRAINT_VALUE_INVALID);
      }
    }

    // Check minItems <= maxItems
    if ('minItems' in schema && 'maxItems' in schema) {
      const min = schema.minItems as number;
      const max = schema.maxItems as number;
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        this.addError(path, 'minItems cannot exceed maxItems', ErrorCodes.SCHEMA_CONSTRAINT_RANGE_INVALID);
      }
    }
  }

  private validateConditionalKeywords(schema: JsonObject, path: string): void {
    // Validate allOf
    if ('allOf' in schema) {
      if (!Array.isArray(schema.allOf)) {
        this.addError(`${path}/allOf`, 'allOf must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        for (let i = 0; i < schema.allOf.length; i++) {
          const item = schema.allOf[i];
          if (this.isObject(item)) {
            this.validateTypeDefinition(item, `${path}/allOf[${i}]`);
          }
        }
      }
    }

    // Validate anyOf
    if ('anyOf' in schema) {
      if (!Array.isArray(schema.anyOf)) {
        this.addError(`${path}/anyOf`, 'anyOf must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        for (let i = 0; i < schema.anyOf.length; i++) {
          const item = schema.anyOf[i];
          if (this.isObject(item)) {
            this.validateTypeDefinition(item, `${path}/anyOf[${i}]`);
          }
        }
      }
    }

    // Validate oneOf
    if ('oneOf' in schema) {
      if (!Array.isArray(schema.oneOf)) {
        this.addError(`${path}/oneOf`, 'oneOf must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        for (let i = 0; i < schema.oneOf.length; i++) {
          const item = schema.oneOf[i];
          if (this.isObject(item)) {
            this.validateTypeDefinition(item, `${path}/oneOf[${i}]`);
          }
        }
      }
    }

    // Validate not
    if ('not' in schema) {
      if (!this.isObject(schema.not)) {
        this.addError(`${path}/not`, 'not must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        this.validateTypeDefinition(schema.not, `${path}/not`);
      }
    }

    // Validate if/then/else
    if ('if' in schema) {
      if (!this.isObject(schema.if)) {
        this.addError(`${path}/if`, 'if must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        this.validateTypeDefinition(schema.if, `${path}/if`);
      }
    }
    if ('then' in schema) {
      if (!this.isObject(schema.then)) {
        this.addError(`${path}/then`, 'then must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        this.validateTypeDefinition(schema.then, `${path}/then`);
      }
    }
    if ('else' in schema) {
      if (!this.isObject(schema.else)) {
        this.addError(`${path}/else`, 'else must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        this.validateTypeDefinition(schema.else, `${path}/else`);
      }
    }
  }

  private validateConstraintTypeMatch(type: string, schema: JsonObject, path: string): void {
    const stringOnlyConstraints = ['minLength', 'maxLength', 'pattern'];
    const numericOnlyConstraints = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];

    const numericTypes = [
      'number', 'integer', 'float', 'double', 'decimal', 'float8',
      'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
      'int64', 'uint64', 'int128', 'uint128',
    ];

    // Check string constraints on non-string types
    for (const constraint of stringOnlyConstraints) {
      if (constraint in schema && type !== 'string') {
        this.addError(`${path}/${constraint}`, `${constraint} constraint is only valid for string type, not ${type}`, ErrorCodes.SCHEMA_CONSTRAINT_TYPE_MISMATCH);
      }
    }

    // Check numeric constraints on non-numeric types
    for (const constraint of numericOnlyConstraints) {
      if (constraint in schema && !numericTypes.includes(type)) {
        this.addError(`${path}/${constraint}`, `${constraint} constraint is only valid for numeric types, not ${type}`, ErrorCodes.SCHEMA_CONSTRAINT_TYPE_MISMATCH);
      }
    }
  }

  private validateRef(ref: JsonValue, path: string): void {
    if (typeof ref !== 'string') {
      this.addError(path, '$ref must be a string', ErrorCodes.SCHEMA_REF_INVALID);
      return;
    }

    if (ref.startsWith('#/')) {
      // Check for circular reference
      if (this.seenRefs.has(ref)) {
        this.addError(path, `Circular reference detected: ${ref}`, ErrorCodes.SCHEMA_REF_CIRCULAR);
        return;
      }

      this.seenRefs.add(ref);
      const resolved = this.resolveRef(ref);
      if (resolved === null) {
        this.addError(path, `$ref '${ref}' not found`, ErrorCodes.SCHEMA_REF_NOT_FOUND);
      } else {
        // Validate the resolved schema to check for further circular refs
        this.validateTypeDefinition(resolved, path);
      }
      this.seenRefs.delete(ref);
    }
  }

  private resolveRef(ref: string): JsonObject | null {
    if (!this.schema || !ref.startsWith('#/')) {
      return null;
    }

    const parts = ref.substring(2).split('/');
    let current: JsonValue = this.schema;

    for (const part of parts) {
      if (!this.isObject(current)) {
        return null;
      }
      const unescaped = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!(unescaped in current)) {
        return null;
      }
      current = current[unescaped];
    }

    return this.isObject(current) ? current : null;
  }

  private isObject(value: JsonValue): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private getLocation(path: string): JsonLocation {
    if (this.sourceLocator) {
      return this.sourceLocator.getLocation(path);
    }
    return UNKNOWN_LOCATION;
  }

  private addError(path: string, message: string, code: string = 'SCHEMA_ERROR'): void {
    const location = this.getLocation(path);
    this.errors.push({ code, message, path, severity: 'error', location });
  }

  private result(): ValidationResult {
    return {
      isValid: this.errors.length === 0,
      errors: [...this.errors],
    };
  }
}
