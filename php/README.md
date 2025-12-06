# JSON Structure PHP SDK

A PHP SDK for JSON Structure schema and instance validation.

## Requirements

- PHP 8.1 or higher
- BCMath extension (for large integer validation)
- JSON extension

## Installation

### Via Composer

```bash
composer require json-structure/sdk
```

### Manual Installation

Clone the repository and run:

```bash
cd php
composer install
```

## Usage

### Schema Validation

Validate a JSON Structure schema document:

```php
<?php

use JsonStructure\SchemaValidator;

$schema = [
    '$id' => 'https://example.com/person.struct.json',
    '$schema' => 'https://json-structure.org/meta/core/v0/#',
    'name' => 'Person',
    'type' => 'object',
    'properties' => [
        'name' => ['type' => 'string'],
        'age' => ['type' => 'int32'],
        'email' => ['type' => 'string']
    ],
    'required' => ['name']
];

$validator = new SchemaValidator(extended: true);
$errors = $validator->validate($schema);

if (count($errors) === 0) {
    echo "Schema is valid!\n";
} else {
    echo "Schema validation errors:\n";
    foreach ($errors as $error) {
        echo " - " . $error . "\n";
    }
}
```

### Instance Validation

Validate a JSON instance against a JSON Structure schema:

```php
<?php

use JsonStructure\InstanceValidator;

$schema = [
    '$id' => 'https://example.com/person.struct.json',
    '$schema' => 'https://json-structure.org/meta/core/v0/#',
    'name' => 'Person',
    'type' => 'object',
    'properties' => [
        'name' => ['type' => 'string'],
        'age' => ['type' => 'int32'],
        'email' => ['type' => 'string']
    ],
    'required' => ['name']
];

$instance = [
    'name' => 'John Doe',
    'age' => 30,
    'email' => 'john@example.com'
];

$validator = new InstanceValidator($schema, extended: true);
$errors = $validator->validate($instance);

if (count($errors) === 0) {
    echo "Instance is valid!\n";
} else {
    echo "Instance validation errors:\n";
    foreach ($errors as $error) {
        echo " - " . $error . "\n";
    }
}
```

### Extended Validation

Enable extended validation features (conditional composition, validation keywords):

```php
<?php

use JsonStructure\SchemaValidator;
use JsonStructure\InstanceValidator;

$schema = [
    '$id' => 'https://example.com/user.struct.json',
    '$schema' => 'https://json-structure.org/meta/core/v0/#',
    '$uses' => ['JSONStructureValidation'],
    'name' => 'User',
    'type' => 'object',
    'properties' => [
        'username' => [
            'type' => 'string',
            'minLength' => 3,
            'maxLength' => 20,
            'pattern' => '^[a-zA-Z][a-zA-Z0-9_]*$'
        ],
        'age' => [
            'type' => 'int32',
            'minimum' => 0,
            'maximum' => 150
        ]
    ],
    'required' => ['username']
];

// Validate schema
$schemaValidator = new SchemaValidator(extended: true);
$schemaErrors = $schemaValidator->validate($schema);

if (count($schemaErrors) > 0) {
    echo "Schema errors: " . count($schemaErrors) . "\n";
}

// Validate instance
$instance = [
    'username' => 'johndoe',
    'age' => 30
];

$instanceValidator = new InstanceValidator($schema, extended: true);
$instanceErrors = $instanceValidator->validate($instance);

if (count($instanceErrors) === 0) {
    echo "Valid!\n";
}
```

## Supported Types

### Primitive Types (34)

| Type | Description |
|------|-------------|
| `string` | UTF-8 string |
| `boolean` | `true` or `false` |
| `null` | Null value |
| `number` | Any JSON number |
| `integer` | Alias for `int32` |
| `int8` | -128 to 127 |
| `int16` | -32,768 to 32,767 |
| `int32` | -2³¹ to 2³¹-1 |
| `int64` | -2⁶³ to 2⁶³-1 (as string) |
| `int128` | -2¹²⁷ to 2¹²⁷-1 (as string) |
| `uint8` | 0 to 255 |
| `uint16` | 0 to 65,535 |
| `uint32` | 0 to 2³²-1 |
| `uint64` | 0 to 2⁶⁴-1 (as string) |
| `uint128` | 0 to 2¹²⁸-1 (as string) |
| `float8` | 8-bit float |
| `float` | 32-bit IEEE 754 |
| `double` | 64-bit IEEE 754 |
| `decimal` | Arbitrary precision (as string) |
| `date` | RFC 3339 date (`YYYY-MM-DD`) |
| `time` | RFC 3339 time (`HH:MM:SS[.sss]`) |
| `datetime` | RFC 3339 datetime |
| `duration` | ISO 8601 duration |
| `uuid` | RFC 9562 UUID |
| `uri` | RFC 3986 URI |
| `binary` | Base64-encoded bytes |
| `jsonpointer` | RFC 6901 JSON Pointer |

### Compound Types

| Type | Description |
|------|-------------|
| `object` | JSON object with typed properties |
| `array` | Homogeneous list |
| `set` | Unique homogeneous list |
| `map` | Dictionary with string keys |
| `tuple` | Fixed-length typed array |
| `choice` | Discriminated union |
| `any` | Any JSON value |

## Error Handling

All validation errors use standardized error codes:

```php
<?php

use JsonStructure\ErrorCodes;

// Schema validation errors start with SCHEMA_
ErrorCodes::SCHEMA_TYPE_INVALID;
ErrorCodes::SCHEMA_REF_NOT_FOUND;
ErrorCodes::SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED;

// Instance validation errors start with INSTANCE_
ErrorCodes::INSTANCE_TYPE_MISMATCH;
ErrorCodes::INSTANCE_REQUIRED_PROPERTY_MISSING;
ErrorCodes::INSTANCE_ENUM_MISMATCH;
```

Each `ValidationError` includes:
- `code`: Standardized error code
- `message`: Human-readable error message
- `path`: JSON Pointer path to the error location
- `severity`: `ERROR` or `WARNING`
- `location`: Line/column position (when source text is available)

## Testing

Run the test suite:

```bash
composer test
```

Run tests with coverage:

```bash
composer test-coverage
```

## License

MIT License - see [LICENSE](../LICENSE) for details.

## Related Resources

- [JSON Structure Specification](https://json-structure.github.io/core/)
- [SDK Guidelines](../SDK-GUIDELINES.md)
- [Test Assets](../test-assets/)
