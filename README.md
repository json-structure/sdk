# JSON Structure SDKs

Official SDKs for validating JSON documents against [JSON Structure](https://json-structure.org) schemas.

JSON Structure is a type-oriented schema language for JSON, designed for defining data structures
that can be validated and mapped to programming language types.

## Available SDKs

| Language | Package | Status |
|----------|---------|--------|
| [Python](./python/) | `json-structure` | ✅ Available |
| [.NET](./dotnet/) | `JsonStructure` | ✅ Available |
| [Java](./java/) | `json-structure` | ✅ Available |
| [TypeScript/JavaScript](./typescript/) | `json-structure` | ✅ Available |
| [Go](./go/) | `github.com/json-structure/sdk-go` | ✅ Available |

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

schema_validator = SchemaValidator()
schema_errors = schema_validator.validate(schema)

# Validate an instance
instance = {"name": "Alice", "age": 30}
instance_validator = InstanceValidator(schema)
instance_errors = instance_validator.validate_instance(instance)
```

### .NET

```bash
dotnet add package JsonStructure
```

```csharp
using JsonStructure.Validation;
using System.Text.Json.Nodes;

// Validate a schema
var schema = JsonNode.Parse("""
{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    }
}
""");

var schemaValidator = new SchemaValidator();
var schemaResult = schemaValidator.Validate(schema);

// Validate an instance
var instance = JsonNode.Parse("""{"name": "Alice", "age": 30}""");
var instanceValidator = new InstanceValidator();
var instanceResult = instanceValidator.Validate(instance, schema);
```

### Java

```xml
<dependency>
    <groupId>org.json-structure</groupId>
    <artifactId>json-structure</artifactId>
    <version>0.1.0</version>
</dependency>
```

```java
import org.json_structure.validation.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

ObjectMapper mapper = new ObjectMapper();

// Validate a schema
JsonNode schema = mapper.readTree("""
{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    }
}
""");

SchemaValidator schemaValidator = new SchemaValidator();
ValidationResult schemaResult = schemaValidator.validate(schema);

// Validate an instance
JsonNode instance = mapper.readTree("{\"name\": \"Alice\", \"age\": 30}");
InstanceValidator instanceValidator = new InstanceValidator();
ValidationResult instanceResult = instanceValidator.validate(instance, schema);
```

### TypeScript/JavaScript

```bash
npm install json-structure
```

```typescript
import { SchemaValidator, InstanceValidator } from 'json-structure';

// Validate a schema
const schema = {
  $schema: 'https://json-structure.org/meta/core/v0/#',
  name: 'Person',
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'int32' }
  }
};

const schemaValidator = new SchemaValidator();
const schemaResult = schemaValidator.validate(schema);

// Validate an instance
const instance = { name: 'Alice', age: 30 };
const instanceValidator = new InstanceValidator();
const instanceResult = instanceValidator.validate(instance, schema);
```

### Go

```bash
go get github.com/json-structure/sdk-go
```

```go
package main

import (
    "encoding/json"
    "fmt"
    jsonstructure "github.com/json-structure/sdk-go"
)

func main() {
    // Define a schema
    schemaJSON := `{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "name": "Person",
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "int32"}
        }
    }`

    var schema map[string]interface{}
    json.Unmarshal([]byte(schemaJSON), &schema)

    // Validate the schema
    schemaValidator := jsonstructure.NewSchemaValidator(nil)
    schemaResult := schemaValidator.Validate(schema)
    fmt.Printf("Schema valid: %v\n", schemaResult.IsValid)

    // Validate an instance
    instance := map[string]interface{}{
        "name": "Alice",
        "age":  float64(30),
    }

    instanceValidator := jsonstructure.NewInstanceValidator(nil)
    instanceResult := instanceValidator.Validate(instance, schema)
    fmt.Printf("Instance valid: %v\n", instanceResult.IsValid)
}
```

## Documentation

- [JSON Structure Specification](https://github.com/json-structure/core)
- [JSON Structure Primer](https://github.com/json-structure/primer-and-samples)

## Contributing

Contributions are welcome! Please see the individual SDK directories for language-specific
contribution guidelines.

## License

MIT License - see [LICENSE](./LICENSE) for details.
