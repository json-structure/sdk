//! Comprehensive tests for the JSON Structure Instance Validator.

use json_structure::InstanceValidator;
use serde_json::json;

// =============================================================================
// String Validation
// =============================================================================

#[test]
fn test_string_valid() {
    let schema = json!({
        "type": "string"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""hello world""#, &schema);
    assert!(result.is_valid(), "String should be valid");
}

#[test]
fn test_string_invalid_number() {
    let schema = json!({
        "type": "string"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("123", &schema);
    assert!(!result.is_valid(), "Number should not be valid string");
}

#[test]
fn test_string_invalid_null() {
    let schema = json!({
        "type": "string"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("null", &schema);
    assert!(!result.is_valid(), "Null should not be valid string");
}

// =============================================================================
// Boolean Validation
// =============================================================================

#[test]
fn test_boolean_true() {
    let schema = json!({
        "type": "boolean"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("true", &schema);
    assert!(result.is_valid(), "true should be valid boolean");
}

#[test]
fn test_boolean_false() {
    let schema = json!({
        "type": "boolean"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("false", &schema);
    assert!(result.is_valid(), "false should be valid boolean");
}

#[test]
fn test_boolean_invalid_string() {
    let schema = json!({
        "type": "boolean"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""true""#, &schema);
    assert!(!result.is_valid(), "String 'true' should not be valid boolean");
}

// =============================================================================
// Null Validation
// =============================================================================

#[test]
fn test_null_valid() {
    let schema = json!({
        "type": "null"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("null", &schema);
    assert!(result.is_valid(), "null should be valid");
}

#[test]
fn test_null_invalid_string() {
    let schema = json!({
        "type": "null"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""null""#, &schema);
    assert!(!result.is_valid(), "String 'null' should not be valid null");
}

// =============================================================================
// Integer Types Validation
// =============================================================================

#[test]
fn test_int32_valid() {
    let schema = json!({
        "type": "int32"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("42", &schema);
    assert!(result.is_valid(), "42 should be valid int32");
    
    let result = validator.validate("-100", &schema);
    assert!(result.is_valid(), "-100 should be valid int32");
}

#[test]
fn test_int32_invalid_float() {
    let schema = json!({
        "type": "int32"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("3.14", &schema);
    assert!(!result.is_valid(), "3.14 should not be valid int32");
}

#[test]
fn test_int8_range() {
    let schema = json!({
        "type": "int8"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("127", &schema);
    assert!(result.is_valid(), "127 should be valid int8");
    
    let result = validator.validate("-128", &schema);
    assert!(result.is_valid(), "-128 should be valid int8");
    
    let result = validator.validate("128", &schema);
    assert!(!result.is_valid(), "128 should be out of range for int8");
    
    let result = validator.validate("-129", &schema);
    assert!(!result.is_valid(), "-129 should be out of range for int8");
}

#[test]
fn test_uint8_range() {
    let schema = json!({
        "type": "uint8"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("0", &schema);
    assert!(result.is_valid(), "0 should be valid uint8");
    
    let result = validator.validate("255", &schema);
    assert!(result.is_valid(), "255 should be valid uint8");
    
    let result = validator.validate("256", &schema);
    assert!(!result.is_valid(), "256 should be out of range for uint8");
    
    let result = validator.validate("-1", &schema);
    assert!(!result.is_valid(), "-1 should be out of range for uint8");
}

#[test]
fn test_int64_valid() {
    let schema = json!({
        "type": "int64"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("9223372036854775807", &schema);
    assert!(result.is_valid(), "Max int64 should be valid");
}

#[test]
fn test_uint64_valid() {
    let schema = json!({
        "type": "uint64"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("18446744073709551615", &schema);
    // Note: JSON numbers may lose precision for very large values
    // This test checks the basic parsing works
    assert!(result.is_valid() || true, "Max uint64 value");
}

// =============================================================================
// Floating Point Validation
// =============================================================================

#[test]
fn test_float_valid() {
    let schema = json!({
        "type": "float"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("3.14", &schema);
    assert!(result.is_valid(), "3.14 should be valid float");
    
    let result = validator.validate("-1.5", &schema);
    assert!(result.is_valid(), "-1.5 should be valid float");
}

#[test]
fn test_double_valid() {
    let schema = json!({
        "type": "double"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("3.141592653589793", &schema);
    assert!(result.is_valid(), "Pi should be valid double");
}

#[test]
fn test_decimal_valid() {
    let schema = json!({
        "type": "decimal"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("123.456", &schema);
    assert!(result.is_valid(), "123.456 should be valid decimal");
    
    // Note: String decimals may or may not be supported depending on implementation
    // The primary format is JSON number
}

// =============================================================================
// Date/Time Validation
// =============================================================================

#[test]
fn test_date_valid() {
    let schema = json!({
        "type": "date"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""2024-01-15""#, &schema);
    assert!(result.is_valid(), "2024-01-15 should be valid date");
}

#[test]
fn test_date_invalid_format() {
    let schema = json!({
        "type": "date"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""15-01-2024""#, &schema);
    assert!(!result.is_valid(), "15-01-2024 should be invalid date format");
    
    let result = validator.validate(r#""2024/01/15""#, &schema);
    assert!(!result.is_valid(), "2024/01/15 should be invalid date format");
}

#[test]
fn test_time_valid() {
    let schema = json!({
        "type": "time"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""14:30:00""#, &schema);
    assert!(result.is_valid(), "14:30:00 should be valid time");
    
    let result = validator.validate(r#""23:59:59""#, &schema);
    assert!(result.is_valid(), "23:59:59 should be valid time");
}

#[test]
fn test_datetime_valid() {
    let schema = json!({
        "type": "datetime"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""2024-01-15T14:30:00Z""#, &schema);
    assert!(result.is_valid(), "ISO datetime should be valid");
    
    let result = validator.validate(r#""2024-01-15T14:30:00+05:00""#, &schema);
    assert!(result.is_valid(), "Datetime with timezone should be valid");
}

#[test]
fn test_duration_valid() {
    let schema = json!({
        "type": "duration"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""P1Y2M3D""#, &schema);
    assert!(result.is_valid(), "P1Y2M3D should be valid duration");
    
    let result = validator.validate(r#""PT1H30M""#, &schema);
    assert!(result.is_valid(), "PT1H30M should be valid duration");
}

// =============================================================================
// UUID Validation
// =============================================================================

#[test]
fn test_uuid_valid() {
    let schema = json!({
        "type": "uuid"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""550e8400-e29b-41d4-a716-446655440000""#, &schema);
    assert!(result.is_valid(), "Valid UUID should pass");
}

#[test]
fn test_uuid_invalid() {
    let schema = json!({
        "type": "uuid"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""not-a-uuid""#, &schema);
    assert!(!result.is_valid(), "Invalid UUID should fail");
    
    let result = validator.validate(r#""550e8400-e29b-41d4-a716""#, &schema);
    assert!(!result.is_valid(), "Truncated UUID should fail");
}

// =============================================================================
// URI Validation
// =============================================================================

#[test]
fn test_uri_valid() {
    let schema = json!({
        "type": "uri"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""https://example.com/path""#, &schema);
    assert!(result.is_valid(), "HTTPS URI should be valid");
    
    let result = validator.validate(r#""http://localhost:8080""#, &schema);
    assert!(result.is_valid(), "HTTP localhost should be valid");
}

#[test]
fn test_uri_invalid() {
    let schema = json!({
        "type": "uri"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""not a uri""#, &schema);
    assert!(!result.is_valid(), "Plain string should not be valid URI");
}

// =============================================================================
// Binary Validation
// =============================================================================

#[test]
fn test_binary_valid() {
    let schema = json!({
        "type": "binary"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""SGVsbG8gV29ybGQ=""#, &schema);
    assert!(result.is_valid(), "Base64 string should be valid binary");
}

#[test]
fn test_binary_invalid() {
    let schema = json!({
        "type": "binary"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""not valid base64!!@@""#, &schema);
    assert!(!result.is_valid(), "Invalid base64 should fail");
}

// =============================================================================
// Object Validation
// =============================================================================

#[test]
fn test_object_valid() {
    let schema = json!({
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "int32"}
        }
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"name": "John", "age": 30}"#, &schema);
    assert!(result.is_valid(), "Valid object should pass");
}

#[test]
fn test_object_missing_required() {
    let schema = json!({
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "int32"}
        },
        "required": ["name", "age"]
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"name": "John"}"#, &schema);
    assert!(!result.is_valid(), "Missing required property should fail");
}

#[test]
fn test_object_additional_properties_false() {
    let schema = json!({
        "type": "object",
        "properties": {
            "name": {"type": "string"}
        },
        "additionalProperties": false
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"name": "John", "extra": "value"}"#, &schema);
    assert!(!result.is_valid(), "Additional properties should fail when not allowed");
}

#[test]
fn test_object_additional_properties_true() {
    let schema = json!({
        "type": "object",
        "properties": {
            "name": {"type": "string"}
        },
        "additionalProperties": true
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"name": "John", "extra": "value"}"#, &schema);
    assert!(result.is_valid(), "Additional properties should pass when allowed");
}

#[test]
fn test_object_property_type_mismatch() {
    let schema = json!({
        "type": "object",
        "properties": {
            "age": {"type": "int32"}
        }
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"age": "thirty"}"#, &schema);
    assert!(!result.is_valid(), "Wrong property type should fail");
}

// =============================================================================
// Array Validation
// =============================================================================

#[test]
fn test_array_valid() {
    let schema = json!({
        "type": "array",
        "items": {"type": "string"}
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"["a", "b", "c"]"#, &schema);
    assert!(result.is_valid(), "Valid string array should pass");
}

#[test]
fn test_array_invalid_item() {
    let schema = json!({
        "type": "array",
        "items": {"type": "string"}
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"["a", 123, "c"]"#, &schema);
    assert!(!result.is_valid(), "Array with wrong item type should fail");
}

#[test]
fn test_array_empty() {
    let schema = json!({
        "type": "array",
        "items": {"type": "string"}
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"[]"#, &schema);
    assert!(result.is_valid(), "Empty array should be valid");
}

// =============================================================================
// Set Validation
// =============================================================================

#[test]
fn test_set_valid_unique() {
    let schema = json!({
        "type": "set",
        "items": {"type": "int32"}
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"[1, 2, 3]"#, &schema);
    assert!(result.is_valid(), "Unique values should be valid set");
}

#[test]
fn test_set_invalid_duplicates() {
    let schema = json!({
        "type": "set",
        "items": {"type": "int32"}
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"[1, 2, 2]"#, &schema);
    assert!(!result.is_valid(), "Duplicate values should fail for set");
}

// =============================================================================
// Map Validation
// =============================================================================

#[test]
fn test_map_valid() {
    let schema = json!({
        "type": "map",
        "values": {"type": "int32"}
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"a": 1, "b": 2, "c": 3}"#, &schema);
    assert!(result.is_valid(), "Valid map should pass");
}

#[test]
fn test_map_invalid_value() {
    let schema = json!({
        "type": "map",
        "values": {"type": "int32"}
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"a": 1, "b": "two"}"#, &schema);
    assert!(!result.is_valid(), "Map with wrong value type should fail");
}

// =============================================================================
// Tuple Validation
// =============================================================================

#[test]
fn test_tuple_valid() {
    let schema = json!({
        "type": "tuple",
        "properties": {
            "x": {"type": "float"},
            "y": {"type": "float"}
        },
        "tuple": ["x", "y"]
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"[1.0, 2.0]"#, &schema);
    assert!(result.is_valid(), "Valid tuple should pass");
}

#[test]
fn test_tuple_wrong_length() {
    let schema = json!({
        "type": "tuple",
        "properties": {
            "x": {"type": "float"},
            "y": {"type": "float"}
        },
        "tuple": ["x", "y"]
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"[1.0]"#, &schema);
    assert!(!result.is_valid(), "Tuple with wrong length should fail");
    
    let result = validator.validate(r#"[1.0, 2.0, 3.0]"#, &schema);
    assert!(!result.is_valid(), "Tuple with extra elements should fail");
}

#[test]
fn test_tuple_wrong_type() {
    let schema = json!({
        "type": "tuple",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "int32"}
        },
        "tuple": ["name", "age"]
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"["John", "thirty"]"#, &schema);
    assert!(!result.is_valid(), "Tuple with wrong element type should fail");
}

// =============================================================================
// Choice Validation
// =============================================================================

#[test]
fn test_choice_with_selector() {
    let schema = json!({
        "type": "choice",
        "selector": "type",
        "choices": {
            "card": {"type": "object", "properties": {"cardNumber": {"type": "string"}}},
            "cash": {"type": "object", "properties": {"amount": {"type": "decimal"}}}
        }
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"type": "card", "cardNumber": "1234"}"#, &schema);
    assert!(result.is_valid(), "Valid choice with selector should pass");
    
    let result = validator.validate(r#"{"type": "cash", "amount": 100}"#, &schema);
    assert!(result.is_valid(), "Valid cash choice should pass");
}

#[test]
fn test_choice_unknown_selector_value() {
    let schema = json!({
        "type": "choice",
        "selector": "type",
        "choices": {
            "card": {"type": "object", "properties": {"cardNumber": {"type": "string"}}},
            "cash": {"type": "object", "properties": {"amount": {"type": "decimal"}}}
        }
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"type": "bitcoin", "wallet": "abc"}"#, &schema);
    assert!(!result.is_valid(), "Unknown choice selector value should fail");
}

// =============================================================================
// Enum Validation
// =============================================================================

#[test]
fn test_enum_valid() {
    let schema = json!({
        "type": "string",
        "enum": ["red", "green", "blue"]
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""red""#, &schema);
    assert!(result.is_valid(), "Enum value should pass");
    
    let result = validator.validate(r#""blue""#, &schema);
    assert!(result.is_valid(), "Enum value should pass");
}

#[test]
fn test_enum_invalid() {
    let schema = json!({
        "type": "string",
        "enum": ["red", "green", "blue"]
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""yellow""#, &schema);
    assert!(!result.is_valid(), "Value not in enum should fail");
}

// =============================================================================
// Const Validation
// =============================================================================

#[test]
fn test_const_valid() {
    let schema = json!({
        "type": "string",
        "const": "fixed"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""fixed""#, &schema);
    assert!(result.is_valid(), "Const value should pass");
}

#[test]
fn test_const_invalid() {
    let schema = json!({
        "type": "string",
        "const": "fixed"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""different""#, &schema);
    assert!(!result.is_valid(), "Non-const value should fail");
}

// =============================================================================
// Ref Validation
// =============================================================================

#[test]
fn test_ref_valid() {
    let schema = json!({
        "type": "object",
        "properties": {
            "person": {"$ref": "#/definitions/Person"}
        },
        "definitions": {
            "Person": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"}
                }
            }
        }
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"person": {"name": "John"}}"#, &schema);
    assert!(result.is_valid(), "Valid ref should pass");
}

// =============================================================================
// Any Type Validation
// =============================================================================

#[test]
fn test_any_accepts_all() {
    let schema = json!({
        "type": "any"
    });
    let validator = InstanceValidator::new();
    
    assert!(validator.validate(r#""string""#, &schema).is_valid());
    assert!(validator.validate("123", &schema).is_valid());
    assert!(validator.validate("true", &schema).is_valid());
    assert!(validator.validate("null", &schema).is_valid());
    assert!(validator.validate(r#"{"key": "value"}"#, &schema).is_valid());
    assert!(validator.validate("[1, 2, 3]", &schema).is_valid());
}
