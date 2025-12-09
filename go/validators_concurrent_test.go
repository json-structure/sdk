package jsonstructure

import (
	"sync"
	"testing"
)

// TestInstanceValidatorConcurrency tests that InstanceValidator is safe for concurrent use.
func TestInstanceValidatorConcurrency(t *testing.T) {
	schema := map[string]interface{}{
		"$id":  "urn:example:test-schema",
		"name": "TestType",
		"type": "object",
		"properties": map[string]interface{}{
			"name": map[string]interface{}{
				"type": "string",
			},
			"age": map[string]interface{}{
				"type": "int32",
			},
		},
		"required": []interface{}{"name"},
	}

	// Create a single validator instance to be shared
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	// Number of concurrent goroutines
	const numGoroutines = 100

	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	// Track errors from goroutines
	errorChan := make(chan error, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()

			// Valid instance
			validInstance := map[string]interface{}{
				"name": "John",
				"age":  float64(30 + id), // Vary the data slightly
			}

			result := validator.Validate(validInstance, schema)
			if !result.IsValid {
				t.Errorf("Goroutine %d: Expected valid instance, got errors: %v", id, result.Errors)
			}

			// Invalid instance (missing required field)
			invalidInstance := map[string]interface{}{
				"age": float64(30 + id),
			}

			result = validator.Validate(invalidInstance, schema)
			if result.IsValid {
				t.Errorf("Goroutine %d: Expected invalid instance, but validation passed", id)
			}
			if len(result.Errors) == 0 {
				t.Errorf("Goroutine %d: Expected errors for invalid instance, got none", id)
			}
		}(i)
	}

	wg.Wait()
	close(errorChan)
}

// TestInstanceValidatorConcurrencyNoErrorLeakage tests that validation errors don't leak between concurrent validations.
func TestInstanceValidatorConcurrencyNoErrorLeakage(t *testing.T) {
	schema := map[string]interface{}{
		"$id":  "urn:example:test-schema",
		"name": "TestType",
		"type": "object",
		"properties": map[string]interface{}{
			"value": map[string]interface{}{
				"type": "int32",
			},
		},
		"required": []interface{}{"value"},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	const numGoroutines = 50

	var wg sync.WaitGroup
	wg.Add(numGoroutines * 2) // Each goroutine runs twice

	for i := 0; i < numGoroutines; i++ {
		// Goroutines validating valid instances (should have 0 errors)
		go func(id int) {
			defer wg.Done()
			validInstance := map[string]interface{}{
				"value": float64(id),
			}
			result := validator.Validate(validInstance, schema)
			if !result.IsValid {
				t.Errorf("Valid instance failed validation in goroutine %d", id)
			}
			if len(result.Errors) != 0 {
				t.Errorf("Goroutine %d: Valid instance has %d errors (error leakage?): %v", id, len(result.Errors), result.Errors)
			}
		}(i)

		// Goroutines validating invalid instances (should have exactly 1 error)
		go func(id int) {
			defer wg.Done()
			invalidInstance := map[string]interface{}{
				"wrongField": "value",
			}
			result := validator.Validate(invalidInstance, schema)
			if result.IsValid {
				t.Errorf("Invalid instance passed validation in goroutine %d", id)
			}
			if len(result.Errors) != 1 {
				t.Errorf("Goroutine %d: Invalid instance has %d errors, expected 1 (error leakage?): %v", id, len(result.Errors), result.Errors)
			}
		}(i)
	}

	wg.Wait()
}

// TestSchemaValidatorConcurrency tests that SchemaValidator is safe for concurrent use.
func TestSchemaValidatorConcurrency(t *testing.T) {
	// Create a single validator instance to be shared
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	const numGoroutines = 100

	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()

			// Valid schema
			validSchema := map[string]interface{}{
				"$id":  "urn:example:test-schema",
				"name": "TestType",
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type": "string",
					},
				},
			}

			result := validator.Validate(validSchema)
			if !result.IsValid {
				t.Errorf("Goroutine %d: Expected valid schema, got errors: %v", id, result.Errors)
			}

			// Invalid schema (missing type)
			invalidSchema := map[string]interface{}{
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type": "string",
					},
				},
			}

			result = validator.Validate(invalidSchema)
			if result.IsValid {
				t.Errorf("Goroutine %d: Expected invalid schema, but validation passed", id)
			}
		}(i)
	}

	wg.Wait()
}

// TestSchemaValidatorConcurrencyNoErrorLeakage tests that schema validation errors don't leak between concurrent validations.
func TestSchemaValidatorConcurrencyNoErrorLeakage(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	const numGoroutines = 50

	var wg sync.WaitGroup
	wg.Add(numGoroutines * 2)

	for i := 0; i < numGoroutines; i++ {
		// Goroutines validating valid schemas (should have 0 errors)
		go func(id int) {
			defer wg.Done()
			validSchema := map[string]interface{}{
				"$id":  "urn:example:test-schema",
				"name": "TestType",
				"type": "string",
			}
			result := validator.Validate(validSchema)
			if !result.IsValid {
				t.Errorf("Valid schema failed validation in goroutine %d", id)
			}
			if len(result.Errors) != 0 {
				t.Errorf("Goroutine %d: Valid schema has %d errors (error leakage?): %v", id, len(result.Errors), result.Errors)
			}
		}(i)

		// Goroutines validating invalid schemas (should have errors)
		go func(id int) {
			defer wg.Done()
			invalidSchema := map[string]interface{}{
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type": "unknown_type",
					},
				},
			}
			result := validator.Validate(invalidSchema)
			if result.IsValid {
				t.Errorf("Invalid schema passed validation in goroutine %d", id)
			}
			// Should have at least 1 error
			if len(result.Errors) == 0 {
				t.Errorf("Goroutine %d: Invalid schema has 0 errors", id)
			}
		}(i)
	}

	wg.Wait()
}

// TestValidateJSONConcurrency tests that ValidateJSON methods are safe for concurrent use.
func TestValidateJSONConcurrency(t *testing.T) {
	instanceValidator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	schemaJSON := []byte(`{
		"$id": "urn:example:test-schema",
		"name": "TestType",
		"type": "object",
		"properties": {
			"name": {"type": "string"}
		},
		"required": ["name"]
	}`)

	const numGoroutines = 50

	var wg sync.WaitGroup
	wg.Add(numGoroutines * 2)

	for i := 0; i < numGoroutines; i++ {
		// Valid JSON
		go func(id int) {
			defer wg.Done()
			validJSON := []byte(`{"name": "John"}`)
			result, err := instanceValidator.ValidateJSON(validJSON, schemaJSON)
			if err != nil {
				t.Errorf("Goroutine %d: Unexpected error: %v", id, err)
			}
			if !result.IsValid {
				t.Errorf("Goroutine %d: Expected valid JSON, got errors: %v", id, result.Errors)
			}
			if len(result.Errors) != 0 {
				t.Errorf("Goroutine %d: Valid JSON has errors (error leakage?): %v", id, result.Errors)
			}
		}(i)

		// Invalid JSON
		go func(id int) {
			defer wg.Done()
			invalidJSON := []byte(`{"age": 30}`) // missing required field
			result, err := instanceValidator.ValidateJSON(invalidJSON, schemaJSON)
			if err != nil {
				t.Errorf("Goroutine %d: Unexpected error: %v", id, err)
			}
			if result.IsValid {
				t.Errorf("Goroutine %d: Expected invalid JSON, but validation passed", id)
			}
			if len(result.Errors) != 1 {
				t.Errorf("Goroutine %d: Invalid JSON has %d errors, expected 1: %v", id, len(result.Errors), result.Errors)
			}
		}(i)
	}

	wg.Wait()
}
