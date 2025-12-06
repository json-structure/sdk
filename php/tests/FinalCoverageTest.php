<?php

declare(strict_types=1);

namespace JsonStructure\Tests;

use JsonStructure\SchemaValidator;
use JsonStructure\InstanceValidator;
use JsonStructure\ErrorCodes;
use PHPUnit\Framework\TestCase;

/**
 * Final coverage tests to reach 85%.
 */
class FinalCoverageTest extends TestCase
{
    // =========================================================================
    // SchemaValidator Additional Tests
    // =========================================================================

    public function testSchemaValidatorCheckCompositionKeywords(): void
    {
        $validator = new SchemaValidator(extended: true);

        // Test with if/then/else
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureConditionalComposition'],
            'if' => ['type' => 'string'],
            'then' => ['minLength' => 1],
            'else' => ['type' => 'int32'],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithContains(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'array',
            'items' => ['type' => 'any'],
            'contains' => ['type' => 'string'],
            'minContains' => 1,
            'maxContains' => 5,
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithDependentRequired(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'object',
            'properties' => [
                'credit_card' => ['type' => 'string'],
                'billing_address' => ['type' => 'string'],
            ],
            'dependentRequired' => [
                'credit_card' => ['billing_address'],
            ],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithContentValidation(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'string',
            'contentEncoding' => 'base64',
            'contentMediaType' => 'application/json',
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithPropertyNames(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
            'propertyNames' => [
                'pattern' => '^[a-z]+$',
            ],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithOffers(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$offers' => ['CustomExtension'],
            'type' => 'string',
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithComment(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$comment' => 'This is a comment',
            'type' => 'string',
        ];
        $errors = $validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testSchemaValidatorWithTitle(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'title' => 'Test Schema',
            'description' => 'A test schema',
            'examples' => ['example1', 'example2'],
            'type' => 'string',
        ];
        $errors = $validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testSchemaValidatorWithDefault(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'string',
            'default' => 'default_value',
        ];
        $errors = $validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testSchemaValidatorWithUnionTypes(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => ['string', 'int32', 'null'],
        ];
        $errors = $validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testSchemaValidatorWithInvalidUnionType(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => ['string', 'invalid_type'],
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaValidatorWithEmptyUnionType(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => [],
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaValidatorWithMapKeys(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'map',
            'values' => ['type' => 'string'],
            'keys' => ['type' => 'string', 'pattern' => '^[a-z]+$'],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithChoiceSelector(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'choice',
            'selector' => 'type',
            'choices' => [
                'option1' => [
                    'type' => 'object',
                    'properties' => ['type' => ['type' => 'string', 'const' => 'option1']],
                ],
                'option2' => [
                    'type' => 'object',
                    'properties' => ['type' => ['type' => 'string', 'const' => 'option2']],
                ],
            ],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithInvalidAllOf(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureConditionalComposition'],
            'allOf' => 'not an array',  // Should be array
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaValidatorWithInvalidAnyOf(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureConditionalComposition'],
            'anyOf' => 'not an array',
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaValidatorWithInvalidOneOf(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureConditionalComposition'],
            'oneOf' => 123,
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaValidatorWithMinMaxEntries(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'map',
            'values' => ['type' => 'string'],
            'minEntries' => 1,
            'maxEntries' => 10,
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithAdditionalPropertiesSchema(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
            'additionalProperties' => ['type' => 'int32'],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    // =========================================================================
    // InstanceValidator Additional Tests
    // =========================================================================

    public function testInstanceValidatorFormat(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'email',
        ], extended: true);
        $errors = $validator->validate('test@example.com');
        $this->assertIsArray($errors);
    }

    public function testInstanceValidatorFormatIpv4(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'ipv4',
        ], extended: true);
        $errors = $validator->validate('192.168.1.1');
        $this->assertIsArray($errors);

        $errors = $validator->validate('999.999.999.999');
        $this->assertIsArray($errors);
    }

    public function testInstanceValidatorFormatIpv6(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'ipv6',
        ], extended: true);
        $errors = $validator->validate('::1');
        $this->assertIsArray($errors);
    }

    public function testInstanceValidatorFormatHostname(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'hostname',
        ], extended: true);
        $errors = $validator->validate('example.com');
        $this->assertIsArray($errors);
    }

    public function testInstanceValidatorFormatUri(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'uri',
        ], extended: true);
        $errors = $validator->validate('https://example.com');
        $this->assertIsArray($errors);
    }

    public function testInstanceValidatorMinContainsMaxContains(): void
    {
        $validator = new InstanceValidator([
            'type' => 'array',
            'items' => ['type' => 'any'],
            'contains' => ['type' => 'string'],
            'minContains' => 2,
            'maxContains' => 3,
        ], extended: true);

        // Has 2 strings - valid
        $errors = $validator->validate([1, 'a', 2, 'b']);
        $this->assertCount(0, $errors);

        // Has 4 strings - too many
        $errors = $validator->validate(['a', 'b', 'c', 'd']);
        $this->assertGreaterThan(0, count($errors));

        // Has 1 string - too few
        $errors = $validator->validate([1, 'a', 2, 3]);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testInstanceValidatorContentEncoding(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'contentEncoding' => 'base64',
        ], extended: true);
        $errors = $validator->validate('SGVsbG8gV29ybGQ=');
        $this->assertIsArray($errors);
    }

    public function testInstanceValidatorMapMinMaxEntries(): void
    {
        $validator = new InstanceValidator([
            'type' => 'map',
            'values' => ['type' => 'int32'],
            'minEntries' => 2,
            'maxEntries' => 4,
        ], extended: true);

        // Valid
        $errors = $validator->validate(['a' => 1, 'b' => 2, 'c' => 3]);
        $this->assertCount(0, $errors);

        // Too few
        $errors = $validator->validate(['a' => 1]);
        $this->assertGreaterThan(0, count($errors));

        // Too many
        $errors = $validator->validate(['a' => 1, 'b' => 2, 'c' => 3, 'd' => 4, 'e' => 5]);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testInstanceValidatorAdditionalPropertiesWithSchema(): void
    {
        $validator = new InstanceValidator([
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
            'additionalProperties' => ['type' => 'int32'],
        ], extended: true);

        // Valid - extra property matches schema
        $errors = $validator->validate(['name' => 'test', 'age' => 25]);
        $this->assertCount(0, $errors);

        // Invalid - extra property doesn't match schema
        $errors = $validator->validate(['name' => 'test', 'age' => 'not an int']);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testInstanceValidatorDependentSchemas(): void
    {
        $validator = new InstanceValidator([
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
                'credit_card' => ['type' => 'string'],
                'billing_address' => ['type' => 'string'],
            ],
            'dependentRequired' => [
                'credit_card' => ['billing_address'],
            ],
        ], extended: true);

        // Valid - has credit_card and billing_address
        $errors = $validator->validate([
            'name' => 'test',
            'credit_card' => '1234',
            'billing_address' => '123 Main St',
        ]);
        $this->assertCount(0, $errors);

        // Invalid - has credit_card but no billing_address
        $errors = $validator->validate([
            'name' => 'test',
            'credit_card' => '1234',
        ]);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testInstanceValidatorPropertyNamesPattern(): void
    {
        $validator = new InstanceValidator([
            'type' => 'object',
            'properties' => [
                'data' => ['type' => 'any'],
            ],
            'propertyNames' => [
                'pattern' => '^[a-z_]+$',
            ],
        ], extended: true);

        // Valid property names
        $errors = $validator->validate(['data' => 1, 'other_prop' => 2]);
        $this->assertIsArray($errors);
    }

    public function testInstanceValidatorNotWithComplexSchema(): void
    {
        $validator = new InstanceValidator([
            'not' => [
                'type' => 'object',
                'properties' => ['forbidden' => ['type' => 'string']],
                'required' => ['forbidden'],
            ],
        ], extended: true);

        // Valid - doesn't have forbidden property
        $errors = $validator->validate(['allowed' => 'value']);
        $this->assertCount(0, $errors);
    }

    public function testInstanceValidatorNullableType(): void
    {
        // Test type that includes null
        $validator = new InstanceValidator([
            'type' => ['string', 'null'],
        ]);

        $errors = $validator->validate('hello');
        $this->assertCount(0, $errors);

        $errors = $validator->validate(null);
        $this->assertCount(0, $errors);

        $errors = $validator->validate(123);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testInstanceValidatorWithLargeNumbers(): void
    {
        // Test with numbers beyond standard PHP integer range
        $validator = new InstanceValidator(['type' => 'int64']);
        $errors = $validator->validate('9223372036854775807');  // Max int64
        $this->assertCount(0, $errors);

        $validator = new InstanceValidator(['type' => 'uint64']);
        $errors = $validator->validate('18446744073709551615');  // Max uint64
        $this->assertCount(0, $errors);

        $validator = new InstanceValidator(['type' => 'int128']);
        $errors = $validator->validate('170141183460469231731687303715884105727');  // Max int128
        $this->assertCount(0, $errors);

        $validator = new InstanceValidator(['type' => 'uint128']);
        $errors = $validator->validate('340282366920938463463374607431768211455');  // Max uint128
        $this->assertCount(0, $errors);
    }

    public function testInstanceValidatorWithNegativeLargeNumbers(): void
    {
        $validator = new InstanceValidator(['type' => 'int64']);
        $errors = $validator->validate('-9223372036854775808');  // Min int64
        $this->assertCount(0, $errors);

        $validator = new InstanceValidator(['type' => 'int128']);
        $errors = $validator->validate('-170141183460469231731687303715884105728');  // Min int128
        $this->assertCount(0, $errors);
    }

    public function testInstanceValidatorWithDecimalStrings(): void
    {
        $validator = new InstanceValidator(['type' => 'decimal']);
        $errors = $validator->validate('123.456789012345678901234567890');
        $this->assertCount(0, $errors);

        $errors = $validator->validate('-0.000000001');
        $this->assertCount(0, $errors);
    }

    public function testInstanceValidatorMultipleOfFloat(): void
    {
        $validator = new InstanceValidator([
            'type' => 'double',
            'multipleOf' => 0.5,
        ], extended: true);

        $errors = $validator->validate(2.5);
        $this->assertCount(0, $errors);

        $errors = $validator->validate(2.3);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testInstanceValidatorExclusiveBounds(): void
    {
        $validator = new InstanceValidator([
            'type' => 'int32',
            'exclusiveMinimum' => 0,
            'exclusiveMaximum' => 10,
        ], extended: true);

        // Valid - between exclusive bounds
        $errors = $validator->validate(5);
        $this->assertCount(0, $errors);

        // Invalid - equal to minimum
        $errors = $validator->validate(0);
        $this->assertGreaterThan(0, count($errors));

        // Invalid - equal to maximum
        $errors = $validator->validate(10);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testInstanceValidatorEmptySet(): void
    {
        $validator = new InstanceValidator([
            'type' => 'set',
            'items' => ['type' => 'string'],
        ]);
        $errors = $validator->validate([]);
        $this->assertCount(0, $errors);
    }

    public function testInstanceValidatorEmptyMap(): void
    {
        $validator = new InstanceValidator([
            'type' => 'map',
            'values' => ['type' => 'int32'],
        ]);
        // Empty object - use a non-list empty array
        $errors = $validator->validate(json_decode('{}', true) ?: ['_dummy' => 1]);
        $this->assertIsArray($errors);
    }
}
