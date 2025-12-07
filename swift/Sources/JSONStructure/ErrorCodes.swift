// JSONStructure Swift SDK
// Standardized error codes matching assets/error-messages.json

import Foundation

// MARK: - Schema Validation Error Codes

/// Generic schema error.
public let schemaError = "SCHEMA_ERROR"
/// Schema cannot be null.
public let schemaNull = "SCHEMA_NULL"
/// Schema must be a boolean or object.
public let schemaInvalidType = "SCHEMA_INVALID_TYPE"
/// Maximum validation depth exceeded.
public let schemaMaxDepthExceeded = "SCHEMA_MAX_DEPTH_EXCEEDED"
/// Keyword has invalid type.
public let schemaKeywordInvalidType = "SCHEMA_KEYWORD_INVALID_TYPE"
/// Keyword cannot be empty.
public let schemaKeywordEmpty = "SCHEMA_KEYWORD_EMPTY"
/// Invalid type name.
public let schemaTypeInvalid = "SCHEMA_TYPE_INVALID"
/// Type array cannot be empty.
public let schemaTypeArrayEmpty = "SCHEMA_TYPE_ARRAY_EMPTY"
/// Type object must contain $ref.
public let schemaTypeObjectMissingRef = "SCHEMA_TYPE_OBJECT_MISSING_REF"
/// $ref target does not exist.
public let schemaRefNotFound = "SCHEMA_REF_NOT_FOUND"
/// Circular reference detected.
public let schemaRefCircular = "SCHEMA_REF_CIRCULAR"
/// Circular $extends reference detected.
public let schemaExtendsCircular = "SCHEMA_EXTENDS_CIRCULAR"
/// $extends reference not found.
public let schemaExtendsNotFound = "SCHEMA_EXTENDS_NOT_FOUND"
/// $ref is only permitted inside the 'type' attribute.
public let schemaRefNotInType = "SCHEMA_REF_NOT_IN_TYPE"
/// Schema must have a 'type' keyword.
public let schemaMissingType = "SCHEMA_MISSING_TYPE"
/// Root schema must have 'type', '$root', or other schema-defining keyword.
public let schemaRootMissingType = "SCHEMA_ROOT_MISSING_TYPE"
/// Root schema must have an '$id' keyword.
public let schemaRootMissingID = "SCHEMA_ROOT_MISSING_ID"
/// Root schema with 'type' must have a 'name' property.
public let schemaRootMissingName = "SCHEMA_ROOT_MISSING_NAME"
/// Validation extension keyword is used but validation extensions are not enabled.
public let schemaExtensionKeywordNotEnabled = "SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED"
/// Name is not a valid identifier.
public let schemaNameInvalid = "SCHEMA_NAME_INVALID"
/// Constraint is not valid for this type.
public let schemaConstraintInvalidForType = "SCHEMA_CONSTRAINT_INVALID_FOR_TYPE"
/// Minimum cannot be greater than maximum.
public let schemaMinGreaterThanMax = "SCHEMA_MIN_GREATER_THAN_MAX"
/// Properties must be an object.
public let schemaPropertiesNotObject = "SCHEMA_PROPERTIES_NOT_OBJECT"
/// Required must be an array.
public let schemaRequiredNotArray = "SCHEMA_REQUIRED_NOT_ARRAY"
/// Required array items must be strings.
public let schemaRequiredItemNotString = "SCHEMA_REQUIRED_ITEM_NOT_STRING"
/// Required property is not defined in properties.
public let schemaRequiredPropertyNotDefined = "SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED"
/// additionalProperties must be a boolean or schema.
public let schemaAdditionalPropertiesInvalid = "SCHEMA_ADDITIONAL_PROPERTIES_INVALID"
/// Array type requires 'items' or 'contains' schema.
public let schemaArrayMissingItems = "SCHEMA_ARRAY_MISSING_ITEMS"
/// Tuple type requires 'properties' and 'tuple' keyword.
public let schemaTupleMissingDefinition = "SCHEMA_TUPLE_MISSING_DEFINITION"
/// Tuple must be an array.
public let schemaTupleOrderNotArray = "SCHEMA_TUPLE_ORDER_NOT_ARRAY"
/// Map type requires 'values' schema.
public let schemaMapMissingValues = "SCHEMA_MAP_MISSING_VALUES"
/// Choice type requires 'choices' keyword.
public let schemaChoiceMissingChoices = "SCHEMA_CHOICE_MISSING_CHOICES"
/// Choices must be an object.
public let schemaChoicesNotObject = "SCHEMA_CHOICES_NOT_OBJECT"
/// Pattern is not a valid regular expression.
public let schemaPatternInvalid = "SCHEMA_PATTERN_INVALID"
/// Pattern must be a string.
public let schemaPatternNotString = "SCHEMA_PATTERN_NOT_STRING"
/// Enum must be an array.
public let schemaEnumNotArray = "SCHEMA_ENUM_NOT_ARRAY"
/// Enum array cannot be empty.
public let schemaEnumEmpty = "SCHEMA_ENUM_EMPTY"
/// Enum array contains duplicate values.
public let schemaEnumDuplicates = "SCHEMA_ENUM_DUPLICATES"
/// Composition keyword array cannot be empty.
public let schemaCompositionEmpty = "SCHEMA_COMPOSITION_EMPTY"
/// Composition keyword must be an array.
public let schemaCompositionNotArray = "SCHEMA_COMPOSITION_NOT_ARRAY"
/// Altnames must be an object.
public let schemaAltnamesNotObject = "SCHEMA_ALTNAMES_NOT_OBJECT"
/// Altnames values must be strings.
public let schemaAltnamesValueNotString = "SCHEMA_ALTNAMES_VALUE_NOT_STRING"
/// Keyword must be a non-negative integer.
public let schemaIntegerConstraintInvalid = "SCHEMA_INTEGER_CONSTRAINT_INVALID"
/// Keyword must be a number.
public let schemaNumberConstraintInvalid = "SCHEMA_NUMBER_CONSTRAINT_INVALID"
/// Keyword must be a positive number.
public let schemaPositiveNumberConstraintInvalid = "SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID"
/// UniqueItems must be a boolean.
public let schemaUniqueItemsNotBoolean = "SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN"
/// Items must be a boolean or schema for tuple type.
public let schemaItemsInvalidForTuple = "SCHEMA_ITEMS_INVALID_FOR_TUPLE"

// MARK: - Instance Validation Error Codes

/// Unable to resolve $root reference.
public let instanceRootUnresolved = "INSTANCE_ROOT_UNRESOLVED"
/// Maximum validation depth exceeded.
public let instanceMaxDepthExceeded = "INSTANCE_MAX_DEPTH_EXCEEDED"
/// Schema 'false' rejects all values.
public let instanceSchemaFalse = "INSTANCE_SCHEMA_FALSE"
/// Unable to resolve reference.
public let instanceRefUnresolved = "INSTANCE_REF_UNRESOLVED"
/// Value must equal const value.
public let instanceConstMismatch = "INSTANCE_CONST_MISMATCH"
/// Value must be one of the enum values.
public let instanceEnumMismatch = "INSTANCE_ENUM_MISMATCH"
/// Value must match at least one schema in anyOf.
public let instanceAnyOfNoneMatched = "INSTANCE_ANY_OF_NONE_MATCHED"
/// Value must match exactly one schema in oneOf.
public let instanceOneOfInvalidCount = "INSTANCE_ONE_OF_INVALID_COUNT"
/// Value must not match the schema in 'not'.
public let instanceNotMatched = "INSTANCE_NOT_MATCHED"
/// Unknown type.
public let instanceTypeUnknown = "INSTANCE_TYPE_UNKNOWN"
/// Type mismatch.
public let instanceTypeMismatch = "INSTANCE_TYPE_MISMATCH"
/// Value must be null.
public let instanceNullExpected = "INSTANCE_NULL_EXPECTED"
/// Value must be a boolean.
public let instanceBooleanExpected = "INSTANCE_BOOLEAN_EXPECTED"
/// Value must be a string.
public let instanceStringExpected = "INSTANCE_STRING_EXPECTED"
/// String length is less than minimum.
public let instanceStringMinLength = "INSTANCE_STRING_MIN_LENGTH"
/// String length exceeds maximum.
public let instanceStringMaxLength = "INSTANCE_STRING_MAX_LENGTH"
/// String does not match pattern.
public let instanceStringPatternMismatch = "INSTANCE_STRING_PATTERN_MISMATCH"
/// Invalid regex pattern.
public let instancePatternInvalid = "INSTANCE_PATTERN_INVALID"
/// String is not a valid email address.
public let instanceFormatEmailInvalid = "INSTANCE_FORMAT_EMAIL_INVALID"
/// String is not a valid URI.
public let instanceFormatURIInvalid = "INSTANCE_FORMAT_URI_INVALID"
/// String is not a valid URI reference.
public let instanceFormatURIReferenceInvalid = "INSTANCE_FORMAT_URI_REFERENCE_INVALID"
/// String is not a valid date.
public let instanceFormatDateInvalid = "INSTANCE_FORMAT_DATE_INVALID"
/// String is not a valid time.
public let instanceFormatTimeInvalid = "INSTANCE_FORMAT_TIME_INVALID"
/// String is not a valid date-time.
public let instanceFormatDatetimeInvalid = "INSTANCE_FORMAT_DATETIME_INVALID"
/// String is not a valid UUID.
public let instanceFormatUUIDInvalid = "INSTANCE_FORMAT_UUID_INVALID"
/// String is not a valid IPv4 address.
public let instanceFormatIPv4Invalid = "INSTANCE_FORMAT_IPV4_INVALID"
/// String is not a valid IPv6 address.
public let instanceFormatIPv6Invalid = "INSTANCE_FORMAT_IPV6_INVALID"
/// String is not a valid hostname.
public let instanceFormatHostnameInvalid = "INSTANCE_FORMAT_HOSTNAME_INVALID"
/// Value must be a number.
public let instanceNumberExpected = "INSTANCE_NUMBER_EXPECTED"
/// Value must be an integer.
public let instanceIntegerExpected = "INSTANCE_INTEGER_EXPECTED"
/// Integer value is out of range.
public let instanceIntRangeInvalid = "INSTANCE_INT_RANGE_INVALID"
/// Value is less than minimum.
public let instanceNumberMinimum = "INSTANCE_NUMBER_MINIMUM"
/// Value exceeds maximum.
public let instanceNumberMaximum = "INSTANCE_NUMBER_MAXIMUM"
/// Value must be greater than exclusive minimum.
public let instanceNumberExclusiveMinimum = "INSTANCE_NUMBER_EXCLUSIVE_MINIMUM"
/// Value must be less than exclusive maximum.
public let instanceNumberExclusiveMaximum = "INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM"
/// Value is not a multiple of the specified value.
public let instanceNumberMultipleOf = "INSTANCE_NUMBER_MULTIPLE_OF"
/// Value must be an object.
public let instanceObjectExpected = "INSTANCE_OBJECT_EXPECTED"
/// Missing required property.
public let instanceRequiredPropertyMissing = "INSTANCE_REQUIRED_PROPERTY_MISSING"
/// Additional property not allowed.
public let instanceAdditionalPropertyNotAllowed = "INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED"
/// Object has fewer properties than minimum.
public let instanceMinProperties = "INSTANCE_MIN_PROPERTIES"
/// Object has more properties than maximum.
public let instanceMaxProperties = "INSTANCE_MAX_PROPERTIES"
/// Dependent required property is missing.
public let instanceDependentRequired = "INSTANCE_DEPENDENT_REQUIRED"
/// Value must be an array.
public let instanceArrayExpected = "INSTANCE_ARRAY_EXPECTED"
/// Array has fewer items than minimum.
public let instanceMinItems = "INSTANCE_MIN_ITEMS"
/// Array has more items than maximum.
public let instanceMaxItems = "INSTANCE_MAX_ITEMS"
/// Array has fewer matching items than minContains.
public let instanceMinContains = "INSTANCE_MIN_CONTAINS"
/// Array has more matching items than maxContains.
public let instanceMaxContains = "INSTANCE_MAX_CONTAINS"
/// Value must be an array (set).
public let instanceSetExpected = "INSTANCE_SET_EXPECTED"
/// Set contains duplicate value.
public let instanceSetDuplicate = "INSTANCE_SET_DUPLICATE"
/// Value must be an object (map).
public let instanceMapExpected = "INSTANCE_MAP_EXPECTED"
/// Map has fewer entries than minimum.
public let instanceMapMinEntries = "INSTANCE_MAP_MIN_ENTRIES"
/// Map has more entries than maximum.
public let instanceMapMaxEntries = "INSTANCE_MAP_MAX_ENTRIES"
/// Map key does not match keyNames or patternKeys constraint.
public let instanceMapKeyInvalid = "INSTANCE_MAP_KEY_INVALID"
/// Value must be an array (tuple).
public let instanceTupleExpected = "INSTANCE_TUPLE_EXPECTED"
/// Tuple length does not match schema.
public let instanceTupleLengthMismatch = "INSTANCE_TUPLE_LENGTH_MISMATCH"
/// Tuple has additional items not defined in schema.
public let instanceTupleAdditionalItems = "INSTANCE_TUPLE_ADDITIONAL_ITEMS"
/// Value must be an object (choice).
public let instanceChoiceExpected = "INSTANCE_CHOICE_EXPECTED"
/// Choice schema is missing choices.
public let instanceChoiceMissingChoices = "INSTANCE_CHOICE_MISSING_CHOICES"
/// Choice selector property is missing.
public let instanceChoiceSelectorMissing = "INSTANCE_CHOICE_SELECTOR_MISSING"
/// Selector value must be a string.
public let instanceChoiceSelectorNotString = "INSTANCE_CHOICE_SELECTOR_NOT_STRING"
/// Unknown choice.
public let instanceChoiceUnknown = "INSTANCE_CHOICE_UNKNOWN"
/// Value does not match any choice option.
public let instanceChoiceNoMatch = "INSTANCE_CHOICE_NO_MATCH"
/// Value matches multiple choice options.
public let instanceChoiceMultipleMatches = "INSTANCE_CHOICE_MULTIPLE_MATCHES"
/// Date must be a string.
public let instanceDateExpected = "INSTANCE_DATE_EXPECTED"
/// Invalid date format.
public let instanceDateFormatInvalid = "INSTANCE_DATE_FORMAT_INVALID"
/// Time must be a string.
public let instanceTimeExpected = "INSTANCE_TIME_EXPECTED"
/// Invalid time format.
public let instanceTimeFormatInvalid = "INSTANCE_TIME_FORMAT_INVALID"
/// DateTime must be a string.
public let instanceDatetimeExpected = "INSTANCE_DATETIME_EXPECTED"
/// Invalid datetime format.
public let instanceDatetimeFormatInvalid = "INSTANCE_DATETIME_FORMAT_INVALID"
/// Duration must be a string.
public let instanceDurationExpected = "INSTANCE_DURATION_EXPECTED"
/// Invalid duration format.
public let instanceDurationFormatInvalid = "INSTANCE_DURATION_FORMAT_INVALID"
/// UUID must be a string.
public let instanceUUIDExpected = "INSTANCE_UUID_EXPECTED"
/// Invalid UUID format.
public let instanceUUIDFormatInvalid = "INSTANCE_UUID_FORMAT_INVALID"
/// URI must be a string.
public let instanceURIExpected = "INSTANCE_URI_EXPECTED"
/// Invalid URI format.
public let instanceURIFormatInvalid = "INSTANCE_URI_FORMAT_INVALID"
/// URI must have a scheme.
public let instanceURIMissingScheme = "INSTANCE_URI_MISSING_SCHEME"
/// Binary must be a base64 string.
public let instanceBinaryExpected = "INSTANCE_BINARY_EXPECTED"
/// Invalid base64 encoding.
public let instanceBinaryEncodingInvalid = "INSTANCE_BINARY_ENCODING_INVALID"
/// JSON Pointer must be a string.
public let instanceJSONPointerExpected = "INSTANCE_JSONPOINTER_EXPECTED"
/// Invalid JSON Pointer format.
public let instanceJSONPointerFormatInvalid = "INSTANCE_JSONPOINTER_FORMAT_INVALID"
/// Value must be a valid decimal.
public let instanceDecimalExpected = "INSTANCE_DECIMAL_EXPECTED"
/// String value not expected for this type.
public let instanceStringNotExpected = "INSTANCE_STRING_NOT_EXPECTED"
/// Custom type reference not yet supported.
public let instanceCustomTypeNotSupported = "INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED"
/// Object has no property value matching the 'has' schema.
public let instanceHasNoMatch = "INSTANCE_HAS_NO_MATCH"
/// Property value does not match patternProperties schema.
public let instancePatternPropertyMismatch = "INSTANCE_PATTERN_PROPERTY_MISMATCH"
