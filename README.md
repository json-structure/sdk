# JSON Structure SDKs

Official SDKs for validating JSON documents against [JSON Structure](https://json-structure.org) schemas.

JSON Structure is a type-oriented schema language for JSON, designed for defining data structures
that can be validated and mapped to programming language types.

## Available SDKs

| Language | Package | Status |
|----------|---------|--------|
| [Python](./python/) | `json-structure` | ✅ Available |

## Features

All SDKs provide:

- **Schema Validation**: Validate JSON Structure schema documents for correctness
- **Instance Validation**: Validate JSON instances against JSON Structure schemas
- **Full Type Support**: All 34 primitive and compound types from JSON Structure Core v0
- **Extensions**: Support for validation addins, conditional composition, and imports

## Quick Start

### Python

```bash
pip install json-structure
```

```python
from json_structure import InstanceValidator, SchemaValidator

# Validate a schema
schema = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    }
}

schema_validator = SchemaValidator(schema)
schema_errors = schema_validator.validate()

# Validate an instance
instance = {"name": "Alice", "age": 30}
instance_validator = InstanceValidator(schema)
instance_errors = instance_validator.validate_instance(instance)
```

## Documentation

- [JSON Structure Specification](https://github.com/json-structure/core)
- [JSON Structure Primer](https://github.com/json-structure/primer-and-samples)

## Contributing

Contributions are welcome! Please see the individual SDK directories for language-specific
contribution guidelines.

## License

MIT License - see [LICENSE](./LICENSE) for details.
