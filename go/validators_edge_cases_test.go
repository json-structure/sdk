package jsonstructure

import (
	"testing"
)

// ============================================================================
// Schema Validator Additional Tests
// ============================================================================

func TestSchemaValidatorRequiredArray(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	tests := []struct {
		name  string
		schema map[string]interface{}
		valid bool
	}{
		{
			name: "valid required array",
			schema: map[string]interface{}{
				"$id":  "urn:example:test",
				"name": "Test",
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{"type": "string"},
				},
				"required": []interface{}{"name"},
			},
			valid: true,
		},
		{
			name: "empty required array",
			schema: map[string]interface{}{
				"$id":  "urn:example:test",
				"name": "Test",
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{"type": "string"},
				},
				"required": []interface{}{},
			},
			valid: true,
		},
		{
			name: "required not an array",
			schema: map[string]interface{}{
				"$id":  "urn:example:test",
				"name": "Test",
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{"type": "string"},
				},
				"required": "name",
			},
			valid: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}

func TestSchemaValidatorNestedObjects(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	schema := map[string]interface{}{
		"$id":  "urn:example:test",
		"name": "Test",
		"type": "object",
		"properties": map[string]interface{}{
			"address": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"street": map[string]interface{}{"type": "string"},
					"city":   map[string]interface{}{"type": "string"},
					"geo": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"lat": map[string]interface{}{"type": "double"},
							"lon": map[string]interface{}{"type": "double"},
						},
						"required": []interface{}{"lat", "lon"},
					},
				},
				"required": []interface{}{"street"},
			},
		},
	}

	result := validator.Validate(schema)
	if !result.IsValid {
		t.Errorf("Expected valid schema, got errors: %v", result.Errors)
	}
}

func TestSchemaValidatorDefinitions(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	schema := map[string]interface{}{
		"$id":  "urn:example:test",
		"name": "Test",
		"type": "object",
		"definitions": map[string]interface{}{
			"Address": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"street": map[string]interface{}{"type": "string"},
				},
			},
			"Phone": map[string]interface{}{
				"type":    "string",
				"pattern": "^\\+?[0-9]+$",
			},
		},
		"properties": map[string]interface{}{
			"home":  map[string]interface{}{"type": map[string]interface{}{"$ref": "#/definitions/Address"}},
			"work":  map[string]interface{}{"type": map[string]interface{}{"$ref": "#/definitions/Address"}},
			"phone": map[string]interface{}{"type": map[string]interface{}{"$ref": "#/definitions/Phone"}},
		},
	}

	result := validator.Validate(schema)
	if !result.IsValid {
		t.Errorf("Expected valid schema, got errors: %v", result.Errors)
	}
}

func TestSchemaValidatorArrayItems(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	tests := []struct {
		name   string
		schema map[string]interface{}
		valid  bool
	}{
		{
			name: "array with items schema",
			schema: map[string]interface{}{
				"$id":   "urn:example:test",
				"name":  "Test",
				"type":  "array",
				"items": map[string]interface{}{"type": "string"},
			},
			valid: true,
		},
		{
			name: "array with object items",
			schema: map[string]interface{}{
				"$id":  "urn:example:test",
				"name": "Test",
				"type": "array",
				"items": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"id": map[string]interface{}{"type": "int32"},
					},
				},
			},
			valid: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}

func TestSchemaValidatorMapValues(t *testing.T) {
	validator := NewSchemaValidator(&SchemaValidatorOptions{Extended: true})

	tests := []struct {
		name   string
		schema map[string]interface{}
		valid  bool
	}{
		{
			name: "map with values schema",
			schema: map[string]interface{}{
				"$id":    "urn:example:test",
				"name":   "Test",
				"type":   "map",
				"values": map[string]interface{}{"type": "int32"},
			},
			valid: true,
		},
		{
			name: "map with object values",
			schema: map[string]interface{}{
				"$id":  "urn:example:test",
				"name": "Test",
				"type": "map",
				"values": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"count": map[string]interface{}{"type": "int32"},
					},
				},
			},
			valid: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}

// ============================================================================
// Instance Validator Edge Cases
// ============================================================================

func TestInstanceValidatorDeepNesting(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"level1": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"level2": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"level3": map[string]interface{}{
								"type": "object",
								"properties": map[string]interface{}{
									"value": map[string]interface{}{"type": "string"},
								},
								"required": []interface{}{"value"},
							},
						},
					},
				},
			},
		},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{
			name: "valid deep nesting",
			instance: map[string]interface{}{
				"level1": map[string]interface{}{
					"level2": map[string]interface{}{
						"level3": map[string]interface{}{
							"value": "hello",
						},
					},
				},
			},
			valid: true,
		},
		{
			name: "missing required at deep level",
			instance: map[string]interface{}{
				"level1": map[string]interface{}{
					"level2": map[string]interface{}{
						"level3": map[string]interface{}{},
					},
				},
			},
			valid: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.instance, schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}

func TestInstanceValidatorEmptyValues(t *testing.T) {
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		schema   map[string]interface{}
		instance interface{}
		valid    bool
	}{
		{
			name:     "empty string is valid string",
			schema:   map[string]interface{}{"type": "string"},
			instance: "",
			valid:    true,
		},
		{
			name:     "empty array is valid array",
			schema:   map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}},
			instance: []interface{}{},
			valid:    true,
		},
		{
			name:     "empty object is valid object",
			schema:   map[string]interface{}{"type": "object"},
			instance: map[string]interface{}{},
			valid:    true,
		},
		{
			name:     "empty map is valid map",
			schema:   map[string]interface{}{"type": "map", "values": map[string]interface{}{"type": "int32"}},
			instance: map[string]interface{}{},
			valid:    true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.instance, tc.schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}

func TestInstanceValidatorMultipleErrors(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"name": map[string]interface{}{"type": "string"},
			"age":  map[string]interface{}{"type": "int32"},
		},
		"required": []interface{}{"name", "age"},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	instance := map[string]interface{}{} // Missing both required fields

	result := validator.Validate(instance, schema)
	if result.IsValid {
		t.Error("Expected invalid instance")
	}
	if len(result.Errors) < 2 {
		t.Errorf("Expected at least 2 errors (missing name and age), got %d: %v", len(result.Errors), result.Errors)
	}
}

func TestInstanceValidatorRefWithValidation(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"definitions": map[string]interface{}{
			"PositiveInt": map[string]interface{}{
				"type":    "int32",
				"minimum": float64(1),
			},
		},
		"properties": map[string]interface{}{
			"count": map[string]interface{}{"type": map[string]interface{}{"$ref": "#/definitions/PositiveInt"}},
		},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{
			name:     "positive value",
			instance: map[string]interface{}{"count": float64(5)},
			valid:    true,
		},
		{
			name:     "zero value fails minimum",
			instance: map[string]interface{}{"count": float64(0)},
			valid:    false,
		},
		{
			name:     "negative value fails minimum",
			instance: map[string]interface{}{"count": float64(-1)},
			valid:    false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.instance, schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}

func TestInstanceValidatorArrayOfObjects(t *testing.T) {
	schema := map[string]interface{}{
		"type": "array",
		"items": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":   map[string]interface{}{"type": "int32"},
				"name": map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"id"},
		},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{
			name: "valid array of objects",
			instance: []interface{}{
				map[string]interface{}{"id": float64(1), "name": "Alice"},
				map[string]interface{}{"id": float64(2), "name": "Bob"},
			},
			valid: true,
		},
		{
			name: "missing required in one item",
			instance: []interface{}{
				map[string]interface{}{"id": float64(1), "name": "Alice"},
				map[string]interface{}{"name": "Bob"}, // Missing id
			},
			valid: false,
		},
		{
			name: "wrong type in one item",
			instance: []interface{}{
				map[string]interface{}{"id": float64(1)},
				map[string]interface{}{"id": "not-a-number"},
			},
			valid: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.instance, schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}

func TestInstanceValidatorNullableUnion(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"value": map[string]interface{}{
				"type": []interface{}{"string", "null"},
			},
		},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{
			name:     "string value",
			instance: map[string]interface{}{"value": "hello"},
			valid:    true,
		},
		{
			name:     "null value",
			instance: map[string]interface{}{"value": nil},
			valid:    true,
		},
		{
			name:     "number value",
			instance: map[string]interface{}{"value": float64(42)},
			valid:    false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.instance, schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}

func TestInstanceValidatorEnumIntegers(t *testing.T) {
	schema := map[string]interface{}{
		"type": "int32",
		"enum": []interface{}{float64(1), float64(2), float64(3)},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"value in enum", float64(2), true},
		{"value not in enum", float64(5), false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.instance, schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}

func TestInstanceValidatorConstObject(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"const": map[string]interface{}{
			"fixed": "value",
		},
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{
			name:     "matches const",
			instance: map[string]interface{}{"fixed": "value"},
			valid:    true,
		},
		{
			name:     "different value",
			instance: map[string]interface{}{"fixed": "other"},
			valid:    false,
		},
		{
			name:     "extra property",
			instance: map[string]interface{}{"fixed": "value", "extra": "data"},
			valid:    false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.instance, schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}

func TestInstanceValidatorCombinedConstraints(t *testing.T) {
	schema := map[string]interface{}{
		"type":      "string",
		"minLength": float64(3),
		"maxLength": float64(10),
		"pattern":   "^[a-z]+$",
	}

	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"all constraints pass", "hello", true},
		{"too short", "ab", false},
		{"too long", "abcdefghijk", false},
		{"pattern fail", "Hello", false},
		{"all constraints fail", "XY", false}, // too short and wrong pattern
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.instance, schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v, errors: %v", tc.valid, result.IsValid, result.Errors)
			}
		})
	}
}
