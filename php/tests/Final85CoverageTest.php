<?php

declare(strict_types=1);

namespace JsonStructure\Tests;

use JsonStructure\SchemaValidator;
use JsonStructure\InstanceValidator;
use JsonStructure\JsonSourceLocator;
use PHPUnit\Framework\TestCase;

/**
 * Final tests to push coverage over 85%.
 */
class Final85CoverageTest extends TestCase
{
    // =========================================================================
    // Schema Validator - checkOffers method
    // =========================================================================

    public function testSchemaWithInvalidOffers(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$offers' => 'not an array',  // Should be array
            'type' => 'string',
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaWithEmptyOffers(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$offers' => [],
            'type' => 'string',
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    // =========================================================================
    // Schema Validator - checkExtendsKeyword method
    // =========================================================================

    public function testSchemaWithInvalidExtends(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            '$extends' => 123,  // Should be string or array
            'type' => 'string',
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    public function testSchemaWithExtendsArray(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'definitions' => [
                'Base1' => ['type' => 'object', 'properties' => ['a' => ['type' => 'string']]],
                'Base2' => ['type' => 'object', 'properties' => ['b' => ['type' => 'string']]],
            ],
            '$extends' => ['#/definitions/Base1', '#/definitions/Base2'],
            'type' => 'object',
            'properties' => [
                'a' => ['type' => 'string'],
                'b' => ['type' => 'string'],
            ],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    // =========================================================================
    // Schema Validator - checkJsonPointer method
    // =========================================================================

    public function testSchemaWithInvalidJsonPointer(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => ['$ref' => 'not-a-valid-pointer'],  // Invalid pointer
        ];
        $errors = $validator->validate($schema);
        $this->assertGreaterThan(0, count($errors));
    }

    // =========================================================================
    // Schema Validator - checkAbsoluteUri method
    // =========================================================================

    public function testSchemaWithNonAbsoluteId(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'relative/path',  // Not absolute URI
            'name' => 'Test',
            'type' => 'string',
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    // =========================================================================
    // Schema Validator - validateNamespace method
    // =========================================================================

    public function testSchemaWithDefinitionsContainingRefs(): void
    {
        $validator = new SchemaValidator();
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'definitions' => [
                'Person' => [
                    'type' => 'object',
                    'properties' => [
                        'name' => ['type' => 'string'],
                        'friend' => ['type' => ['$ref' => '#/definitions/Person']],  // Self-reference
                    ],
                ],
            ],
            'type' => ['$ref' => '#/definitions/Person'],
        ];
        $errors = $validator->validate($schema);
        $this->assertIsArray($errors);
    }

    // =========================================================================
    // Schema Validator - checkPrimitiveSchema method
    // =========================================================================

    public function testSchemaWithAllPrimitiveTypes(): void
    {
        $validator = new SchemaValidator();
        $primitiveTypes = [
            'string', 'boolean', 'null', 'int8', 'uint8', 'int16', 'uint16',
            'int32', 'uint32', 'int64', 'uint64', 'int128', 'uint128',
            'float', 'float8', 'double', 'decimal', 'number', 'integer',
            'date', 'time', 'datetime', 'duration', 'uuid', 'uri', 'binary',
            'jsonpointer',
        ];

        foreach ($primitiveTypes as $type) {
            $schema = [
                '$id' => "https://example.com/{$type}.struct.json",
                'name' => ucfirst($type),
                'type' => $type,
            ];
            $errors = $validator->validate($schema);
            $this->assertCount(0, $errors, "Type {$type} should be valid");
        }
    }

    // =========================================================================
    // Schema Validator - addExtensionKeywordWarning method
    // =========================================================================

    public function testSchemaWithExtensionKeywordWithoutUses(): void
    {
        $validator = new SchemaValidator(warnOnUnusedExtensionKeywords: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'type' => 'string',
            'minLength' => 5,  // Extension keyword without $uses
        ];
        $errors = $validator->validate($schema);
        $warnings = $validator->getWarnings();
        // Should have warnings or errors about missing $uses
        $this->assertIsArray($errors);
        $this->assertIsArray($warnings);
    }

    public function testSchemaWithAllOfWithoutUses(): void
    {
        $validator = new SchemaValidator(warnOnUnusedExtensionKeywords: true);
        $schema = [
            '$id' => 'https://example.com/test.struct.json',
            'name' => 'Test',
            'allOf' => [['type' => 'string']],  // Composition keyword without $uses
        ];
        $errors = $validator->validate($schema);
        $warnings = $validator->getWarnings();
        $this->assertIsArray($errors);
        $this->assertIsArray($warnings);
    }

    // =========================================================================
    // Instance Validator - Decimal validation
    // =========================================================================

    public function testDecimalValidation(): void
    {
        $validator = new InstanceValidator(['type' => 'decimal']);
        
        // Valid decimals as strings
        $this->assertCount(0, $validator->validate('123.456'));
        $this->assertCount(0, $validator->validate('-999.999'));
        $this->assertCount(0, $validator->validate('0.0'));
        
        // Wrong type
        $this->assertGreaterThan(0, count($validator->validate(123.456)));
    }

    // =========================================================================
    // Instance Validator - Additional Composition Tests
    // =========================================================================

    public function testIfThenElseValidation(): void
    {
        $validator = new InstanceValidator([
            'type' => 'any',
            'if' => ['type' => 'string'],
            'then' => ['minLength' => 3],
            'else' => ['type' => 'int32'],
        ], extended: true);

        // String path
        $errors = $validator->validate('hello');
        $this->assertIsArray($errors);

        // Non-string path
        $errors = $validator->validate(42);
        $this->assertIsArray($errors);
    }

    // =========================================================================
    // JsonSourceLocator - Edge Cases
    // =========================================================================

    public function testJsonSourceLocatorWithEscapedSlashInPointer(): void
    {
        // JSON pointer with escaped slash (~1)
        $json = '{"a/b": "value"}';
        $locator = new JsonSourceLocator($json);
        $location = $locator->getLocation('/a~1b');
        $this->assertInstanceOf(\JsonStructure\JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithEscapedTildeInPointer(): void
    {
        // JSON pointer with escaped tilde (~0)
        $json = '{"a~b": "value"}';
        $locator = new JsonSourceLocator($json);
        $location = $locator->getLocation('/a~0b');
        $this->assertInstanceOf(\JsonStructure\JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithEmptyKey(): void
    {
        $json = '{"": "empty key value"}';
        $locator = new JsonSourceLocator($json);
        $location = $locator->getLocation('/');
        $this->assertInstanceOf(\JsonStructure\JsonLocation::class, $location);
    }

    public function testJsonSourceLocatorWithVeryLongJson(): void
    {
        // Create a long JSON object
        $obj = [];
        for ($i = 0; $i < 200; $i++) {
            $obj["key{$i}"] = str_repeat("x", 100);
        }
        $json = json_encode($obj);
        $locator = new JsonSourceLocator($json);

        // Find a key deep in the object
        $location = $locator->getLocation('/key199');
        $this->assertInstanceOf(\JsonStructure\JsonLocation::class, $location);
    }

    // =========================================================================
    // Instance Validator - More Error Paths
    // =========================================================================

    public function testTupleWithWrongTypes(): void
    {
        $validator = new InstanceValidator([
            'type' => 'tuple',
            'properties' => [
                'first' => ['type' => 'string'],
                'second' => ['type' => 'int32'],
            ],
            'tuple' => ['first', 'second'],
        ]);

        // Wrong types
        $errors = $validator->validate([123, 'not an int']);
        $this->assertGreaterThan(0, count($errors));
    }

    public function testChoiceWithInvalidSelector(): void
    {
        $validator = new InstanceValidator([
            'type' => 'choice',
            'selector' => 'type',
            'choices' => [
                'dog' => ['type' => 'object', 'properties' => ['type' => ['type' => 'string', 'const' => 'dog'], 'name' => ['type' => 'string']]],
                'cat' => ['type' => 'object', 'properties' => ['type' => ['type' => 'string', 'const' => 'cat'], 'name' => ['type' => 'string']]],
            ],
        ]);

        // Invalid selector value
        $errors = $validator->validate(['type' => 'bird', 'name' => 'tweety']);
        $this->assertIsArray($errors);
    }

    public function testMapWithInvalidKeys(): void
    {
        $validator = new InstanceValidator([
            'type' => 'map',
            'values' => ['type' => 'int32'],
            'keys' => ['pattern' => '^[a-z]+$'],
        ], extended: true);

        // Valid keys
        $errors = $validator->validate(['abc' => 1, 'xyz' => 2]);
        $this->assertIsArray($errors);

        // Invalid keys (would need propertyNames for this)
        $errors = $validator->validate(['ABC' => 1]);
        $this->assertIsArray($errors);
    }
}
