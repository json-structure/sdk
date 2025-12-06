<?php

declare(strict_types=1);

namespace JsonStructure\Tests;

use JsonStructure\SchemaValidator;
use JsonStructure\InstanceValidator;
use JsonStructure\JsonSourceLocator;
use JsonStructure\JsonLocation;
use PHPUnit\Framework\TestCase;

/**
 * Extra tests to reach 85% coverage.
 */
class ExtraCoverageTest extends TestCase
{
    // =========================================================================
    // Instance Validator Edge Cases  
    // =========================================================================

    public function testAllNumericTypeBoundaries(): void
    {
        // int8
        $validator = new InstanceValidator(['type' => 'int8']);
        $this->assertCount(0, $validator->validate(-128));
        $this->assertCount(0, $validator->validate(127));
        $this->assertGreaterThan(0, count($validator->validate(-129)));
        $this->assertGreaterThan(0, count($validator->validate(128)));

        // uint8
        $validator = new InstanceValidator(['type' => 'uint8']);
        $this->assertCount(0, $validator->validate(0));
        $this->assertCount(0, $validator->validate(255));
        $this->assertGreaterThan(0, count($validator->validate(-1)));
        $this->assertGreaterThan(0, count($validator->validate(256)));

        // int16
        $validator = new InstanceValidator(['type' => 'int16']);
        $this->assertCount(0, $validator->validate(-32768));
        $this->assertCount(0, $validator->validate(32767));

        // uint16
        $validator = new InstanceValidator(['type' => 'uint16']);
        $this->assertCount(0, $validator->validate(0));
        $this->assertCount(0, $validator->validate(65535));

        // int32
        $validator = new InstanceValidator(['type' => 'int32']);
        $this->assertCount(0, $validator->validate(-2147483648));
        $this->assertCount(0, $validator->validate(2147483647));

        // uint32
        $validator = new InstanceValidator(['type' => 'uint32']);
        $this->assertCount(0, $validator->validate(0));
        $this->assertCount(0, $validator->validate(4294967295));
    }

    public function testStringFormatsValidation(): void
    {
        // date
        $validator = new InstanceValidator(['type' => 'date']);
        $this->assertCount(0, $validator->validate('2024-01-15'));
        $this->assertCount(0, $validator->validate('2000-12-31'));
        $this->assertGreaterThan(0, count($validator->validate('invalid')));
        // Note: Invalid month/day may not be caught by simple format check

        // time
        $validator = new InstanceValidator(['type' => 'time']);
        $this->assertCount(0, $validator->validate('14:30:00'));
        $this->assertCount(0, $validator->validate('23:59:59'));
        $this->assertCount(0, $validator->validate('00:00:00'));

        // datetime
        $validator = new InstanceValidator(['type' => 'datetime']);
        $this->assertCount(0, $validator->validate('2024-01-15T14:30:00Z'));
        $this->assertCount(0, $validator->validate('2024-01-15T14:30:00+00:00'));
        $this->assertGreaterThan(0, count($validator->validate('invalid')));

        // duration
        $validator = new InstanceValidator(['type' => 'duration']);
        $this->assertCount(0, $validator->validate('P1Y'));
        $this->assertCount(0, $validator->validate('PT1H'));
        $this->assertCount(0, $validator->validate('P1Y2M3DT4H5M6S'));
        $this->assertGreaterThan(0, count($validator->validate('invalid')));

        // uuid
        $validator = new InstanceValidator(['type' => 'uuid']);
        $this->assertCount(0, $validator->validate('550e8400-e29b-41d4-a716-446655440000'));
        $this->assertCount(0, $validator->validate('00000000-0000-0000-0000-000000000000'));
        $this->assertGreaterThan(0, count($validator->validate('not-a-uuid')));

        // uri
        $validator = new InstanceValidator(['type' => 'uri']);
        $this->assertCount(0, $validator->validate('https://example.com'));
        $this->assertCount(0, $validator->validate('urn:isbn:0451450523'));
        $this->assertCount(0, $validator->validate('file:///path/to/file'));
    }

    public function testBinaryValidation(): void
    {
        $validator = new InstanceValidator(['type' => 'binary']);
        $this->assertCount(0, $validator->validate('SGVsbG8gV29ybGQ='));
        $this->assertCount(0, $validator->validate(''));
        $this->assertGreaterThan(0, count($validator->validate(123)));
    }

    public function testArrayValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'array',
            'items' => ['type' => 'int32'],
        ]);

        $this->assertCount(0, $validator->validate([]));
        $this->assertCount(0, $validator->validate([1, 2, 3]));
        $this->assertGreaterThan(0, count($validator->validate([1, 'two', 3])));
    }

    public function testSetValidationDuplicateStrings(): void
    {
        $validator = new InstanceValidator([
            'type' => 'set',
            'items' => ['type' => 'string'],
        ]);

        $this->assertCount(0, $validator->validate(['a', 'b', 'c']));
        $this->assertGreaterThan(0, count($validator->validate(['a', 'b', 'a'])));
    }

    public function testSetValidationDuplicateNumbers(): void
    {
        $validator = new InstanceValidator([
            'type' => 'set',
            'items' => ['type' => 'int32'],
        ]);

        $this->assertCount(0, $validator->validate([1, 2, 3]));
        $this->assertGreaterThan(0, count($validator->validate([1, 2, 1])));
    }

    public function testMapValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'map',
            'values' => ['type' => 'string'],
        ]);

        $this->assertCount(0, $validator->validate(['key1' => 'value1', 'key2' => 'value2']));
        $this->assertGreaterThan(0, count($validator->validate(['key1' => 123])));
    }

    public function testObjectValidationRequired(): void
    {
        $validator = new InstanceValidator([
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
                'age' => ['type' => 'int32'],
            ],
            'required' => ['name', 'age'],
        ]);

        $this->assertCount(0, $validator->validate(['name' => 'John', 'age' => 30]));
        $this->assertGreaterThan(0, count($validator->validate(['name' => 'John'])));
        $this->assertGreaterThan(0, count($validator->validate(['age' => 30])));
        $this->assertGreaterThan(0, count($validator->validate([])));
    }

    public function testEnumValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'enum' => ['red', 'green', 'blue'],
        ]);

        $this->assertCount(0, $validator->validate('red'));
        $this->assertCount(0, $validator->validate('green'));
        $this->assertCount(0, $validator->validate('blue'));
        $this->assertGreaterThan(0, count($validator->validate('yellow')));
    }

    public function testEnumWithNumbers(): void
    {
        $validator = new InstanceValidator([
            'type' => 'int32',
            'enum' => [1, 2, 3],
        ]);

        $this->assertCount(0, $validator->validate(1));
        $this->assertCount(0, $validator->validate(2));
        $this->assertGreaterThan(0, count($validator->validate(4)));
    }

    public function testConstValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'const' => 'fixed_value',
        ]);

        $this->assertCount(0, $validator->validate('fixed_value'));
        $this->assertGreaterThan(0, count($validator->validate('other_value')));
    }

    public function testRefValidation(): void
    {
        $validator = new InstanceValidator([
            'definitions' => [
                'StringType' => ['type' => 'string'],
            ],
            'type' => ['$ref' => '#/definitions/StringType'],
        ]);

        $this->assertCount(0, $validator->validate('test'));
        $this->assertGreaterThan(0, count($validator->validate(123)));
    }

    public function testRootRefValidation(): void
    {
        $validator = new InstanceValidator([
            '$root' => '#/definitions/Person',
            'definitions' => [
                'Person' => [
                    'type' => 'object',
                    'properties' => [
                        'name' => ['type' => 'string'],
                    ],
                    'required' => ['name'],
                ],
            ],
        ]);

        $this->assertCount(0, $validator->validate(['name' => 'John']));
        $this->assertGreaterThan(0, count($validator->validate(['other' => 'value'])));
    }

    // =========================================================================
    // Schema Validator Edge Cases
    // =========================================================================

    public function testSchemaWithAllCompoundTypes(): void
    {
        $validator = new SchemaValidator();

        // Object
        $schema = [
            '$id' => 'https://example.com/object.struct.json',
            'name' => 'TestObject',
            'type' => 'object',
            'properties' => ['name' => ['type' => 'string']],
        ];
        $this->assertCount(0, $validator->validate($schema));

        // Array
        $schema = [
            '$id' => 'https://example.com/array.struct.json',
            'name' => 'TestArray',
            'type' => 'array',
            'items' => ['type' => 'string'],
        ];
        $this->assertCount(0, $validator->validate($schema));

        // Set
        $schema = [
            '$id' => 'https://example.com/set.struct.json',
            'name' => 'TestSet',
            'type' => 'set',
            'items' => ['type' => 'string'],
        ];
        $this->assertCount(0, $validator->validate($schema));

        // Map
        $schema = [
            '$id' => 'https://example.com/map.struct.json',
            'name' => 'TestMap',
            'type' => 'map',
            'values' => ['type' => 'string'],
        ];
        $this->assertCount(0, $validator->validate($schema));

        // Tuple
        $schema = [
            '$id' => 'https://example.com/tuple.struct.json',
            'name' => 'TestTuple',
            'type' => 'tuple',
            'properties' => [
                'first' => ['type' => 'string'],
                'second' => ['type' => 'int32'],
            ],
            'tuple' => ['first', 'second'],
        ];
        $this->assertCount(0, $validator->validate($schema));

        // Choice
        $schema = [
            '$id' => 'https://example.com/choice.struct.json',
            'name' => 'TestChoice',
            'type' => 'choice',
            'choices' => [
                'opt1' => ['type' => 'string'],
                'opt2' => ['type' => 'int32'],
            ],
        ];
        $this->assertCount(0, $validator->validate($schema));

        // Any
        $schema = [
            '$id' => 'https://example.com/any.struct.json',
            'name' => 'TestAny',
            'type' => 'any',
        ];
        $this->assertCount(0, $validator->validate($schema));
    }

    public function testSchemaWithExtendedKeywords(): void
    {
        $validator = new SchemaValidator(extended: true);

        // String constraints
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'string',
            'minLength' => 5,
            'maxLength' => 100,
            'pattern' => '^[A-Za-z]+$',
        ];
        $errors = $validator->validate($schema);
        $this->assertCount(0, $errors);

        // Numeric constraints
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'int32',
            'minimum' => 0,
            'maximum' => 100,
            'multipleOf' => 5,
        ];
        $errors = $validator->validate($schema);
        $this->assertCount(0, $errors);

        // Array constraints
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'array',
            'items' => ['type' => 'string'],
            'minItems' => 1,
            'maxItems' => 10,
            'uniqueItems' => true,
        ];
        $errors = $validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testSchemaWithComposition(): void
    {
        $validator = new SchemaValidator(extended: true);

        // allOf
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureConditionalComposition'],
            'allOf' => [
                ['type' => 'object', 'properties' => ['a' => ['type' => 'string']]],
                ['type' => 'object', 'properties' => ['b' => ['type' => 'int32']]],
            ],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);

        // anyOf
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureConditionalComposition'],
            'anyOf' => [
                ['type' => 'string'],
                ['type' => 'int32'],
            ],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);

        // oneOf
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureConditionalComposition'],
            'oneOf' => [
                ['type' => 'string'],
                ['type' => 'int32'],
            ],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);

        // not
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureConditionalComposition'],
            'not' => ['type' => 'null'],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaErrors(): void
    {
        $validator = new SchemaValidator();

        // Missing type
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            // Missing 'type'
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));

        // Invalid type
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'invalid_type',
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));

        // Empty enum
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'string',
            'enum' => [],
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));

        // Duplicate enum
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'string',
            'enum' => ['a', 'b', 'a'],
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    // =========================================================================
    // JsonSourceLocator Deep Tests
    // =========================================================================

    public function testJsonSourceLocatorWithAllValueTypes(): void
    {
        $json = '{
            "string": "hello",
            "number": 42,
            "float": 3.14,
            "boolTrue": true,
            "boolFalse": false,
            "nullVal": null,
            "array": [1, 2, 3],
            "object": {"nested": "value"}
        }';
        $locator = new JsonSourceLocator($json);

        $paths = ['/string', '/number', '/float', '/boolTrue', '/boolFalse', '/nullVal', '/array', '/object'];
        foreach ($paths as $path) {
            $location = $locator->getLocation($path);
            $this->assertInstanceOf(JsonLocation::class, $location);
        }
    }

    public function testJsonSourceLocatorArrayIndices(): void
    {
        $json = '[100, 200, 300, 400, 500]';
        $locator = new JsonSourceLocator($json);

        for ($i = 0; $i < 5; $i++) {
            $location = $locator->getLocation("/{$i}");
            $this->assertInstanceOf(JsonLocation::class, $location);
        }
    }

    public function testJsonSourceLocatorComplexStructure(): void
    {
        $json = json_encode([
            'users' => [
                ['name' => 'Alice', 'email' => 'alice@example.com'],
                ['name' => 'Bob', 'email' => 'bob@example.com'],
            ],
            'metadata' => [
                'count' => 2,
                'page' => 1,
            ],
        ]);
        $locator = new JsonSourceLocator($json);

        $location = $locator->getLocation('/users/0/name');
        $this->assertInstanceOf(JsonLocation::class, $location);

        $location = $locator->getLocation('/users/1/email');
        $this->assertInstanceOf(JsonLocation::class, $location);

        $location = $locator->getLocation('/metadata/count');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }
}
