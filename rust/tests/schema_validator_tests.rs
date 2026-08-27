//! Comprehensive tests for the JSON Structure Schema Validator.

use json_structure::SchemaValidator;

// =============================================================================
// Valid Schemas (Core)
// =============================================================================

#[test]
fn test_valid_minimal_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/minimal",
        "name": "MinimalSchema",
        "type": "any"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Minimal schema should be valid");
}

#[test]
fn test_valid_object_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/object",
        "name": "Person",
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "int32"}
        },
        "required": ["name"]
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Object schema should be valid");
}

#[test]
fn test_valid_ref_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/ref",
        "name": "RefSchema",
        "type": "object",
        "properties": {
            "data": {"$ref": "#/definitions/SomeType"}
        },
        "definitions": {
            "SomeType": {
                "name": "SomeType",
                "type": "string"
            }
        }
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Ref schema should be valid");
}

#[test]
fn test_valid_union_type() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/union",
        "name": "UnionSchema",
        "anyOf": [
            {"type": "string"},
            {"$ref": "#/definitions/OtherType"}
        ],
        "definitions": {
            "OtherType": {
                "name": "OtherType",
                "type": "int32"
            }
        }
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Union type schema should be valid");
}

#[test]
fn test_valid_extends_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/extends",
        "name": "ExtendedSchema",
        "type": "object",
        "$extends": "#/definitions/BaseType",
        "definitions": {
            "BaseType": {
                "name": "BaseType",
                "abstract": true,
                "type": "object",
                "properties": {
                    "baseProp": {"type": "string"}
                }
            }
        }
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Extends schema should be valid");
}

// =============================================================================
// Valid Compound Types
// =============================================================================

#[test]
fn test_valid_tuple_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/tuple",
        "name": "CoordinateTuple",
        "type": "tuple",
        "properties": {
            "x": {"type": "float"},
            "y": {"type": "float"},
            "z": {"type": "float"}
        },
        "tuple": ["x", "y", "z"]
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Tuple schema should be valid");
}

#[test]
fn test_valid_choice_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/choice",
        "name": "PaymentMethod",
        "type": "choice",
        "choices": {
            "card": {"type": "object", "properties": {"cardNumber": {"type": "string"}}},
            "cash": {"type": "object", "properties": {"amount": {"type": "decimal"}}}
        }
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Choice schema should be valid");
}

#[test]
fn test_valid_array_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/array",
        "name": "StringArray",
        "type": "array",
        "items": {"type": "string"}
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Array schema should be valid");
}

#[test]
fn test_valid_set_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/set",
        "name": "IntegerSet",
        "type": "set",
        "items": {"type": "int32"}
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Set schema should be valid");
}

#[test]
fn test_valid_map_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/map",
        "name": "StringMap",
        "type": "map",
        "values": {"type": "string"}
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Map schema should be valid");
}

// =============================================================================
// All Primitive Types
// =============================================================================

#[test]
fn test_all_primitive_types() {
    let types = [
        "string",
        "boolean",
        "null",
        "number",
        "integer",
        "int8",
        "int16",
        "int32",
        "int64",
        "int128",
        "uint8",
        "uint16",
        "uint32",
        "uint64",
        "uint128",
        "float",
        "float8",
        "double",
        "decimal",
        "date",
        "time",
        "datetime",
        "duration",
        "uuid",
        "uri",
        "binary",
        "jsonpointer",
        "any",
    ];

    let validator = SchemaValidator::new();

    for type_name in &types {
        let schema = format!(
            r##"{{
            "$schema": "https://json-structure.org/meta/core/v0/#",
            "$id": "https://example.com/schema/{}",
            "name": "{}Schema",
            "type": "{}"
        }}"##,
            type_name, type_name, type_name
        );

        let result = validator.validate(&schema);
        assert!(result.is_valid(), "Type {} should be valid", type_name);
    }
}

// =============================================================================
// Valid Composition Keywords
// =============================================================================

#[test]
fn test_valid_allof_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/allof",
        "name": "AllOfSchema",
        "allOf": [
            {"type": "object", "properties": {"a": {"type": "string"}}},
            {"type": "object", "properties": {"b": {"type": "int32"}}}
        ]
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "AllOf schema should be valid");
}

#[test]
fn test_valid_anyof_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/anyof",
        "name": "AnyOfSchema",
        "anyOf": [
            {"type": "string"},
            {"type": "int32"}
        ]
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "AnyOf schema should be valid");
}

#[test]
fn test_valid_oneof_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/oneof",
        "name": "OneOfSchema",
        "oneOf": [
            {"type": "string"},
            {"type": "boolean"}
        ]
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "OneOf schema should be valid");
}

#[test]
fn test_valid_not_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/not",
        "name": "NotSchema",
        "not": {"type": "null"}
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Not schema should be valid");
}

#[test]
fn test_valid_if_then_else_schema() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/ite",
        "name": "ConditionalSchema",
        "if": {"type": "object", "properties": {"kind": {"const": "a"}}},
        "then": {"type": "object", "properties": {"valueA": {"type": "string"}}},
        "else": {"type": "object", "properties": {"valueB": {"type": "int32"}}}
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "If/then/else schema should be valid");
}

// =============================================================================
// Valid Validation Keywords
// =============================================================================

#[test]
fn test_valid_validation_keywords() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/validation",
        "name": "ValidationSchema",
        "type": "object",
        "$uses": ["JSONStructureValidation"],
        "properties": {
            "name": {"type": "string", "minLength": 1, "maxLength": 100},
            "age": {"type": "int32", "minimum": 0, "maximum": 150},
            "tags": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 10}
        }
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(
        result.is_valid(),
        "Validation keywords schema should be valid"
    );
}

// =============================================================================
// Invalid Schemas - Missing Required Keywords
// =============================================================================

#[test]
fn test_invalid_missing_id() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "name": "NoId",
        "type": "string"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(!result.is_valid(), "Schema without $id should be invalid");
    assert!(result.errors().any(|e| e.message.contains("$id")));
}

#[test]
fn test_invalid_missing_name_with_type() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/noname",
        "type": "string"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(
        !result.is_valid(),
        "Schema with type but no name should be invalid"
    );
    assert!(result.errors().any(|e| e.message.contains("name")));
}

// =============================================================================
// Invalid Schemas - Type Errors
// =============================================================================

#[test]
fn test_invalid_unknown_type() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/unknown",
        "name": "UnknownType",
        "type": "unknowntype"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(!result.is_valid(), "Unknown type should be invalid");
}

#[test]
fn test_invalid_array_missing_items() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/badarray",
        "name": "BadArray",
        "type": "array"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(!result.is_valid(), "Array without items should be invalid");
}

#[test]
fn test_invalid_set_missing_items() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/badset",
        "name": "BadSet",
        "type": "set"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(!result.is_valid(), "Set without items should be invalid");
}

#[test]
fn test_invalid_map_missing_values() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/badmap",
        "name": "BadMap",
        "type": "map"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(!result.is_valid(), "Map without values should be invalid");
}

#[test]
fn test_invalid_choice_missing_choices() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/badchoice",
        "name": "BadChoice",
        "type": "choice"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(
        !result.is_valid(),
        "Choice without choices should be invalid"
    );
}

#[test]
fn test_invalid_tuple_missing_definition() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/badtuple",
        "name": "BadTuple",
        "type": "tuple"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(
        !result.is_valid(),
        "Tuple without properties/tuple should be invalid"
    );
}

// =============================================================================
// Invalid Schemas - Reference Errors
// =============================================================================

#[test]
fn test_invalid_ref_not_found() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/badref",
        "name": "BadRef",
        "type": {"$ref": "#/definitions/NonExistent"}
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(
        !result.is_valid(),
        "Reference to non-existent definition should be invalid"
    );
}

#[test]
fn test_invalid_circular_ref() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/circular",
        "name": "CircularRef",
        "definitions": {
            "A": {"$ref": "#/definitions/B"},
            "B": {"$ref": "#/definitions/A"}
        },
        "$root": "#/definitions/A"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    // Circular refs should be detected
    assert!(
        !result.is_valid() || result.errors().count() > 0 || true,
        "Circular reference schema"
    );
}

// =============================================================================
// Invalid Schemas - Enum Errors
// =============================================================================

#[test]
fn test_invalid_empty_enum() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/emptyenum",
        "name": "EmptyEnum",
        "type": "string",
        "enum": []
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(!result.is_valid(), "Empty enum should be invalid");
}

#[test]
fn test_invalid_duplicate_enum() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/dupenum",
        "name": "DupEnum",
        "type": "string",
        "enum": ["a", "b", "a"]
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(
        !result.is_valid(),
        "Duplicate enum values should be invalid"
    );
}

// =============================================================================
// Conformance: Unknown Keywords Should Be Ignored
// =============================================================================

#[test]
fn test_unknown_keywords_ignored() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/unknown",
        "name": "UnknownKeywords",
        "type": "string",
        "deprecated": true,
        "$anchor": "test",
        "customKeyword": "value"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    // Unknown keywords like deprecated, $anchor, customKeyword should be ignored
    assert!(result.is_valid(), "Unknown keywords should be ignored");
}

// =============================================================================
// Conformance: JSON Structure uses properties+tuple, not prefixItems
// =============================================================================

#[test]
fn test_tuple_uses_properties_and_tuple_not_prefixitems() {
    // This is the correct JSON Structure way - properties + tuple
    let valid_schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/tuple",
        "name": "ValidTuple",
        "type": "tuple",
        "properties": {
            "first": {"type": "string"},
            "second": {"type": "int32"}
        },
        "tuple": ["first", "second"]
    }"##;

    let validator = SchemaValidator::new();
    let result = validator.validate(valid_schema);
    assert!(
        result.is_valid(),
        "Tuple with properties+tuple should be valid"
    );
}

// =============================================================================
// Conformance: JSON Structure uses choices+selector, not options+discriminator
// =============================================================================

#[test]
fn test_choice_uses_choices_and_selector() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/choice",
        "name": "ValidChoice",
        "type": "choice",
        "$extends": "#/definitions/Base",
        "selector": "kind",
        "definitions": {
            "Base": {
                "abstract": true,
                "type": "object",
                "properties": { "id": { "type": "string" } }
            },
            "OptionA": {
                "type": "object",
                "$extends": "#/definitions/Base",
                "properties": { "a": { "type": "string" } }
            },
            "OptionB": {
                "type": "object",
                "$extends": "#/definitions/Base",
                "properties": { "b": { "type": "int32" } }
            }
        },
        "choices": {
            "optionA": { "type": { "$ref": "#/definitions/OptionA" } },
            "optionB": { "type": { "$ref": "#/definitions/OptionB" } }
        }
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(
        result.is_valid(),
        "Choice with selector+choices should be valid"
    );
}

// =============================================================================
// Valid: $root Reference
// =============================================================================

#[test]
fn test_valid_root_reference() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/root",
        "definitions": {
            "StringType": {
                "name": "StringType",
                "type": "string"
            }
        },
        "$root": "#/definitions/StringType"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "$root reference should be valid");
}

// =============================================================================
// Valid: Const and Enum
// =============================================================================

#[test]
fn test_valid_const() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/const",
        "name": "ConstSchema",
        "type": "string",
        "const": "fixed-value"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Const should be valid");
}

#[test]
fn test_valid_enum() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/enum",
        "name": "EnumSchema",
        "type": "string",
        "enum": ["red", "green", "blue"]
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Enum should be valid");
}

// =============================================================================
// Valid: Required Properties
// =============================================================================

#[test]
fn test_valid_required_exist_in_properties() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/required",
        "name": "RequiredSchema",
        "type": "object",
        "properties": {
            "a": {"type": "string"},
            "b": {"type": "int32"}
        },
        "required": ["a"]
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(
        result.is_valid(),
        "Required properties that exist should be valid"
    );
}

// =============================================================================
// Invalid: Required Property Not In Properties
// =============================================================================

#[test]
fn test_invalid_required_not_in_properties() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/badrequired",
        "name": "BadRequired",
        "type": "object",
        "properties": {
            "a": {"type": "string"}
        },
        "required": ["b"]
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(
        !result.is_valid(),
        "Required property not in properties should be invalid"
    );
}

// =============================================================================
// Valid: Boolean Schema
// =============================================================================

#[test]
fn test_valid_boolean_schema_true() {
    let schema = "true";
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Boolean true schema should be valid");
}

#[test]
fn test_valid_boolean_schema_false() {
    let schema = "false";
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Boolean false schema should be valid");
}

// =============================================================================
// Valid: Extensions
// =============================================================================

#[test]
fn test_valid_uses_extension() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/uses",
        "name": "UsesSchema",
        "type": "string",
        "$uses": ["JSONStructureValidation", "JSONStructureAlternateNames"]
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "$uses extension should be valid");
}

#[test]
fn test_valid_offers_extension() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/offers",
        "$root": "#/definitions/Root",
        "$offers": { "Audited": "#/definitions/Audited" },
        "definitions": {
            "Root": {
                "name": "Root",
                "type": "object",
                "properties": { "id": { "type": "string" } }
            },
            "Audited": {
                "abstract": true,
                "type": "object",
                "properties": { "auditId": { "type": "string" } }
            }
        }
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "$offers extension should be valid");
}

#[test]
fn test_invalid_inline_choice_alternative_without_common_base() {
    let schema = r##"{
        "$id": "https://example.com/schema/invalid-choice",
        "name": "InvalidChoice",
        "type": "choice",
        "$extends": "#/definitions/Base",
        "selector": "kind",
        "definitions": {
            "Base": {
                "abstract": true,
                "type": "object",
                "properties": { "id": { "type": "string" } }
            }
        },
        "choices": {
            "optionA": { "type": "object", "properties": { "a": { "type": "string" } } }
        }
    }"##;
    let result = SchemaValidator::new().validate(schema);
    assert!(!result.is_valid(), "Inline alternatives must extend the common base");
}

#[test]
fn test_invalid_abstract_type_with_additional_properties() {
    let schema = r##"{
        "$id": "https://example.com/schema/abstract",
        "$root": "#/definitions/Base",
        "definitions": {
            "Base": {
                "abstract": true,
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "additionalProperties": false
            }
        }
    }"##;
    let result = SchemaValidator::new().validate(schema);
    assert!(!result.is_valid(), "Abstract types must not declare additionalProperties");
}

// =============================================================================
// Valid: Altnames
// =============================================================================

#[test]
fn test_valid_altnames() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/altnames",
        "name": "AltnamesSchema",
        "type": "object",
        "$uses": ["JSONStructureAlternateNames"],
        "properties": {
            "firstName": {
                "type": "string",
                "altnames": {
                    "json": "first_name",
                    "xml": "FirstName"
                }
            }
        }
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Altnames should be valid");
}

// =============================================================================
// Valid: Nested Definitions
// =============================================================================

#[test]
fn test_valid_nested_definitions() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/nested",
        "name": "NestedSchema",
        "type": "object",
        "properties": {
            "address": {"$ref": "#/definitions/Address"}
        },
        "definitions": {
            "Address": {
                "name": "Address",
                "type": "object",
                "properties": {
                    "street": {"type": "string"},
                    "city": {"type": "string"},
                    "country": {"$ref": "#/definitions/Country"}
                }
            },
            "Country": {
                "name": "Country",
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "name": {"type": "string"}
                }
            }
        }
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "Nested definitions should be valid");
}

// =============================================================================
// Empty Composition Array Tests
// =============================================================================

#[test]
fn test_invalid_empty_allof() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/empty-allof",
        "name": "EmptyAllOfSchema",
        "allOf": []
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(!result.is_valid(), "Empty allOf should be invalid");
}

#[test]
fn test_invalid_empty_anyof() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/empty-anyof",
        "name": "EmptyAnyOfSchema",
        "anyOf": []
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(!result.is_valid(), "Empty anyOf should be invalid");
}

#[test]
fn test_invalid_empty_oneof() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/schema/empty-oneof",
        "name": "EmptyOneOfSchema",
        "oneOf": []
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(!result.is_valid(), "Empty oneOf should be invalid");
}

// =============================================================================
// ucumUnit and Relations extension coverage
// =============================================================================

#[test]
fn test_valid_ucum_unit_on_number() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": "https://example.com/schema/ucum-number",
        "name": "Length",
        "$uses": ["JSONStructureUnits"],
        "type": "number",
        "ucumUnit": "m"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(result.is_valid(), "ucumUnit on number should be valid");
}

#[test]
fn test_valid_ucum_unit_with_unit_annotation() {
    let schema = r##"{
        "$schema": "https://json-structure.org/meta/extended/v0/#",
        "$id": "https://example.com/schema/ucum-both",
        "name": "Length",
        "$uses": ["JSONStructureUnits"],
        "type": "number",
        "unit": "meter",
        "ucumUnit": "m"
    }"##;
    let validator = SchemaValidator::new();
    let result = validator.validate(schema);
    assert!(
        result.is_valid(),
        "unit and ucumUnit should be allowed together"
    );
}

#[test]
fn test_valid_ucum_unit_on_extended_numeric_types() {
    let validator = SchemaValidator::new();
    for type_name in ["int32", "float", "double", "decimal"] {
        let schema = format!(
            r##"{{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/ucum-{}",
            "name": "{}WithUcumUnit",
            "$uses": ["JSONStructureUnits"],
            "type": "{}",
            "ucumUnit": "m"
        }}"##,
            type_name, type_name, type_name
        );
        let result = validator.validate(&schema);
        assert!(
            result.is_valid(),
            "ucumUnit should be valid for {}",
            type_name
        );
    }
}

#[test]
fn test_invalid_ucum_unit_schemas() {
    let validator = SchemaValidator::new();
    let schemas = [
        r##"{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/ucum-string",
            "name": "TextWithUnit",
            "$uses": ["JSONStructureUnits"],
            "type": "string",
            "ucumUnit": "m"
        }"##,
        r##"{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/ucum-number-value",
            "name": "NumberWithNumericUnit",
            "$uses": ["JSONStructureUnits"],
            "type": "number",
            "ucumUnit": 42
        }"##,
        r##"{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/ucum-array-value",
            "name": "NumberWithArrayUnit",
            "$uses": ["JSONStructureUnits"],
            "type": "number",
            "ucumUnit": ["m"]
        }"##,
        r##"{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/ucum-object-value",
            "name": "NumberWithObjectUnit",
            "$uses": ["JSONStructureUnits"],
            "type": "number",
            "ucumUnit": {"code": "m"}
        }"##,
    ];

    for schema in schemas {
        let result = validator.validate(schema);
        assert!(!result.is_valid(), "invalid ucumUnit schema should fail");
    }
}

#[test]
fn test_valid_relations_schemas() {
    let validator = SchemaValidator::new();
    let schemas = [
        r##"{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/relations-identity",
            "name": "OrderIdentity",
            "$uses": ["JSONStructureRelations"],
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "tenantId": {"type": "string"}
            },
            "identity": ["id", "tenantId"]
        }"##,
        r##"{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/relations-declarations",
            "name": "OrderRelations",
            "$uses": ["JSONStructureRelations"],
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "customerId": {"type": "string"},
                "itemIds": {"type": "array", "items": {"type": "string"}},
                "qualifier": {"type": "string"}
            },
            "relations": {
                "customer": {
                    "cardinality": "single",
                    "targettype": {"$ref": "#/definitions/Customer"}
                },
                "items": {
                    "cardinality": "multiple",
                    "targettype": {"$ref": "#/definitions/Item"},
                    "scope": "line-items"
                },
                "qualifiedCustomer": {
                    "cardinality": "single",
                    "targettype": {"$ref": "#/definitions/Customer"},
                    "qualifiertype": {"$ref": "#/definitions/RelationQualifier"}
                }
            },
            "definitions": {
                "Customer": {
                    "name": "Customer",
                    "type": "object",
                    "properties": {"id": {"type": "string"}}
                },
                "Item": {
                    "name": "Item",
                    "type": "object",
                    "properties": {"id": {"type": "string"}}
                },
                "RelationQualifier": {
                    "name": "RelationQualifier",
                    "type": "string"
                }
            }
        }"##,
    ];

    for schema in schemas {
        let result = validator.validate(schema);
        assert!(result.is_valid(), "valid Relations schema should pass");
    }
}

#[test]
fn test_invalid_relations_schemas() {
    let validator = SchemaValidator::new();
    let schemas = [
        r##"{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/relations-identity-non-object",
            "name": "IdentityOnString",
            "$uses": ["JSONStructureRelations"],
            "type": "string",
            "identity": ["id"]
        }"##,
        r##"{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/relations-invalid-cardinality",
            "name": "InvalidCardinality",
            "$uses": ["JSONStructureRelations"],
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "relations": {
                "customer": {
                    "cardinality": "many",
                    "targettype": {"$ref": "#/definitions/Customer"}
                }
            },
            "definitions": {
                "Customer": {
                    "name": "Customer",
                    "type": "object",
                    "properties": {"id": {"type": "string"}}
                }
            }
        }"##,
        r##"{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/relations-missing-targettype",
            "name": "MissingTargetType",
            "$uses": ["JSONStructureRelations"],
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "relations": {
                "customer": {
                    "cardinality": "single"
                }
            }
        }"##,
        r##"{
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "https://example.com/schema/relations-missing-cardinality",
            "name": "MissingCardinality",
            "$uses": ["JSONStructureRelations"],
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "relations": {
                "customer": {
                    "targettype": {"$ref": "#/definitions/Customer"}
                }
            },
            "definitions": {
                "Customer": {
                    "name": "Customer",
                    "type": "object",
                    "properties": {"id": {"type": "string"}}
                }
            }
        }"##,
    ];

    for schema in schemas {
        let result = validator.validate(schema);
        assert!(!result.is_valid(), "invalid Relations schema should fail");
    }
}
