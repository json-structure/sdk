# JSON Structure SDK for Rust

A Rust implementation of the JSON Structure schema validation library.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
json-structure = "0.1"
```

## Quick Start

```rust
use json_structure::{SchemaValidator, InstanceValidator};

fn main() {
    // Define a schema
    let schema_json = r#"{
        "$id": "https://example.com/person",
        "name": "Person",
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "age": { "type": "int32" },
            "email": { "type": "string" }
        },
        "required": ["name", "email"]
    }"#;

    // Validate the schema
    let schema_validator = SchemaValidator::new();
    let schema_result = schema_validator.validate(schema_json);
    
    if !schema_result.is_valid() {
        for error in schema_result.errors() {
            eprintln!("Schema error: {}", error);
        }
        return;
    }

    // Parse schema for instance validation
    let schema: serde_json::Value = serde_json::from_str(schema_json).unwrap();

    // Validate an instance
    let instance_json = r#"{
        "name": "Alice",
        "age": 30,
        "email": "alice@example.com"
    }"#;

    let instance_validator = InstanceValidator::new();
    let instance_result = instance_validator.validate(instance_json, &schema);
    
    if instance_result.is_valid() {
        println!("Instance is valid!");
    } else {
        for error in instance_result.errors() {
            eprintln!("Validation error: {}", error);
        }
    }
}
```

## Features

### Schema Validation

The `SchemaValidator` validates JSON Structure schema documents:

```rust
use json_structure::{SchemaValidator, SchemaValidatorOptions};

// With default options
let validator = SchemaValidator::new();

// With custom options
let options = SchemaValidatorOptions {
    allow_import: true,
    max_validation_depth: 64,
    warn_on_unused_extension_keywords: true,
    ..Default::default()
};
let validator = SchemaValidator::with_options(options);

let result = validator.validate(schema_json);
```

### Instance Validation

The `InstanceValidator` validates JSON instances against schemas:

```rust
use json_structure::{InstanceValidator, InstanceValidatorOptions};

// With default options
let validator = InstanceValidator::new();

// With extended validation (enables constraint keywords)
let options = InstanceValidatorOptions {
    extended: true,
    allow_import: false,
};
let validator = InstanceValidator::with_options(options);

let result = validator.validate(instance_json, &schema);
```

### Source Location Tracking

Errors include line and column information:

```rust
for error in result.errors() {
    println!(
        "[{}:{}] {}: {}",
        error.location.line,
        error.location.column,
        error.code,
        error.message
    );
}
```

## Supported Types

### Primitive Types

| Type | Description |
|------|-------------|
| `string` | UTF-8 string |
| `boolean` | true or false |
| `null` | Null value |
| `number` | Any JSON number |
| `integer` | Alias for int32 |
| `int8` - `int128` | Signed integers |
| `uint8` - `uint128` | Unsigned integers |
| `float`, `double`, `decimal` | Floating-point numbers |
| `date` | Date (YYYY-MM-DD) |
| `time` | Time (HH:MM:SS) |
| `datetime` | RFC 3339 datetime |
| `duration` | ISO 8601 duration |
| `uuid` | UUID string |
| `uri` | URI string |
| `binary` | Base64-encoded bytes |
| `jsonpointer` | JSON Pointer |

### Compound Types

| Type | Description | Required Keywords |
|------|-------------|-------------------|
| `object` | Typed properties | `properties` |
| `array` | Homogeneous list | `items` |
| `set` | Unique list | `items` |
| `map` | String-keyed dictionary | `values` |
| `tuple` | Fixed-length array | `properties` + `tuple` |
| `choice` | Discriminated union | `choices` + `selector` |
| `any` | Any value | (none) |

## Extensions

Enable extensions using `$uses` in your schema:

```json
{
    "$id": "https://example.com/schema",
    "$uses": ["JSONStructureValidation", "JSONStructureConditionalComposition"],
    "name": "ValidatedSchema",
    "type": "string",
    "minLength": 1,
    "maxLength": 100
}
```

### Available Extensions

- **JSONStructureValidation**: Validation constraints (`minLength`, `maxLength`, `pattern`, `minimum`, `maximum`, etc.)
- **JSONStructureConditionalComposition**: Composition keywords (`allOf`, `anyOf`, `oneOf`, `not`, `if/then/else`)
- **JSONStructureImport**: Schema imports (`$import`, `$importdefs`)
- **JSONStructureAlternateNames**: Alternate property names (`altnames`)
- **JSONStructureUnits**: Unit annotations (`unit`)

## Error Handling

```rust
use json_structure::{ValidationResult, Severity};

fn process_result(result: &ValidationResult) {
    // Check if validation passed
    if result.is_valid() {
        println!("Valid!");
        return;
    }

    // Check for errors or warnings
    if result.has_errors() {
        for error in result.errors() {
            println!("[{}] {} at {}", error.code(), error.message(), error.path());
        }
    }

    if result.has_warnings() {
        for warning in result.warnings() {
            println!("Warning: {}", warning.message());
        }
    }

    // Get counts
    println!("Errors: {}, Warnings: {}", result.error_count(), result.warning_count());
}
```

### Using Default Trait

Both validators implement `Default`:

```rust
use json_structure::{SchemaValidator, InstanceValidator};

let schema_validator = SchemaValidator::default();
let instance_validator = InstanceValidator::default();
```

### Error as std::error::Error

`ValidationError` implements `std::error::Error` for integration with Rust's error handling:

```rust
use json_structure::ValidationError;

fn validate_something() -> Result<(), Box<dyn std::error::Error>> {
    let validator = json_structure::SchemaValidator::new();
    let result = validator.validate("{}");
    
    if let Some(error) = result.errors().next() {
        return Err(error.clone().into());
    }
    Ok(())
}
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Command Line Interface

The SDK includes `jstruct`, a CLI tool for validating schemas and instances.

### Installation

```bash
cargo install json-structure --features cli
```

Or build from source:

```bash
cargo build --release --features cli
```

### Commands

#### Check Schema(s)

Validate one or more JSON Structure schema files:

```bash
# Check a single schema
jstruct check schema.struct.json

# Check multiple schemas
jstruct check schema1.json schema2.json

# Use quiet mode (no output, just exit code)
jstruct check -q schema.json

# Output as JSON
jstruct check --format json schema.json

# Output as TAP (Test Anything Protocol)
jstruct check --format tap schema.json
```

#### Validate Instance(s)

Validate JSON instances against a schema:

```bash
# Validate instance against schema
jstruct validate --schema schema.json data.json

# Validate multiple instances
jstruct validate -s schema.json data1.json data2.json

# With extended validation (constraint keywords)
jstruct validate --extended -s schema.json data.json

# Output as JSON
jstruct validate -s schema.json --format json data.json
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All files valid |
| 1 | One or more files invalid |
| 2 | Error (file not found, etc.) |

### Output Formats

**Text (default):**
```
✓ schema.json: valid
✗ bad-schema.json: invalid
  - /$id: Missing required property "$id"
```

**JSON:**
```json
[{"file":"schema.json","valid":true,"errors":[]}]
```

**TAP:**
```tap
1..2
ok 1 - schema.json
not ok 2 - bad-schema.json
  - /$id: Missing required property "$id"
```

## Related

- [JSON Structure Specification](https://json-structure.github.io/core/)
- [SDK Guidelines](../SDK-GUIDELINES.md)
