// Package jsonstructure provides validators for JSON Structure schemas and instances.
package jsonstructure

// ValidationSeverity represents the severity of a validation message.
type ValidationSeverity string

const (
	// SeverityError represents an error severity.
	SeverityError ValidationSeverity = "error"
	// SeverityWarning represents a warning severity.
	SeverityWarning ValidationSeverity = "warning"
)

// JsonLocation represents a location in a JSON document with line and column information.
type JsonLocation struct {
	// Line is the 1-based line number.
	Line int `json:"line"`
	// Column is the 1-based column number.
	Column int `json:"column"`
}

// UnknownLocation returns an unknown location (line 0, column 0).
func UnknownLocation() JsonLocation {
	return JsonLocation{Line: 0, Column: 0}
}

// IsKnown returns true if the location is known (non-zero).
func (l JsonLocation) IsKnown() bool {
	return l.Line > 0 && l.Column > 0
}

// Schema Validation Error Codes

const (
	// SchemaError is a generic schema error.
	SchemaError = "SCHEMA_ERROR"
	// SchemaNull indicates schema cannot be null.
	SchemaNull = "SCHEMA_NULL"
	// SchemaInvalidType indicates schema must be a boolean or object.
	SchemaInvalidType = "SCHEMA_INVALID_TYPE"
	// SchemaMaxDepthExceeded indicates maximum validation depth exceeded.
	SchemaMaxDepthExceeded = "SCHEMA_MAX_DEPTH_EXCEEDED"
	// SchemaKeywordInvalidType indicates keyword has invalid type.
	SchemaKeywordInvalidType = "SCHEMA_KEYWORD_INVALID_TYPE"
	// SchemaKeywordEmpty indicates keyword cannot be empty.
	SchemaKeywordEmpty = "SCHEMA_KEYWORD_EMPTY"
	// SchemaTypeInvalid indicates invalid type name.
	SchemaTypeInvalid = "SCHEMA_TYPE_INVALID"
	// SchemaTypeArrayEmpty indicates type array cannot be empty.
	SchemaTypeArrayEmpty = "SCHEMA_TYPE_ARRAY_EMPTY"
	// SchemaTypeObjectMissingRef indicates type object must contain $ref.
	SchemaTypeObjectMissingRef = "SCHEMA_TYPE_OBJECT_MISSING_REF"
	// SchemaRefNotFound indicates $ref target does not exist.
	SchemaRefNotFound = "SCHEMA_REF_NOT_FOUND"
	// SchemaRefCircular indicates circular reference detected.
	SchemaRefCircular = "SCHEMA_REF_CIRCULAR"
	// SchemaRefNotInType indicates $ref is only permitted inside the 'type' attribute.
	SchemaRefNotInType = "SCHEMA_REF_NOT_IN_TYPE"
	// SchemaMissingType indicates schema must have a 'type' keyword.
	SchemaMissingType = "SCHEMA_MISSING_TYPE"
	// SchemaRootMissingType indicates root schema must have 'type', '$root', or other schema-defining keyword.
	SchemaRootMissingType = "SCHEMA_ROOT_MISSING_TYPE"
	// SchemaRootMissingID indicates root schema must have an '$id' keyword.
	SchemaRootMissingID = "SCHEMA_ROOT_MISSING_ID"
	// SchemaRootMissingName indicates root schema with 'type' must have a 'name' property.
	SchemaRootMissingName = "SCHEMA_ROOT_MISSING_NAME"
	// SchemaExtensionKeywordNotEnabled indicates validation extension keyword is used but validation extensions are not enabled.
	SchemaExtensionKeywordNotEnabled = "SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED"
	// SchemaNameInvalid indicates name is not a valid identifier.
	SchemaNameInvalid = "SCHEMA_NAME_INVALID"
	// SchemaConstraintInvalidForType indicates constraint is not valid for this type.
	SchemaConstraintInvalidForType = "SCHEMA_CONSTRAINT_INVALID_FOR_TYPE"
	// SchemaMinGreaterThanMax indicates minimum cannot be greater than maximum.
	SchemaMinGreaterThanMax = "SCHEMA_MIN_GREATER_THAN_MAX"
	// SchemaPropertiesNotObject indicates properties must be an object.
	SchemaPropertiesNotObject = "SCHEMA_PROPERTIES_NOT_OBJECT"
	// SchemaRequiredNotArray indicates required must be an array.
	SchemaRequiredNotArray = "SCHEMA_REQUIRED_NOT_ARRAY"
	// SchemaRequiredItemNotString indicates required array items must be strings.
	SchemaRequiredItemNotString = "SCHEMA_REQUIRED_ITEM_NOT_STRING"
	// SchemaRequiredPropertyNotDefined indicates required property is not defined in properties.
	SchemaRequiredPropertyNotDefined = "SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED"
	// SchemaAdditionalPropertiesInvalid indicates additionalProperties must be a boolean or schema.
	SchemaAdditionalPropertiesInvalid = "SCHEMA_ADDITIONAL_PROPERTIES_INVALID"
	// SchemaArrayMissingItems indicates array type requires 'items' or 'contains' schema.
	SchemaArrayMissingItems = "SCHEMA_ARRAY_MISSING_ITEMS"
	// SchemaTupleMissingDefinition indicates tuple type requires 'properties' and 'tuple' keyword.
	SchemaTupleMissingDefinition = "SCHEMA_TUPLE_MISSING_DEFINITION"
	// SchemaTupleOrderNotArray indicates tuple must be an array.
	SchemaTupleOrderNotArray = "SCHEMA_TUPLE_ORDER_NOT_ARRAY"
	// SchemaMapMissingValues indicates map type requires 'values' schema.
	SchemaMapMissingValues = "SCHEMA_MAP_MISSING_VALUES"
	// SchemaChoiceMissingChoices indicates choice type requires 'choices' keyword.
	SchemaChoiceMissingChoices = "SCHEMA_CHOICE_MISSING_CHOICES"
	// SchemaChoicesNotObject indicates choices must be an object.
	SchemaChoicesNotObject = "SCHEMA_CHOICES_NOT_OBJECT"
	// SchemaPatternInvalid indicates pattern is not a valid regular expression.
	SchemaPatternInvalid = "SCHEMA_PATTERN_INVALID"
	// SchemaPatternNotString indicates pattern must be a string.
	SchemaPatternNotString = "SCHEMA_PATTERN_NOT_STRING"
	// SchemaEnumNotArray indicates enum must be an array.
	SchemaEnumNotArray = "SCHEMA_ENUM_NOT_ARRAY"
	// SchemaEnumEmpty indicates enum array cannot be empty.
	SchemaEnumEmpty = "SCHEMA_ENUM_EMPTY"
	// SchemaEnumDuplicates indicates enum array contains duplicate values.
	SchemaEnumDuplicates = "SCHEMA_ENUM_DUPLICATES"
	// SchemaCompositionEmpty indicates composition keyword array cannot be empty.
	SchemaCompositionEmpty = "SCHEMA_COMPOSITION_EMPTY"
	// SchemaCompositionNotArray indicates composition keyword must be an array.
	SchemaCompositionNotArray = "SCHEMA_COMPOSITION_NOT_ARRAY"
	// SchemaAltnamesNotObject indicates altnames must be an object.
	SchemaAltnamesNotObject = "SCHEMA_ALTNAMES_NOT_OBJECT"
	// SchemaAltnamesValueNotString indicates altnames values must be strings.
	SchemaAltnamesValueNotString = "SCHEMA_ALTNAMES_VALUE_NOT_STRING"
	// SchemaIntegerConstraintInvalid indicates keyword must be a non-negative integer.
	SchemaIntegerConstraintInvalid = "SCHEMA_INTEGER_CONSTRAINT_INVALID"
	// SchemaNumberConstraintInvalid indicates keyword must be a number.
	SchemaNumberConstraintInvalid = "SCHEMA_NUMBER_CONSTRAINT_INVALID"
	// SchemaPositiveNumberConstraintInvalid indicates keyword must be a positive number.
	SchemaPositiveNumberConstraintInvalid = "SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID"
	// SchemaUniqueItemsNotBoolean indicates uniqueItems must be a boolean.
	SchemaUniqueItemsNotBoolean = "SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN"
	// SchemaItemsInvalidForTuple indicates items must be a boolean or schema for tuple type.
	SchemaItemsInvalidForTuple = "SCHEMA_ITEMS_INVALID_FOR_TUPLE"
)

// Instance Validation Error Codes

const (
	// InstanceRootUnresolved indicates unable to resolve $root reference.
	InstanceRootUnresolved = "INSTANCE_ROOT_UNRESOLVED"
	// InstanceMaxDepthExceeded indicates maximum validation depth exceeded.
	InstanceMaxDepthExceeded = "INSTANCE_MAX_DEPTH_EXCEEDED"
	// InstanceSchemaFalse indicates schema 'false' rejects all values.
	InstanceSchemaFalse = "INSTANCE_SCHEMA_FALSE"
	// InstanceRefUnresolved indicates unable to resolve reference.
	InstanceRefUnresolved = "INSTANCE_REF_UNRESOLVED"
	// InstanceConstMismatch indicates value must equal const value.
	InstanceConstMismatch = "INSTANCE_CONST_MISMATCH"
	// InstanceEnumMismatch indicates value must be one of the enum values.
	InstanceEnumMismatch = "INSTANCE_ENUM_MISMATCH"
	// InstanceAnyOfNoneMatched indicates value must match at least one schema in anyOf.
	InstanceAnyOfNoneMatched = "INSTANCE_ANY_OF_NONE_MATCHED"
	// InstanceOneOfInvalidCount indicates value must match exactly one schema in oneOf.
	InstanceOneOfInvalidCount = "INSTANCE_ONE_OF_INVALID_COUNT"
	// InstanceNotMatched indicates value must not match the schema in 'not'.
	InstanceNotMatched = "INSTANCE_NOT_MATCHED"
	// InstanceTypeUnknown indicates unknown type.
	InstanceTypeUnknown = "INSTANCE_TYPE_UNKNOWN"
	// InstanceTypeMismatch indicates type mismatch.
	InstanceTypeMismatch = "INSTANCE_TYPE_MISMATCH"
	// InstanceNullExpected indicates value must be null.
	InstanceNullExpected = "INSTANCE_NULL_EXPECTED"
	// InstanceBooleanExpected indicates value must be a boolean.
	InstanceBooleanExpected = "INSTANCE_BOOLEAN_EXPECTED"
	// InstanceStringExpected indicates value must be a string.
	InstanceStringExpected = "INSTANCE_STRING_EXPECTED"
	// InstanceStringMinLength indicates string length is less than minimum.
	InstanceStringMinLength = "INSTANCE_STRING_MIN_LENGTH"
	// InstanceStringMaxLength indicates string length exceeds maximum.
	InstanceStringMaxLength = "INSTANCE_STRING_MAX_LENGTH"
	// InstanceStringPatternMismatch indicates string does not match pattern.
	InstanceStringPatternMismatch = "INSTANCE_STRING_PATTERN_MISMATCH"
	// InstancePatternInvalid indicates invalid regex pattern.
	InstancePatternInvalid = "INSTANCE_PATTERN_INVALID"
	// InstanceFormatEmailInvalid indicates string is not a valid email address.
	InstanceFormatEmailInvalid = "INSTANCE_FORMAT_EMAIL_INVALID"
	// InstanceFormatURIInvalid indicates string is not a valid URI.
	InstanceFormatURIInvalid = "INSTANCE_FORMAT_URI_INVALID"
	// InstanceFormatURIReferenceInvalid indicates string is not a valid URI reference.
	InstanceFormatURIReferenceInvalid = "INSTANCE_FORMAT_URI_REFERENCE_INVALID"
	// InstanceFormatDateInvalid indicates string is not a valid date.
	InstanceFormatDateInvalid = "INSTANCE_FORMAT_DATE_INVALID"
	// InstanceFormatTimeInvalid indicates string is not a valid time.
	InstanceFormatTimeInvalid = "INSTANCE_FORMAT_TIME_INVALID"
	// InstanceFormatDatetimeInvalid indicates string is not a valid date-time.
	InstanceFormatDatetimeInvalid = "INSTANCE_FORMAT_DATETIME_INVALID"
	// InstanceFormatUUIDInvalid indicates string is not a valid UUID.
	InstanceFormatUUIDInvalid = "INSTANCE_FORMAT_UUID_INVALID"
	// InstanceFormatIPv4Invalid indicates string is not a valid IPv4 address.
	InstanceFormatIPv4Invalid = "INSTANCE_FORMAT_IPV4_INVALID"
	// InstanceFormatIPv6Invalid indicates string is not a valid IPv6 address.
	InstanceFormatIPv6Invalid = "INSTANCE_FORMAT_IPV6_INVALID"
	// InstanceFormatHostnameInvalid indicates string is not a valid hostname.
	InstanceFormatHostnameInvalid = "INSTANCE_FORMAT_HOSTNAME_INVALID"
	// InstanceNumberExpected indicates value must be a number.
	InstanceNumberExpected = "INSTANCE_NUMBER_EXPECTED"
	// InstanceIntegerExpected indicates value must be an integer.
	InstanceIntegerExpected = "INSTANCE_INTEGER_EXPECTED"
	// InstanceIntRangeInvalid indicates integer value is out of range.
	InstanceIntRangeInvalid = "INSTANCE_INT_RANGE_INVALID"
	// InstanceNumberMinimum indicates value is less than minimum.
	InstanceNumberMinimum = "INSTANCE_NUMBER_MINIMUM"
	// InstanceNumberMaximum indicates value exceeds maximum.
	InstanceNumberMaximum = "INSTANCE_NUMBER_MAXIMUM"
	// InstanceNumberExclusiveMinimum indicates value must be greater than exclusive minimum.
	InstanceNumberExclusiveMinimum = "INSTANCE_NUMBER_EXCLUSIVE_MINIMUM"
	// InstanceNumberExclusiveMaximum indicates value must be less than exclusive maximum.
	InstanceNumberExclusiveMaximum = "INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM"
	// InstanceNumberMultipleOf indicates value is not a multiple of the specified value.
	InstanceNumberMultipleOf = "INSTANCE_NUMBER_MULTIPLE_OF"
	// InstanceObjectExpected indicates value must be an object.
	InstanceObjectExpected = "INSTANCE_OBJECT_EXPECTED"
	// InstanceRequiredPropertyMissing indicates missing required property.
	InstanceRequiredPropertyMissing = "INSTANCE_REQUIRED_PROPERTY_MISSING"
	// InstanceAdditionalPropertyNotAllowed indicates additional property not allowed.
	InstanceAdditionalPropertyNotAllowed = "INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED"
	// InstanceMinProperties indicates object has fewer properties than minimum.
	InstanceMinProperties = "INSTANCE_MIN_PROPERTIES"
	// InstanceMaxProperties indicates object has more properties than maximum.
	InstanceMaxProperties = "INSTANCE_MAX_PROPERTIES"
	// InstanceDependentRequired indicates dependent required property is missing.
	InstanceDependentRequired = "INSTANCE_DEPENDENT_REQUIRED"
	// InstanceArrayExpected indicates value must be an array.
	InstanceArrayExpected = "INSTANCE_ARRAY_EXPECTED"
	// InstanceMinItems indicates array has fewer items than minimum.
	InstanceMinItems = "INSTANCE_MIN_ITEMS"
	// InstanceMaxItems indicates array has more items than maximum.
	InstanceMaxItems = "INSTANCE_MAX_ITEMS"
	// InstanceMinContains indicates array has fewer matching items than minContains.
	InstanceMinContains = "INSTANCE_MIN_CONTAINS"
	// InstanceMaxContains indicates array has more matching items than maxContains.
	InstanceMaxContains = "INSTANCE_MAX_CONTAINS"
	// InstanceSetExpected indicates value must be an array (set).
	InstanceSetExpected = "INSTANCE_SET_EXPECTED"
	// InstanceSetDuplicate indicates set contains duplicate value.
	InstanceSetDuplicate = "INSTANCE_SET_DUPLICATE"
	// InstanceMapExpected indicates value must be an object (map).
	InstanceMapExpected = "INSTANCE_MAP_EXPECTED"
	// InstanceMapMinEntries indicates map has fewer entries than minimum.
	InstanceMapMinEntries = "INSTANCE_MAP_MIN_ENTRIES"
	// InstanceMapMaxEntries indicates map has more entries than maximum.
	InstanceMapMaxEntries = "INSTANCE_MAP_MAX_ENTRIES"
	// InstanceMapKeyInvalid indicates map key does not match keyNames or patternKeys constraint.
	InstanceMapKeyInvalid = "INSTANCE_MAP_KEY_INVALID"
	// InstanceTupleExpected indicates value must be an array (tuple).
	InstanceTupleExpected = "INSTANCE_TUPLE_EXPECTED"
	// InstanceTupleLengthMismatch indicates tuple length does not match schema.
	InstanceTupleLengthMismatch = "INSTANCE_TUPLE_LENGTH_MISMATCH"
	// InstanceTupleAdditionalItems indicates tuple has additional items not defined in schema.
	InstanceTupleAdditionalItems = "INSTANCE_TUPLE_ADDITIONAL_ITEMS"
	// InstanceChoiceExpected indicates value must be an object (choice).
	InstanceChoiceExpected = "INSTANCE_CHOICE_EXPECTED"
	// InstanceChoiceMissingChoices indicates choice schema is missing choices.
	InstanceChoiceMissingChoices = "INSTANCE_CHOICE_MISSING_CHOICES"
	// InstanceChoiceSelectorMissing indicates choice selector property is missing.
	InstanceChoiceSelectorMissing = "INSTANCE_CHOICE_SELECTOR_MISSING"
	// InstanceChoiceSelectorNotString indicates selector value must be a string.
	InstanceChoiceSelectorNotString = "INSTANCE_CHOICE_SELECTOR_NOT_STRING"
	// InstanceChoiceUnknown indicates unknown choice.
	InstanceChoiceUnknown = "INSTANCE_CHOICE_UNKNOWN"
	// InstanceChoiceNoMatch indicates value does not match any choice option.
	InstanceChoiceNoMatch = "INSTANCE_CHOICE_NO_MATCH"
	// InstanceChoiceMultipleMatches indicates value matches multiple choice options.
	InstanceChoiceMultipleMatches = "INSTANCE_CHOICE_MULTIPLE_MATCHES"
	// InstanceDateExpected indicates date must be a string.
	InstanceDateExpected = "INSTANCE_DATE_EXPECTED"
	// InstanceDateFormatInvalid indicates invalid date format.
	InstanceDateFormatInvalid = "INSTANCE_DATE_FORMAT_INVALID"
	// InstanceTimeExpected indicates time must be a string.
	InstanceTimeExpected = "INSTANCE_TIME_EXPECTED"
	// InstanceTimeFormatInvalid indicates invalid time format.
	InstanceTimeFormatInvalid = "INSTANCE_TIME_FORMAT_INVALID"
	// InstanceDatetimeExpected indicates datetime must be a string.
	InstanceDatetimeExpected = "INSTANCE_DATETIME_EXPECTED"
	// InstanceDatetimeFormatInvalid indicates invalid datetime format.
	InstanceDatetimeFormatInvalid = "INSTANCE_DATETIME_FORMAT_INVALID"
	// InstanceDurationExpected indicates duration must be a string.
	InstanceDurationExpected = "INSTANCE_DURATION_EXPECTED"
	// InstanceDurationFormatInvalid indicates invalid duration format.
	InstanceDurationFormatInvalid = "INSTANCE_DURATION_FORMAT_INVALID"
	// InstanceUUIDExpected indicates UUID must be a string.
	InstanceUUIDExpected = "INSTANCE_UUID_EXPECTED"
	// InstanceUUIDFormatInvalid indicates invalid UUID format.
	InstanceUUIDFormatInvalid = "INSTANCE_UUID_FORMAT_INVALID"
	// InstanceURIExpected indicates URI must be a string.
	InstanceURIExpected = "INSTANCE_URI_EXPECTED"
	// InstanceURIFormatInvalid indicates invalid URI format.
	InstanceURIFormatInvalid = "INSTANCE_URI_FORMAT_INVALID"
	// InstanceURIMissingScheme indicates URI must have a scheme.
	InstanceURIMissingScheme = "INSTANCE_URI_MISSING_SCHEME"
	// InstanceBinaryExpected indicates binary must be a base64 string.
	InstanceBinaryExpected = "INSTANCE_BINARY_EXPECTED"
	// InstanceBinaryEncodingInvalid indicates invalid base64 encoding.
	InstanceBinaryEncodingInvalid = "INSTANCE_BINARY_ENCODING_INVALID"
	// InstanceJSONPointerExpected indicates JSON Pointer must be a string.
	InstanceJSONPointerExpected = "INSTANCE_JSONPOINTER_EXPECTED"
	// InstanceJSONPointerFormatInvalid indicates invalid JSON Pointer format.
	InstanceJSONPointerFormatInvalid = "INSTANCE_JSONPOINTER_FORMAT_INVALID"
	// InstanceDecimalExpected indicates value must be a valid decimal.
	InstanceDecimalExpected = "INSTANCE_DECIMAL_EXPECTED"
	// InstanceStringNotExpected indicates string value not expected for this type.
	InstanceStringNotExpected = "INSTANCE_STRING_NOT_EXPECTED"
	// InstanceCustomTypeNotSupported indicates custom type reference not yet supported.
	InstanceCustomTypeNotSupported = "INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED"
)
