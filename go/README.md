# JSON Structure SDK for Go

A Go implementation of validators for [JSON Structure](https://json-structure.org) schemas and instances.

## Installation

```bash
go get github.com/json-structure/sdk/go
```

## Thread Safety

Both `SchemaValidator` and `InstanceValidator` are **safe for concurrent use** from multiple goroutines after construction. A single validator instance can be shared across goroutines to validate multiple schemas or instances simultaneously without risk of data races or error leakage between validations.

```go
// Create a single validator instance
validator := jsonstructure.NewInstanceValidator(&jsonstructure.InstanceValidatorOptions{
    Extended: true,
})

// Safe to use from multiple goroutines concurrently
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        result := validator.Validate(instance, schema)
        // Process result...
    }()
}
wg.Wait()
```

This design follows idiomatic Go patterns where validators maintain only immutable configuration state after construction, while all mutable validation state is managed internally within each validation operation.

## Usage

### Schema Validation

Validate a JSON Structure schema document:

```go
package main

import (
	"encoding/json"
	"fmt"

	jsonstructure "github.com/json-structure/sdk/go"
)

func main() {
	// Parse a schema
	schemaJSON := `{
		"type": "object",
		"properties": {
			"name": { "type": "string", "maxLength": 100 },
			"age": { "type": "int8" }
		},
		"required": ["name"]
	}`

	var schema map[string]interface{}
	json.Unmarshal([]byte(schemaJSON), &schema)

	// Validate the schema
	options := &jsonstructure.SchemaValidatorOptions{
		EnabledExtensions: map[string]bool{
			"JSONStructureValidation": true,
		},
	}
	validator := jsonstructure.NewSchemaValidator(options)

	result := validator.Validate(schema)

	if result.IsValid {
		fmt.Println("Schema is valid!")
	} else {
		fmt.Println("Schema validation errors:")
		for _, err := range result.Errors {
			fmt.Printf("  %s: %s\n", err.Path, err.Message)
		}
	}
}
```

### Instance Validation

Validate a JSON instance against a schema:

```go
package main

import (
	"fmt"

	jsonstructure "github.com/json-structure/sdk/go"
)

func main() {
	// Define a schema
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"name": map[string]interface{}{
				"type":      "string",
				"maxLength": float64(100),
			},
			"age": map[string]interface{}{
				"type":    "int8",
				"minimum": float64(0),
				"maximum": float64(120),
			},
			"email": map[string]interface{}{
				"type": "string",
			},
		},
		"required": []interface{}{"name", "email"},
	}

	// Create an instance validator with extended validation enabled
	options := &jsonstructure.InstanceValidatorOptions{
		EnabledExtensions: map[string]bool{
			"JSONStructureValidation": true,
		},
	}
	validator := jsonstructure.NewInstanceValidator(options)

	// Valid instance
	validInstance := map[string]interface{}{
		"name":  "Alice",
		"age":   float64(30),
		"email": "alice@example.com",
	}

	result := validator.Validate(validInstance, schema)
	if result.IsValid {
		fmt.Println("Instance is valid!")
	}

	// Invalid instance (missing required field, age out of range)
	invalidInstance := map[string]interface{}{
		"name": "Bob",
		"age":  float64(150),
	}

	result = validator.Validate(invalidInstance, schema)
	if !result.IsValid {
		fmt.Println("Instance validation errors:")
		for _, err := range result.Errors {
			fmt.Printf("  %s: %s\n", err.Path, err.Message)
		}
	}
}
```

### JSON String Validation

Validate JSON strings directly using the convenience methods:

```go
package main

import (
	"fmt"

	jsonstructure "github.com/json-structure/sdk/go"
)

func main() {
	schemaJSON := []byte(`{
		"type": "object",
		"properties": {
			"name": {"type": "string"},
			"age": {"type": "int32"}
		},
		"required": ["name"]
	}`)

	instanceJSON := []byte(`{"name": "Alice", "age": 30}`)

	validator := jsonstructure.NewInstanceValidator(nil)
	result, err := validator.ValidateJSON(instanceJSON, schemaJSON)
	if err != nil {
		fmt.Printf("JSON parse error: %v\n", err)
		return
	}

	fmt.Printf("Valid: %v\n", result.IsValid)
}
```

## Serialization Helpers

The SDK provides wrapper types for correct JSON Structure serialization. Per the spec, certain types must be serialized as strings because JSON numbers (IEEE 754 double) cannot accurately represent their full range.

### Types that serialize as strings:
- `Int64String`, `UInt64String` - 64-bit integers as strings
- `BigIntString` - 128-bit integers (`*big.Int`) as strings
- `DecimalString` - Decimal numbers as strings
- `Duration` - ISO 8601 duration format (e.g., "PT1H30M")
- `Date`, `TimeOfDay`, `DateTime` - ISO 8601/RFC 3339 formats
- `Binary` - Base64 encoded
- `UUID`, `URI`, `JSONPointer` - String representations

### Example Usage

```go
package main

import (
	"encoding/json"
	"fmt"
	"time"

	js "github.com/json-structure/sdk/go"
)

type Person struct {
	Name      string          `json:"name"`
	ID        js.Int64String  `json:"id"`        // Serializes as "9223372036854775807"
	Balance   js.BigIntString `json:"balance"`   // Large int as string
	BirthDate js.Date         `json:"birthDate"` // "2000-01-15"
	Duration  js.Duration     `json:"duration"`  // "PT1H30M"
	Data      js.Binary       `json:"data"`      // Base64 encoded
}

func main() {
	bigInt, _ := js.NewBigIntStringFromString("170141183460469231731687303715884105727")
	
	p := Person{
		Name:      "Alice",
		ID:        js.Int64String(9223372036854775807),
		Balance:   bigInt,
		BirthDate: js.NewDate(2000, time.January, 15),
		Duration:  js.Duration(time.Hour + 30*time.Minute),
		Data:      js.Binary([]byte("Hello")),
	}

	data, _ := json.Marshal(p)
	fmt.Println(string(data))
	// Output: {"name":"Alice","id":"9223372036854775807","balance":"170141183460469231731687303715884105727","birthDate":"2000-01-15","duration":"PT1H30M","data":"SGVsbG8="}

	// Round-trip deserialization
	var p2 Person
	json.Unmarshal(data, &p2)
	fmt.Printf("ID: %d\n", p2.ID.Value()) // ID: 9223372036854775807
}
```
```

## Sideloading External Schemas

When using `$import` to reference external schemas, you can provide those schemas
directly instead of fetching them from URIs:

```go
package main

import (
	"fmt"

	jsonstructure "github.com/json-structure/sdk/go"
)

func main() {
	// External schema that would normally be fetched
	addressSchema := map[string]interface{}{
		"$schema": "https://json-structure.org/meta/core/v0/#",
		"$id":     "https://example.com/address.json",
		"type":    "object",
		"properties": map[string]interface{}{
			"street": map[string]interface{}{"type": "string"},
			"city":   map[string]interface{}{"type": "string"},
		},
	}

	// Main schema that imports the address schema
	mainSchema := map[string]interface{}{
		"$schema": "https://json-structure.org/meta/core/v0/#",
		"type":    "object",
		"properties": map[string]interface{}{
			"name":    map[string]interface{}{"type": "string"},
			"address": map[string]interface{}{"type": map[string]interface{}{"$ref": "#/definitions/Imported/Address"}},
		},
		"definitions": map[string]interface{}{
			"Imported": map[string]interface{}{
				"$import": "https://example.com/address.json",
			},
		},
	}

	// Sideload the address schema - keyed by URI
	options := &jsonstructure.SchemaValidatorOptions{
		AllowImport: true,
		ExternalSchemas: map[string]interface{}{
			"https://example.com/address.json": addressSchema,
		},
	}
	validator := jsonstructure.NewSchemaValidator(options)

	result := validator.Validate(mainSchema)
	fmt.Printf("Valid: %v\n", result.IsValid)
}
```

## API Reference

### Types

#### ValidationResult

```go
type ValidationResult struct {
	IsValid bool              // Whether validation passed
	Errors  []ValidationError // List of validation errors
}
```

#### ValidationError

```go
type ValidationError struct {
	Path    string // JSON Pointer path to the error
	Message string // Human-readable error description
}
```

#### SchemaValidatorOptions

```go
type SchemaValidatorOptions struct {
	EnabledExtensions map[string]bool            // e.g., {"JSONStructureValidation": true}
	AllowImport       bool                       // Enable $import/$importdefs processing
	ExternalSchemas   map[string]interface{}     // URI to schema map for import resolution
}
```

#### InstanceValidatorOptions

```go
type InstanceValidatorOptions struct {
	EnabledExtensions map[string]bool            // Enable extended validation features
	AllowImport       bool                       // Enable $import/$importdefs processing
	ExternalSchemas   map[string]interface{}     // URI to schema map for import resolution
}
```

### SchemaValidator

```go
func NewSchemaValidator(options *SchemaValidatorOptions) *SchemaValidator
func (v *SchemaValidator) Validate(schema interface{}) ValidationResult
func (v *SchemaValidator) ValidateJSON(schemaData []byte) (ValidationResult, error)
```

### InstanceValidator

```go
func NewInstanceValidator(options *InstanceValidatorOptions) *InstanceValidator
func (v *InstanceValidator) Validate(instance interface{}, schema interface{}) ValidationResult
func (v *InstanceValidator) ValidateJSON(instanceData, schemaData []byte) (ValidationResult, error)
```

## Supported Types

### Primitive Types

- `string` - Unicode string
- `boolean` - true/false
- `null` - null value
- `int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`, `int64`, `uint64`, `int128`, `uint128` - Fixed-size integers
- `float`, `float8`, `double`, `decimal` - Floating-point numbers
- `number`, `integer` - Generic numeric types
- `date`, `datetime`, `time`, `duration` - Temporal types (ISO 8601)
- `uuid` - UUID (RFC 4122)
- `uri` - URI (RFC 3986)
- `binary` - Base64-encoded binary
- `jsonpointer` - JSON Pointer (RFC 6901)

### Compound Types

- `object` - Object with typed properties
- `array` - Homogeneous array
- `set` - Array with unique items
- `map` - Key-value pairs
- `tuple` - Fixed-length heterogeneous array
- `choice` - Union type (matches one of several schemas)
- `any` - Any JSON value

## Constraints

### String Constraints

- `minLength` - Minimum string length
- `maxLength` - Maximum string length
- `pattern` - Regex pattern to match

### Numeric Constraints

- `minimum` - Minimum value (inclusive)
- `maximum` - Maximum value (inclusive)
- `exclusiveMinimum` - Minimum value (exclusive)
- `exclusiveMaximum` - Maximum value (exclusive)
- `multipleOf` - Value must be a multiple of this

### Array/Set Constraints

- `minItems` - Minimum number of items
- `maxItems` - Maximum number of items
- `uniqueItems` - Whether items must be unique (implicit for `set`)

### Object Constraints

- `required` - Required property names
- `additionalProperties` - Allow additional properties

### General Constraints

- `enum` - Allowed values
- `const` - Single allowed value

## Schema Composition

- `allOf` - Must match all schemas
- `anyOf` - Must match at least one schema
- `oneOf` - Must match exactly one schema
- `not` - Must not match schema
- `if`/`then`/`else` - Conditional validation

## References

- `$ref` - Reference to another schema (JSON Pointer)
- `definitions` - Schema definitions (type namespace hierarchy)

## Development

### Running Tests

```bash
go test ./...
```

### Running Tests with Coverage

```bash
go test -cover ./...
```

## License

MIT License - see [LICENSE](../LICENSE) for details.
