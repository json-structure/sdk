# JSON Structure SDK Development Guidelines

This document provides comprehensive guidelines for developing JSON Structure SDKs for new programming languages. All SDKs must conform to the JSON Structure specifications and pass the standardized conformance tests.

## Table of Contents

- [Overview](#overview)
- [Specifications](#specifications)
- [Required Components](#required-components)
- [Type System](#type-system)
- [Keywords Reference](#keywords-reference)
- [Error Codes](#error-codes)
- [Test Assets](#test-assets)
- [Schema Exporter (Optional)](#schema-exporter-optional)
- [Conformance Checklist](#conformance-checklist)

---

## Overview

JSON Structure is a type-oriented schema language for JSON, designed for defining data structures that can be validated and mapped to programming language types. Each SDK implementation must provide:

1. **Schema Validator** - Validates JSON Structure schema documents for correctness
2. **Instance Validator** - Validates JSON instances against JSON Structure schemas
3. **Error Codes** - Standardized error codes matching `assets/error-messages.json`
4. **Source Location Tracking** - Line/column tracking for error messages
5. **Schema Exporter** (optional) - Generates schemas from native language types (only for languages with runtime introspection)

---

## Specifications

All SDKs must implement the following specifications:

### Core Specification (Required)

- **JSON Structure Core**: [draft-vasters-json-structure-core](https://json-structure.github.io/core/draft-vasters-json-structure-core.html)
  - Source: [`/core/draft-vasters-json-structure-core.md`](../core/draft-vasters-json-structure-core.md)
  - Defines types, keywords, and validation rules
  - Metaschema: `https://json-structure.org/meta/core/v0/#`

### Extension Specifications (Required Support)

Extensions must be explicitly enabled via `$uses` keyword:

| Extension | Specification | Metaschema |
|-----------|--------------|------------|
| **Import** | [JSON Structure Import](https://json-structure.github.io/import) | Enables `$import`, `$importdefs` |
| **Validation** | [JSON Structure Validation](https://json-structure.github.io/validation) | Enables constraint keywords |
| **Conditional Composition** | [JSON Structure Conditional Composition](https://json-structure.github.io/conditional-composition) | Enables `allOf`, `anyOf`, `oneOf`, `not`, `if/then/else` |
| **Alternate Names** | [JSON Structure Alternate Names](https://json-structure.github.io/alternate-names) | Enables `altnames` |
| **Units** | [JSON Structure Units](https://json-structure.github.io/units) | Enables `unit` |

---

## Required Components

### 1. Schema Validator

Validates that a JSON Structure schema document is syntactically and semantically correct.

**Required functionality:**
- Validate `$schema`, `$id`, `name` at root level
- Validate all type declarations against allowed types
- Validate `$ref` references resolve to valid definitions
- Validate keyword combinations are valid for declared types
- Validate constraint values are appropriate (e.g., `minimum` ≤ `maximum`)
- Support recursive schema validation with cycle detection
- Track and report source locations (line/column) for errors

**Reference implementations:**
- .NET: [`dotnet/src/JsonStructure/Validation/SchemaValidator.cs`](dotnet/src/JsonStructure/Validation/SchemaValidator.cs)
- Java: [`java/src/main/java/org/json_structure/validation/SchemaValidator.java`](java/src/main/java/org/json_structure/validation/SchemaValidator.java)
- Python: [`python/src/json_structure/schema_validator.py`](python/src/json_structure/schema_validator.py)
- TypeScript: [`typescript/src/schema-validator.ts`](typescript/src/schema-validator.ts)
- Go: [`go/schema_validator.go`](go/schema_validator.go)

### 2. Instance Validator

Validates JSON data instances against a JSON Structure schema.

**Required functionality:**
- Validate instances against all primitive types (see [Type System](#type-system))
- Validate instances against all compound types (`object`, `array`, `set`, `map`, `tuple`, `choice`)
- Validate `required` properties
- Validate `additionalProperties` constraints
- Validate type references (`$ref`)
- Validate `enum` and `const` constraints
- Support extension validation keywords when enabled via `$uses`
- Support conditional composition when enabled via `$uses`
- Track and report source locations (line/column) for errors

**Reference implementations:**
- .NET: [`dotnet/src/JsonStructure/Validation/InstanceValidator.cs`](dotnet/src/JsonStructure/Validation/InstanceValidator.cs)
- Java: [`java/src/main/java/org/json_structure/validation/InstanceValidator.java`](java/src/main/java/org/json_structure/validation/InstanceValidator.java)
- Python: [`python/src/json_structure/instance_validator.py`](python/src/json_structure/instance_validator.py)
- TypeScript: [`typescript/src/instance-validator.ts`](typescript/src/instance-validator.ts)
- Go: [`go/instance_validator.go`](go/instance_validator.go)

### 3. JSON Source Locator

Provides line/column tracking for error messages.

**Required functionality:**
- Parse JSON and track positions of all nodes
- Map JSON Pointer paths to source locations
- Handle nested objects and arrays
- Return `(0, 0)` for unknown locations

**Reference implementations:**
- .NET: [`dotnet/src/JsonStructure/Validation/JsonSourceLocator.cs`](dotnet/src/JsonStructure/Validation/JsonSourceLocator.cs)
- Java: [`java/src/main/java/org/json_structure/validation/JsonSourceLocator.java`](java/src/main/java/org/json_structure/validation/JsonSourceLocator.java)
- Python: [`python/src/json_structure/json_source_locator.py`](python/src/json_structure/json_source_locator.py)
- TypeScript: [`typescript/src/json-source-locator.ts`](typescript/src/json-source-locator.ts)
- Go: [`go/json_source_locator.go`](go/json_source_locator.go)

### 4. Error Codes

Standardized error codes for consistent error reporting across all SDKs.

**Reference file:** [`assets/error-messages.json`](assets/error-messages.json)

**Required implementation:**
- Define constants for all error codes in `error-messages.json`
- Use exact code strings (e.g., `"SCHEMA_TYPE_INVALID"`)
- Support both `error` and `warning` severity levels
- Include all parameters defined in the message templates

**Reference implementations:**
- .NET: [`dotnet/src/JsonStructure/Validation/ErrorCodes.cs`](dotnet/src/JsonStructure/Validation/ErrorCodes.cs)
- Java: [`java/src/main/java/org/json_structure/validation/ErrorCodes.java`](java/src/main/java/org/json_structure/validation/ErrorCodes.java)
- Python: [`python/src/json_structure/error_codes.py`](python/src/json_structure/error_codes.py)
- TypeScript: [`typescript/src/error-codes.ts`](typescript/src/error-codes.ts)
- Go: [`go/error_codes.go`](go/error_codes.go)

---

## Type System

### Primitive Types (Required)

All SDKs must support these primitive types from the JSON Structure Core specification:

#### Basic JSON Types
| Type | JSON Representation | Description |
|------|---------------------|-------------|
| `string` | JSON string | UTF-8 string |
| `boolean` | JSON boolean | `true` or `false` |
| `null` | JSON null | Null value |

#### Numeric Types
| Type | JSON Representation | Range/Description |
|------|---------------------|-------------------|
| `number` | JSON number | Any JSON number |
| `integer` | JSON number | Alias for `int32` |
| `int8` | JSON number | -128 to 127 |
| `int16` | JSON number | -32,768 to 32,767 |
| `int32` | JSON number | -2³¹ to 2³¹-1 |
| `int64` | JSON number | -2⁶³ to 2⁶³-1 |
| `int128` | JSON number/string | -2¹²⁷ to 2¹²⁷-1 |
| `uint8` | JSON number | 0 to 255 |
| `uint16` | JSON number | 0 to 65,535 |
| `uint32` | JSON number | 0 to 2³²-1 |
| `uint64` | JSON number | 0 to 2⁶⁴-1 |
| `uint128` | JSON number/string | 0 to 2¹²⁸-1 |
| `float` | JSON number | 32-bit IEEE 754 |
| `float8` | JSON number | 8-bit float |
| `double` | JSON number | 64-bit IEEE 754 |
| `decimal` | JSON number/string | Arbitrary precision |

#### Date/Time Types
| Type | Format (RFC 3339) | Example |
|------|-------------------|---------|
| `date` | `YYYY-MM-DD` | `"2024-01-15"` |
| `time` | `HH:MM:SS[.sss]` | `"14:30:00"` |
| `datetime` | `YYYY-MM-DDTHH:MM:SS[.sss]Z` | `"2024-01-15T14:30:00Z"` |
| `duration` | ISO 8601 duration | `"P1Y2M3D"` or `"PT1H30M"` |

#### Other Primitive Types
| Type | Format | Description |
|------|--------|-------------|
| `uuid` | RFC 9562 | `"550e8400-e29b-41d4-a716-446655440000"` |
| `uri` | RFC 3986 | `"https://example.com/path"` |
| `binary` | Base64 | Base64-encoded bytes |
| `jsonpointer` | RFC 6901 | `"/foo/bar/0"` |

### Compound Types (Required)

| Type | Description | Required Keywords |
|------|-------------|-------------------|
| `object` | JSON object with typed properties | `properties` |
| `array` | Homogeneous list | `items` |
| `set` | Unique homogeneous list | `items` (validates uniqueness) |
| `map` | Dictionary with string keys | `values` |
| `tuple` | Fixed-length typed array | `properties` + `tuple` |
| `choice` | Discriminated union | `choices` + `selector` |
| `any` | Any JSON value | (none) |

---

## Keywords Reference

### Reserved Keywords (Core)

These keywords are defined in the JSON Structure Core specification:

```
$schema, $id, $ref, $root, $extends, $uses, $offers, $comment
definitions, name, abstract, type
properties, additionalProperties, required
items, values
tuple, choices, selector
enum, const, default
title, description, examples
precision, scale
```

### Keywords NOT in JSON Structure (Do Not Implement)

The following keywords from JSON Schema are **NOT** valid in JSON Structure:

- ❌ `$anchor` - Not a JSON Structure keyword
- ❌ `$defs` - Use `definitions` instead
- ❌ `prefixItems` - Use `properties` + `tuple` instead
- ❌ `options` - Use `choices` instead
- ❌ `discriminator` - Use `selector` instead
- ❌ `deprecated` - Not a JSON Structure keyword

### Extension Keywords

These keywords require `$uses` to declare the extension:

#### Validation Extension (`JSONStructureValidation`)
```
minLength, maxLength, pattern, format
minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf
minItems, maxItems, uniqueItems, contains, minContains, maxContains
minProperties, maxProperties, dependentRequired, propertyNames
contentEncoding, contentMediaType, contentCompression
```

#### Conditional Composition Extension (`JSONStructureConditionalComposition`)
```
allOf, anyOf, oneOf, not, if, then, else
```

#### Import Extension (`JSONStructureImport`)
```
$import, $importdefs
```

#### Alternate Names Extension (`JSONStructureAlternateNames`)
```
altnames
```

#### Units Extension (`JSONStructureUnits`)
```
unit
```

---

## Error Codes

All error codes are defined in [`assets/error-messages.json`](assets/error-messages.json).

### Categories

| Category | Prefix | Description |
|----------|--------|-------------|
| Schema | `SCHEMA_*` | Schema validation errors |
| Instance | `INSTANCE_*` | Instance validation errors |

### Key Error Codes

#### Schema Errors
| Code | Description |
|------|-------------|
| `SCHEMA_NULL` | Schema cannot be null |
| `SCHEMA_INVALID_TYPE` | Schema must be boolean or object |
| `SCHEMA_ROOT_MISSING_ID` | Root schema must have `$id` |
| `SCHEMA_ROOT_MISSING_NAME` | Root schema with `type` must have `name` |
| `SCHEMA_TYPE_INVALID` | Invalid type name |
| `SCHEMA_REF_NOT_FOUND` | `$ref` references undefined definition |
| `SCHEMA_TUPLE_MISSING_DEFINITION` | Tuple requires `properties` + `tuple` |
| `SCHEMA_CHOICE_MISSING_CHOICES` | Choice requires `choices` keyword |
| `SCHEMA_MAP_MISSING_VALUES` | Map requires `values` keyword |

#### Instance Errors
| Code | Description |
|------|-------------|
| `INSTANCE_TYPE_MISMATCH` | Value does not match expected type |
| `INSTANCE_REQUIRED_MISSING` | Required property is missing |
| `INSTANCE_ADDITIONAL_PROPERTY` | Additional property not allowed |
| `INSTANCE_ENUM_MISMATCH` | Value not in enum |
| `INSTANCE_CONST_MISMATCH` | Value does not match const |

---

## Test Assets

### Schema Test Files

Located in [`test-assets/schemas/`](test-assets/schemas/):

#### Invalid Schemas (`test-assets/schemas/invalid/`)
These schemas should **fail** validation:

| File | Tests |
|------|-------|
| `allof-not-array.struct.json` | `allOf` must be array |
| `array-missing-items.struct.json` | Array requires `items` |
| `circular-ref-direct.struct.json` | Direct circular `$ref` |
| `enum-duplicates.struct.json` | Enum values must be unique |
| `enum-empty.struct.json` | Enum cannot be empty |
| `map-missing-values.struct.json` | Map requires `values` |
| `missing-type.struct.json` | Schema must have type |
| `ref-undefined.struct.json` | `$ref` must resolve |
| `tuple-missing-definition.struct.json` | Tuple requires definition |
| `unknown-type.struct.json` | Invalid type name |

[Full list: `test-assets/schemas/invalid/`](test-assets/schemas/invalid/)

#### Valid Schemas with Extensions (`test-assets/schemas/validation/`)
These schemas should **pass** validation when extensions are enabled:

| File | Tests |
|------|-------|
| `string-pattern-with-uses.struct.json` | Pattern validation |
| `numeric-minimum-with-uses.struct.json` | Numeric constraints |
| `array-contains-with-uses.struct.json` | Contains validation |
| `object-dependentrequired-with-uses.struct.json` | Dependent required |

[Full list: `test-assets/schemas/validation/`](test-assets/schemas/validation/)

### Instance Test Files

Located in [`test-assets/instances/`](test-assets/instances/):

#### Invalid Instances (`test-assets/instances/invalid/`)
Instance/schema pairs where validation should **fail**.

#### Valid Instances (`test-assets/instances/validation/`)
Instance/schema pairs where validation should **pass**.

---

## Schema Exporter (Optional)

The schema exporter generates JSON Structure schemas from native language types. This component is **only applicable** to languages that support runtime type introspection/reflection:

### Languages That Should Implement Exporter

| Language | Introspection Mechanism | Implement Exporter |
|----------|------------------------|-------------------|
| .NET/C# | Reflection, `System.Text.Json` metadata | ✅ Yes |
| Java | Reflection, Jackson annotations | ✅ Yes |
| Python | `dataclasses`, `typing`, `inspect` | ✅ Yes |
| TypeScript | Decorators (limited, compile-time) | ⚠️ Optional |
| Go | `reflect` package | ✅ Yes |
| Rust | (compile-time macros only) | ❌ No |
| C/C++ | (no runtime reflection) | ❌ No |

### Exporter Requirements

When implementing a schema exporter:

1. **Type Mapping** - Map native types to JSON Structure types:
   - `string` → `string`
   - `int`, `int32` → `int32`
   - `long`, `int64` → `int64`
   - `float` → `float`
   - `double` → `double`
   - `bool` → `boolean`
   - `DateTime` → `datetime`
   - `UUID`/`Guid` → `uuid`
   - `List<T>` → `array` with `items`
   - `Set<T>` → `set` with `items`
   - `Dict<K,V>` → `map` with `values`
   - Classes/structs → `object` with `properties`

2. **Metadata Extraction** - Extract from:
   - Property names (respecting serialization attributes)
   - Documentation comments/docstrings
   - Validation attributes (when extended mode enabled)
   - Nullability information for `required`

3. **Options** - Support configuration:
   - `schemaUri` - The `$schema` value
   - `includeSchemaKeyword` - Whether to emit `$schema`
   - `includeTitles` - Whether to emit `title`
   - `includeDescriptions` - Whether to emit `description`
   - `useExtendedValidation` - Enable validation keywords

**Reference implementations:**
- .NET: [`dotnet/src/JsonStructure/Schema/JsonStructureSchemaExporter.cs`](dotnet/src/JsonStructure/Schema/JsonStructureSchemaExporter.cs)
- Java: [`java/src/main/java/org/json_structure/schema/JsonStructureSchemaExporter.java`](java/src/main/java/org/json_structure/schema/JsonStructureSchemaExporter.java)
- Python: [`python/src/json_structure/schema_exporter.py`](python/src/json_structure/schema_exporter.py)

---

## Conformance Checklist

Use this checklist to verify a new SDK implementation meets all requirements.

### Core Requirements

#### Schema Validator
- [ ] Validates `$schema` keyword (must be valid JSON Structure metaschema URI)
- [ ] Validates `$id` is required at root level
- [ ] Validates `name` is required when `type` is present at root
- [ ] Validates all primitive types (34 types)
- [ ] Validates all compound types (`object`, `array`, `set`, `map`, `tuple`, `choice`, `any`)
- [ ] Validates `$ref` references resolve to existing definitions
- [ ] Validates `definitions` entries have `type` or `$ref`
- [ ] Validates `properties` is an object
- [ ] Validates `required` is an array of strings
- [ ] Validates `required` properties exist in `properties`
- [ ] Validates `items` is required for `array` and `set` types
- [ ] Validates `values` is required for `map` type
- [ ] Validates `tuple` requires `properties` and `tuple` keywords
- [ ] Validates `choice` requires `choices` and optionally `selector`
- [ ] Validates `enum` is a non-empty array with unique values
- [ ] Validates `const` is a valid JSON value
- [ ] Validates constraint combinations (e.g., `minimum` ≤ `maximum`)
- [ ] Detects circular `$ref` references
- [ ] Reports source locations (line/column) for all errors
- [ ] Uses standardized error codes from `error-messages.json`

#### Instance Validator
- [ ] Validates all 34 primitive types with correct format checking
- [ ] Validates `object` instances against `properties`
- [ ] Validates `required` properties are present
- [ ] Rejects unknown properties when `additionalProperties: false`
- [ ] Validates `array` instances against `items` schema
- [ ] Validates `set` instances for uniqueness
- [ ] Validates `map` instances against `values` schema
- [ ] Validates `tuple` instances match `properties` + `tuple` order
- [ ] Validates `choice` instances with `selector` and `choices`
- [ ] Validates `enum` values match exactly
- [ ] Validates `const` values match exactly
- [ ] Resolves `$ref` references during validation
- [ ] Reports source locations (line/column) for all errors
- [ ] Uses standardized error codes from `error-messages.json`

#### Extension Support
- [ ] Validates `$uses` declares extensions correctly
- [ ] Validates `$offers` declares extensions correctly
- [ ] Supports `$import` and `$importdefs` (Import extension)
- [ ] Supports conditional composition (`allOf`, `anyOf`, `oneOf`, `not`, `if/then/else`)
- [ ] Supports validation constraints when `JSONStructureValidation` enabled
- [ ] Supports `altnames` when `JSONStructureAlternateNames` enabled
- [ ] Supports `unit` when `JSONStructureUnits` enabled

### Keyword Conformance

#### Must NOT implement (JSON Schema compatibility):
- [ ] Does NOT accept `$anchor` as a keyword
- [ ] Does NOT accept `$defs` (uses `definitions`)
- [ ] Does NOT accept `prefixItems` (uses `properties` + `tuple`)
- [ ] Does NOT accept `options` (uses `choices`)
- [ ] Does NOT accept `discriminator` (uses `selector`)
- [ ] Does NOT accept `deprecated` as a keyword

#### Must implement correctly:
- [ ] `tuple` uses `properties` + `tuple` array (not `prefixItems`)
- [ ] `choice` uses `selector` + `choices` (not `discriminator` + `options`)
- [ ] `definitions` (not `$defs`)

### Error Handling
- [ ] All error codes match `assets/error-messages.json`
- [ ] Error messages include path information (JSON Pointer)
- [ ] Error messages include source location when available
- [ ] Errors distinguish between `error` and `warning` severity
- [ ] Errors are collected (validation continues after first error)

### Test Compliance
- [ ] All schemas in `test-assets/schemas/invalid/` fail validation
- [ ] All schemas in `test-assets/schemas/validation/` pass with extensions enabled
- [ ] All instance tests in `test-assets/instances/` produce expected results
- [ ] Unit tests cover all type validations
- [ ] Unit tests cover all error conditions

### Documentation
- [ ] README.md with installation and usage examples
- [ ] API documentation for all public classes/functions
- [ ] Examples for schema validation
- [ ] Examples for instance validation
- [ ] Examples for schema export (if applicable)

### Package/Distribution
- [ ] Package published to language-appropriate registry
- [ ] Semantic versioning
- [ ] MIT license
- [ ] Changelog maintained

---

## Adding a New SDK

1. **Create directory structure:**
   ```
   sdk/<language>/
   ├── README.md
   ├── src/
   │   ├── schema_validator.*
   │   ├── instance_validator.*
   │   ├── error_codes.*
   │   ├── json_source_locator.*
   │   ├── types.*
   │   └── schema_exporter.* (optional)
   └── tests/
   ```

2. **Implement components** in order:
   1. Types/ValidationResult
   2. Error codes (from `assets/error-messages.json`)
   3. JSON source locator
   4. Schema validator
   5. Instance validator
   6. Schema exporter (if applicable)

3. **Run conformance tests** against `test-assets/`

4. **Complete checklist** above

5. **Submit PR** with:
   - Full implementation
   - Test coverage report
   - Documentation
   - Completed conformance checklist

---

## Related Resources

- [JSON Structure Specification](https://json-structure.github.io/core/)
- [JSON Structure Primer](../primer-and-samples/json-structure-primer.md)
- [Meta Schemas](meta/)
- [Test Assets](test-assets/)
- [Error Messages](assets/error-messages.json)
