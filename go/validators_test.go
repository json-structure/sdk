package jsonstructure

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSchemaValidatorValid tests that valid schemas pass validation.
func TestSchemaValidatorValid(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	// Simple valid schema
	schema := map[string]interface{}{
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

	result := validator.Validate(schema)
	if !result.IsValid {
		t.Errorf("Expected valid schema, got errors: %v", result.Errors)
	}
}

// TestSchemaValidatorMissingType tests that schemas without type fail.
func TestSchemaValidatorMissingType(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	schema := map[string]interface{}{
		"properties": map[string]interface{}{
			"name": map[string]interface{}{
				"type": "string",
			},
		},
	}

	result := validator.Validate(schema)
	if result.IsValid {
		t.Errorf("Expected invalid schema (missing type)")
	}
}

// TestSchemaValidatorUnknownType tests that unknown types fail.
func TestSchemaValidatorUnknownType(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	schema := map[string]interface{}{
		"type": "foobar",
	}

	result := validator.Validate(schema)
	if result.IsValid {
		t.Errorf("Expected invalid schema (unknown type)")
	}
}

// TestInstanceValidatorValid tests that valid instances pass validation.
func TestInstanceValidatorValid(t *testing.T) {
	schema := map[string]interface{}{
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

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	instance := map[string]interface{}{
		"name": "John",
		"age":  float64(30),
	}

	result := validator.Validate(instance, schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance, got errors: %v", result.Errors)
	}
}

// TestInstanceValidatorMissingRequired tests that missing required fields fail.
func TestInstanceValidatorMissingRequired(t *testing.T) {
	schema := map[string]interface{}{
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

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	instance := map[string]interface{}{
		"age": float64(30),
	}

	result := validator.Validate(instance, schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (missing required field)")
	}
}

// TestInstanceValidatorWrongType tests that wrong types fail.
func TestInstanceValidatorWrongType(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"age": map[string]interface{}{
				"type": "int32",
			},
		},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	instance := map[string]interface{}{
		"age": "not a number",
	}

	result := validator.Validate(instance, schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (wrong type)")
	}
}

// TestInstanceValidatorMinimum tests minimum constraint.
func TestInstanceValidatorMinimum(t *testing.T) {
	schema := map[string]interface{}{
		"type":    "int32",
		"minimum": float64(10),
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	// Valid
	result := validator.Validate(float64(15), schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (15 >= 10)")
	}

	// Invalid
	result = validator.Validate(float64(5), schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (5 < 10)")
	}
}

// TestInstanceValidatorMaxLength tests maxLength constraint.
func TestInstanceValidatorMaxLength(t *testing.T) {
	schema := map[string]interface{}{
		"type":      "string",
		"maxLength": float64(5),
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	// Valid
	result := validator.Validate("hello", schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (len=5 <= 5)")
	}

	// Invalid
	result = validator.Validate("hello world", schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (len=11 > 5)")
	}
}

// TestInstanceValidatorPattern tests pattern constraint.
func TestInstanceValidatorPattern(t *testing.T) {
	schema := map[string]interface{}{
		"type":    "string",
		"pattern": "^[a-z]+$",
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	// Valid
	result := validator.Validate("abc", schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (matches pattern)")
	}

	// Invalid
	result = validator.Validate("ABC123", schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (does not match pattern)")
	}
}

// TestInstanceValidatorEnum tests enum constraint.
func TestInstanceValidatorEnum(t *testing.T) {
	schema := map[string]interface{}{
		"type": "string",
		"enum": []interface{}{"red", "green", "blue"},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	// Valid
	result := validator.Validate("red", schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (in enum)")
	}

	// Invalid
	result = validator.Validate("yellow", schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (not in enum)")
	}
}

// TestInstanceValidatorArray tests array validation.
func TestInstanceValidatorArray(t *testing.T) {
	schema := map[string]interface{}{
		"type": "array",
		"items": map[string]interface{}{
			"type": "string",
		},
		"minItems": float64(1),
		"maxItems": float64(3),
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	// Valid
	result := validator.Validate([]interface{}{"a", "b"}, schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (2 items)")
	}

	// Invalid - too few
	result = validator.Validate([]interface{}{}, schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (0 items, minItems=1)")
	}

	// Invalid - too many
	result = validator.Validate([]interface{}{"a", "b", "c", "d"}, schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (4 items, maxItems=3)")
	}

	// Invalid - wrong item type
	result = validator.Validate([]interface{}{"a", float64(123)}, schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (number in string array)")
	}
}

// TestInstanceValidatorRef tests $ref resolution.
func TestInstanceValidatorRef(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"person": map[string]interface{}{
				"$ref": "#/definitions/Person",
			},
		},
		"definitions": map[string]interface{}{
			"Person": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type": "string",
					},
				},
				"required": []interface{}{"name"},
			},
		},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	// Valid
	result := validator.Validate(map[string]interface{}{
		"person": map[string]interface{}{
			"name": "John",
		},
	}, schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (ref resolved), got: %v", result.Errors)
	}

	// Invalid
	result = validator.Validate(map[string]interface{}{
		"person": map[string]interface{}{
			"age": float64(30),
		},
	}, schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (missing required in ref)")
	}
}

// TestInstanceValidatorAllOf tests allOf composition.
func TestInstanceValidatorAllOf(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"allOf": []interface{}{
			map[string]interface{}{
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type": "string",
					},
				},
				"required": []interface{}{"name"},
			},
			map[string]interface{}{
				"properties": map[string]interface{}{
					"age": map[string]interface{}{
						"type": "int32",
					},
				},
				"required": []interface{}{"age"},
			},
		},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	// Valid - has both
	result := validator.Validate(map[string]interface{}{
		"name": "John",
		"age":  float64(30),
	}, schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (satisfies all), got: %v", result.Errors)
	}

	// Invalid - missing age
	result = validator.Validate(map[string]interface{}{
		"name": "John",
	}, schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (missing age for allOf)")
	}
}

// TestInstanceValidatorOneOf tests oneOf composition.
func TestInstanceValidatorOneOf(t *testing.T) {
	schema := map[string]interface{}{
		"oneOf": []interface{}{
			map[string]interface{}{
				"type": "string",
			},
			map[string]interface{}{
				"type": "int32",
			},
		},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	// Valid - matches string
	result := validator.Validate("hello", schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (matches string)")
	}

	// Valid - matches int32
	result = validator.Validate(float64(42), schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (matches int32)")
	}

	// Invalid - matches neither (boolean)
	result = validator.Validate(true, schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (matches neither)")
	}
}

// TestInstanceValidatorChoice tests choice type.
func TestInstanceValidatorChoice(t *testing.T) {
	schema := map[string]interface{}{
		"type": "choice",
		"choices": map[string]interface{}{
			"text": map[string]interface{}{
				"type": "string",
			},
			"number": map[string]interface{}{
				"type": "int32",
			},
		},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	// Valid - tagged union with text
	result := validator.Validate(map[string]interface{}{
		"text": "hello",
	}, schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (text choice), got: %v", result.Errors)
	}

	// Valid - tagged union with number
	result = validator.Validate(map[string]interface{}{
		"number": float64(42),
	}, schema)
	if !result.IsValid {
		t.Errorf("Expected valid instance (number choice), got: %v", result.Errors)
	}

	// Invalid - unknown choice key
	result = validator.Validate(map[string]interface{}{
		"other": "value",
	}, schema)
	if result.IsValid {
		t.Errorf("Expected invalid instance (unknown choice key)")
	}
}

// getTestAssetsPath returns the path to test-assets directory.
func getTestAssetsPath() string {
	// Start from current directory and look for test-assets
	cwd, _ := os.Getwd()
	testAssetsPath := filepath.Join(cwd, "..", "test-assets")
	if _, err := os.Stat(testAssetsPath); err == nil {
		return testAssetsPath
	}
	// Try relative to sdk/go
	testAssetsPath = filepath.Join(cwd, "test-assets")
	if _, err := os.Stat(testAssetsPath); err == nil {
		return testAssetsPath
	}
	return ""
}

// getInvalidSchemaFiles returns all invalid schema files.
func getInvalidSchemaFiles() []string {
	testAssets := getTestAssetsPath()
	if testAssets == "" {
		return nil
	}
	invalidDir := filepath.Join(testAssets, "schemas", "invalid")
	files, _ := filepath.Glob(filepath.Join(invalidDir, "*.struct.json"))
	return files
}

// getInvalidInstanceDirs returns all directories with invalid instances.
func getInvalidInstanceDirs() []string {
	testAssets := getTestAssetsPath()
	if testAssets == "" {
		return nil
	}
	invalidDir := filepath.Join(testAssets, "instances", "invalid")
	entries, _ := os.ReadDir(invalidDir)
	var dirs []string
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, filepath.Join(invalidDir, e.Name()))
		}
	}
	return dirs
}

// getSamplesPath returns the path to primer-and-samples/samples/core.
func getSamplesPath() string {
	testAssets := getTestAssetsPath()
	if testAssets == "" {
		return ""
	}
	// test-assets is in sdk/, primer-and-samples is also in sdk/
	return filepath.Join(filepath.Dir(testAssets), "primer-and-samples", "samples", "core")
}

// TestInvalidSchemas tests that all invalid schemas in test-assets fail validation.
func TestInvalidSchemas(t *testing.T) {
	files := getInvalidSchemaFiles()
	if len(files) == 0 {
		t.Skip("No invalid schema files found")
	}

	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	for _, file := range files {
		name := filepath.Base(file)
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(file)
			if err != nil {
				t.Fatalf("Failed to read file: %v", err)
			}

			var schema map[string]interface{}
			if err := json.Unmarshal(data, &schema); err != nil {
				t.Fatalf("Failed to parse JSON: %v", err)
			}

			desc, _ := schema["description"].(string)
			result := validator.Validate(schema)

			if result.IsValid {
				t.Errorf("Schema %s should be invalid. Description: %s", name, desc)
			}
		})
	}
}

// TestInvalidInstances tests that all invalid instances in test-assets fail validation.
func TestInvalidInstances(t *testing.T) {
	dirs := getInvalidInstanceDirs()
	if len(dirs) == 0 {
		t.Skip("No invalid instance directories found")
	}

	samplesPath := getSamplesPath()
	if samplesPath == "" {
		t.Skip("Samples path not found")
	}

	for _, dir := range dirs {
		sampleName := filepath.Base(dir)

		// Find all instance files
		files, _ := filepath.Glob(filepath.Join(dir, "*.json"))

		for _, instanceFile := range files {
			instanceName := filepath.Base(instanceFile)
			t.Run(sampleName+"/"+instanceName, func(t *testing.T) {
				// Load instance
				data, err := os.ReadFile(instanceFile)
				if err != nil {
					t.Fatalf("Failed to read instance file: %v", err)
				}

				var rawInstance interface{}
				if err := json.Unmarshal(data, &rawInstance); err != nil {
					t.Fatalf("Failed to parse instance JSON: %v", err)
				}

				// For object instances, remove metadata fields
				var instance interface{} = rawInstance
				if instanceMap, ok := rawInstance.(map[string]interface{}); ok {
					cleanInstance := make(map[string]interface{})
					for k, v := range instanceMap {
						if !strings.HasPrefix(k, "_") {
							cleanInstance[k] = v
						}
					}
					instance = cleanInstance
				}

				// Load schema
				schemaPath := filepath.Join(samplesPath, sampleName, "schema.struct.json")
				schemaData, err := os.ReadFile(schemaPath)
				if err != nil {
					t.Skipf("Schema not found: %s", schemaPath)
				}

				var schema map[string]interface{}
				if err := json.Unmarshal(schemaData, &schema); err != nil {
					t.Fatalf("Failed to parse schema JSON: %v", err)
				}

				validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})
				result := validator.Validate(instance, schema)

				if result.IsValid {
					t.Errorf("Instance %s/%s should be invalid", sampleName, instanceName)
				}
			})
		}
	}
}

// TestInvalidSchemasCount verifies we have all expected invalid schemas.
func TestInvalidSchemasCount(t *testing.T) {
	files := getInvalidSchemaFiles()
	if len(files) == 0 {
		t.Skip("test-assets not found")
	}
	if len(files) < 25 {
		t.Errorf("Expected at least 25 invalid schemas, got %d", len(files))
	}
}

// TestInvalidInstancesCount verifies we have all expected invalid instance dirs.
func TestInvalidInstancesCount(t *testing.T) {
	dirs := getInvalidInstanceDirs()
	if len(dirs) == 0 {
		t.Skip("test-assets not found")
	}

	// Count all instance files
	total := 0
	for _, dir := range dirs {
		files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
		total += len(files)
	}

	if total < 20 {
		t.Errorf("Expected at least 20 invalid instances, got %d", total)
	}
}
