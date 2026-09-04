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
    <version>${version}</version>
</dependency>
```

Replace `${version}` with the desired version number.

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

### Apache Avro

`org.json_structure.avro` compiles a JSON Structure document into an Apache Avro
schema, so the `.avsc` stops being something anyone has to maintain. JSON
Structure is the source; Avro is the assembly language it compiles to.

The change at the call site is one line — wherever `new Schema.Parser().parse()`
took a hand-written `.avsc`, `JsonStructureAvro.schemaFrom` takes the schema you
already have:

```java
import org.apache.avro.Schema;
import org.apache.avro.generic.*;
import org.apache.avro.io.*;
import org.json_structure.avro.JsonStructureAvro;

Schema schema = JsonStructureAvro.schemaFromFile(Path.of("person.struct.json"));

GenericRecord person = new GenericData.Record(schema);
person.put("name", "Alice");
person.put("age", 42);

ByteArrayOutputStream buffer = new ByteArrayOutputStream();
Encoder encoder = EncoderFactory.get().binaryEncoder(buffer, null);
new GenericDatumWriter<GenericRecord>(schema).write(person, encoder);
encoder.flush();
```

Everything downstream — datum writers, readers, `DataFileWriter`, a schema
registry client, `SpecificDatumWriter` over generated classes — is unchanged,
because what comes back is an ordinary `org.apache.avro.Schema`.

Avro is an **optional** dependency. Declare `org.apache.avro:avro` yourself if
you want the `JsonStructureAvro` facade; `AvroCompiler`, which returns the
`.avsc` as a Jackson tree, needs nothing beyond Jackson.

Compilation is a few microseconds per declared property and linear in document
size: nothing once, a great deal per message. Hold the result rather than
recompiling:

```java
private static final Supplier<Schema> PERSON_SCHEMA =
    Suppliers.memoize(() -> JsonStructureAvro.schemaFrom(EMBEDDED_PERSON_STRUCT_JSON));
```

Not every JSON Structure construct survives the trip. Where the mapping loses
something — a `const`, a `set`'s uniqueness — the compiler says so rather than
quietly dropping it:

```java
AvroCompileResult result = AvroCompiler.compile(mapper.readTree(source));
result.warnings().forEach(System.out::println);   // "#/properties/tags: ..."
```

Anything that cannot be represented at all throws `AvroCompileException`, an
unchecked exception carrying the offending JSON Pointer in `path()`.

#### Compact and full modes

By default the compiler emits the smallest schema that carries the data. Pass
`AvroMode.FULL` to get one that also describes it:

```java
Schema schema = JsonStructureAvro.schemaFromFile(
    Path.of("person.struct.json"),
    AvroOptions.builder().mode(AvroMode.FULL).build());
```

`FULL` adds `logicalType` annotations for the temporal types and `uuid`, and
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
constraint in the form it was written. `mode` alone governs it — `emitDoc` is
about prose for a human, and suppressing that leaves the constraints in place.

It changes no base type and therefore no byte on the wire: a `FULL` schema and a
`COMPACT` schema compiled from the same document are interchangeable as reader
and writer, which the corpus asserts directly. Reach for `FULL` when a human or
a code generator is going to read the schema, `COMPACT` when it is going to be
parsed at process start.

The temporal annotations use the `rfc3339-*` names, which are not in the Avro
specification. Java's Avro runtime ignores a `logicalType` it does not know, so
unlike the .NET SDK there is nothing to register: such a schema parses, and the
values stay ordinary strings on the wire.

The mapping is specified construct by construct in
[`spec/json-structure-to-avro.md`](../spec/json-structure-to-avro.md), and it is
deterministic by requirement: every SDK emits byte-identical `.avsc` for the
same input, checked against the shared corpus in
[`test-assets/avro/`](../test-assets/avro/).

For Protobuf, use the `jstruct` CLI — `.proto` files are build-time artifacts,
not something to generate at startup.

## JVM Language Interoperability

The Java SDK can be used directly from other JVM languages without any wrapper code. The following examples demonstrate how to use the SDK from popular JVM languages.

### Kotlin

Kotlin has 100% Java interoperability and is widely used for Android and backend development.

#### Dependency (Gradle Kotlin DSL)

```kotlin
dependencies {
    implementation("org.json-structure:json-structure:${version}")
}
```

#### Schema Validation Example

```kotlin
import org.json_structure.validation.SchemaValidator
import org.json_structure.validation.ValidationResult

fun main() {
    val validator = SchemaValidator()
    val schema = """
        {
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "age": { "type": "int32" }
            },
            "required": ["name"]
        }
    """
    
    val result: ValidationResult = validator.validate(schema)
    if (result.isValid()) {
        println("Schema is valid!")
    } else {
        result.getErrors().forEach { error -> 
            println(error.getMessage())
        }
    }
}
```

#### Instance Validation Example

```kotlin
import org.json_structure.validation.InstanceValidator
import org.json_structure.validation.ValidationResult

fun validateInstance() {
    val validator = InstanceValidator()
    val schema = """{"type": "string"}"""
    val instance = """"Hello, World!""""
    
    val result: ValidationResult = validator.validate(instance, schema)
    println("Valid: ${result.isValid()}")
}
```

**Idiomatic Notes:**
- Use Kotlin's null safety features - the SDK returns non-null results
- Use `val` for immutable references (preferred in Kotlin)
- Leverage Kotlin's string interpolation for output
- Consider using `apply` or `let` for more functional style

### Scala

Scala provides full JVM interoperability and is popular in data engineering and functional programming.

#### Dependency (sbt)

```scala
libraryDependencies += "org.json-structure" % "json-structure" % "${version}"
```

#### Schema Validation Example

```scala
import org.json_structure.validation.{SchemaValidator, ValidationResult}
import scala.jdk.CollectionConverters._

object SchemaValidation extends App {
  val validator = new SchemaValidator()
  val schema = """{
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "age": { "type": "int32" }
    },
    "required": ["name"]
  }"""
  
  val result: ValidationResult = validator.validate(schema)
  if (result.isValid) {
    println("Schema is valid!")
  } else {
    result.getErrors.asScala.foreach(error => println(error.getMessage))
  }
}
```

#### Instance Validation Example

```scala
import org.json_structure.validation.{InstanceValidator, ValidationResult}

object InstanceValidation extends App {
  val validator = new InstanceValidator()
  val schema = """{"type": "string"}"""
  val instance = """"Hello, Scala!""""
  
  val result: ValidationResult = validator.validate(instance, schema)
  println(s"Valid: ${result.isValid}")
}
```

**Idiomatic Notes:**
- Use `scala.jdk.CollectionConverters._` to convert Java collections to Scala collections
- Consider wrapping results in `Option` for functional error handling
- Use Scala's pattern matching for result processing
- Leverage Scala's immutable collections when working with validation errors

### Groovy

Groovy is a dynamic JVM language used extensively in Gradle and scripting.

#### Dependency (Gradle Groovy DSL)

```groovy
dependencies {
    implementation 'org.json-structure:json-structure:${version}'
}
```

#### Schema Validation Example

```groovy
import org.json_structure.validation.SchemaValidator
import org.json_structure.validation.ValidationResult

def validator = new SchemaValidator()
def schema = '''
{
    "type": "object",
    "properties": {
        "name": { "type": "string" },
        "age": { "type": "int32" }
    },
    "required": ["name"]
}
'''

ValidationResult result = validator.validate(schema)
if (result.isValid()) {
    println "Schema is valid!"
} else {
    result.getErrors().each { error ->
        println error.getMessage()
    }
}
```

#### Instance Validation Example

```groovy
import org.json_structure.validation.InstanceValidator
import org.json_structure.validation.ValidationResult

def validator = new InstanceValidator()
def schema = '{"type": "string"}'
def instance = '"Hello, Groovy!"'

ValidationResult result = validator.validate(instance, schema)
println "Valid: ${result.isValid()}"
```

**Idiomatic Notes:**
- Groovy allows omitting parentheses in many cases for cleaner syntax
- Use GStrings (double quotes) for string interpolation
- Collections can be accessed with simplified syntax (`.each` instead of `.forEach`)
- Type declarations are optional but can improve clarity

### Clojure

Clojure is a functional Lisp dialect on the JVM with direct Java interoperability.

#### Dependency (Leiningen)

```clojure
:dependencies [[org.json-structure/json-structure "${version}"]]
```

#### Schema Validation Example

```clojure
(ns myapp.validation
  (:import [org.json_structure.validation SchemaValidator ValidationResult]))

(defn validate-schema []
  (let [validator (SchemaValidator.)
        schema "{\"type\": \"object\",
                 \"properties\": {
                   \"name\": {\"type\": \"string\"},
                   \"age\": {\"type\": \"int32\"}
                 },
                 \"required\": [\"name\"]}"]
    (let [result (.validate validator schema)]
      (if (.isValid result)
        (println "Schema is valid!")
        (doseq [error (.getErrors result)]
          (println (.getMessage error)))))))
```

#### Instance Validation Example

```clojure
(ns myapp.validation
  (:import [org.json_structure.validation InstanceValidator ValidationResult]))

(defn validate-instance []
  (let [validator (InstanceValidator.)
        schema "{\"type\": \"string\"}"
        instance "\"Hello, Clojure!\""]
    (let [result (.validate validator instance schema)]
      (println (str "Valid: " (.isValid result))))))
```

**Idiomatic Notes:**
- Use `(ClassName.)` syntax to create Java objects
- Call Java methods with `(.methodName object args)`
- Java collections can be converted to Clojure sequences with `seq`
- Consider using `->` or `->>` threading macros for cleaner data flow
- Leverage Clojure's immutable data structures when processing results

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

## Validation Options

```java
import org.json_structure.validation.ValidationOptions;

ValidationOptions options = new ValidationOptions()
    .setStopOnFirstError(false)           // Continue collecting all errors
    .setMaxValidationDepth(100)           // Maximum schema nesting depth
    .setAllowDollar(true)                 // Allow $ in property names (for metaschemas)
    .setAllowImport(true)                 // Enable $import/$importdefs processing
    .setExternalSchemas(Map.of(           // Sideloaded schemas for import resolution
        "https://example.com/address.json", addressSchema
    ));

SchemaValidator validator = new SchemaValidator(options);
```

### Sideloading External Schemas

When using `$import` to reference external schemas, you can provide those schemas
directly instead of fetching them from URIs:

```java
import org.json_structure.validation.SchemaValidator;
import org.json_structure.validation.ValidationOptions;
import org.json_structure.validation.ValidationResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;

ObjectMapper mapper = new ObjectMapper();

// External schema that would normally be fetched
JsonNode addressSchema = mapper.readTree("""
    {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/address.json",
        "type": "object",
        "properties": {
            "street": { "type": "string" },
            "city": { "type": "string" }
        }
    }
    """);

// Main schema that imports the address schema
JsonNode mainSchema = mapper.readTree("""
    {
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "address": { "$ref": "#/definitions/Imported/Address" }
        },
        "definitions": {
            "Imported": {
                "$import": "https://example.com/address.json"
            }
        }
    }
    """);

// Sideload the address schema - keyed by URI
ValidationOptions options = new ValidationOptions()
    .setAllowImport(true)
    .setExternalSchemas(Map.of(
        "https://example.com/address.json", addressSchema
    ));

SchemaValidator validator = new SchemaValidator(options);
ValidationResult result = validator.validate(mainSchema);
System.out.println("Valid: " + result.isValid());
```

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
