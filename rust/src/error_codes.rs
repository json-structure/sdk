//! Error codes for JSON Structure validation.
//!
//! These error codes match the standardized codes in `assets/error-messages.json`.

use std::fmt;

/// Error codes for schema validation errors.
///
/// This enum is marked `#[non_exhaustive]` to allow adding new error codes
/// in future versions without breaking semver compatibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum SchemaErrorCode {
    // General schema errors
    SchemaNull,
    SchemaInvalidType,
    SchemaRootMissingId,
    SchemaRootMissingName,
    SchemaRootMissingSchema,
    SchemaRootMissingType,
    
    // Type errors
    SchemaTypeInvalid,
    SchemaTypeNotString,
    
    // Reference errors
    SchemaRefNotFound,
    SchemaRefNotString,
    SchemaRefCircular,
    SchemaRefInvalid,
    
    // Definition errors
    SchemaDefinitionsMustBeObject,
    SchemaDefinitionMissingType,
    SchemaDefinitionInvalid,
    
    // Object property errors
    SchemaPropertiesMustBeObject,
    SchemaPropertyInvalid,
    SchemaRequiredMustBeArray,
    SchemaRequiredItemMustBeString,
    SchemaRequiredPropertyNotDefined,
    SchemaAdditionalPropertiesInvalid,
    
    // Array/Set errors
    SchemaArrayMissingItems,
    SchemaItemsInvalid,
    
    // Map errors
    SchemaMapMissingValues,
    SchemaValuesInvalid,
    
    // Tuple errors
    SchemaTupleMissingDefinition,
    SchemaTupleMissingProperties,
    SchemaTupleInvalidFormat,
    SchemaTuplePropertyNotDefined,
    
    // Choice errors
    SchemaChoiceMissingChoices,
    SchemaChoicesNotObject,
    SchemaChoiceInvalid,
    SchemaSelectorNotString,
    
    // Enum/Const errors
    SchemaEnumNotArray,
    SchemaEnumEmpty,
    SchemaEnumDuplicates,
    SchemaConstInvalid,
    
    // Extension errors
    SchemaUsesNotArray,
    SchemaUsesInvalidExtension,
    SchemaOffersNotArray,
    SchemaOffersInvalidExtension,
    SchemaExtensionKeywordWithoutUses,
    
    // Constraint errors
    SchemaMinMaxInvalid,
    SchemaMinLengthInvalid,
    SchemaMaxLengthInvalid,
    SchemaPatternInvalid,
    SchemaFormatInvalid,
    SchemaConstraintTypeMismatch,
    SchemaMinimumExceedsMaximum,
    SchemaMinLengthExceedsMaxLength,
    SchemaMinLengthNegative,
    SchemaMaxLengthNegative,
    SchemaMinItemsExceedsMaxItems,
    SchemaMinItemsNegative,
    SchemaMultipleOfInvalid,
    SchemaKeywordInvalidType,
    SchemaTypeArrayEmpty,
    SchemaTypeObjectMissingRef,
    
    // Import errors
    SchemaImportNotAllowed,
    SchemaImportFailed,
    SchemaImportCircular,
    
    // Extends errors
    SchemaExtendsNotString,
    SchemaExtendsEmpty,
    SchemaExtendsNotFound,
    SchemaExtendsCircular,
    
    // Altnames errors
    SchemaAltnamesNotObject,
    SchemaAltnamesValueNotString,
    
    // Composition errors
    SchemaAllOfNotArray,
    SchemaAnyOfNotArray,
    SchemaOneOfNotArray,
    SchemaNotInvalid,
    SchemaIfInvalid,
    SchemaThenWithoutIf,
    SchemaElseWithoutIf,
}

impl SchemaErrorCode {
    /// Returns the string code for this error.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SchemaNull => "SCHEMA_NULL",
            Self::SchemaInvalidType => "SCHEMA_INVALID_TYPE",
            Self::SchemaRootMissingId => "SCHEMA_ROOT_MISSING_ID",
            Self::SchemaRootMissingName => "SCHEMA_ROOT_MISSING_NAME",
            Self::SchemaRootMissingSchema => "SCHEMA_ROOT_MISSING_SCHEMA",
            Self::SchemaRootMissingType => "SCHEMA_ROOT_MISSING_TYPE",
            Self::SchemaTypeInvalid => "SCHEMA_TYPE_INVALID",
            Self::SchemaTypeNotString => "SCHEMA_TYPE_NOT_STRING",
            Self::SchemaRefNotFound => "SCHEMA_REF_NOT_FOUND",
            Self::SchemaRefNotString => "SCHEMA_REF_NOT_STRING",
            Self::SchemaRefCircular => "SCHEMA_REF_CIRCULAR",
            Self::SchemaRefInvalid => "SCHEMA_REF_INVALID",
            Self::SchemaDefinitionsMustBeObject => "SCHEMA_DEFINITIONS_MUST_BE_OBJECT",
            Self::SchemaDefinitionMissingType => "SCHEMA_DEFINITION_MISSING_TYPE",
            Self::SchemaDefinitionInvalid => "SCHEMA_DEFINITION_INVALID",
            Self::SchemaPropertiesMustBeObject => "SCHEMA_PROPERTIES_MUST_BE_OBJECT",
            Self::SchemaPropertyInvalid => "SCHEMA_PROPERTY_INVALID",
            Self::SchemaRequiredMustBeArray => "SCHEMA_REQUIRED_MUST_BE_ARRAY",
            Self::SchemaRequiredItemMustBeString => "SCHEMA_REQUIRED_ITEM_MUST_BE_STRING",
            Self::SchemaRequiredPropertyNotDefined => "SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED",
            Self::SchemaAdditionalPropertiesInvalid => "SCHEMA_ADDITIONAL_PROPERTIES_INVALID",
            Self::SchemaArrayMissingItems => "SCHEMA_ARRAY_MISSING_ITEMS",
            Self::SchemaItemsInvalid => "SCHEMA_ITEMS_INVALID",
            Self::SchemaMapMissingValues => "SCHEMA_MAP_MISSING_VALUES",
            Self::SchemaValuesInvalid => "SCHEMA_VALUES_INVALID",
            Self::SchemaTupleMissingDefinition => "SCHEMA_TUPLE_MISSING_DEFINITION",
            Self::SchemaTupleMissingProperties => "SCHEMA_TUPLE_MISSING_PROPERTIES",
            Self::SchemaTupleInvalidFormat => "SCHEMA_TUPLE_INVALID_FORMAT",
            Self::SchemaTuplePropertyNotDefined => "SCHEMA_TUPLE_PROPERTY_NOT_DEFINED",
            Self::SchemaChoiceMissingChoices => "SCHEMA_CHOICE_MISSING_CHOICES",
            Self::SchemaChoicesNotObject => "SCHEMA_CHOICES_NOT_OBJECT",
            Self::SchemaChoiceInvalid => "SCHEMA_CHOICE_INVALID",
            Self::SchemaSelectorNotString => "SCHEMA_SELECTOR_NOT_STRING",
            Self::SchemaEnumNotArray => "SCHEMA_ENUM_NOT_ARRAY",
            Self::SchemaEnumEmpty => "SCHEMA_ENUM_EMPTY",
            Self::SchemaEnumDuplicates => "SCHEMA_ENUM_DUPLICATES",
            Self::SchemaConstInvalid => "SCHEMA_CONST_INVALID",
            Self::SchemaUsesNotArray => "SCHEMA_USES_NOT_ARRAY",
            Self::SchemaUsesInvalidExtension => "SCHEMA_USES_INVALID_EXTENSION",
            Self::SchemaOffersNotArray => "SCHEMA_OFFERS_NOT_ARRAY",
            Self::SchemaOffersInvalidExtension => "SCHEMA_OFFERS_INVALID_EXTENSION",
            Self::SchemaExtensionKeywordWithoutUses => "SCHEMA_EXTENSION_KEYWORD_WITHOUT_USES",
            Self::SchemaMinMaxInvalid => "SCHEMA_MIN_MAX_INVALID",
            Self::SchemaMinLengthInvalid => "SCHEMA_MIN_LENGTH_INVALID",
            Self::SchemaMaxLengthInvalid => "SCHEMA_MAX_LENGTH_INVALID",
            Self::SchemaPatternInvalid => "SCHEMA_PATTERN_INVALID",
            Self::SchemaFormatInvalid => "SCHEMA_FORMAT_INVALID",
            Self::SchemaConstraintTypeMismatch => "SCHEMA_CONSTRAINT_TYPE_MISMATCH",
            Self::SchemaMinimumExceedsMaximum => "SCHEMA_MINIMUM_EXCEEDS_MAXIMUM",
            Self::SchemaMinLengthExceedsMaxLength => "SCHEMA_MINLENGTH_EXCEEDS_MAXLENGTH",
            Self::SchemaMinLengthNegative => "SCHEMA_MINLENGTH_NEGATIVE",
            Self::SchemaMaxLengthNegative => "SCHEMA_MAXLENGTH_NEGATIVE",
            Self::SchemaMinItemsExceedsMaxItems => "SCHEMA_MINITEMS_EXCEEDS_MAXITEMS",
            Self::SchemaMinItemsNegative => "SCHEMA_MINITEMS_NEGATIVE",
            Self::SchemaMultipleOfInvalid => "SCHEMA_MULTIPLEOF_INVALID",
            Self::SchemaKeywordInvalidType => "SCHEMA_KEYWORD_INVALID_TYPE",
            Self::SchemaTypeArrayEmpty => "SCHEMA_TYPE_ARRAY_EMPTY",
            Self::SchemaTypeObjectMissingRef => "SCHEMA_TYPE_OBJECT_MISSING_REF",
            Self::SchemaImportNotAllowed => "SCHEMA_IMPORT_NOT_ALLOWED",
            Self::SchemaImportFailed => "SCHEMA_IMPORT_FAILED",
            Self::SchemaImportCircular => "SCHEMA_IMPORT_CIRCULAR",
            Self::SchemaExtendsNotString => "SCHEMA_EXTENDS_NOT_STRING",
            Self::SchemaExtendsEmpty => "SCHEMA_EXTENDS_EMPTY",
            Self::SchemaExtendsNotFound => "SCHEMA_EXTENDS_NOT_FOUND",
            Self::SchemaExtendsCircular => "SCHEMA_EXTENDS_CIRCULAR",
            Self::SchemaAltnamesNotObject => "SCHEMA_ALTNAMES_NOT_OBJECT",
            Self::SchemaAltnamesValueNotString => "SCHEMA_ALTNAMES_VALUE_NOT_STRING",
            Self::SchemaAllOfNotArray => "SCHEMA_ALLOF_NOT_ARRAY",
            Self::SchemaAnyOfNotArray => "SCHEMA_ANYOF_NOT_ARRAY",
            Self::SchemaOneOfNotArray => "SCHEMA_ONEOF_NOT_ARRAY",
            Self::SchemaNotInvalid => "SCHEMA_NOT_INVALID",
            Self::SchemaIfInvalid => "SCHEMA_IF_INVALID",
            Self::SchemaThenWithoutIf => "SCHEMA_THEN_WITHOUT_IF",
            Self::SchemaElseWithoutIf => "SCHEMA_ELSE_WITHOUT_IF",
        }
    }
}

impl fmt::Display for SchemaErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Error codes for instance validation errors.
///
/// This enum is marked `#[non_exhaustive]` to allow adding new error codes
/// in future versions without breaking semver compatibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum InstanceErrorCode {
    // Type mismatch errors
    InstanceTypeMismatch,
    InstanceTypeUnknown,
    
    // String errors
    InstanceStringExpected,
    InstanceStringTooShort,
    InstanceStringTooLong,
    InstanceStringPatternMismatch,
    InstanceStringFormatInvalid,
    
    // Number errors
    InstanceNumberExpected,
    InstanceNumberTooSmall,
    InstanceNumberTooLarge,
    InstanceNumberNotMultiple,
    InstanceIntegerExpected,
    InstanceIntegerOutOfRange,
    InstanceDecimalExpected,
    
    // Boolean/Null errors
    InstanceBooleanExpected,
    InstanceNullExpected,
    
    // Object errors
    InstanceObjectExpected,
    InstanceRequiredMissing,
    InstanceAdditionalProperty,
    InstancePropertyInvalid,
    InstanceTooFewProperties,
    InstanceTooManyProperties,
    InstanceDependentRequiredMissing,
    InstancePatternPropertyMismatch,
    InstancePropertyNameInvalid,
    
    // Array errors
    InstanceArrayExpected,
    InstanceArrayTooShort,
    InstanceArrayTooLong,
    InstanceArrayNotUnique,
    InstanceArrayContainsMissing,
    InstanceArrayContainsTooFew,
    InstanceArrayContainsTooMany,
    InstanceArrayItemInvalid,
    
    // Tuple errors
    InstanceTupleExpected,
    InstanceTupleLengthMismatch,
    InstanceTupleElementInvalid,
    
    // Map errors
    InstanceMapExpected,
    InstanceMapValueInvalid,
    InstanceMapTooFewEntries,
    InstanceMapTooManyEntries,
    InstanceMapKeyPatternMismatch,
    
    // Set errors
    InstanceSetExpected,
    InstanceSetNotUnique,
    InstanceSetItemInvalid,
    
    // Choice errors
    InstanceChoiceNoMatch,
    InstanceChoiceMultipleMatches,
    InstanceChoiceUnknown,
    InstanceChoiceSelectorMissing,
    InstanceChoiceSelectorInvalid,
    
    // Enum/Const errors
    InstanceEnumMismatch,
    InstanceConstMismatch,
    
    // Date/Time errors
    InstanceDateExpected,
    InstanceDateInvalid,
    InstanceTimeExpected,
    InstanceTimeInvalid,
    InstanceDateTimeExpected,
    InstanceDateTimeInvalid,
    InstanceDurationExpected,
    InstanceDurationInvalid,
    
    // UUID errors
    InstanceUuidExpected,
    InstanceUuidInvalid,
    
    // URI errors
    InstanceUriExpected,
    InstanceUriInvalid,
    
    // Binary errors
    InstanceBinaryExpected,
    InstanceBinaryInvalid,
    
    // JSON Pointer errors
    InstanceJsonPointerExpected,
    InstanceJsonPointerInvalid,
    
    // Composition errors
    InstanceAllOfFailed,
    InstanceAnyOfFailed,
    InstanceOneOfFailed,
    InstanceOneOfMultiple,
    InstanceNotFailed,
    InstanceIfThenFailed,
    InstanceIfElseFailed,
    
    // Reference errors
    InstanceRefNotFound,
    
    // Union errors
    InstanceUnionNoMatch,
}

impl InstanceErrorCode {
    /// Returns the string code for this error.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InstanceTypeMismatch => "INSTANCE_TYPE_MISMATCH",
            Self::InstanceTypeUnknown => "INSTANCE_TYPE_UNKNOWN",
            Self::InstanceStringExpected => "INSTANCE_STRING_EXPECTED",
            Self::InstanceStringTooShort => "INSTANCE_STRING_TOO_SHORT",
            Self::InstanceStringTooLong => "INSTANCE_STRING_TOO_LONG",
            Self::InstanceStringPatternMismatch => "INSTANCE_STRING_PATTERN_MISMATCH",
            Self::InstanceStringFormatInvalid => "INSTANCE_STRING_FORMAT_INVALID",
            Self::InstanceNumberExpected => "INSTANCE_NUMBER_EXPECTED",
            Self::InstanceNumberTooSmall => "INSTANCE_NUMBER_TOO_SMALL",
            Self::InstanceNumberTooLarge => "INSTANCE_NUMBER_TOO_LARGE",
            Self::InstanceNumberNotMultiple => "INSTANCE_NUMBER_NOT_MULTIPLE",
            Self::InstanceIntegerExpected => "INSTANCE_INTEGER_EXPECTED",
            Self::InstanceIntegerOutOfRange => "INSTANCE_INTEGER_OUT_OF_RANGE",
            Self::InstanceDecimalExpected => "INSTANCE_DECIMAL_EXPECTED",
            Self::InstanceBooleanExpected => "INSTANCE_BOOLEAN_EXPECTED",
            Self::InstanceNullExpected => "INSTANCE_NULL_EXPECTED",
            Self::InstanceObjectExpected => "INSTANCE_OBJECT_EXPECTED",
            Self::InstanceRequiredMissing => "INSTANCE_REQUIRED_MISSING",
            Self::InstanceAdditionalProperty => "INSTANCE_ADDITIONAL_PROPERTY",
            Self::InstancePropertyInvalid => "INSTANCE_PROPERTY_INVALID",
            Self::InstanceTooFewProperties => "INSTANCE_TOO_FEW_PROPERTIES",
            Self::InstanceTooManyProperties => "INSTANCE_TOO_MANY_PROPERTIES",
            Self::InstanceDependentRequiredMissing => "INSTANCE_DEPENDENT_REQUIRED_MISSING",
            Self::InstancePatternPropertyMismatch => "INSTANCE_PATTERN_PROPERTY_MISMATCH",
            Self::InstancePropertyNameInvalid => "INSTANCE_PROPERTY_NAME_INVALID",
            Self::InstanceArrayExpected => "INSTANCE_ARRAY_EXPECTED",
            Self::InstanceArrayTooShort => "INSTANCE_ARRAY_TOO_SHORT",
            Self::InstanceArrayTooLong => "INSTANCE_ARRAY_TOO_LONG",
            Self::InstanceArrayNotUnique => "INSTANCE_ARRAY_NOT_UNIQUE",
            Self::InstanceArrayContainsMissing => "INSTANCE_ARRAY_CONTAINS_MISSING",
            Self::InstanceArrayContainsTooFew => "INSTANCE_ARRAY_CONTAINS_TOO_FEW",
            Self::InstanceArrayContainsTooMany => "INSTANCE_ARRAY_CONTAINS_TOO_MANY",
            Self::InstanceArrayItemInvalid => "INSTANCE_ARRAY_ITEM_INVALID",
            Self::InstanceTupleExpected => "INSTANCE_TUPLE_EXPECTED",
            Self::InstanceTupleLengthMismatch => "INSTANCE_TUPLE_LENGTH_MISMATCH",
            Self::InstanceTupleElementInvalid => "INSTANCE_TUPLE_ELEMENT_INVALID",
            Self::InstanceMapExpected => "INSTANCE_MAP_EXPECTED",
            Self::InstanceMapValueInvalid => "INSTANCE_MAP_VALUE_INVALID",
            Self::InstanceMapTooFewEntries => "INSTANCE_MAP_TOO_FEW_ENTRIES",
            Self::InstanceMapTooManyEntries => "INSTANCE_MAP_TOO_MANY_ENTRIES",
            Self::InstanceMapKeyPatternMismatch => "INSTANCE_MAP_KEY_PATTERN_MISMATCH",
            Self::InstanceSetExpected => "INSTANCE_SET_EXPECTED",
            Self::InstanceSetNotUnique => "INSTANCE_SET_NOT_UNIQUE",
            Self::InstanceSetItemInvalid => "INSTANCE_SET_ITEM_INVALID",
            Self::InstanceChoiceNoMatch => "INSTANCE_CHOICE_NO_MATCH",
            Self::InstanceChoiceMultipleMatches => "INSTANCE_CHOICE_MULTIPLE_MATCHES",
            Self::InstanceChoiceUnknown => "INSTANCE_CHOICE_UNKNOWN",
            Self::InstanceChoiceSelectorMissing => "INSTANCE_CHOICE_SELECTOR_MISSING",
            Self::InstanceChoiceSelectorInvalid => "INSTANCE_CHOICE_SELECTOR_INVALID",
            Self::InstanceEnumMismatch => "INSTANCE_ENUM_MISMATCH",
            Self::InstanceConstMismatch => "INSTANCE_CONST_MISMATCH",
            Self::InstanceDateExpected => "INSTANCE_DATE_EXPECTED",
            Self::InstanceDateInvalid => "INSTANCE_DATE_INVALID",
            Self::InstanceTimeExpected => "INSTANCE_TIME_EXPECTED",
            Self::InstanceTimeInvalid => "INSTANCE_TIME_INVALID",
            Self::InstanceDateTimeExpected => "INSTANCE_DATETIME_EXPECTED",
            Self::InstanceDateTimeInvalid => "INSTANCE_DATETIME_INVALID",
            Self::InstanceDurationExpected => "INSTANCE_DURATION_EXPECTED",
            Self::InstanceDurationInvalid => "INSTANCE_DURATION_INVALID",
            Self::InstanceUuidExpected => "INSTANCE_UUID_EXPECTED",
            Self::InstanceUuidInvalid => "INSTANCE_UUID_INVALID",
            Self::InstanceUriExpected => "INSTANCE_URI_EXPECTED",
            Self::InstanceUriInvalid => "INSTANCE_URI_INVALID",
            Self::InstanceBinaryExpected => "INSTANCE_BINARY_EXPECTED",
            Self::InstanceBinaryInvalid => "INSTANCE_BINARY_INVALID",
            Self::InstanceJsonPointerExpected => "INSTANCE_JSONPOINTER_EXPECTED",
            Self::InstanceJsonPointerInvalid => "INSTANCE_JSONPOINTER_INVALID",
            Self::InstanceAllOfFailed => "INSTANCE_ALLOF_FAILED",
            Self::InstanceAnyOfFailed => "INSTANCE_ANYOF_FAILED",
            Self::InstanceOneOfFailed => "INSTANCE_ONEOF_FAILED",
            Self::InstanceOneOfMultiple => "INSTANCE_ONEOF_MULTIPLE",
            Self::InstanceNotFailed => "INSTANCE_NOT_FAILED",
            Self::InstanceIfThenFailed => "INSTANCE_IF_THEN_FAILED",
            Self::InstanceIfElseFailed => "INSTANCE_IF_ELSE_FAILED",
            Self::InstanceRefNotFound => "INSTANCE_REF_NOT_FOUND",
            Self::InstanceUnionNoMatch => "INSTANCE_UNION_NO_MATCH",
        }
    }
}

impl fmt::Display for InstanceErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}
