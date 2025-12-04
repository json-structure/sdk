import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';
import { SchemaValidator } from '../src/schema-validator';
import { InstanceValidator } from '../src/instance-validator';
import * as ErrorCodes from '../src/error-codes';

// Find the test-assets directory
function findTestAssetsDir(): string | null {
  const possiblePaths = [
    join(process.cwd(), '..', 'test-assets'),           // sdk/test-assets from sdk/typescript
    join(process.cwd(), 'test-assets'),                 // sdk/test-assets from sdk
    join(__dirname, '..', '..', '..', 'test-assets'),   // sdk/test-assets via __dirname
  ];

  for (const path of possiblePaths) {
    try {
      if (existsSync(path) && statSync(path).isDirectory()) {
        return resolve(path);
      }
    } catch {
      // Continue to next path
    }
  }

  return null;
}

// Find the primer-and-samples directory for sample schemas
function findSamplesDir(): string | null {
  const possiblePaths = [
    join(process.cwd(), '..', 'primer-and-samples', 'samples', 'core'),
    join(process.cwd(), 'primer-and-samples', 'samples', 'core'),
    join(__dirname, '..', '..', '..', 'primer-and-samples', 'samples', 'core'),
  ];

  for (const path of possiblePaths) {
    try {
      if (existsSync(path) && statSync(path).isDirectory()) {
        return resolve(path);
      }
    } catch {
      // Continue to next path
    }
  }

  return null;
}

function loadJson(filePath: string): any {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getFilesInDir(dir: string, extension: string): string[] {
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith(extension))
      .map(f => join(dir, f));
  } catch {
    return [];
  }
}

function getSubDirs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter(f => {
        const fullPath = join(dir, f);
        return statSync(fullPath).isDirectory();
      })
      .map(f => join(dir, f));
  } catch {
    return [];
  }
}

// Resolve JSON pointer
function resolveJsonPointer(pointer: string, doc: any): any {
  if (!pointer.startsWith('/')) {
    return null;
  }

  const parts = pointer.substring(1).split('/');
  let current = doc;

  for (const part of parts) {
    const unescaped = part.replace(/~1/g, '/').replace(/~0/g, '~');

    if (typeof current === 'object' && current !== null) {
      if (Array.isArray(current)) {
        const index = parseInt(unescaped, 10);
        if (isNaN(index) || index < 0 || index >= current.length) {
          return null;
        }
        current = current[index];
      } else {
        if (!(unescaped in current)) {
          return null;
        }
        current = current[unescaped];
      }
    } else {
      return null;
    }
  }

  return current;
}

describe('Test Assets Integration', () => {
  const testAssetsDir = findTestAssetsDir();
  const samplesDir = findSamplesDir();

  if (!testAssetsDir) {
    it.skip('test-assets directory not found', () => {});
    return;
  }

  const invalidSchemasDir = join(testAssetsDir, 'schemas', 'invalid');
  const warningSchemasDir = join(testAssetsDir, 'schemas', 'warnings');
  const validationSchemasDir = join(testAssetsDir, 'schemas', 'validation');
  const adversarialSchemasDir = join(testAssetsDir, 'schemas', 'adversarial');
  const invalidInstancesDir = join(testAssetsDir, 'instances', 'invalid');
  const validationInstancesDir = join(testAssetsDir, 'instances', 'validation');
  const adversarialInstancesDir = join(testAssetsDir, 'instances', 'adversarial');

  describe('Invalid Schema Tests', () => {
    const schemaFiles = getFilesInDir(invalidSchemasDir, '.struct.json');
    const schemaValidator = new SchemaValidator({ extended: true });

    if (schemaFiles.length === 0) {
      it.skip('No invalid schema files found', () => {});
      return;
    }

    for (const schemaFile of schemaFiles) {
      const testName = basename(schemaFile, '.struct.json');

      it(`${testName} should be invalid`, () => {
        const schema = loadJson(schemaFile);
        expect(schema).not.toBeNull();

        const result = schemaValidator.validate(schema);
        expect(result.isValid).toBe(false);
      });
    }
  });

  describe('Warning Schema Tests', () => {
    const schemaFiles = getFilesInDir(warningSchemasDir, '.struct.json');
    
    if (schemaFiles.length === 0) {
      it.skip('No warning schema files found', () => {});
      return;
    }

    for (const schemaFile of schemaFiles) {
      const testName = basename(schemaFile, '.struct.json');
      const hasUsesInName = testName.includes('with-uses');

      it(`${testName} should ${hasUsesInName ? 'not ' : ''}produce warnings`, () => {
        const schema = loadJson(schemaFile);
        expect(schema).not.toBeNull();

        const schemaValidator = new SchemaValidator({ extended: true, warnOnUnusedExtensionKeywords: true });
        const result = schemaValidator.validate(schema);
        expect(result.isValid).toBe(true);

        if (hasUsesInName) {
          // Schemas with $uses should NOT produce extension keyword warnings
          const extensionWarnings = result.warnings.filter(
            w => w.code === ErrorCodes.SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED
          );
          expect(extensionWarnings).toHaveLength(0);
        } else {
          // Schemas without $uses SHOULD produce extension keyword warnings
          expect(result.warnings.length).toBeGreaterThan(0);
          expect(result.warnings.some(w => w.code === ErrorCodes.SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED)).toBe(true);
        }
      });
    }
  });

  describe('Validation Instance Tests', () => {
    const instanceDirs = getSubDirs(validationInstancesDir);

    if (instanceDirs.length === 0) {
      it.skip('No validation instance directories found', () => {});
      return;
    }

    for (const instanceDir of instanceDirs) {
      const categoryName = basename(instanceDir);

      describe(categoryName, () => {
        // Find matching schema in validation schemas directory
        const schemaFile = join(validationSchemasDir, `${categoryName}.struct.json`);
        
        if (!existsSync(schemaFile)) {
          it.skip(`Schema not found for ${categoryName}`, () => {});
          return;
        }

        const schema = loadJson(schemaFile);
        if (!schema) {
          it.skip(`Could not load schema for ${categoryName}`, () => {});
          return;
        }

        const validator = new InstanceValidator({ extended: true });
        const instanceFiles = getFilesInDir(instanceDir, '.json');
        
        for (const instanceFile of instanceFiles) {
          const testName = basename(instanceFile, '.json');

          it(`${testName}`, () => {
            const instanceData = loadJson(instanceFile);
            expect(instanceData).not.toBeNull();

            // Extract expected result from metadata
            const expectedValid = instanceData._expectedValid === true;
            const expectedError = instanceData._expectedError;

            // Remove metadata before validation
            const cleanedData = { ...instanceData };
            delete cleanedData._description;
            delete cleanedData._expectedError;
            delete cleanedData._expectedValid;

            // If the schema expects a primitive type or array at root level and we have a { value: ... } wrapper,
            // extract the value for validation
            const schemaType = schema.type as string | undefined;
            const valueWrapperTypes = ['string', 'number', 'integer', 'boolean', 'int8', 'uint8', 'int16', 'uint16',
                                     'int32', 'uint32', 'float', 'double', 'decimal', 'float8', 'array', 'set'];
            const hasSingleValue = Object.keys(cleanedData).length === 1 && 'value' in cleanedData;
            const instance = (valueWrapperTypes.includes(schemaType || '') && hasSingleValue)
              ? cleanedData.value
              : cleanedData;

            const result = validator.validate(instance, schema);

            if (expectedValid) {
              expect(result.isValid).toBe(true);
            } else {
              expect(result.isValid).toBe(false);
              if (expectedError) {
                expect(result.errors.some(e => e.code === expectedError)).toBe(true);
              }
            }
          });
        }
      });
    }
  });

  describe('Invalid Instance Tests', () => {
    const instanceDirs = getSubDirs(invalidInstancesDir);

    if (instanceDirs.length === 0) {
      it.skip('No invalid instance directories found', () => {});
      return;
    }

    for (const instanceDir of instanceDirs) {
      const categoryName = basename(instanceDir);

      describe(categoryName, () => {
        // Find schema from samples
        if (!samplesDir) {
          it.skip('samples directory not found for schema', () => {});
          return;
        }

        // Try to find matching sample schema - look in the category subdirectory
        const sampleSchemaFile = join(samplesDir, categoryName, 'schema.struct.json');
        
        if (!existsSync(sampleSchemaFile)) {
          it.skip(`Schema not found for ${categoryName}`, () => {});
          return;
        }

        const schema = loadJson(sampleSchemaFile);
        if (!schema) {
          it.skip(`Could not load schema for ${categoryName}`, () => {});
          return;
        }

        // Check for extended features
        const needsExtended = hasExtendedKeywords(schema);
        const validator = new InstanceValidator({ extended: needsExtended });

        const instanceFiles = getFilesInDir(instanceDir, '.json');
        for (const instanceFile of instanceFiles) {
          const testName = basename(instanceFile, '.json');

          it(`${testName} should be invalid`, () => {
            const instance = loadJson(instanceFile);
            expect(instance).not.toBeNull();

            const result = validator.validate(instance, schema);
            expect(result.isValid).toBe(false);
          });
        }
      });
    }
  });

  // ==========================================================================
  // Adversarial Tests - stress test the validators
  // ==========================================================================

  describe('Adversarial Schema Tests', () => {
    const schemaFiles = getFilesInDir(adversarialSchemasDir, '.struct.json');
    const schemaValidator = new SchemaValidator({ extended: true });

    if (schemaFiles.length === 0) {
      it.skip('No adversarial schema files found', () => {});
      return;
    }

    // Schemas that are intentionally invalid and MUST fail schema validation
    const invalidSchemas = new Set([
      'ref-to-nowhere.struct.json',
      'malformed-json-pointer.struct.json',
      'self-referencing-extends.struct.json',
      'extends-circular-chain.struct.json',
    ]);

    for (const schemaFile of schemaFiles) {
      const fileName = basename(schemaFile);
      const testName = basename(schemaFile, '.struct.json');

      if (invalidSchemas.has(fileName)) {
        it(`${testName} should be invalid`, () => {
          const schema = loadJson(schemaFile);
          expect(schema).not.toBeNull();
          const result = schemaValidator.validate(schema);
          expect(result.isValid).toBe(false);
        });
      } else {
        it(`${testName} should validate without crashing`, () => {
          const schema = loadJson(schemaFile);
          expect(schema).not.toBeNull();
          const result = schemaValidator.validate(schema);
          expect(result).toBeDefined();
          expect(typeof result.isValid).toBe('boolean');
        });
      }
    }
  });

  describe('Adversarial Instance Tests', () => {
    const instanceFiles = getFilesInDir(adversarialInstancesDir, '.json');
    
    if (instanceFiles.length === 0) {
      it.skip('No adversarial instance files found', () => {});
      return;
    }

    // Map instance files to their corresponding schema
    const instanceSchemaMap: Record<string, string> = {
      'deep-nesting.json': 'deep-nesting-100.struct.json',
      'recursive-tree.json': 'recursive-array-items.struct.json',
      'property-name-edge-cases.json': 'property-name-edge-cases.struct.json',
      'unicode-edge-cases.json': 'unicode-edge-cases.struct.json',
      'string-length-surrogate.json': 'string-length-surrogate.struct.json',
      'int64-precision.json': 'int64-precision-loss.struct.json',
      'floating-point.json': 'floating-point-precision.struct.json',
      'null-edge-cases.json': 'null-edge-cases.struct.json',
      'empty-collections-invalid.json': 'empty-arrays-objects.struct.json',
      'redos-attack.json': 'redos-pattern.struct.json',
      'allof-conflict.json': 'allof-conflicting-types.struct.json',
      'oneof-all-match.json': 'oneof-all-match.struct.json',
      'type-union-int.json': 'type-union-ambiguous.struct.json',
      'type-union-number.json': 'type-union-ambiguous.struct.json',
      'conflicting-constraints.json': 'conflicting-constraints.struct.json',
      'format-invalid.json': 'format-edge-cases.struct.json',
      'format-valid.json': 'format-edge-cases.struct.json',
      'pattern-flags.json': 'pattern-with-flags.struct.json',
      'additionalProperties-combined.json': 'additionalProperties-combined.struct.json',
      'extends-override.json': 'extends-with-overrides.struct.json',
      'quadratic-blowup.json': 'quadratic-blowup.struct.json',
      'anyof-none-match.json': 'anyof-none-match.struct.json',
    };

    for (const instanceFile of instanceFiles) {
      const instanceName = basename(instanceFile);
      const testName = basename(instanceFile, '.json');
      const schemaName = instanceSchemaMap[instanceName];
      
      if (!schemaName) {
        it.skip(`${testName} - no schema mapping`, () => {});
        continue;
      }

      const schemaFile = join(adversarialSchemasDir, schemaName);
      if (!existsSync(schemaFile)) {
        it.skip(`${testName} - schema not found: ${schemaName}`, () => {});
        continue;
      }

      it(`${testName} should validate without crashing (timeout 5s)`, () => {
        const schema = loadJson(schemaFile);
        const instance = loadJson(instanceFile);
        expect(schema).not.toBeNull();
        expect(instance).not.toBeNull();

        // Remove $schema from instance before validation
        const cleanInstance = { ...instance };
        delete cleanInstance.$schema;

        const validator = new InstanceValidator({ extended: true });
        // Should complete without throwing or hanging
        const result = validator.validate(cleanInstance, schema);
        expect(result).toBeDefined();
        expect(typeof result.isValid).toBe('boolean');
      });
    }
  });
});

// Helper to check if schema uses extended validation keywords
function hasExtendedKeywords(obj: any): boolean {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const extendedKeywords = [
    'minLength', 'maxLength', 'pattern',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'minItems', 'maxItems', 'uniqueItems',
    'minProperties', 'maxProperties',
    'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
    '$extends',
  ];

  for (const key of Object.keys(obj)) {
    if (extendedKeywords.includes(key)) {
      return true;
    }
    if (hasExtendedKeywords(obj[key])) {
      return true;
    }
  }

  return false;
}
