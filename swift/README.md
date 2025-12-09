# JSONStructure Swift SDK

A Swift SDK for JSON Structure schema and instance validation. JSON Structure is a type-oriented schema language for JSON, designed for defining data structures that can be validated and mapped to programming language types.

## Features

- **Schema Validation**: Validate JSON Structure schema documents for conformance
- **Instance Validation**: Validate JSON instances against JSON Structure schemas
- **Error Reporting**: Line/column information for validation errors
- **Full Type Support**: All 34 primitive and compound types from JSON Structure Core v0
- **Thread-Safe & Sendable**: Safe for concurrent use with Swift concurrency (async/await, Task)
- **Cross-platform**: macOS, iOS, tvOS, watchOS, and Linux support
- **Pure Swift**: No Apple-only framework dependencies

## Thread Safety

The validators (`InstanceValidator` and `SchemaValidator`) are **thread-safe** and conform to `Sendable`, making them safe for concurrent use with Swift concurrency and multiple threads.

### How It Works

Both validators are value types (structs) containing only immutable configuration. Each validation operation creates a fresh internal engine with its own mutable state, ensuring complete isolation between concurrent validations.

```swift
let validator = InstanceValidator()

// Safe to use from multiple threads
DispatchQueue.concurrentPerform(iterations: 100) { i in
    let result = validator.validate(instances[i], schema: schema)
    // Each validation gets its own isolated state
}
```

### Swift Concurrency Support

The validators work seamlessly with Swift's structured concurrency:

```swift
let validator = InstanceValidator()

// Safe concurrent validation with Task groups
await withTaskGroup(of: ValidationResult.self) { group in
    for (instance, schema) in validationPairs {
        group.addTask {
            validator.validate(instance, schema: schema)
        }
    }
    
    for await result in group {
        // Process results as they complete
        if !result.isValid {
            print("Validation failed: \(result.errors)")
        }
    }
}
```

### Thread-Safety Guarantees

- ✅ **No shared mutable state**: Each validation creates isolated state
- ✅ **Sendable conformance**: Can be safely passed across concurrency boundaries
- ✅ **No data races**: Tested with Thread Sanitizer
- ✅ **Correct results**: Concurrent validations don't interfere with each other

## Requirements

- Swift 5.9+
- macOS 10.15+ / iOS 13+ / tvOS 13+ / watchOS 6+
- Linux support via Swift on Linux

## Installation

### Swift Package Manager

Add the following to your `Package.swift` file:

```swift
dependencies: [
    .package(url: "https://github.com/json-structure/sdk", from: "1.0.0")
]
```

Then add `JSONStructure` to your target dependencies:

```swift
.target(
    name: "YourTarget",
    dependencies: ["JSONStructure"]
)
```

## Versioning

The Swift SDK uses **git tags** for versioning, which is the standard approach for Swift Package Manager (SPM). No separate publish step is required.

### How It Works

When you specify a version dependency in your `Package.swift`:

```swift
.package(url: "https://github.com/json-structure/sdk", from: "1.0.0")
```

Swift Package Manager:
1. Fetches the repository
2. Finds the appropriate git tag (e.g., `v1.0.0` or `1.0.0`)
3. Checks out that tag and reads `Package.swift`

### Version Tags

Releases are tagged following semantic versioning:
- `v1.0.0` - Major release
- `v1.1.0` - Minor release with new features
- `v1.1.1` - Patch release with bug fixes

### Specifying Versions

```swift
// Minimum version (recommended)
.package(url: "https://github.com/json-structure/sdk", from: "1.0.0")

// Exact version
.package(url: "https://github.com/json-structure/sdk", exact: "1.2.3")

// Version range
.package(url: "https://github.com/json-structure/sdk", "1.0.0"..<"2.0.0")

// Branch (for development)
.package(url: "https://github.com/json-structure/sdk", branch: "main")
```

## Usage

### Schema Validation

Validate that a JSON Structure schema document is syntactically and semantically correct:

```swift
import JSONStructure

let validator = SchemaValidator()

let schema: [String: Any] = [
    "$id": "urn:example:person",
    "name": "Person",
    "type": "object",
    "properties": [
        "name": ["type": "string"],
        "age": ["type": "int32"]
    ],
    "required": ["name"]
]

let result = validator.validate(schema)

if result.isValid {
    print("Schema is valid!")
} else {
    for error in result.errors {
        print("Error at \(error.path): \(error.message)")
    }
}
```

### Instance Validation

Validate JSON data instances against a JSON Structure schema:

```swift
import JSONStructure

let schema: [String: Any] = [
    "$id": "urn:example:person",
    "name": "Person",
    "type": "object",
    "properties": [
        "name": ["type": "string"],
        "age": ["type": "int32"]
    ],
    "required": ["name"]
]

let instance: [String: Any] = [
    "name": "John Doe",
    "age": 30
]

let validator = InstanceValidator()
let result = validator.validate(instance, schema: schema)

if result.isValid {
    print("Instance is valid!")
} else {
    for error in result.errors {
        print("Error at \(error.path): \(error.message)")
    }
}
```

### Validation from JSON Strings

You can also validate from JSON strings or data:

```swift
import JSONStructure

let schemaJSON = """
{
    "$id": "urn:example:greeting",
    "name": "Greeting",
    "type": "string"
}
"""

let schemaValidator = SchemaValidator()
let schemaResult = try schemaValidator.validateJSONString(schemaJSON)

let instanceValidator = InstanceValidator()
let instanceResult = try instanceValidator.validateJSONStrings(
    "\"Hello, World!\"",
    schemaString: schemaJSON
)
```

### Extended Validation

Enable extended validation features for constraint keywords:

```swift
import JSONStructure

let schema: [String: Any] = [
    "$id": "urn:example:username",
    "$uses": ["JSONStructureValidation"],
    "name": "Username",
    "type": "string",
    "minLength": 3,
    "maxLength": 20,
    "pattern": "^[a-zA-Z][a-zA-Z0-9_]*$"
]

let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
let result = validator.validate("user123", schema: schema)
```

### Conditional Composition

Use allOf, anyOf, oneOf, not, and if/then/else:

```swift
import JSONStructure

let schema: [String: Any] = [
    "$id": "urn:example:stringOrNumber",
    "$uses": ["JSONStructureConditionalComposition"],
    "name": "StringOrNumber",
    "anyOf": [
        ["type": "string"],
        ["type": "int32"]
    ]
]

let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))

// Both are valid
let result1 = validator.validate("hello", schema: schema)  // valid
let result2 = validator.validate(42, schema: schema)       // valid
let result3 = validator.validate(true, schema: schema)     // invalid
```

## Supported Types

### Primitive Types

| Type | Description |
|------|-------------|
| `string` | UTF-8 string |
| `boolean` | `true` or `false` |
| `null` | Null value |
| `number` | Any JSON number |
| `integer` | Alias for int32 |
| `int8`, `int16`, `int32`, `int64`, `int128` | Signed integers |
| `uint8`, `uint16`, `uint32`, `uint64`, `uint128` | Unsigned integers |
| `float`, `float8`, `double`, `decimal` | Floating-point numbers |
| `date` | Date in YYYY-MM-DD format |
| `time` | Time in HH:MM:SS format |
| `datetime` | ISO 8601 datetime |
| `duration` | ISO 8601 duration |
| `uuid` | RFC 9562 UUID |
| `uri` | RFC 3986 URI |
| `binary` | Base64-encoded bytes |
| `jsonpointer` | RFC 6901 JSON Pointer |

### Compound Types

| Type | Description |
|------|-------------|
| `object` | JSON object with typed properties |
| `array` | Homogeneous list |
| `set` | Unique homogeneous list |
| `map` | Dictionary with string keys |
| `tuple` | Fixed-length typed array |
| `choice` | Discriminated union |
| `any` | Any JSON value |

## Error Codes

The SDK uses standardized error codes for consistent error reporting. Common error codes include:

### Schema Errors
- `SCHEMA_TYPE_INVALID` - Invalid type name
- `SCHEMA_REF_NOT_FOUND` - $ref target does not exist
- `SCHEMA_ARRAY_MISSING_ITEMS` - Array requires 'items' schema
- `SCHEMA_MAP_MISSING_VALUES` - Map requires 'values' schema

### Instance Errors
- `INSTANCE_TYPE_MISMATCH` - Value does not match expected type
- `INSTANCE_REQUIRED_PROPERTY_MISSING` - Required property is missing
- `INSTANCE_ENUM_MISMATCH` - Value not in enum
- `INSTANCE_CONST_MISMATCH` - Value does not match const

## API Reference

### SchemaValidator

```swift
public class SchemaValidator {
    public init(options: SchemaValidatorOptions = SchemaValidatorOptions())
    public func validate(_ schema: Any) -> ValidationResult
    public func validateJSON(_ jsonData: Data) throws -> ValidationResult
    public func validateJSONString(_ jsonString: String) throws -> ValidationResult
}
```

### InstanceValidator

```swift
public class InstanceValidator {
    public init(options: InstanceValidatorOptions = InstanceValidatorOptions())
    public func validate(_ instance: Any, schema: Any) -> ValidationResult
    public func validateJSON(_ instanceData: Data, schemaData: Data) throws -> ValidationResult
    public func validateJSONStrings(_ instanceString: String, schemaString: String) throws -> ValidationResult
}
```

### ValidationResult

```swift
public struct ValidationResult {
    public let isValid: Bool
    public let errors: [ValidationError]
    public let warnings: [ValidationError]
}
```

### ValidationError

```swift
public struct ValidationError {
    public let code: String
    public let message: String
    public let path: String
    public let severity: ValidationSeverity
    public let location: JsonLocation
}
```

## License

MIT License - see [LICENSE](../LICENSE) for details.

## Related Resources

- [JSON Structure Specification](https://json-structure.github.io/core/)
- [SDK Guidelines](../SDK-GUIDELINES.md)
- [Test Assets](../test-assets/)
