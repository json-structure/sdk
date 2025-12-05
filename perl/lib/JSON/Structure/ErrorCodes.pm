package JSON::Structure::ErrorCodes;

use strict;
use warnings;
use v5.20;

our $VERSION = '0.01';

use Exporter 'import';

=head1 NAME

JSON::Structure::ErrorCodes - Standardized error codes for JSON Structure validation

=head1 DESCRIPTION

This module defines standardized error codes for JSON Structure validation.
These codes are consistent across all SDK implementations.

=cut

# Schema Validation Errors
use constant SCHEMA_NULL                       => 'SCHEMA_NULL';
use constant SCHEMA_INVALID_TYPE               => 'SCHEMA_INVALID_TYPE';
use constant SCHEMA_MAX_DEPTH_EXCEEDED         => 'SCHEMA_MAX_DEPTH_EXCEEDED';
use constant SCHEMA_KEYWORD_INVALID_TYPE       => 'SCHEMA_KEYWORD_INVALID_TYPE';
use constant SCHEMA_KEYWORD_EMPTY              => 'SCHEMA_KEYWORD_EMPTY';
use constant SCHEMA_TYPE_INVALID               => 'SCHEMA_TYPE_INVALID';
use constant SCHEMA_TYPE_ARRAY_EMPTY           => 'SCHEMA_TYPE_ARRAY_EMPTY';
use constant SCHEMA_TYPE_OBJECT_MISSING_REF    => 'SCHEMA_TYPE_OBJECT_MISSING_REF';
use constant SCHEMA_REF_NOT_FOUND              => 'SCHEMA_REF_NOT_FOUND';
use constant SCHEMA_REF_CIRCULAR               => 'SCHEMA_REF_CIRCULAR';
use constant SCHEMA_REF_NOT_IN_TYPE            => 'SCHEMA_REF_NOT_IN_TYPE';
use constant SCHEMA_MISSING_TYPE               => 'SCHEMA_MISSING_TYPE';
use constant SCHEMA_ROOT_MISSING_TYPE          => 'SCHEMA_ROOT_MISSING_TYPE';
use constant SCHEMA_ROOT_MISSING_ID            => 'SCHEMA_ROOT_MISSING_ID';
use constant SCHEMA_ROOT_MISSING_NAME          => 'SCHEMA_ROOT_MISSING_NAME';
use constant SCHEMA_ROOT_CONFLICT              => 'SCHEMA_ROOT_CONFLICT';
use constant SCHEMA_NAME_INVALID               => 'SCHEMA_NAME_INVALID';
use constant SCHEMA_CONSTRAINT_INVALID_FOR_TYPE => 'SCHEMA_CONSTRAINT_INVALID_FOR_TYPE';
use constant SCHEMA_MIN_GREATER_THAN_MAX       => 'SCHEMA_MIN_GREATER_THAN_MAX';
use constant SCHEMA_PROPERTIES_NOT_OBJECT      => 'SCHEMA_PROPERTIES_NOT_OBJECT';
use constant SCHEMA_REQUIRED_NOT_ARRAY         => 'SCHEMA_REQUIRED_NOT_ARRAY';
use constant SCHEMA_REQUIRED_ITEM_NOT_STRING   => 'SCHEMA_REQUIRED_ITEM_NOT_STRING';
use constant SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED => 'SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED';
use constant SCHEMA_ADDITIONAL_PROPERTIES_INVALID => 'SCHEMA_ADDITIONAL_PROPERTIES_INVALID';
use constant SCHEMA_ARRAY_MISSING_ITEMS        => 'SCHEMA_ARRAY_MISSING_ITEMS';
use constant SCHEMA_TUPLE_MISSING_DEFINITION   => 'SCHEMA_TUPLE_MISSING_DEFINITION';
use constant SCHEMA_TUPLE_ORDER_NOT_ARRAY      => 'SCHEMA_TUPLE_ORDER_NOT_ARRAY';
use constant SCHEMA_MAP_MISSING_VALUES         => 'SCHEMA_MAP_MISSING_VALUES';
use constant SCHEMA_CHOICE_MISSING_CHOICES     => 'SCHEMA_CHOICE_MISSING_CHOICES';
use constant SCHEMA_CHOICES_NOT_OBJECT         => 'SCHEMA_CHOICES_NOT_OBJECT';
use constant SCHEMA_PATTERN_INVALID            => 'SCHEMA_PATTERN_INVALID';
use constant SCHEMA_PATTERN_NOT_STRING         => 'SCHEMA_PATTERN_NOT_STRING';
use constant SCHEMA_ENUM_NOT_ARRAY             => 'SCHEMA_ENUM_NOT_ARRAY';
use constant SCHEMA_ENUM_EMPTY                 => 'SCHEMA_ENUM_EMPTY';
use constant SCHEMA_ENUM_DUPLICATES            => 'SCHEMA_ENUM_DUPLICATES';
use constant SCHEMA_COMPOSITION_EMPTY          => 'SCHEMA_COMPOSITION_EMPTY';
use constant SCHEMA_COMPOSITION_NOT_ARRAY      => 'SCHEMA_COMPOSITION_NOT_ARRAY';
use constant SCHEMA_ALTNAMES_NOT_OBJECT        => 'SCHEMA_ALTNAMES_NOT_OBJECT';
use constant SCHEMA_ALTNAMES_VALUE_NOT_STRING  => 'SCHEMA_ALTNAMES_VALUE_NOT_STRING';
use constant SCHEMA_INTEGER_CONSTRAINT_INVALID => 'SCHEMA_INTEGER_CONSTRAINT_INVALID';
use constant SCHEMA_NUMBER_CONSTRAINT_INVALID  => 'SCHEMA_NUMBER_CONSTRAINT_INVALID';
use constant SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID => 'SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID';
use constant SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN   => 'SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN';
use constant SCHEMA_ITEMS_INVALID_FOR_TUPLE    => 'SCHEMA_ITEMS_INVALID_FOR_TUPLE';
use constant SCHEMA_USES_UNKNOWN_EXTENSION     => 'SCHEMA_USES_UNKNOWN_EXTENSION';
use constant SCHEMA_EXTENDS_CIRCULAR           => 'SCHEMA_EXTENDS_CIRCULAR';
use constant SCHEMA_EXTENDS_NOT_FOUND          => 'SCHEMA_EXTENDS_NOT_FOUND';
use constant SCHEMA_REF_INVALID                => 'SCHEMA_REF_INVALID';
use constant SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED => 'SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED';
use constant SCHEMA_MIN_ITEMS_NEGATIVE         => 'SCHEMA_MIN_ITEMS_NEGATIVE';
use constant SCHEMA_MIN_LENGTH_NEGATIVE        => 'SCHEMA_MIN_LENGTH_NEGATIVE';
use constant SCHEMA_MULTIPLE_OF_NOT_POSITIVE   => 'SCHEMA_MULTIPLE_OF_NOT_POSITIVE';
use constant SCHEMA_CONSTRAINT_TYPE_MISMATCH   => 'SCHEMA_CONSTRAINT_TYPE_MISMATCH';
use constant SCHEMA_CIRCULAR_REF               => 'SCHEMA_CIRCULAR_REF';

# Instance Validation Errors
use constant INSTANCE_ROOT_UNRESOLVED          => 'INSTANCE_ROOT_UNRESOLVED';
use constant INSTANCE_MAX_DEPTH_EXCEEDED       => 'INSTANCE_MAX_DEPTH_EXCEEDED';
use constant INSTANCE_SCHEMA_FALSE             => 'INSTANCE_SCHEMA_FALSE';
use constant INSTANCE_REF_UNRESOLVED           => 'INSTANCE_REF_UNRESOLVED';
use constant INSTANCE_CONST_MISMATCH           => 'INSTANCE_CONST_MISMATCH';
use constant INSTANCE_ENUM_MISMATCH            => 'INSTANCE_ENUM_MISMATCH';
use constant INSTANCE_ANY_OF_NONE_MATCHED      => 'INSTANCE_ANY_OF_NONE_MATCHED';
use constant INSTANCE_ONE_OF_INVALID_COUNT     => 'INSTANCE_ONE_OF_INVALID_COUNT';
use constant INSTANCE_NOT_MATCHED              => 'INSTANCE_NOT_MATCHED';
use constant INSTANCE_TYPE_UNKNOWN             => 'INSTANCE_TYPE_UNKNOWN';
use constant INSTANCE_TYPE_MISMATCH            => 'INSTANCE_TYPE_MISMATCH';
use constant INSTANCE_NULL_EXPECTED            => 'INSTANCE_NULL_EXPECTED';
use constant INSTANCE_BOOLEAN_EXPECTED         => 'INSTANCE_BOOLEAN_EXPECTED';
use constant INSTANCE_STRING_EXPECTED          => 'INSTANCE_STRING_EXPECTED';
use constant INSTANCE_STRING_MIN_LENGTH        => 'INSTANCE_STRING_MIN_LENGTH';
use constant INSTANCE_STRING_MAX_LENGTH        => 'INSTANCE_STRING_MAX_LENGTH';
use constant INSTANCE_STRING_PATTERN_MISMATCH  => 'INSTANCE_STRING_PATTERN_MISMATCH';
use constant INSTANCE_PATTERN_INVALID          => 'INSTANCE_PATTERN_INVALID';
use constant INSTANCE_FORMAT_EMAIL_INVALID     => 'INSTANCE_FORMAT_EMAIL_INVALID';
use constant INSTANCE_FORMAT_URI_INVALID       => 'INSTANCE_FORMAT_URI_INVALID';
use constant INSTANCE_FORMAT_URI_REFERENCE_INVALID => 'INSTANCE_FORMAT_URI_REFERENCE_INVALID';
use constant INSTANCE_FORMAT_DATE_INVALID      => 'INSTANCE_FORMAT_DATE_INVALID';
use constant INSTANCE_FORMAT_TIME_INVALID      => 'INSTANCE_FORMAT_TIME_INVALID';
use constant INSTANCE_FORMAT_DATETIME_INVALID  => 'INSTANCE_FORMAT_DATETIME_INVALID';
use constant INSTANCE_FORMAT_UUID_INVALID      => 'INSTANCE_FORMAT_UUID_INVALID';
use constant INSTANCE_FORMAT_IPV4_INVALID      => 'INSTANCE_FORMAT_IPV4_INVALID';
use constant INSTANCE_FORMAT_IPV6_INVALID      => 'INSTANCE_FORMAT_IPV6_INVALID';
use constant INSTANCE_FORMAT_HOSTNAME_INVALID  => 'INSTANCE_FORMAT_HOSTNAME_INVALID';
use constant INSTANCE_NUMBER_EXPECTED          => 'INSTANCE_NUMBER_EXPECTED';
use constant INSTANCE_INTEGER_EXPECTED         => 'INSTANCE_INTEGER_EXPECTED';
use constant INSTANCE_INT_RANGE_INVALID        => 'INSTANCE_INT_RANGE_INVALID';
use constant INSTANCE_NUMBER_MINIMUM           => 'INSTANCE_NUMBER_MINIMUM';
use constant INSTANCE_NUMBER_MAXIMUM           => 'INSTANCE_NUMBER_MAXIMUM';
use constant INSTANCE_NUMBER_EXCLUSIVE_MINIMUM => 'INSTANCE_NUMBER_EXCLUSIVE_MINIMUM';
use constant INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM => 'INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM';
use constant INSTANCE_NUMBER_MULTIPLE_OF       => 'INSTANCE_NUMBER_MULTIPLE_OF';
use constant INSTANCE_OBJECT_EXPECTED          => 'INSTANCE_OBJECT_EXPECTED';
use constant INSTANCE_REQUIRED_PROPERTY_MISSING => 'INSTANCE_REQUIRED_PROPERTY_MISSING';
use constant INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED => 'INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED';
use constant INSTANCE_MIN_PROPERTIES           => 'INSTANCE_MIN_PROPERTIES';
use constant INSTANCE_MAX_PROPERTIES           => 'INSTANCE_MAX_PROPERTIES';
use constant INSTANCE_DEPENDENT_REQUIRED       => 'INSTANCE_DEPENDENT_REQUIRED';
use constant INSTANCE_ARRAY_EXPECTED           => 'INSTANCE_ARRAY_EXPECTED';
use constant INSTANCE_MIN_ITEMS                => 'INSTANCE_MIN_ITEMS';
use constant INSTANCE_MAX_ITEMS                => 'INSTANCE_MAX_ITEMS';
use constant INSTANCE_MIN_CONTAINS             => 'INSTANCE_MIN_CONTAINS';
use constant INSTANCE_MAX_CONTAINS             => 'INSTANCE_MAX_CONTAINS';
use constant INSTANCE_SET_EXPECTED             => 'INSTANCE_SET_EXPECTED';
use constant INSTANCE_SET_DUPLICATE            => 'INSTANCE_SET_DUPLICATE';
use constant INSTANCE_MAP_EXPECTED             => 'INSTANCE_MAP_EXPECTED';
use constant INSTANCE_MAP_MIN_ENTRIES          => 'INSTANCE_MAP_MIN_ENTRIES';
use constant INSTANCE_MAP_MAX_ENTRIES          => 'INSTANCE_MAP_MAX_ENTRIES';
use constant INSTANCE_MAP_KEY_INVALID          => 'INSTANCE_MAP_KEY_INVALID';
use constant INSTANCE_MAP_KEY_PATTERN_MISMATCH => 'INSTANCE_MAP_KEY_PATTERN_MISMATCH';
use constant INSTANCE_TUPLE_EXPECTED           => 'INSTANCE_TUPLE_EXPECTED';
use constant INSTANCE_TUPLE_LENGTH_MISMATCH    => 'INSTANCE_TUPLE_LENGTH_MISMATCH';
use constant INSTANCE_TUPLE_ADDITIONAL_ITEMS   => 'INSTANCE_TUPLE_ADDITIONAL_ITEMS';
use constant INSTANCE_CHOICE_EXPECTED          => 'INSTANCE_CHOICE_EXPECTED';
use constant INSTANCE_CHOICE_MISSING_CHOICES   => 'INSTANCE_CHOICE_MISSING_CHOICES';
use constant INSTANCE_CHOICE_SELECTOR_MISSING  => 'INSTANCE_CHOICE_SELECTOR_MISSING';
use constant INSTANCE_CHOICE_SELECTOR_NOT_STRING => 'INSTANCE_CHOICE_SELECTOR_NOT_STRING';
use constant INSTANCE_CHOICE_UNKNOWN           => 'INSTANCE_CHOICE_UNKNOWN';
use constant INSTANCE_CHOICE_NO_MATCH          => 'INSTANCE_CHOICE_NO_MATCH';
use constant INSTANCE_CHOICE_MULTIPLE_MATCHES  => 'INSTANCE_CHOICE_MULTIPLE_MATCHES';
use constant INSTANCE_DATE_EXPECTED            => 'INSTANCE_DATE_EXPECTED';
use constant INSTANCE_DATE_FORMAT_INVALID      => 'INSTANCE_DATE_FORMAT_INVALID';
use constant INSTANCE_TIME_EXPECTED            => 'INSTANCE_TIME_EXPECTED';
use constant INSTANCE_TIME_FORMAT_INVALID      => 'INSTANCE_TIME_FORMAT_INVALID';
use constant INSTANCE_DATETIME_EXPECTED        => 'INSTANCE_DATETIME_EXPECTED';
use constant INSTANCE_DATETIME_FORMAT_INVALID  => 'INSTANCE_DATETIME_FORMAT_INVALID';
use constant INSTANCE_DURATION_EXPECTED        => 'INSTANCE_DURATION_EXPECTED';
use constant INSTANCE_DURATION_FORMAT_INVALID  => 'INSTANCE_DURATION_FORMAT_INVALID';
use constant INSTANCE_UUID_EXPECTED            => 'INSTANCE_UUID_EXPECTED';
use constant INSTANCE_UUID_FORMAT_INVALID      => 'INSTANCE_UUID_FORMAT_INVALID';
use constant INSTANCE_URI_EXPECTED             => 'INSTANCE_URI_EXPECTED';
use constant INSTANCE_URI_FORMAT_INVALID       => 'INSTANCE_URI_FORMAT_INVALID';
use constant INSTANCE_URI_MISSING_SCHEME       => 'INSTANCE_URI_MISSING_SCHEME';
use constant INSTANCE_BINARY_EXPECTED          => 'INSTANCE_BINARY_EXPECTED';
use constant INSTANCE_BINARY_ENCODING_INVALID  => 'INSTANCE_BINARY_ENCODING_INVALID';
use constant INSTANCE_JSONPOINTER_EXPECTED     => 'INSTANCE_JSONPOINTER_EXPECTED';
use constant INSTANCE_JSONPOINTER_FORMAT_INVALID => 'INSTANCE_JSONPOINTER_FORMAT_INVALID';
use constant INSTANCE_DECIMAL_EXPECTED         => 'INSTANCE_DECIMAL_EXPECTED';
use constant INSTANCE_STRING_NOT_EXPECTED      => 'INSTANCE_STRING_NOT_EXPECTED';
use constant INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED => 'INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED';

# Export all error codes
our @EXPORT_OK = qw(
    SCHEMA_NULL
    SCHEMA_INVALID_TYPE
    SCHEMA_MAX_DEPTH_EXCEEDED
    SCHEMA_KEYWORD_INVALID_TYPE
    SCHEMA_KEYWORD_EMPTY
    SCHEMA_TYPE_INVALID
    SCHEMA_TYPE_ARRAY_EMPTY
    SCHEMA_TYPE_OBJECT_MISSING_REF
    SCHEMA_REF_NOT_FOUND
    SCHEMA_REF_CIRCULAR
    SCHEMA_REF_NOT_IN_TYPE
    SCHEMA_MISSING_TYPE
    SCHEMA_ROOT_MISSING_TYPE
    SCHEMA_ROOT_MISSING_ID
    SCHEMA_ROOT_MISSING_NAME
    SCHEMA_ROOT_CONFLICT
    SCHEMA_NAME_INVALID
    SCHEMA_CONSTRAINT_INVALID_FOR_TYPE
    SCHEMA_MIN_GREATER_THAN_MAX
    SCHEMA_PROPERTIES_NOT_OBJECT
    SCHEMA_REQUIRED_NOT_ARRAY
    SCHEMA_REQUIRED_ITEM_NOT_STRING
    SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED
    SCHEMA_ADDITIONAL_PROPERTIES_INVALID
    SCHEMA_ARRAY_MISSING_ITEMS
    SCHEMA_TUPLE_MISSING_DEFINITION
    SCHEMA_TUPLE_ORDER_NOT_ARRAY
    SCHEMA_MAP_MISSING_VALUES
    SCHEMA_CHOICE_MISSING_CHOICES
    SCHEMA_CHOICES_NOT_OBJECT
    SCHEMA_PATTERN_INVALID
    SCHEMA_PATTERN_NOT_STRING
    SCHEMA_ENUM_NOT_ARRAY
    SCHEMA_ENUM_EMPTY
    SCHEMA_ENUM_DUPLICATES
    SCHEMA_COMPOSITION_EMPTY
    SCHEMA_COMPOSITION_NOT_ARRAY
    SCHEMA_ALTNAMES_NOT_OBJECT
    SCHEMA_ALTNAMES_VALUE_NOT_STRING
    SCHEMA_INTEGER_CONSTRAINT_INVALID
    SCHEMA_NUMBER_CONSTRAINT_INVALID
    SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID
    SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN
    SCHEMA_ITEMS_INVALID_FOR_TUPLE
    SCHEMA_USES_UNKNOWN_EXTENSION
    SCHEMA_EXTENDS_CIRCULAR
    SCHEMA_EXTENDS_NOT_FOUND
    SCHEMA_REF_INVALID
    SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED
    SCHEMA_MIN_ITEMS_NEGATIVE
    SCHEMA_MIN_LENGTH_NEGATIVE
    SCHEMA_MULTIPLE_OF_NOT_POSITIVE
    SCHEMA_CONSTRAINT_TYPE_MISMATCH
    SCHEMA_CIRCULAR_REF
    
    INSTANCE_ROOT_UNRESOLVED
    INSTANCE_MAX_DEPTH_EXCEEDED
    INSTANCE_SCHEMA_FALSE
    INSTANCE_REF_UNRESOLVED
    INSTANCE_CONST_MISMATCH
    INSTANCE_ENUM_MISMATCH
    INSTANCE_ANY_OF_NONE_MATCHED
    INSTANCE_ONE_OF_INVALID_COUNT
    INSTANCE_NOT_MATCHED
    INSTANCE_TYPE_UNKNOWN
    INSTANCE_TYPE_MISMATCH
    INSTANCE_NULL_EXPECTED
    INSTANCE_BOOLEAN_EXPECTED
    INSTANCE_STRING_EXPECTED
    INSTANCE_STRING_MIN_LENGTH
    INSTANCE_STRING_MAX_LENGTH
    INSTANCE_STRING_PATTERN_MISMATCH
    INSTANCE_PATTERN_INVALID
    INSTANCE_FORMAT_EMAIL_INVALID
    INSTANCE_FORMAT_URI_INVALID
    INSTANCE_FORMAT_URI_REFERENCE_INVALID
    INSTANCE_FORMAT_DATE_INVALID
    INSTANCE_FORMAT_TIME_INVALID
    INSTANCE_FORMAT_DATETIME_INVALID
    INSTANCE_FORMAT_UUID_INVALID
    INSTANCE_FORMAT_IPV4_INVALID
    INSTANCE_FORMAT_IPV6_INVALID
    INSTANCE_FORMAT_HOSTNAME_INVALID
    INSTANCE_NUMBER_EXPECTED
    INSTANCE_INTEGER_EXPECTED
    INSTANCE_INT_RANGE_INVALID
    INSTANCE_NUMBER_MINIMUM
    INSTANCE_NUMBER_MAXIMUM
    INSTANCE_NUMBER_EXCLUSIVE_MINIMUM
    INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM
    INSTANCE_NUMBER_MULTIPLE_OF
    INSTANCE_OBJECT_EXPECTED
    INSTANCE_REQUIRED_PROPERTY_MISSING
    INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED
    INSTANCE_MIN_PROPERTIES
    INSTANCE_MAX_PROPERTIES
    INSTANCE_DEPENDENT_REQUIRED
    INSTANCE_ARRAY_EXPECTED
    INSTANCE_MIN_ITEMS
    INSTANCE_MAX_ITEMS
    INSTANCE_MIN_CONTAINS
    INSTANCE_MAX_CONTAINS
    INSTANCE_SET_EXPECTED
    INSTANCE_SET_DUPLICATE
    INSTANCE_MAP_EXPECTED
    INSTANCE_MAP_MIN_ENTRIES
    INSTANCE_MAP_MAX_ENTRIES
    INSTANCE_MAP_KEY_INVALID
    INSTANCE_MAP_KEY_PATTERN_MISMATCH
    INSTANCE_TUPLE_EXPECTED
    INSTANCE_TUPLE_LENGTH_MISMATCH
    INSTANCE_TUPLE_ADDITIONAL_ITEMS
    INSTANCE_CHOICE_EXPECTED
    INSTANCE_CHOICE_MISSING_CHOICES
    INSTANCE_CHOICE_SELECTOR_MISSING
    INSTANCE_CHOICE_SELECTOR_NOT_STRING
    INSTANCE_CHOICE_UNKNOWN
    INSTANCE_CHOICE_NO_MATCH
    INSTANCE_CHOICE_MULTIPLE_MATCHES
    INSTANCE_DATE_EXPECTED
    INSTANCE_DATE_FORMAT_INVALID
    INSTANCE_TIME_EXPECTED
    INSTANCE_TIME_FORMAT_INVALID
    INSTANCE_DATETIME_EXPECTED
    INSTANCE_DATETIME_FORMAT_INVALID
    INSTANCE_DURATION_EXPECTED
    INSTANCE_DURATION_FORMAT_INVALID
    INSTANCE_UUID_EXPECTED
    INSTANCE_UUID_FORMAT_INVALID
    INSTANCE_URI_EXPECTED
    INSTANCE_URI_FORMAT_INVALID
    INSTANCE_URI_MISSING_SCHEME
    INSTANCE_BINARY_EXPECTED
    INSTANCE_BINARY_ENCODING_INVALID
    INSTANCE_JSONPOINTER_EXPECTED
    INSTANCE_JSONPOINTER_FORMAT_INVALID
    INSTANCE_DECIMAL_EXPECTED
    INSTANCE_STRING_NOT_EXPECTED
    INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED
);

our %EXPORT_TAGS = (
    all    => \@EXPORT_OK,
    schema => [grep { /^SCHEMA_/ } @EXPORT_OK],
    instance => [grep { /^INSTANCE_/ } @EXPORT_OK],
);

# Error message templates (matching error-messages.json)
our %ERROR_MESSAGES = (
    SCHEMA_NULL()                       => 'Schema cannot be null',
    SCHEMA_INVALID_TYPE()               => 'Schema must be a boolean or object',
    SCHEMA_MAX_DEPTH_EXCEEDED()         => 'Maximum validation depth ({maxDepth}) exceeded',
    SCHEMA_KEYWORD_INVALID_TYPE()       => '{keyword} must be {expectedType}',
    SCHEMA_KEYWORD_EMPTY()              => '{keyword} cannot be empty',
    SCHEMA_TYPE_INVALID()               => "Invalid type: '{typeName}'",
    SCHEMA_TYPE_ARRAY_EMPTY()           => 'type array cannot be empty',
    SCHEMA_TYPE_OBJECT_MISSING_REF()    => 'type object must contain $ref',
    SCHEMA_REF_NOT_FOUND()              => '$ref target does not exist: {refPath}',
    SCHEMA_REF_CIRCULAR()               => 'Circular reference detected: {refPath}',
    SCHEMA_REF_NOT_IN_TYPE()            => q{$ref is only permitted inside the 'type' attribute. Use { "type": { "$ref": "..." } } instead of { "$ref": "..." }},
    SCHEMA_MISSING_TYPE()               => "Schema must have a 'type' keyword or other schema-defining keyword",
    SCHEMA_ROOT_MISSING_TYPE()          => "Root schema must have 'type', '\$root', or other schema-defining keyword",
    SCHEMA_ROOT_MISSING_ID()            => "Missing required '\$id' keyword at root",
    SCHEMA_ROOT_MISSING_NAME()          => "Root schema with 'type' must have a 'name' property",
    SCHEMA_ROOT_CONFLICT()              => "Document cannot have both 'type' at root and '\$root' at the same time",
    SCHEMA_NAME_INVALID()               => '{keyword} must be a valid identifier (start with letter or underscore, contain only letters, digits, underscores)',
    SCHEMA_CONSTRAINT_INVALID_FOR_TYPE() => "'{constraint}' constraint is only valid for {validTypes}, not '{actualType}'",
    SCHEMA_MIN_GREATER_THAN_MAX()       => "'{minKeyword}' cannot be greater than '{maxKeyword}'",
    SCHEMA_PROPERTIES_NOT_OBJECT()      => 'properties must be an object',
    SCHEMA_REQUIRED_NOT_ARRAY()         => 'required must be an array',
    SCHEMA_REQUIRED_ITEM_NOT_STRING()   => 'required array items must be strings',
    SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED() => "Required property '{propertyName}' is not defined in properties",
    SCHEMA_ADDITIONAL_PROPERTIES_INVALID() => 'additionalProperties must be a boolean or schema',
    SCHEMA_ARRAY_MISSING_ITEMS()        => "array type requires 'items' or 'contains' schema",
    SCHEMA_TUPLE_MISSING_DEFINITION()   => "tuple type requires 'properties' and 'tuple' keywords",
    SCHEMA_TUPLE_ORDER_NOT_ARRAY()      => "'tuple' keyword must be an array of property names",
    SCHEMA_MAP_MISSING_VALUES()         => "map type requires 'values' schema",
    SCHEMA_CHOICE_MISSING_CHOICES()     => "choice type requires 'choices' keyword",
    SCHEMA_CHOICES_NOT_OBJECT()         => 'choices must be an object',
    SCHEMA_PATTERN_INVALID()            => "pattern is not a valid regular expression: '{pattern}'",
    SCHEMA_PATTERN_NOT_STRING()         => 'pattern must be a string',
    SCHEMA_ENUM_NOT_ARRAY()             => 'enum must be an array',
    SCHEMA_ENUM_EMPTY()                 => 'enum array cannot be empty',
    SCHEMA_ENUM_DUPLICATES()            => 'enum array contains duplicate values',
    SCHEMA_COMPOSITION_EMPTY()          => '{keyword} array cannot be empty',
    SCHEMA_COMPOSITION_NOT_ARRAY()      => '{keyword} must be an array',
    SCHEMA_ALTNAMES_NOT_OBJECT()        => 'altnames must be an object',
    SCHEMA_ALTNAMES_VALUE_NOT_STRING()  => 'altnames values must be strings',
    SCHEMA_INTEGER_CONSTRAINT_INVALID() => '{keyword} must be a non-negative integer',
    SCHEMA_NUMBER_CONSTRAINT_INVALID()  => '{keyword} must be a number',
    SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID() => '{keyword} must be a positive number',
    SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN()   => 'uniqueItems must be a boolean',
    SCHEMA_ITEMS_INVALID_FOR_TUPLE()    => 'items must be a boolean or schema for tuple type',

    INSTANCE_ROOT_UNRESOLVED()          => 'Unable to resolve $root reference: {refPath}',
    INSTANCE_MAX_DEPTH_EXCEEDED()       => 'Maximum validation depth ({maxDepth}) exceeded',
    INSTANCE_SCHEMA_FALSE()             => "Schema 'false' rejects all values",
    INSTANCE_REF_UNRESOLVED()           => 'Unable to resolve reference: {refPath}',
    INSTANCE_CONST_MISMATCH()           => 'Value must equal const value',
    INSTANCE_ENUM_MISMATCH()            => 'Value must be one of the enum values',
    INSTANCE_ANY_OF_NONE_MATCHED()      => 'Value must match at least one schema in anyOf',
    INSTANCE_ONE_OF_INVALID_COUNT()     => 'Value must match exactly one schema in oneOf (matched {matchCount})',
    INSTANCE_NOT_MATCHED()              => "Value must not match the schema in 'not'",
    INSTANCE_TYPE_UNKNOWN()             => 'Unknown type: {typeName}',
    INSTANCE_TYPE_MISMATCH()            => 'Value must be {expectedType}',
    INSTANCE_NULL_EXPECTED()            => 'Value must be null',
    INSTANCE_BOOLEAN_EXPECTED()         => 'Value must be a boolean',
    INSTANCE_STRING_EXPECTED()          => 'Value must be a string',
    INSTANCE_STRING_MIN_LENGTH()        => 'String length {actualLength} is less than minimum {minLength}',
    INSTANCE_STRING_MAX_LENGTH()        => 'String length {actualLength} exceeds maximum {maxLength}',
    INSTANCE_STRING_PATTERN_MISMATCH()  => 'String does not match pattern: {pattern}',
    INSTANCE_PATTERN_INVALID()          => 'Invalid regex pattern: {pattern}',
    INSTANCE_FORMAT_EMAIL_INVALID()     => 'String is not a valid email address',
    INSTANCE_FORMAT_URI_INVALID()       => 'String is not a valid URI',
    INSTANCE_FORMAT_URI_REFERENCE_INVALID() => 'String is not a valid URI reference',
    INSTANCE_FORMAT_DATE_INVALID()      => 'String is not a valid date',
    INSTANCE_FORMAT_TIME_INVALID()      => 'String is not a valid time',
    INSTANCE_FORMAT_DATETIME_INVALID()  => 'String is not a valid date-time',
    INSTANCE_FORMAT_UUID_INVALID()      => 'String is not a valid UUID',
    INSTANCE_FORMAT_IPV4_INVALID()      => 'String is not a valid IPv4 address',
    INSTANCE_FORMAT_IPV6_INVALID()      => 'String is not a valid IPv6 address',
    INSTANCE_FORMAT_HOSTNAME_INVALID()  => 'String is not a valid hostname',
    INSTANCE_NUMBER_EXPECTED()          => 'Value must be a number',
    INSTANCE_INTEGER_EXPECTED()         => 'Value must be an integer',
    INSTANCE_INT_RANGE_INVALID()        => 'Value {value} is not a valid {typeName}',
    INSTANCE_NUMBER_MINIMUM()           => 'Value {value} is less than minimum {minimum}',
    INSTANCE_NUMBER_MAXIMUM()           => 'Value {value} exceeds maximum {maximum}',
    INSTANCE_NUMBER_EXCLUSIVE_MINIMUM() => 'Value {value} must be greater than {exclusiveMinimum}',
    INSTANCE_NUMBER_EXCLUSIVE_MAXIMUM() => 'Value {value} must be less than {exclusiveMaximum}',
    INSTANCE_NUMBER_MULTIPLE_OF()       => 'Value {value} is not a multiple of {multipleOf}',
    INSTANCE_OBJECT_EXPECTED()          => 'Value must be an object',
    INSTANCE_REQUIRED_PROPERTY_MISSING() => 'Missing required property: {propertyName}',
    INSTANCE_ADDITIONAL_PROPERTY_NOT_ALLOWED() => 'Additional property not allowed: {propertyName}',
    INSTANCE_MIN_PROPERTIES()           => 'Object has {actualCount} properties, minimum is {minProperties}',
    INSTANCE_MAX_PROPERTIES()           => 'Object has {actualCount} properties, maximum is {maxProperties}',
    INSTANCE_DEPENDENT_REQUIRED()       => "Property '{sourceProperty}' requires property '{requiredProperty}'",
    INSTANCE_ARRAY_EXPECTED()           => 'Value must be an array',
    INSTANCE_MIN_ITEMS()                => 'Array has {actualCount} items, minimum is {minItems}',
    INSTANCE_MAX_ITEMS()                => 'Array has {actualCount} items, maximum is {maxItems}',
    INSTANCE_MIN_CONTAINS()             => 'Array must contain at least {minContains} matching items (found {actualCount})',
    INSTANCE_MAX_CONTAINS()             => 'Array must contain at most {maxContains} matching items (found {actualCount})',
    INSTANCE_SET_EXPECTED()             => 'Value must be an array (set)',
    INSTANCE_SET_DUPLICATE()            => 'Set contains duplicate value at index {index}',
    INSTANCE_MAP_EXPECTED()             => 'Value must be an object (map)',
    INSTANCE_MAP_MIN_ENTRIES()          => 'Map has {actualCount} entries, minimum is {minProperties}',
    INSTANCE_MAP_MAX_ENTRIES()          => 'Map has {actualCount} entries, maximum is {maxProperties}',
    INSTANCE_TUPLE_EXPECTED()           => 'Value must be an array (tuple)',
    INSTANCE_TUPLE_LENGTH_MISMATCH()    => 'Tuple has {actualCount} items but schema defines {expectedCount}',
    INSTANCE_TUPLE_ADDITIONAL_ITEMS()   => 'Tuple has {actualCount} items but only {expectedCount} are defined',
    INSTANCE_CHOICE_EXPECTED()          => 'Value must be an object (choice)',
    INSTANCE_CHOICE_MISSING_CHOICES()   => "Choice schema must have 'choices'",
    INSTANCE_CHOICE_SELECTOR_MISSING()  => 'Choice requires selector property: {selector}',
    INSTANCE_CHOICE_SELECTOR_NOT_STRING() => 'Selector value must be a string',
    INSTANCE_CHOICE_UNKNOWN()           => 'Unknown choice: {choiceName}',
    INSTANCE_CHOICE_NO_MATCH()          => 'Value does not match any choice option',
    INSTANCE_CHOICE_MULTIPLE_MATCHES()  => 'Value matches {matchCount} choices (should match exactly one)',
    INSTANCE_DATE_EXPECTED()            => 'Date must be a string',
    INSTANCE_DATE_FORMAT_INVALID()      => 'Invalid date format: {value}',
    INSTANCE_TIME_EXPECTED()            => 'Time must be a string',
    INSTANCE_TIME_FORMAT_INVALID()      => 'Invalid time format: {value}',
    INSTANCE_DATETIME_EXPECTED()        => 'DateTime must be a string',
    INSTANCE_DATETIME_FORMAT_INVALID()  => 'Invalid datetime format: {value}',
    INSTANCE_DURATION_EXPECTED()        => 'Duration must be a string',
    INSTANCE_DURATION_FORMAT_INVALID()  => 'Invalid duration format: {value}',
    INSTANCE_UUID_EXPECTED()            => 'UUID must be a string',
    INSTANCE_UUID_FORMAT_INVALID()      => 'Invalid UUID format: {value}',
    INSTANCE_URI_EXPECTED()             => 'URI must be a string',
    INSTANCE_URI_FORMAT_INVALID()       => 'Invalid URI format: {value}',
    INSTANCE_URI_MISSING_SCHEME()       => 'URI must have a scheme: {value}',
    INSTANCE_BINARY_EXPECTED()          => 'Binary must be a base64 string',
    INSTANCE_BINARY_ENCODING_INVALID()  => 'Invalid base64 encoding',
    INSTANCE_JSONPOINTER_EXPECTED()     => 'JSON Pointer must be a string',
    INSTANCE_JSONPOINTER_FORMAT_INVALID() => 'Invalid JSON Pointer format: {value}',
    INSTANCE_DECIMAL_EXPECTED()         => 'Value must be a valid {typeName}',
    INSTANCE_STRING_NOT_EXPECTED()      => 'String value not expected for type {typeName}',
    INSTANCE_CUSTOM_TYPE_NOT_SUPPORTED() => 'Custom type reference not yet supported: {typeName}',
);

=head1 FUNCTIONS

=head2 format_error_message($code, %params)

Formats an error message with the given parameters.

    my $message = format_error_message(SCHEMA_TYPE_INVALID, typeName => 'foo');
    # Returns: "Invalid type: 'foo'"

=cut

sub format_error_message {
    my ($code, %params) = @_;
    my $template = $ERROR_MESSAGES{$code} // "Unknown error: $code";
    
    # Replace placeholders with parameter values
    for my $key (keys %params) {
        my $value = $params{$key} // '';
        $template =~ s/\{$key\}/$value/g;
    }
    
    return $template;
}

push @EXPORT_OK, 'format_error_message';
push @{$EXPORT_TAGS{all}}, 'format_error_message';

1;

__END__

=head1 AUTHOR

JSON Structure Project

=head1 LICENSE

MIT License

=cut
