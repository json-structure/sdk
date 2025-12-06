<?php

declare(strict_types=1);

namespace JsonStructure\Tests;

use JsonStructure\InstanceValidator;
use JsonStructure\ErrorCodes;
use PHPUnit\Framework\TestCase;

class InstanceValidatorTest extends TestCase
{
    public function testValidSimpleObject(): void
    {
        $schema = [
            '$id' => 'https://example.com/person.struct.json',
            'name' => 'Person',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
                'age' => ['type' => 'int32'],
            ],
            'required' => ['name'],
        ];

        $instance = [
            'name' => 'John Doe',
            'age' => 30,
        ];

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($instance);

        $this->assertCount(0, $errors);
    }

    public function testMissingRequiredProperty(): void
    {
        $schema = [
            '$id' => 'https://example.com/person.struct.json',
            'name' => 'Person',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
                'age' => ['type' => 'int32'],
            ],
            'required' => ['name'],
        ];

        $instance = [
            'age' => 30,
        ];

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($instance);

        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('name', (string) $errors[0]);
    }

    public function testInvalidType(): void
    {
        $schema = [
            '$id' => 'https://example.com/person.struct.json',
            'name' => 'Person',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
                'age' => ['type' => 'int32'],
            ],
        ];

        $instance = [
            'name' => 'John Doe',
            'age' => 'thirty', // Should be an integer
        ];

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($instance);

        $this->assertGreaterThan(0, count($errors));
    }

    public function testAllPrimitiveTypes(): void
    {
        $testCases = [
            ['type' => 'string', 'value' => 'hello', 'valid' => true],
            ['type' => 'string', 'value' => 123, 'valid' => false],
            ['type' => 'number', 'value' => 3.14, 'valid' => true],
            ['type' => 'number', 'value' => 'not a number', 'valid' => false],
            ['type' => 'boolean', 'value' => true, 'valid' => true],
            ['type' => 'boolean', 'value' => 'true', 'valid' => false],
            ['type' => 'null', 'value' => null, 'valid' => true],
            ['type' => 'null', 'value' => 'null', 'valid' => false],
            ['type' => 'int8', 'value' => 127, 'valid' => true],
            ['type' => 'int8', 'value' => 128, 'valid' => false],
            ['type' => 'int8', 'value' => -128, 'valid' => true],
            ['type' => 'int8', 'value' => -129, 'valid' => false],
            ['type' => 'uint8', 'value' => 0, 'valid' => true],
            ['type' => 'uint8', 'value' => 255, 'valid' => true],
            ['type' => 'uint8', 'value' => -1, 'valid' => false],
            ['type' => 'uint8', 'value' => 256, 'valid' => false],
            ['type' => 'int16', 'value' => 32767, 'valid' => true],
            ['type' => 'int16', 'value' => -32768, 'valid' => true],
            ['type' => 'uint16', 'value' => 65535, 'valid' => true],
            ['type' => 'int32', 'value' => 2147483647, 'valid' => true],
            ['type' => 'integer', 'value' => 100, 'valid' => true],
            ['type' => 'uint32', 'value' => 4294967295, 'valid' => true],
            ['type' => 'int64', 'value' => '9223372036854775807', 'valid' => true],
            ['type' => 'int64', 'value' => 'not a number', 'valid' => false],
            ['type' => 'uint64', 'value' => '18446744073709551615', 'valid' => true],
            ['type' => 'float', 'value' => 3.14, 'valid' => true],
            ['type' => 'double', 'value' => 3.14159265359, 'valid' => true],
            ['type' => 'decimal', 'value' => '123.456', 'valid' => true],
            ['type' => 'decimal', 'value' => 123.456, 'valid' => false],
            ['type' => 'date', 'value' => '2024-01-15', 'valid' => true],
            ['type' => 'date', 'value' => '2024-1-15', 'valid' => false],
            ['type' => 'time', 'value' => '14:30:00', 'valid' => true],
            ['type' => 'time', 'value' => '2:30 PM', 'valid' => false],
            ['type' => 'datetime', 'value' => '2024-01-15T14:30:00Z', 'valid' => true],
            ['type' => 'datetime', 'value' => '2024-01-15 14:30:00', 'valid' => false],
            ['type' => 'duration', 'value' => 'P1Y2M3D', 'valid' => true],
            ['type' => 'duration', 'value' => '1 year', 'valid' => false],
            ['type' => 'uuid', 'value' => '550e8400-e29b-41d4-a716-446655440000', 'valid' => true],
            ['type' => 'uuid', 'value' => 'not-a-uuid', 'valid' => false],
            ['type' => 'uri', 'value' => 'https://example.com', 'valid' => true],
            ['type' => 'uri', 'value' => 'not-a-uri', 'valid' => false],
            ['type' => 'binary', 'value' => 'SGVsbG8gV29ybGQh', 'valid' => true],
            ['type' => 'jsonpointer', 'value' => '#/properties/name', 'valid' => true],
            ['type' => 'jsonpointer', 'value' => 'not/a/pointer', 'valid' => false],
        ];

        foreach ($testCases as $testCase) {
            $schema = [
                '$id' => 'https://example.com/test.struct.json',
                'name' => 'Test',
                'type' => $testCase['type'],
            ];

            $validator = new InstanceValidator($schema, extended: true);
            $errors = $validator->validate($testCase['value']);

            if ($testCase['valid']) {
                $this->assertCount(
                    0,
                    $errors,
                    "Type '{$testCase['type']}' with value " . json_encode($testCase['value']) . " should be valid"
                );
            } else {
                $this->assertGreaterThan(
                    0,
                    count($errors),
                    "Type '{$testCase['type']}' with value " . json_encode($testCase['value']) . " should be invalid"
                );
            }
        }
    }

    public function testArrayType(): void
    {
        $schema = [
            '$id' => 'https://example.com/array.struct.json',
            'name' => 'StringArray',
            'type' => 'array',
            'items' => ['type' => 'string'],
        ];

        $validInstance = ['hello', 'world'];
        $invalidInstance = ['hello', 123];

        $validator = new InstanceValidator($schema, extended: true);

        $this->assertCount(0, $validator->validate($validInstance));

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertGreaterThan(0, count($validator->validate($invalidInstance)));
    }

    public function testSetType(): void
    {
        $schema = [
            '$id' => 'https://example.com/set.struct.json',
            'name' => 'StringSet',
            'type' => 'set',
            'items' => ['type' => 'string'],
        ];

        $validInstance = ['apple', 'banana', 'cherry'];
        $duplicateInstance = ['apple', 'banana', 'apple'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validInstance));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($duplicateInstance);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('duplicate', strtolower((string) $errors[0]));
    }

    public function testMapType(): void
    {
        $schema = [
            '$id' => 'https://example.com/map.struct.json',
            'name' => 'StringMap',
            'type' => 'map',
            'values' => ['type' => 'string'],
        ];

        $validInstance = [
            'key1' => 'value1',
            'key2' => 'value2',
        ];
        $invalidInstance = [
            'key1' => 'value1',
            'key2' => 123,
        ];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validInstance));

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertGreaterThan(0, count($validator->validate($invalidInstance)));
    }

    public function testTupleType(): void
    {
        $schema = [
            '$id' => 'https://example.com/tuple.struct.json',
            'name' => 'Point',
            'type' => 'tuple',
            'properties' => [
                'x' => ['type' => 'float'],
                'y' => ['type' => 'float'],
            ],
            'tuple' => ['x', 'y'],
        ];

        $validInstance = [1.0, 2.5];
        $invalidLengthInstance = [1.0];
        $invalidTypeInstance = [1.0, 'two'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validInstance));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidLengthInstance);
        $this->assertGreaterThan(0, count($errors));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidTypeInstance);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testChoiceType(): void
    {
        $schema = [
            '$id' => 'https://example.com/choice.struct.json',
            'name' => 'Shape',
            'type' => 'choice',
            'choices' => [
                'circle' => [
                    'type' => 'object',
                    'properties' => [
                        'radius' => ['type' => 'float'],
                    ],
                ],
                'rectangle' => [
                    'type' => 'object',
                    'properties' => [
                        'width' => ['type' => 'float'],
                        'height' => ['type' => 'float'],
                    ],
                ],
            ],
        ];

        $validCircle = ['circle' => ['radius' => 5.0]];
        $validRectangle = ['rectangle' => ['width' => 10.0, 'height' => 20.0]];
        $invalidChoice = ['triangle' => ['base' => 5.0]];
        $tooManyProperties = ['circle' => ['radius' => 5.0], 'rectangle' => ['width' => 10.0]];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validCircle));

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validRectangle));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidChoice);
        $this->assertGreaterThan(0, count($errors));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($tooManyProperties);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testAnyType(): void
    {
        $schema = [
            '$id' => 'https://example.com/any.struct.json',
            'name' => 'Anything',
            'type' => 'any',
        ];

        $testValues = [
            'string',
            123,
            3.14,
            true,
            null,
            ['array'],
            ['object' => 'value'],
        ];

        foreach ($testValues as $value) {
            $validator = new InstanceValidator($schema, extended: true);
            $errors = $validator->validate($value);
            $this->assertCount(0, $errors, "Any type should accept value: " . json_encode($value));
        }
    }

    public function testEnumValidation(): void
    {
        $schema = [
            '$id' => 'https://example.com/status.struct.json',
            'name' => 'Status',
            'type' => 'string',
            'enum' => ['pending', 'approved', 'rejected'],
        ];

        $validValue = 'approved';
        $invalidValue = 'unknown';

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('enum', strtolower((string) $errors[0]));
    }

    public function testConstValidation(): void
    {
        $schema = [
            '$id' => 'https://example.com/const.struct.json',
            'name' => 'Constant',
            'type' => 'string',
            'const' => 'fixed_value',
        ];

        $validValue = 'fixed_value';
        $invalidValue = 'other_value';

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('const', strtolower((string) $errors[0]));
    }

    public function testMinLength(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'string',
            'minLength' => 5,
        ];

        $validValue = 'hello';
        $invalidValue = 'hi';

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMaxLength(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'string',
            'maxLength' => 5,
        ];

        $validValue = 'hello';
        $invalidValue = 'hello world';

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testPattern(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'string',
            'pattern' => '^[A-Z][a-z]+$',
        ];

        $validValue = 'Hello';
        $invalidValue = 'hello';

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinimum(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'int32',
            'minimum' => 10,
        ];

        $validValue = 10;
        $invalidValue = 5;

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMaximum(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'int32',
            'maximum' => 100,
        ];

        $validValue = 100;
        $invalidValue = 150;

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testExclusiveMinimum(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'int32',
            'exclusiveMinimum' => 10,
        ];

        $validValue = 11;
        $invalidValue = 10;

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testExclusiveMaximum(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'int32',
            'exclusiveMaximum' => 100,
        ];

        $validValue = 99;
        $invalidValue = 100;

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMultipleOf(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'int32',
            'multipleOf' => 5,
        ];

        $validValue = 15;
        $invalidValue = 17;

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinItems(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'array',
            'items' => ['type' => 'string'],
            'minItems' => 2,
        ];

        $validValue = ['a', 'b'];
        $invalidValue = ['a'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMaxItems(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'array',
            'items' => ['type' => 'string'],
            'maxItems' => 3,
        ];

        $validValue = ['a', 'b', 'c'];
        $invalidValue = ['a', 'b', 'c', 'd'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinProperties(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'object',
            'properties' => [
                'a' => ['type' => 'string'],
                'b' => ['type' => 'string'],
                'c' => ['type' => 'string'],
            ],
            'minProperties' => 2,
        ];

        $validValue = ['a' => 'x', 'b' => 'y'];
        $invalidValue = ['a' => 'x'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMaxProperties(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'object',
            'properties' => [
                'a' => ['type' => 'string'],
                'b' => ['type' => 'string'],
                'c' => ['type' => 'string'],
            ],
            'maxProperties' => 2,
        ];

        $validValue = ['a' => 'x', 'b' => 'y'];
        $invalidValue = ['a' => 'x', 'b' => 'y', 'c' => 'z'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinEntries(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'map',
            'values' => ['type' => 'string'],
            'minEntries' => 2,
        ];

        $validValue = ['key1' => 'x', 'key2' => 'y'];
        $invalidValue = ['key1' => 'x'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMaxEntries(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'map',
            'values' => ['type' => 'string'],
            'maxEntries' => 2,
        ];

        $validValue = ['key1' => 'x', 'key2' => 'y'];
        $invalidValue = ['key1' => 'x', 'key2' => 'y', 'key3' => 'z'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testAdditionalPropertiesFalse(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
            'additionalProperties' => false,
        ];

        $validValue = ['name' => 'John'];
        $invalidValue = ['name' => 'John', 'age' => 30];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testAdditionalPropertiesSchema(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
            'additionalProperties' => ['type' => 'int32'],
        ];

        $validValue = ['name' => 'John', 'age' => 30];
        $invalidValue = ['name' => 'John', 'age' => 'thirty'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testDependentRequired(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'object',
            'properties' => [
                'creditCard' => ['type' => 'string'],
                'billingAddress' => ['type' => 'string'],
            ],
            'dependentRequired' => [
                'creditCard' => ['billingAddress'],
            ],
        ];

        $validValue = ['creditCard' => '1234', 'billingAddress' => '123 Main St'];
        $invalidValue = ['creditCard' => '1234'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testUnionTypes(): void
    {
        $schema = [
            '$id' => 'https://example.com/union.struct.json',
            'name' => 'StringOrNumber',
            'type' => ['string', 'int32'],
        ];

        $stringValue = 'hello';
        $intValue = 42;
        $invalidValue = true;

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($stringValue));

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($intValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testRefInType(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Person',
            'type' => 'object',
            'properties' => [
                'address' => [
                    'type' => [
                        '$ref' => '#/definitions/Address',
                    ],
                ],
            ],
            'definitions' => [
                'Address' => [
                    'type' => 'object',
                    'properties' => [
                        'street' => ['type' => 'string'],
                        'city' => ['type' => 'string'],
                    ],
                    'required' => ['street', 'city'],
                ],
            ],
        ];

        $validValue = [
            'address' => [
                'street' => '123 Main St',
                'city' => 'Springfield',
            ],
        ];

        $invalidValue = [
            'address' => [
                'street' => '123 Main St',
            ],
        ];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testRootRef(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
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
        ];

        $validValue = ['name' => 'John'];
        $invalidValue = [];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testAllOf(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureConditionalComposition'],
            'allOf' => [
                [
                    'type' => 'object',
                    'properties' => [
                        'name' => ['type' => 'string'],
                    ],
                    'required' => ['name'],
                ],
                [
                    'type' => 'object',
                    'properties' => [
                        'age' => ['type' => 'int32'],
                    ],
                    'required' => ['age'],
                ],
            ],
        ];

        $validValue = ['name' => 'John', 'age' => 30];
        $invalidValue = ['name' => 'John'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testAnyOf(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureConditionalComposition'],
            'anyOf' => [
                ['type' => 'string'],
                ['type' => 'int32'],
            ],
        ];

        $validString = 'hello';
        $validInt = 42;
        $invalidValue = true;

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validString));

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validInt));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testOneOf(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureConditionalComposition'],
            'oneOf' => [
                [
                    'type' => 'int32',
                    'minimum' => 0,
                    'maximum' => 10,
                ],
                [
                    'type' => 'int32',
                    'minimum' => 20,
                    'maximum' => 30,
                ],
            ],
        ];

        $validLow = 5;
        $validHigh = 25;
        $invalidBetween = 15; // Matches neither

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validLow));

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validHigh));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidBetween);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testNot(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureConditionalComposition'],
            'type' => 'string',
            'not' => [
                'type' => 'string',
                'pattern' => '^bad',
            ],
        ];

        $validValue = 'good';
        $invalidValue = 'bad_value';

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testIfThenElse(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureConditionalComposition', 'JSONStructureValidation'],
            'type' => 'object',
            'properties' => [
                'type' => ['type' => 'string'],
                'value' => ['type' => 'int32'],
            ],
            'if' => [
                'type' => 'object',
                'properties' => [
                    'type' => ['type' => 'string', 'const' => 'positive'],
                ],
            ],
            'then' => [
                'type' => 'object',
                'properties' => [
                    'value' => ['type' => 'int32', 'minimum' => 0],
                ],
            ],
            'else' => [
                'type' => 'object',
                'properties' => [
                    'value' => ['type' => 'int32', 'maximum' => 0],
                ],
            ],
        ];

        $validPositive = ['type' => 'positive', 'value' => 10];
        $validNegative = ['type' => 'negative', 'value' => -10];
        $invalidPositive = ['type' => 'positive', 'value' => -10];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validPositive));

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validNegative));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidPositive);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testEmailFormat(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'string',
            'format' => 'email',
        ];

        $validEmail = 'test@example.com';
        $invalidEmail = 'not-an-email';

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validEmail));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidEmail);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testIpv4Format(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'string',
            'format' => 'ipv4',
        ];

        $validIp = '192.168.1.1';
        $invalidIp = '999.999.999.999';

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validIp));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidIp);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testKeyNames(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'map',
            'values' => ['type' => 'string'],
            'keyNames' => [
                'type' => 'string',
                'pattern' => '^[a-z]+$',
            ],
        ];

        $validValue = ['abc' => 'x', 'def' => 'y'];
        $invalidValue = ['abc' => 'x', 'DEF' => 'y'];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testContains(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'array',
            'items' => ['type' => 'int32'],
            'contains' => [
                'type' => 'int32',
                'minimum' => 10,
            ],
        ];

        $validValue = [1, 2, 15, 3];
        $invalidValue = [1, 2, 3, 4];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinContains(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'array',
            'items' => ['type' => 'int32'],
            'contains' => [
                'type' => 'int32',
                'minimum' => 10,
            ],
            'minContains' => 2,
        ];

        $validValue = [1, 15, 20, 3];
        $invalidValue = [1, 15, 3, 4];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMaxContains(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'array',
            'items' => ['type' => 'int32'],
            'contains' => [
                'type' => 'int32',
                'minimum' => 10,
            ],
            'maxContains' => 2,
        ];

        $validValue = [1, 15, 20, 3];
        $invalidValue = [1, 15, 20, 30];

        $validator = new InstanceValidator($schema, extended: true);
        $this->assertCount(0, $validator->validate($validValue));

        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($invalidValue);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMaxValidationDepth(): void
    {
        // Create a self-referencing schema
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Nested',
            'type' => 'object',
            'properties' => [
                'value' => ['type' => 'string'],
                'nested' => [
                    'type' => [
                        '$ref' => '#',
                    ],
                ],
            ],
        ];

        // Create a deeply nested instance
        $instance = ['value' => 'root'];
        $current = &$instance;
        for ($i = 0; $i < 100; $i++) {
            $current['nested'] = ['value' => "level{$i}"];
            $current = &$current['nested'];
        }

        $validator = new InstanceValidator($schema, extended: true, maxValidationDepth: 10);
        $errors = $validator->validate($instance);

        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('depth', strtolower((string) $errors[0]));
    }
}
