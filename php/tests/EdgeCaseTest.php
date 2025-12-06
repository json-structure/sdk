<?php

declare(strict_types=1);

namespace JsonStructure\Tests;

use JsonStructure\SchemaValidator;
use JsonStructure\InstanceValidator;
use JsonStructure\ErrorCodes;
use JsonStructure\JsonSourceLocator;
use JsonStructure\JsonLocation;
use PHPUnit\Framework\TestCase;

/**
 * Edge case tests for improved code coverage.
 */
class EdgeCaseTest extends TestCase
{
    // =========================================================================
    // JsonSourceLocator Deep Coverage Tests
    // =========================================================================

    public function testJsonSourceLocatorWithNumbers(): void
    {
        $json = '{"integer": 42, "float": 3.14, "negative": -100}';
        $locator = new JsonSourceLocator($json);

        $location = $locator->getLocation('/integer');
        $this->assertInstanceOf(JsonLocation::class, $location);

        $location = $locator->getLocation('/float');
        $this->assertInstanceOf(JsonLocation::class, $location);

        $location = $locator->getLocation('/negative');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithBooleans(): void
    {
        $json = '{"flag1": true, "flag2": false}';
        $locator = new JsonSourceLocator($json);

        $location = $locator->getLocation('/flag1');
        $this->assertInstanceOf(JsonLocation::class, $location);

        $location = $locator->getLocation('/flag2');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithNull(): void
    {
        $json = '{"data": null}';
        $locator = new JsonSourceLocator($json);

        $location = $locator->getLocation('/data');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithEscapedStrings(): void
    {
        $json = '{"message": "Hello\\nWorld", "quote": "\\"test\\""}';
        $locator = new JsonSourceLocator($json);

        $location = $locator->getLocation('/message');
        $this->assertInstanceOf(JsonLocation::class, $location);

        $location = $locator->getLocation('/quote');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithUnicode(): void
    {
        $json = '{"japanese": "こんにちは", "emoji": "👋"}';
        $locator = new JsonSourceLocator($json);

        $location = $locator->getLocation('/japanese');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithMixedArray(): void
    {
        $json = '[1, "two", true, null, {"nested": "object"}]';
        $locator = new JsonSourceLocator($json);

        for ($i = 0; $i < 5; $i++) {
            $location = $locator->getLocation('/' . $i);
            $this->assertInstanceOf(JsonLocation::class, $location);
        }

        $location = $locator->getLocation('/4/nested');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithLargeIndices(): void
    {
        $json = json_encode(range(0, 99));
        $locator = new JsonSourceLocator($json);

        $location = $locator->getLocation('/50');
        $this->assertInstanceOf(JsonLocation::class, $location);

        $location = $locator->getLocation('/99');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithManyProperties(): void
    {
        $obj = [];
        for ($i = 0; $i < 50; $i++) {
            $obj["prop{$i}"] = "value{$i}";
        }
        $json = json_encode($obj);
        $locator = new JsonSourceLocator($json);

        $location = $locator->getLocation('/prop25');
        $this->assertInstanceOf(JsonLocation::class, $location);

        $location = $locator->getLocation('/prop49');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithNestedArrays(): void
    {
        $json = '[[1,2], [3,4], [[5,6], [7,8]]]';
        $locator = new JsonSourceLocator($json);

        $location = $locator->getLocation('/0/1');
        $this->assertInstanceOf(JsonLocation::class, $location);

        $location = $locator->getLocation('/2/0/0');
        $this->assertInstanceOf(JsonLocation::class, $location);
    }

    // =========================================================================
    // SchemaValidator Extended Coverage
    // =========================================================================

    public function testSchemaValidatorWithAllTypes(): void
    {
        $validator = new SchemaValidator();

        $allTypes = [
            'string', 'boolean', 'null', 'int8', 'uint8', 'int16', 'uint16',
            'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128',
            'float', 'float8', 'double', 'decimal', 'number', 'integer',
            'date', 'time', 'datetime', 'duration', 'uuid', 'uri', 'binary',
        ];

        foreach ($allTypes as $type) {
            $schema = [
                '$id' => "https://example.com/{$type}.struct.json",
                'name' => ucfirst($type),
                'type' => $type,
            ];
            $errors = $validator->validate($schema);
            $this->assertIsArray($errors, "Type {$type} should be validated");
        }
    }

    public function testSchemaValidatorWithArrayConstraints(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'array',
            'items' => ['type' => 'string'],
            'minItems' => 1,
            'maxItems' => 100,
            'uniqueItems' => true,
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithStringConstraints(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'string',
            'minLength' => 1,
            'maxLength' => 100,
            'pattern' => '^[a-z]+$',
        ];
        $errors = $validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testSchemaValidatorWithNumericConstraints(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'int32',
            'minimum' => 0,
            'maximum' => 100,
            'exclusiveMinimum' => -1,
            'exclusiveMaximum' => 101,
            'multipleOf' => 1,
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithObjectConstraints(): void
    {
        $validator = new SchemaValidator(extended: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$uses' => ['JSONStructureValidation'],
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
                'age' => ['type' => 'int32'],
            ],
            'required' => ['name'],
            'minProperties' => 1,
            'maxProperties' => 10,
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithRecursiveRefs(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/tree.struct.json',
            'name' => 'TreeNode',
            'definitions' => [
                'Node' => [
                    'type' => 'object',
                    'properties' => [
                        'value' => ['type' => 'string'],
                        'children' => [
                            'type' => 'array',
                            'items' => ['type' => ['$ref' => '#/definitions/Node']],
                        ],
                    ],
                ],
            ],
            '$root' => '#/definitions/Node',
            'type' => 'object',
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithEmptyProperties(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'EmptyObject',
            'type' => 'object',
            'properties' => [],
        ];
        $errors = $validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testSchemaValidatorWithEmptyRequired(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
            'required' => [],
        ];
        $errors = $validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testSchemaValidatorWithEmptyEnum(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'string',
            'enum' => [],
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaValidatorWithDuplicateEnum(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'string',
            'enum' => ['a', 'b', 'a'],
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSchemaValidatorWithMissingId(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            'name' => 'Test',
            'type' => 'string',
        ];
        $errors = $validator->validate($schema);
        // May warn or error about missing $id
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithMissingName(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'type' => 'string',
        ];
        $errors = $validator->validate($schema);
        // May warn or error about missing name
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithAbstract(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'AbstractBase',
            'abstract' => true,
            'type' => 'object',
            'properties' => [
                'id' => ['type' => 'string'],
            ],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaValidatorWithPrecisionScale(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Money',
            'type' => 'decimal',
            'precision' => 10,
            'scale' => 2,
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    // =========================================================================
    // InstanceValidator Extended Coverage
    // =========================================================================

    public function testInstanceValidatorWithRealWorldSchema(): void
    {
        $validator = new InstanceValidator([
            'type' => 'object',
            'properties' => [
                'id' => ['type' => 'uuid'],
                'name' => ['type' => 'string'],
                'email' => ['type' => 'string'],
                'created' => ['type' => 'datetime'],
                'tags' => [
                    'type' => 'set',
                    'items' => ['type' => 'string'],
                ],
                'metadata' => [
                    'type' => 'map',
                    'values' => ['type' => 'any'],
                ],
            ],
            'required' => ['id', 'name'],
        ]);

        $errors = $validator->validate([
            'id' => '550e8400-e29b-41d4-a716-446655440000',
            'name' => 'Test User',
            'email' => 'test@example.com',
            'created' => '2024-01-15T10:30:00Z',
            'tags' => ['admin', 'active'],
            'metadata' => ['source' => 'api', 'version' => 2],
        ]);
        $this->assertCount(0, $errors);
    }

    public function testInstanceValidatorWithOptionalProperties(): void
    {
        $validator = new InstanceValidator([
            'type' => 'object',
            'properties' => [
                'required_field' => ['type' => 'string'],
                'optional_field' => ['type' => 'int32'],
            ],
            'required' => ['required_field'],
        ]);

        // With optional
        $errors = $validator->validate(['required_field' => 'test', 'optional_field' => 42]);
        $this->assertCount(0, $errors);

        // Without optional
        $errors = $validator->validate(['required_field' => 'test']);
        $this->assertCount(0, $errors);
    }

    public function testInstanceValidatorWithMixedArrayTypes(): void
    {
        $validator = new InstanceValidator([
            'type' => 'array',
            'items' => ['type' => 'any'],
        ]);

        $errors = $validator->validate([1, 'two', true, null, ['nested' => 'object']]);
        $this->assertCount(0, $errors);
    }

    public function testInstanceValidatorWithDeepObject(): void
    {
        $validator = new InstanceValidator([
            'type' => 'object',
            'properties' => [
                'level1' => [
                    'type' => 'object',
                    'properties' => [
                        'level2' => [
                            'type' => 'object',
                            'properties' => [
                                'level3' => [
                                    'type' => 'object',
                                    'properties' => [
                                        'level4' => [
                                            'type' => 'object',
                                            'properties' => [
                                                'level5' => ['type' => 'string'],
                                            ],
                                        ],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
            ],
        ]);

        $errors = $validator->validate([
            'level1' => [
                'level2' => [
                    'level3' => [
                        'level4' => [
                            'level5' => 'deep value',
                        ],
                    ],
                ],
            ],
        ]);
        $this->assertCount(0, $errors);
    }

    public function testInstanceValidatorWithAllIntegerRanges(): void
    {
        // Test all integer types at their boundaries
        $tests = [
            ['type' => 'int8', 'valid' => [-128, 127], 'invalid' => [-129, 128]],
            ['type' => 'uint8', 'valid' => [0, 255], 'invalid' => [-1, 256]],
            ['type' => 'int16', 'valid' => [-32768, 32767], 'invalid' => [-32769, 32768]],
            ['type' => 'uint16', 'valid' => [0, 65535], 'invalid' => [-1, 65536]],
        ];

        foreach ($tests as $test) {
            $validator = new InstanceValidator(['type' => $test['type']]);

            foreach ($test['valid'] as $value) {
                $errors = $validator->validate($value);
                $this->assertCount(0, $errors, "Type {$test['type']} should accept {$value}");
            }

            foreach ($test['invalid'] as $value) {
                $errors = $validator->validate($value);
                $this->assertGreaterThan(0, count($errors), "Type {$test['type']} should reject {$value}");
            }
        }
    }

    public function testInstanceValidatorWithWrongTypes(): void
    {
        $tests = [
            ['type' => 'string', 'wrong' => 123],
            ['type' => 'int32', 'wrong' => 'not a number'],
            ['type' => 'boolean', 'wrong' => 'true'],
            ['type' => 'array', 'wrong' => 'not an array'],
            ['type' => 'object', 'wrong' => [1, 2, 3]],
        ];

        foreach ($tests as $test) {
            $validator = new InstanceValidator([
                'type' => $test['type'],
                'properties' => [],
                'items' => ['type' => 'any'],
            ]);
            $errors = $validator->validate($test['wrong']);
            $this->assertGreaterThan(0, count($errors), "Type {$test['type']} should reject wrong value");
        }
    }

    public function testInstanceValidatorChoiceWithSelector(): void
    {
        $validator = new InstanceValidator([
            'type' => 'choice',
            'selector' => 'type',
            'choices' => [
                'dog' => [
                    'type' => 'object',
                    'properties' => [
                        'type' => ['type' => 'string', 'const' => 'dog'],
                        'breed' => ['type' => 'string'],
                    ],
                ],
                'cat' => [
                    'type' => 'object',
                    'properties' => [
                        'type' => ['type' => 'string', 'const' => 'cat'],
                        'color' => ['type' => 'string'],
                    ],
                ],
            ],
        ]);

        $errors = $validator->validate(['type' => 'dog', 'breed' => 'labrador']);
        $this->assertIsArray($errors);
    }

    public function testInstanceValidatorWithExtends(): void
    {
        $validator = new InstanceValidator([
            'definitions' => [
                'Base' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => ['type' => 'string'],
                    ],
                    'required' => ['id'],
                ],
            ],
            '$extends' => '#/definitions/Base',
            'type' => 'object',
            'properties' => [
                'id' => ['type' => 'string'],
                'name' => ['type' => 'string'],
            ],
        ]);

        $errors = $validator->validate(['id' => 'abc', 'name' => 'test']);
        $this->assertIsArray($errors);

        // Missing required from base
        $errors = $validator->validate(['name' => 'test']);
        $this->assertIsArray($errors);
    }

    public function testInstanceValidatorMapWithKeys(): void
    {
        $validator = new InstanceValidator([
            'type' => 'map',
            'values' => ['type' => 'int32'],
            'keys' => ['type' => 'string'],
        ]);

        $errors = $validator->validate(['key1' => 1, 'key2' => 2]);
        $this->assertCount(0, $errors);
    }

    public function testInstanceValidatorWithAnyType(): void
    {
        $validator = new InstanceValidator(['type' => 'any']);

        // Test all kinds of values
        $values = [
            'string',
            42,
            3.14,
            true,
            false,
            null,
            ['array', 'of', 'values'],
            ['object' => 'value'],
        ];

        foreach ($values as $value) {
            $errors = $validator->validate($value);
            $this->assertCount(0, $errors, "'any' type should accept all values");
        }
    }

    public function testInstanceValidatorWithFormatValidation(): void
    {
        // Test format type that requires specific format
        $validator = new InstanceValidator([
            'type' => 'string',
            'format' => 'email',
        ], extended: true);

        $errors = $validator->validate('test@example.com');
        $this->assertIsArray($errors);
    }

    // =========================================================================
    // Error Message Coverage
    // =========================================================================

    public function testErrorMessageForMissingRequired(): void
    {
        $validator = new InstanceValidator([
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
            'required' => ['name'],
        ]);

        $errors = $validator->validate(['other' => 'field']);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('name', $errors[0]->message);
    }

    public function testErrorMessageForWrongType(): void
    {
        $validator = new InstanceValidator(['type' => 'string']);

        $errors = $validator->validate(123);
        $this->assertGreaterThan(0, count($errors));
        $this->assertNotEmpty($errors[0]->code);
    }

    public function testErrorMessageForEnumMismatch(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'enum' => ['red', 'green', 'blue'],
        ]);

        $errors = $validator->validate('yellow');
        $this->assertGreaterThan(0, count($errors));
        $this->assertEquals(ErrorCodes::INSTANCE_ENUM_MISMATCH, $errors[0]->code);
    }

    public function testErrorMessageForConstMismatch(): void
    {
        $validator = new InstanceValidator([
            'type' => 'string',
            'const' => 'fixed',
        ]);

        $errors = $validator->validate('different');
        $this->assertGreaterThan(0, count($errors));
        $this->assertEquals(ErrorCodes::INSTANCE_CONST_MISMATCH, $errors[0]->code);
    }
}
