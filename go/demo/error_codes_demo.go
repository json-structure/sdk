// Go SDK - Error Codes Demo
//
// This demo shows how error codes and source locations are included in validation errors.
package main

import (
	"fmt"
	"strings"

	jsonstructure "github.com/json-structure/sdk/go"
)

func main() {
	fmt.Println("=== JSON Structure Go SDK - Error Codes Demo ===")
	fmt.Println()

	// Test 1: Instance validation errors
	fmt.Println("--- Instance Validation Errors ---")
	fmt.Println()

	schemaJSON := `{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "type": "object",
    "properties": {
        "name": { "type": "string" },
        "age": { "type": "int32" }
    },
    "required": ["name", "age"]
}`

	instanceJSON := `{
    "name": 123,
    "extra": "property"
}`

	fmt.Println("Instance JSON:")
	lines := strings.Split(instanceJSON, "\n")
	for i, line := range lines {
		fmt.Printf("  Line %d: %s\n", i+1, line)
	}
	fmt.Println()

	// Use ValidateJSON to get source locations (not Validate with parsed objects)
	instanceValidator := jsonstructure.NewInstanceValidator(nil)
	result, err := instanceValidator.ValidateJSON([]byte(instanceJSON), []byte(schemaJSON))
	if err != nil {
		fmt.Printf("Parse error: %v\n", err)
		return
	}

	fmt.Printf("Valid: %v\n\n", result.IsValid)
	fmt.Println("Errors with error codes:")
	fmt.Println(strings.Repeat("-", 80))

	for _, err := range result.Errors {
		fmt.Printf("  Error: %s\n", err.Message)
		fmt.Printf("         → Code:     %s\n", err.Code)
		fmt.Printf("         → Path:     %s\n", err.Path)
		if err.Location.IsKnown() {
			fmt.Printf("         → Location: Line %d, Column %d\n", err.Location.Line, err.Location.Column)
		}
		fmt.Println()
	}

	// Test 2: Schema validation errors
	fmt.Println()
	fmt.Println("--- Schema Validation Errors ---")
	fmt.Println()

	badSchemaJSON := `{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "type": "object",
    "properties": {
        "count": { "type": "integer" }
    },
    "required": ["missing_property"]
}`

	fmt.Println("Bad Schema:")
	schemaLines := strings.Split(badSchemaJSON, "\n")
	for i, line := range schemaLines {
		fmt.Printf("  Line %d: %s\n", i+1, line)
	}
	fmt.Println()

	// Use ValidateJSON to get source locations
	schemaValidator := jsonstructure.NewSchemaValidator(nil)
	schemaResult, err := schemaValidator.ValidateJSON([]byte(badSchemaJSON))
	if err != nil {
		fmt.Printf("Parse error: %v\n", err)
		return
	}

	fmt.Printf("Valid: %v\n\n", schemaResult.IsValid)
	fmt.Println("Errors with error codes:")
	fmt.Println(strings.Repeat("-", 80))

	for _, err := range schemaResult.Errors {
		fmt.Printf("  Error: %s\n", err.Message)
		fmt.Printf("         → Code:     %s\n", err.Code)
		fmt.Printf("         → Path:     %s\n", err.Path)
		if err.Location.IsKnown() {
			fmt.Printf("         → Location: Line %d, Column %d\n", err.Location.Line, err.Location.Column)
		}
		fmt.Println()
	}

	// Test 3: Show available error codes
	fmt.Println()
	fmt.Println("--- Available Error Codes (sample) ---")
	fmt.Println()
	fmt.Println("Schema Error Codes:")
	fmt.Printf("  SchemaNull = \"%s\"\n", jsonstructure.SchemaNull)
	fmt.Printf("  SchemaInvalidType = \"%s\"\n", jsonstructure.SchemaInvalidType)
	fmt.Printf("  SchemaRefNotFound = \"%s\"\n", jsonstructure.SchemaRefNotFound)
	fmt.Printf("  SchemaMinGreaterThanMax = \"%s\"\n", jsonstructure.SchemaMinGreaterThanMax)

	fmt.Println()
	fmt.Println("Instance Error Codes:")
	fmt.Printf("  InstanceStringMinLength = \"%s\"\n", jsonstructure.InstanceStringMinLength)
	fmt.Printf("  InstanceRequiredPropertyMissing = \"%s\"\n", jsonstructure.InstanceRequiredPropertyMissing)
	fmt.Printf("  InstanceTypeMismatch = \"%s\"\n", jsonstructure.InstanceTypeMismatch)
	fmt.Printf("  InstanceStringPatternMismatch = \"%s\"\n", jsonstructure.InstanceStringPatternMismatch)

	fmt.Println()
	fmt.Println("=== Demo Complete ===")
}
