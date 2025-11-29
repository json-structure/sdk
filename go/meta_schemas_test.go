package jsonstructure

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func loadSchema(t *testing.T, path string) map[string]interface{} {
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("Failed to read schema file %s: %v", path, err)
	}

	var schema map[string]interface{}
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatalf("Failed to parse schema file %s: %v", path, err)
	}

	return schema
}

func TestMetaSchemas(t *testing.T) {
	// Get the path to the meta directory
	metaDir := filepath.Join("..", "meta")

	// Load all three metaschemas
	coreSchema := loadSchema(t, filepath.Join(metaDir, "core", "v0", "index.json"))
	extendedSchema := loadSchema(t, filepath.Join(metaDir, "extended", "v0", "index.json"))
	validationSchema := loadSchema(t, filepath.Join(metaDir, "validation", "v0", "index.json"))

	// Build external schemas map for import resolution
	externalSchemas := map[string]interface{}{
		coreSchema["$id"].(string):       coreSchema,
		extendedSchema["$id"].(string):   extendedSchema,
		validationSchema["$id"].(string): validationSchema,
	}

	t.Run("CoreMetaschema", func(t *testing.T) {
		validator := NewSchemaValidator(&SchemaValidatorOptions{
			AllowDollar:     true,
			AllowImport:     true,
			ExternalSchemas: externalSchemas,
		})

		// Reload fresh copy
		schema := loadSchema(t, filepath.Join(metaDir, "core", "v0", "index.json"))
		result := validator.Validate(schema)

		if !result.IsValid {
			for _, err := range result.Errors {
				t.Errorf("Validation error: %s at %s", err.Message, err.Path)
			}
		}
	})

	t.Run("ExtendedMetaschema", func(t *testing.T) {
		validator := NewSchemaValidator(&SchemaValidatorOptions{
			AllowDollar:     true,
			AllowImport:     true,
			ExternalSchemas: externalSchemas,
		})

		// Reload fresh copy
		schema := loadSchema(t, filepath.Join(metaDir, "extended", "v0", "index.json"))
		result := validator.Validate(schema)

		if !result.IsValid {
			for _, err := range result.Errors {
				t.Errorf("Validation error: %s at %s", err.Message, err.Path)
			}
		}
	})

	t.Run("ValidationMetaschema", func(t *testing.T) {
		validator := NewSchemaValidator(&SchemaValidatorOptions{
			AllowDollar:     true,
			AllowImport:     true,
			ExternalSchemas: externalSchemas,
		})

		// Reload fresh copy
		schema := loadSchema(t, filepath.Join(metaDir, "validation", "v0", "index.json"))
		result := validator.Validate(schema)

		if !result.IsValid {
			for _, err := range result.Errors {
				t.Errorf("Validation error: %s at %s", err.Message, err.Path)
			}
		}
	})

	t.Run("CoreMetaschemaHasDefinitions", func(t *testing.T) {
		defs, ok := coreSchema["definitions"].(map[string]interface{})
		if !ok {
			t.Fatal("Core metaschema missing definitions")
		}

		expectedDefs := []string{"SchemaDocument", "ObjectType", "Property"}
		for _, name := range expectedDefs {
			if _, exists := defs[name]; !exists {
				t.Errorf("Core metaschema missing expected definition: %s", name)
			}
		}
	})

	t.Run("ExtendedMetaschemaImportsCore", func(t *testing.T) {
		// Reload fresh copy to check original $import
		schema := loadSchema(t, filepath.Join(metaDir, "extended", "v0", "index.json"))
		importURI, ok := schema["$import"].(string)
		if !ok {
			t.Fatal("Extended metaschema missing $import")
		}
		if importURI != "https://json-structure.org/meta/core/v0/#" {
			t.Errorf("Expected $import to be core URI, got: %s", importURI)
		}
	})

	t.Run("ValidationMetaschemaImportsExtended", func(t *testing.T) {
		// Reload fresh copy to check original $import
		schema := loadSchema(t, filepath.Join(metaDir, "validation", "v0", "index.json"))
		importURI, ok := schema["$import"].(string)
		if !ok {
			t.Fatal("Validation metaschema missing $import")
		}
		if importURI != "https://json-structure.org/meta/extended/v0/#" {
			t.Errorf("Expected $import to be extended URI, got: %s", importURI)
		}
	})
}
