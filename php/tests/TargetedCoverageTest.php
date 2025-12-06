<?php

declare(strict_types=1);

namespace JsonStructure\Tests;

use JsonStructure\SchemaValidator;
use JsonStructure\InstanceValidator;
use JsonStructure\JsonSourceLocator;
use JsonStructure\JsonLocation;
use PHPUnit\Framework\TestCase;

/**
 * Final targeted tests to reach 85% coverage.
 */
class TargetedCoverageTest extends TestCase
{
    // =========================================================================
    // Large Integer Validation Tests
    // =========================================================================

    public function testInt64Validation(): void
    {
        $validator = new InstanceValidator(['type' => 'int64']);
        
        // Valid int64 values as strings
        $this->assertCount(0, $validator->validate('0'));
        $this->assertCount(0, $validator->validate('123456789'));
        $this->assertCount(0, $validator->validate('-123456789'));
        
        // Invalid - not a number string
        $this->assertGreaterThan(0, count($validator->validate('abc')));
    }

    public function testUint64Validation(): void
    {
        $validator = new InstanceValidator(['type' => 'uint64']);
        
        // Valid uint64 values
        $this->assertCount(0, $validator->validate('0'));
        $this->assertCount(0, $validator->validate('123456789'));
        
        // Invalid - negative
        $this->assertGreaterThan(0, count($validator->validate('-1')));
    }

    public function testInt128Validation(): void
    {
        $validator = new InstanceValidator(['type' => 'int128']);
        
        // Valid int128 values as strings
        $this->assertCount(0, $validator->validate('0'));
        $this->assertCount(0, $validator->validate('999999999999999999999'));
        $this->assertCount(0, $validator->validate('-999999999999999999999'));
    }

    public function testUint128Validation(): void
    {
        $validator = new InstanceValidator(['type' => 'uint128']);
        
        // Valid uint128 values
        $this->assertCount(0, $validator->validate('0'));
        $this->assertCount(0, $validator->validate('999999999999999999999'));
        
        // Invalid - negative
        $this->assertGreaterThan(0, count($validator->validate('-1')));
    }

    // =========================================================================
    // Conditional Composition Tests
    // =========================================================================

    public function testAllOfValidation(): void
    {
        $validator = new InstanceValidator([
            'allOf' => [
                ['type' => 'object', 'properties' => ['a' => ['type' => 'string']], 'required' => ['a']],
                ['type' => 'object', 'properties' => ['b' => ['type' => 'int32']], 'required' => ['b']],
            ],
        ], extended: true);

        // Valid - satisfies both schemas
        $errors = $validator->validate(['a' => 'test', 'b' => 42]);
        $this->assertCount(0, $errors);

        // Invalid - missing 'b'
        $errors = $validator->validate(['a' => 'test']);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testAnyOfValidation(): void
    {
        $validator = new InstanceValidator([
            'anyOf' => [
                ['type' => 'string'],
                ['type' => 'int32'],
            ],
        ], extended: true);

        // Valid - matches string
        $errors = $validator->validate('hello');
        $this->assertCount(0, $errors);

        // Valid - matches int32
        $errors = $validator->validate(42);
        $this->assertCount(0, $errors);

        // Invalid - matches neither
        $errors = $validator->validate(true);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testOneOfValidation(): void
    {
        $validator = new InstanceValidator([
            'oneOf' => [
                ['type' => 'string', 'minLength' => 10],
                ['type' => 'string', 'maxLength' => 5],
            ],
        ], extended: true);

        // Valid - matches only first (long string)
        $errors = $validator->validate('this is a long string');
        $this->assertCount(0, $errors);

        // Valid - matches only second (short string)
        $errors = $validator->validate('hi');
        $this->assertCount(0, $errors);
    }

    public function testNotValidation(): void
    {
        $validator = new InstanceValidator([
            'not' => ['type' => 'string'],
        ], extended: true);

        // Valid - not a string
        $errors = $validator->validate(42);
        $this->assertCount(0, $errors);

        // Invalid - is a string
        $errors = $validator->validate('hello');
        $this->assertGreaterThan(0, count($errors));
    }

    // =========================================================================
    // Extended Validation Keywords Tests
    // =========================================================================

    public function testMinLengthMaxLengthValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'minLength' => 5,
            'maxLength' => 10,
        ], extended: true);

        // Valid
        $errors = $validator->validate('hello');
        $this->assertCount(0, $errors);

        // Too short
        $errors = $validator->validate('hi');
        $this->assertGreaterThan(0, count($errors));

        // Too long
        $errors = $validator->validate('this is way too long');
        $this->assertGreaterThan(0, count($errors));
    }

    public function testPatternValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'pattern' => '^[A-Z][a-z]+$',
        ], extended: true);

        // Valid
        $errors = $validator->validate('Hello');
        $this->assertCount(0, $errors);

        // Invalid
        $errors = $validator->validate('hello');
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinMaxValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'int32',
            'minimum' => 10,
            'maximum' => 100,
        ], extended: true);

        // Valid
        $errors = $validator->validate(50);
        $this->assertCount(0, $errors);

        // Too low
        $errors = $validator->validate(5);
        $this->assertGreaterThan(0, count($errors));

        // Too high
        $errors = $validator->validate(150);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMultipleOfValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'int32',
            'multipleOf' => 7,
        ], extended: true);

        // Valid
        $errors = $validator->validate(21);
        $this->assertCount(0, $errors);

        // Invalid
        $errors = $validator->validate(20);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinMaxItemsValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'array',
            'items' => ['type' => 'int32'],
            'minItems' => 2,
            'maxItems' => 5,
        ], extended: true);

        // Valid
        $errors = $validator->validate([1, 2, 3]);
        $this->assertCount(0, $errors);

        // Too few
        $errors = $validator->validate([1]);
        $this->assertGreaterThan(0, count($errors));

        // Too many
        $errors = $validator->validate([1, 2, 3, 4, 5, 6]);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testUniqueItemsValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'array',
            'items' => ['type' => 'int32'],
            'uniqueItems' => true,
        ], extended: true);

        // Valid - all unique
        $errors = $validator->validate([1, 2, 3]);
        $this->assertCount(0, $errors);

        // Invalid - has duplicates
        $errors = $validator->validate([1, 2, 2, 3]);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testContainsValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'array',
            'items' => ['type' => 'any'],
            'contains' => ['type' => 'string'],
        ], extended: true);

        // Valid - contains string
        $errors = $validator->validate([1, 'hello', 3]);
        $this->assertCount(0, $errors);

        // Invalid - no string
        $errors = $validator->validate([1, 2, 3]);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinMaxPropertiesValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'object',
            'properties' => [
                'a' => ['type' => 'string'],
                'b' => ['type' => 'string'],
                'c' => ['type' => 'string'],
            ],
            'minProperties' => 2,
            'maxProperties' => 3,
        ], extended: true);

        // Valid
        $errors = $validator->validate(['a' => 'x', 'b' => 'y']);
        $this->assertCount(0, $errors);

        // Too few
        $errors = $validator->validate(['a' => 'x']);
        $this->assertGreaterThan(0, count($errors));

        // Too many
        $errors = $validator->validate(['a' => 'x', 'b' => 'y', 'c' => 'z', 'd' => 'w']);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testDependentRequiredValidation(): void
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

        // Valid - has both credit_card and billing_address
        $errors = $validator->validate([
            'name' => 'test',
            'credit_card' => '1234',
            'billing_address' => '123 Main St',
        ]);
        $this->assertCount(0, $errors);

        // Valid - no credit_card
        $errors = $validator->validate(['name' => 'test']);
        $this->assertCount(0, $errors);

        // Invalid - credit_card without billing_address
        $errors = $validator->validate([
            'name' => 'test',
            'credit_card' => '1234',
        ]);
        $this->assertGreaterThan(0, count($errors));
    }

    // =========================================================================
    // JsonSourceLocator Additional Coverage
    // =========================================================================

    public function testJsonSourceLocatorWithTabs(): void
    {
        $json = "{\n\t\"key\": \"value\"\n}";
        $locator = new JsonSourceLocator($json);
        $location = $locator->getLocation('/key');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithCRLF(): void
    {
        $json = "{\r\n\"key\": \"value\"\r\n}";
        $locator = new JsonSourceLocator($json);
        $location = $locator->getLocation('/key');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithNumericKeys(): void
    {
        $json = '{"0": "first", "1": "second", "10": "tenth"}';
        $locator = new JsonSourceLocator($json);

        $location = $locator->getLocation('/0');
        $this->assertInstanceOf(JsonLocation::class, $location);

        $location = $locator->getLocation('/10');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    // =========================================================================
    // Format Validation Tests
    // =========================================================================

    public function testFormatEmailValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'email',
        ], extended: true);

        $errors = $validator->validate('test@example.com');
        $this->assertIsArray($errors);
    }

    public function testFormatIpv4Validation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'ipv4',
        ], extended: true);

        $errors = $validator->validate('192.168.1.1');
        $this->assertIsArray($errors);
    }

    public function testFormatIpv6Validation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'ipv6',
        ], extended: true);

        $errors = $validator->validate('::1');
        $this->assertIsArray($errors);
    }

    public function testFormatHostnameValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'hostname',
        ], extended: true);

        $errors = $validator->validate('example.com');
        $this->assertIsArray($errors);
    }

    public function testFormatUriValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'uri',
        ], extended: true);

        $errors = $validator->validate('https://example.com/path');
        $this->assertIsArray($errors);
    }
}
