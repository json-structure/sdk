# JSON Structure Python SDK

[![PyPI version](https://badge.fury.io/py/json-structure.svg)](https://badge.fury.io/py/json-structure)
[![Python](https://img.shields.io/pypi/pyversions/json-structure.svg)](https://pypi.org/project/json-structure/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Python validators for [JSON Structure](https://json-structure.org) schemas and instances.

JSON Structure is a type-oriented schema language for JSON, designed for defining data structures
that can be validated and mapped to programming language types.

## Installation

```bash
pip install json-structure
```

## Quick Start

### Validate a Schema

```python
from json_structure import SchemaValidator

schema = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/person",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"},
        "email": {"type": "string"}
    },
    "required": ["name"]
}

validator = SchemaValidator()
errors = validator.validate(schema)

if errors:
    print("Schema is invalid:")
    for error in errors:
        print(f"  - {error}")
else:
    print("Schema is valid!")
```

### Validate an Instance

```python
from json_structure import InstanceValidator

schema = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/person",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    },
    "required": ["name"]
}

instance = {
    "name": "Alice",
    "age": 30
}

validator = InstanceValidator(schema)
errors = validator.validate_instance(instance)

if errors:
    print("Instance is invalid:")
    for error in errors:
        print(f"  - {error}")
else:
    print("Instance is valid!")
```

## Features

### Supported Types

All 34 types from JSON Structure Core v0 are supported:

**Primitive Types:**
- `string`, `number`, `integer`, `boolean`, `null`
- `int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`
- `int64`, `uint64`, `int128`, `uint128` (string-encoded)
- `float8`, `float`, `double`, `decimal`
- `date`, `datetime`, `time`, `duration`
- `uuid`, `uri`, `binary`, `jsonpointer`

**Compound Types:**
- `object`, `array`, `set`, `map`, `tuple`, `choice`, `any`

### Extensions

- **Conditional Composition**: `allOf`, `anyOf`, `oneOf`, `not`, `if`/`then`/`else`
- **Validation Addins**: `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, etc.
- **Import Extension**: `$import`, `$importdefs` for schema composition

### Command Line Tools

```bash
# Validate a schema file
json-structure-check schema.json

# Validate an instance against a schema
json-structure-validate instance.json schema.json
```

## API Reference

### SchemaValidator

```python
from json_structure import SchemaValidator

validator = SchemaValidator(
    allow_dollar=False,      # Allow '$' in property names
    allow_import=False,      # Enable $import/$importdefs
    import_map=None,         # Dict mapping URIs to local files
    extended=False,          # Enable extended validation features
    external_schemas=None    # List of schema dicts to sideload (matched by $id)
)

errors = validator.validate(schema_dict, source_text=None)
```

### InstanceValidator

```python
from json_structure import InstanceValidator

validator = InstanceValidator(
    root_schema,             # The JSON Structure schema dict
    allow_import=False,      # Enable $import/$importdefs
    import_map=None,         # Dict mapping URIs to local files
    extended=False,          # Enable extended validation features
    external_schemas=None    # List of schema dicts to sideload (matched by $id)
)

errors = validator.validate_instance(instance)
```

### Sideloading External Schemas

When using `$import` to reference external schemas, you can provide those schemas
directly instead of fetching them from URIs:

```python
from json_structure import InstanceValidator

# External schema that would normally be fetched from https://example.com/address.json
address_schema = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/address.json",
    "name": "Address",
    "type": "object",
    "properties": {
        "street": {"type": "string"},
        "city": {"type": "string"}
    }
}

# Main schema that imports the address schema
main_schema = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/person",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "address": {"type": {"$ref": "#/definitions/Imported/Address"}}
    },
    "definitions": {
        "Imported": {
            "$import": "https://example.com/address.json"
        }
    }
}

# Sideload the address schema - matched by $id
validator = InstanceValidator(
    main_schema,
    allow_import=True,
    external_schemas=[address_schema]
)

instance = {
    "name": "Alice",
    "address": {"street": "123 Main St", "city": "Seattle"}
}

errors = validator.validate_instance(instance)
```

You can supply multiple schemas to satisfy multiple imports. The schemas are matched
by their `$id` field against the import URIs.

## Development

```bash
# Clone the repository
git clone https://github.com/json-structure/sdk.git
cd sdk/python

# Install development dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run tests with coverage
pytest --cov=json_structure --cov-report=term-missing
```

## License

MIT License - see [LICENSE](../LICENSE) for details.

## Links

- [JSON Structure Specification](https://github.com/json-structure/core)
- [JSON Structure Primer](https://github.com/json-structure/primer-and-samples)
- [SDK Repository](https://github.com/json-structure/sdk)
