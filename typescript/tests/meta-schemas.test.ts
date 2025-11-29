import { describe, it, expect, beforeAll } from 'vitest';
import { SchemaValidator } from '../src/schema-validator';
import { JsonObject, JsonValue } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

describe('Meta Schema Validation', () => {
  let coreSchema: JsonObject;
  let extendedSchema: JsonObject;
  let validationSchema: JsonObject;
  let externalSchemas: Map<string, JsonValue>;

  beforeAll(() => {
    const metaDir = path.join(__dirname, '..', '..', 'meta');
    
    // Load all three metaschemas
    coreSchema = JSON.parse(
      fs.readFileSync(path.join(metaDir, 'core', 'v0', 'index.json'), 'utf-8')
    );
    extendedSchema = JSON.parse(
      fs.readFileSync(path.join(metaDir, 'extended', 'v0', 'index.json'), 'utf-8')
    );
    validationSchema = JSON.parse(
      fs.readFileSync(path.join(metaDir, 'validation', 'v0', 'index.json'), 'utf-8')
    );

    // Build external schemas map for import resolution
    externalSchemas = new Map<string, JsonValue>();
    externalSchemas.set(coreSchema.$id as string, coreSchema);
    externalSchemas.set(extendedSchema.$id as string, extendedSchema);
    externalSchemas.set(validationSchema.$id as string, validationSchema);
  });

  describe('core metaschema', () => {
    it('should validate without errors', () => {
      const validator = new SchemaValidator({
        allowDollar: true,
        allowImport: true,
        externalSchemas,
      });
      const result = validator.validate(coreSchema);
      
      if (!result.isValid) {
        console.log('Core metaschema validation errors:', result.errors);
      }
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should have expected definitions', () => {
      expect(coreSchema.definitions).toBeDefined();
      expect((coreSchema.definitions as JsonObject).SchemaDocument).toBeDefined();
      expect((coreSchema.definitions as JsonObject).ObjectType).toBeDefined();
      expect((coreSchema.definitions as JsonObject).Property).toBeDefined();
    });
  });

  describe('extended metaschema', () => {
    it('should validate without errors', () => {
      // Need to reload to get fresh copy since import processing modifies the schema
      const metaDir = path.join(__dirname, '..', '..', 'meta');
      const freshExtended = JSON.parse(
        fs.readFileSync(path.join(metaDir, 'extended', 'v0', 'index.json'), 'utf-8')
      );
      
      const validator = new SchemaValidator({
        allowDollar: true,
        allowImport: true,
        externalSchemas,
      });
      const result = validator.validate(freshExtended);
      
      if (!result.isValid) {
        console.log('Extended metaschema validation errors:', result.errors);
      }
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should import from core', () => {
      // Reload fresh copy to check the original $import
      const metaDir = path.join(__dirname, '..', '..', 'meta');
      const freshExtended = JSON.parse(
        fs.readFileSync(path.join(metaDir, 'extended', 'v0', 'index.json'), 'utf-8')
      );
      expect(freshExtended.$import).toBe('https://json-structure.org/meta/core/v0/#');
    });
  });

  describe('validation metaschema', () => {
    it('should validate without errors', () => {
      // Need to reload to get fresh copy since import processing modifies the schema
      const metaDir = path.join(__dirname, '..', '..', 'meta');
      const freshValidation = JSON.parse(
        fs.readFileSync(path.join(metaDir, 'validation', 'v0', 'index.json'), 'utf-8')
      );
      
      const validator = new SchemaValidator({
        allowDollar: true,
        allowImport: true,
        externalSchemas,
      });
      const result = validator.validate(freshValidation);
      
      if (!result.isValid) {
        console.log('Validation metaschema validation errors:', result.errors);
      }
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should import from extended', () => {
      // Reload fresh copy to check the original $import
      const metaDir = path.join(__dirname, '..', '..', 'meta');
      const freshValidation = JSON.parse(
        fs.readFileSync(path.join(metaDir, 'validation', 'v0', 'index.json'), 'utf-8')
      );
      expect(freshValidation.$import).toBe('https://json-structure.org/meta/extended/v0/#');
    });
  });
});
