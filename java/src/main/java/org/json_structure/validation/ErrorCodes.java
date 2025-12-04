// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

/**
 * Standardized error codes for JSON Structure validation.
 * These codes are consistent across all SDK implementations.
 */
public final class ErrorCodes {
    private ErrorCodes() {
        // Prevent instantiation
    }

    // Schema Validation Errors

    /** Schema cannot be null. */
    public static final String SCHEMA_NULL = "SCHEMA_NULL";
    /** Schema must be a boolean or object. */
    public static final String SCHEMA_INVALID_TYPE = "SCHEMA_INVALID_TYPE";
    /** Maximum validation depth exceeded. */
    public static final String SCHEMA_MAX_DEPTH_EXCEEDED = "SCHEMA_MAX_DEPTH_EXCEEDED";
    /** Keyword has invalid type. */
    public static final String SCHEMA_KEYWORD_INVALID_TYPE = "SCHEMA_KEYWORD_INVALID_TYPE";
    /** Keyword cannot be empty. */
    public static final String SCHEMA_KEYWORD_EMPTY = "SCHEMA_KEYWORD_EMPTY";
    /** Invalid type name. */
    public static final String SCHEMA_TYPE_INVALID = "SCHEMA_TYPE_INVALID";
    /** Type array cannot be empty. */
    public static final String SCHEMA_TYPE_ARRAY_EMPTY = "SCHEMA_TYPE_ARRAY_EMPTY";
    /** Type object must contain $ref. */
    public static final String SCHEMA_TYPE_OBJECT_MISSING_REF = "SCHEMA_TYPE_OBJECT_MISSING_REF";
    /** $ref target does not exist. */
    public static final String SCHEMA_REF_NOT_FOUND = "SCHEMA_REF_NOT_FOUND";
    /** Circular reference detected. */
    public static final String SCHEMA_REF_CIRCULAR = "SCHEMA_REF_CIRCULAR";
    /** Circular $extends reference detected. */
    public static final String SCHEMA_EXTENDS_CIRCULAR = "SCHEMA_EXTENDS_CIRCULAR";
    /** $extends reference not found. */
    public static final String SCHEMA_EXTENDS_NOT_FOUND = "SCHEMA_EXTENDS_NOT_FOUND";
    /** $ref is only permitted inside the 'type' attribute. */
    public static final String SCHEMA_REF_NOT_IN_TYPE = "SCHEMA_REF_NOT_IN_TYPE";
    /** Schema must have a 'type' keyword. */
    public static final String SCHEMA_MISSING_TYPE = "SCHEMA_MISSING_TYPE";
    /** Root schema must have 'type', '$root', or other schema-defining keyword. */
    public static final String SCHEMA_ROOT_MISSING_TYPE = "SCHEMA_ROOT_MISSING_TYPE";
    /** Root schema must have '$id' keyword. */
    public static final String SCHEMA_ROOT_MISSING_ID = "SCHEMA_ROOT_MISSING_ID";
    /** Root schema with 'type' must have 'name' property. */
    public static final String SCHEMA_ROOT_MISSING_NAME = "SCHEMA_ROOT_MISSING_NAME";
    /** Name is not a valid identifier. */
    public static final String SCHEMA_NAME_INVALID = "SCHEMA_NAME_INVALID";
    /** Constraint is not valid for this type. */
    public static final String SCHEMA_CONSTRAINT_INVALID_FOR_TYPE = "SCHEMA_CONSTRAINT_INVALID_FOR_TYPE";
    /** Minimum cannot be greater than maximum. */
    public static final String SCHEMA_MIN_GREATER_THAN_MAX = "SCHEMA_MIN_GREATER_THAN_MAX";
    /** Properties must be an object. */
    public static final String SCHEMA_PROPERTIES_NOT_OBJECT = "SCHEMA_PROPERTIES_NOT_OBJECT";
    /** Required must be an array. */
    public static final String SCHEMA_REQUIRED_NOT_ARRAY = "SCHEMA_REQUIRED_NOT_ARRAY";
    /** Required array items must be strings. */
    public static final String SCHEMA_REQUIRED_ITEM_NOT_STRING = "SCHEMA_REQUIRED_ITEM_NOT_STRING";
    /** Required property is not defined in properties. */
    public static final String SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED = "SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED";
    /** additionalProperties must be a boolean or schema. */
    public static final String SCHEMA_ADDITIONAL_PROPERTIES_INVALID = "SCHEMA_ADDITIONAL_PROPERTIES_INVALID";
    /** Array type requires 'items' schema. */
    public static final String SCHEMA_ARRAY_MISSING_ITEMS = "SCHEMA_ARRAY_MISSING_ITEMS";
    /** Tuple type requires 'properties' and 'tuple' keywords. */
    public static final String SCHEMA_TUPLE_MISSING_DEFINITION = "SCHEMA_TUPLE_MISSING_DEFINITION";
    /** 'tuple' keyword must be an array of property names. */
    public static final String SCHEMA_TUPLE_ORDER_NOT_ARRAY = "SCHEMA_TUPLE_ORDER_NOT_ARRAY";
    /** Map type requires 'values' schema. */
    public static final String SCHEMA_MAP_MISSING_VALUES = "SCHEMA_MAP_MISSING_VALUES";
    /** Choice type requires 'choices' keyword. */
    public static final String SCHEMA_CHOICE_MISSING_CHOICES = "SCHEMA_CHOICE_MISSING_CHOICES";
    /** Choices must be an object. */
    public static final String SCHEMA_CHOICES_NOT_OBJECT = "SCHEMA_CHOICES_NOT_OBJECT";
    /** Pattern is not a valid regular expression. */
    public static final String SCHEMA_PATTERN_INVALID = "SCHEMA_PATTERN_INVALID";
    /** Pattern must be a string. */
    public static final String SCHEMA_PATTERN_NOT_STRING = "SCHEMA_PATTERN_NOT_STRING";
    /** Enum must be an array. */
    public static final String SCHEMA_ENUM_NOT_ARRAY = "SCHEMA_ENUM_NOT_ARRAY";
    /** Enum array cannot be empty. */
    public static final String SCHEMA_ENUM_EMPTY = "SCHEMA_ENUM_EMPTY";
    /** Enum array contains duplicate values. */
    public static final String SCHEMA_ENUM_DUPLICATES = "SCHEMA_ENUM_DUPLICATES";
    /** Composition keyword array cannot be empty. */
    public static final String SCHEMA_COMPOSITION_EMPTY = "SCHEMA_COMPOSITION_EMPTY";
    /** Composition keyword must be an array. */
    public static final String SCHEMA_COMPOSITION_NOT_ARRAY = "SCHEMA_COMPOSITION_NOT_ARRAY";
    /** altnames must be an object. */
    public static final String SCHEMA_ALTNAMES_NOT_OBJECT = "SCHEMA_ALTNAMES_NOT_OBJECT";
    /** altnames values must be strings. */
    public static final String SCHEMA_ALTNAMES_VALUE_NOT_STRING = "SCHEMA_ALTNAMES_VALUE_NOT_STRING";
    /** Keyword must be a non-negative integer. */
    public static final String SCHEMA_INTEGER_CONSTRAINT_INVALID = "SCHEMA_INTEGER_CONSTRAINT_INVALID";
    /** Keyword must be a number. */
    public static final String SCHEMA_NUMBER_CONSTRAINT_INVALID = "SCHEMA_NUMBER_CONSTRAINT_INVALID";
    /** Keyword must be a positive number. */
    public static final String SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID = "SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID";
    /** uniqueItems must be a boolean. */
    public static final String SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN = "SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN";
    /** items must be a boolean or schema for tuple type. */
    public static final String SCHEMA_ITEMS_INVALID_FOR_TUPLE = "SCHEMA_ITEMS_INVALID_FOR_TUPLE";
    /** Validation extension keyword is used but validation extensions are not enabled. */
    public static final String SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED = "SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED";

    // Instance Validation Errors

    /** Unable to resolve $root reference. */
    public static final String INSTANCE_ROOT_UNRESOLVED = "INSTANCE_ROOT_UNRESOLVED";
    /** Maximum validation depth exceeded. */
    public static final String INSTANCE_MAX_DEPTH_EXCEEDED = "INSTANCE_MAX_DEPTH_EXCEEDED";
    /** Schema 'false' rejects all values. */
    public static final String INSTANCE_SCHEMA_FALSE = "INSTANCE_SCHEMA_FALSE";
    /** Unable to resolve reference. */
    public static final String INSTANCE_REF_UNRESOLVED = "INSTANCE_REF_UNRESOLVED";
    /** Value must equal const value. */
    public static final String INSTANCE_CONST_MISMATCH = "INSTANCE_CONST_MISMATCH";
    /** Value must be one of the enum values. */
    public static final String INSTANCE_ENUM_MISMATCH = "INSTANCE_ENUM_MISMATCH";
    /** Value must match at least one schema in anyOf. */
    public static final String INSTANCE_ANY_OF_NONE_MATCHED = "INSTANCE_ANY_OF_NONE_MATCHED";
    /** Value must match exactly one schema in oneOf. */
    public static final String INSTANCE_ONE_OF_INVALID_COUNT = "INSTANCE_ONE_OF_INVALID_COUNT";
    /** Value must not match the schema in 'not'. */
    public static final String INSTANCE_NOT_MATCHED = "INSTANCE_NOT_MATCHED";
    /** Unknown type. */
    public static final String INSTANCE_TYPE_UNKNOWN = "INSTANCE_TYPE_UNKNOWN";
    /** Type mismatch. */
    public static final String INSTANCE_TYPE_MISMATCH = "INSTANCE_TYPE_MISMATCH";
    /** Value must be null. */
    public static final String INSTANCE_NULL_EXPECTED = "INSTANCE_NULL_EXPECTED";
    /** Value must be a boolean. */
    public static final String INSTANCE_BOOLEAN_EXPECTED = "INSTANCE_BOOLEAN_EXPECTED";
    /** Value must be a string. */
    public static final String INSTANCE_STRING_EXPECTED = "INSTANCE_STRING_EXPECTED";
    /** String length is less than minimum. */
    public static final String INSTANCE_STRING_MIN_LENGTH = "INSTANCE_STRING_MIN_LENGTH";
    /** String length exceeds maximum. */
    public static final String INSTANCE_STRING_MAX_LENGTH = "INSTANCE_STRING_MAX_LENGTH";
    /** String does not match pattern. */
    public static final String INSTANCE_STRING_PATTERN_MISMATCH = "INSTANCE_STRING_PATTERN_MISMATCH";
    /** Invalid regex pattern. */
    public static final String INSTANCE_PATTERN_INVALID = "INSTANCE_PATTERN_INVALID";
    /** String is not a valid email address. */
    public static final String INSTANCE_FORMAT_EMAIL_INVALID = "INSTANCE_FORMAT_EMAIL_INVALID";
    /** String is not a valid URI. */
    public static final String INSTANCE_FORMAT_URI_INVALID = "INSTANCE_FORMAT_URI_INVALID";
    /** String is not a valid URI reference. */
    public static final String INSTANCE_FORMAT_URI_REFERENCE_INVALID = "INSTANCE_FORMAT_URI_REFERENCE_INVALID";
    /** String is not a valid date. */
    public static final String INSTANCE_FORMAT_DATE_INVALID = "INSTANCE_FORMAT_DATE_INVALID";
    /** String is not a valid time. */
    public static final String INSTANCE_FORMAT_TIME_INVALID = "INSTANCE_FORMAT_TIME_INVALID";
    /** String is not a valid date-time. */
    public static final String INSTANCE_FORMAT_DATETIME_INVALID = "INSTANCE_FORMAT_DATETIME_INVALID";
    /** String is not a valid UUID. */
    public static final String INSTANCE_FORMAT_UUID_INVALID = "INSTANCE_FORMAT_UUID_INVALID";
    /** String is not a valid IPv4 address. */
    public static final String INSTANCE_FORMAT_IPV4_INVALID = "INSTANCE_FORMAT_IPV4_INVALID";
    /** String is not a valid IPv6 address. */
    public static final String INSTANCE_FORMAT_IPV6_INVALID = "INSTANCE_FORMAT_IPV6_INVALID";
    /** String is not a valid hostname. */
    public static final String INSTANCE_FORMAT_HOSTNAME_INVALID = "INSTANCE_FORMAT_HOSTNAME_INVALID";
    /** Value must be a number. */
    public static final String INSTANCE_NUMBER_EXPECTED = "INSTANCE_NUMBER_EXPECTED";
    /** Value must be an integer. */
    public static final String INSTANCE_INTEGER_EXPECTED = "INSTANCE_INTEGER_EXPECTED";
    /** Integer value is out of range. */
    public static final String INSTANCE_INT_RANGE_INVALID = "INSTANCE_INT_RANGE_INVALID";
    /** Value is less than minimum. */
    public static final String INSTANCE_NUMBER_MINIMUM = "INSTANCE_NUMBER_MINIMUM";
    /** Value exceeds maximum. */
    public static final String INSTANCE_NUMBER_MAXIMUM = "INSTANCE_NUMBER_MAXIMUM";
    /** Value must be greater than exclusive minimum. */
    public static final String INSTANCE_NUMBER_EXCLUSIVE_MINIMUM = "INSTANCE_NUMBER_EXCLUSIVE_MINIMUM";
    /** Value must be less than exclusive maximum. */
    public static final String INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM = "INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM";
    /** Value is not a multiple of the specified value. */
    public static final String INSTANCE_NUMBER_MULTIPLE_OF = "INSTANCE_NUMBER_MULTIPLE_OF";
    /** Value must be an object. */
    public static final String INSTANCE_OBJECT_EXPECTED = "INSTANCE_OBJECT_EXPECTED";
    /** Missing required property. */
    public static final String INSTANCE_REQUIRED_PROPERTY_MISSING = "INSTANCE_REQUIRED_PROPERTY_MISSING";
    /** Additional property not allowed. */
    public static final String INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED = "INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED";
    /** Object has fewer properties than minimum. */
    public static final String INSTANCE_MIN_PROPERTIES = "INSTANCE_MIN_PROPERTIES";
    /** Object has more properties than maximum. */
    public static final String INSTANCE_MAX_PROPERTIES = "INSTANCE_MAX_PROPERTIES";
    /** Dependent required property is missing. */
    public static final String INSTANCE_DEPENDENT_REQUIRED = "INSTANCE_DEPENDENT_REQUIRED";
    /** Value must be an array. */
    public static final String INSTANCE_ARRAY_EXPECTED = "INSTANCE_ARRAY_EXPECTED";
    /** Array has fewer items than minimum. */
    public static final String INSTANCE_MIN_ITEMS = "INSTANCE_MIN_ITEMS";
    /** Array has more items than maximum. */
    public static final String INSTANCE_MAX_ITEMS = "INSTANCE_MAX_ITEMS";
    /** Array has fewer matching items than minContains. */
    public static final String INSTANCE_MIN_CONTAINS = "INSTANCE_MIN_CONTAINS";
    /** Array has more matching items than maxContains. */
    public static final String INSTANCE_MAX_CONTAINS = "INSTANCE_MAX_CONTAINS";
    /** Value must be an array (set). */
    public static final String INSTANCE_SET_EXPECTED = "INSTANCE_SET_EXPECTED";
    /** Set contains duplicate value. */
    public static final String INSTANCE_SET_DUPLICATE = "INSTANCE_SET_DUPLICATE";
    /** Value must be an object (map). */
    public static final String INSTANCE_MAP_EXPECTED = "INSTANCE_MAP_EXPECTED";
    /** Map has fewer entries than minimum. */
    public static final String INSTANCE_MAP_MIN_ENTRIES = "INSTANCE_MAP_MIN_ENTRIES";
    /** Map has more entries than maximum. */
    public static final String INSTANCE_MAP_MAX_ENTRIES = "INSTANCE_MAP_MAX_ENTRIES";
    /** Map key does not match keyNames or patternKeys constraint. */
    public static final String INSTANCE_MAP_KEY_INVALID = "INSTANCE_MAP_KEY_INVALID";
    /** Value must be an array (tuple). */
    public static final String INSTANCE_TUPLE_EXPECTED = "INSTANCE_TUPLE_EXPECTED";
    /** Tuple length does not match schema. */
    public static final String INSTANCE_TUPLE_LENGTH_MISMATCH = "INSTANCE_TUPLE_LENGTH_MISMATCH";
    /** Tuple has additional items not defined in schema. */
    public static final String INSTANCE_TUPLE_ADDITIONAL_ITEMS = "INSTANCE_TUPLE_ADDITIONAL_ITEMS";
    /** Value must be an object (choice). */
    public static final String INSTANCE_CHOICE_EXPECTED = "INSTANCE_CHOICE_EXPECTED";
    /** Choice schema is missing choices. */
    public static final String INSTANCE_CHOICE_MISSING_CHOICES = "INSTANCE_CHOICE_MISSING_CHOICES";
    /** Choice selector property is missing. */
    public static final String INSTANCE_CHOICE_SELECTOR_MISSING = "INSTANCE_CHOICE_SELECTOR_MISSING";
    /** Selector value must be a string. */
    public static final String INSTANCE_CHOICE_SELECTOR_NOT_STRING = "INSTANCE_CHOICE_SELECTOR_NOT_STRING";
    /** Unknown choice. */
    public static final String INSTANCE_CHOICE_UNKNOWN = "INSTANCE_CHOICE_UNKNOWN";
    /** Value does not match any choice option. */
    public static final String INSTANCE_CHOICE_NO_MATCH = "INSTANCE_CHOICE_NO_MATCH";
    /** Value matches multiple choice options. */
    public static final String INSTANCE_CHOICE_MULTIPLE_MATCHES = "INSTANCE_CHOICE_MULTIPLE_MATCHES";
    /** Date must be a string. */
    public static final String INSTANCE_DATE_EXPECTED = "INSTANCE_DATE_EXPECTED";
    /** Invalid date format. */
    public static final String INSTANCE_DATE_FORMAT_INVALID = "INSTANCE_DATE_FORMAT_INVALID";
    /** Time must be a string. */
    public static final String INSTANCE_TIME_EXPECTED = "INSTANCE_TIME_EXPECTED";
    /** Invalid time format. */
    public static final String INSTANCE_TIME_FORMAT_INVALID = "INSTANCE_TIME_FORMAT_INVALID";
    /** DateTime must be a string. */
    public static final String INSTANCE_DATETIME_EXPECTED = "INSTANCE_DATETIME_EXPECTED";
    /** Invalid datetime format. */
    public static final String INSTANCE_DATETIME_FORMAT_INVALID = "INSTANCE_DATETIME_FORMAT_INVALID";
    /** Duration must be a string. */
    public static final String INSTANCE_DURATION_EXPECTED = "INSTANCE_DURATION_EXPECTED";
    /** Invalid duration format. */
    public static final String INSTANCE_DURATION_FORMAT_INVALID = "INSTANCE_DURATION_FORMAT_INVALID";
    /** UUID must be a string. */
    public static final String INSTANCE_UUID_EXPECTED = "INSTANCE_UUID_EXPECTED";
    /** Invalid UUID format. */
    public static final String INSTANCE_UUID_FORMAT_INVALID = "INSTANCE_UUID_FORMAT_INVALID";
    /** URI must be a string. */
    public static final String INSTANCE_URI_EXPECTED = "INSTANCE_URI_EXPECTED";
    /** Invalid URI format. */
    public static final String INSTANCE_URI_FORMAT_INVALID = "INSTANCE_URI_FORMAT_INVALID";
    /** URI must have a scheme. */
    public static final String INSTANCE_URI_MISSING_SCHEME = "INSTANCE_URI_MISSING_SCHEME";
    /** Binary must be a base64 string. */
    public static final String INSTANCE_BINARY_EXPECTED = "INSTANCE_BINARY_EXPECTED";
    /** Invalid base64 encoding. */
    public static final String INSTANCE_BINARY_ENCODING_INVALID = "INSTANCE_BINARY_ENCODING_INVALID";
    /** JSON Pointer must be a string. */
    public static final String INSTANCE_JSONPOINTER_EXPECTED = "INSTANCE_JSONPOINTER_EXPECTED";
    /** Invalid JSON Pointer format. */
    public static final String INSTANCE_JSONPOINTER_FORMAT_INVALID = "INSTANCE_JSONPOINTER_FORMAT_INVALID";
    /** Value must be a valid decimal. */
    public static final String INSTANCE_DECIMAL_EXPECTED = "INSTANCE_DECIMAL_EXPECTED";
    /** String value not expected for this type. */
    public static final String INSTANCE_STRING_NOT_EXPECTED = "INSTANCE_STRING_NOT_EXPECTED";
    /** Custom type reference not yet supported. */
    public static final String INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED = "INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED";
}
