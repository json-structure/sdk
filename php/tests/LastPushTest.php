<?php

declare(strict_types=1);

namespace JsonStructure\Tests;

use JsonStructure\SchemaValidator;
use JsonStructure\InstanceValidator;
use JsonStructure\JsonSourceLocator;
use PHPUnit\Framework\TestCase;

/**
 * Last few tests to push over 85%.
 */
class LastPushTest extends TestCase
{
    public function testSchemaWithInvalidRequiredItem(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
            'required' => ['nonexistent'],  // Property not in properties
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaWithInvalidEnumType(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'string',
            'enum' => 'not an array',
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaWithInvalidItemsType(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'array',
            'items' => 'not an object',
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaWithInvalidValuesType(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'map',
            'values' => 123,  // Not an object
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaWithInvalidChoicesType(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'choice',
            'choices' => 'not an object',
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaWithInvalidTupleType(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'tuple',
            'properties' => [
                'a' => ['type' => 'string'],
            ],
            'tuple' => 'not an array',
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaWithTupleMissingProperties(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'tuple',
            'properties' => [
                'a' => ['type' => 'string'],
            ],
            'tuple' => ['a', 'b'],  // 'b' not in properties
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testInstanceValidatorWithRootNotFound(): void
    {
        $validator = new InstanceValidator([
            '$root' => '#/definitions/NonExistent',
            'definitions' => [
                'Exists' => ['type' => 'string'],
            ],
        ]);
        $errors = $validator->validate('test');
        $this->assertGreaterThan(0, count($errors));
    }

    public function testInstanceValidatorWithInvalidRef(): void
    {
        $validator = new InstanceValidator([
            'type' => ['$ref' => '#/definitions/NonExistent'],
            'definitions' => [],
        ]);
        $errors = $validator->validate('test');
        $this->assertGreaterThan(0, count($errors));
    }

    public function testJsonSourceLocatorWithNestedArrays(): void
    {
        $json = '{"arr": [[1, 2], [3, 4], [5, 6]]}';
        $locator = new JsonSourceLocator($json);
        
        $location = $locator->getLocation('/arr/1/0');
        $this->assertInstanceOf(\JsonStructure\JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithMixedNestedContent(): void
    {
        $json = '{"data": {"nested": [{"inner": "value"}]}}';
        $locator = new JsonSourceLocator($json);
        
        $location = $locator->getLocation('/data/nested/0/inner');
        $this->assertInstanceOf(\JsonStructure\JsonLocation::class, $location);
    }
}
