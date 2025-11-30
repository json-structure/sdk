// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace JsonStructure.Validation;

/// <summary>
/// Standardized error codes for JSON Structure validation.
/// These codes are consistent across all SDK implementations.
/// </summary>
public static class ErrorCodes
{
    #region Schema Validation Errors (SCHEMA_*)

    /// <summary>Schema cannot be null.</summary>
    public const string SchemaNull = "SCHEMA_NULL";
    
    /// <summary>Schema must be a boolean or object.</summary>
    public const string SchemaInvalidType = "SCHEMA_INVALID_TYPE";
    
    /// <summary>Maximum validation depth exceeded.</summary>
    public const string SchemaMaxDepthExceeded = "SCHEMA_MAX_DEPTH_EXCEEDED";
    
    /// <summary>Keyword has invalid type.</summary>
    public const string SchemaKeywordInvalidType = "SCHEMA_KEYWORD_INVALID_TYPE";
    
    /// <summary>Keyword cannot be empty.</summary>
    public const string SchemaKeywordEmpty = "SCHEMA_KEYWORD_EMPTY";
    
    /// <summary>Invalid type name.</summary>
    public const string SchemaTypeInvalid = "SCHEMA_TYPE_INVALID";
    
    /// <summary>Type array cannot be empty.</summary>
    public const string SchemaTypeArrayEmpty = "SCHEMA_TYPE_ARRAY_EMPTY";
    
    /// <summary>Type object must contain $ref.</summary>
    public const string SchemaTypeObjectMissingRef = "SCHEMA_TYPE_OBJECT_MISSING_REF";
    
    /// <summary>$ref target does not exist.</summary>
    public const string SchemaRefNotFound = "SCHEMA_REF_NOT_FOUND";
    
    /// <summary>Circular reference detected.</summary>
    public const string SchemaRefCircular = "SCHEMA_REF_CIRCULAR";
    
    /// <summary>Schema must have a 'type' keyword.</summary>
    public const string SchemaMissingType = "SCHEMA_MISSING_TYPE";
    
    /// <summary>Root schema must have 'type', '$root', or other schema-defining keyword.</summary>
    public const string SchemaRootMissingType = "SCHEMA_ROOT_MISSING_TYPE";
    
    /// <summary>Name is not a valid identifier.</summary>
    public const string SchemaNameInvalid = "SCHEMA_NAME_INVALID";
    
    /// <summary>Constraint is not valid for this type.</summary>
    public const string SchemaConstraintInvalidForType = "SCHEMA_CONSTRAINT_INVALID_FOR_TYPE";
    
    /// <summary>Minimum cannot be greater than maximum.</summary>
    public const string SchemaMinGreaterThanMax = "SCHEMA_MIN_GREATER_THAN_MAX";
    
    /// <summary>Properties must be an object.</summary>
    public const string SchemaPropertiesNotObject = "SCHEMA_PROPERTIES_NOT_OBJECT";
    
    /// <summary>Required must be an array.</summary>
    public const string SchemaRequiredNotArray = "SCHEMA_REQUIRED_NOT_ARRAY";
    
    /// <summary>Required array items must be strings.</summary>
    public const string SchemaRequiredItemNotString = "SCHEMA_REQUIRED_ITEM_NOT_STRING";
    
    /// <summary>Required property is not defined in properties.</summary>
    public const string SchemaRequiredPropertyNotDefined = "SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED";
    
    /// <summary>additionalProperties must be a boolean or schema.</summary>
    public const string SchemaAdditionalPropertiesInvalid = "SCHEMA_ADDITIONAL_PROPERTIES_INVALID";
    
    /// <summary>Array type requires 'items' or 'contains' schema.</summary>
    public const string SchemaArrayMissingItems = "SCHEMA_ARRAY_MISSING_ITEMS";
    
    /// <summary>Tuple type requires 'prefixItems' or 'tuple'.</summary>
    public const string SchemaTupleMissingPrefixItems = "SCHEMA_TUPLE_MISSING_PREFIX_ITEMS";
    
    /// <summary>prefixItems must be an array.</summary>
    public const string SchemaPrefixItemsNotArray = "SCHEMA_PREFIX_ITEMS_NOT_ARRAY";
    
    /// <summary>Map type requires 'values' schema.</summary>
    public const string SchemaMapMissingValues = "SCHEMA_MAP_MISSING_VALUES";
    
    /// <summary>Choice type requires 'options', 'choices', or 'oneOf'.</summary>
    public const string SchemaChoiceMissingOptions = "SCHEMA_CHOICE_MISSING_OPTIONS";
    
    /// <summary>Options must be an object.</summary>
    public const string SchemaOptionsNotObject = "SCHEMA_OPTIONS_NOT_OBJECT";
    
    /// <summary>Choices must be an object.</summary>
    public const string SchemaChoicesNotObject = "SCHEMA_CHOICES_NOT_OBJECT";
    
    /// <summary>Pattern is not a valid regular expression.</summary>
    public const string SchemaPatternInvalid = "SCHEMA_PATTERN_INVALID";
    
    /// <summary>Pattern must be a string.</summary>
    public const string SchemaPatternNotString = "SCHEMA_PATTERN_NOT_STRING";
    
    /// <summary>Enum must be an array.</summary>
    public const string SchemaEnumNotArray = "SCHEMA_ENUM_NOT_ARRAY";
    
    /// <summary>Enum array cannot be empty.</summary>
    public const string SchemaEnumEmpty = "SCHEMA_ENUM_EMPTY";
    
    /// <summary>Enum array contains duplicate values.</summary>
    public const string SchemaEnumDuplicates = "SCHEMA_ENUM_DUPLICATES";
    
    /// <summary>Composition keyword array cannot be empty.</summary>
    public const string SchemaCompositionEmpty = "SCHEMA_COMPOSITION_EMPTY";
    
    /// <summary>Composition keyword must be an array.</summary>
    public const string SchemaCompositionNotArray = "SCHEMA_COMPOSITION_NOT_ARRAY";
    
    /// <summary>altnames must be an object.</summary>
    public const string SchemaAltnamesNotObject = "SCHEMA_ALTNAMES_NOT_OBJECT";
    
    /// <summary>altnames values must be strings.</summary>
    public const string SchemaAltnamesValueNotString = "SCHEMA_ALTNAMES_VALUE_NOT_STRING";
    
    /// <summary>Keyword must be a non-negative integer.</summary>
    public const string SchemaIntegerConstraintInvalid = "SCHEMA_INTEGER_CONSTRAINT_INVALID";
    
    /// <summary>Keyword must be a number.</summary>
    public const string SchemaNumberConstraintInvalid = "SCHEMA_NUMBER_CONSTRAINT_INVALID";
    
    /// <summary>Keyword must be a positive number.</summary>
    public const string SchemaPositiveNumberConstraintInvalid = "SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID";
    
    /// <summary>uniqueItems must be a boolean.</summary>
    public const string SchemaUniqueItemsNotBoolean = "SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN";
    
    /// <summary>items must be a boolean or schema for tuple type.</summary>
    public const string SchemaItemsInvalidForTuple = "SCHEMA_ITEMS_INVALID_FOR_TUPLE";
    
    /// <summary>Validation extension keyword is used but validation extensions are not enabled.</summary>
    public const string SchemaExtensionKeywordNotEnabled = "SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED";

    #endregion

    #region Instance Validation Errors (INSTANCE_*)

    /// <summary>Unable to resolve $root reference.</summary>
    public const string InstanceRootUnresolved = "INSTANCE_ROOT_UNRESOLVED";
    
    /// <summary>Maximum validation depth exceeded.</summary>
    public const string InstanceMaxDepthExceeded = "INSTANCE_MAX_DEPTH_EXCEEDED";
    
    /// <summary>Schema 'false' rejects all values.</summary>
    public const string InstanceSchemaFalse = "INSTANCE_SCHEMA_FALSE";
    
    /// <summary>Unable to resolve reference.</summary>
    public const string InstanceRefUnresolved = "INSTANCE_REF_UNRESOLVED";
    
    /// <summary>Value must equal const value.</summary>
    public const string InstanceConstMismatch = "INSTANCE_CONST_MISMATCH";
    
    /// <summary>Value must be one of the enum values.</summary>
    public const string InstanceEnumMismatch = "INSTANCE_ENUM_MISMATCH";
    
    /// <summary>Value must match at least one schema in anyOf.</summary>
    public const string InstanceAnyOfNoneMatched = "INSTANCE_ANY_OF_NONE_MATCHED";
    
    /// <summary>Value must match exactly one schema in oneOf.</summary>
    public const string InstanceOneOfInvalidCount = "INSTANCE_ONE_OF_INVALID_COUNT";
    
    /// <summary>Value must not match the schema in 'not'.</summary>
    public const string InstanceNotMatched = "INSTANCE_NOT_MATCHED";
    
    /// <summary>Unknown type.</summary>
    public const string InstanceTypeUnknown = "INSTANCE_TYPE_UNKNOWN";
    
    /// <summary>Type mismatch.</summary>
    public const string InstanceTypeMismatch = "INSTANCE_TYPE_MISMATCH";
    
    /// <summary>Value must be null.</summary>
    public const string InstanceNullExpected = "INSTANCE_NULL_EXPECTED";
    
    /// <summary>Value must be a boolean.</summary>
    public const string InstanceBooleanExpected = "INSTANCE_BOOLEAN_EXPECTED";
    
    /// <summary>Value must be a string.</summary>
    public const string InstanceStringExpected = "INSTANCE_STRING_EXPECTED";
    
    /// <summary>String length is less than minimum.</summary>
    public const string InstanceStringMinLength = "INSTANCE_STRING_MIN_LENGTH";
    
    /// <summary>String length exceeds maximum.</summary>
    public const string InstanceStringMaxLength = "INSTANCE_STRING_MAX_LENGTH";
    
    /// <summary>String does not match pattern.</summary>
    public const string InstanceStringPatternMismatch = "INSTANCE_STRING_PATTERN_MISMATCH";
    
    /// <summary>Invalid regex pattern.</summary>
    public const string InstancePatternInvalid = "INSTANCE_PATTERN_INVALID";
    
    /// <summary>String is not a valid email address.</summary>
    public const string InstanceFormatEmailInvalid = "INSTANCE_FORMAT_EMAIL_INVALID";
    
    /// <summary>String is not a valid URI.</summary>
    public const string InstanceFormatUriInvalid = "INSTANCE_FORMAT_URI_INVALID";
    
    /// <summary>String is not a valid URI reference.</summary>
    public const string InstanceFormatUriReferenceInvalid = "INSTANCE_FORMAT_URI_REFERENCE_INVALID";
    
    /// <summary>String is not a valid date.</summary>
    public const string InstanceFormatDateInvalid = "INSTANCE_FORMAT_DATE_INVALID";
    
    /// <summary>String is not a valid time.</summary>
    public const string InstanceFormatTimeInvalid = "INSTANCE_FORMAT_TIME_INVALID";
    
    /// <summary>String is not a valid date-time.</summary>
    public const string InstanceFormatDatetimeInvalid = "INSTANCE_FORMAT_DATETIME_INVALID";
    
    /// <summary>String is not a valid UUID.</summary>
    public const string InstanceFormatUuidInvalid = "INSTANCE_FORMAT_UUID_INVALID";
    
    /// <summary>String is not a valid IPv4 address.</summary>
    public const string InstanceFormatIpv4Invalid = "INSTANCE_FORMAT_IPV4_INVALID";
    
    /// <summary>String is not a valid IPv6 address.</summary>
    public const string InstanceFormatIpv6Invalid = "INSTANCE_FORMAT_IPV6_INVALID";
    
    /// <summary>String is not a valid hostname.</summary>
    public const string InstanceFormatHostnameInvalid = "INSTANCE_FORMAT_HOSTNAME_INVALID";
    
    /// <summary>Value must be a number.</summary>
    public const string InstanceNumberExpected = "INSTANCE_NUMBER_EXPECTED";
    
    /// <summary>Value must be an integer.</summary>
    public const string InstanceIntegerExpected = "INSTANCE_INTEGER_EXPECTED";
    
    /// <summary>Integer value is out of range.</summary>
    public const string InstanceIntRangeInvalid = "INSTANCE_INT_RANGE_INVALID";
    
    /// <summary>Value is less than minimum.</summary>
    public const string InstanceNumberMinimum = "INSTANCE_NUMBER_MINIMUM";
    
    /// <summary>Value exceeds maximum.</summary>
    public const string InstanceNumberMaximum = "INSTANCE_NUMBER_MAXIMUM";
    
    /// <summary>Value must be greater than exclusive minimum.</summary>
    public const string InstanceNumberExclusiveMinimum = "INSTANCE_NUMBER_EXCLUSIVE_MINIMUM";
    
    /// <summary>Value must be less than exclusive maximum.</summary>
    public const string InstanceNumberExclusiveMaximum = "INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM";
    
    /// <summary>Value is not a multiple of the specified value.</summary>
    public const string InstanceNumberMultipleOf = "INSTANCE_NUMBER_MULTIPLE_OF";
    
    /// <summary>Value must be an object.</summary>
    public const string InstanceObjectExpected = "INSTANCE_OBJECT_EXPECTED";
    
    /// <summary>Missing required property.</summary>
    public const string InstanceRequiredPropertyMissing = "INSTANCE_REQUIRED_PROPERTY_MISSING";
    
    /// <summary>Additional property not allowed.</summary>
    public const string InstanceAdditionalPropertyNotAllowed = "INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED";
    
    /// <summary>Object has fewer properties than minimum.</summary>
    public const string InstanceMinProperties = "INSTANCE_MIN_PROPERTIES";
    
    /// <summary>Object has more properties than maximum.</summary>
    public const string InstanceMaxProperties = "INSTANCE_MAX_PROPERTIES";
    
    /// <summary>Dependent required property is missing.</summary>
    public const string InstanceDependentRequired = "INSTANCE_DEPENDENT_REQUIRED";
    
    /// <summary>Value must be an array.</summary>
    public const string InstanceArrayExpected = "INSTANCE_ARRAY_EXPECTED";
    
    /// <summary>Array has fewer items than minimum.</summary>
    public const string InstanceMinItems = "INSTANCE_MIN_ITEMS";
    
    /// <summary>Array has more items than maximum.</summary>
    public const string InstanceMaxItems = "INSTANCE_MAX_ITEMS";
    
    /// <summary>Array has fewer matching items than minContains.</summary>
    public const string InstanceMinContains = "INSTANCE_MIN_CONTAINS";
    
    /// <summary>Array has more matching items than maxContains.</summary>
    public const string InstanceMaxContains = "INSTANCE_MAX_CONTAINS";
    
    /// <summary>Value must be an array (set).</summary>
    public const string InstanceSetExpected = "INSTANCE_SET_EXPECTED";
    
    /// <summary>Set contains duplicate value.</summary>
    public const string InstanceSetDuplicate = "INSTANCE_SET_DUPLICATE";
    
    /// <summary>Value must be an object (map).</summary>
    public const string InstanceMapExpected = "INSTANCE_MAP_EXPECTED";
    
    /// <summary>Map has fewer entries than minimum.</summary>
    public const string InstanceMapMinEntries = "INSTANCE_MAP_MIN_ENTRIES";
    
    /// <summary>Map has more entries than maximum.</summary>
    public const string InstanceMapMaxEntries = "INSTANCE_MAP_MAX_ENTRIES";
    
    /// <summary>Value must be an array (tuple).</summary>
    public const string InstanceTupleExpected = "INSTANCE_TUPLE_EXPECTED";
    
    /// <summary>Tuple length does not match schema.</summary>
    public const string InstanceTupleLengthMismatch = "INSTANCE_TUPLE_LENGTH_MISMATCH";
    
    /// <summary>Tuple has additional items not defined in schema.</summary>
    public const string InstanceTupleAdditionalItems = "INSTANCE_TUPLE_ADDITIONAL_ITEMS";
    
    /// <summary>Value must be an object (choice).</summary>
    public const string InstanceChoiceExpected = "INSTANCE_CHOICE_EXPECTED";
    
    /// <summary>Choice schema is missing options.</summary>
    public const string InstanceChoiceMissingOptions = "INSTANCE_CHOICE_MISSING_OPTIONS";
    
    /// <summary>Choice discriminator property is missing.</summary>
    public const string InstanceChoiceDiscriminatorMissing = "INSTANCE_CHOICE_DISCRIMINATOR_MISSING";
    
    /// <summary>Discriminator value must be a string.</summary>
    public const string InstanceChoiceDiscriminatorNotString = "INSTANCE_CHOICE_DISCRIMINATOR_NOT_STRING";
    
    /// <summary>Unknown choice option.</summary>
    public const string InstanceChoiceOptionUnknown = "INSTANCE_CHOICE_OPTION_UNKNOWN";
    
    /// <summary>Value does not match any choice option.</summary>
    public const string InstanceChoiceNoMatch = "INSTANCE_CHOICE_NO_MATCH";
    
    /// <summary>Value matches multiple choice options.</summary>
    public const string InstanceChoiceMultipleMatches = "INSTANCE_CHOICE_MULTIPLE_MATCHES";
    
    /// <summary>Date must be a string.</summary>
    public const string InstanceDateExpected = "INSTANCE_DATE_EXPECTED";
    
    /// <summary>Invalid date format.</summary>
    public const string InstanceDateFormatInvalid = "INSTANCE_DATE_FORMAT_INVALID";
    
    /// <summary>Time must be a string.</summary>
    public const string InstanceTimeExpected = "INSTANCE_TIME_EXPECTED";
    
    /// <summary>Invalid time format.</summary>
    public const string InstanceTimeFormatInvalid = "INSTANCE_TIME_FORMAT_INVALID";
    
    /// <summary>DateTime must be a string.</summary>
    public const string InstanceDatetimeExpected = "INSTANCE_DATETIME_EXPECTED";
    
    /// <summary>Invalid datetime format.</summary>
    public const string InstanceDatetimeFormatInvalid = "INSTANCE_DATETIME_FORMAT_INVALID";
    
    /// <summary>Duration must be a string.</summary>
    public const string InstanceDurationExpected = "INSTANCE_DURATION_EXPECTED";
    
    /// <summary>Invalid duration format.</summary>
    public const string InstanceDurationFormatInvalid = "INSTANCE_DURATION_FORMAT_INVALID";
    
    /// <summary>UUID must be a string.</summary>
    public const string InstanceUuidExpected = "INSTANCE_UUID_EXPECTED";
    
    /// <summary>Invalid UUID format.</summary>
    public const string InstanceUuidFormatInvalid = "INSTANCE_UUID_FORMAT_INVALID";
    
    /// <summary>URI must be a string.</summary>
    public const string InstanceUriExpected = "INSTANCE_URI_EXPECTED";
    
    /// <summary>Invalid URI format.</summary>
    public const string InstanceUriFormatInvalid = "INSTANCE_URI_FORMAT_INVALID";
    
    /// <summary>URI must have a scheme.</summary>
    public const string InstanceUriMissingScheme = "INSTANCE_URI_MISSING_SCHEME";
    
    /// <summary>Binary must be a base64 string.</summary>
    public const string InstanceBinaryExpected = "INSTANCE_BINARY_EXPECTED";
    
    /// <summary>Invalid base64 encoding.</summary>
    public const string InstanceBinaryEncodingInvalid = "INSTANCE_BINARY_ENCODING_INVALID";
    
    /// <summary>JSON Pointer must be a string.</summary>
    public const string InstanceJsonpointerExpected = "INSTANCE_JSONPOINTER_EXPECTED";
    
    /// <summary>Invalid JSON Pointer format.</summary>
    public const string InstanceJsonpointerFormatInvalid = "INSTANCE_JSONPOINTER_FORMAT_INVALID";
    
    /// <summary>Value must be a valid decimal.</summary>
    public const string InstanceDecimalExpected = "INSTANCE_DECIMAL_EXPECTED";
    
    /// <summary>String value not expected for this type.</summary>
    public const string InstanceStringNotExpected = "INSTANCE_STRING_NOT_EXPECTED";
    
    /// <summary>Custom type reference not yet supported.</summary>
    public const string InstanceCustomTypeNotSupported = "INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED";

    #endregion
}

/// <summary>
/// Helper methods for creating validation errors with consistent messages.
/// </summary>
public static class ValidationErrors
{
    /// <summary>
    /// Creates a validation error with the specified code and message.
    /// </summary>
    public static ValidationError Create(
        string code, 
        string message, 
        string path = "",
        ValidationSeverity severity = ValidationSeverity.Error,
        JsonLocation location = default,
        string? schemaPath = null)
    {
        return new ValidationError(code, message, path, severity, location, schemaPath);
    }

    /// <summary>
    /// Creates a schema validation error.
    /// </summary>
    public static ValidationError Schema(string code, string message, string path = "", JsonLocation location = default)
    {
        return new ValidationError(code, message, path, ValidationSeverity.Error, location, null);
    }

    /// <summary>
    /// Creates an instance validation error.
    /// </summary>
    public static ValidationError Instance(string code, string message, string path = "", JsonLocation location = default, string? schemaPath = null)
    {
        return new ValidationError(code, message, path, ValidationSeverity.Error, location, schemaPath);
    }

    /// <summary>
    /// Creates a validation warning.
    /// </summary>
    public static ValidationError Warning(string code, string message, string path = "", JsonLocation location = default, string? schemaPath = null)
    {
        return new ValidationError(code, message, path, ValidationSeverity.Warning, location, schemaPath);
    }
}
