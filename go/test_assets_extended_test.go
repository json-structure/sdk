package jsonstructure

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ============================================================================
// Validation Schema and Instance Tests (test-assets/schemas/validation and test-assets/instances/validation)
// ============================================================================

// getValidationSchemaFiles returns all validation schema files.
func getValidationSchemaFiles() []string {
	testAssets := getTestAssetsPath()
	if testAssets == "" {
		return nil
	}
	validationDir := filepath.Join(testAssets, "schemas", "validation")
	files, _ := filepath.Glob(filepath.Join(validationDir, "*.struct.json"))
	return files
}

// getValidationInstanceDirs returns all directories with validation instances.
func getValidationInstanceDirs() []string {
	testAssets := getTestAssetsPath()
	if testAssets == "" {
		return nil
	}
	validationDir := filepath.Join(testAssets, "instances", "validation")
	entries, _ := os.ReadDir(validationDir)
	var dirs []string
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, filepath.Join(validationDir, e.Name()))
		}
	}
	return dirs
}

// getWarningSchemasFiles returns all warning schema files.
func getWarningSchemasFiles() []string {
	testAssets := getTestAssetsPath()
	if testAssets == "" {
		return nil
	}
	warningsDir := filepath.Join(testAssets, "schemas", "warnings")
	files, _ := filepath.Glob(filepath.Join(warningsDir, "*.struct.json"))
	return files
}

// TestValidationSchemas tests that all validation schemas are valid.
func TestValidationSchemas(t *testing.T) {
	files := getValidationSchemaFiles()
	if len(files) == 0 {
		t.Skip("No validation schema files found")
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

			result := validator.Validate(schema)

			if !result.IsValid {
				t.Errorf("Validation schema %s should be valid. Errors: %v", name, result.Errors)
			}
		})
	}
}

// TestValidationInstances tests all validation instance files.
func TestValidationInstances(t *testing.T) {
	dirs := getValidationInstanceDirs()
	if len(dirs) == 0 {
		t.Skip("No validation instance directories found")
	}

	testAssets := getTestAssetsPath()
	validationSchemasDir := filepath.Join(testAssets, "schemas", "validation")

	for _, dir := range dirs {
		categoryName := filepath.Base(dir)

		// Find matching schema
		schemaPath := filepath.Join(validationSchemasDir, categoryName+".struct.json")
		schemaData, err := os.ReadFile(schemaPath)
		if err != nil {
			// Skip if schema not found
			continue
		}

		var schema map[string]interface{}
		if err := json.Unmarshal(schemaData, &schema); err != nil {
			continue
		}

		// Find all instance files
		files, _ := filepath.Glob(filepath.Join(dir, "*.json"))

		for _, instanceFile := range files {
			instanceName := filepath.Base(instanceFile)
			t.Run(categoryName+"/"+instanceName, func(t *testing.T) {
				// Load instance
				data, err := os.ReadFile(instanceFile)
				if err != nil {
					t.Fatalf("Failed to read instance file: %v", err)
				}

				var rawInstance interface{}
				if err := json.Unmarshal(data, &rawInstance); err != nil {
					t.Fatalf("Failed to parse instance JSON: %v", err)
				}

				instanceMap, isMap := rawInstance.(map[string]interface{})
				if !isMap {
					// If not a map, use as-is
					t.Skipf("Instance is not a map, skipping")
					return
				}

				// Extract metadata
				expectedValid := false
				if v, ok := instanceMap["_expectedValid"].(bool); ok {
					expectedValid = v
				}
				expectedError := ""
				if v, ok := instanceMap["_expectedError"].(string); ok {
					expectedError = v
				}

				// Get instance for validation - either "value" or cleaned object
				var instance interface{}
				schemaType, _ := schema["type"].(string)
				valueWrapperTypes := []string{"string", "number", "integer", "boolean", "int8", "uint8",
					"int16", "uint16", "int32", "uint32", "float", "double", "decimal",
					"array", "set", "int64", "uint64"}

				if val, hasValue := instanceMap["value"]; hasValue && contains(valueWrapperTypes, schemaType) {
					instance = val
				} else {
					// Clean instance - remove metadata fields
					cleanInstance := make(map[string]interface{})
					for k, v := range instanceMap {
						if !strings.HasPrefix(k, "_") {
							cleanInstance[k] = v
						}
					}
					instance = cleanInstance
				}

				validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})
				result := validator.Validate(instance, schema)

				if expectedValid {
					if !result.IsValid {
						t.Errorf("Instance %s/%s should be VALID. Errors: %v", categoryName, instanceName, result.Errors)
					}
				} else {
					if result.IsValid {
						t.Errorf("Instance %s/%s should be INVALID", categoryName, instanceName)
					}
					if expectedError != "" {
						// Check if expected error code is present
						found := false
						for _, err := range result.Errors {
							if err.Code == expectedError {
								found = true
								break
							}
						}
						if !found {
							t.Errorf("Expected error code %s not found. Got: %v", expectedError, result.Errors)
						}
					}
				}
			})
		}
	}
}

// helper to check if slice contains value
func contains(slice []string, val string) bool {
	for _, s := range slice {
		if s == val {
			return true
		}
	}
	return false
}

// TestWarningSchemas tests that warning schemas produce appropriate warnings.
func TestWarningSchemas(t *testing.T) {
	files := getWarningSchemasFiles()
	if len(files) == 0 {
		t.Skip("No warning schema files found")
	}

	for _, file := range files {
		name := filepath.Base(file)
		hasUsesInName := strings.Contains(name, "with-uses")

		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(file)
			if err != nil {
				t.Fatalf("Failed to read file: %v", err)
			}

			var schema map[string]interface{}
			if err := json.Unmarshal(data, &schema); err != nil {
				t.Fatalf("Failed to parse JSON: %v", err)
			}

			validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})
			result := validator.Validate(schema)

			if !result.IsValid {
				t.Errorf("Warning schema %s should be valid. Errors: %v", name, result.Errors)
			}

			if hasUsesInName {
				// Schemas with $uses should NOT produce extension keyword warnings
				for _, w := range result.Warnings {
					if w.Code == SchemaExtensionKeywordNotEnabled {
						t.Errorf("Schema %s with $uses should not produce SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED warnings, but got: %v", name, w)
					}
				}
			} else {
				// Schemas without $uses SHOULD produce extension keyword warnings
				hasExtensionWarning := false
				for _, w := range result.Warnings {
					if w.Code == SchemaExtensionKeywordNotEnabled {
						hasExtensionWarning = true
						break
					}
				}
				if !hasExtensionWarning {
					t.Errorf("Schema %s without $uses should produce SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED warnings, but got none. Warnings: %v", name, result.Warnings)
				}
			}
		})
	}
}

// TestValidSamplesSchemas tests that all sample schemas from primer-and-samples are valid.
func TestValidSamplesSchemas(t *testing.T) {
	samplesPath := getSamplesPath()
	if samplesPath == "" {
		t.Skip("Samples path not found")
	}

	entries, err := os.ReadDir(samplesPath)
	if err != nil {
		t.Skip("Cannot read samples directory")
	}

	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		sampleName := entry.Name()
		schemaPath := filepath.Join(samplesPath, sampleName, "schema.struct.json")

		if _, err := os.Stat(schemaPath); os.IsNotExist(err) {
			continue
		}

		t.Run(sampleName, func(t *testing.T) {
			data, err := os.ReadFile(schemaPath)
			if err != nil {
				t.Fatalf("Failed to read schema file: %v", err)
			}

			var schema map[string]interface{}
			if err := json.Unmarshal(data, &schema); err != nil {
				t.Fatalf("Failed to parse schema JSON: %v", err)
			}

			result := validator.Validate(schema)

			if !result.IsValid {
				t.Errorf("Sample schema %s should be valid. Errors: %v", sampleName, result.Errors)
			}
		})
	}
}

// TestValidSamplesInstances tests that all valid sample instances pass validation.
func TestValidSamplesInstances(t *testing.T) {
	samplesPath := getSamplesPath()
	if samplesPath == "" {
		t.Skip("Samples path not found")
	}

	entries, err := os.ReadDir(samplesPath)
	if err != nil {
		t.Skip("Cannot read samples directory")
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		sampleName := entry.Name()
		sampleDir := filepath.Join(samplesPath, sampleName)
		schemaPath := filepath.Join(sampleDir, "schema.struct.json")

		// Load schema
		schemaData, err := os.ReadFile(schemaPath)
		if err != nil {
			continue
		}

		var schema map[string]interface{}
		if err := json.Unmarshal(schemaData, &schema); err != nil {
			continue
		}

		// Find valid instance files
		instanceFiles, _ := filepath.Glob(filepath.Join(sampleDir, "valid*.json"))

		for _, instanceFile := range instanceFiles {
			instanceName := filepath.Base(instanceFile)
			t.Run(sampleName+"/"+instanceName, func(t *testing.T) {
				data, err := os.ReadFile(instanceFile)
				if err != nil {
					t.Fatalf("Failed to read instance file: %v", err)
				}

				var instance interface{}
				if err := json.Unmarshal(data, &instance); err != nil {
					t.Fatalf("Failed to parse instance JSON: %v", err)
				}

				// Remove metadata if present
				if instanceMap, ok := instance.(map[string]interface{}); ok {
					cleanInstance := make(map[string]interface{})
					for k, v := range instanceMap {
						if !strings.HasPrefix(k, "_") {
							cleanInstance[k] = v
						}
					}
					instance = cleanInstance
				}

				validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})
				result := validator.Validate(instance, schema)

				if !result.IsValid {
					t.Errorf("Valid instance %s/%s should pass validation. Errors: %v", sampleName, instanceName, result.Errors)
				}
			})
		}
	}
}

// TestValidationSchemasCount verifies we have validation schemas.
func TestValidationSchemasCount(t *testing.T) {
	files := getValidationSchemaFiles()
	if len(files) == 0 {
		t.Skip("test-assets not found")
	}
	if len(files) < 5 {
		t.Errorf("Expected at least 5 validation schemas, got %d", len(files))
	}
}

// TestValidationInstancesCount verifies we have validation instances.
func TestValidationInstancesCount(t *testing.T) {
	dirs := getValidationInstanceDirs()
	if len(dirs) == 0 {
		t.Skip("test-assets not found")
	}

	// Count all instance files
	total := 0
	for _, dir := range dirs {
		files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
		total += len(files)
	}

	if total < 5 {
		t.Errorf("Expected at least 5 validation instances, got %d", total)
	}
}
