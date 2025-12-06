<?php

declare(strict_types=1);

namespace JsonStructure;

/**
 * Types class containing all valid JSON Structure types.
 */
final class Types
{
    // Primitive types
    public const PRIMITIVE_TYPES = [
        'string',
        'number',
        'integer',
        'boolean',
        'null',
        'int8',
        'uint8',
        'int16',
        'uint16',
        'int32',
        'uint32',
        'int64',
        'uint64',
        'int128',
        'uint128',
        'float8',
        'float',
        'double',
        'decimal',
        'date',
        'datetime',
        'time',
        'duration',
        'uuid',
        'uri',
        'binary',
        'jsonpointer',
    ];

    // Compound types
    public const COMPOUND_TYPES = [
        'object',
        'array',
        'set',
        'map',
        'tuple',
        'choice',
        'any',
    ];

    // All valid types
    public const ALL_TYPES = [
        // Primitives
        'string',
        'number',
        'integer',
        'boolean',
        'null',
        'int8',
        'uint8',
        'int16',
        'uint16',
        'int32',
        'uint32',
        'int64',
        'uint64',
        'int128',
        'uint128',
        'float8',
        'float',
        'double',
        'decimal',
        'date',
        'datetime',
        'time',
        'duration',
        'uuid',
        'uri',
        'binary',
        'jsonpointer',
        // Compound
        'object',
        'array',
        'set',
        'map',
        'tuple',
        'choice',
        'any',
    ];

    // Numeric types (for validation)
    public const NUMERIC_TYPES = [
        'number',
        'integer',
        'int8',
        'uint8',
        'int16',
        'uint16',
        'int32',
        'uint32',
        'int64',
        'uint64',
        'int128',
        'uint128',
        'float8',
        'float',
        'double',
        'decimal',
    ];

    // Integer types (for range validation)
    public const INTEGER_TYPES = [
        'integer',
        'int8',
        'uint8',
        'int16',
        'uint16',
        'int32',
        'uint32',
        'int64',
        'uint64',
        'int128',
        'uint128',
    ];

    // String-based large numeric types
    public const STRING_BASED_NUMERIC_TYPES = [
        'int64',
        'uint64',
        'int128',
        'uint128',
        'decimal',
    ];

    // Array-like types
    public const ARRAY_TYPES = [
        'array',
        'set',
        'tuple',
    ];

    // Object-like types
    public const OBJECT_TYPES = [
        'object',
        'map',
    ];

    // Integer type ranges
    public const INT_RANGES = [
        'int8' => ['min' => -128, 'max' => 127],
        'uint8' => ['min' => 0, 'max' => 255],
        'int16' => ['min' => -32768, 'max' => 32767],
        'uint16' => ['min' => 0, 'max' => 65535],
        'int32' => ['min' => -2147483648, 'max' => 2147483647],
        'uint32' => ['min' => 0, 'max' => 4294967295],
        'integer' => ['min' => -2147483648, 'max' => 2147483647], // Alias for int32
    ];

    // Large integer ranges (as strings)
    public const LARGE_INT_RANGES = [
        'int64' => ['min' => '-9223372036854775808', 'max' => '9223372036854775807'],
        'uint64' => ['min' => '0', 'max' => '18446744073709551615'],
        'int128' => ['min' => '-170141183460469231731687303715884105728', 'max' => '170141183460469231731687303715884105727'],
        'uint128' => ['min' => '0', 'max' => '340282366920938463463374607431768211455'],
    ];

    // Known extensions
    public const KNOWN_EXTENSIONS = [
        'JSONStructureImport',
        'JSONStructureAlternateNames',
        'JSONStructureUnits',
        'JSONStructureConditionalComposition',
        'JSONStructureValidation',
    ];

    // Composition keywords
    public const COMPOSITION_KEYWORDS = [
        'allOf',
        'anyOf',
        'oneOf',
        'not',
        'if',
        'then',
        'else',
    ];

    // Numeric validation keywords
    public const NUMERIC_VALIDATION_KEYWORDS = [
        'minimum',
        'maximum',
        'exclusiveMinimum',
        'exclusiveMaximum',
        'multipleOf',
    ];

    // String validation keywords
    public const STRING_VALIDATION_KEYWORDS = [
        'minLength',
        'maxLength',
        'pattern',
        'format',
        'contentEncoding',
        'contentMediaType',
    ];

    // Array validation keywords
    public const ARRAY_VALIDATION_KEYWORDS = [
        'minItems',
        'maxItems',
        'uniqueItems',
        'contains',
        'minContains',
        'maxContains',
    ];

    // Object validation keywords
    public const OBJECT_VALIDATION_KEYWORDS = [
        'minProperties',
        'maxProperties',
        'minEntries',
        'maxEntries',
        'dependentRequired',
        'patternProperties',
        'patternKeys',
        'propertyNames',
        'keyNames',
        'has',
        'default',
    ];

    // Valid format values
    public const VALID_FORMATS = [
        'ipv4',
        'ipv6',
        'email',
        'idn-email',
        'hostname',
        'idn-hostname',
        'iri',
        'iri-reference',
        'uri-template',
        'relative-json-pointer',
        'regex',
    ];

    /**
     * Check if a type is a valid primitive type.
     */
    public static function isPrimitiveType(string $type): bool
    {
        return in_array($type, self::PRIMITIVE_TYPES, true);
    }

    /**
     * Check if a type is a valid compound type.
     */
    public static function isCompoundType(string $type): bool
    {
        return in_array($type, self::COMPOUND_TYPES, true);
    }

    /**
     * Check if a type is a valid type (primitive or compound).
     */
    public static function isValidType(string $type): bool
    {
        return in_array($type, self::ALL_TYPES, true);
    }

    /**
     * Check if a type is numeric.
     */
    public static function isNumericType(string $type): bool
    {
        return in_array($type, self::NUMERIC_TYPES, true);
    }

    /**
     * Check if a type is an integer type.
     */
    public static function isIntegerType(string $type): bool
    {
        return in_array($type, self::INTEGER_TYPES, true);
    }

    /**
     * Check if a type uses string representation for large numbers.
     */
    public static function isStringBasedNumericType(string $type): bool
    {
        return in_array($type, self::STRING_BASED_NUMERIC_TYPES, true);
    }

    /**
     * Check if a type is array-like.
     */
    public static function isArrayType(string $type): bool
    {
        return in_array($type, self::ARRAY_TYPES, true);
    }

    /**
     * Check if a type is object-like.
     */
    public static function isObjectType(string $type): bool
    {
        return in_array($type, self::OBJECT_TYPES, true);
    }
}
