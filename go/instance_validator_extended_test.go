package jsonstructure

import (
	"testing"
)

// ============================================================================
// Primitive Type Tests
// ============================================================================

func TestInstanceValidatorString(t *testing.T) {
	schema := map[string]interface{}{
		"type": "string",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"valid string", "hello", true},
		{"empty string", "", true},
		{"number invalid", float64(123), false},
		{"boolean invalid", true, false},
		{"null invalid", nil, false},
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

func TestInstanceValidatorBoolean(t *testing.T) {
	schema := map[string]interface{}{
		"type": "boolean",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"true valid", true, true},
		{"false valid", false, true},
		{"string invalid", "true", false},
		{"number invalid", float64(1), false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.instance, schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v", tc.valid, result.IsValid)
			}
		})
	}
}

func TestInstanceValidatorNull(t *testing.T) {
	schema := map[string]interface{}{
		"type": "null",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"null valid", nil, true},
		{"string invalid", "null", false},
		{"number invalid", float64(0), false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validator.Validate(tc.instance, schema)
			if result.IsValid != tc.valid {
				t.Errorf("Expected valid=%v, got valid=%v", tc.valid, result.IsValid)
			}
		})
	}
}

func TestInstanceValidatorInt8(t *testing.T) {
	schema := map[string]interface{}{
		"type": "int8",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"min int8", float64(-128), true},
		{"max int8", float64(127), true},
		{"zero", float64(0), true},
		{"overflow positive", float64(128), false},
		{"overflow negative", float64(-129), false},
		{"not integer", 3.14, false},
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

func TestInstanceValidatorUint8(t *testing.T) {
	schema := map[string]interface{}{
		"type": "uint8",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"min uint8", float64(0), true},
		{"max uint8", float64(255), true},
		{"middle", float64(128), true},
		{"overflow positive", float64(256), false},
		{"negative", float64(-1), false},
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

func TestInstanceValidatorInt16(t *testing.T) {
	schema := map[string]interface{}{
		"type": "int16",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"min int16", float64(-32768), true},
		{"max int16", float64(32767), true},
		{"zero", float64(0), true},
		{"overflow positive", float64(32768), false},
		{"overflow negative", float64(-32769), false},
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

func TestInstanceValidatorUint16(t *testing.T) {
	schema := map[string]interface{}{
		"type": "uint16",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"min uint16", float64(0), true},
		{"max uint16", float64(65535), true},
		{"middle", float64(32768), true},
		{"overflow positive", float64(65536), false},
		{"negative", float64(-1), false},
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

func TestInstanceValidatorInt32Range(t *testing.T) {
	schema := map[string]interface{}{
		"type": "int32",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"min int32", float64(-2147483648), true},
		{"max int32", float64(2147483647), true},
		{"zero", float64(0), true},
		{"overflow positive", float64(2147483648), false},
		{"overflow negative", float64(-2147483649), false},
		{"not integer", 3.14, false},
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

func TestInstanceValidatorUint32(t *testing.T) {
	schema := map[string]interface{}{
		"type": "uint32",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"min uint32", float64(0), true},
		{"max uint32", float64(4294967295), true},
		{"middle", float64(2147483648), true},
		{"overflow positive", float64(4294967296), false},
		{"negative", float64(-1), false},
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

func TestInstanceValidatorInt64(t *testing.T) {
	schema := map[string]interface{}{
		"type": "int64",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"max int64", "9223372036854775807", true},
		{"min int64", "-9223372036854775808", true},
		{"zero", "0", true},
		{"positive", "123456789012345", true},
		{"invalid format", "not-a-number", false},
		{"number not string", float64(123), false},
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

func TestInstanceValidatorUint64(t *testing.T) {
	schema := map[string]interface{}{
		"type": "uint64",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"max uint64", "18446744073709551615", true},
		{"zero", "0", true},
		{"positive", "123456789012345", true},
		{"negative invalid", "-1", false},
		{"invalid format", "not-a-number", false},
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

func TestInstanceValidatorFloat(t *testing.T) {
	schema := map[string]interface{}{
		"type": "float",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"integer", float64(42), true},
		{"decimal", float64(3.14), true},
		{"negative", float64(-1.5), true},
		{"string invalid", "3.14", false},
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

func TestInstanceValidatorDouble(t *testing.T) {
	schema := map[string]interface{}{
		"type": "double",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"integer", float64(42), true},
		{"decimal", float64(3.14159265358979), true},
		{"negative", float64(-1.5e10), true},
		{"string invalid", "3.14", false},
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

func TestInstanceValidatorDecimal(t *testing.T) {
	schema := map[string]interface{}{
		"type": "decimal",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"integer string", "123", true},
		{"decimal string", "123.456", true},
		{"negative", "-99.99", true},
		{"invalid format", "not-a-number", false},
		{"number not string", float64(123.456), false},
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

// ============================================================================
// Date/Time Type Tests
// ============================================================================

func TestInstanceValidatorDate(t *testing.T) {
	schema := map[string]interface{}{
		"type": "date",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"valid date", "2024-01-15", true},
		{"valid date 2", "2023-12-31", true},
		{"wrong format 1", "2024-1-15", false},
		{"wrong format 2", "01/15/2024", false},
		{"wrong format 3", "15-01-2024", false},
		// Note: semantic validation (month 13) is not enforced - only format check
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

func TestInstanceValidatorDateTime(t *testing.T) {
	schema := map[string]interface{}{
		"type": "datetime",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"UTC datetime", "2024-01-15T10:30:00Z", true},
		{"datetime with offset", "2024-01-15T10:30:00+05:00", true},
		{"datetime with ms", "2024-01-15T10:30:00.123Z", true},
		{"date only invalid", "2024-01-15", false},
		{"time only invalid", "10:30:00", false},
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

func TestInstanceValidatorTime(t *testing.T) {
	schema := map[string]interface{}{
		"type": "time",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"valid time", "10:30:00", true},
		{"time with ms", "10:30:00.123", true},
		{"midnight", "00:00:00", true},
		{"invalid format", "10:30", false},
		// Note: semantic validation (hour 25) is not enforced - only format check
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

func TestInstanceValidatorDuration(t *testing.T) {
	schema := map[string]interface{}{
		"type": "duration",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"years and months", "P1Y2M", true},
		{"days", "P3D", true},
		{"time only", "PT1H30M", true},
		{"full duration", "P1Y2M3DT4H5M6S", true},
		{"weeks", "P2W", true},
		{"invalid format", "1 hour", false},
		{"missing P", "1Y2M", false},
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

// ============================================================================
// Other Primitive Types Tests
// ============================================================================

func TestInstanceValidatorUUID(t *testing.T) {
	schema := map[string]interface{}{
		"type": "uuid",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"valid uuid", "550e8400-e29b-41d4-a716-446655440000", true},
		{"nil uuid", "00000000-0000-0000-0000-000000000000", true},
		{"invalid format", "not-a-uuid", false},
		{"missing dashes", "550e8400e29b41d4a716446655440000", false},
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

func TestInstanceValidatorURI(t *testing.T) {
	schema := map[string]interface{}{
		"type": "uri",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"https url", "https://example.com", true},
		{"http url", "http://example.com/path", true},
		{"ftp url", "ftp://files.example.com", true},
		{"urn", "urn:isbn:0451450523", true},
		{"invalid format", "not a uri", false},
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

func TestInstanceValidatorJSONPointer(t *testing.T) {
	schema := map[string]interface{}{
		"type": "jsonpointer",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		// JSON Pointer format is /path/to/value, not #/path/to/value (that's a JSON Reference fragment)
		{"root pointer", "", true},
		{"simple pointer", "/definitions/Foo", true},
		{"nested pointer", "/a/b/c", true},
		{"invalid format", "not/a/pointer", false},
		{"fragment not json pointer", "#/definitions/Foo", false},
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

func TestInstanceValidatorBinary(t *testing.T) {
	schema := map[string]interface{}{
		"type": "binary",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"valid base64", "SGVsbG8gV29ybGQ=", true},
		{"empty base64", "", true},
		{"invalid base64", "not valid base64!", false},
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

// ============================================================================
// String Validation Keyword Tests
// ============================================================================

func TestInstanceValidatorMinLength(t *testing.T) {
	schema := map[string]interface{}{
		"type":      "string",
		"minLength": float64(3),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly min", "abc", true},
		{"above min", "abcd", true},
		{"below min", "ab", false},
		{"empty string", "", false},
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

func TestInstanceValidatorMaxLengthExtended(t *testing.T) {
	schema := map[string]interface{}{
		"type":      "string",
		"maxLength": float64(5),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly max", "hello", true},
		{"below max", "hi", true},
		{"above max", "hello world", false},
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

func TestInstanceValidatorPatternExtended(t *testing.T) {
	schema := map[string]interface{}{
		"type":    "string",
		"pattern": "^[a-z]+$",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"matches pattern", "abc", true},
		{"uppercase fails", "ABC", false},
		{"numbers fail", "123", false},
		{"mixed fails", "abc123", false},
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

// ============================================================================
// Numeric Validation Keyword Tests
// ============================================================================

func TestInstanceValidatorMinimumNumber(t *testing.T) {
	schema := map[string]interface{}{
		"type":    "number",
		"minimum": float64(0),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly min", float64(0), true},
		{"above min", float64(10), true},
		{"below min", float64(-1), false},
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

func TestInstanceValidatorMaximum(t *testing.T) {
	schema := map[string]interface{}{
		"type":    "number",
		"maximum": float64(100),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly max", float64(100), true},
		{"below max", float64(50), true},
		{"above max", float64(101), false},
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

func TestInstanceValidatorExclusiveMinimum(t *testing.T) {
	schema := map[string]interface{}{
		"type":             "number",
		"exclusiveMinimum": float64(0),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"above exclusive min", float64(1), true},
		{"exactly exclusive min", float64(0), false},
		{"below exclusive min", float64(-1), false},
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

func TestInstanceValidatorExclusiveMaximum(t *testing.T) {
	schema := map[string]interface{}{
		"type":             "number",
		"exclusiveMaximum": float64(100),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"below exclusive max", float64(99), true},
		{"exactly exclusive max", float64(100), false},
		{"above exclusive max", float64(101), false},
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

func TestInstanceValidatorMultipleOf(t *testing.T) {
	schema := map[string]interface{}{
		"type":       "number",
		"multipleOf": float64(5),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"multiple of 5", float64(10), true},
		{"zero is multiple", float64(0), true},
		{"15 is multiple", float64(15), true},
		{"not multiple", float64(12), false},
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

// ============================================================================
// Array Validation Keyword Tests
// ============================================================================

func TestInstanceValidatorMinItems(t *testing.T) {
	schema := map[string]interface{}{
		"type":     "array",
		"items":    map[string]interface{}{"type": "string"},
		"minItems": float64(2),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly min", []interface{}{"a", "b"}, true},
		{"above min", []interface{}{"a", "b", "c"}, true},
		{"below min", []interface{}{"a"}, false},
		{"empty array", []interface{}{}, false},
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

func TestInstanceValidatorMaxItems(t *testing.T) {
	schema := map[string]interface{}{
		"type":     "array",
		"items":    map[string]interface{}{"type": "string"},
		"maxItems": float64(3),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly max", []interface{}{"a", "b", "c"}, true},
		{"below max", []interface{}{"a"}, true},
		{"empty array", []interface{}{}, true},
		{"above max", []interface{}{"a", "b", "c", "d"}, false},
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

func TestInstanceValidatorUniqueItems(t *testing.T) {
	schema := map[string]interface{}{
		"type":        "array",
		"items":       map[string]interface{}{"type": "string"},
		"uniqueItems": true,
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"unique items", []interface{}{"a", "b", "c"}, true},
		{"empty array", []interface{}{}, true},
		{"duplicate items", []interface{}{"a", "b", "a"}, false},
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

func TestInstanceValidatorContains(t *testing.T) {
	schema := map[string]interface{}{
		"type":     "array",
		"items":    map[string]interface{}{"type": "int32"},
		"contains": map[string]interface{}{"type": "int32", "minimum": float64(10)},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"contains matching", []interface{}{float64(1), float64(15), float64(3)}, true},
		{"multiple matching", []interface{}{float64(10), float64(20), float64(30)}, true},
		{"no matching", []interface{}{float64(1), float64(2), float64(3)}, false},
		{"empty array", []interface{}{}, false},
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

func TestInstanceValidatorMinContains(t *testing.T) {
	schema := map[string]interface{}{
		"type":        "array",
		"items":       map[string]interface{}{"type": "int32"},
		"contains":    map[string]interface{}{"type": "int32", "minimum": float64(10)},
		"minContains": float64(2),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly min matches", []interface{}{float64(10), float64(20), float64(5)}, true},
		{"above min matches", []interface{}{float64(10), float64(20), float64(30)}, true},
		{"below min matches", []interface{}{float64(10), float64(5), float64(3)}, false},
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

func TestInstanceValidatorMaxContains(t *testing.T) {
	schema := map[string]interface{}{
		"type":        "array",
		"items":       map[string]interface{}{"type": "int32"},
		"contains":    map[string]interface{}{"type": "int32", "minimum": float64(10)},
		"maxContains": float64(2),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly max matches", []interface{}{float64(10), float64(20), float64(5)}, true},
		{"below max matches", []interface{}{float64(10), float64(5), float64(3)}, true},
		{"above max matches", []interface{}{float64(10), float64(20), float64(30)}, false},
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

// ============================================================================
// Object Validation Keyword Tests
// ============================================================================

func TestInstanceValidatorMinProperties(t *testing.T) {
	schema := map[string]interface{}{
		"type":          "object",
		"minProperties": float64(2),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly min", map[string]interface{}{"a": 1, "b": 2}, true},
		{"above min", map[string]interface{}{"a": 1, "b": 2, "c": 3}, true},
		{"below min", map[string]interface{}{"a": 1}, false},
		{"empty object", map[string]interface{}{}, false},
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

func TestInstanceValidatorMaxProperties(t *testing.T) {
	schema := map[string]interface{}{
		"type":          "object",
		"maxProperties": float64(2),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly max", map[string]interface{}{"a": 1, "b": 2}, true},
		{"below max", map[string]interface{}{"a": 1}, true},
		{"empty object", map[string]interface{}{}, true},
		{"above max", map[string]interface{}{"a": 1, "b": 2, "c": 3}, false},
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

func TestInstanceValidatorDependentRequired(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"name":  map[string]interface{}{"type": "string"},
			"email": map[string]interface{}{"type": "string"},
			"phone": map[string]interface{}{"type": "string"},
		},
		"dependentRequired": map[string]interface{}{
			"email": []interface{}{"name"},
			"phone": []interface{}{"name", "email"},
		},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"no dependencies", map[string]interface{}{"name": "John"}, true},
		{"email with name", map[string]interface{}{"name": "John", "email": "john@example.com"}, true},
		{"phone with all", map[string]interface{}{"name": "John", "email": "john@example.com", "phone": "123"}, true},
		{"email without name", map[string]interface{}{"email": "john@example.com"}, false},
		{"phone without email", map[string]interface{}{"name": "John", "phone": "123"}, false},
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

// ============================================================================
// Map Type Tests
// ============================================================================

func TestInstanceValidatorMap(t *testing.T) {
	schema := map[string]interface{}{
		"type":   "map",
		"values": map[string]interface{}{"type": "int32"},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"valid map", map[string]interface{}{"a": float64(1), "b": float64(2)}, true},
		{"empty map", map[string]interface{}{}, true},
		{"wrong value type", map[string]interface{}{"a": "one"}, false},
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

func TestInstanceValidatorMapMinEntries(t *testing.T) {
	schema := map[string]interface{}{
		"type":       "map",
		"values":     map[string]interface{}{"type": "int32"},
		"minEntries": float64(2),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly min", map[string]interface{}{"a": float64(1), "b": float64(2)}, true},
		{"above min", map[string]interface{}{"a": float64(1), "b": float64(2), "c": float64(3)}, true},
		{"below min", map[string]interface{}{"a": float64(1)}, false},
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

func TestInstanceValidatorMapMaxEntries(t *testing.T) {
	schema := map[string]interface{}{
		"type":       "map",
		"values":     map[string]interface{}{"type": "int32"},
		"maxEntries": float64(2),
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"exactly max", map[string]interface{}{"a": float64(1), "b": float64(2)}, true},
		{"below max", map[string]interface{}{"a": float64(1)}, true},
		{"above max", map[string]interface{}{"a": float64(1), "b": float64(2), "c": float64(3)}, false},
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

func TestInstanceValidatorMapKeyNames(t *testing.T) {
	schema := map[string]interface{}{
		"type":     "map",
		"values":   map[string]interface{}{"type": "int32"},
		"keyNames": map[string]interface{}{"pattern": "^[a-z]+$"},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"valid keys", map[string]interface{}{"abc": float64(1), "xyz": float64(2)}, true},
		{"invalid key uppercase", map[string]interface{}{"ABC": float64(1)}, false},
		{"invalid key numbers", map[string]interface{}{"abc123": float64(1)}, false},
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

// ============================================================================
// Set Type Tests
// ============================================================================

func TestInstanceValidatorSet(t *testing.T) {
	schema := map[string]interface{}{
		"type":  "set",
		"items": map[string]interface{}{"type": "string"},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"unique items", []interface{}{"a", "b", "c"}, true},
		{"empty set", []interface{}{}, true},
		{"duplicate items", []interface{}{"a", "b", "a"}, false},
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

// ============================================================================
// Tuple Type Tests
// ============================================================================

func TestInstanceValidatorTuple(t *testing.T) {
	schema := map[string]interface{}{
		"type": "tuple",
		"properties": map[string]interface{}{
			"x": map[string]interface{}{"type": "int32"},
			"y": map[string]interface{}{"type": "int32"},
		},
		"tuple": []interface{}{"x", "y"},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"valid tuple", []interface{}{float64(10), float64(20)}, true},
		{"wrong length", []interface{}{float64(10)}, false},
		{"too many items", []interface{}{float64(10), float64(20), float64(30)}, false},
		{"wrong type", []interface{}{float64(10), "twenty"}, false},
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

// ============================================================================
// Const Validation Tests
// ============================================================================

func TestInstanceValidatorConst(t *testing.T) {
	schema := map[string]interface{}{
		"type":  "string",
		"const": "fixed",
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"matches const", "fixed", true},
		{"does not match", "other", false},
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

// ============================================================================
// Union Type Tests
// ============================================================================

func TestInstanceValidatorUnionType(t *testing.T) {
	schema := map[string]interface{}{
		"type": []interface{}{"string", "int32"},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"matches string", "hello", true},
		{"matches int32", float64(42), true},
		{"matches neither", true, false},
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

func TestInstanceValidatorUnionWithNull(t *testing.T) {
	schema := map[string]interface{}{
		"type": []interface{}{"string", "null"},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"matches string", "hello", true},
		{"matches null", nil, true},
		{"matches neither", float64(42), false},
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

// ============================================================================
// Conditional Composition Tests
// ============================================================================

func TestInstanceValidatorAnyOf(t *testing.T) {
	schema := map[string]interface{}{
		"anyOf": []interface{}{
			map[string]interface{}{"type": "string"},
			map[string]interface{}{"type": "int32"},
		},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"matches first", "hello", true},
		{"matches second", float64(42), true},
		{"matches neither", true, false},
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

func TestInstanceValidatorNot(t *testing.T) {
	schema := map[string]interface{}{
		"type": "string",
		"not":  map[string]interface{}{"enum": []interface{}{"forbidden"}},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"allowed value", "allowed", true},
		{"forbidden value", "forbidden", false},
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

func TestInstanceValidatorIfThenElse(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"type":  map[string]interface{}{"type": "string"},
			"value": map[string]interface{}{"type": "any"},
		},
		"if": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"type": map[string]interface{}{"type": "string", "const": "number"},
			},
		},
		"then": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"value": map[string]interface{}{"type": "number"},
			},
		},
		"else": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"value": map[string]interface{}{"type": "string"},
			},
		},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"number type with number value", map[string]interface{}{"type": "number", "value": float64(42)}, true},
		{"string type with string value", map[string]interface{}{"type": "string", "value": "hello"}, true},
		{"number type with string value", map[string]interface{}{"type": "number", "value": "hello"}, false},
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

// ============================================================================
// $root Handling Tests
// ============================================================================

func TestInstanceValidatorRoot(t *testing.T) {
	schema := map[string]interface{}{
		"$root": "#/definitions/Person",
		"definitions": map[string]interface{}{
			"Person": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{"type": "string"},
				},
				"required": []interface{}{"name"},
			},
		},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"valid with name", map[string]interface{}{"name": "Alice"}, true},
		{"missing required", map[string]interface{}{}, false},
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

// ============================================================================
// AdditionalProperties Tests
// ============================================================================

func TestInstanceValidatorAdditionalPropertiesFalse(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"name": map[string]interface{}{"type": "string"},
		},
		"additionalProperties": false,
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"only defined props", map[string]interface{}{"name": "Alice"}, true},
		{"empty object", map[string]interface{}{}, true},
		{"extra property", map[string]interface{}{"name": "Alice", "extra": "data"}, false},
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

func TestInstanceValidatorAdditionalPropertiesSchema(t *testing.T) {
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"name": map[string]interface{}{"type": "string"},
		},
		"additionalProperties": map[string]interface{}{"type": "int32"},
	}
	validator := NewInstanceValidator(&InstanceValidatorOptions{Extended: true})

	tests := []struct {
		name     string
		instance interface{}
		valid    bool
	}{
		{"valid additional", map[string]interface{}{"name": "Alice", "age": float64(30)}, true},
		{"invalid additional type", map[string]interface{}{"name": "Alice", "extra": "string"}, false},
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
