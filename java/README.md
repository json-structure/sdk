# JSON Structure SDK for Java

A Java SDK for working with JSON Structure schemas, providing:

- **Schema Validation**: Validate JSON Structure schema documents for correctness
- **Instance Validation**: Validate JSON data against JSON Structure schemas
- **Schema Export**: Generate JSON Structure schemas from Java classes using Jackson type introspection
- **Jackson Converters**: Serializers/deserializers for extended numeric and temporal types

## Requirements

- Java 17 or later
- Maven 3.6 or later

## Installation

Add to your `pom.xml`:

```xml
<dependency>
    <groupId>org.json-structure</groupId>
    <artifactId>json-structure</artifactId>
    <version>1.0.0</version>
</dependency>
```

## Usage

### Schema Validation

Validate that a JSON Structure schema is well-formed:

```java
import org.json_structure.validation.SchemaValidator;
import org.json_structure.validation.ValidationResult;

SchemaValidator validator = new SchemaValidator();
String schema = """
    {
        "$schema": "https://json-structure.org/meta/core/v1.0",
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "age": { "type": "int32" }
        },
        "required": ["name"]
    }
    """;

ValidationResult result = validator.validate(schema);
if (result.isValid()) {
    System.out.println("Schema is valid!");
} else {
    result.getErrors().forEach(e -> System.out.println(e.getMessage()));
}
```

### Instance Validation

Validate JSON data against a schema:

```java
import org.json_structure.validation.InstanceValidator;
import org.json_structure.validation.ValidationResult;

InstanceValidator validator = new InstanceValidator();
String schema = """
    {
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "age": { "type": "int32", "minimum": 0 }
        },
        "required": ["name"]
    }
    """;

String instance = """
    {
        "name": "Alice",
        "age": 30
    }
    """;

ValidationResult result = validator.validate(instance, schema);
System.out.println("Valid: " + result.isValid());
```

### Schema Export from Java Types

Generate JSON Structure schemas from Java classes:

```java
import org.json_structure.schema.JsonStructureSchemaExporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

public class Person {
    private String name;
    private int age;
    private LocalDate birthDate;
    
    // getters and setters
}

ObjectMapper mapper = new ObjectMapper();
JsonNode schema = JsonStructureSchemaExporter.getSchemaAsNode(Person.class, mapper);
System.out.println(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(schema));
```

Output:
```json
{
    "$schema": "https://json-structure.org/meta/core/v1.0",
    "type": "object",
    "title": "Person",
    "properties": {
        "name": { "type": "string" },
        "age": { "type": "int32" },
        "birthDate": { "type": "date" }
    },
    "required": ["name", "age", "birthDate"]
}
```

### Jackson Module for Extended Types

Register the JSON Structure module for extended type handling:

```java
import org.json_structure.converters.JsonStructureModule;
import com.fasterxml.jackson.databind.ObjectMapper;

ObjectMapper mapper = new ObjectMapper();
mapper.registerModule(new JsonStructureModule());

// Supports extended numeric types like Int128, UInt128, Decimal, etc.
```

## Supported Types

### Primitive Types
- `boolean` - Java `boolean`/`Boolean`
- `string` - Java `String`
- `int8` - Java `byte`/`Byte`
- `int16` - Java `short`/`Short`
- `int32` - Java `int`/`Integer`
- `int64` - Java `long`/`Long`
- `int128` - Java `BigInteger` (constrained)
- `uint8` - Java `short` (0-255)
- `uint16` - Java `int` (0-65535)
- `uint32` - Java `long` (0-4294967295)
- `uint64` - Java `BigInteger` (0-18446744073709551615)
- `uint128` - Java `BigInteger` (constrained)
- `float` - Java `float`/`Float` (single-precision 32-bit)
- `double` - Java `double`/`Double` (double-precision 64-bit)
- `decimal` - Java `BigDecimal`

### Temporal Types
- `date` - Java `LocalDate`
- `time` - Java `LocalTime`
- `datetime` - Java `OffsetDateTime` or `Instant`
- `duration` - Java `Duration`

### Other Types
- `uuid` - Java `UUID`
- `uri` - Java `URI`
- `binary` - Java `byte[]` (base64 encoded)

### Compound Types
- `object` - Java classes/records
- `array` - Java `List<T>`
- `set` - Java `Set<T>`
- `map` - Java `Map<String, T>`
- `tuple` - Ordered heterogeneous arrays
- `choice` - Discriminated unions

## Building

```bash
mvn clean package
```

## Testing

```bash
mvn test
```

## License

MIT License - see LICENSE file for details.
