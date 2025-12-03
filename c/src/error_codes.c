/**
 * @file error_codes.c
 * @brief Error code string representations
 *
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#include "json_structure/error_codes.h"

/* Schema error messages */
static const char* g_schema_error_messages[] = {
    [JS_SCHEMA_OK] = "Schema is valid",
    [JS_SCHEMA_NULL] = "Schema is null",
    [JS_SCHEMA_INVALID_TYPE] = "Invalid schema type",
    [JS_SCHEMA_MAX_DEPTH_EXCEEDED] = "Maximum schema nesting depth exceeded",
    [JS_SCHEMA_ROOT_MISSING_ID] = "Root schema missing '$id' property",
    [JS_SCHEMA_ROOT_MISSING_NAME] = "Root schema missing 'name' property",
    [JS_SCHEMA_ROOT_MISSING_SCHEMA] = "Root schema missing '$schema' property",
    [JS_SCHEMA_ROOT_MISSING_TYPE] = "Root schema missing 'type' property",
    
    [JS_SCHEMA_TYPE_INVALID] = "Invalid type value",
    [JS_SCHEMA_TYPE_NOT_STRING] = "Type must be a string",
    [JS_SCHEMA_TYPE_ARRAY_EMPTY] = "Type array cannot be empty",
    [JS_SCHEMA_TYPE_OBJECT_MISSING_REF] = "Object type reference is missing",
    
    [JS_SCHEMA_REF_NOT_FOUND] = "Referenced schema not found",
    [JS_SCHEMA_REF_NOT_STRING] = "$ref must be a string",
    [JS_SCHEMA_REF_CIRCULAR] = "Circular reference detected",
    [JS_SCHEMA_REF_INVALID] = "Invalid reference format",
    
    [JS_SCHEMA_DEFINITIONS_MUST_BE_OBJECT] = "definitions must be an object",
    [JS_SCHEMA_DEFINITION_MISSING_TYPE] = "Definition missing type",
    [JS_SCHEMA_DEFINITION_INVALID] = "Invalid definition",
    
    [JS_SCHEMA_PROPERTIES_MUST_BE_OBJECT] = "Properties must be an object",
    [JS_SCHEMA_PROPERTY_INVALID] = "Invalid property definition",
    [JS_SCHEMA_REQUIRED_MUST_BE_ARRAY] = "Required must be an array",
    [JS_SCHEMA_REQUIRED_ITEM_MUST_BE_STRING] = "Required items must be strings",
    [JS_SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED] = "Required property not defined in properties",
    [JS_SCHEMA_ADDITIONAL_PROPERTIES_INVALID] = "Invalid additionalProperties value",
    
    [JS_SCHEMA_ARRAY_MISSING_ITEMS] = "Array type missing items definition",
    [JS_SCHEMA_ITEMS_INVALID] = "Invalid items definition",
    
    [JS_SCHEMA_MAP_MISSING_VALUES] = "Map type missing values definition",
    [JS_SCHEMA_VALUES_INVALID] = "Invalid values definition",
    
    [JS_SCHEMA_TUPLE_MISSING_DEFINITION] = "Tuple type missing definition",
    [JS_SCHEMA_TUPLE_MISSING_PROPERTIES] = "Tuple missing properties",
    [JS_SCHEMA_TUPLE_INVALID_FORMAT] = "Invalid tuple format",
    [JS_SCHEMA_TUPLE_PROPERTY_NOT_DEFINED] = "Tuple property not defined",
    
    [JS_SCHEMA_CHOICE_MISSING_CHOICES] = "Choice type missing choices",
    [JS_SCHEMA_CHOICES_NOT_OBJECT] = "Choices must be an object",
    [JS_SCHEMA_CHOICE_INVALID] = "Invalid choice definition",
    [JS_SCHEMA_SELECTOR_NOT_STRING] = "Selector must be a string",
    
    [JS_SCHEMA_ENUM_NOT_ARRAY] = "Enum must be an array",
    [JS_SCHEMA_ENUM_EMPTY] = "Enum cannot be empty",
    [JS_SCHEMA_ENUM_DUPLICATES] = "Enum contains duplicate values",
    [JS_SCHEMA_CONST_INVALID] = "Invalid const value",
    
    [JS_SCHEMA_USES_NOT_ARRAY] = "$uses must be an array",
    [JS_SCHEMA_USES_INVALID_EXTENSION] = "Invalid extension in $uses",
    [JS_SCHEMA_OFFERS_NOT_ARRAY] = "$offers must be an array",
    [JS_SCHEMA_OFFERS_INVALID_EXTENSION] = "Invalid extension in $offers",
    [JS_SCHEMA_EXTENSION_KEYWORD_WITHOUT_USES] = "Extension keyword used without $uses declaration",
    
    [JS_SCHEMA_MIN_MAX_INVALID] = "Invalid minimum/maximum value",
    [JS_SCHEMA_MINLENGTH_INVALID] = "Invalid minLength value",
    [JS_SCHEMA_MAXLENGTH_INVALID] = "Invalid maxLength value",
    [JS_SCHEMA_PATTERN_INVALID] = "Invalid pattern",
    [JS_SCHEMA_FORMAT_INVALID] = "Invalid format",
    [JS_SCHEMA_CONSTRAINT_TYPE_MISMATCH] = "Constraint not applicable to type",
    [JS_SCHEMA_MINIMUM_EXCEEDS_MAXIMUM] = "Minimum exceeds maximum",
    [JS_SCHEMA_MINLENGTH_EXCEEDS_MAXLENGTH] = "minLength exceeds maxLength",
    [JS_SCHEMA_MINLENGTH_NEGATIVE] = "minLength cannot be negative",
    [JS_SCHEMA_MAXLENGTH_NEGATIVE] = "maxLength cannot be negative",
    [JS_SCHEMA_MINITEMS_EXCEEDS_MAXITEMS] = "minItems exceeds maxItems",
    [JS_SCHEMA_MINITEMS_NEGATIVE] = "minItems cannot be negative",
    [JS_SCHEMA_MULTIPLEOF_INVALID] = "multipleOf must be positive",
    [JS_SCHEMA_KEYWORD_INVALID_TYPE] = "Keyword has invalid type",
    
    [JS_SCHEMA_IMPORT_NOT_ALLOWED] = "$import not allowed",
    [JS_SCHEMA_IMPORT_FAILED] = "Failed to import schema",
    [JS_SCHEMA_IMPORT_CIRCULAR] = "Circular import detected",
    
    [JS_SCHEMA_ALLOF_NOT_ARRAY] = "allOf must be an array",
    [JS_SCHEMA_ANYOF_NOT_ARRAY] = "anyOf must be an array",
    [JS_SCHEMA_ONEOF_NOT_ARRAY] = "oneOf must be an array",
    [JS_SCHEMA_NOT_INVALID] = "Invalid not schema",
    [JS_SCHEMA_IF_INVALID] = "Invalid if schema",
    [JS_SCHEMA_THEN_WITHOUT_IF] = "then without if",
    [JS_SCHEMA_ELSE_WITHOUT_IF] = "else without if",
};

/* Instance error messages */
static const char* g_instance_error_messages[] = {
    [JS_INSTANCE_OK] = "Instance is valid",
    
    [JS_INSTANCE_TYPE_MISMATCH] = "Type mismatch",
    [JS_INSTANCE_TYPE_UNKNOWN] = "Unknown type",
    
    [JS_INSTANCE_STRING_EXPECTED] = "Expected string",
    [JS_INSTANCE_STRING_TOO_SHORT] = "String too short",
    [JS_INSTANCE_STRING_TOO_LONG] = "String too long",
    [JS_INSTANCE_STRING_PATTERN_MISMATCH] = "String does not match pattern",
    [JS_INSTANCE_STRING_FORMAT_INVALID] = "Invalid string format",
    
    [JS_INSTANCE_NUMBER_EXPECTED] = "Expected number",
    [JS_INSTANCE_NUMBER_TOO_SMALL] = "Number too small",
    [JS_INSTANCE_NUMBER_TOO_LARGE] = "Number too large",
    [JS_INSTANCE_NUMBER_NOT_MULTIPLE] = "Number not a multiple of required value",
    [JS_INSTANCE_INTEGER_EXPECTED] = "Expected integer",
    [JS_INSTANCE_INTEGER_OUT_OF_RANGE] = "Integer out of range",
    
    [JS_INSTANCE_BOOLEAN_EXPECTED] = "Expected boolean",
    [JS_INSTANCE_NULL_EXPECTED] = "Expected null",
    
    [JS_INSTANCE_OBJECT_EXPECTED] = "Expected object",
    [JS_INSTANCE_REQUIRED_MISSING] = "Required property missing",
    [JS_INSTANCE_ADDITIONAL_PROPERTY] = "Additional property not allowed",
    [JS_INSTANCE_PROPERTY_INVALID] = "Invalid property value",
    [JS_INSTANCE_TOO_FEW_PROPERTIES] = "Too few properties",
    [JS_INSTANCE_TOO_MANY_PROPERTIES] = "Too many properties",
    [JS_INSTANCE_DEPENDENT_REQUIRED_MISSING] = "Dependent required property missing",
    
    [JS_INSTANCE_ARRAY_EXPECTED] = "Expected array",
    [JS_INSTANCE_ARRAY_TOO_SHORT] = "Array too short",
    [JS_INSTANCE_ARRAY_TOO_LONG] = "Array too long",
    [JS_INSTANCE_ARRAY_NOT_UNIQUE] = "Array items not unique",
    [JS_INSTANCE_ARRAY_CONTAINS_MISSING] = "Array does not contain required item",
    [JS_INSTANCE_ARRAY_CONTAINS_TOO_FEW] = "Array contains too few matching items",
    [JS_INSTANCE_ARRAY_CONTAINS_TOO_MANY] = "Array contains too many matching items",
    [JS_INSTANCE_ARRAY_ITEM_INVALID] = "Invalid array item",
    
    [JS_INSTANCE_TUPLE_EXPECTED] = "Expected tuple",
    [JS_INSTANCE_TUPLE_LENGTH_MISMATCH] = "Tuple length mismatch",
    [JS_INSTANCE_TUPLE_ELEMENT_INVALID] = "Invalid tuple element",
    
    [JS_INSTANCE_MAP_EXPECTED] = "Expected map",
    [JS_INSTANCE_MAP_VALUE_INVALID] = "Invalid map value",
    [JS_INSTANCE_MAP_TOO_FEW_ENTRIES] = "Map has too few entries",
    [JS_INSTANCE_MAP_TOO_MANY_ENTRIES] = "Map has too many entries",
    [JS_INSTANCE_MAP_KEY_PATTERN_MISMATCH] = "Map key does not match pattern",
    
    [JS_INSTANCE_SET_EXPECTED] = "Expected set",
    [JS_INSTANCE_SET_NOT_UNIQUE] = "Set items not unique",
    [JS_INSTANCE_SET_ITEM_INVALID] = "Invalid set item",
    
    [JS_INSTANCE_CHOICE_NO_MATCH] = "No matching choice",
    [JS_INSTANCE_CHOICE_MULTIPLE_MATCHES] = "Multiple matching choices",
    [JS_INSTANCE_CHOICE_UNKNOWN] = "Unknown choice",
    [JS_INSTANCE_CHOICE_SELECTOR_MISSING] = "Choice selector missing",
    [JS_INSTANCE_CHOICE_SELECTOR_INVALID] = "Invalid choice selector",
    
    [JS_INSTANCE_ENUM_MISMATCH] = "Value not in enum",
    [JS_INSTANCE_CONST_MISMATCH] = "Value does not match const",
    
    [JS_INSTANCE_DATE_EXPECTED] = "Expected date",
    [JS_INSTANCE_DATE_INVALID] = "Invalid date format",
    [JS_INSTANCE_TIME_EXPECTED] = "Expected time",
    [JS_INSTANCE_TIME_INVALID] = "Invalid time format",
    [JS_INSTANCE_DATETIME_EXPECTED] = "Expected datetime",
    [JS_INSTANCE_DATETIME_INVALID] = "Invalid datetime format",
    [JS_INSTANCE_DURATION_EXPECTED] = "Expected duration",
    [JS_INSTANCE_DURATION_INVALID] = "Invalid duration format",
    
    [JS_INSTANCE_UUID_EXPECTED] = "Expected UUID",
    [JS_INSTANCE_UUID_INVALID] = "Invalid UUID format",
    
    [JS_INSTANCE_URI_EXPECTED] = "Expected URI",
    [JS_INSTANCE_URI_INVALID] = "Invalid URI format",
    
    [JS_INSTANCE_BINARY_EXPECTED] = "Expected binary",
    [JS_INSTANCE_BINARY_INVALID] = "Invalid binary encoding",
    
    [JS_INSTANCE_JSONPOINTER_EXPECTED] = "Expected JSON Pointer",
    [JS_INSTANCE_JSONPOINTER_INVALID] = "Invalid JSON Pointer format",
    
    [JS_INSTANCE_ALLOF_FAILED] = "allOf validation failed",
    [JS_INSTANCE_ANYOF_FAILED] = "anyOf validation failed",
    [JS_INSTANCE_ONEOF_FAILED] = "oneOf validation failed",
    [JS_INSTANCE_ONEOF_MULTIPLE] = "Multiple oneOf schemas matched",
    [JS_INSTANCE_NOT_FAILED] = "not validation failed",
    [JS_INSTANCE_IF_THEN_FAILED] = "if-then validation failed",
    [JS_INSTANCE_IF_ELSE_FAILED] = "if-else validation failed",
    
    [JS_INSTANCE_REF_NOT_FOUND] = "Referenced schema not found",
    
    [JS_INSTANCE_UNION_NO_MATCH] = "No matching union type",
};

const char* js_schema_error_str(js_schema_error_t code) {
    if (code < 0 || code >= JS_SCHEMA_ERROR_COUNT) {
        return "Unknown error";
    }
    const char* msg = g_schema_error_messages[code];
    return msg ? msg : "Unknown error";
}

const char* js_instance_error_str(js_instance_error_t code) {
    if (code < 0 || code >= JS_INSTANCE_ERROR_COUNT) {
        return "Unknown error";
    }
    const char* msg = g_instance_error_messages[code];
    return msg ? msg : "Unknown error";
}
