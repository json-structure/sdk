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
 * Validates JSON instances against JSON Structure schemas.
 */
export class InstanceValidator {
  private readonly options: InstanceValidatorOptions;
  private errors: ValidationError[] = [];
  private rootSchema: JsonObject | null = null;
  private enabledExtensions: Set<string> = new Set();
  private sourceLocator: JsonSourceLocator | null = null;

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
    this.errors = [];
    this.enabledExtensions = new Set();
    
    // Initialize source locator if JSON string is provided
    if (instanceJson) {
      this.sourceLocator = new JsonSourceLocator(instanceJson);
    } else {
      this.sourceLocator = null;
    }

    if (!this.isObject(schema)) {
      this.addError('#', 'Schema must be an object', ErrorCodes.INSTANCE_SCHEMA_INVALID);
      return this.result();
    }

    this.rootSchema = schema;
    this.detectEnabledExtensions();

    // Handle $root
    let targetSchema: JsonObject = schema;
    if ('$root' in schema && typeof schema.$root === 'string') {
      const rootRef = schema.$root;
      if (rootRef.startsWith('#/')) {
        const resolved = this.resolveRef(rootRef);
        if (resolved === null) {
          this.addError('#', `Cannot resolve $root reference: ${rootRef}`, ErrorCodes.INSTANCE_ROOT_REF_INVALID);
          return this.result();
        }
        targetSchema = resolved;
      }
    }

    this.validateInstance(instance, targetSchema, '#');

    return this.result();
  }

  private detectEnabledExtensions(): void {
    if (!this.rootSchema) return;

    const schemaUri = this.rootSchema.$schema;
    const uses = this.rootSchema.$uses;

    // Check schema URI for extended/validation metaschema
    if (typeof schemaUri === 'string') {
      if (schemaUri.includes('extended') || schemaUri.includes('validation')) {
        this.enabledExtensions.add('JSONStructureConditionalComposition');
        this.enabledExtensions.add('JSONStructureValidation');
      }
    }

    // Check $uses
    if (Array.isArray(uses)) {
      for (const ext of uses) {
        if (typeof ext === 'string') {
          this.enabledExtensions.add(ext);
        }
      }
    }

    // If extended=true option, enable all validation extensions
    if (this.options.extended) {
      this.enabledExtensions.add('JSONStructureConditionalComposition');
      this.enabledExtensions.add('JSONStructureValidation');
    }
  }

  private validateInstance(instance: JsonValue, schema: JsonObject, path: string): void {
    // Handle $ref
    if ('$ref' in schema && typeof schema.$ref === 'string') {
      const resolved = this.resolveRef(schema.$ref);
      if (resolved === null) {
        this.addError(path, `Cannot resolve $ref: ${schema.$ref}`, ErrorCodes.INSTANCE_REF_RESOLUTION_FAILED);
        return;
      }
      this.validateInstance(instance, resolved, path);
      return;
    }

    // Handle type with $ref
    const type = schema.type;
    if (this.isObject(type) && '$ref' in type) {
      const resolved = this.resolveRef(type.$ref as string);
      if (resolved === null) {
        this.addError(path, `Cannot resolve type $ref: ${type.$ref}`, ErrorCodes.INSTANCE_REF_RESOLUTION_FAILED);
        return;
      }
      // Merge the resolved type with the current schema
      const merged: JsonObject = { ...resolved, ...schema };
      merged.type = resolved.type;
      if ('properties' in resolved || 'properties' in schema) {
        merged.properties = { ...(resolved.properties as JsonObject || {}), ...(schema.properties as JsonObject || {}) };
      }
      this.validateInstance(instance, merged, path);
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
          const base = this.resolveRef(ref);
          if (base === null) {
            this.addError(path, `Cannot resolve $extends: ${ref}`, ErrorCodes.INSTANCE_EXTENDS_RESOLUTION_FAILED);
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
        
        this.validateInstance(instance, merged, path);
        return;
      }
    }

    // Handle union types
    if (Array.isArray(type)) {
      let valid = false;
      for (const t of type) {
        const tempErrors = [...this.errors];
        this.errors = [];
        this.validateInstance(instance, { ...schema, type: t }, path);
        if (this.errors.length === 0) {
          valid = true;
          this.errors = tempErrors;
          break;
        }
        this.errors = tempErrors;
      }
      if (!valid) {
        this.addError(path, `Instance does not match any type in union`, ErrorCodes.INSTANCE_UNION_NO_MATCH);
      }
      return;
    }

    // Type is required unless this is a constraint-only schema
    if (typeof type !== 'string') {
      // Check for conditional-only schema
      const conditionalKeywords = ['allOf', 'anyOf', 'oneOf', 'not', 'if'];
      if (conditionalKeywords.some(k => k in schema)) {
        this.validateConditionals(instance, schema, path);
        return;
      }
      
      // Check for enum or const only (valid type-less schemas)
      if ('enum' in schema || 'const' in schema) {
        // Validate enum
        if ('enum' in schema && Array.isArray(schema.enum)) {
          if (!schema.enum.some(e => this.deepEqual(instance, e))) {
            this.addError(path, `Value must be one of: ${JSON.stringify(schema.enum)}`, ErrorCodes.INSTANCE_ENUM_MISMATCH);
          }
        }
        // Validate const
        if ('const' in schema) {
          if (!this.deepEqual(instance, schema.const)) {
            this.addError(path, `Value must equal const: ${JSON.stringify(schema.const)}`, ErrorCodes.INSTANCE_CONST_MISMATCH);
          }
        }
        return;
      }
      
      this.addError(path, "Schema must have a 'type' property", ErrorCodes.INSTANCE_SCHEMA_MISSING_TYPE);
      return;
    }

    // Validate abstract
    if (schema.abstract === true) {
      this.addError(path, 'Cannot validate instance against abstract schema', ErrorCodes.INSTANCE_ABSTRACT_SCHEMA);
      return;
    }

    // Validate by type
    this.validateByType(instance, type, schema, path);

    // Validate const
    if ('const' in schema) {
      if (!this.deepEqual(instance, schema.const)) {
        this.addError(path, `Value must equal const: ${JSON.stringify(schema.const)}`, ErrorCodes.INSTANCE_CONST_MISMATCH);
      }
    }

    // Validate enum
    if ('enum' in schema && Array.isArray(schema.enum)) {
      if (!schema.enum.some(e => this.deepEqual(instance, e))) {
        this.addError(path, `Value must be one of: ${JSON.stringify(schema.enum)}`, ErrorCodes.INSTANCE_ENUM_MISMATCH);
      }
    }

    // Validate conditionals if enabled
    if (this.enabledExtensions.has('JSONStructureConditionalComposition')) {
      this.validateConditionals(instance, schema, path);
    }

    // Validate validation addins if enabled
    if (this.enabledExtensions.has('JSONStructureValidation')) {
      this.validateValidationAddins(instance, type, schema, path);
    }
  }

  private validateByType(instance: JsonValue, type: string, schema: JsonObject, path: string): void {
    switch (type) {
      case 'any':
        // Any type accepts all values
        break;

      case 'null':
        if (instance !== null) {
          this.addError(path, `Expected null, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'boolean':
        if (typeof instance !== 'boolean') {
          this.addError(path, `Expected boolean, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'string':
        if (typeof instance !== 'string') {
          this.addError(path, `Expected string, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'number':
        if (typeof instance !== 'number' || typeof instance === 'boolean') {
          this.addError(path, `Expected number, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'integer':
      case 'int32':
        this.validateInt32(instance, path);
        break;

      case 'int8':
        this.validateIntRange(instance, -128, 127, 'int8', path);
        break;

      case 'uint8':
        this.validateIntRange(instance, 0, 255, 'uint8', path);
        break;

      case 'int16':
        this.validateIntRange(instance, -32768, 32767, 'int16', path);
        break;

      case 'uint16':
        this.validateIntRange(instance, 0, 65535, 'uint16', path);
        break;

      case 'uint32':
        this.validateIntRange(instance, 0, 4294967295, 'uint32', path);
        break;

      case 'int64':
        this.validateStringInt(instance, -(2n ** 63n), 2n ** 63n - 1n, 'int64', path);
        break;

      case 'uint64':
        this.validateStringInt(instance, 0n, 2n ** 64n - 1n, 'uint64', path);
        break;

      case 'int128':
        this.validateStringInt(instance, -(2n ** 127n), 2n ** 127n - 1n, 'int128', path);
        break;

      case 'uint128':
        this.validateStringInt(instance, 0n, 2n ** 128n - 1n, 'uint128', path);
        break;

      case 'float':
      case 'float8':
      case 'double':
        if (typeof instance !== 'number') {
          this.addError(path, `Expected ${type}, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'decimal':
        if (typeof instance !== 'string') {
          this.addError(path, `Expected decimal as string, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        } else if (isNaN(parseFloat(instance))) {
          this.addError(path, 'Invalid decimal format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'date':
        if (typeof instance !== 'string' || !DATE_REGEX.test(instance)) {
          this.addError(path, 'Expected date in YYYY-MM-DD format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'datetime':
        if (typeof instance !== 'string' || !DATETIME_REGEX.test(instance)) {
          this.addError(path, 'Expected datetime in RFC3339 format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'time':
        if (typeof instance !== 'string' || !TIME_REGEX.test(instance)) {
          this.addError(path, 'Expected time in HH:MM:SS format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'duration':
        if (typeof instance !== 'string') {
          this.addError(path, 'Expected duration as string', ErrorCodes.INSTANCE_TYPE_MISMATCH);
        } else if (!DURATION_REGEX.test(instance)) {
          this.addError(path, 'Expected duration in ISO 8601 format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'uuid':
        if (typeof instance !== 'string') {
          this.addError(path, 'Expected uuid as string', ErrorCodes.INSTANCE_TYPE_MISMATCH);
        } else if (!UUID_REGEX.test(instance)) {
          this.addError(path, 'Invalid uuid format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'uri':
        if (typeof instance !== 'string') {
          this.addError(path, 'Expected uri as string', ErrorCodes.INSTANCE_TYPE_MISMATCH);
        } else {
          try {
            new URL(instance);
          } catch {
            this.addError(path, 'Invalid uri format', ErrorCodes.INSTANCE_FORMAT_INVALID);
          }
        }
        break;

      case 'binary':
        if (typeof instance !== 'string') {
          this.addError(path, 'Expected binary as base64 string', ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        break;

      case 'jsonpointer':
        if (typeof instance !== 'string' || !JSON_POINTER_REGEX.test(instance)) {
          this.addError(path, 'Expected JSON pointer format', ErrorCodes.INSTANCE_FORMAT_INVALID);
        }
        break;

      case 'object':
        this.validateObject(instance, schema, path);
        break;

      case 'array':
        this.validateArray(instance, schema, path);
        break;

      case 'set':
        this.validateSet(instance, schema, path);
        break;

      case 'map':
        this.validateMap(instance, schema, path);
        break;

      case 'tuple':
        this.validateTuple(instance, schema, path);
        break;

      case 'choice':
        this.validateChoice(instance, schema, path);
        break;

      default:
        this.addError(path, `Unknown type: ${type}`, ErrorCodes.INSTANCE_UNKNOWN_TYPE);
    }
  }

  private validateInt32(instance: JsonValue, path: string): void {
    if (typeof instance !== 'number' || !Number.isInteger(instance)) {
      this.addError(path, 'Expected integer', ErrorCodes.INSTANCE_TYPE_MISMATCH);
    } else if (instance < -2147483648 || instance > 2147483647) {
      this.addError(path, 'int32 value out of range', ErrorCodes.INSTANCE_VALUE_OUT_OF_RANGE);
    }
  }

  private validateIntRange(instance: JsonValue, min: number, max: number, type: string, path: string): void {
    if (typeof instance !== 'number' || !Number.isInteger(instance)) {
      this.addError(path, `Expected ${type}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
    } else if (instance < min || instance > max) {
      this.addError(path, `${type} value out of range`, ErrorCodes.INSTANCE_VALUE_OUT_OF_RANGE);
    }
  }

  private validateStringInt(instance: JsonValue, min: bigint, max: bigint, type: string, path: string): void {
    if (typeof instance !== 'string') {
      this.addError(path, `Expected ${type} as string`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }
    try {
      const value = BigInt(instance);
      if (value < min || value > max) {
        this.addError(path, `${type} value out of range`, ErrorCodes.INSTANCE_VALUE_OUT_OF_RANGE);
      }
    } catch {
      this.addError(path, `Invalid ${type} format`, ErrorCodes.INSTANCE_FORMAT_INVALID);
    }
  }

  private validateObject(instance: JsonValue, schema: JsonObject, path: string): void {
    if (!this.isObject(instance)) {
      this.addError(path, `Expected object, got ${Array.isArray(instance) ? 'array' : typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    const properties = schema.properties as JsonObject | undefined;
    const required = schema.required as string[] | undefined;
    const additionalProperties = schema.additionalProperties;

    // Validate required properties
    if (required && Array.isArray(required)) {
      for (const prop of required) {
        if (!(prop in instance)) {
          this.addError(path, `Missing required property: ${prop}`, ErrorCodes.INSTANCE_REQUIRED_PROPERTY_MISSING);
        }
      }
    }

    // Validate properties
    if (properties) {
      for (const [propName, propSchema] of Object.entries(properties)) {
        if (propName in instance) {
          if (this.isObject(propSchema)) {
            this.validateInstance(instance[propName], propSchema, `${path}/${propName}`);
          }
        }
      }
    }

    // Validate additionalProperties
    if (additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        if (properties && !(key in properties)) {
          this.addError(path, `Additional property not allowed: ${key}`, ErrorCodes.INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED);
        }
      }
    } else if (this.isObject(additionalProperties)) {
      for (const key of Object.keys(instance)) {
        if (!properties || !(key in properties)) {
          this.validateInstance(instance[key], additionalProperties, `${path}/${key}`);
        }
      }
    }
  }

  private validateArray(instance: JsonValue, schema: JsonObject, path: string): void {
    if (!Array.isArray(instance)) {
      this.addError(path, `Expected array, got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    const items = schema.items as JsonObject | undefined;
    if (items) {
      for (let i = 0; i < instance.length; i++) {
        this.validateInstance(instance[i], items, `${path}[${i}]`);
      }
    }
  }

  private validateSet(instance: JsonValue, schema: JsonObject, path: string): void {
    if (!Array.isArray(instance)) {
      this.addError(path, `Expected set (array), got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    // Check for duplicates
    const seen = new Set<string>();
    for (let i = 0; i < instance.length; i++) {
      const serialized = JSON.stringify(instance[i]);
      if (seen.has(serialized)) {
        this.addError(path, 'Set contains duplicate items', ErrorCodes.INSTANCE_SET_DUPLICATE_ITEM);
        break;
      }
      seen.add(serialized);
    }

    // Validate items
    const items = schema.items as JsonObject | undefined;
    if (items) {
      for (let i = 0; i < instance.length; i++) {
        this.validateInstance(instance[i], items, `${path}[${i}]`);
      }
    }
  }

  private validateMap(instance: JsonValue, schema: JsonObject, path: string): void {
    if (!this.isObject(instance)) {
      this.addError(path, `Expected map (object), got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    const values = schema.values as JsonObject | undefined;
    if (values) {
      for (const [key, val] of Object.entries(instance)) {
        this.validateInstance(val, values, `${path}/${key}`);
      }
    }
  }

  private validateTuple(instance: JsonValue, schema: JsonObject, path: string): void {
    if (!Array.isArray(instance)) {
      this.addError(path, `Expected tuple (array), got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    const tupleOrder = schema.tuple as string[] | undefined;
    const properties = schema.properties as JsonObject | undefined;

    if (!tupleOrder || !Array.isArray(tupleOrder)) {
      this.addError(path, "Tuple schema must have 'tuple' array", ErrorCodes.INSTANCE_SCHEMA_INVALID);
      return;
    }

    if (instance.length !== tupleOrder.length) {
      this.addError(path, `Tuple length mismatch: expected ${tupleOrder.length}, got ${instance.length}`, ErrorCodes.INSTANCE_TUPLE_LENGTH_MISMATCH);
      return;
    }

    if (properties) {
      for (let i = 0; i < tupleOrder.length; i++) {
        const propName = tupleOrder[i];
        const propSchema = properties[propName];
        if (this.isObject(propSchema)) {
          this.validateInstance(instance[i], propSchema, `${path}/${propName}`);
        }
      }
    }
  }

  private validateChoice(instance: JsonValue, schema: JsonObject, path: string): void {
    if (!this.isObject(instance)) {
      this.addError(path, `Expected choice (object), got ${typeof instance}`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
      return;
    }

    const choices = schema.choices as JsonObject | undefined;
    const selector = schema.selector as string | undefined;
    const extendsRef = schema.$extends as string | undefined;

    if (!choices) {
      this.addError(path, "Choice schema must have 'choices'", ErrorCodes.INSTANCE_SCHEMA_INVALID);
      return;
    }

    if (extendsRef && selector) {
      // Inline union: use selector property
      const selectorValue = instance[selector];
      if (typeof selectorValue !== 'string') {
        this.addError(path, `Selector '${selector}' must be a string`, ErrorCodes.INSTANCE_TYPE_MISMATCH);
        return;
      }
      if (!(selectorValue in choices)) {
        this.addError(path, `Selector value '${selectorValue}' not in choices`, ErrorCodes.INSTANCE_CHOICE_NO_MATCH);
        return;
      }
      const choiceSchema = choices[selectorValue] as JsonObject;
      // Validate remaining properties against choice
      const remaining: JsonObject = { ...instance };
      delete remaining[selector];
      this.validateInstance(remaining, choiceSchema, path);
    } else {
      // Tagged union: exactly one property matching a choice key
      const keys = Object.keys(instance);
      if (keys.length !== 1) {
        this.addError(path, 'Tagged union must have exactly one property', ErrorCodes.INSTANCE_CHOICE_INVALID);
        return;
      }
      const key = keys[0];
      if (!(key in choices)) {
        this.addError(path, `Property '${key}' not in choices`, ErrorCodes.INSTANCE_CHOICE_NO_MATCH);
        return;
      }
      const choiceSchema = choices[key] as JsonObject;
      this.validateInstance(instance[key], choiceSchema, `${path}/${key}`);
    }
  }

  private validateConditionals(instance: JsonValue, schema: JsonObject, path: string): void {
    // allOf
    if ('allOf' in schema && Array.isArray(schema.allOf)) {
      for (let i = 0; i < schema.allOf.length; i++) {
        const subschema = schema.allOf[i];
        if (this.isObject(subschema)) {
          this.validateInstance(instance, subschema, `${path}/allOf[${i}]`);
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
          const tempErrors = [...this.errors];
          this.errors = [];
          this.validateInstance(instance, subschema, `${path}/anyOf[${i}]`);
          if (this.errors.length === 0) {
            valid = true;
            this.errors = tempErrors;
            break;
          }
          allErrors.push(...this.errors);
          this.errors = tempErrors;
        }
      }
      if (!valid) {
        this.addError(path, 'Instance does not satisfy anyOf', ErrorCodes.INSTANCE_ANYOF_NO_MATCH);
      }
    }

    // oneOf
    if ('oneOf' in schema && Array.isArray(schema.oneOf)) {
      let validCount = 0;
      for (let i = 0; i < schema.oneOf.length; i++) {
        const subschema = schema.oneOf[i];
        if (this.isObject(subschema)) {
          const tempErrors = [...this.errors];
          this.errors = [];
          this.validateInstance(instance, subschema, `${path}/oneOf[${i}]`);
          if (this.errors.length === 0) {
            validCount++;
          }
          this.errors = tempErrors;
        }
      }
      if (validCount !== 1) {
        this.addError(path, `Instance must match exactly one schema in oneOf, matched ${validCount}`, ErrorCodes.INSTANCE_ONEOF_MISMATCH);
      }
    }

    // not
    if ('not' in schema && this.isObject(schema.not)) {
      const tempErrors = [...this.errors];
      this.errors = [];
      this.validateInstance(instance, schema.not, `${path}/not`);
      if (this.errors.length === 0) {
        this.errors = tempErrors;
        this.addError(path, 'Instance must not match "not" schema', ErrorCodes.INSTANCE_NOT_FAILED);
      } else {
        this.errors = tempErrors;
      }
    }

    // if/then/else
    if ('if' in schema && this.isObject(schema.if)) {
      const tempErrors = [...this.errors];
      this.errors = [];
      this.validateInstance(instance, schema.if, `${path}/if`);
      const ifValid = this.errors.length === 0;
      this.errors = tempErrors;

      if (ifValid) {
        if ('then' in schema && this.isObject(schema.then)) {
          this.validateInstance(instance, schema.then, `${path}/then`);
        }
      } else {
        if ('else' in schema && this.isObject(schema.else)) {
          this.validateInstance(instance, schema.else, `${path}/else`);
        }
      }
    }
  }

  private validateValidationAddins(instance: JsonValue, type: string, schema: JsonObject, path: string): void {
    // String constraints
    if (type === 'string' && typeof instance === 'string') {
      if ('minLength' in schema && typeof schema.minLength === 'number') {
        if (instance.length < schema.minLength) {
          this.addError(path, `String length ${instance.length} is less than minLength ${schema.minLength}`, ErrorCodes.INSTANCE_STRING_TOO_SHORT);
        }
      }
      if ('maxLength' in schema && typeof schema.maxLength === 'number') {
        if (instance.length > schema.maxLength) {
          this.addError(path, `String length ${instance.length} exceeds maxLength ${schema.maxLength}`, ErrorCodes.INSTANCE_STRING_TOO_LONG);
        }
      }
      if ('pattern' in schema && typeof schema.pattern === 'string') {
        try {
          const regex = new RegExp(schema.pattern);
          if (!regex.test(instance)) {
            this.addError(path, `String does not match pattern: ${schema.pattern}`, ErrorCodes.INSTANCE_PATTERN_MISMATCH);
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
          this.addError(path, `Value ${instance} is less than minimum ${schema.minimum}`, ErrorCodes.INSTANCE_NUMBER_TOO_SMALL);
        }
      }
      if ('maximum' in schema && typeof schema.maximum === 'number') {
        if (instance > schema.maximum) {
          this.addError(path, `Value ${instance} exceeds maximum ${schema.maximum}`, ErrorCodes.INSTANCE_NUMBER_TOO_LARGE);
        }
      }
      if ('multipleOf' in schema && typeof schema.multipleOf === 'number') {
        if (Math.abs(instance % schema.multipleOf) > 1e-10) {
          this.addError(path, `Value ${instance} is not a multiple of ${schema.multipleOf}`, ErrorCodes.INSTANCE_NOT_MULTIPLE_OF);
        }
      }
    }

    // Array constraints
    if ((type === 'array' || type === 'set') && Array.isArray(instance)) {
      if ('minItems' in schema && typeof schema.minItems === 'number') {
        if (instance.length < schema.minItems) {
          this.addError(path, `Array has ${instance.length} items, less than minItems ${schema.minItems}`, ErrorCodes.INSTANCE_ARRAY_TOO_SHORT);
        }
      }
      if ('maxItems' in schema && typeof schema.maxItems === 'number') {
        if (instance.length > schema.maxItems) {
          this.addError(path, `Array has ${instance.length} items, more than maxItems ${schema.maxItems}`, ErrorCodes.INSTANCE_ARRAY_TOO_LONG);
        }
      }
      if ('uniqueItems' in schema && schema.uniqueItems === true) {
        const seen = new Set<string>();
        for (const item of instance) {
          const serialized = JSON.stringify(item);
          if (seen.has(serialized)) {
            this.addError(path, 'Array items are not unique', ErrorCodes.INSTANCE_SET_DUPLICATE_ITEM);
            break;
          }
          seen.add(serialized);
        }
      }
    }

    // Object constraints
    if (type === 'object' && this.isObject(instance)) {
      if ('minProperties' in schema && typeof schema.minProperties === 'number') {
        const count = Object.keys(instance).length;
        if (count < schema.minProperties) {
          this.addError(path, `Object has ${count} properties, less than minProperties ${schema.minProperties}`, ErrorCodes.INSTANCE_TOO_FEW_PROPERTIES);
        }
      }
      if ('maxProperties' in schema && typeof schema.maxProperties === 'number') {
        const count = Object.keys(instance).length;
        if (count > schema.maxProperties) {
          this.addError(path, `Object has ${count} properties, more than maxProperties ${schema.maxProperties}`, ErrorCodes.INSTANCE_TOO_MANY_PROPERTIES);
        }
      }
    }
  }

  private resolveRef(ref: string): JsonObject | null {
    if (!this.rootSchema || !ref.startsWith('#/')) {
      return null;
    }

    const parts = ref.substring(2).split('/');
    let current: JsonValue = this.rootSchema;

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

  private getLocation(path: string): JsonLocation {
    if (this.sourceLocator) {
      return this.sourceLocator.getLocation(path);
    }
    return UNKNOWN_LOCATION;
  }

  private addError(path: string, message: string, code: string = 'INSTANCE_ERROR'): void {
    const location = this.getLocation(path);
    this.errors.push({ code, message, path, severity: 'error', location });
  }

  private result(): ValidationResult {
    return {
      isValid: this.errors.length === 0,
      errors: [...this.errors],
      warnings: [],  // Instance validation doesn't generate warnings currently
    };
  }
}
