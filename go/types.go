// Package jsonstructure provides validators for JSON Structure schemas and instances.
package jsonstructure

// ValidationResult represents the result of a validation operation.
type ValidationResult struct {
	// IsValid indicates whether the validation passed.
	IsValid bool `json:"isValid"`
	// Errors contains validation errors (empty if valid).
	Errors []ValidationError `json:"errors"`
}

// ValidationError represents a single validation error.
type ValidationError struct {
	// Path is the JSON Pointer path to the error location.
	Path string `json:"path"`
	// Message is a human-readable error description.
	Message string `json:"message"`
	// Code is an optional error code for programmatic handling.
	Code string `json:"code,omitempty"`
}

// SchemaValidatorOptions configures schema validation.
type SchemaValidatorOptions struct {
	// Extended enables extended validation features.
	Extended bool
}

// InstanceValidatorOptions configures instance validation.
type InstanceValidatorOptions struct {
	// Extended enables extended validation features (minLength, pattern, etc.).
	Extended bool
	// AllowImport enables processing of $import/$importdefs.
	AllowImport bool
}

// PrimitiveTypes lists all primitive types supported by JSON Structure Core.
var PrimitiveTypes = []string{
	"string", "boolean", "null",
	"int8", "uint8", "int16", "uint16", "int32", "uint32",
	"int64", "uint64", "int128", "uint128",
	"float", "float8", "double", "decimal",
	"number", "integer",
	"date", "datetime", "time", "duration",
	"uuid", "uri", "binary", "jsonpointer",
}

// CompoundTypes lists all compound types supported by JSON Structure Core.
var CompoundTypes = []string{
	"object", "array", "set", "map", "tuple", "choice", "any",
}

// AllTypes lists all valid JSON Structure types.
var AllTypes = append(append([]string{}, PrimitiveTypes...), CompoundTypes...)

// NumericTypes lists all numeric types.
var NumericTypes = []string{
	"number", "integer", "float", "double", "decimal", "float8",
	"int8", "uint8", "int16", "uint16", "int32", "uint32",
	"int64", "uint64", "int128", "uint128",
}

// isValidType checks if a type name is valid.
func isValidType(t string) bool {
	for _, valid := range AllTypes {
		if t == valid {
			return true
		}
	}
	return false
}

// isNumericType checks if a type is numeric.
func isNumericType(t string) bool {
	for _, num := range NumericTypes {
		if t == num {
			return true
		}
	}
	return false
}
