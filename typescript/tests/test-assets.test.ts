import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';
import { SchemaValidator } from '../src/schema-validator';
import { InstanceValidator } from '../src/instance-validator';

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
  const invalidInstancesDir = join(testAssetsDir, 'instances', 'invalid');

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
