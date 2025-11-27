// Package jsonstructure provides validators for JSON Structure schemas and instances.
//
// JSON Structure is a type system for JSON that provides precise data typing
// with support for numeric types (int8, int16, int32, int64, uint8, uint16,
// uint32, uint64, float32, float64, decimal, integer), temporal types (datetime,
// date, time, duration), and structured types (object, array, tuple, map, set, union).
//
// # Schema Validation
//
// Use SchemaValidator to validate JSON Structure schema documents:
//
//	validator := jsonstructure.NewSchemaValidator(nil)
//	result := validator.Validate(schemaMap)
//	if result.Valid {
//	    // Schema is valid
//	}
//
// # Instance Validation
//
// Use InstanceValidator to validate JSON instances against schemas:
//
//	validator := jsonstructure.NewInstanceValidator(nil)
//	result := validator.Validate(instance, schema)
//	if result.Valid {
//	    // Instance conforms to schema
//	}
//
// # Serialization
//
// The package provides JSON marshaling/unmarshaling that preserves precision
// for large integers by serializing them as strings:
//
//	data := jsonstructure.LargeIntData{Value: "9223372036854775807"}
//	jsonBytes, _ := json.Marshal(data)
//
// For more information, see https://json-structure.org
package jsonstructure
