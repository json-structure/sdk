package jsonstructure

import "testing"

func createUcumUnitSchema(typeName string, ucumUnit interface{}, extras map[string]interface{}) map[string]interface{} {
	schema := map[string]interface{}{
		"$schema":  "https://json-structure.org/meta/extended/v0/#",
		"$id":      "urn:example:ucum-schema",
		"name":     "UcumUnitSchema",
		"$uses":    []interface{}{"JSONStructureUnits"},
		"type":     typeName,
		"ucumUnit": ucumUnit,
	}
	for k, v := range extras {
		schema[k] = v
	}
	return schema
}

func createRelationsSchema() map[string]interface{} {
	return map[string]interface{}{
		"$schema": "https://json-structure.org/meta/extended/v0/#",
		"$id":     "urn:example:relations-schema",
		"name":    "Order",
		"$uses":   []interface{}{"JSONStructureRelations"},
		"type":    "object",
		"properties": map[string]interface{}{
			"id":         map[string]interface{}{"type": "string"},
			"tenantId":   map[string]interface{}{"type": "string"},
			"customerId": map[string]interface{}{"type": "string"},
			"itemIds": map[string]interface{}{
				"type":  "array",
				"items": map[string]interface{}{"type": "string"},
			},
			"qualifier": map[string]interface{}{"type": "string"},
		},
		"definitions": map[string]interface{}{
			"Customer": map[string]interface{}{
				"name": "Customer",
				"type": "object",
				"properties": map[string]interface{}{
					"id": map[string]interface{}{"type": "string"},
				},
			},
			"Item": map[string]interface{}{
				"name": "Item",
				"type": "object",
				"properties": map[string]interface{}{
					"id": map[string]interface{}{"type": "string"},
				},
			},
			"RelationQualifier": map[string]interface{}{
				"name": "RelationQualifier",
				"type": "string",
			},
		},
	}
}

func TestUcumUnitValidationScenarios(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	t.Run("valid numeric type with ucumUnit", func(t *testing.T) {
		result := validator.Validate(createUcumUnitSchema("number", "m", nil))
		if !result.IsValid {
			t.Fatalf("expected valid schema, got errors: %v", result.Errors)
		}
	})

	t.Run("valid numeric type with unit and ucumUnit", func(t *testing.T) {
		result := validator.Validate(createUcumUnitSchema("number", "m", map[string]interface{}{"unit": "meter"}))
		if !result.IsValid {
			t.Fatalf("expected valid schema, got errors: %v", result.Errors)
		}
	})

	for _, typeName := range []string{"int32", "float", "double", "decimal"} {
		t.Run("valid extended numeric type "+typeName, func(t *testing.T) {
			result := validator.Validate(createUcumUnitSchema(typeName, "m", nil))
			if !result.IsValid {
				t.Fatalf("expected valid schema for %s, got errors: %v", typeName, result.Errors)
			}
		})
	}

	t.Run("invalid non-numeric type with ucumUnit", func(t *testing.T) {
		t.Skip("Pending ucumUnit keyword enforcement in the Go schema validator")
	})

	t.Run("invalid numeric ucumUnit value", func(t *testing.T) {
		t.Skip("Pending ucumUnit keyword enforcement in the Go schema validator")
	})

	t.Run("invalid array ucumUnit value", func(t *testing.T) {
		t.Skip("Pending ucumUnit keyword enforcement in the Go schema validator")
	})

	t.Run("invalid object ucumUnit value", func(t *testing.T) {
		t.Skip("Pending ucumUnit keyword enforcement in the Go schema validator")
	})
}

func TestRelationsValidationScenarios(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	t.Run("valid identity array", func(t *testing.T) {
		schema := createRelationsSchema()
		schema["identity"] = []interface{}{"id", "tenantId"}

		result := validator.Validate(schema)
		if !result.IsValid {
			t.Fatalf("expected valid schema, got errors: %v", result.Errors)
		}
	})

	t.Run("valid relations declarations", func(t *testing.T) {
		schema := createRelationsSchema()
		schema["relations"] = map[string]interface{}{
			"customer": map[string]interface{}{
				"cardinality": "single",
				"targettype":  map[string]interface{}{"$ref": "#/definitions/Customer"},
			},
		}

		result := validator.Validate(schema)
		if !result.IsValid {
			t.Fatalf("expected valid schema, got errors: %v", result.Errors)
		}
	})

	t.Run("valid single cardinality relation with targettype ref", func(t *testing.T) {
		schema := createRelationsSchema()
		schema["relations"] = map[string]interface{}{
			"customer": map[string]interface{}{
				"cardinality": "single",
				"targettype":  map[string]interface{}{"$ref": "#/definitions/Customer"},
			},
		}

		result := validator.Validate(schema)
		if !result.IsValid {
			t.Fatalf("expected valid schema, got errors: %v", result.Errors)
		}
	})

	t.Run("valid multiple cardinality relation with scope", func(t *testing.T) {
		schema := createRelationsSchema()
		schema["relations"] = map[string]interface{}{
			"items": map[string]interface{}{
				"cardinality": "multiple",
				"targettype":  map[string]interface{}{"$ref": "#/definitions/Item"},
				"scope":       "line-items",
			},
		}

		result := validator.Validate(schema)
		if !result.IsValid {
			t.Fatalf("expected valid schema, got errors: %v", result.Errors)
		}
	})

	t.Run("valid relation with qualifiertype", func(t *testing.T) {
		schema := createRelationsSchema()
		schema["relations"] = map[string]interface{}{
			"qualifiedCustomer": map[string]interface{}{
				"cardinality":   "single",
				"targettype":    map[string]interface{}{"$ref": "#/definitions/Customer"},
				"qualifiertype": map[string]interface{}{"$ref": "#/definitions/RelationQualifier"},
			},
		}

		result := validator.Validate(schema)
		if !result.IsValid {
			t.Fatalf("expected valid schema, got errors: %v", result.Errors)
		}
	})

	t.Run("invalid identity on non-object type", func(t *testing.T) {
		t.Skip("Pending Relations keyword enforcement in the Go schema validator")
	})

	t.Run("invalid identity that is not an array", func(t *testing.T) {
		t.Skip("Pending Relations keyword enforcement in the Go schema validator")
	})

	t.Run("invalid identity with missing properties", func(t *testing.T) {
		t.Skip("Pending Relations keyword enforcement in the Go schema validator")
	})

	t.Run("invalid relations on non-object type", func(t *testing.T) {
		t.Skip("Pending Relations keyword enforcement in the Go schema validator")
	})

	t.Run("invalid relation cardinality", func(t *testing.T) {
		t.Skip("Pending Relations keyword enforcement in the Go schema validator")
	})

	t.Run("invalid relation missing targettype", func(t *testing.T) {
		t.Skip("Pending Relations keyword enforcement in the Go schema validator")
	})

	t.Run("invalid relation missing cardinality", func(t *testing.T) {
		t.Skip("Pending Relations keyword enforcement in the Go schema validator")
	})
}
