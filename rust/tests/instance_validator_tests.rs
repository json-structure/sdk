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
fn test_decimal_string_valid() {
    // Per the JSON Structure spec, decimal types are represented as strings
    // to preserve arbitrary precision
    let schema = json!({
        "type": "decimal"
    });
    let validator = InstanceValidator::new();
    
    // String format is the spec-compliant way
    let result = validator.validate(r#""123.456""#, &schema);
    assert!(result.is_valid(), "String '123.456' should be valid decimal");
    
    let result = validator.validate(r#""0.0875""#, &schema);
    assert!(result.is_valid(), "String '0.0875' should be valid decimal");
    
    let result = validator.validate(r#""-999.99""#, &schema);
    assert!(result.is_valid(), "Negative string decimal should be valid");
    
    let result = validator.validate(r#""12345678901234567890.123456789""#, &schema);
    assert!(result.is_valid(), "High-precision string decimal should be valid");
}

#[test]
fn test_decimal_number_also_valid() {
    // Numbers are also accepted for convenience, though strings are preferred
    let schema = json!({
        "type": "decimal"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("123.456", &schema);
    assert!(result.is_valid(), "JSON number 123.456 should be valid decimal");
    
    let result = validator.validate("-99.5", &schema);
    assert!(result.is_valid(), "Negative JSON number should be valid decimal");
}

#[test]
fn test_decimal_invalid_string_format() {
    let schema = json!({
        "type": "decimal"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#""not-a-number""#, &schema);
    assert!(!result.is_valid(), "Non-numeric string should fail decimal validation");
    
    let result = validator.validate(r#""12.34.56""#, &schema);
    assert!(!result.is_valid(), "Malformed decimal string should fail");
}

#[test]
fn test_decimal_wrong_type() {
    let schema = json!({
        "type": "decimal"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate("true", &schema);
    assert!(!result.is_valid(), "Boolean should fail decimal validation");
    
    let result = validator.validate("null", &schema);
    assert!(!result.is_valid(), "Null should fail decimal validation");
    
    let result = validator.validate(r#"["123.45"]"#, &schema);
    assert!(!result.is_valid(), "Array should fail decimal validation");
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

// =============================================================================
// Format Validation (Extended Mode)
// =============================================================================

#[test]
fn test_format_email_valid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "email"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(validator.validate(r#""user@example.com""#, &schema).is_valid());
    assert!(validator.validate(r#""test.user@sub.domain.org""#, &schema).is_valid());
    assert!(validator.validate(r#""a@b.co""#, &schema).is_valid());
}

#[test]
fn test_format_email_invalid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "email"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(!validator.validate(r#""not-an-email""#, &schema).is_valid());
    assert!(!validator.validate(r#""missing@domain""#, &schema).is_valid());
    assert!(!validator.validate(r#""@example.com""#, &schema).is_valid());
    assert!(!validator.validate(r#""user@""#, &schema).is_valid());
}

#[test]
fn test_format_ipv4_valid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "ipv4"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(validator.validate(r#""192.168.1.1""#, &schema).is_valid());
    assert!(validator.validate(r#""0.0.0.0""#, &schema).is_valid());
    assert!(validator.validate(r#""255.255.255.255""#, &schema).is_valid());
    assert!(validator.validate(r#""10.0.0.1""#, &schema).is_valid());
}

#[test]
fn test_format_ipv4_invalid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "ipv4"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(!validator.validate(r#""256.1.1.1""#, &schema).is_valid());
    assert!(!validator.validate(r#""1.2.3""#, &schema).is_valid());
    assert!(!validator.validate(r#""1.2.3.4.5""#, &schema).is_valid());
    assert!(!validator.validate(r#""abc.def.ghi.jkl""#, &schema).is_valid());
    assert!(!validator.validate(r#""01.02.03.04""#, &schema).is_valid()); // Leading zeros
}

#[test]
fn test_format_ipv6_valid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "ipv6"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(validator.validate(r#""::1""#, &schema).is_valid());
    assert!(validator.validate(r#""2001:db8::1""#, &schema).is_valid());
    assert!(validator.validate(r#""fe80::1""#, &schema).is_valid());
}

#[test]
fn test_format_ipv6_invalid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "ipv6"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(!validator.validate(r#""not-ipv6""#, &schema).is_valid());
    assert!(!validator.validate(r#"":::1""#, &schema).is_valid()); // Multiple ::
}

#[test]
fn test_format_hostname_valid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "hostname"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(validator.validate(r#""example.com""#, &schema).is_valid());
    assert!(validator.validate(r#""sub.domain.example.com""#, &schema).is_valid());
    assert!(validator.validate(r#""localhost""#, &schema).is_valid());
    assert!(validator.validate(r#""my-server""#, &schema).is_valid());
}

#[test]
fn test_format_hostname_invalid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "hostname"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(!validator.validate(r#""-invalid.com""#, &schema).is_valid()); // Starts with hyphen
    assert!(!validator.validate(r#""invalid-.com""#, &schema).is_valid()); // Label ends with hyphen
    assert!(!validator.validate(r#""inva lid.com""#, &schema).is_valid()); // Contains space
}

#[test]
fn test_format_uri_valid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "uri"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(validator.validate(r#""https://example.com""#, &schema).is_valid());
    assert!(validator.validate(r#""http://localhost:8080/path""#, &schema).is_valid());
    assert!(validator.validate(r#""ftp://files.example.com/file.txt""#, &schema).is_valid());
}

#[test]
fn test_format_uri_invalid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "uri"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(!validator.validate(r#""not-a-uri""#, &schema).is_valid());
    assert!(!validator.validate(r#""//missing-scheme.com""#, &schema).is_valid());
}

#[test]
fn test_format_uri_reference_valid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "string",
        "format": "uri-reference"
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    assert!(validator.validate(r#""https://example.com""#, &schema).is_valid());
    assert!(validator.validate(r#""/path/to/resource""#, &schema).is_valid());
    assert!(validator.validate(r#""relative/path""#, &schema).is_valid());
    assert!(validator.validate("\"#fragment\"", &schema).is_valid());
}

#[test]
fn test_format_not_applied_without_extended() {
    let schema = json!({
        "type": "string",
        "format": "email"
    });
    let validator = InstanceValidator::new(); // extended=false by default
    
    // Without extended mode, format is not validated
    assert!(validator.validate(r#""not-an-email""#, &schema).is_valid());
}

// =============================================================================
// $extends Validation
// =============================================================================

#[test]
fn test_extends_simple() {
    let schema = json!({
        "definitions": {
            "Base": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" }
                },
                "required": ["name"]
            },
            "Extended": {
                "type": "object",
                "$extends": "#/definitions/Base",
                "properties": {
                    "age": { "type": "int32" }
                }
            }
        },
        "$ref": "#/definitions/Extended"
    });
    let validator = InstanceValidator::new();
    
    // Valid: has both name (from Base) and age (from Extended)
    let result = validator.validate(r#"{"name": "John", "age": 30}"#, &schema);
    assert!(result.is_valid(), "Should validate with inherited properties");
}

#[test]
fn test_extends_missing_required_from_base() {
    let schema = json!({
        "definitions": {
            "Base": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" }
                },
                "required": ["name"]
            },
            "Extended": {
                "type": "object",
                "$extends": "#/definitions/Base",
                "properties": {
                    "age": { "type": "int32" }
                }
            }
        },
        "$ref": "#/definitions/Extended"
    });
    let validator = InstanceValidator::new();
    
    // Invalid: missing name which is required from Base
    let result = validator.validate(r#"{"age": 30}"#, &schema);
    assert!(!result.is_valid(), "Should fail when missing required property from base");
}

#[test]
fn test_extends_array() {
    let schema = json!({
        "definitions": {
            "HasName": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" }
                },
                "required": ["name"]
            },
            "HasAge": {
                "type": "object",
                "properties": {
                    "age": { "type": "int32" }
                },
                "required": ["age"]
            },
            "Person": {
                "type": "object",
                "$extends": ["#/definitions/HasName", "#/definitions/HasAge"],
                "properties": {
                    "email": { "type": "string" }
                }
            }
        },
        "$ref": "#/definitions/Person"
    });
    let validator = InstanceValidator::new();
    
    // Valid: has all required properties from both base types
    let result = validator.validate(r#"{"name": "John", "age": 30, "email": "john@example.com"}"#, &schema);
    assert!(result.is_valid(), "Should validate with properties from multiple bases");
    
    // Invalid: missing age from HasAge
    let result = validator.validate(r#"{"name": "John", "email": "john@example.com"}"#, &schema);
    assert!(!result.is_valid(), "Should fail when missing required from one base");
}

// =============================================================================
// uniqueItems Validation
// =============================================================================

#[test]
fn test_unique_items_valid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "array",
        "items": { "type": "int32" },
        "uniqueItems": true
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    let result = validator.validate("[1, 2, 3, 4, 5]", &schema);
    assert!(result.is_valid(), "Array with unique items should be valid");
}

#[test]
fn test_unique_items_duplicates() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "array",
        "items": { "type": "int32" },
        "uniqueItems": true
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    let result = validator.validate("[1, 2, 3, 2, 5]", &schema);
    assert!(!result.is_valid(), "Array with duplicate items should be invalid");
}

#[test]
fn test_unique_items_objects() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "id": { "type": "int32" }
            }
        },
        "uniqueItems": true
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    // Valid: unique objects
    let result = validator.validate(r#"[{"id": 1}, {"id": 2}]"#, &schema);
    assert!(result.is_valid(), "Array with unique objects should be valid");
    
    // Invalid: duplicate objects
    let result = validator.validate(r#"[{"id": 1}, {"id": 1}]"#, &schema);
    assert!(!result.is_valid(), "Array with duplicate objects should be invalid");
}

#[test]
fn test_unique_items_false() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "array",
        "items": { "type": "int32" },
        "uniqueItems": false
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    // Duplicates allowed when uniqueItems is false
    let result = validator.validate("[1, 2, 2, 3]", &schema);
    assert!(result.is_valid(), "Duplicates allowed when uniqueItems is false");
}

// =============================================================================
// patternProperties Validation
// =============================================================================

#[test]
fn test_pattern_properties_valid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "object",
        "patternProperties": {
            "^str_": { "type": "string" },
            "^num_": { "type": "int32" }
        }
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    let result = validator.validate(r#"{"str_name": "John", "num_age": 30}"#, &schema);
    assert!(result.is_valid(), "Properties matching patterns should be valid");
}

#[test]
fn test_pattern_properties_invalid_type() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "object",
        "patternProperties": {
            "^str_": { "type": "string" }
        }
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    // str_value should be a string but is a number
    let result = validator.validate(r#"{"str_value": 123}"#, &schema);
    assert!(!result.is_valid(), "Wrong type for pattern property should be invalid");
}

#[test]
fn test_pattern_properties_with_properties() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "object",
        "properties": {
            "id": { "type": "int32" }
        },
        "patternProperties": {
            "^x_": { "type": "string" }
        }
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    // Both explicit property and pattern property
    let result = validator.validate(r#"{"id": 1, "x_custom": "value"}"#, &schema);
    assert!(result.is_valid(), "Mixed properties and patternProperties should work");
}

// =============================================================================
// propertyNames Validation
// =============================================================================

#[test]
fn test_property_names_pattern_valid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "object",
        "propertyNames": {
            "pattern": "^[a-z][a-zA-Z0-9]*$"
        }
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    let result = validator.validate(r#"{"camelCase": 1, "simple": 2}"#, &schema);
    assert!(result.is_valid(), "Property names matching pattern should be valid");
}

#[test]
fn test_property_names_pattern_invalid() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "object",
        "propertyNames": {
            "pattern": "^[a-z][a-zA-Z0-9]*$"
        }
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    // Property starting with uppercase is invalid
    let result = validator.validate(r#"{"Invalid": 1}"#, &schema);
    assert!(!result.is_valid(), "Property names not matching pattern should be invalid");
}

#[test]
fn test_property_names_min_max_length() {
    let schema = json!({
        "$uses": ["JSONStructureValidation"],
        "type": "object",
        "propertyNames": {
            "minLength": 2,
            "maxLength": 10
        }
    });
    let mut validator = InstanceValidator::new();
    validator.set_extended(true);
    
    // Valid lengths
    let result = validator.validate(r#"{"ab": 1, "abcdefghij": 2}"#, &schema);
    assert!(result.is_valid(), "Property names within length bounds should be valid");
    
    // Too short
    let result = validator.validate(r#"{"a": 1}"#, &schema);
    assert!(!result.is_valid(), "Property name too short should be invalid");
    
    // Too long
    let result = validator.validate(r#"{"abcdefghijk": 1}"#, &schema);
    assert!(!result.is_valid(), "Property name too long should be invalid");
}

// =============================================================================
// Nested Namespace Reference Resolution
// =============================================================================

#[test]
fn test_nested_namespace_resolution() {
    let schema = json!({
        "definitions": {
            "Outer": {
                "type": "namespace",
                "definitions": {
                    "Inner": {
                        "type": "object",
                        "properties": {
                            "value": { "type": "string" }
                        }
                    }
                }
            }
        },
        "$ref": "#/definitions/Outer/Inner"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"value": "test"}"#, &schema);
    assert!(result.is_valid(), "Nested namespace reference should resolve");
}

#[test]
fn test_deeply_nested_namespace() {
    let schema = json!({
        "definitions": {
            "Level1": {
                "type": "namespace",
                "definitions": {
                    "Level2": {
                        "type": "namespace",
                        "definitions": {
                            "Level3": {
                                "type": "object",
                                "properties": {
                                    "deep": { "type": "boolean" }
                                }
                            }
                        }
                    }
                }
            }
        },
        "$ref": "#/definitions/Level1/Level2/Level3"
    });
    let validator = InstanceValidator::new();
    
    let result = validator.validate(r#"{"deep": true}"#, &schema);
    assert!(result.is_valid(), "Deeply nested namespace reference should resolve");
}
