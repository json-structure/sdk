# JSON Structure C# SDK

A comprehensive C# SDK for JSON Structure validation, including schema validation, instance validation, schema export from .NET types, and System.Text.Json converters for correct serialization of large numeric types.

## Features

- **Schema Validation**: Validate JSON Structure schema documents
- **Instance Validation**: Validate JSON instances against JSON Structure schemas
- **Schema Export**: Generate JSON Structure schemas from .NET types (similar to System.Text.Json.Schema.JsonSchemaExporter)
- **System.Text.Json Converters**: Serialize large integers (int64, uint64, int128, uint128, decimal) as strings to preserve precision
- **Apache Avro**: Hand an Avro serializer a `.struct.json` and never maintain an `.avsc` — see [Apache Avro](#apache-avro)

## Installation

```bash
dotnet add package JsonStructure
dotnet add package JsonStructure.Avro   # optional, for Apache Avro
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

### Sideloading External Schemas

When using `$import` to reference external schemas, you can provide those schemas
directly instead of fetching them from URIs:

```csharp
using JsonStructure.Validation;
using System.Text.Json.Nodes;

// External schema that would normally be fetched
var addressSchema = new JsonObject
{
    ["$schema"] = "https://json-structure.org/meta/core/v0/#",
    ["$id"] = "https://example.com/address.json",
    ["type"] = "object",
    ["properties"] = new JsonObject
    {
        ["street"] = new JsonObject { ["type"] = "string" },
        ["city"] = new JsonObject { ["type"] = "string" }
    }
};

// Main schema that imports the address schema
var mainSchema = new JsonObject
{
    ["$schema"] = "https://json-structure.org/meta/core/v0/#",
    ["type"] = "object",
    ["properties"] = new JsonObject
    {
        ["name"] = new JsonObject { ["type"] = "string" },
        ["address"] = new JsonObject { ["$ref"] = "#/definitions/Imported/Address" }
    },
    ["definitions"] = new JsonObject
    {
        ["Imported"] = new JsonObject
        {
            ["$import"] = "https://example.com/address.json"
        }
    }
};

// Sideload the address schema - keyed by URI
var options = new ValidationOptions
{
    AllowImport = true,
    ExternalSchemas = new Dictionary<string, JsonNode>
    {
        ["https://example.com/address.json"] = addressSchema
    }
};

var validator = new SchemaValidator(options);
var result = validator.Validate(mainSchema);
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

### Apache Avro

`JsonStructure.Avro` compiles a JSON Structure document into an Apache Avro
schema, so the `.avsc` stops being something anyone has to maintain. JSON
Structure is the source; Avro is the assembly language it compiles to.

The change at the call site is one line — wherever `Schema.Parse` took a
hand-written `.avsc`, `JsonStructureAvro.SchemaFrom` takes the schema you
already have:

```csharp
using Avro.Generic;
using Avro.IO;
using JsonStructure.Avro;

var schema = (Avro.RecordSchema)JsonStructureAvro.SchemaFromFile("person.struct.json");

var person = new GenericRecord(schema);
person.Add("name", "Alice");
person.Add("age", 42);

using var stream = new MemoryStream();
new GenericDatumWriter<GenericRecord>(schema).Write(person, new BinaryEncoder(stream));
```

Everything downstream — datum writers, readers, file writers, a schema registry
client — is unchanged, because what comes back is an ordinary `Avro.Schema`.

Compilation is a few microseconds per declared property and linear in document
size: nothing once, a great deal per message. Hold the result rather than
recompiling:

```csharp
private static readonly Lazy<Avro.Schema> PersonSchema =
    new(() => JsonStructureAvro.SchemaFrom(EmbeddedPersonStructJson));
```

Not every JSON Structure construct survives the trip. Where the mapping loses
something — a `const`, a `set`'s uniqueness — the compiler says so rather than
quietly dropping it:

```csharp
var result = AvroCompiler.Compile(JsonNode.Parse(source)!);
foreach (var warning in result.Warnings)
{
    Console.WriteLine(warning);   // "#/properties/tags: ..."
}
```

Anything that cannot be represented at all throws `AvroCompileException`, which
carries the offending JSON Pointer in `Path`.

#### Compact and full modes

By default the compiler emits the smallest schema that carries the data. Pass
`AvroMode.Full` to get one that also describes it:

```csharp
var schema = JsonStructureAvro.SchemaFromFile(
    "person.struct.json", new AvroOptions { Mode = AvroMode.Full });
```

`Full` adds `logicalType` annotations for the temporal types and `uuid`, and
carries what Avro cannot express — the constraints, the `unit` and `currency`
annotations, and the semantic annotations — in an `annotations` attribute
beside `doc`:

```json
{
  "name": "total",
  "type": { "type": "bytes", "logicalType": "decimal", "precision": 9, "scale": 2 },
  "doc": "Order total",
  "annotations": { "minimum": 0 }
}
```

Avro parsers ignore attributes they do not recognize, so this costs a reader
that has never heard of JSON Structure nothing, and gives one that has the
constraint in the form it was written. `Mode` alone governs it — `EmitDoc` is
about prose for a human and suppressing that leaves the constraints in place.

It changes no base type and therefore no
byte on the wire: a `Full` schema and a `Compact` schema compiled from the same
document are interchangeable as reader and writer, which the corpus asserts
directly. Reach for `Full` when a human or a code generator is going to read the
schema, `Compact` when it is going to be parsed at process start.

The temporal annotations use the `rfc3339-*` names, which are not in the Avro
specification. Apache.Avro rejects a logical type it does not know rather than
ignoring it, so `JsonStructureAvro` registers them with
`LogicalTypeFactory.Instance` on first use. That happens automatically inside
every `SchemaFrom` overload; call `JsonStructureAvro.RegisterLogicalTypes()`
yourself only if you parse such a schema through `Avro.Schema.Parse` directly.

The mapping is specified construct by construct in
[`spec/json-structure-to-avro.md`](../spec/json-structure-to-avro.md), and it is
deterministic by requirement: every SDK emits byte-identical `.avsc` for the same
input, checked against the shared corpus in
[`test-assets/avro/`](../test-assets/avro/).

For Protobuf, use the `jstruct` CLI — `.proto` files are build-time artifacts,
not something to generate at startup.

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
    AllowImport = true,                 // Enable $import/$importdefs processing
    ExternalSchemas = new Dictionary<string, JsonNode>
    {
        // Sideloaded schemas for import resolution (keyed by URI)
        ["https://example.com/address.json"] = addressSchema
    },
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
