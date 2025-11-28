/**
 * TypeScript SDK - Error Codes Demo
 * 
 * This demo shows how error codes and source locations are included in validation errors.
 * 
 * Run with: npx tsx demo/error-codes-demo.ts
 */

import { SchemaValidator, InstanceValidator, ErrorCodes } from '../dist/index.mjs';

try {
console.log('=== JSON Structure TypeScript SDK - Error Codes Demo ===\n');

// Test 1: Instance validation errors with source location tracking
console.log('--- Instance Validation Errors ---\n');

const schemaJson = `{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/test",
    "name": "TestSchema",
    "type": "object",
    "properties": {
        "name": { "type": "string" },
        "age": { "type": "int32" }
    },
    "required": ["name", "age"]
}`;

const instanceJson = `{
    "name": 123,
    "extra": "property"
}`;

console.log('Instance JSON:');
const lines = instanceJson.split('\n');
lines.forEach((line, i) => console.log(`  Line ${i + 1}: ${line}`));
console.log();

// Parse both schema and instance
const schema = JSON.parse(schemaJson);
const instance = JSON.parse(instanceJson);

const instanceValidator = new InstanceValidator({});
// Pass parsed objects, with optional source string for location tracking
const instanceResult = instanceValidator.validate(instance, schema, instanceJson);

console.log(`Valid: ${instanceResult.isValid}\n`);
console.log('Errors with error codes and source location:');
console.log('-'.repeat(80));

for (const error of instanceResult.errors) {
    console.log(`  Error: ${error.message}`);
    console.log(`         → Code:     ${error.code}`);
    console.log(`         → Path:     ${error.path}`);
    if (error.location) {
        console.log(`         → Location: Line ${error.location.line}, Column ${error.location.column}`);
        
        // Show the actual line from the source
        if (error.location.line > 0 && error.location.line <= lines.length) {
            const sourceLine = lines[error.location.line - 1];
            console.log(`         → Source:   ${sourceLine}`);
            console.log(`                     ${' '.repeat(error.location.column - 1)}^`);
        }
    }
    console.log();
}

// Test 2: Schema validation errors
console.log('\n--- Schema Validation Errors ---\n');

const badSchemaJson = `{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/bad",
    "name": "BadSchema",
    "type": "object",
    "properties": {
        "count": { "type": "integer" }
    },
    "required": ["missing_property"]
}`;

console.log('Bad Schema:');
const schemaLines = badSchemaJson.split('\n');
schemaLines.forEach((line, i) => console.log(`  Line ${i + 1}: ${line}`));
console.log();

// Parse the schema first, then pass to validate with source string
const badSchema = JSON.parse(badSchemaJson);
const schemaValidator = new SchemaValidator({});
const schemaResult = schemaValidator.validate(badSchema, badSchemaJson);

console.log(`Valid: ${schemaResult.isValid}\n`);
console.log('Errors with error codes:');
console.log('-'.repeat(80));

for (const error of schemaResult.errors) {
    console.log(`  Error: ${error.message}`);
    console.log(`         → Code:     ${error.code}`);
    console.log(`         → Path:     ${error.path}`);
    if (error.location) {
        console.log(`         → Location: Line ${error.location.line}, Column ${error.location.column}`);
    }
    console.log();
}

// Test 3: Show available error codes
console.log('\n--- Available Error Codes (sample) ---\n');
console.log('Schema Error Codes:');
console.log(`  SCHEMA_NULL = "${ErrorCodes.SCHEMA_NULL}"`);
console.log(`  SCHEMA_INVALID_TYPE = "${ErrorCodes.SCHEMA_INVALID_TYPE}"`);
console.log(`  SCHEMA_REF_NOT_FOUND = "${ErrorCodes.SCHEMA_REF_NOT_FOUND}"`);
console.log(`  SCHEMA_MIN_GREATER_THAN_MAX = "${ErrorCodes.SCHEMA_MIN_GREATER_THAN_MAX}"`);

console.log('\nInstance Error Codes:');
console.log(`  INSTANCE_STRING_MIN_LENGTH = "${ErrorCodes.INSTANCE_STRING_MIN_LENGTH}"`);
console.log(`  INSTANCE_REQUIRED_PROPERTY_MISSING = "${ErrorCodes.INSTANCE_REQUIRED_PROPERTY_MISSING}"`);
console.log(`  INSTANCE_TYPE_MISMATCH = "${ErrorCodes.INSTANCE_TYPE_MISMATCH}"`);
console.log(`  INSTANCE_STRING_PATTERN_MISMATCH = "${ErrorCodes.INSTANCE_STRING_PATTERN_MISMATCH}"`);

console.log('\n=== Demo Complete ===');
} catch (error) {
    console.error('Error:', error);
    process.exit(1);
}