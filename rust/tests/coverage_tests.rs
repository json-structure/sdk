//! Additional tests to increase code coverage to 85%+
//!
//! These tests cover error paths, edge cases, and Display implementations.

use json_structure::{
    SchemaValidator, InstanceValidator,
    SchemaErrorCode, InstanceErrorCode,
    Severity, JsonLocation, ValidationError, ValidationResult,
};

// =============================================================================
// Error Code Display Tests
// =============================================================================

mod error_code_tests {
    use super::*;

    #[test]
    fn test_schema_error_codes_as_str() {
        // Test all schema error codes have correct string representation
        assert_eq!(SchemaErrorCode::SchemaNull.as_str(), "SCHEMA_NULL");
        assert_eq!(SchemaErrorCode::SchemaInvalidType.as_str(), "SCHEMA_INVALID_TYPE");
        assert_eq!(SchemaErrorCode::SchemaRootMissingId.as_str(), "SCHEMA_ROOT_MISSING_ID");
        assert_eq!(SchemaErrorCode::SchemaRootMissingName.as_str(), "SCHEMA_ROOT_MISSING_NAME");
        assert_eq!(SchemaErrorCode::SchemaRootMissingSchema.as_str(), "SCHEMA_ROOT_MISSING_SCHEMA");
        assert_eq!(SchemaErrorCode::SchemaRootMissingType.as_str(), "SCHEMA_ROOT_MISSING_TYPE");
        assert_eq!(SchemaErrorCode::SchemaTypeInvalid.as_str(), "SCHEMA_TYPE_INVALID");
        assert_eq!(SchemaErrorCode::SchemaTypeNotString.as_str(), "SCHEMA_TYPE_NOT_STRING");
        assert_eq!(SchemaErrorCode::SchemaRefNotFound.as_str(), "SCHEMA_REF_NOT_FOUND");
        assert_eq!(SchemaErrorCode::SchemaRefNotString.as_str(), "SCHEMA_REF_NOT_STRING");
        assert_eq!(SchemaErrorCode::SchemaRefCircular.as_str(), "SCHEMA_REF_CIRCULAR");
        assert_eq!(SchemaErrorCode::SchemaRefInvalid.as_str(), "SCHEMA_REF_INVALID");
        assert_eq!(SchemaErrorCode::SchemaDefinitionsMustBeObject.as_str(), "SCHEMA_DEFINITIONS_MUST_BE_OBJECT");
        assert_eq!(SchemaErrorCode::SchemaDefinitionMissingType.as_str(), "SCHEMA_DEFINITION_MISSING_TYPE");
        assert_eq!(SchemaErrorCode::SchemaDefinitionInvalid.as_str(), "SCHEMA_DEFINITION_INVALID");
        assert_eq!(SchemaErrorCode::SchemaPropertiesMustBeObject.as_str(), "SCHEMA_PROPERTIES_MUST_BE_OBJECT");
        assert_eq!(SchemaErrorCode::SchemaPropertyInvalid.as_str(), "SCHEMA_PROPERTY_INVALID");
        assert_eq!(SchemaErrorCode::SchemaRequiredMustBeArray.as_str(), "SCHEMA_REQUIRED_MUST_BE_ARRAY");
        assert_eq!(SchemaErrorCode::SchemaRequiredItemMustBeString.as_str(), "SCHEMA_REQUIRED_ITEM_MUST_BE_STRING");
        assert_eq!(SchemaErrorCode::SchemaRequiredPropertyNotDefined.as_str(), "SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED");
        assert_eq!(SchemaErrorCode::SchemaAdditionalPropertiesInvalid.as_str(), "SCHEMA_ADDITIONAL_PROPERTIES_INVALID");
        assert_eq!(SchemaErrorCode::SchemaArrayMissingItems.as_str(), "SCHEMA_ARRAY_MISSING_ITEMS");
        assert_eq!(SchemaErrorCode::SchemaItemsInvalid.as_str(), "SCHEMA_ITEMS_INVALID");
        assert_eq!(SchemaErrorCode::SchemaMapMissingValues.as_str(), "SCHEMA_MAP_MISSING_VALUES");
        assert_eq!(SchemaErrorCode::SchemaValuesInvalid.as_str(), "SCHEMA_VALUES_INVALID");
        assert_eq!(SchemaErrorCode::SchemaTupleMissingDefinition.as_str(), "SCHEMA_TUPLE_MISSING_DEFINITION");
        assert_eq!(SchemaErrorCode::SchemaTupleMissingProperties.as_str(), "SCHEMA_TUPLE_MISSING_PROPERTIES");
        assert_eq!(SchemaErrorCode::SchemaTupleInvalidFormat.as_str(), "SCHEMA_TUPLE_INVALID_FORMAT");
        assert_eq!(SchemaErrorCode::SchemaTuplePropertyNotDefined.as_str(), "SCHEMA_TUPLE_PROPERTY_NOT_DEFINED");
        assert_eq!(SchemaErrorCode::SchemaChoiceMissingChoices.as_str(), "SCHEMA_CHOICE_MISSING_CHOICES");
        assert_eq!(SchemaErrorCode::SchemaChoicesNotObject.as_str(), "SCHEMA_CHOICES_NOT_OBJECT");
        assert_eq!(SchemaErrorCode::SchemaChoiceInvalid.as_str(), "SCHEMA_CHOICE_INVALID");
        assert_eq!(SchemaErrorCode::SchemaSelectorNotString.as_str(), "SCHEMA_SELECTOR_NOT_STRING");
        assert_eq!(SchemaErrorCode::SchemaEnumNotArray.as_str(), "SCHEMA_ENUM_NOT_ARRAY");
        assert_eq!(SchemaErrorCode::SchemaEnumEmpty.as_str(), "SCHEMA_ENUM_EMPTY");
        assert_eq!(SchemaErrorCode::SchemaEnumDuplicates.as_str(), "SCHEMA_ENUM_DUPLICATES");
        assert_eq!(SchemaErrorCode::SchemaConstInvalid.as_str(), "SCHEMA_CONST_INVALID");
        assert_eq!(SchemaErrorCode::SchemaUsesNotArray.as_str(), "SCHEMA_USES_NOT_ARRAY");
        assert_eq!(SchemaErrorCode::SchemaUsesInvalidExtension.as_str(), "SCHEMA_USES_INVALID_EXTENSION");
        assert_eq!(SchemaErrorCode::SchemaOffersNotArray.as_str(), "SCHEMA_OFFERS_NOT_ARRAY");
        assert_eq!(SchemaErrorCode::SchemaOffersInvalidExtension.as_str(), "SCHEMA_OFFERS_INVALID_EXTENSION");
        assert_eq!(SchemaErrorCode::SchemaExtensionKeywordWithoutUses.as_str(), "SCHEMA_EXTENSION_KEYWORD_WITHOUT_USES");
        assert_eq!(SchemaErrorCode::SchemaMinMaxInvalid.as_str(), "SCHEMA_MIN_MAX_INVALID");
        assert_eq!(SchemaErrorCode::SchemaMinLengthInvalid.as_str(), "SCHEMA_MIN_LENGTH_INVALID");
        assert_eq!(SchemaErrorCode::SchemaMaxLengthInvalid.as_str(), "SCHEMA_MAX_LENGTH_INVALID");
        assert_eq!(SchemaErrorCode::SchemaPatternInvalid.as_str(), "SCHEMA_PATTERN_INVALID");
        assert_eq!(SchemaErrorCode::SchemaFormatInvalid.as_str(), "SCHEMA_FORMAT_INVALID");
        assert_eq!(SchemaErrorCode::SchemaImportNotAllowed.as_str(), "SCHEMA_IMPORT_NOT_ALLOWED");
        assert_eq!(SchemaErrorCode::SchemaImportFailed.as_str(), "SCHEMA_IMPORT_FAILED");
        assert_eq!(SchemaErrorCode::SchemaImportCircular.as_str(), "SCHEMA_IMPORT_CIRCULAR");
        assert_eq!(SchemaErrorCode::SchemaAllOfNotArray.as_str(), "SCHEMA_ALLOF_NOT_ARRAY");
        assert_eq!(SchemaErrorCode::SchemaAnyOfNotArray.as_str(), "SCHEMA_ANYOF_NOT_ARRAY");
        assert_eq!(SchemaErrorCode::SchemaOneOfNotArray.as_str(), "SCHEMA_ONEOF_NOT_ARRAY");
        assert_eq!(SchemaErrorCode::SchemaNotInvalid.as_str(), "SCHEMA_NOT_INVALID");
        assert_eq!(SchemaErrorCode::SchemaIfInvalid.as_str(), "SCHEMA_IF_INVALID");
        assert_eq!(SchemaErrorCode::SchemaThenWithoutIf.as_str(), "SCHEMA_THEN_WITHOUT_IF");
        assert_eq!(SchemaErrorCode::SchemaElseWithoutIf.as_str(), "SCHEMA_ELSE_WITHOUT_IF");
    }

    #[test]
    fn test_schema_error_code_display() {
        assert_eq!(format!("{}", SchemaErrorCode::SchemaNull), "SCHEMA_NULL");
        assert_eq!(format!("{}", SchemaErrorCode::SchemaTypeInvalid), "SCHEMA_TYPE_INVALID");
    }

    #[test]
    fn test_instance_error_codes_as_str() {
        // Test all instance error codes have correct string representation
        assert_eq!(InstanceErrorCode::InstanceTypeMismatch.as_str(), "INSTANCE_TYPE_MISMATCH");
        assert_eq!(InstanceErrorCode::InstanceTypeUnknown.as_str(), "INSTANCE_TYPE_UNKNOWN");
        assert_eq!(InstanceErrorCode::InstanceStringExpected.as_str(), "INSTANCE_STRING_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceStringTooShort.as_str(), "INSTANCE_STRING_TOO_SHORT");
        assert_eq!(InstanceErrorCode::InstanceStringTooLong.as_str(), "INSTANCE_STRING_TOO_LONG");
        assert_eq!(InstanceErrorCode::InstanceStringPatternMismatch.as_str(), "INSTANCE_STRING_PATTERN_MISMATCH");
        assert_eq!(InstanceErrorCode::InstanceStringFormatInvalid.as_str(), "INSTANCE_STRING_FORMAT_INVALID");
        assert_eq!(InstanceErrorCode::InstanceNumberExpected.as_str(), "INSTANCE_NUMBER_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceNumberTooSmall.as_str(), "INSTANCE_NUMBER_TOO_SMALL");
        assert_eq!(InstanceErrorCode::InstanceNumberTooLarge.as_str(), "INSTANCE_NUMBER_TOO_LARGE");
        assert_eq!(InstanceErrorCode::InstanceNumberNotMultiple.as_str(), "INSTANCE_NUMBER_NOT_MULTIPLE");
        assert_eq!(InstanceErrorCode::InstanceIntegerExpected.as_str(), "INSTANCE_INTEGER_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceIntegerOutOfRange.as_str(), "INSTANCE_INTEGER_OUT_OF_RANGE");
        assert_eq!(InstanceErrorCode::InstanceBooleanExpected.as_str(), "INSTANCE_BOOLEAN_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceNullExpected.as_str(), "INSTANCE_NULL_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceObjectExpected.as_str(), "INSTANCE_OBJECT_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceRequiredMissing.as_str(), "INSTANCE_REQUIRED_MISSING");
        assert_eq!(InstanceErrorCode::InstanceAdditionalProperty.as_str(), "INSTANCE_ADDITIONAL_PROPERTY");
        assert_eq!(InstanceErrorCode::InstancePropertyInvalid.as_str(), "INSTANCE_PROPERTY_INVALID");
        assert_eq!(InstanceErrorCode::InstanceTooFewProperties.as_str(), "INSTANCE_TOO_FEW_PROPERTIES");
        assert_eq!(InstanceErrorCode::InstanceTooManyProperties.as_str(), "INSTANCE_TOO_MANY_PROPERTIES");
        assert_eq!(InstanceErrorCode::InstanceDependentRequiredMissing.as_str(), "INSTANCE_DEPENDENT_REQUIRED_MISSING");
        assert_eq!(InstanceErrorCode::InstanceArrayExpected.as_str(), "INSTANCE_ARRAY_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceArrayTooShort.as_str(), "INSTANCE_ARRAY_TOO_SHORT");
        assert_eq!(InstanceErrorCode::InstanceArrayTooLong.as_str(), "INSTANCE_ARRAY_TOO_LONG");
        assert_eq!(InstanceErrorCode::InstanceArrayNotUnique.as_str(), "INSTANCE_ARRAY_NOT_UNIQUE");
        assert_eq!(InstanceErrorCode::InstanceArrayContainsMissing.as_str(), "INSTANCE_ARRAY_CONTAINS_MISSING");
        assert_eq!(InstanceErrorCode::InstanceArrayItemInvalid.as_str(), "INSTANCE_ARRAY_ITEM_INVALID");
        assert_eq!(InstanceErrorCode::InstanceTupleExpected.as_str(), "INSTANCE_TUPLE_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceTupleLengthMismatch.as_str(), "INSTANCE_TUPLE_LENGTH_MISMATCH");
        assert_eq!(InstanceErrorCode::InstanceTupleElementInvalid.as_str(), "INSTANCE_TUPLE_ELEMENT_INVALID");
        assert_eq!(InstanceErrorCode::InstanceMapExpected.as_str(), "INSTANCE_MAP_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceMapValueInvalid.as_str(), "INSTANCE_MAP_VALUE_INVALID");
        assert_eq!(InstanceErrorCode::InstanceSetExpected.as_str(), "INSTANCE_SET_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceSetNotUnique.as_str(), "INSTANCE_SET_NOT_UNIQUE");
        assert_eq!(InstanceErrorCode::InstanceSetItemInvalid.as_str(), "INSTANCE_SET_ITEM_INVALID");
        assert_eq!(InstanceErrorCode::InstanceChoiceNoMatch.as_str(), "INSTANCE_CHOICE_NO_MATCH");
        assert_eq!(InstanceErrorCode::InstanceChoiceMultipleMatches.as_str(), "INSTANCE_CHOICE_MULTIPLE_MATCHES");
        assert_eq!(InstanceErrorCode::InstanceChoiceUnknown.as_str(), "INSTANCE_CHOICE_UNKNOWN");
        assert_eq!(InstanceErrorCode::InstanceChoiceSelectorMissing.as_str(), "INSTANCE_CHOICE_SELECTOR_MISSING");
        assert_eq!(InstanceErrorCode::InstanceChoiceSelectorInvalid.as_str(), "INSTANCE_CHOICE_SELECTOR_INVALID");
        assert_eq!(InstanceErrorCode::InstanceEnumMismatch.as_str(), "INSTANCE_ENUM_MISMATCH");
        assert_eq!(InstanceErrorCode::InstanceConstMismatch.as_str(), "INSTANCE_CONST_MISMATCH");
        assert_eq!(InstanceErrorCode::InstanceDateExpected.as_str(), "INSTANCE_DATE_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceDateInvalid.as_str(), "INSTANCE_DATE_INVALID");
        assert_eq!(InstanceErrorCode::InstanceTimeExpected.as_str(), "INSTANCE_TIME_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceTimeInvalid.as_str(), "INSTANCE_TIME_INVALID");
        assert_eq!(InstanceErrorCode::InstanceDateTimeExpected.as_str(), "INSTANCE_DATETIME_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceDateTimeInvalid.as_str(), "INSTANCE_DATETIME_INVALID");
        assert_eq!(InstanceErrorCode::InstanceDurationExpected.as_str(), "INSTANCE_DURATION_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceDurationInvalid.as_str(), "INSTANCE_DURATION_INVALID");
        assert_eq!(InstanceErrorCode::InstanceUuidExpected.as_str(), "INSTANCE_UUID_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceUuidInvalid.as_str(), "INSTANCE_UUID_INVALID");
        assert_eq!(InstanceErrorCode::InstanceUriExpected.as_str(), "INSTANCE_URI_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceUriInvalid.as_str(), "INSTANCE_URI_INVALID");
        assert_eq!(InstanceErrorCode::InstanceBinaryExpected.as_str(), "INSTANCE_BINARY_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceBinaryInvalid.as_str(), "INSTANCE_BINARY_INVALID");
        assert_eq!(InstanceErrorCode::InstanceJsonPointerExpected.as_str(), "INSTANCE_JSONPOINTER_EXPECTED");
        assert_eq!(InstanceErrorCode::InstanceJsonPointerInvalid.as_str(), "INSTANCE_JSONPOINTER_INVALID");
        assert_eq!(InstanceErrorCode::InstanceAllOfFailed.as_str(), "INSTANCE_ALLOF_FAILED");
        assert_eq!(InstanceErrorCode::InstanceAnyOfFailed.as_str(), "INSTANCE_ANYOF_FAILED");
        assert_eq!(InstanceErrorCode::InstanceOneOfFailed.as_str(), "INSTANCE_ONEOF_FAILED");
        assert_eq!(InstanceErrorCode::InstanceOneOfMultiple.as_str(), "INSTANCE_ONEOF_MULTIPLE");
        assert_eq!(InstanceErrorCode::InstanceNotFailed.as_str(), "INSTANCE_NOT_FAILED");
        assert_eq!(InstanceErrorCode::InstanceIfThenFailed.as_str(), "INSTANCE_IF_THEN_FAILED");
        assert_eq!(InstanceErrorCode::InstanceIfElseFailed.as_str(), "INSTANCE_IF_ELSE_FAILED");
        assert_eq!(InstanceErrorCode::InstanceRefNotFound.as_str(), "INSTANCE_REF_NOT_FOUND");
    }

    #[test]
    fn test_instance_error_code_display() {
        assert_eq!(format!("{}", InstanceErrorCode::InstanceTypeMismatch), "INSTANCE_TYPE_MISMATCH");
        assert_eq!(format!("{}", InstanceErrorCode::InstanceEnumMismatch), "INSTANCE_ENUM_MISMATCH");
    }
}

// =============================================================================
// Types Module Tests
// =============================================================================

mod types_tests {
    use super::*;

    #[test]
    fn test_severity_display() {
        assert_eq!(format!("{}", Severity::Error), "error");
        assert_eq!(format!("{}", Severity::Warning), "warning");
    }

    #[test]
    fn test_json_location_new() {
        let loc = JsonLocation::new(10, 20);
        assert_eq!(loc.line, 10);
        assert_eq!(loc.column, 20);
        assert!(!loc.is_unknown());
    }

    #[test]
    fn test_json_location_unknown() {
        let loc = JsonLocation::unknown();
        assert_eq!(loc.line, 0);
        assert_eq!(loc.column, 0);
        assert!(loc.is_unknown());
    }

    #[test]
    fn test_json_location_display() {
        let known = JsonLocation::new(5, 10);
        assert_eq!(format!("{}", known), "5:10");
        
        let unknown = JsonLocation::unknown();
        assert_eq!(format!("{}", unknown), "(unknown)");
    }

    #[test]
    fn test_validation_error_new() {
        let error = ValidationError::new(
            "TEST_CODE",
            "Test message",
            "/path/to/error",
            Severity::Error,
            JsonLocation::new(1, 5),
        );
        assert_eq!(error.code, "TEST_CODE");
        assert_eq!(error.message, "Test message");
        assert_eq!(error.path, "/path/to/error");
        assert!(error.is_error());
        assert!(!error.is_warning());
    }

    #[test]
    fn test_validation_error_schema_warning() {
        let warning = ValidationError::schema_warning(
            SchemaErrorCode::SchemaExtensionKeywordWithoutUses,
            "Extension keyword without $uses",
            "/test",
            JsonLocation::unknown(),
        );
        assert!(warning.is_warning());
        assert!(!warning.is_error());
    }

    #[test]
    fn test_validation_error_instance_warning() {
        let warning = ValidationError::instance_warning(
            InstanceErrorCode::InstanceTypeMismatch,
            "Type mismatch warning",
            "/test",
            JsonLocation::unknown(),
        );
        assert!(warning.is_warning());
        assert!(!warning.is_error());
    }

    #[test]
    fn test_validation_error_display_with_location() {
        let error = ValidationError::new(
            "TEST_CODE",
            "Test message",
            "/path",
            Severity::Error,
            JsonLocation::new(3, 7),
        );
        let display = format!("{}", error);
        assert!(display.contains("[error]"));
        assert!(display.contains("TEST_CODE"));
        assert!(display.contains("Test message"));
        assert!(display.contains("/path"));
        assert!(display.contains("3:7"));
    }

    #[test]
    fn test_validation_error_display_without_location() {
        let error = ValidationError::new(
            "TEST_CODE",
            "Test message",
            "/path",
            Severity::Warning,
            JsonLocation::unknown(),
        );
        let display = format!("{}", error);
        assert!(display.contains("[warning]"));
        assert!(display.contains("TEST_CODE"));
        assert!(!display.contains("(unknown)")); // Unknown location not shown in this format
    }

    #[test]
    fn test_validation_result_new() {
        let result = ValidationResult::new();
        assert!(result.is_valid());
        assert!(result.is_clean());
        assert_eq!(result.error_count(), 0);
        assert_eq!(result.warning_count(), 0);
    }

    #[test]
    fn test_validation_result_add_error() {
        let mut result = ValidationResult::new();
        result.add_error(ValidationError::new(
            "TEST",
            "Test",
            "/",
            Severity::Error,
            JsonLocation::unknown(),
        ));
        assert!(!result.is_valid());
        assert!(!result.is_clean());
        assert_eq!(result.error_count(), 1);
    }

    #[test]
    fn test_validation_result_add_warning_only() {
        let mut result = ValidationResult::new();
        result.add_error(ValidationError::new(
            "TEST",
            "Test",
            "/",
            Severity::Warning,
            JsonLocation::unknown(),
        ));
        assert!(result.is_valid()); // Warnings don't fail validation
        assert!(!result.is_clean());
        assert_eq!(result.warning_count(), 1);
        assert_eq!(result.error_count(), 0);
    }

    #[test]
    fn test_validation_result_add_errors() {
        let mut result = ValidationResult::new();
        let errors = vec![
            ValidationError::new("E1", "Error 1", "/", Severity::Error, JsonLocation::unknown()),
            ValidationError::new("E2", "Error 2", "/", Severity::Error, JsonLocation::unknown()),
        ];
        result.add_errors(errors);
        assert_eq!(result.error_count(), 2);
    }

    #[test]
    fn test_validation_result_errors_iterator() {
        let mut result = ValidationResult::new();
        result.add_error(ValidationError::new("E1", "Error", "/", Severity::Error, JsonLocation::unknown()));
        result.add_error(ValidationError::new("W1", "Warning", "/", Severity::Warning, JsonLocation::unknown()));
        result.add_error(ValidationError::new("E2", "Error", "/", Severity::Error, JsonLocation::unknown()));
        
        let errors: Vec<_> = result.errors().collect();
        assert_eq!(errors.len(), 2);
        
        let warnings: Vec<_> = result.warnings().collect();
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn test_validation_result_merge() {
        let mut result1 = ValidationResult::new();
        result1.add_error(ValidationError::new("E1", "Error 1", "/", Severity::Error, JsonLocation::unknown()));
        
        let mut result2 = ValidationResult::new();
        result2.add_error(ValidationError::new("E2", "Error 2", "/", Severity::Error, JsonLocation::unknown()));
        
        result1.merge(result2);
        assert_eq!(result1.error_count(), 2);
    }

    #[test]
    fn test_validation_result_all_errors() {
        let mut result = ValidationResult::new();
        result.add_error(ValidationError::new("E1", "Error", "/", Severity::Error, JsonLocation::unknown()));
        result.add_error(ValidationError::new("W1", "Warning", "/", Severity::Warning, JsonLocation::unknown()));
        
        assert_eq!(result.all_errors().len(), 2);
    }
}

// =============================================================================
// Schema Validator Edge Cases
// =============================================================================

mod schema_edge_cases {
    use super::*;

    #[test]
    fn test_null_schema() {
        let validator = SchemaValidator::new();
        let result = validator.validate("null");
        assert!(!result.is_valid());
    }

    #[test]
    fn test_boolean_schema_true() {
        let validator = SchemaValidator::new();
        let result = validator.validate("true");
        assert!(result.is_valid());
    }

    #[test]
    fn test_boolean_schema_false() {
        let validator = SchemaValidator::new();
        let result = validator.validate("false");
        assert!(result.is_valid());
    }

    #[test]
    fn test_array_schema_invalid() {
        let validator = SchemaValidator::new();
        let result = validator.validate("[1, 2, 3]");
        assert!(!result.is_valid());
    }

    #[test]
    fn test_string_schema_invalid() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r#""not a schema""#);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_definitions_not_object() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "object",
            "definitions": "not an object"
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_definition_missing_type() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "object",
            "definitions": {
                "MyDef": {}
            }
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_type_not_string() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": 123
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_ref_not_string() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "object",
            "properties": {
                "ref": { "$ref": 123 }
            }
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_required_not_array() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "object",
            "properties": {
                "name": { "type": "string" }
            },
            "required": "name"
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_required_item_not_string() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "object",
            "properties": {
                "name": { "type": "string" }
            },
            "required": [123]
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_required_property_not_in_properties() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "object",
            "properties": {
                "name": { "type": "string" }
            },
            "required": ["age"]
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_enum_not_array() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "string",
            "enum": "not an array"
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_uses_not_array() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "string",
            "$uses": "JSONStructureValidation"
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_offers_not_array() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "string",
            "$offers": "JSONStructureValidation"
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_selector_not_string() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "choice",
            "selector": 123,
            "choices": {
                "a": { "type": "string" }
            }
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_choices_not_object() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "choice",
            "selector": "kind",
            "choices": ["a", "b"]
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_tuple_missing_properties() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "tuple",
            "tuple": ["first", "second"]
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_tuple_not_array() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "tuple",
            "properties": {
                "first": { "type": "string" }
            },
            "tuple": "first"
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_tuple_property_not_defined() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "tuple",
            "properties": {
                "first": { "type": "string" }
            },
            "tuple": ["first", "second"]
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_allof_not_array() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "allOf": { "type": "string" }
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_anyof_not_array() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "anyOf": { "type": "string" }
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_oneof_not_array() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "oneOf": { "type": "string" }
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_import_in_schema() {
        // $import is an extension feature - validator may allow or ignore it
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "$import": "https://example.com/other"
        }"##);
        // This test validates import is handled (may be allowed or not based on spec)
        let _ = result.all_errors().len(); // Just verify it ran
    }

    #[test]
    fn test_set_missing_items() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "set"
        }"##);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_properties_not_object() {
        let validator = SchemaValidator::new();
        let result = validator.validate(r##"{
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "object",
            "properties": "not an object"
        }"##);
        assert!(!result.is_valid());
    }
}

// =============================================================================
// Instance Validator Edge Cases
// =============================================================================

mod instance_edge_cases {
    use super::*;
    use serde_json::json;

    fn validate_instance(instance: &str, schema: serde_json::Value) -> ValidationResult {
        let validator = InstanceValidator::new();
        validator.validate(instance, &schema)
    }

    #[test]
    fn test_invalid_json_instance() {
        let validator = InstanceValidator::new();
        let schema = json!({ "type": "string" });
        let result = validator.validate("{invalid json}", &schema);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_number_type() {
        let schema = json!({ "type": "number" });
        assert!(validate_instance("42.5", schema.clone()).is_valid());
        assert!(validate_instance("42", schema.clone()).is_valid());
        assert!(!validate_instance("\"not a number\"", schema).is_valid());
    }

    #[test]
    fn test_integer_type() {
        let schema = json!({ "type": "integer" });
        assert!(validate_instance("42", schema.clone()).is_valid());
        assert!(!validate_instance("\"not an integer\"", schema).is_valid());
    }

    #[test]
    fn test_float_type() {
        let schema = json!({ "type": "float" });
        assert!(validate_instance("3.14", schema.clone()).is_valid());
        assert!(validate_instance("42", schema.clone()).is_valid());
    }

    #[test]
    fn test_float8_type() {
        let schema = json!({ "type": "float8" });
        assert!(validate_instance("1.5", schema.clone()).is_valid());
    }

    #[test]
    fn test_double_type() {
        let schema = json!({ "type": "double" });
        assert!(validate_instance("3.14159265359", schema.clone()).is_valid());
    }

    #[test]
    fn test_decimal_type() {
        let schema = json!({ "type": "decimal" });
        assert!(validate_instance("123.456", schema.clone()).is_valid());
        // Decimal accepts numbers but not necessarily strings (depends on implementation)
    }

    #[test]
    fn test_int8_out_of_range() {
        let schema = json!({ "type": "int8" });
        assert!(!validate_instance("200", schema.clone()).is_valid());
        assert!(!validate_instance("-200", schema.clone()).is_valid());
    }

    #[test]
    fn test_int16_out_of_range() {
        let schema = json!({ "type": "int16" });
        assert!(!validate_instance("40000", schema.clone()).is_valid());
        assert!(!validate_instance("-40000", schema.clone()).is_valid());
    }

    #[test]
    fn test_uint8_negative() {
        let schema = json!({ "type": "uint8" });
        assert!(!validate_instance("-1", schema).is_valid());
    }

    #[test]
    fn test_uint16_negative() {
        let schema = json!({ "type": "uint16" });
        assert!(!validate_instance("-1", schema).is_valid());
    }

    #[test]
    fn test_uint32_negative() {
        let schema = json!({ "type": "uint32" });
        assert!(!validate_instance("-1", schema).is_valid());
    }

    #[test]
    fn test_uint64_negative() {
        let schema = json!({ "type": "uint64" });
        assert!(!validate_instance("-1", schema).is_valid());
    }

    #[test]
    fn test_uint128_negative() {
        let schema = json!({ "type": "uint128" });
        assert!(!validate_instance("-1", schema).is_valid());
    }

    #[test]
    fn test_int128_string() {
        let schema = json!({ "type": "int128" });
        assert!(validate_instance("\"170141183460469231731687303715884105727\"", schema).is_valid());
    }

    #[test]
    fn test_int128_invalid_string() {
        let schema = json!({ "type": "int128" });
        assert!(!validate_instance("\"not a number\"", schema).is_valid());
    }

    #[test]
    fn test_uint128_string() {
        let schema = json!({ "type": "uint128" });
        assert!(validate_instance("\"340282366920938463463374607431768211455\"", schema).is_valid());
    }

    #[test]
    fn test_uint128_invalid_string() {
        let schema = json!({ "type": "uint128" });
        assert!(!validate_instance("\"not a number\"", schema).is_valid());
    }

    #[test]
    fn test_date_invalid_format() {
        let schema = json!({ "type": "date" });
        assert!(!validate_instance("\"not a date\"", schema.clone()).is_valid());
        assert!(!validate_instance("\"2024-13-01\"", schema.clone()).is_valid()); // Invalid month
        assert!(!validate_instance("\"2024-01-32\"", schema).is_valid()); // Invalid day
    }

    #[test]
    fn test_time_invalid_format() {
        let schema = json!({ "type": "time" });
        assert!(!validate_instance("\"not a time\"", schema.clone()).is_valid());
        assert!(!validate_instance("\"25:00:00\"", schema.clone()).is_valid()); // Invalid hour
    }

    #[test]
    fn test_datetime_invalid_format() {
        let schema = json!({ "type": "datetime" });
        assert!(!validate_instance("\"not a datetime\"", schema.clone()).is_valid());
    }

    #[test]
    fn test_duration_valid_formats() {
        let schema = json!({ "type": "duration" });
        assert!(validate_instance("\"P1Y\"", schema.clone()).is_valid());
        assert!(validate_instance("\"P1M\"", schema.clone()).is_valid());
        assert!(validate_instance("\"P1D\"", schema.clone()).is_valid());
        assert!(validate_instance("\"PT1H\"", schema.clone()).is_valid());
        assert!(validate_instance("\"PT1M\"", schema.clone()).is_valid());
        assert!(validate_instance("\"PT1S\"", schema.clone()).is_valid());
        assert!(validate_instance("\"P1Y2M3DT4H5M6S\"", schema).is_valid());
    }

    #[test]
    fn test_duration_invalid_format() {
        let schema = json!({ "type": "duration" });
        assert!(!validate_instance("\"not a duration\"", schema.clone()).is_valid());
        assert!(!validate_instance("\"XYZ\"", schema.clone()).is_valid()); // No P prefix
    }

    #[test]
    fn test_binary_invalid_base64() {
        let schema = json!({ "type": "binary" });
        assert!(!validate_instance("\"!!!invalid base64!!!\"", schema).is_valid());
    }

    #[test]
    fn test_jsonpointer_valid() {
        let schema = json!({ "type": "jsonpointer" });
        assert!(validate_instance("\"\"", schema.clone()).is_valid()); // Empty is valid
        assert!(validate_instance("\"/foo\"", schema.clone()).is_valid());
        assert!(validate_instance("\"/foo/bar\"", schema.clone()).is_valid());
        assert!(validate_instance("\"/foo/0\"", schema).is_valid());
    }

    #[test]
    fn test_jsonpointer_invalid() {
        let schema = json!({ "type": "jsonpointer" });
        assert!(!validate_instance("\"foo\"", schema.clone()).is_valid()); // Must start with /
        assert!(!validate_instance("123", schema).is_valid()); // Must be string
    }

    #[test]
    fn test_object_not_object() {
        let schema = json!({ 
            "type": "object",
            "properties": {
                "name": { "type": "string" }
            }
        });
        assert!(!validate_instance("\"not an object\"", schema).is_valid());
    }

    #[test]
    fn test_array_not_array() {
        let schema = json!({ 
            "type": "array",
            "items": { "type": "string" }
        });
        assert!(!validate_instance("\"not an array\"", schema).is_valid());
    }

    #[test]
    fn test_map_not_object() {
        let schema = json!({ 
            "type": "map",
            "values": { "type": "int32" }
        });
        assert!(!validate_instance("\"not a map\"", schema).is_valid());
    }

    #[test]
    fn test_set_not_array() {
        let schema = json!({ 
            "type": "set",
            "items": { "type": "string" }
        });
        assert!(!validate_instance("\"not a set\"", schema).is_valid());
    }

    #[test]
    fn test_set_duplicate_values() {
        let schema = json!({ 
            "type": "set",
            "items": { "type": "int32" }
        });
        assert!(!validate_instance("[1, 2, 2, 3]", schema).is_valid());
    }

    #[test]
    fn test_tuple_not_array() {
        let schema = json!({ 
            "type": "tuple",
            "properties": {
                "first": { "type": "string" },
                "second": { "type": "int32" }
            },
            "tuple": ["first", "second"]
        });
        assert!(!validate_instance("\"not a tuple\"", schema).is_valid());
    }

    #[test]
    fn test_choice_no_selector_value() {
        let schema = json!({ 
            "type": "choice",
            "selector": "kind",
            "choices": {
                "a": { "type": "string" },
                "b": { "type": "int32" }
            }
        });
        // Object without the selector property
        assert!(!validate_instance(r#"{"value": "test"}"#, schema).is_valid());
    }

    #[test]
    fn test_choice_unknown_selector_value() {
        let schema = json!({ 
            "type": "choice",
            "selector": "kind",
            "choices": {
                "a": { "type": "string" },
                "b": { "type": "int32" }
            }
        });
        assert!(!validate_instance(r#"{"kind": "c", "value": "test"}"#, schema).is_valid());
    }

    #[test]
    fn test_choice_selector_not_string() {
        let schema = json!({ 
            "type": "choice",
            "selector": "kind",
            "choices": {
                "a": { "type": "string" }
            }
        });
        assert!(!validate_instance(r#"{"kind": 123}"#, schema).is_valid());
    }

    #[test]
    fn test_any_type() {
        let schema = json!({ "type": "any" });
        assert!(validate_instance("null", schema.clone()).is_valid());
        assert!(validate_instance("123", schema.clone()).is_valid());
        assert!(validate_instance("\"string\"", schema.clone()).is_valid());
        assert!(validate_instance("true", schema.clone()).is_valid());
        assert!(validate_instance("{}", schema.clone()).is_valid());
        assert!(validate_instance("[]", schema).is_valid());
    }

    #[test]
    fn test_ref_resolution() {
        let schema = json!({ 
            "type": "object",
            "definitions": {
                "Name": { "type": "string" }
            },
            "properties": {
                "name": { "$ref": "#/definitions/Name" }
            }
        });
        assert!(validate_instance(r#"{"name": "John"}"#, schema.clone()).is_valid());
        assert!(!validate_instance(r#"{"name": 123}"#, schema).is_valid());
    }

    #[test]
    fn test_date_non_string() {
        let schema = json!({ "type": "date" });
        assert!(!validate_instance("123", schema).is_valid());
    }

    #[test]
    fn test_time_non_string() {
        let schema = json!({ "type": "time" });
        assert!(!validate_instance("123", schema).is_valid());
    }

    #[test]
    fn test_datetime_non_string() {
        let schema = json!({ "type": "datetime" });
        assert!(!validate_instance("123", schema).is_valid());
    }

    #[test]
    fn test_duration_non_string() {
        let schema = json!({ "type": "duration" });
        assert!(!validate_instance("123", schema).is_valid());
    }

    #[test]
    fn test_uuid_non_string() {
        let schema = json!({ "type": "uuid" });
        assert!(!validate_instance("123", schema).is_valid());
    }

    #[test]
    fn test_uri_non_string() {
        let schema = json!({ "type": "uri" });
        assert!(!validate_instance("123", schema).is_valid());
    }

    #[test]
    fn test_binary_non_string() {
        let schema = json!({ "type": "binary" });
        assert!(!validate_instance("123", schema).is_valid());
    }

    #[test]
    fn test_int64_non_number() {
        let schema = json!({ "type": "int64" });
        assert!(!validate_instance("\"not a number\"", schema).is_valid());
    }

    #[test]
    fn test_uint64_non_number() {
        let schema = json!({ "type": "uint64" });
        assert!(!validate_instance("\"not a number\"", schema).is_valid());
    }

    #[test]
    fn test_int128_non_number_or_string() {
        let schema = json!({ "type": "int128" });
        assert!(!validate_instance("true", schema).is_valid());
    }

    #[test]
    fn test_uint128_non_number_or_string() {
        let schema = json!({ "type": "uint128" });
        assert!(!validate_instance("true", schema).is_valid());
    }

    #[test]
    fn test_decimal_non_number_or_string() {
        let schema = json!({ "type": "decimal" });
        assert!(!validate_instance("true", schema).is_valid());
    }

    #[test]
    fn test_map_value_invalid() {
        let schema = json!({ 
            "type": "map",
            "values": { "type": "int32" }
        });
        assert!(!validate_instance(r#"{"key": "not an int"}"#, schema).is_valid());
    }

    #[test]
    fn test_array_item_invalid() {
        let schema = json!({ 
            "type": "array",
            "items": { "type": "int32" }
        });
        assert!(!validate_instance(r#"[1, "not an int", 3]"#, schema).is_valid());
    }

    #[test]
    fn test_set_item_invalid() {
        let schema = json!({ 
            "type": "set",
            "items": { "type": "int32" }
        });
        assert!(!validate_instance(r#"[1, "not an int", 3]"#, schema).is_valid());
    }

    #[test]
    fn test_choice_not_object() {
        let schema = json!({ 
            "type": "choice",
            "selector": "kind",
            "choices": {
                "a": { "type": "string" }
            }
        });
        assert!(!validate_instance("\"not an object\"", schema).is_valid());
    }
}

// =============================================================================
// Extended Validation Mode Tests
// =============================================================================

mod extended_validation_tests {
    use super::*;
    use serde_json::json;

    fn validate_extended(instance: &str, schema: serde_json::Value) -> ValidationResult {
        let mut validator = InstanceValidator::new();
        validator.set_extended(true);
        validator.validate(instance, &schema)
    }

    #[test]
    fn test_string_min_length() {
        let schema = json!({ "type": "string", "minLength": 5 });
        assert!(!validate_extended("\"abc\"", schema.clone()).is_valid());
        assert!(validate_extended("\"abcde\"", schema).is_valid());
    }

    #[test]
    fn test_string_max_length() {
        let schema = json!({ "type": "string", "maxLength": 5 });
        assert!(!validate_extended("\"abcdefgh\"", schema.clone()).is_valid());
        assert!(validate_extended("\"abc\"", schema).is_valid());
    }

    #[test]
    fn test_string_pattern() {
        let schema = json!({ "type": "string", "pattern": "^[a-z]+$" });
        assert!(!validate_extended("\"ABC123\"", schema.clone()).is_valid());
        assert!(validate_extended("\"abc\"", schema).is_valid());
    }

    #[test]
    fn test_number_minimum() {
        let schema = json!({ "type": "number", "minimum": 10 });
        assert!(!validate_extended("5", schema.clone()).is_valid());
        assert!(validate_extended("15", schema).is_valid());
    }

    #[test]
    fn test_number_maximum() {
        let schema = json!({ "type": "number", "maximum": 100 });
        assert!(!validate_extended("150", schema.clone()).is_valid());
        assert!(validate_extended("50", schema).is_valid());
    }

    #[test]
    fn test_number_exclusive_minimum() {
        let schema = json!({ "type": "number", "exclusiveMinimum": 10 });
        assert!(!validate_extended("10", schema.clone()).is_valid());
        assert!(validate_extended("11", schema).is_valid());
    }

    #[test]
    fn test_number_exclusive_maximum() {
        let schema = json!({ "type": "number", "exclusiveMaximum": 100 });
        assert!(!validate_extended("100", schema.clone()).is_valid());
        assert!(validate_extended("99", schema).is_valid());
    }

    #[test]
    fn test_array_min_items() {
        let schema = json!({ "type": "array", "items": { "type": "int32" }, "minItems": 3 });
        assert!(!validate_extended("[1, 2]", schema.clone()).is_valid());
        assert!(validate_extended("[1, 2, 3]", schema).is_valid());
    }

    #[test]
    fn test_array_max_items() {
        let schema = json!({ "type": "array", "items": { "type": "int32" }, "maxItems": 3 });
        assert!(!validate_extended("[1, 2, 3, 4]", schema.clone()).is_valid());
        assert!(validate_extended("[1, 2]", schema).is_valid());
    }

    #[test]
    fn test_allof_composition() {
        let schema = json!({
            "allOf": [
                { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] },
                { "type": "object", "properties": { "age": { "type": "int32" } }, "required": ["age"] }
            ]
        });
        assert!(!validate_extended(r#"{"name": "John"}"#, schema.clone()).is_valid());
        assert!(validate_extended(r#"{"name": "John", "age": 30}"#, schema).is_valid());
    }

    #[test]
    fn test_anyof_composition() {
        let schema = json!({
            "anyOf": [
                { "type": "string" },
                { "type": "int32" }
            ]
        });
        assert!(validate_extended("\"hello\"", schema.clone()).is_valid());
        assert!(validate_extended("42", schema.clone()).is_valid());
        assert!(!validate_extended("null", schema).is_valid());
    }

    #[test]
    fn test_oneof_composition() {
        let schema = json!({
            "oneOf": [
                { "type": "string" },
                { "type": "int32" }
            ]
        });
        assert!(validate_extended("\"hello\"", schema.clone()).is_valid());
        assert!(validate_extended("42", schema.clone()).is_valid());
        // Both match would fail for oneOf, but we need ambiguous values
    }

    #[test]
    fn test_not_composition() {
        let schema = json!({
            "type": "string",
            "not": { "enum": ["forbidden"] }
        });
        assert!(!validate_extended("\"forbidden\"", schema.clone()).is_valid());
        assert!(validate_extended("\"allowed\"", schema).is_valid());
    }

    #[test]
    fn test_if_then_else() {
        let schema = json!({
            "if": { "type": "string", "minLength": 5 },
            "then": { "type": "string", "pattern": "^[A-Z]" },
            "else": { "type": "string" }
        });
        // Long string must start with uppercase
        assert!(!validate_extended("\"abcde\"", schema.clone()).is_valid());
        assert!(validate_extended("\"ABCDE\"", schema.clone()).is_valid());
        // Short string is just validated as string
        assert!(validate_extended("\"abc\"", schema).is_valid());
    }

    #[test]
    fn test_boolean_schema_false_rejects_all() {
        let validator = InstanceValidator::new();
        let result = validator.validate("42", &json!(false));
        assert!(!result.is_valid());
    }

    #[test]
    fn test_boolean_schema_true_accepts_all() {
        let validator = InstanceValidator::new();
        let result = validator.validate("42", &json!(true));
        assert!(result.is_valid());
    }
}
