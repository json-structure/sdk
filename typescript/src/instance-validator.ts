/**
 * JSON Structure Instance Validator
 * 
 * Validates JSON instances against JSON Structure schemas, including
 * all core types, validation addins, and conditional composition.
 */

import {
  ValidationResult,
  ValidationError,
  InstanceValidatorOptions,
  JsonValue,
  JsonObject,
  JsonLocation,
  UNKNOWN_LOCATION,
} from './types';
import { JsonSourceLocator } from './json-source-locator';
import * as ErrorCodes from './error-codes';

// Regular expressions for format validation
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const TIME_REGEX = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const DURATION_REGEX = /^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$|^P\d+W$/;
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const JSON_POINTER_REGEX = /^#(\/[^/]+)*$/;

/**
 * Context for a single instance validation operation.
 * Contains all mutable state that changes during validation.
 */
interface InstanceValidationContext {
  errors: ValidationError[];
  rootSchema: JsonObject;
  enabledExtensions: Set<string>;
  sourceLocator: JsonSourceLocator | null;
}

/**
 * Validates JSON instances against JSON Structure schemas.
 * 
 * This validator is stateless after construction and can be safely reused
 * across multiple validations, including in async/concurrent contexts.
 */
export class InstanceValidator {
  private readonly options: InstanceValidatorOptions;

  constructor(options: InstanceValidatorOptions = {}) {
    this.options = { extended: false, allowImport: false, ...options };
  }

  /**
   * Validates a JSON instance against a JSON Structure schema.
   * @param instance The instance to validate.
   * @param schema The schema to validate against.
   * @param instanceJson Optional raw JSON string for source location tracking.
   * @returns Validation result with any errors.
   */
  validate(instance: JsonValue, schema: JsonValue, instanceJson?: string): ValidationResult {
    // Initialize source locator if JSON string is provided
    const sourceLocator = instanceJson ? new JsonSourceLocator(instanceJson) : null;

    if (!this.isObject(schema)) {
      const location = sourceLocator?.getLocation('#') ?? UNKNOWN_LOCATION;
      const error: ValidationError = {
        code: ErrorCodes.INSTANCE_SCHEMA_INVALID,
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
    const context: InstanceValidationContext = {
      errors: [],
      rootSchema: schema,
      enabledExtensions: new Set(),
      sourceLocator
    };
    
    this.detectEnabledExtensions(context);

    // Handle $root
    let targetSchema: JsonObject = schema;
    if ('$root' in schema && typeof schema.$root === 'string') {
      const rootRef = schema.$root;
      if (rootRef.startsWith('#/')) {
        const resolved = this.resolveRef(context, rootRef);
        if (resolved === null) {
          this.addError(context, '#', `Cannot resolve $root reference: ${rootRef}`, ErrorCodes.INSTANCE_ROOT_REF_INVALID);
          return {
            isValid: false,
            errors: [...context.errors],
            warnings: []
          };
        }
        targetSchema = resolved;
      }
    }

    this.validateInstance(context, instance, targetSchema, '#');

    return {
      isValid: context.errors.length === 0,
      errors: [...context.errors],
      warnings: []
    };
  }

  private detectEnabledExtensions(context: InstanceValidationContext): void {
    if (!context.rootSchema) return;

    const schemaUri = context.rootSchema.$schema;
    const uses = context.rootSchema.$uses;

    // Check schema URI for extended/validation metaschema
    if (typeof schemaUri === 'string') {
      if (schemaUri.includes('extended') || schemaUri.includes('validation')) {
        context.enabledExtensions.add('JSONStructureConditionalComposition');
        context.enabledExtensions.add('JSONStructureValidation');
      }
    }

    // Check $uses
    if (Array.isArray(uses)) {
      for (const ext of uses) {
        if (typeof ext === 'string') {
          context.enabledExtensions.add(ext);
        }
      }
    }

    // If extended=true option, enable all validation extensions
    if (this.options.extended) {
      context.enabledExtensions.add('JSONStructureConditionalComposition');
      context.enabledExtensions.add('JSONStructureValidation');
    }
  }

  private validateInstance(context: InstanceValidationContext, instance: JsonValue, schema: JsonObject, path: string): void {
    // Handle $ref
    if ('$ref' in schema && typeof schema.$ref === 'string') {
      const resolved = this.resolveRef(context, schema.$ref);
      if (resolved === null) {
        this.addError(context, path, `Cannot resolve $ref: ${schema.$ref}`, ErrorCodes.INSTANCE_REF_RESOLUTION_FAILED);
        return;
      }
      this.validateInstance(context, instance, resolved, path);
      return;
    }

    // Handle type with $ref
    const type = schema.type;
    if (this.isObject(type) && '$ref' in type) {
      const resolved = this.resolveRef(context, type.$ref as string);
      if (resolved === null) {
        this.addError(context, path, `Cannot resolve type $ref: ${type.$ref}`, ErrorCodes.INSTANCE_REF_RESOLUTION_FAILED);
        return;
      }
      // Merge the resolved type with the current schema
      const merged: JsonObject = { ...resolved, ...schema };
      merged.type = resolved.type;
      if ('properties' in resolved || 'properties' in schema) {
        merged.properties = { ...(resolved.properties as JsonObject || {}), ...(schema.properties as JsonObject || {}) };
      }
      this.validateInstance(context, instance, merged, path);
      return;
    }

    // Handle $extends (can be a string or array of strings for multiple inheritance)
    if ('$extends' in schema) {
      const extendsValue = schema.$extends;
      const extendsRefs: string[] = [];
      
      if (typeof extendsValue === 'string') {
        extendsRefs.push(extendsValue);
      } else if (Array.isArray(extendsValue)) {
        for (const ref of extendsValue) {
          if (typeof ref === 'string') {
            extendsRefs.push(ref);
          }
        }
      }
      
      if (extendsRefs.length > 0) {
        // Start with an empty merged object, then add base types in order (first-wins for properties)
        let mergedProperties: JsonObject = {};
        let mergedRequired: string[] = [];
        
        // Process base types in order - first type's properties take precedence
        for (const ref of extendsRefs) {
          const base = this.resolveRef(context, ref);
          if (base === null) {
            this.addError(context, path, `Cannot resolve $extends: ${ref}`, ErrorCodes.INSTANCE_EXTENDS_RESOLUTION_FAILED);
            return;
          }
          // Merge properties (first-wins: don't overwrite existing)
          if ('properties' in base && this.isObject(base.properties)) {
            for (const [key, value] of Object.entries(base.properties as JsonObject)) {
              if (!(key in mergedProperties)) {
                mergedProperties[key] = value;
              }
            }
          }
          // Merge required arrays
          if ('required' in base && Array.isArray(base.required)) {
            for (const req of base.required) {
              if (typeof req === 'string' && !mergedRequired.includes(req)) {
                mergedRequired.push(req);
              }
            }
          }
        }
        
        // Now merge derived schema's properties on top
        if ('properties' in schema && this.isObject(schema.properties)) {
          mergedProperties = { ...mergedProperties, ...(schema.properties as JsonObject) };
        }
        if ('required' in schema && Array.isArray(schema.required)) {
          for (const req of schema.required) {
            if (typeof req === 'string' && !mergedRequired.includes(req)) {
              mergedRequired.push(req);
            }
          }
        }
        
        // Create the final merged schema
        const merged: JsonObject = { ...schema };
        delete merged.$extends;
        if (Object.keys(mergedProperties).length > 0) {
          merged.properties = mergedProperties;
        }
        if (mergedRequired.length > 0) {
          merged.required = mergedRequired;
        }
        
        this.validateInstance(context, instance, merged, path);
        return;
      }
    }

    // Handle union types
    if (Array.isArray(type)) {
      let valid = false;
      for (const t of type) {
        const tempErrors = [...context.errors];
        context.errors = [];
        this.validateInstance(context, instance, { ...schema, type: t }, path);
        if (context.errors.length === 0) {
          valid = true;
          context.errors = tempErrors;
          break;
        }
        context.errors = tempErrors;
      }
      if (!valid) {
        this.addError(context, path, `Instance does not match any type in union`, ErrorCodes.INSTANCE_UNION_NO_MATCH);
      }
      return;
    }

    // Type is required unless this is a constraint-only schema
    if (typeof type !== 'string') {
      // Check for conditional-only schema
      const conditionalKeywords = ['allOf', 'anyOf', 'oneOf', 'not', 'if'];
      if (conditionalKeywords.some(k => k in schema)) {
        this.validateConditionals(context, instance, schema, path);
        return;
      }
      
      // Check for enum or const only (valid type-less schemas)
      if ('enum' in schema || 'const' in schema) {
        // Validate enum
        if ('enum' in schema && Array.isArray(schema.enum)) {
          if (!schema.enum.some(e => this.deepEqual(instance, e))) {
            this.addError(context, path, `Value must be one of: ${JSON.stringify(schema.enum)}`, ErrorCodes.INSTANCE_ENUM_MISMATCH);
          }
        }
        // Validate const
        if ('const' in schema) {
          if (!this.deepEqual(instance, schema.const)) {
            this.addError(context, path, `Value must equal const: ${JSON.stringify(schema.const)}`, ErrorCodes.INSTANCE_CONST_MISMATCH);
          }
        }
        return;
      }
      
      this.addError(context, path, "Schema must have a 'type' property", ErrorCodes.INSTANCE_SCHEMA_MISSING_TYPE);
      return;
    }

    // Validate abstract
    if (schema.abstract === true) {
      this.addError(context, path, 'Cannot validate instance against abstract schema', ErrorCodes.INSTANCE_ABSTRACT_SCHEMA);
      return;
    }

    // Validate by type
    this.validateByType(context, instance, type, schema, path);

    // Validate const
    if ('const' in schema) {
      if (!this.deepEqual(instance, schema.const)) {
        this.addError(context, path, `Value must equal const: ${JSON.stringify(schema.const)}`, ErrorCodes.INSTANCE_CONST_MISMATCH);
      }
    }

    // Validate enum
    if ('enum' in schema && Array.isArray(schema.enum)) {
      if (!schema.enum.some(e => this.deepEqual(instance, e))) {
        this.addError(context, path, `Value must be one of: ${JSON.stringify(schema.enum)}`, ErrorCodes.INSTANCE_ENUM_MISMATCH);
      }
    }

    // Validate conditionals if enabled
    if (context.enabledExtensions.has('JSONStructureConditionalComposition')) {
      this.validateConditionals(context, instance, schema, path);
    }

    // Validate validation addins if enabled
    if (context.enabledExtensions.has('JSONStructureValidation')) {
      this.validateValidationAddins(context, instance, type, schema, path);
    }
  }

  private validateByType(context: InstanceValidationContext, instance: JsonValue, type: string, schema: JsonObject, path: string): void {
    switch (type) {
      case 'any':
        // Any type accepts all values
        break;

      case 'null':
        if (instance !== null) {
          this.addError(context, path, `Expected null, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'boolean':
        if (typeof instance !== 'boolean') {
          this.addError(context, path, `Expected boolean, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'string':
        if (typeof instance !== 'string') {
          this.addError(context, path, `Expected string, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'number':
        if (typeof instance !== 'number' || typeof instance === 'boolean') {
          this.addError(context, path, `Expected number, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'integer':
      case 'int32':
        this.validateInt32(context, instance, path);
        break;

      case 'int8':
        this.validateIntRange(context, instance, -128, 127, 'int8', path);
        break;

      case 'uint8':
        this.validateIntRange(context, instance, 0, 255, 'uint8', path);
        break;

      case 'int16':
        this.validateIntRange(context, instance, -32768, 32767, 'int16', path);
        break;

      case 'uint16':
        this.validateIntRange(context, instance, 0, 65535, 'uint16', path);
        break;

      case 'uint32':
        this.validateIntRange(context, instance, 0, 4294967295, 'uint32', path);
        break;

      case 'int64':
        this.validateStringInt(context, instance, -(2n ** 63n), 2n ** 63n - 1n, 'int64', path);
        break;

      case 'uint64':
        this.validateStringInt(context, instance, 0n, 2n ** 64n - 1n, 'uint64', path);
        break;

      case 'int128':
        this.validateStringInt(context, instance, -(2n ** 127n), 2n ** 127n - 1n, 'int128', path);
        break;

      case 'uint128':
        this.validateStringInt(context, instance, 0n, 2n ** 128n - 1n, 'uint128', path);
        break;

      case 'float':
      case 'float8':
      case 'double':
        if (typeof instance !== 'number') {
          this.addError(context, path, `Expected ${type}, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'decimal':
        if (typeof instance !== 'string') {
          this.addError(context, path, `Expected decimal as string, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        } else if (isNaN(parseFloat(instance))) {
          this.addError(context, path, 'Invalid decimal format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'date':
        if (typeof instance !== 'string' || !DATE_REGEX.test(instance)) {
          this.addError(context, path, 'Expected date in YYYY-MM-DD format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'datetime':
        if (typeof instance !== 'string' || !DATETIME_REGEX.test(instance)) {
          this.addError(context, path, 'Expected datetime in RFC3339 format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'time':
        if (typeof instance !== 'string' || !TIME_REGEX.test(instance)) {
          this.addError(context, path, 'Expected time in HH:MM:SS format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'duration':
        if (typeof instance !== 'string') {
          this.addError(context, path, 'Expected duration as string', ErrorCodes.INSTANCE_TYPE_MISMATCH);
        } else if (!DURATION_REGEX.test(instance)) {
          this.addError(context, path, 'Expected duration in ISO 8601 format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'uuid':
        if (typeof instance !== 'string') {
          this.addError(context, path, 'Expected uuid as string', ErrorCodes.INSTANCE_TYPE_MISMATCH);
        } else if (!UUID_REGEX.test(instance)) {
          this.addError(context, path, 'Invalid uuid format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'uri':
        if (typeof instance !== 'string') {
          this.addError(context, path, 'Expected uri as string', ErrorCodes.INSTANCE_TYPE_MISMATCH);
        } else {
          try {
            new URL(instance);
          } catch {
            this.addError(context, path, 'Invalid uri format', ErrorCodes.INSTANCE_FORMAT_INVALID);
          }
        }
        break;

      case 'binary':
        if (typeof instance !== 'string') {
          this.addError(context, path, 'Expected binary as base64 string', ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'jsonpointer':
        if (typeof instance !== 'string' || !JSON_POINTER_REGEX.test(instance)) {
          this.addError(context, path, 'Expected JSON pointer format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'object':
        this.validateObject(context, instance, schema, path);
        break;

      case 'array':
        this.validateArray(context, instance, schema, path);
        break;

      case 'set':
        this.validateSet(context, instance, schema, path);
        break;

      case 'map':
        this.validateMap(context, instance, schema, path);
        break;

      case 'tuple':
        this.validateTuple(context, instance, schema, path);
        break;

      case 'choice':
        this.validateChoice(context, instance, schema, path);
        break;

      default:
        this.addError(context, path, `Unknown type: ${type}`, ErrorCodes.INSTANCE_UNKNOWN_TYPE);
    }
  }

  private validateInt32(context: InstanceValidationContext, instance: JsonValue, path: string): void {
    if (typeof instance !== 'number' || !Number.isInteger(instance)) {
      this.addError(context, path, 'Expected integer', ErrorCodes.INSTANCE_TYPE_MISMATCH);
    } else if (instance < -2147483648 || instance > 2147483647) {
      this.addError(context, path, 'int32 value out of range', ErrorCodes.INSTANCE_VALUE_OUT_OF_RANGE);
    }
  }

  private validateIntRange(context: InstanceValidationContext, instance: JsonValue, min: number, max: number, type: string, path: string): void {
    if (typeof instance !== 'number' || !Number.isInteger(instance)) {
      this.addError(context, path, `Expected ${type}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
    } else if (instance < min || instance > max) {
      this.addError(context, path, `${type} value out of range`, ErrorCodes.INSTANCE_VALUE_OUT_OF_RANGE);
    }
  }

  private validateStringInt(context: InstanceValidationContext, instance: JsonValue, min: bigint, max: bigint, type: string, path: string): void {
    if (typeof instance !== 'string') {
      this.addError(context, path, `Expected ${type} as string`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }
    try {
      const value = BigInt(instance);
      if (value < min || value > max) {
        this.addError(context, path, `${type} value out of range`, ErrorCodes.INSTANCE_VALUE_OUT_OF_RANGE);
      }
    } catch {
      this.addError(context, path, `Invalid ${type} format`, ErrorCodes.INSTANCE_FORMAT_INVALID);
    }
  }

  private validateObject(context: InstanceValidationContext, instance: JsonValue, schema: JsonObject, path: string): void {
    if (!this.isObject(instance)) {
      this.addError(context, path, `Expected object, got ${Array.isArray(instance) ? 'array' : typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    const properties = schema.properties as JsonObject | undefined;
    const required = schema.required as string[] | undefined;
    const additionalProperties = schema.additionalProperties;

    // Validate required properties
    if (required && Array.isArray(required)) {
      for (const prop of required) {
        if (!(prop in instance)) {
          this.addError(context, path, `Missing required property: ${prop}`, ErrorCodes.INSTANCE_REQUIRED_PROPERTY_MISSING);
        }
      }
    }

    // Validate properties
    if (properties) {
      for (const [propName, propSchema] of Object.entries(properties)) {
        if (propName in instance) {
          if (this.isObject(propSchema)) {
            this.validateInstance(context, instance[propName], propSchema, `${path}/${propName}`);
          }
        }
      }
    }

    // Validate additionalProperties
    // $schema and $uses are reserved properties allowed in instances at root level
    const reservedInstanceProps = new Set(['$schema', '$uses']);
    if (additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        // Only allow reserved instance props at root level (path === '#')
        const isReservedAtRoot = path === '#' && reservedInstanceProps.has(key);
        if (properties && !(key in properties) && !isReservedAtRoot) {
          this.addError(context, path, `Additional property not allowed: ${key}`, ErrorCodes.INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED);
        }
      }
    } else if (this.isObject(additionalProperties)) {
      for (const key of Object.keys(instance)) {
        // Only allow reserved instance props at root level (path === '#')
        const isReservedAtRoot = path === '#' && reservedInstanceProps.has(key);
        if ((!properties || !(key in properties)) && !isReservedAtRoot) {
          this.validateInstance(context, instance[key], additionalProperties, `${path}/${key}`);
        }
      }
    }
  }

  private validateArray(context: InstanceValidationContext, instance: JsonValue, schema: JsonObject, path: string): void {
    if (!Array.isArray(instance)) {
      this.addError(context, path, `Expected array, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    const items = schema.items as JsonObject | undefined;
    if (items) {
      for (let i = 0; i < instance.length; i++) {
        this.validateInstance(context, instance[i], items, `${path}[${i}]`);
      }
    }
  }

  private validateSet(context: InstanceValidationContext, instance: JsonValue, schema: JsonObject, path: string): void {
    if (!Array.isArray(instance)) {
      this.addError(context, path, `Expected set (array), got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    // Check for duplicates
    const seen = new Set<string>();
    for (let i = 0; i < instance.length; i++) {
      const serialized = JSON.stringify(instance[i]);
      if (seen.has(serialized)) {
        this.addError(context, path, 'Set contains duplicate items', ErrorCodes.INSTANCE_SET_DUPLICATE_ITEM);
        break;
      }
      seen.add(serialized);
    }

    // Validate items
    const items = schema.items as JsonObject | undefined;
    if (items) {
      for (let i = 0; i < instance.length; i++) {
        this.validateInstance(context, instance[i], items, `${path}[${i}]`);
      }
    }
  }

  private validateMap(context: InstanceValidationContext, instance: JsonValue, schema: JsonObject, path: string): void {
    if (!this.isObject(instance)) {
      this.addError(context, path, `Expected map (object), got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    const entries = Object.entries(instance);
    const entryCount = entries.length;

    // minEntries validation
    if ('minEntries' in schema && typeof schema.minEntries === 'number') {
      if (entryCount < schema.minEntries) {
        this.addError(context, path, `Map has ${entryCount} entries, less than minEntries ${schema.minEntries}`, ErrorCodes.INSTANCE_MAP_MIN_ENTRIES);
      }
    }

    // maxEntries validation
    if ('maxEntries' in schema && typeof schema.maxEntries === 'number') {
      if (entryCount > schema.maxEntries) {
        this.addError(context, path, `Map has ${entryCount} entries, more than maxEntries ${schema.maxEntries}`, ErrorCodes.INSTANCE_MAP_MAX_ENTRIES);
      }
    }

    // keyNames validation
    if ('keyNames' in schema && this.isObject(schema.keyNames)) {
      const keyNamesSchema = schema.keyNames as JsonObject;
      for (const key of Object.keys(instance)) {
        // Validate the key against the keyNames schema
        if (!this.validateKeyName(key, keyNamesSchema, path)) {
          this.addError(context, path, `Map key '${key}' does not match keyNames constraint`, ErrorCodes.INSTANCE_MAP_KEY_INVALID);
        }
      }
    }

    // patternKeys validation
    if ('patternKeys' in schema && this.isObject(schema.patternKeys)) {
      const patternKeys = schema.patternKeys as JsonObject;
      const pattern = patternKeys.pattern as string | undefined;
      if (pattern) {
        const regex = new RegExp(pattern);
        for (const key of Object.keys(instance)) {
          if (!regex.test(key)) {
            this.addError(context, path, `Map key '${key}' does not match patternKeys pattern '${pattern}'`, ErrorCodes.INSTANCE_MAP_KEY_INVALID);
          }
        }
      }
    }

    // Validate values
    const values = schema.values as JsonObject | undefined;
    if (values) {
      for (const [key, val] of entries) {
        this.validateInstance(context, val, values, `${path}/${key}`);
      }
    }
  }

  private validateKeyName(key: string, keyNamesSchema: JsonObject, _path: string): boolean {
    // Check type (must be string for map keys)
    const type = keyNamesSchema.type;
    if (type && type !== 'string') {
      return false;
    }

    // Check pattern
    if ('pattern' in keyNamesSchema && typeof keyNamesSchema.pattern === 'string') {
      const regex = new RegExp(keyNamesSchema.pattern);
      if (!regex.test(key)) {
        return false;
      }
    }

    // Check minLength
    if ('minLength' in keyNamesSchema && typeof keyNamesSchema.minLength === 'number') {
      if (key.length < keyNamesSchema.minLength) {
        return false;
      }
    }

    // Check maxLength
    if ('maxLength' in keyNamesSchema && typeof keyNamesSchema.maxLength === 'number') {
      if (key.length > keyNamesSchema.maxLength) {
        return false;
      }
    }

    // Check enum
    if ('enum' in keyNamesSchema && Array.isArray(keyNamesSchema.enum)) {
      if (!keyNamesSchema.enum.includes(key)) {
        return false;
      }
    }

    return true;
  }

  private validateTuple(context: InstanceValidationContext, instance: JsonValue, schema: JsonObject, path: string): void {
    if (!Array.isArray(instance)) {
      this.addError(context, path, `Expected tuple (array), got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    const tupleOrder = schema.tuple as string[] | undefined;
    const properties = schema.properties as JsonObject | undefined;

    if (!tupleOrder || !Array.isArray(tupleOrder)) {
      this.addError(context, path, "Tuple schema must have 'tuple' array", ErrorCodes.INSTANCE_SCHEMA_INVALID);
      return;
    }

    if (instance.length !== tupleOrder.length) {
      this.addError(context, path, `Tuple length mismatch: expected ${tupleOrder.length}, got ${instance.length}`, ErrorCodes.INSTANCE_TUPLE_LENGTH_MISMATCH);
      return;
    }

    if (properties) {
      for (let i = 0; i < tupleOrder.length; i++) {
        const propName = tupleOrder[i];
        const propSchema = properties[propName];
        if (this.isObject(propSchema)) {
          this.validateInstance(context, instance[i], propSchema, `${path}/${propName}`);
        }
      }
    }
  }

  private validateChoice(context: InstanceValidationContext, instance: JsonValue, schema: JsonObject, path: string): void {
    if (!this.isObject(instance)) {
      this.addError(context, path, `Expected choice (object), got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    const choices = schema.choices as JsonObject | undefined;
    const selector = schema.selector as string | undefined;
    const extendsRef = schema.$extends as string | undefined;

    if (!choices) {
      this.addError(context, path, "Choice schema must have 'choices'", ErrorCodes.INSTANCE_SCHEMA_INVALID);
      return;
    }

    if (extendsRef && selector) {
      // Inline union: use selector property
      const selectorValue = instance[selector];
      if (typeof selectorValue !== 'string') {
        this.addError(context, path, `Selector '${selector}' must be a string`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        return;
      }
      if (!(selectorValue in choices)) {
        this.addError(context, path, `Selector value '${selectorValue}' not in choices`, ErrorCodes.INSTANCE_CHOICE_NO_MATCH);
        return;
      }
      const choiceSchema = choices[selectorValue] as JsonObject;
      // Validate remaining properties against choice
      const remaining: JsonObject = { ...instance };
      delete remaining[selector];
      this.validateInstance(context, remaining, choiceSchema, path);
    } else {
      // Tagged union: exactly one property matching a choice key
      const keys = Object.keys(instance);
      if (keys.length !== 1) {
        this.addError(context, path, 'Tagged union must have exactly one property', ErrorCodes.INSTANCE_CHOICE_INVALID);
        return;
      }
      const key = keys[0];
      if (!(key in choices)) {
        this.addError(context, path, `Property '${key}' not in choices`, ErrorCodes.INSTANCE_CHOICE_NO_MATCH);
        return;
      }
      const choiceSchema = choices[key] as JsonObject;
      this.validateInstance(context, instance[key], choiceSchema, `${path}/${key}`);
    }
  }

  private validateConditionals(context: InstanceValidationContext, instance: JsonValue, schema: JsonObject, path: string): void {
    // allOf
    if ('allOf' in schema && Array.isArray(schema.allOf)) {
      for (let i = 0; i < schema.allOf.length; i++) {
        const subschema = schema.allOf[i];
        if (this.isObject(subschema)) {
          this.validateInstance(context, instance, subschema, `${path}/allOf[${i}]`);
        }
      }
    }

    // anyOf
    if ('anyOf' in schema && Array.isArray(schema.anyOf)) {
      let valid = false;
      const allErrors: ValidationError[] = [];
      for (let i = 0; i < schema.anyOf.length; i++) {
        const subschema = schema.anyOf[i];
        if (this.isObject(subschema)) {
          const tempErrors = [...context.errors];
          context.errors = [];
          this.validateInstance(context, instance, subschema, `${path}/anyOf[${i}]`);
          if (context.errors.length === 0) {
            valid = true;
            context.errors = tempErrors;
            break;
          }
          allErrors.push(...context.errors);
          context.errors = tempErrors;
        }
      }
      if (!valid) {
        this.addError(context, path, 'Instance does not satisfy anyOf', ErrorCodes.INSTANCE_ANYOF_NO_MATCH);
      }
    }

    // oneOf
    if ('oneOf' in schema && Array.isArray(schema.oneOf)) {
      let validCount = 0;
      for (let i = 0; i < schema.oneOf.length; i++) {
        const subschema = schema.oneOf[i];
        if (this.isObject(subschema)) {
          const tempErrors = [...context.errors];
          context.errors = [];
          this.validateInstance(context, instance, subschema, `${path}/oneOf[${i}]`);
          if (context.errors.length === 0) {
            validCount++;
          }
          context.errors = tempErrors;
        }
      }
      if (validCount !== 1) {
        this.addError(context, path, `Instance must match exactly one schema in oneOf, matched ${validCount}`, ErrorCodes.INSTANCE_ONEOF_MISMATCH);
      }
    }

    // not
    if ('not' in schema && this.isObject(schema.not)) {
      const tempErrors = [...context.errors];
      context.errors = [];
      this.validateInstance(context, instance, schema.not, `${path}/not`);
      if (context.errors.length === 0) {
        context.errors = tempErrors;
        this.addError(context, path, 'Instance must not match "not" schema', ErrorCodes.INSTANCE_NOT_FAILED);
      } else {
        context.errors = tempErrors;
      }
    }

    // if/then/else
    if ('if' in schema && this.isObject(schema.if)) {
      const tempErrors = [...context.errors];
      context.errors = [];
      this.validateInstance(context, instance, schema.if, `${path}/if`);
      const ifValid = context.errors.length === 0;
      context.errors = tempErrors;

      if (ifValid) {
        if ('then' in schema && this.isObject(schema.then)) {
          this.validateInstance(context, instance, schema.then, `${path}/then`);
        }
      } else {
        if ('else' in schema && this.isObject(schema.else)) {
          this.validateInstance(context, instance, schema.else, `${path}/else`);
        }
      }
    }
  }

  private validateValidationAddins(context: InstanceValidationContext, instance: JsonValue, type: string, schema: JsonObject, path: string): void {
    // String constraints
    if (type === 'string' && typeof instance === 'string') {
      if ('minLength' in schema && typeof schema.minLength === 'number') {
        if (instance.length < schema.minLength) {
          this.addError(context, path, `String length ${instance.length} is less than minLength ${schema.minLength}`, ErrorCodes.INSTANCE_STRING_MIN_LENGTH);
        }
      }
      if ('maxLength' in schema && typeof schema.maxLength === 'number') {
        if (instance.length > schema.maxLength) {
          this.addError(context, path, `String length ${instance.length} exceeds maxLength ${schema.maxLength}`, ErrorCodes.INSTANCE_STRING_MAX_LENGTH);
        }
      }
      if ('pattern' in schema && typeof schema.pattern === 'string') {
        try {
          const regex = new RegExp(schema.pattern);
          if (!regex.test(instance)) {
            this.addError(context, path, `String does not match pattern: ${schema.pattern}`, ErrorCodes.INSTANCE_STRING_PATTERN_MISMATCH);
          }
        } catch {
          // Invalid regex, skip
        }
      }
    }

    // Numeric constraints
    const numericTypes = [
      'number', 'integer', 'float', 'double', 'decimal', 'float8',
      'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
    ];
    if (numericTypes.includes(type) && typeof instance === 'number') {
      if ('minimum' in schema && typeof schema.minimum === 'number') {
        if (instance < schema.minimum) {
          this.addError(context, path, `Value ${instance} is less than minimum ${schema.minimum}`, ErrorCodes.INSTANCE_NUMBER_MINIMUM);
        }
      }
      if ('maximum' in schema && typeof schema.maximum === 'number') {
        if (instance > schema.maximum) {
          this.addError(context, path, `Value ${instance} exceeds maximum ${schema.maximum}`, ErrorCodes.INSTANCE_NUMBER_MAXIMUM);
        }
      }
      if ('exclusiveMinimum' in schema && typeof schema.exclusiveMinimum === 'number') {
        if (instance <= schema.exclusiveMinimum) {
          this.addError(context, path, `Value ${instance} is not greater than exclusiveMinimum ${schema.exclusiveMinimum}`, ErrorCodes.INSTANCE_NUMBER_EXCLUSIVE_MINIMUM);
        }
      }
      if ('exclusiveMaximum' in schema && typeof schema.exclusiveMaximum === 'number') {
        if (instance >= schema.exclusiveMaximum) {
          this.addError(context, path, `Value ${instance} is not less than exclusiveMaximum ${schema.exclusiveMaximum}`, ErrorCodes.INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM);
        }
      }
      if ('multipleOf' in schema && typeof schema.multipleOf === 'number') {
        if (Math.abs(instance % schema.multipleOf) > 1e-10) {
          this.addError(context, path, `Value ${instance} is not a multiple of ${schema.multipleOf}`, ErrorCodes.INSTANCE_NUMBER_MULTIPLE_OF);
        }
      }
    }

    // Array constraints
    if ((type === 'array' || type === 'set') && Array.isArray(instance)) {
      if ('minItems' in schema && typeof schema.minItems === 'number') {
        if (instance.length < schema.minItems) {
          this.addError(context, path, `Array has ${instance.length} items, less than minItems ${schema.minItems}`, ErrorCodes.INSTANCE_MIN_ITEMS);
        }
      }
      if ('maxItems' in schema && typeof schema.maxItems === 'number') {
        if (instance.length > schema.maxItems) {
          this.addError(context, path, `Array has ${instance.length} items, more than maxItems ${schema.maxItems}`, ErrorCodes.INSTANCE_MAX_ITEMS);
        }
      }
      if ('uniqueItems' in schema && schema.uniqueItems === true) {
        const seen = new Set<string>();
        for (const item of instance) {
          const serialized = JSON.stringify(item);
          if (seen.has(serialized)) {
            this.addError(context, path, 'Array items are not unique', ErrorCodes.INSTANCE_SET_DUPLICATE);
            break;
          }
          seen.add(serialized);
        }
      }

      // Validate contains
      if ('contains' in schema && this.isObject(schema.contains)) {
        let containsCount = 0;
        const savedErrors = [...context.errors];
        for (const item of instance) {
          context.errors = [];
          this.validateInstance(context, item, schema.contains as JsonObject, path);
          if (context.errors.length === 0) {
            containsCount++;
          }
        }
        context.errors = savedErrors;

        const minContains = typeof schema.minContains === 'number' ? schema.minContains : 1;
        const maxContains = typeof schema.maxContains === 'number' ? schema.maxContains : Infinity;

        if (containsCount < minContains) {
          this.addError(context, path, `Array must contain at least ${minContains} matching items (found ${containsCount})`, ErrorCodes.INSTANCE_MIN_CONTAINS);
        }
        if (containsCount > maxContains) {
          this.addError(context, path, `Array must contain at most ${maxContains} matching items (found ${containsCount})`, ErrorCodes.INSTANCE_MAX_CONTAINS);
        }
      }
    }

    // Object constraints
    if (type === 'object' && this.isObject(instance)) {
      if ('minProperties' in schema && typeof schema.minProperties === 'number') {
        const count = Object.keys(instance).length;
        if (count < schema.minProperties) {
          this.addError(context, path, `Object has ${count} properties, less than minProperties ${schema.minProperties}`, ErrorCodes.INSTANCE_MIN_PROPERTIES);
        }
      }
      if ('maxProperties' in schema && typeof schema.maxProperties === 'number') {
        const count = Object.keys(instance).length;
        if (count > schema.maxProperties) {
          this.addError(context, path, `Object has ${count} properties, more than maxProperties ${schema.maxProperties}`, ErrorCodes.INSTANCE_MAX_PROPERTIES);
        }
      }

      // Validate dependentRequired
      if ('dependentRequired' in schema && this.isObject(schema.dependentRequired)) {
        for (const [prop, requiredProps] of Object.entries(schema.dependentRequired)) {
          if (prop in instance && Array.isArray(requiredProps)) {
            for (const reqProp of requiredProps) {
              if (typeof reqProp === 'string' && !(reqProp in instance)) {
                this.addError(context, path, `Property '${prop}' requires property '${reqProp}'`, ErrorCodes.INSTANCE_DEPENDENT_REQUIRED);
              }
            }
          }
        }
      }
    }
  }

  private resolveRef(context: InstanceValidationContext, ref: string): JsonObject | null {
    if (!context.rootSchema || !ref.startsWith('#/')) {
      return null;
    }

    const parts = ref.substring(2).split('/');
    let current: JsonValue = context.rootSchema;

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

  private deepEqual(a: JsonValue, b: JsonValue): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private getLocation(context: InstanceValidationContext, path: string): JsonLocation {
    if (context.sourceLocator) {
      return context.sourceLocator.getLocation(path);
    }
    return UNKNOWN_LOCATION;
  }

  private addError(context: InstanceValidationContext, path: string, message: string, code: string = 'INSTANCE_ERROR'): void {
    const location = this.getLocation(context, path);
    context.errors.push({ code, message, path, severity: 'error', location });
  }
}
