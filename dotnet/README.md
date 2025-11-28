# JSON Structure C# SDK

A comprehensive C# SDK for JSON Structure validation, including schema validation, instance validation, schema export from .NET types, and System.Text.Json converters for correct serialization of large numeric types.

## Features

- **Schema Validation**: Validate JSON Structure schema documents
- **Instance Validation**: Validate JSON instances against JSON Structure schemas
- **Schema Export**: Generate JSON Structure schemas from .NET types (similar to System.Text.Json.Schema.JsonSchemaExporter)
- **System.Text.Json Converters**: Serialize large integers (int64, uint64, int128, uint128, decimal) as strings to preserve precision

## Installation

```bash
dotnet add package JsonStructure
```

## Usage

### Schema Validation

```csharp
using JsonStructure.Validation;
using System.Text.Json.Nodes;

var validator = new SchemaValidator();

var schema = new JsonObject
{
    ["type"] = "object",
    ["properties"] = new JsonObject
    {
        ["name"] = new JsonObject { ["type"] = "string" },
        ["age"] = new JsonObject { ["type"] = "int32" }
    },
    ["required"] = new JsonArray { "name" }
};

var result = validator.Validate(schema);
if (result.IsValid)
{
    Console.WriteLine("Schema is valid!");
}
else
{
    foreach (var error in result.Errors)
    {
        Console.WriteLine($"{error.Path}: {error.Message}");
    }
}
```

### Instance Validation

```csharp
using JsonStructure.Validation;
using System.Text.Json.Nodes;

var validator = new InstanceValidator();

var schema = new JsonObject
{
    ["type"] = "object",
    ["properties"] = new JsonObject
    {
        ["name"] = new JsonObject { ["type"] = "string" },
        ["age"] = new JsonObject { ["type"] = "int32", ["minimum"] = 0 }
    },
    ["required"] = new JsonArray { "name" }
};

var instance = new JsonObject
{
    ["name"] = "John",
    ["age"] = 30
};

var result = validator.Validate(instance, schema);
if (result.IsValid)
{
    Console.WriteLine("Instance is valid!");
}
```

### Schema Export from .NET Types

Generate JSON Structure schemas from C# classes:

```csharp
using JsonStructure.Schema;
using System.ComponentModel.DataAnnotations;

public class Person
{
    [Required]
    [StringLength(100, MinimumLength = 1)]
    public string Name { get; set; } = "";

    [Range(0, 150)]
    public int Age { get; set; }

    public List<string> Tags { get; set; } = new();

    public Dictionary<string, int> Scores { get; set; } = new();
}

// Generate schema
var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<Person>();

// Output:
// {
//   "$schema": "https://json-structure.org/meta/core/v1.0",
//   "type": "object",
//   "title": "Person",
//   "properties": {
//     "Name": { "type": "string", "minLength": 1, "maxLength": 100 },
//     "Age": { "type": "int32", "minimum": 0, "maximum": 150 },
//     "Tags": { "type": "array", "items": { "type": "string" } },
//     "Scores": { "type": "map", "values": { "type": "int32" } }
//   },
//   "required": ["Name"]
// }
```

### System.Text.Json Converters

Use the converters to correctly serialize large integers as strings (avoiding JavaScript precision issues):

```csharp
using JsonStructure.Converters;
using System.Text.Json;

// Create options with all JSON Structure converters
var options = JsonStructureConverters.CreateOptions();

// Or add to existing options
var existingOptions = new JsonSerializerOptions();
JsonStructureConverters.ConfigureOptions(existingOptions);

// Now large numbers are serialized as strings
var data = new { BigNumber = 9007199254740993L };
var json = JsonSerializer.Serialize(data, options);
// Output: {"BigNumber":"9007199254740993"}

// Decimals are also serialized as strings for precision
var money = new { Amount = 12345.67890123456789m };
var moneyJson = JsonSerializer.Serialize(money, options);
// Output: {"Amount":"12345.67890123456789"}
```

### Individual Converters

The SDK includes the following converters:

| Converter | Type | Description |
|-----------|------|-------------|
| `Int64StringConverter` | `long` | Serializes int64 as string |
| `UInt64StringConverter` | `ulong` | Serializes uint64 as string |
| `Int128StringConverter` | `Int128` | Serializes int128 as string |
| `UInt128StringConverter` | `UInt128` | Serializes uint128 as string |
| `DecimalStringConverter` | `decimal` | Serializes decimal as string |
| `DurationStringConverter` | `TimeSpan` | Serializes as ISO 8601 duration |
| `DateOnlyConverter` | `DateOnly` | Serializes as RFC 3339 date |
| `TimeOnlyConverter` | `TimeOnly` | Serializes as RFC 3339 time |
| `UuidStringConverter` | `Guid` | Serializes as standard UUID format |
| `UriStringConverter` | `Uri` | Serializes as URI string |
| `Base64BinaryConverter` | `byte[]` | Serializes as base64 string |

## Supported Types

### Primitive Types

| JSON Structure Type | .NET Type |
|---------------------|-----------|
| `string` | `string` |
| `boolean` | `bool` |
| `int8` | `sbyte` |
| `int16` | `short` |
| `int32` | `int` |
| `int64` | `long` |
| `int128` | `Int128` |
| `uint8` | `byte` |
| `uint16` | `ushort` |
| `uint32` | `uint` |
| `uint64` | `ulong` |
| `uint128` | `UInt128` |
| `float8` | `Half` |
| `float` | `float` |
| `double` | `double` |
| `decimal` | `decimal` |
| `date` | `DateOnly` |
| `time` | `TimeOnly` |
| `datetime` | `DateTime`, `DateTimeOffset` |
| `duration` | `TimeSpan` |
| `uuid` | `Guid` |
| `uri` | `Uri` |
| `binary` | `byte[]`, `ReadOnlyMemory<byte>` |

### Compound Types

| JSON Structure Type | .NET Type |
|---------------------|-----------|
| `object` | Class, struct |
| `array` | `List<T>`, `T[]`, `IEnumerable<T>` |
| `set` | `HashSet<T>`, `ISet<T>` |
| `map` | `Dictionary<K,V>`, `IDictionary<K,V>` |
| `tuple` | (via `prefixItems`) |
| `choice` | (via `options` and `discriminator`) |

## Validation Options

```csharp
var options = new ValidationOptions
{
    StopOnFirstError = false,           // Continue collecting all errors
    StrictFormatValidation = true,      // Validate format keywords strictly
    MaxValidationDepth = 100,           // Maximum schema nesting depth
    ReferenceResolver = uri =>          // Custom $ref resolver
    {
        // Return resolved schema or null
        return null;
    }
};

var validator = new InstanceValidator(options);
```

## Schema Export Options

```csharp
var exporterOptions = new JsonStructureSchemaExporterOptions
{
    SchemaUri = "https://json-structure.org/meta/core/v1.0",
    IncludeSchemaKeyword = true,
    IncludeTitles = true,
    IncludeDescriptions = true,
    TreatNullObliviousAsNonNullable = true,
    TransformSchema = (context, schema) =>
    {
        // Custom schema transformation
        if (context.IsRoot && schema is JsonObject obj)
        {
            obj["$id"] = "https://example.com/my-schema";
        }
        return schema;
    }
};

var schema = JsonStructureSchemaExporter.GetJsonStructureSchemaAsNode<MyClass>(
    exporterOptions: exporterOptions);
```

## License

MIT License. See [LICENSE](LICENSE) for details.
