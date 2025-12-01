/**
 * Standardized error codes for JSON Structure validation.
 * These codes are consistent across all SDK implementations.
 */

// #region Schema Validation Errors (SCHEMA_*)

/** Schema cannot be null. */
export const SCHEMA_NULL = "SCHEMA_NULL";

/** Schema must be a boolean or object. */
export const SCHEMA_INVALID_TYPE = "SCHEMA_INVALID_TYPE";

/** Maximum validation depth exceeded. */
export const SCHEMA_MAX_DEPTH_EXCEEDED = "SCHEMA_MAX_DEPTH_EXCEEDED";

/** Keyword has invalid type. */
export const SCHEMA_KEYWORD_INVALID_TYPE = "SCHEMA_KEYWORD_INVALID_TYPE";

/** Keyword cannot be empty. */
export const SCHEMA_KEYWORD_EMPTY = "SCHEMA_KEYWORD_EMPTY";

/** Invalid type name. */
export const SCHEMA_TYPE_INVALID = "SCHEMA_TYPE_INVALID";

/** Type array cannot be empty. */
export const SCHEMA_TYPE_ARRAY_EMPTY = "SCHEMA_TYPE_ARRAY_EMPTY";

/** Type object must contain $ref. */
export const SCHEMA_TYPE_OBJECT_MISSING_REF = "SCHEMA_TYPE_OBJECT_MISSING_REF";

/** $ref target does not exist. */
export const SCHEMA_REF_NOT_FOUND = "SCHEMA_REF_NOT_FOUND";

/** Circular reference detected. */
export const SCHEMA_REF_CIRCULAR = "SCHEMA_REF_CIRCULAR";

/** $ref is only permitted inside the 'type' attribute. */
export const SCHEMA_REF_NOT_IN_TYPE = "SCHEMA_REF_NOT_IN_TYPE";

/** Schema must have a 'type' keyword. */
export const SCHEMA_MISSING_TYPE = "SCHEMA_MISSING_TYPE";

/** Root schema must have 'type', '$root', or other schema-defining keyword. */
export const SCHEMA_ROOT_MISSING_TYPE = "SCHEMA_ROOT_MISSING_TYPE";

/** Root schema must have an '$id' keyword. */
export const SCHEMA_ROOT_MISSING_ID = "SCHEMA_ROOT_MISSING_ID";

/** Root schema with 'type' must have a 'name' property. */
export const SCHEMA_ROOT_MISSING_NAME = "SCHEMA_ROOT_MISSING_NAME";

/** Unknown keyword found in schema. */
export const SCHEMA_UNKNOWN_KEYWORD = "SCHEMA_UNKNOWN_KEYWORD";

/** Validation extension keyword is used but validation extensions are not enabled. */
export const SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED = "SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED";

/** Name is not a valid identifier. */
export const SCHEMA_NAME_INVALID = "SCHEMA_NAME_INVALID";

/** Constraint is not valid for this type. */
export const SCHEMA_CONSTRAINT_INVALID_FOR_TYPE = "SCHEMA_CONSTRAINT_INVALID_FOR_TYPE";

/** Constraint type mismatch (e.g., string constraint on numeric type). */
export const SCHEMA_CONSTRAINT_TYPE_MISMATCH = "SCHEMA_CONSTRAINT_TYPE_MISMATCH";

/** $ref must be a string. */
export const SCHEMA_REF_INVALID = "SCHEMA_REF_INVALID";

/** Minimum cannot be greater than maximum. */
export const SCHEMA_MIN_GREATER_THAN_MAX = "SCHEMA_MIN_GREATER_THAN_MAX";

/** Properties must be an object. */
export const SCHEMA_PROPERTIES_NOT_OBJECT = "SCHEMA_PROPERTIES_NOT_OBJECT";

/** Required must be an array. */
export const SCHEMA_REQUIRED_NOT_ARRAY = "SCHEMA_REQUIRED_NOT_ARRAY";

/** Required array items must be strings. */
export const SCHEMA_REQUIRED_ITEM_NOT_STRING = "SCHEMA_REQUIRED_ITEM_NOT_STRING";

/** Required property is not defined in properties. */
export const SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED = "SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED";

/** additionalProperties must be a boolean or schema. */
export const SCHEMA_ADDITIONAL_PROPERTIES_INVALID = "SCHEMA_ADDITIONAL_PROPERTIES_INVALID";

/** Array type requires 'items' schema. */
export const SCHEMA_ARRAY_MISSING_ITEMS = "SCHEMA_ARRAY_MISSING_ITEMS";

/** Tuple type requires 'properties' and 'tuple' keywords. */
export const SCHEMA_TUPLE_MISSING_DEFINITION = "SCHEMA_TUPLE_MISSING_DEFINITION";

/** 'tuple' keyword must be an array of property names. */
export const SCHEMA_TUPLE_ORDER_NOT_ARRAY = "SCHEMA_TUPLE_ORDER_NOT_ARRAY";

/** Map type requires 'values' schema. */
export const SCHEMA_MAP_MISSING_VALUES = "SCHEMA_MAP_MISSING_VALUES";

/** Choice type requires 'choices' keyword. */
export const SCHEMA_CHOICE_MISSING_CHOICES = "SCHEMA_CHOICE_MISSING_CHOICES";

/** Choices must be an object. */
export const SCHEMA_CHOICES_NOT_OBJECT = "SCHEMA_CHOICES_NOT_OBJECT";

/** Pattern is not a valid regular expression. */
export const SCHEMA_PATTERN_INVALID = "SCHEMA_PATTERN_INVALID";

/** Pattern must be a string. */
export const SCHEMA_PATTERN_NOT_STRING = "SCHEMA_PATTERN_NOT_STRING";

/** Enum must be an array. */
export const SCHEMA_ENUM_NOT_ARRAY = "SCHEMA_ENUM_NOT_ARRAY";

/** Enum array cannot be empty. */
export const SCHEMA_ENUM_EMPTY = "SCHEMA_ENUM_EMPTY";

/** Enum array contains duplicate values. */
export const SCHEMA_ENUM_DUPLICATES = "SCHEMA_ENUM_DUPLICATES";

/** Composition keyword array cannot be empty. */
export const SCHEMA_COMPOSITION_EMPTY = "SCHEMA_COMPOSITION_EMPTY";

/** Composition keyword must be an array. */
export const SCHEMA_COMPOSITION_NOT_ARRAY = "SCHEMA_COMPOSITION_NOT_ARRAY";

/** altnames must be an object. */
export const SCHEMA_ALTNAMES_NOT_OBJECT = "SCHEMA_ALTNAMES_NOT_OBJECT";

/** altnames values must be strings. */
export const SCHEMA_ALTNAMES_VALUE_NOT_STRING = "SCHEMA_ALTNAMES_VALUE_NOT_STRING";

/** Keyword must be a non-negative integer. */
export const SCHEMA_INTEGER_CONSTRAINT_INVALID = "SCHEMA_INTEGER_CONSTRAINT_INVALID";

/** Keyword must be a number. */
export const SCHEMA_NUMBER_CONSTRAINT_INVALID = "SCHEMA_NUMBER_CONSTRAINT_INVALID";

/** Keyword must be a positive number. */
export const SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID = "SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID";

/** uniqueItems must be a boolean. */
export const SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN = "SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN";

/** items must be a boolean or schema for tuple type. */
export const SCHEMA_ITEMS_INVALID_FOR_TUPLE = "SCHEMA_ITEMS_INVALID_FOR_TUPLE";

/** Tuple type is missing order specification. */
export const SCHEMA_TUPLE_MISSING_ORDER = "SCHEMA_TUPLE_MISSING_ORDER";

/** Tuple property is not defined. */
export const SCHEMA_TUPLE_PROPERTY_NOT_DEFINED = "SCHEMA_TUPLE_PROPERTY_NOT_DEFINED";

/** Enum contains duplicate value. */
export const SCHEMA_ENUM_DUPLICATE_VALUE = "SCHEMA_ENUM_DUPLICATE_VALUE";

/** Constraint value is invalid. */
export const SCHEMA_CONSTRAINT_VALUE_INVALID = "SCHEMA_CONSTRAINT_VALUE_INVALID";

/** Constraint range is invalid. */
export const SCHEMA_CONSTRAINT_RANGE_INVALID = "SCHEMA_CONSTRAINT_RANGE_INVALID";

// #endregion

// #region Instance Validation Errors (INSTANCE_*)

/** Unable to resolve $root reference. */
export const INSTANCE_ROOT_UNRESOLVED = "INSTANCE_ROOT_UNRESOLVED";

/** Maximum validation depth exceeded. */
export const INSTANCE_MAX_DEPTH_EXCEEDED = "INSTANCE_MAX_DEPTH_EXCEEDED";

/** Schema 'false' rejects all values. */
export const INSTANCE_SCHEMA_FALSE = "INSTANCE_SCHEMA_FALSE";

/** Unable to resolve reference. */
export const INSTANCE_REF_UNRESOLVED = "INSTANCE_REF_UNRESOLVED";

/** Value must equal const value. */
export const INSTANCE_CONST_MISMATCH = "INSTANCE_CONST_MISMATCH";

/** Value must be one of the enum values. */
export const INSTANCE_ENUM_MISMATCH = "INSTANCE_ENUM_MISMATCH";

/** Value must match at least one schema in anyOf. */
export const INSTANCE_ANY_OF_NONE_MATCHED = "INSTANCE_ANY_OF_NONE_MATCHED";

/** Value must match exactly one schema in oneOf. */
export const INSTANCE_ONE_OF_INVALID_COUNT = "INSTANCE_ONE_OF_INVALID_COUNT";

/** Value must not match the schema in 'not'. */
export const INSTANCE_NOT_MATCHED = "INSTANCE_NOT_MATCHED";

/** Unknown type. */
export const INSTANCE_TYPE_UNKNOWN = "INSTANCE_TYPE_UNKNOWN";

/** Type mismatch. */
export const INSTANCE_TYPE_MISMATCH = "INSTANCE_TYPE_MISMATCH";

/** Value must be null. */
export const INSTANCE_NULL_EXPECTED = "INSTANCE_NULL_EXPECTED";

/** Value must be a boolean. */
export const INSTANCE_BOOLEAN_EXPECTED = "INSTANCE_BOOLEAN_EXPECTED";

/** Value must be a string. */
export const INSTANCE_STRING_EXPECTED = "INSTANCE_STRING_EXPECTED";

/** String length is less than minimum. */
export const INSTANCE_STRING_MIN_LENGTH = "INSTANCE_STRING_MIN_LENGTH";

/** String length exceeds maximum. */
export const INSTANCE_STRING_MAX_LENGTH = "INSTANCE_STRING_MAX_LENGTH";

/** String does not match pattern. */
export const INSTANCE_STRING_PATTERN_MISMATCH = "INSTANCE_STRING_PATTERN_MISMATCH";

/** Invalid regex pattern. */
export const INSTANCE_PATTERN_INVALID = "INSTANCE_PATTERN_INVALID";

/** String is not a valid email address. */
export const INSTANCE_FORMAT_EMAIL_INVALID = "INSTANCE_FORMAT_EMAIL_INVALID";

/** String is not a valid URI. */
export const INSTANCE_FORMAT_URI_INVALID = "INSTANCE_FORMAT_URI_INVALID";

/** String is not a valid URI reference. */
export const INSTANCE_FORMAT_URI_REFERENCE_INVALID = "INSTANCE_FORMAT_URI_REFERENCE_INVALID";

/** String is not a valid date. */
export const INSTANCE_FORMAT_DATE_INVALID = "INSTANCE_FORMAT_DATE_INVALID";

/** String is not a valid time. */
export const INSTANCE_FORMAT_TIME_INVALID = "INSTANCE_FORMAT_TIME_INVALID";

/** String is not a valid date-time. */
export const INSTANCE_FORMAT_DATETIME_INVALID = "INSTANCE_FORMAT_DATETIME_INVALID";

/** String is not a valid UUID. */
export const INSTANCE_FORMAT_UUID_INVALID = "INSTANCE_FORMAT_UUID_INVALID";

/** String is not a valid IPv4 address. */
export const INSTANCE_FORMAT_IPV4_INVALID = "INSTANCE_FORMAT_IPV4_INVALID";

/** String is not a valid IPv6 address. */
export const INSTANCE_FORMAT_IPV6_INVALID = "INSTANCE_FORMAT_IPV6_INVALID";

/** String is not a valid hostname. */
export const INSTANCE_FORMAT_HOSTNAME_INVALID = "INSTANCE_FORMAT_HOSTNAME_INVALID";

/** Value must be a number. */
export const INSTANCE_NUMBER_EXPECTED = "INSTANCE_NUMBER_EXPECTED";

/** Value must be an integer. */
export const INSTANCE_INTEGER_EXPECTED = "INSTANCE_INTEGER_EXPECTED";

/** Integer value is out of range. */
export const INSTANCE_INT_RANGE_INVALID = "INSTANCE_INT_RANGE_INVALID";

/** Value is less than minimum. */
export const INSTANCE_NUMBER_MINIMUM = "INSTANCE_NUMBER_MINIMUM";

/** Value exceeds maximum. */
export const INSTANCE_NUMBER_MAXIMUM = "INSTANCE_NUMBER_MAXIMUM";

/** Value must be greater than exclusive minimum. */
export const INSTANCE_NUMBER_EXCLUSIVE_MINIMUM = "INSTANCE_NUMBER_EXCLUSIVE_MINIMUM";

/** Value must be less than exclusive maximum. */
export const INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM = "INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM";

/** Value is not a multiple of the specified value. */
export const INSTANCE_NUMBER_MULTIPLE_OF = "INSTANCE_NUMBER_MULTIPLE_OF";

/** Value must be an object. */
export const INSTANCE_OBJECT_EXPECTED = "INSTANCE_OBJECT_EXPECTED";

/** Missing required property. */
export const INSTANCE_REQUIRED_PROPERTY_MISSING = "INSTANCE_REQUIRED_PROPERTY_MISSING";

/** Additional property not allowed. */
export const INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED = "INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED";

/** Object has fewer properties than minimum. */
export const INSTANCE_MIN_PROPERTIES = "INSTANCE_MIN_PROPERTIES";

/** Object has more properties than maximum. */
export const INSTANCE_MAX_PROPERTIES = "INSTANCE_MAX_PROPERTIES";

/** Dependent required property is missing. */
export const INSTANCE_DEPENDENT_REQUIRED = "INSTANCE_DEPENDENT_REQUIRED";

/** Value must be an array. */
export const INSTANCE_ARRAY_EXPECTED = "INSTANCE_ARRAY_EXPECTED";

/** Array has fewer items than minimum. */
export const INSTANCE_MIN_ITEMS = "INSTANCE_MIN_ITEMS";

/** Array has more items than maximum. */
export const INSTANCE_MAX_ITEMS = "INSTANCE_MAX_ITEMS";

/** Array has fewer matching items than minContains. */
export const INSTANCE_MIN_CONTAINS = "INSTANCE_MIN_CONTAINS";

/** Array has more matching items than maxContains. */
export const INSTANCE_MAX_CONTAINS = "INSTANCE_MAX_CONTAINS";

/** Value must be an array (set). */
export const INSTANCE_SET_EXPECTED = "INSTANCE_SET_EXPECTED";

/** Set contains duplicate value. */
export const INSTANCE_SET_DUPLICATE = "INSTANCE_SET_DUPLICATE";

/** Value must be an object (map). */
export const INSTANCE_MAP_EXPECTED = "INSTANCE_MAP_EXPECTED";

/** Map has fewer entries than minimum. */
export const INSTANCE_MAP_MIN_ENTRIES = "INSTANCE_MAP_MIN_ENTRIES";

/** Map has more entries than maximum. */
export const INSTANCE_MAP_MAX_ENTRIES = "INSTANCE_MAP_MAX_ENTRIES";

/** Map key does not match keyNames or patternKeys constraint. */
export const INSTANCE_MAP_KEY_INVALID = "INSTANCE_MAP_KEY_INVALID";

/** Value must be an array (tuple). */
export const INSTANCE_TUPLE_EXPECTED = "INSTANCE_TUPLE_EXPECTED";

/** Tuple length does not match schema. */
export const INSTANCE_TUPLE_LENGTH_MISMATCH = "INSTANCE_TUPLE_LENGTH_MISMATCH";

/** Tuple has additional items not defined in schema. */
export const INSTANCE_TUPLE_ADDITIONAL_ITEMS = "INSTANCE_TUPLE_ADDITIONAL_ITEMS";

/** Value must be an object (choice). */
export const INSTANCE_CHOICE_EXPECTED = "INSTANCE_CHOICE_EXPECTED";

/** Choice schema is missing choices. */
export const INSTANCE_CHOICE_MISSING_CHOICES = "INSTANCE_CHOICE_MISSING_CHOICES";

/** Choice selector property is missing. */
export const INSTANCE_CHOICE_SELECTOR_MISSING = "INSTANCE_CHOICE_SELECTOR_MISSING";

/** Selector value must be a string. */
export const INSTANCE_CHOICE_SELECTOR_NOT_STRING = "INSTANCE_CHOICE_SELECTOR_NOT_STRING";

/** Unknown choice. */
export const INSTANCE_CHOICE_UNKNOWN = "INSTANCE_CHOICE_UNKNOWN";

/** Value does not match any choice option. */
export const INSTANCE_CHOICE_NO_MATCH = "INSTANCE_CHOICE_NO_MATCH";

/** Value matches multiple choice options. */
export const INSTANCE_CHOICE_MULTIPLE_MATCHES = "INSTANCE_CHOICE_MULTIPLE_MATCHES";

/** Date must be a string. */
export const INSTANCE_DATE_EXPECTED = "INSTANCE_DATE_EXPECTED";

/** Invalid date format. */
export const INSTANCE_DATE_FORMAT_INVALID = "INSTANCE_DATE_FORMAT_INVALID";

/** Time must be a string. */
export const INSTANCE_TIME_EXPECTED = "INSTANCE_TIME_EXPECTED";

/** Invalid time format. */
export const INSTANCE_TIME_FORMAT_INVALID = "INSTANCE_TIME_FORMAT_INVALID";

/** DateTime must be a string. */
export const INSTANCE_DATETIME_EXPECTED = "INSTANCE_DATETIME_EXPECTED";

/** Invalid datetime format. */
export const INSTANCE_DATETIME_FORMAT_INVALID = "INSTANCE_DATETIME_FORMAT_INVALID";

/** Duration must be a string. */
export const INSTANCE_DURATION_EXPECTED = "INSTANCE_DURATION_EXPECTED";

/** Invalid duration format. */
export const INSTANCE_DURATION_FORMAT_INVALID = "INSTANCE_DURATION_FORMAT_INVALID";

/** UUID must be a string. */
export const INSTANCE_UUID_EXPECTED = "INSTANCE_UUID_EXPECTED";

/** Invalid UUID format. */
export const INSTANCE_UUID_FORMAT_INVALID = "INSTANCE_UUID_FORMAT_INVALID";

/** URI must be a string. */
export const INSTANCE_URI_EXPECTED = "INSTANCE_URI_EXPECTED";

/** Invalid URI format. */
export const INSTANCE_URI_FORMAT_INVALID = "INSTANCE_URI_FORMAT_INVALID";

/** URI must have a scheme. */
export const INSTANCE_URI_MISSING_SCHEME = "INSTANCE_URI_MISSING_SCHEME";

/** Binary must be a base64 string. */
export const INSTANCE_BINARY_EXPECTED = "INSTANCE_BINARY_EXPECTED";

/** Invalid base64 encoding. */
export const INSTANCE_BINARY_ENCODING_INVALID = "INSTANCE_BINARY_ENCODING_INVALID";

/** JSON Pointer must be a string. */
export const INSTANCE_JSONPOINTER_EXPECTED = "INSTANCE_JSONPOINTER_EXPECTED";

/** Invalid JSON Pointer format. */
export const INSTANCE_JSONPOINTER_FORMAT_INVALID = "INSTANCE_JSONPOINTER_FORMAT_INVALID";

/** Value must be a valid decimal. */
export const INSTANCE_DECIMAL_EXPECTED = "INSTANCE_DECIMAL_EXPECTED";

/** String value not expected for this type. */
export const INSTANCE_STRING_NOT_EXPECTED = "INSTANCE_STRING_NOT_EXPECTED";

/** Custom type reference not yet supported. */
export const INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED = "INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED";

/** Schema is invalid. */
export const INSTANCE_SCHEMA_INVALID = "INSTANCE_SCHEMA_INVALID";

/** Root reference is invalid. */
export const INSTANCE_ROOT_REF_INVALID = "INSTANCE_ROOT_REF_INVALID";

/** Reference resolution failed. */
export const INSTANCE_REF_RESOLUTION_FAILED = "INSTANCE_REF_RESOLUTION_FAILED";

/** Extends resolution failed. */
export const INSTANCE_EXTENDS_RESOLUTION_FAILED = "INSTANCE_EXTENDS_RESOLUTION_FAILED";

/** Value does not match any union type. */
export const INSTANCE_UNION_NO_MATCH = "INSTANCE_UNION_NO_MATCH";

/** Schema is missing type. */
export const INSTANCE_SCHEMA_MISSING_TYPE = "INSTANCE_SCHEMA_MISSING_TYPE";

/** Cannot instantiate abstract schema. */
export const INSTANCE_ABSTRACT_SCHEMA = "INSTANCE_ABSTRACT_SCHEMA";

/** Format is invalid. */
export const INSTANCE_FORMAT_INVALID = "INSTANCE_FORMAT_INVALID";

/** Unknown type encountered. */
export const INSTANCE_UNKNOWN_TYPE = "INSTANCE_UNKNOWN_TYPE";

/** Value is out of range. */
export const INSTANCE_VALUE_OUT_OF_RANGE = "INSTANCE_VALUE_OUT_OF_RANGE";

/** Set contains duplicate item. */
export const INSTANCE_SET_DUPLICATE_ITEM = "INSTANCE_SET_DUPLICATE_ITEM";

/** Choice value is invalid. */
export const INSTANCE_CHOICE_INVALID = "INSTANCE_CHOICE_INVALID";

/** Value does not match any schema in anyOf. */
export const INSTANCE_ANYOF_NO_MATCH = "INSTANCE_ANYOF_NO_MATCH";

/** Value does not match exactly one schema in oneOf. */
export const INSTANCE_ONEOF_MISMATCH = "INSTANCE_ONEOF_MISMATCH";

/** Value matched the schema in 'not' when it should not. */
export const INSTANCE_NOT_FAILED = "INSTANCE_NOT_FAILED";

/** String is shorter than minimum length. */
export const INSTANCE_STRING_TOO_SHORT = "INSTANCE_STRING_TOO_SHORT";

/** String is longer than maximum length. */
export const INSTANCE_STRING_TOO_LONG = "INSTANCE_STRING_TOO_LONG";

/** String does not match the required pattern. */
export const INSTANCE_PATTERN_MISMATCH = "INSTANCE_PATTERN_MISMATCH";

/** Number is smaller than minimum. */
export const INSTANCE_NUMBER_TOO_SMALL = "INSTANCE_NUMBER_TOO_SMALL";

/** Number is larger than maximum. */
export const INSTANCE_NUMBER_TOO_LARGE = "INSTANCE_NUMBER_TOO_LARGE";

/** Number is not a multiple of the required value. */
export const INSTANCE_NOT_MULTIPLE_OF = "INSTANCE_NOT_MULTIPLE_OF";

/** Array is shorter than minimum length. */
export const INSTANCE_ARRAY_TOO_SHORT = "INSTANCE_ARRAY_TOO_SHORT";

/** Array is longer than maximum length. */
export const INSTANCE_ARRAY_TOO_LONG = "INSTANCE_ARRAY_TOO_LONG";

/** Object has fewer properties than minimum. */
export const INSTANCE_TOO_FEW_PROPERTIES = "INSTANCE_TOO_FEW_PROPERTIES";

/** Object has more properties than maximum. */
export const INSTANCE_TOO_MANY_PROPERTIES = "INSTANCE_TOO_MANY_PROPERTIES";

// #endregion

/**
 * All error codes as an object for easy access.
 */
export const ErrorCodes = {
  // Schema errors
  SCHEMA_NULL,
  SCHEMA_INVALID_TYPE,
  SCHEMA_MAX_DEPTH_EXCEEDED,
  SCHEMA_KEYWORD_INVALID_TYPE,
  SCHEMA_KEYWORD_EMPTY,
  SCHEMA_TYPE_INVALID,
  SCHEMA_TYPE_ARRAY_EMPTY,
  SCHEMA_TYPE_OBJECT_MISSING_REF,
  SCHEMA_REF_NOT_FOUND,
  SCHEMA_REF_CIRCULAR,
  SCHEMA_REF_NOT_IN_TYPE,
  SCHEMA_REF_INVALID,
  SCHEMA_MISSING_TYPE,
  SCHEMA_ROOT_MISSING_TYPE,
  SCHEMA_ROOT_MISSING_ID,
  SCHEMA_ROOT_MISSING_NAME,
  SCHEMA_UNKNOWN_KEYWORD,
  SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED,
  SCHEMA_NAME_INVALID,
  SCHEMA_CONSTRAINT_INVALID_FOR_TYPE,
  SCHEMA_CONSTRAINT_TYPE_MISMATCH,
  SCHEMA_MIN_GREATER_THAN_MAX,
  SCHEMA_PROPERTIES_NOT_OBJECT,
  SCHEMA_REQUIRED_NOT_ARRAY,
  SCHEMA_REQUIRED_ITEM_NOT_STRING,
  SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED,
  SCHEMA_ADDITIONAL_PROPERTIES_INVALID,
  SCHEMA_ARRAY_MISSING_ITEMS,
  SCHEMA_TUPLE_MISSING_DEFINITION,
  SCHEMA_TUPLE_ORDER_NOT_ARRAY,
  SCHEMA_MAP_MISSING_VALUES,
  SCHEMA_CHOICE_MISSING_CHOICES,
  SCHEMA_CHOICES_NOT_OBJECT,
  SCHEMA_PATTERN_INVALID,
  SCHEMA_PATTERN_NOT_STRING,
  SCHEMA_ENUM_NOT_ARRAY,
  SCHEMA_ENUM_EMPTY,
  SCHEMA_ENUM_DUPLICATES,
  SCHEMA_COMPOSITION_EMPTY,
  SCHEMA_COMPOSITION_NOT_ARRAY,
  SCHEMA_ALTNAMES_NOT_OBJECT,
  SCHEMA_ALTNAMES_VALUE_NOT_STRING,
  SCHEMA_INTEGER_CONSTRAINT_INVALID,
  SCHEMA_NUMBER_CONSTRAINT_INVALID,
  SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID,
  SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN,
  SCHEMA_ITEMS_INVALID_FOR_TUPLE,
  SCHEMA_TUPLE_MISSING_ORDER,
  SCHEMA_TUPLE_PROPERTY_NOT_DEFINED,
  SCHEMA_ENUM_DUPLICATE_VALUE,
  SCHEMA_CONSTRAINT_VALUE_INVALID,
  SCHEMA_CONSTRAINT_RANGE_INVALID,

  // Instance errors
  INSTANCE_ROOT_UNRESOLVED,
  INSTANCE_MAX_DEPTH_EXCEEDED,
  INSTANCE_SCHEMA_FALSE,
  INSTANCE_REF_UNRESOLVED,
  INSTANCE_CONST_MISMATCH,
  INSTANCE_ENUM_MISMATCH,
  INSTANCE_ANY_OF_NONE_MATCHED,
  INSTANCE_ONE_OF_INVALID_COUNT,
  INSTANCE_NOT_MATCHED,
  INSTANCE_TYPE_UNKNOWN,
  INSTANCE_TYPE_MISMATCH,
  INSTANCE_NULL_EXPECTED,
  INSTANCE_BOOLEAN_EXPECTED,
  INSTANCE_STRING_EXPECTED,
  INSTANCE_STRING_MIN_LENGTH,
  INSTANCE_STRING_MAX_LENGTH,
  INSTANCE_STRING_PATTERN_MISMATCH,
  INSTANCE_PATTERN_INVALID,
  INSTANCE_FORMAT_EMAIL_INVALID,
  INSTANCE_FORMAT_URI_INVALID,
  INSTANCE_FORMAT_URI_REFERENCE_INVALID,
  INSTANCE_FORMAT_DATE_INVALID,
  INSTANCE_FORMAT_TIME_INVALID,
  INSTANCE_FORMAT_DATETIME_INVALID,
  INSTANCE_FORMAT_UUID_INVALID,
  INSTANCE_FORMAT_IPV4_INVALID,
  INSTANCE_FORMAT_IPV6_INVALID,
  INSTANCE_FORMAT_HOSTNAME_INVALID,
  INSTANCE_NUMBER_EXPECTED,
  INSTANCE_INTEGER_EXPECTED,
  INSTANCE_INT_RANGE_INVALID,
  INSTANCE_NUMBER_MINIMUM,
  INSTANCE_NUMBER_MAXIMUM,
  INSTANCE_NUMBER_EXCLUSIVE_MINIMUM,
  INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM,
  INSTANCE_NUMBER_MULTIPLE_OF,
  INSTANCE_OBJECT_EXPECTED,
  INSTANCE_REQUIRED_PROPERTY_MISSING,
  INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED,
  INSTANCE_MIN_PROPERTIES,
  INSTANCE_MAX_PROPERTIES,
  INSTANCE_DEPENDENT_REQUIRED,
  INSTANCE_ARRAY_EXPECTED,
  INSTANCE_MIN_ITEMS,
  INSTANCE_MAX_ITEMS,
  INSTANCE_MIN_CONTAINS,
  INSTANCE_MAX_CONTAINS,
  INSTANCE_SET_EXPECTED,
  INSTANCE_SET_DUPLICATE,
  INSTANCE_MAP_EXPECTED,
  INSTANCE_MAP_MIN_ENTRIES,
  INSTANCE_MAP_MAX_ENTRIES,
  INSTANCE_MAP_KEY_INVALID,
  INSTANCE_TUPLE_EXPECTED,
  INSTANCE_TUPLE_LENGTH_MISMATCH,
  INSTANCE_TUPLE_ADDITIONAL_ITEMS,
  INSTANCE_CHOICE_EXPECTED,
  INSTANCE_CHOICE_MISSING_CHOICES,
  INSTANCE_CHOICE_SELECTOR_MISSING,
  INSTANCE_CHOICE_SELECTOR_NOT_STRING,
  INSTANCE_CHOICE_UNKNOWN,
  INSTANCE_CHOICE_NO_MATCH,
  INSTANCE_CHOICE_MULTIPLE_MATCHES,
  INSTANCE_DATE_EXPECTED,
  INSTANCE_DATE_FORMAT_INVALID,
  INSTANCE_TIME_EXPECTED,
  INSTANCE_TIME_FORMAT_INVALID,
  INSTANCE_DATETIME_EXPECTED,
  INSTANCE_DATETIME_FORMAT_INVALID,
  INSTANCE_DURATION_EXPECTED,
  INSTANCE_DURATION_FORMAT_INVALID,
  INSTANCE_UUID_EXPECTED,
  INSTANCE_UUID_FORMAT_INVALID,
  INSTANCE_URI_EXPECTED,
  INSTANCE_URI_FORMAT_INVALID,
  INSTANCE_URI_MISSING_SCHEME,
  INSTANCE_BINARY_EXPECTED,
  INSTANCE_BINARY_ENCODING_INVALID,
  INSTANCE_JSONPOINTER_EXPECTED,
  INSTANCE_JSONPOINTER_FORMAT_INVALID,
  INSTANCE_DECIMAL_EXPECTED,
  INSTANCE_STRING_NOT_EXPECTED,
  INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED,
  INSTANCE_SCHEMA_INVALID,
  INSTANCE_ROOT_REF_INVALID,
  INSTANCE_REF_RESOLUTION_FAILED,
  INSTANCE_EXTENDS_RESOLUTION_FAILED,
  INSTANCE_UNION_NO_MATCH,
  INSTANCE_SCHEMA_MISSING_TYPE,
  INSTANCE_ABSTRACT_SCHEMA,
  INSTANCE_FORMAT_INVALID,
  INSTANCE_UNKNOWN_TYPE,
  INSTANCE_VALUE_OUT_OF_RANGE,
  INSTANCE_SET_DUPLICATE_ITEM,
  INSTANCE_CHOICE_INVALID,
  INSTANCE_ANYOF_NO_MATCH,
  INSTANCE_ONEOF_MISMATCH,
  INSTANCE_NOT_FAILED,
  INSTANCE_STRING_TOO_SHORT,
  INSTANCE_STRING_TOO_LONG,
  INSTANCE_PATTERN_MISMATCH,
  INSTANCE_NUMBER_TOO_SMALL,
  INSTANCE_NUMBER_TOO_LARGE,
  INSTANCE_NOT_MULTIPLE_OF,
  INSTANCE_ARRAY_TOO_SHORT,
  INSTANCE_ARRAY_TOO_LONG,
  INSTANCE_TOO_FEW_PROPERTIES,
  INSTANCE_TOO_MANY_PROPERTIES,
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
