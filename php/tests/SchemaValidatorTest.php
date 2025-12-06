<?php

declare(strict_types=1);

namespace JsonStructure\Tests;

use JsonStructure\SchemaValidator;
use JsonStructure\ErrorCodes;
use PHPUnit\Framework\TestCase;

class SchemaValidatorTest extends TestCase
{
    private SchemaValidator $validator;

    protected function setUp(): void
    {
        $this->validator = new SchemaValidator(extended: true);
    }

    public function testValidSimpleSchema(): void
    {
        $schema = [
            '$id' => 'https://example.com/person.struct.json',
            '$schema' => 'https://json-structure.org/meta/core/v0/#',
            'name' => 'Person',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
                'age' => ['type' => 'int32'],
            ],
            'required' => ['name'],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors, 'Simple schema should be valid');
    }

    public function testMissingId(): void
    {
        $schema = [
            '$schema' => 'https://json-structure.org/meta/core/v0/#',
            'name' => 'Person',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('$id', (string) $errors[0]);
    }

    public function testMissingNameWithType(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$schema' => 'https://json-structure.org/meta/core/v0/#',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('name', (string) $errors[0]);
    }

    public function testInvalidType(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$schema' => 'https://json-structure.org/meta/core/v0/#',
            'name' => 'Test',
            'type' => 'invalid_type',
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('invalid_type', (string) $errors[0]);
    }

    public function testAllPrimitiveTypes(): void
    {
        $primitiveTypes = [
            'string', 'number', 'integer', 'boolean', 'null',
            'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
            'int64', 'uint64', 'int128', 'uint128',
            'float8', 'float', 'double', 'decimal',
            'date', 'datetime', 'time', 'duration',
            'uuid', 'uri', 'binary', 'jsonpointer',
        ];

        foreach ($primitiveTypes as $type) {
            $schema = [
                '$id' => "https://example.com/{$type}.struct.json",
                'name' => ucfirst($type) . 'Type',
                'type' => $type,
            ];

            $errors = $this->validator->validate($schema);
            $this->assertCount(0, $errors, "Primitive type '{$type}' should be valid");
        }
    }

    public function testObjectWithProperties(): void
    {
        $schema = [
            '$id' => 'https://example.com/object.struct.json',
            'name' => 'TestObject',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
                'age' => ['type' => 'int32'],
                'isActive' => ['type' => 'boolean'],
            ],
            'required' => ['name'],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testObjectMissingProperties(): void
    {
        $schema = [
            '$id' => 'https://example.com/object.struct.json',
            'name' => 'TestObject',
            'type' => 'object',
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('properties', (string) $errors[0]);
    }

    public function testArrayType(): void
    {
        $schema = [
            '$id' => 'https://example.com/array.struct.json',
            'name' => 'TestArray',
            'type' => 'array',
            'items' => ['type' => 'string'],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testArrayMissingItems(): void
    {
        $schema = [
            '$id' => 'https://example.com/array.struct.json',
            'name' => 'TestArray',
            'type' => 'array',
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('items', (string) $errors[0]);
    }

    public function testSetType(): void
    {
        $schema = [
            '$id' => 'https://example.com/set.struct.json',
            'name' => 'TestSet',
            'type' => 'set',
            'items' => ['type' => 'string'],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testMapType(): void
    {
        $schema = [
            '$id' => 'https://example.com/map.struct.json',
            'name' => 'TestMap',
            'type' => 'map',
            'values' => ['type' => 'string'],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testMapMissingValues(): void
    {
        $schema = [
            '$id' => 'https://example.com/map.struct.json',
            'name' => 'TestMap',
            'type' => 'map',
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('values', (string) $errors[0]);
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

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testTupleMissingOrder(): void
    {
        $schema = [
            '$id' => 'https://example.com/tuple.struct.json',
            'name' => 'Point',
            'type' => 'tuple',
            'properties' => [
                'x' => ['type' => 'float'],
                'y' => ['type' => 'float'],
            ],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('tuple', (string) $errors[0]);
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

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testChoiceMissingChoices(): void
    {
        $schema = [
            '$id' => 'https://example.com/choice.struct.json',
            'name' => 'Shape',
            'type' => 'choice',
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('choices', (string) $errors[0]);
    }

    public function testRequiredPropertyNotDefined(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
            ],
            'required' => ['name', 'undefined_prop'],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('undefined_prop', (string) $errors[0]);
    }

    public function testEnumEmptyArray(): void
    {
        $schema = [
            '$id' => 'https://example.com/enum.struct.json',
            'name' => 'Status',
            'type' => 'string',
            'enum' => [],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('enum', (string) $errors[0]);
    }

    public function testEnumDuplicates(): void
    {
        $schema = [
            '$id' => 'https://example.com/enum.struct.json',
            'name' => 'Status',
            'type' => 'string',
            'enum' => ['active', 'inactive', 'active'],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('duplicate', strtolower((string) $errors[0]));
    }

    public function testDefinitions(): void
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
                ],
            ],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testRefNotFound(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Person',
            'type' => 'object',
            'properties' => [
                'address' => [
                    'type' => [
                        '$ref' => '#/definitions/NonExistent',
                    ],
                ],
            ],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
        $this->assertStringContainsString('not found', (string) $errors[0]);
    }

    public function testBareRefNotAllowed(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'object',
            'properties' => [
                'ref' => [
                    '$ref' => '#/definitions/Other',
                ],
            ],
            'definitions' => [
                'Other' => [
                    'type' => 'string',
                ],
            ],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testAnyType(): void
    {
        $schema = [
            '$id' => 'https://example.com/any.struct.json',
            'name' => 'Anything',
            'type' => 'any',
        ];

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testValidationKeywordsWithoutUses(): void
    {
        $validator = new SchemaValidator(extended: true, warnOnUnusedExtensionKeywords: true);

        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'string',
            'minLength' => 1,
        ];

        $errors = $validator->validate($schema);
        $warnings = $validator->getWarnings();

        // Should produce a warning for minLength without $uses
        $this->assertGreaterThan(0, count($warnings));
    }

    public function testValidationKeywordsWithUses(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'string',
            'minLength' => 1,
            'maxLength' => 100,
        ];

        $errors = $this->validator->validate($schema);
        $warnings = $this->validator->getWarnings();

        $this->assertCount(0, $errors);
        // Should not produce warnings for validation keywords with $uses
        $this->assertCount(0, array_filter($warnings, fn($w) => str_contains((string) $w, 'minLength')));
    }

    public function testCompositionKeywordsWithoutExtension(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'string',
            'allOf' => [
                ['type' => 'string'],
            ],
        ];

        $errors = $this->validator->validate($schema);
        // Should produce an error for allOf without JSONStructureConditionalComposition
        $this->assertGreaterThan(0, count($errors));
    }

    public function testCompositionKeywordsWithExtension(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureConditionalComposition'],
            'name' => 'Test',
            'type' => 'string',
            'allOf' => [
                ['type' => 'string'],
            ],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testExtends(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Employee',
            'type' => 'object',
            '$extends' => '#/definitions/Person',
            'properties' => [
                'employeeId' => ['type' => 'string'],
            ],
            'definitions' => [
                'Person' => [
                    'type' => 'object',
                    'properties' => [
                        'name' => ['type' => 'string'],
                        'age' => ['type' => 'int32'],
                    ],
                ],
            ],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testCircularExtends(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'A',
            'type' => 'object',
            '$extends' => '#/definitions/B',
            'properties' => [],
            'definitions' => [
                'B' => [
                    'type' => 'object',
                    '$extends' => '#/definitions/C',
                    'properties' => [],
                ],
                'C' => [
                    'type' => 'object',
                    '$extends' => '#/definitions/B',
                    'properties' => [],
                ],
            ],
        ];

        $errors = $this->validator->validate($schema);
        $hasCircularError = false;
        foreach ($errors as $error) {
            if (str_contains((string) $error, 'Circular')) {
                $hasCircularError = true;
                break;
            }
        }
        $this->assertTrue($hasCircularError);
    }

    public function testUnionTypes(): void
    {
        $schema = [
            '$id' => 'https://example.com/union.struct.json',
            'name' => 'StringOrNumber',
            'type' => ['string', 'int32'],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertCount(0, $errors);
    }

    public function testEmptyUnionType(): void
    {
        $schema = [
            '$id' => 'https://example.com/union.struct.json',
            'name' => 'Empty',
            'type' => [],
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinLengthMustBeNonNegative(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'string',
            'minLength' => -1,
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinLengthGreaterThanMaxLength(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'string',
            'minLength' => 10,
            'maxLength' => 5,
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testMinimumGreaterThanMaximum(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'int32',
            'minimum' => 100,
            'maximum' => 50,
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testInvalidPattern(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'string',
            'pattern' => '[invalid(regex',
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testStringConstraintOnNumericType(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'int32',
            'minLength' => 5,
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testNumericConstraintOnStringType(): void
    {
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            '$uses' => ['JSONStructureValidation'],
            'name' => 'Test',
            'type' => 'string',
            'minimum' => 0,
        ];

        $errors = $this->validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testSourceLocationTracking(): void
    {
        $jsonText = <<<JSON
{
    "\$id": "https://example.com/test.struct.json",
    "name": "Test",
    "type": "invalid_type"
}
JSON;

        $schema = json_decode($jsonText, true);
        $errors = $this->validator->validate($schema, $jsonText);

        $this->assertGreaterThan(0, count($errors));
        // The location should be known
        $location = $errors[0]->location;
        $this->assertNotNull($location);
    }
}
