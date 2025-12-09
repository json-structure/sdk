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

/** Validation extension keywords that require JSONStructureValidation extension. */
const VALIDATION_EXTENSION_KEYWORDS = new Set([
  'pattern', 'format', 'minLength', 'maxLength',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains',
  'minProperties', 'maxProperties', 'propertyNames', 'patternProperties', 'dependentRequired',
  'minEntries', 'maxEntries', 'patternKeys', 'keyNames',
  'contentEncoding', 'contentMediaType',
  'has', 'default'
]);

/**
 * Context for a single schema validation operation.
 * Contains all mutable state that changes during validation.
 */
interface SchemaValidationContext {
  errors: ValidationError[];
  warnings: ValidationError[];
  schema: JsonObject;
  seenRefs: Set<string>;
  seenExtends: Set<string>;
  sourceLocator: JsonSourceLocator | null;
}

/**
 * Validates JSON Structure schema documents.
 * 
 * This validator is stateless after construction and can be safely reused
 * across multiple validations, including in async/concurrent contexts.
 */
export class SchemaValidator {
  private readonly allowImport: boolean;
  private readonly externalSchemas: Map<string, JsonValue>;
  private readonly warnOnUnusedExtensionKeywords: boolean;

  constructor(options: SchemaValidatorOptions = {}) {
    this.allowImport = options.allowImport ?? false;
    // Note: maxValidationDepth is accepted in options but not currently implemented
    this.warnOnUnusedExtensionKeywords = options.warnOnUnusedExtensionKeywords ?? true;
    this.externalSchemas = new Map<string, JsonValue>();
    
    // Build lookup for external schemas by $id and preprocess imports
    if (options.externalSchemas) {
      // First, deep copy all schemas
      for (const [uri, schema] of options.externalSchemas) {
        this.externalSchemas.set(uri, JSON.parse(JSON.stringify(schema)));
      }
      // Also look for schemas by $id in the values
      for (const schema of options.externalSchemas.values()) {
        if (this.isObject(schema) && typeof (schema as JsonObject).$id === 'string') {
          const id = (schema as JsonObject).$id as string;
          if (!this.externalSchemas.has(id)) {
            this.externalSchemas.set(id, JSON.parse(JSON.stringify(schema)));
          }
        }
      }
      // Process imports in external schemas if allowImport is enabled
      if (this.allowImport) {
        // Multiple passes to handle chained imports
        for (let i = 0; i < this.externalSchemas.size; i++) {
          for (const schema of this.externalSchemas.values()) {
            if (this.isObject(schema)) {
              this.processImportsInExternalSchema(schema as JsonObject);
            }
          }
        }
      }
    }
  }

  /**
   * Validates a JSON Structure schema document.
   * @param schema The schema to validate.
   * @param schemaJson Optional raw JSON string for source location tracking.
   * @returns Validation result with any errors.
   */
  validate(schema: JsonValue, schemaJson?: string): ValidationResult {
    // Set up source locator if JSON string provided
    const sourceLocator = schemaJson ? new JsonSourceLocator(schemaJson) : null;

    if (!this.isObject(schema)) {
      const location = sourceLocator?.getLocation('#') ?? UNKNOWN_LOCATION;
      const error: ValidationError = {
        code: ErrorCodes.SCHEMA_INVALID_TYPE,
        message: 'Schema must be an object',
        path: '#',
        severity: 'error',
        location
      };
      return {
        isValid: false,
        errors: [error],
        warnings: []
      };
    }

    // Create validation context
    const context = this.createContext(schema, sourceLocator);
    
    // Process imports if enabled
    if (this.allowImport) {
      this.processImports(context, context.schema, '#');
    }
    
    this.validateSchemaDocument(context, schema, '#');

    return {
      isValid: context.errors.length === 0,
      errors: [...context.errors],
      warnings: [...context.warnings]
    };
  }

  /**
   * Creates a new validation context for a schema validation operation.
   */
  private createContext(schema: JsonObject, sourceLocator: JsonSourceLocator | null): SchemaValidationContext {
    return {
      errors: [],
      warnings: [],
      schema: schema,
      seenRefs: new Set(),
      seenExtends: new Set(),
      sourceLocator
    };
  }

  private validateSchemaDocument(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    // Root-level validation (path is '#' for root)
    const isRoot = path === '#';
    if (isRoot) {
      // Root schema must have $id
      if (!('$id' in schema)) {
        this.addError(context, '', "Missing required '$id' keyword at root", ErrorCodes.SCHEMA_ROOT_MISSING_ID);
      }
      
      // Root schema with 'type' must have 'name'
      if ('type' in schema && !('name' in schema)) {
        this.addError(context, '', "Root schema with 'type' must have a 'name' property", ErrorCodes.SCHEMA_ROOT_MISSING_NAME);
      }
    }

    // Validate definitions if present
    if ('definitions' in schema) {
      this.validateDefinitions(context, schema.definitions, `${path}/definitions`);
    }
    // Note: $defs is NOT a JSON Structure keyword (it's JSON Schema).
    // JSON Structure uses 'definitions' only.
    if ('$defs' in schema) {
      this.addError(context, `${path}/$defs`, "'$defs' is not a valid JSON Structure keyword. Use 'definitions' instead.", ErrorCodes.SCHEMA_UNKNOWN_KEYWORD);
    }

    // If there's a $root, validate that the referenced type exists
    if ('$root' in schema) {
      const root = schema.$root;
      if (typeof root !== 'string') {
        this.addError(context, `${path}/$root`, '$root must be a string', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (root.startsWith('#/')) {
        const resolved = this.resolveRef(context, root);
        if (resolved === null) {
          this.addError(context, `${path}/$root`, `$root reference '${root}' not found`, ErrorCodes.SCHEMA_REF_NOT_FOUND);
        }
      }
      // If $root is present, no need for root-level type
      return;
    }

    // Validate the root type if present
    if ('type' in schema) {
      this.validateTypeDefinition(context, schema, path);
    } else {
      // No type at root level and no $root - error unless it's just definitions with no properties
      const hasOnlyMeta = Object.keys(schema).every(k => 
        k.startsWith('$') || k === 'definitions' || k === 'name' || k === 'description'
      );
      // Must have type OR $root, OR just definitions
      // If it has only meta+definitions, it needs to have definitions content
      if (!hasOnlyMeta || !('definitions' in schema)) {
        this.addError(context, path, "Schema must have a 'type' property or '$root' reference", ErrorCodes.SCHEMA_ROOT_MISSING_TYPE);
      }
    }
    
    // Validate conditional keywords at root level
    this.validateConditionalKeywords(context, schema, path);
    
    // Check for validation extension keywords without $uses at root level
    if (isRoot && this.warnOnUnusedExtensionKeywords) {
      this.checkValidationExtensionKeywords(context, schema);
    }
  }

  /**
   * Recursively checks for validation extension keywords and adds warnings if
   * they are used without enabling the validation extension.
   */
  private checkValidationExtensionKeywords(context: SchemaValidationContext, schema: JsonObject): void {
    // Check if validation extensions are enabled
    const uses = schema.$uses;
    const schemaUri = schema.$schema;
    let validationEnabled = false;
    
    if (Array.isArray(uses)) {
      validationEnabled = uses.some(u => u === 'JSONStructureValidation');
    }
    if (typeof schemaUri === 'string' && (schemaUri.includes('extended') || schemaUri.includes('validation'))) {
      validationEnabled = true;
    }
    
    if (!validationEnabled) {
      // Collect all extension keywords used in the schema
      this.collectValidationKeywordWarnings(context, schema, '');
    }
  }
  
  private collectValidationKeywordWarnings(context: SchemaValidationContext, obj: JsonValue, path: string): void {
    if (!this.isObject(obj)) return;
    
    const schema = obj as JsonObject;
    for (const [key, value] of Object.entries(schema)) {
      if (VALIDATION_EXTENSION_KEYWORDS.has(key)) {
        this.addWarning(context, 
          path ? `${path}/${key}` : key,
          `Validation extension keyword '${key}' is used but validation extensions are not enabled. ` +
          `Add '"$uses": ["JSONStructureValidation"]' to enable validation, or this keyword will be ignored.`,
          ErrorCodes.SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED
        );
      }
      
      // Recurse into nested objects and arrays
      if (this.isObject(value)) {
        this.collectValidationKeywordWarnings(context, value, path ? `${path}/${key}` : key);
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (this.isObject(value[i])) {
            this.collectValidationKeywordWarnings(context, value[i], path ? `${path}/${key}/${i}` : `${key}/${i}`);
          }
        }
      }
    }
  }

  private validateDefinitions(context: SchemaValidationContext, defs: JsonValue, path: string): void {
    if (!this.isObject(defs)) {
      this.addError(context, path, 'definitions must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      return;
    }

    for (const [name, def] of Object.entries(defs)) {
      if (!this.isObject(def)) {
        this.addError(context, `${path}/${name}`, 'Definition must be an object', ErrorCodes.SCHEMA_INVALID_TYPE);
        continue;
      }
      // Check if this is a type definition or a namespace
      if ('type' in def || '$ref' in def || this.hasConditionalKeywords(def)) {
        this.validateTypeDefinition(context, def, `${path}/${name}`);
      } else {
        // This is a namespace - validate its contents as definitions
        this.validateDefinitions(context, def, `${path}/${name}`);
      }
    }
  }

  private hasConditionalKeywords(schema: JsonObject): boolean {
    const conditionalKeywords = ['allOf', 'anyOf', 'oneOf', 'not', 'if'];
    return conditionalKeywords.some(k => k in schema);
  }

  private validateTypeDefinition(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    const type = schema.type;

    // Check for bare $ref - this is NOT permitted per spec Section 3.4.1
    // $ref is ONLY permitted inside the 'type' attribute value
    if ('$ref' in schema) {
      this.addError(context, 
        `${path}/$ref`,
        "'$ref' is only permitted inside the 'type' attribute. Use { \"type\": { \"$ref\": \"...\" } } instead of { \"$ref\": \"...\" }",
        ErrorCodes.SCHEMA_REF_NOT_IN_TYPE
      );
      return;
    }

    // Validate $extends if present
    if ('$extends' in schema) {
      this.validateExtends(context, schema.$extends, `${path}/$extends`);
    }

    // Type is required unless it's a conditional-only schema
    if (type === undefined) {
      const conditionalKeywords = ['allOf', 'anyOf', 'oneOf', 'not', 'if'];
      const hasConditional = conditionalKeywords.some(k => k in schema);
      if (!hasConditional && !('$root' in schema)) {
        this.addError(context, path, "Schema must have a 'type' property", ErrorCodes.SCHEMA_MISSING_TYPE);
        return;
      }
      return;
    }

    // Type can be a string, array (union), or object with $ref
    if (typeof type === 'string') {
      this.validateSingleType(context, type, schema, path);
    } else if (Array.isArray(type)) {
      this.validateUnionType(context, type, schema, path);
    } else if (this.isObject(type)) {
      if ('$ref' in type) {
        this.validateRef(context, type.$ref, `${path}/type`);
      } else {
        this.addError(context, `${path}/type`, 'type object must have $ref', ErrorCodes.SCHEMA_TYPE_OBJECT_MISSING_REF);
      }
    } else {
      this.addError(context, `${path}/type`, 'type must be a string, array, or object with $ref', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
    }
  }

  private validateSingleType(context: SchemaValidationContext, type: string, schema: JsonObject, path: string): void {
    if (!ALL_TYPES.includes(type as any)) {
      this.addError(context, `${path}/type`, `Unknown type '${type}'`, ErrorCodes.SCHEMA_TYPE_INVALID);
      return;
    }

    // Validate type-specific constraints
    switch (type) {
      case 'object':
        this.validateObjectType(context, schema, path);
        break;
      case 'array':
      case 'set':
        this.validateArrayType(context, schema, path);
        break;
      case 'map':
        this.validateMapType(context, schema, path);
        break;
      case 'tuple':
        this.validateTupleType(context, schema, path);
        break;
      case 'choice':
        this.validateChoiceType(context, schema, path);
        break;
      default:
        // Primitive types
        this.validatePrimitiveConstraints(context, type, schema, path);
        break;
    }
  }

  private validateUnionType(context: SchemaValidationContext, types: JsonValue[], _schema: JsonObject, path: string): void {
    if (types.length === 0) {
      this.addError(context, `${path}/type`, 'Union type array cannot be empty', ErrorCodes.SCHEMA_TYPE_ARRAY_EMPTY);
      return;
    }

    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      if (typeof t === 'string') {
        // String type name
        if (!ALL_TYPES.includes(t as any)) {
          this.addError(context, `${path}/type[${i}]`, `Unknown type '${t}'`, ErrorCodes.SCHEMA_TYPE_INVALID);
        }
      } else if (this.isObject(t)) {
        // Type reference object with $ref
        if ('$ref' in t) {
          this.validateRef(context, t.$ref, `${path}/type[${i}]`);
        } else {
          this.addError(context, `${path}/type[${i}]`, 'Union type object must have $ref', ErrorCodes.SCHEMA_TYPE_OBJECT_MISSING_REF);
        }
      } else {
        this.addError(context, `${path}/type[${i}]`, 'Union type elements must be strings or $ref objects', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      }
    }
  }

  private validateObjectType(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    // properties validation
    if ('properties' in schema) {
      const props = schema.properties;
      if (!this.isObject(props)) {
        this.addError(context, `${path}/properties`, 'properties must be an object', ErrorCodes.SCHEMA_PROPERTIES_NOT_OBJECT);
      } else if (Object.keys(props).length === 0 && !('$extends' in schema)) {
        this.addError(context, `${path}/properties`, 'properties must have at least one entry', ErrorCodes.SCHEMA_KEYWORD_EMPTY);
      } else {
        for (const [propName, propSchema] of Object.entries(props)) {
          if (!this.isObject(propSchema)) {
            this.addError(context, `${path}/properties/${propName}`, 'Property schema must be an object', ErrorCodes.SCHEMA_INVALID_TYPE);
          } else {
            this.validateTypeDefinition(context, propSchema, `${path}/properties/${propName}`);
          }
        }
      }
    }

    // required validation
    if ('required' in schema) {
      const required = schema.required;
      if (!Array.isArray(required)) {
        this.addError(context, `${path}/required`, 'required must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        const props = this.isObject(schema.properties) ? schema.properties : {};
        for (let i = 0; i < required.length; i++) {
          const r = required[i];
          if (typeof r !== 'string') {
            this.addError(context, `${path}/required[${i}]`, 'required elements must be strings', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
          } else if (!(r in props) && !('$extends' in schema)) {
            this.addError(context, `${path}/required[${i}]`, `Required property '${r}' not found in properties`, ErrorCodes.SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED);
          }
        }
      }
    }
  }

  private validateArrayType(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    if (!('items' in schema)) {
      this.addError(context, path, "Array type must have 'items' property", ErrorCodes.SCHEMA_ARRAY_MISSING_ITEMS);
      return;
    }

    const items = schema.items;
    if (!this.isObject(items)) {
      this.addError(context, `${path}/items`, 'items must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
    } else {
      this.validateTypeDefinition(context, items, `${path}/items`);
    }

    // Validate array constraints
    this.validateArrayConstraints(context, schema, path);
  }

  private validateMapType(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    if (!('values' in schema)) {
      this.addError(context, path, "Map type must have 'values' property", ErrorCodes.SCHEMA_MAP_MISSING_VALUES);
      return;
    }

    const values = schema.values;
    if (!this.isObject(values)) {
      this.addError(context, `${path}/values`, 'values must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
    } else {
      this.validateTypeDefinition(context, values, `${path}/values`);
    }
  }

  private validateTupleType(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    if (!('tuple' in schema)) {
      this.addError(context, path, "Tuple type must have 'tuple' property defining element order", ErrorCodes.SCHEMA_TUPLE_MISSING_ORDER);
      return;
    }

    const tuple = schema.tuple;
    if (!Array.isArray(tuple)) {
      this.addError(context, `${path}/tuple`, 'tuple must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      return;
    }

    const props = this.isObject(schema.properties) ? schema.properties : {};
    for (let i = 0; i < tuple.length; i++) {
      const name = tuple[i];
      if (typeof name !== 'string') {
        this.addError(context, `${path}/tuple[${i}]`, 'tuple elements must be strings', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (!(name in props)) {
        this.addError(context, `${path}/tuple[${i}]`, `Tuple element '${name}' not found in properties`, ErrorCodes.SCHEMA_TUPLE_PROPERTY_NOT_DEFINED);
      }
    }
  }

  private validateChoiceType(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    if (!('choices' in schema)) {
      this.addError(context, path, "Choice type must have 'choices' property", ErrorCodes.SCHEMA_CHOICE_MISSING_CHOICES);
      return;
    }

    const choices = schema.choices;
    if (!this.isObject(choices)) {
      this.addError(context, `${path}/choices`, 'choices must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
    } else {
      for (const [choiceName, choiceSchema] of Object.entries(choices)) {
        if (!this.isObject(choiceSchema)) {
          this.addError(context, `${path}/choices/${choiceName}`, 'Choice schema must be an object', ErrorCodes.SCHEMA_INVALID_TYPE);
        } else {
          this.validateTypeDefinition(context, choiceSchema, `${path}/choices/${choiceName}`);
        }
      }
    }
  }

  private validatePrimitiveConstraints(context: SchemaValidationContext, type: string, schema: JsonObject, path: string): void {
    // Validate enum
    if ('enum' in schema) {
      const enumVal = schema.enum;
      if (!Array.isArray(enumVal)) {
        this.addError(context, `${path}/enum`, 'enum must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (enumVal.length === 0) {
        this.addError(context, `${path}/enum`, 'enum must have at least one value', ErrorCodes.SCHEMA_KEYWORD_EMPTY);
      } else {
        // Check for duplicates
        const seen = new Set();
        for (let i = 0; i < enumVal.length; i++) {
          const serialized = JSON.stringify(enumVal[i]);
          if (seen.has(serialized)) {
            this.addError(context, `${path}/enum`, 'enum values must be unique', ErrorCodes.SCHEMA_ENUM_DUPLICATE_VALUE);
            break;
          }
          seen.add(serialized);
        }
      }
    }

    // Validate constraint type matching (e.g., minLength on string, minimum on numeric)
    this.validateConstraintTypeMatch(context, type, schema, path);

    // Validate string constraints
    if (type === 'string') {
      this.validateStringConstraints(context, schema, path);
    }

    // Validate numeric constraints
    const numericTypes = [
      'number', 'integer', 'float', 'double', 'decimal', 'float8',
      'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
      'int64', 'uint64', 'int128', 'uint128',
    ];
    if (numericTypes.includes(type)) {
      this.validateNumericConstraints(context, schema, path);
    }
  }

  private validateStringConstraints(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    if ('minLength' in schema) {
      const minLength = schema.minLength;
      if (typeof minLength !== 'number' || !Number.isInteger(minLength)) {
        this.addError(context, `${path}/minLength`, 'minLength must be an integer', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (minLength < 0) {
        this.addError(context, `${path}/minLength`, 'minLength must be non-negative', ErrorCodes.SCHEMA_CONSTRAINT_VALUE_INVALID);
      }
    }

    if ('maxLength' in schema) {
      const maxLength = schema.maxLength;
      if (typeof maxLength !== 'number' || !Number.isInteger(maxLength)) {
        this.addError(context, `${path}/maxLength`, 'maxLength must be an integer', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (maxLength < 0) {
        this.addError(context, `${path}/maxLength`, 'maxLength must be non-negative', ErrorCodes.SCHEMA_CONSTRAINT_VALUE_INVALID);
      }
    }

    // Check minLength <= maxLength
    if ('minLength' in schema && 'maxLength' in schema) {
      const min = schema.minLength as number;
      const max = schema.maxLength as number;
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        this.addError(context, path, 'minLength cannot exceed maxLength', ErrorCodes.SCHEMA_CONSTRAINT_RANGE_INVALID);
      }
    }

    if ('pattern' in schema) {
      const pattern = schema.pattern;
      if (typeof pattern !== 'string') {
        this.addError(context, `${path}/pattern`, 'pattern must be a string', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        try {
          new RegExp(pattern);
        } catch {
          this.addError(context, `${path}/pattern`, `Invalid regular expression: ${pattern}`, ErrorCodes.SCHEMA_PATTERN_INVALID);
        }
      }
    }
  }

  private validateNumericConstraints(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    if ('minimum' in schema) {
      if (typeof schema.minimum !== 'number') {
        this.addError(context, `${path}/minimum`, 'minimum must be a number', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      }
    }

    if ('maximum' in schema) {
      if (typeof schema.maximum !== 'number') {
        this.addError(context, `${path}/maximum`, 'maximum must be a number', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      }
    }

    // Check minimum <= maximum
    if ('minimum' in schema && 'maximum' in schema) {
      const min = schema.minimum as number;
      const max = schema.maximum as number;
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        this.addError(context, path, 'minimum cannot exceed maximum', ErrorCodes.SCHEMA_CONSTRAINT_RANGE_INVALID);
      }
    }

    if ('multipleOf' in schema) {
      const multipleOf = schema.multipleOf;
      if (typeof multipleOf !== 'number') {
        this.addError(context, `${path}/multipleOf`, 'multipleOf must be a number');
      } else if (multipleOf <= 0) {
        this.addError(context, `${path}/multipleOf`, 'multipleOf must be greater than 0', ErrorCodes.SCHEMA_CONSTRAINT_VALUE_INVALID);
      }
    }
  }

  private validateArrayConstraints(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    if ('minItems' in schema) {
      const minItems = schema.minItems;
      if (typeof minItems !== 'number' || !Number.isInteger(minItems)) {
        this.addError(context, `${path}/minItems`, 'minItems must be an integer', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (minItems < 0) {
        this.addError(context, `${path}/minItems`, 'minItems must be non-negative', ErrorCodes.SCHEMA_CONSTRAINT_VALUE_INVALID);
      }
    }

    if ('maxItems' in schema) {
      const maxItems = schema.maxItems;
      if (typeof maxItems !== 'number' || !Number.isInteger(maxItems)) {
        this.addError(context, `${path}/maxItems`, 'maxItems must be an integer', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else if (maxItems < 0) {
        this.addError(context, `${path}/maxItems`, 'maxItems must be non-negative', ErrorCodes.SCHEMA_CONSTRAINT_VALUE_INVALID);
      }
    }

    // Check minItems <= maxItems
    if ('minItems' in schema && 'maxItems' in schema) {
      const min = schema.minItems as number;
      const max = schema.maxItems as number;
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        this.addError(context, path, 'minItems cannot exceed maxItems', ErrorCodes.SCHEMA_CONSTRAINT_RANGE_INVALID);
      }
    }
  }

  private validateConditionalKeywords(context: SchemaValidationContext, schema: JsonObject, path: string): void {
    // Validate allOf
    if ('allOf' in schema) {
      if (!Array.isArray(schema.allOf)) {
        this.addError(context, `${path}/allOf`, 'allOf must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        for (let i = 0; i < schema.allOf.length; i++) {
          const item = schema.allOf[i];
          if (this.isObject(item)) {
            this.validateTypeDefinition(context, item, `${path}/allOf[${i}]`);
          }
        }
      }
    }

    // Validate anyOf
    if ('anyOf' in schema) {
      if (!Array.isArray(schema.anyOf)) {
        this.addError(context, `${path}/anyOf`, 'anyOf must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        for (let i = 0; i < schema.anyOf.length; i++) {
          const item = schema.anyOf[i];
          if (this.isObject(item)) {
            this.validateTypeDefinition(context, item, `${path}/anyOf[${i}]`);
          }
        }
      }
    }

    // Validate oneOf
    if ('oneOf' in schema) {
      if (!Array.isArray(schema.oneOf)) {
        this.addError(context, `${path}/oneOf`, 'oneOf must be an array', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        for (let i = 0; i < schema.oneOf.length; i++) {
          const item = schema.oneOf[i];
          if (this.isObject(item)) {
            this.validateTypeDefinition(context, item, `${path}/oneOf[${i}]`);
          }
        }
      }
    }

    // Validate not
    if ('not' in schema) {
      if (!this.isObject(schema.not)) {
        this.addError(context, `${path}/not`, 'not must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        this.validateTypeDefinition(context, schema.not, `${path}/not`);
      }
    }

    // Validate if/then/else
    if ('if' in schema) {
      if (!this.isObject(schema.if)) {
        this.addError(context, `${path}/if`, 'if must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        this.validateTypeDefinition(context, schema.if, `${path}/if`);
      }
    }
    if ('then' in schema) {
      if (!this.isObject(schema.then)) {
        this.addError(context, `${path}/then`, 'then must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        this.validateTypeDefinition(context, schema.then, `${path}/then`);
      }
    }
    if ('else' in schema) {
      if (!this.isObject(schema.else)) {
        this.addError(context, `${path}/else`, 'else must be an object', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      } else {
        this.validateTypeDefinition(context, schema.else, `${path}/else`);
      }
    }
  }

  private validateConstraintTypeMatch(context: SchemaValidationContext, type: string, schema: JsonObject, path: string): void {
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
        this.addError(context, `${path}/${constraint}`, `${constraint} constraint is only valid for string type, not ${type}`, ErrorCodes.SCHEMA_CONSTRAINT_TYPE_MISMATCH);
      }
    }

    // Check numeric constraints on non-numeric types
    for (const constraint of numericOnlyConstraints) {
      if (constraint in schema && !numericTypes.includes(type)) {
        this.addError(context, `${path}/${constraint}`, `${constraint} constraint is only valid for numeric types, not ${type}`, ErrorCodes.SCHEMA_CONSTRAINT_TYPE_MISMATCH);
      }
    }
  }

  private validateExtends(context: SchemaValidationContext, extendsValue: JsonValue, path: string): void {
    const refs: string[] = [];
    
    if (typeof extendsValue === 'string') {
      refs.push(extendsValue);
    } else if (Array.isArray(extendsValue)) {
      for (let i = 0; i < extendsValue.length; i++) {
        const item = extendsValue[i];
        if (typeof item === 'string') {
          refs.push(item);
        } else {
          this.addError(context, `${path}[${i}]`, '$extends array items must be strings', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
        }
      }
    } else {
      this.addError(context, path, '$extends must be a string or array of strings', ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE);
      return;
    }

    // Validate each $extends reference
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const refPath = Array.isArray(extendsValue) ? `${path}[${i}]` : path;
      
      if (!ref.startsWith('#/')) {
        // External reference - just check if it exists
        continue;
      }

      // Check for circular $extends
      if (context.seenExtends.has(ref)) {
        this.addError(context, refPath, `Circular $extends reference detected: ${ref}`, ErrorCodes.SCHEMA_EXTENDS_CIRCULAR);
        continue;
      }

      context.seenExtends.add(ref);
      const resolved = this.resolveRef(context, ref);
      if (resolved === null) {
        this.addError(context, refPath, `$extends reference '${ref}' not found`, ErrorCodes.SCHEMA_EXTENDS_NOT_FOUND);
      } else {
        // Recursively validate the extended schema (which may have its own $extends)
        if ('$extends' in resolved) {
          this.validateExtends(context, resolved.$extends, refPath);
        }
      }
      context.seenExtends.delete(ref);
    }
  }

  private validateRef(context: SchemaValidationContext, ref: JsonValue, path: string): void {
    if (typeof ref !== 'string') {
      this.addError(context, path, '$ref must be a string', ErrorCodes.SCHEMA_REF_INVALID);
      return;
    }

    if (ref.startsWith('#/')) {
      // Check for circular reference
      if (context.seenRefs.has(ref)) {
        // Circular references to properly defined types are valid in JSON Structure
        // (e.g., ObjectType -> Property -> Type -> ObjectType in metaschemas)
        // However, a direct self-reference with no content is invalid
        // We detect this by checking if the resolved schema is ONLY a $ref or type: { $ref: ... }
        const resolved = this.resolveRef(context, ref);
        if (resolved !== null) {
          const keys = Object.keys(resolved);
          // Check for bare $ref: { "$ref": "..." }
          const isBareRef = keys.length === 1 && '$ref' in resolved;
          // Check for type-wrapped ref only: { "type": { "$ref": "..." } }
          const isTypeRefOnly = keys.length === 1 && 'type' in resolved && 
            typeof resolved.type === 'object' && resolved.type !== null && !Array.isArray(resolved.type) &&
            Object.keys(resolved.type as object).length === 1 && '$ref' in (resolved.type as object);
          
          if (isBareRef || isTypeRefOnly) {
            // This is a definition that's only a $ref - direct circular with no content
            this.addError(context, path, `Circular reference detected: ${ref}`, ErrorCodes.SCHEMA_REF_CIRCULAR);
          }
        }
        // For other circular refs, just stop recursing to prevent infinite loops
        return;
      }

      context.seenRefs.add(ref);
      const resolved = this.resolveRef(context, ref);
      if (resolved === null) {
        this.addError(context, path, `$ref '${ref}' not found`, ErrorCodes.SCHEMA_REF_NOT_FOUND);
      } else {
        // Validate the resolved schema to check for further circular refs
        this.validateTypeDefinition(context, resolved, path);
      }
      context.seenRefs.delete(ref);
    }
  }

  private resolveRef(context: SchemaValidationContext, ref: string): JsonObject | null {
    if (!context.schema || !ref.startsWith('#/')) {
      return null;
    }

    const parts = ref.substring(2).split('/');
    let current: JsonValue = context.schema;

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

  private getLocation(context: SchemaValidationContext, path: string): JsonLocation {
    if (context.sourceLocator) {
      return context.sourceLocator.getLocation(path);
    }
    return UNKNOWN_LOCATION;
  }

  private addError(context: SchemaValidationContext, path: string, message: string, code: string = 'SCHEMA_ERROR'): void {
    const location = this.getLocation(context, path);
    context.errors.push({ code, message, path, severity: 'error', location });
  }

  private addWarning(context: SchemaValidationContext, path: string, message: string, code: string): void {
    const location = context.sourceLocator?.getLocation(path) ?? UNKNOWN_LOCATION;
    context.warnings.push({ code, message, path, severity: 'warning', location });
  }

  /**
   * Processes $import and $importdefs in an external schema during initialization.
   * This is called on external schemas to ensure imported definitions are available.
   */
  private processImportsInExternalSchema(obj: JsonObject): void {
    const importKeys = ['$import', '$importdefs'];
    
    for (const key of importKeys) {
      if (key in obj) {
        const uri = obj[key];
        if (typeof uri !== 'string') {
          continue;
        }
        
        const external = this.externalSchemas.get(uri);
        if (!external || !this.isObject(external)) {
          continue;
        }
        
        let importedDefs: Record<string, JsonValue> = {};
        
        if (key === '$import') {
          // Import root type if available
          if ('type' in external && 'name' in external && typeof external.name === 'string') {
            importedDefs[external.name] = external;
          }
          // Also import definitions
          if ('definitions' in external && this.isObject(external.definitions)) {
            Object.assign(importedDefs, external.definitions);
          }
        } else {
          // $importdefs - only import definitions
          if ('definitions' in external && this.isObject(external.definitions)) {
            importedDefs = { ...(external.definitions as Record<string, JsonValue>) };
          }
        }
        
        // Merge into definitions at root level
        if (!('definitions' in obj) || !this.isObject(obj.definitions)) {
          obj.definitions = {};
        }
        const mergeTarget = obj.definitions as JsonObject;
        
        // Deep copy and rewrite refs
        for (const [k, v] of Object.entries(importedDefs)) {
          if (!(k in mergeTarget)) {
            const copied = JSON.parse(JSON.stringify(v));
            if (this.isObject(copied)) {
              this.rewriteRefs(copied, '#/definitions');
            }
            mergeTarget[k] = copied;
          }
        }
        
        delete obj[key];
      }
    }
  }

  /**
   * Processes $import and $importdefs keywords recursively in a schema.
   */
  private processImports(context: SchemaValidationContext, obj: JsonValue, path: string): void {
    if (!this.isObject(obj)) {
      return;
    }
    
    const importKeys = ['$import', '$importdefs'];
    
    for (const key of importKeys) {
      if (key in obj) {
        const uri = obj[key];
        if (typeof uri !== 'string') {
          this.addError(context, `${path}/${key}`, `${key} value must be a string URI`);
          continue;
        }
        
        const external = this.externalSchemas.get(uri);
        if (!external || !this.isObject(external)) {
          this.addError(context, `${path}/${key}`, `Unable to resolve import URI: ${uri}`);
          continue;
        }
        
        let importedDefs: Record<string, JsonValue> = {};
        
        if (key === '$import') {
          // Import root type if available
          if ('type' in external && 'name' in external && typeof external.name === 'string') {
            importedDefs[external.name] = external;
          }
          // Also import definitions
          if ('definitions' in external && this.isObject(external.definitions)) {
            Object.assign(importedDefs, external.definitions);
          }
        } else {
          // $importdefs - only import definitions
          if ('definitions' in external && this.isObject(external.definitions)) {
            importedDefs = { ...(external.definitions as Record<string, JsonValue>) };
          }
        }
        
        // Determine where to merge
        const isRootLevel = path === '#';
        const targetPath = isRootLevel ? '#/definitions' : path;
        
        if (isRootLevel) {
          if (!('definitions' in obj) || !this.isObject(obj.definitions)) {
            obj.definitions = {};
          }
        }
        
        const mergeTarget = isRootLevel ? obj.definitions as JsonObject : obj;
        
        // Deep copy and rewrite refs
        for (const [k, v] of Object.entries(importedDefs)) {
          if (!(k in mergeTarget)) {
            const copied = JSON.parse(JSON.stringify(v));
            if (this.isObject(copied)) {
              this.rewriteRefs(copied, targetPath);
            }
            mergeTarget[k] = copied;
          }
        }
        
        delete obj[key];
      }
    }
    
    // Recurse into child objects (but not into 'properties')
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'properties') {
        continue;
      }
      if (this.isObject(value)) {
        this.processImports(context, value, `${path}/${key}`);
      } else if (Array.isArray(value)) {
        value.forEach((item, idx) => {
          if (this.isObject(item)) {
            this.processImports(context, item, `${path}/${key}[${idx}]`);
          }
        });
      }
    }
  }

  /**
   * Rewrites $ref pointers in imported content to point to their new location.
   */
  private rewriteRefs(obj: JsonValue, targetPath: string): void {
    if (!this.isObject(obj)) {
      return;
    }
    
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith('#')) {
        // Rewrite $ref reference
        const refParts = value.substring(1).replace(/^\//,'').split('/');
        if (refParts.length > 0 && refParts[0]) {
          if (refParts[0] === 'definitions' && refParts.length > 1) {
            const remaining = refParts.slice(1).join('/');
            obj[key] = `${targetPath}/${remaining}`;
          } else {
            const remaining = refParts.join('/');
            obj[key] = `${targetPath}/${remaining}`;
          }
        }
      } else if (key === '$extends') {
        // $extends can be a string or array of strings
        if (typeof value === 'string' && value.startsWith('#')) {
          const refParts = value.substring(1).replace(/^\//,'').split('/');
          if (refParts.length > 0 && refParts[0]) {
            if (refParts[0] === 'definitions' && refParts.length > 1) {
              const remaining = refParts.slice(1).join('/');
              obj[key] = `${targetPath}/${remaining}`;
            } else {
              const remaining = refParts.join('/');
              obj[key] = `${targetPath}/${remaining}`;
            }
          }
        } else if (Array.isArray(value)) {
          obj[key] = value.map((v: JsonValue) => {
            if (typeof v === 'string' && v.startsWith('#')) {
              const refParts = v.substring(1).replace(/^\//,'').split('/');
              if (refParts.length > 0 && refParts[0]) {
                if (refParts[0] === 'definitions' && refParts.length > 1) {
                  return `${targetPath}/${refParts.slice(1).join('/')}`;
                } else {
                  return `${targetPath}/${refParts.join('/')}`;
                }
              }
            }
            return v;
          });
        }
      } else if (this.isObject(value)) {
        this.rewriteRefs(value, targetPath);
      } else if (Array.isArray(value)) {
        value.forEach(item => {
          if (this.isObject(item)) {
            this.rewriteRefs(item, targetPath);
          }
        });
      }
    }
  }
}
