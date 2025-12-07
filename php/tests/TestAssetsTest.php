<?php

declare(strict_types=1);

namespace JsonStructure\Tests;

use JsonStructure\SchemaValidator;
use JsonStructure\InstanceValidator;
use JsonStructure\ErrorCodes;
use JsonStructure\ValidationSeverity;
use PHPUnit\Framework\TestCase;

/**
 * Integration tests that validate all schemas and instances from the sdk/test-assets directory.
 * These tests ensure that invalid schemas fail validation and invalid instances fail validation.
 */
class TestAssetsTest extends TestCase
{
    private const SDK_ROOT = __DIR__ . '/../..';
    private const TEST_ASSETS = self::SDK_ROOT . '/test-assets';
    private const INVALID_SCHEMAS = self::TEST_ASSETS . '/schemas/invalid';
    private const WARNING_SCHEMAS = self::TEST_ASSETS . '/schemas/warnings';
    private const VALIDATION_SCHEMAS = self::TEST_ASSETS . '/schemas/validation';
    private const ADVERSARIAL_SCHEMAS = self::TEST_ASSETS . '/schemas/adversarial';
    private const INVALID_INSTANCES = self::TEST_ASSETS . '/instances/invalid';
    private const VALIDATION_INSTANCES = self::TEST_ASSETS . '/instances/validation';
    private const ADVERSARIAL_INSTANCES = self::TEST_ASSETS . '/instances/adversarial';
    private const SAMPLES_ROOT = self::SDK_ROOT . '/primer-and-samples/samples/core';

    /**
     * Schemas that are intentionally invalid and MUST fail schema validation.
     */
    private const INVALID_ADVERSARIAL_SCHEMAS = [
        'ref-to-nowhere.struct.json',
        'malformed-json-pointer.struct.json',
        'self-referencing-extends.struct.json',
        'extends-circular-chain.struct.json',
    ];

    /**
     * Map instance files to their corresponding schema.
     */
    private const ADVERSARIAL_INSTANCE_SCHEMA_MAP = [
        'deep-nesting.json' => 'deep-nesting-100.struct.json',
        'recursive-tree.json' => 'recursive-array-items.struct.json',
        'property-name-edge-cases.json' => 'property-name-edge-cases.struct.json',
        'unicode-edge-cases.json' => 'unicode-edge-cases.struct.json',
        'string-length-surrogate.json' => 'string-length-surrogate.struct.json',
        'int64-precision.json' => 'int64-precision-loss.struct.json',
        'floating-point.json' => 'floating-point-precision.struct.json',
        'null-edge-cases.json' => 'null-edge-cases.struct.json',
        'empty-collections-invalid.json' => 'empty-arrays-objects.struct.json',
        'redos-attack.json' => 'redos-pattern.struct.json',
        'allof-conflict.json' => 'allof-conflicting-types.struct.json',
        'oneof-all-match.json' => 'oneof-all-match.struct.json',
        'type-union-int.json' => 'type-union-ambiguous.struct.json',
        'type-union-number.json' => 'type-union-ambiguous.struct.json',
        'conflicting-constraints.json' => 'conflicting-constraints.struct.json',
        'format-invalid.json' => 'format-edge-cases.struct.json',
        'format-valid.json' => 'format-edge-cases.struct.json',
        'pattern-flags.json' => 'pattern-with-flags.struct.json',
        'additionalProperties-combined.json' => 'additionalProperties-combined.struct.json',
        'extends-override.json' => 'extends-with-overrides.struct.json',
        'quadratic-blowup.json' => 'quadratic-blowup.struct.json',
        'anyof-none-match.json' => 'anyof-none-match.struct.json',
    ];

    /**
     * Get all invalid schema files from test-assets.
     * @return string[]
     */
    private function getInvalidSchemaFiles(): array
    {
        if (!is_dir(self::INVALID_SCHEMAS)) {
            return [];
        }
        return glob(self::INVALID_SCHEMAS . '/*.struct.json') ?: [];
    }

    /**
     * Get all directories containing invalid instances.
     * @return string[]
     */
    private function getInvalidInstanceDirs(): array
    {
        if (!is_dir(self::INVALID_INSTANCES)) {
            return [];
        }
        $dirs = [];
        foreach (scandir(self::INVALID_INSTANCES) as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = self::INVALID_INSTANCES . '/' . $item;
            if (is_dir($path)) {
                $dirs[] = $path;
            }
        }
        return $dirs;
    }

    /**
     * Resolve a JSON pointer to get the target value.
     */
    private function resolveJsonPointer(string $pointer, array $doc): mixed
    {
        if (!str_starts_with($pointer, '/')) {
            return null;
        }

        $parts = explode('/', substr($pointer, 1));
        $current = $doc;

        foreach ($parts as $part) {
            // Handle JSON pointer escaping
            $part = str_replace('~1', '/', $part);
            $part = str_replace('~0', '~', $part);

            if (is_array($current)) {
                if (!array_key_exists($part, $current)) {
                    return null;
                }
                $current = $current[$part];
            } else {
                return null;
            }
        }

        return $current;
    }

    // =============================================================================
    // Invalid Schema Tests
    // =============================================================================

    public function testInvalidSchemasDirectoryExists(): void
    {
        if (!is_dir(self::TEST_ASSETS)) {
            $this->markTestSkipped('test-assets not found');
        }
        $this->assertTrue(is_dir(self::INVALID_SCHEMAS), 'Invalid schemas directory should exist');
        $schemas = glob(self::INVALID_SCHEMAS . '/*.struct.json') ?: [];
        $this->assertGreaterThan(0, count($schemas), 'Should have invalid schema test files');
    }

    /**
     * @dataProvider invalidSchemaFilesProvider
     */
    public function testInvalidSchemaFailsValidation(string $schemaFile): void
    {
        $schema = json_decode(file_get_contents($schemaFile), true);
        $description = $schema['description'] ?? 'No description';

        $validator = new SchemaValidator(extended: true);
        $errors = $validator->validate($schema);

        $this->assertGreaterThan(
            0,
            count($errors),
            "Schema " . basename($schemaFile) . " should be invalid. Description: {$description}"
        );
    }

    public static function invalidSchemaFilesProvider(): array
    {
        $files = glob(self::INVALID_SCHEMAS . '/*.struct.json') ?: [];
        $testCases = [];
        foreach ($files as $file) {
            $testCases[basename($file)] = [$file];
        }
        return $testCases;
    }

    // =============================================================================
    // Invalid Instance Tests
    // =============================================================================

    public function testInvalidInstancesDirectoryExists(): void
    {
        if (!is_dir(self::TEST_ASSETS)) {
            $this->markTestSkipped('test-assets not found');
        }
        $this->assertTrue(is_dir(self::INVALID_INSTANCES), 'Invalid instances directory should exist');
        $dirs = [];
        foreach (scandir(self::INVALID_INSTANCES) as $item) {
            if ($item !== '.' && $item !== '..' && is_dir(self::INVALID_INSTANCES . '/' . $item)) {
                $dirs[] = $item;
            }
        }
        $this->assertGreaterThan(0, count($dirs), 'Should have invalid instance test directories');
    }

    /**
     * @dataProvider invalidInstanceTestCasesProvider
     */
    public function testInvalidInstanceFailsValidation(string $sampleName, string $instanceFile): void
    {
        // Load instance
        $instanceData = json_decode(file_get_contents($instanceFile), true);
        $description = $instanceData['_description'] ?? 'No description';
        unset($instanceData['_description'], $instanceData['_schema']);

        // Remove other metadata fields
        $instance = [];
        foreach ($instanceData as $k => $v) {
            if (!str_starts_with($k, '_')) {
                $instance[$k] = $v;
            }
        }

        // Load schema
        $schemaPath = self::SAMPLES_ROOT . '/' . $sampleName . '/schema.struct.json';
        if (!file_exists($schemaPath)) {
            $this->markTestSkipped("Schema not found: {$schemaPath}");
        }

        $schema = json_decode(file_get_contents($schemaPath), true);

        // Handle $root
        $rootRef = $schema['$root'] ?? null;
        $targetSchema = $schema;

        if ($rootRef !== null && str_starts_with($rootRef, '#/')) {
            $resolved = $this->resolveJsonPointer(substr($rootRef, 1), $schema);
            if (is_array($resolved)) {
                $targetSchema = $resolved;
                if (isset($schema['definitions'])) {
                    $targetSchema['definitions'] = $schema['definitions'];
                }
            }
        }

        // Validate
        $validator = new InstanceValidator($targetSchema, extended: true);
        $errors = $validator->validate($instance);

        $this->assertGreaterThan(
            0,
            count($errors),
            "Instance {$sampleName}/" . basename($instanceFile) . " should be invalid. Description: {$description}"
        );
    }

    public static function invalidInstanceTestCasesProvider(): array
    {
        $testCases = [];

        if (!is_dir(self::INVALID_INSTANCES)) {
            return $testCases;
        }

        foreach (scandir(self::INVALID_INSTANCES) as $sampleName) {
            if ($sampleName === '.' || $sampleName === '..') {
                continue;
            }
            $sampleDir = self::INVALID_INSTANCES . '/' . $sampleName;
            if (!is_dir($sampleDir)) {
                continue;
            }

            $instanceFiles = glob($sampleDir . '/*.json') ?: [];
            foreach ($instanceFiles as $instanceFile) {
                $testCases["{$sampleName}/" . basename($instanceFile)] = [$sampleName, $instanceFile];
            }
        }

        return $testCases;
    }

    // =============================================================================
    // Warning Schema Tests
    // =============================================================================

    /**
     * @dataProvider warningSchemaFilesProvider
     */
    public function testWarningSchemaIsValidButProducesWarnings(string $schemaFile): void
    {
        $schema = json_decode(file_get_contents($schemaFile), true);
        $description = $schema['description'] ?? 'No description';

        $validator = new SchemaValidator(extended: true, warnOnUnusedExtensionKeywords: true);
        $errors = $validator->validate($schema);
        $warnings = $validator->getWarnings();

        // Filter out warnings (only keep errors)
        $realErrors = array_filter($errors, fn($e) => $e->severity !== ValidationSeverity::WARNING);

        // Schema should be valid (no errors)
        $this->assertCount(
            0,
            $realErrors,
            "Warning schema " . basename($schemaFile) . " should be valid. Errors: " . json_encode(array_map(fn($e) => (string) $e, $realErrors))
        );

        // Schema should produce warnings (unless it has $uses which suppresses them)
        $hasUses = isset($schema['$uses']) && !empty($schema['$uses']);
        if (!$hasUses) {
            $this->assertGreaterThan(
                0,
                count($warnings),
                "Warning schema " . basename($schemaFile) . " should produce warnings. Description: {$description}"
            );
        }
    }

    public static function warningSchemaFilesProvider(): array
    {
        $files = glob(self::WARNING_SCHEMAS . '/*.struct.json') ?: [];
        $testCases = [];
        foreach ($files as $file) {
            $testCases[basename($file)] = [$file];
        }
        return $testCases;
    }

    // =============================================================================
    // Validation Enforcement Tests
    // =============================================================================

    /**
     * @dataProvider validationSchemaFilesProvider
     */
    public function testValidationSchemaIsValid(string $schemaFile): void
    {
        $schema = json_decode(file_get_contents($schemaFile), true);

        $validator = new SchemaValidator(extended: true);
        $errors = $validator->validate($schema);

        // Filter out warnings (only keep errors)
        $realErrors = array_filter($errors, fn($e) => $e->severity !== ValidationSeverity::WARNING);

        $this->assertCount(
            0,
            $realErrors,
            "Validation schema " . basename($schemaFile) . " should be valid. Errors: " . json_encode(array_map(fn($e) => (string) $e, $realErrors))
        );
    }

    public static function validationSchemaFilesProvider(): array
    {
        $files = glob(self::VALIDATION_SCHEMAS . '/*.struct.json') ?: [];
        $testCases = [];
        foreach ($files as $file) {
            $testCases[basename($file)] = [$file];
        }
        return $testCases;
    }

    /**
     * @dataProvider validationInstanceTestCasesProvider
     */
    public function testValidationEnforcementInstanceFails(string $schemaName, string $instanceFile): void
    {
        // Load instance
        $instanceData = json_decode(file_get_contents($instanceFile), true);
        $description = $instanceData['_description'] ?? 'No description';
        $expectedError = $instanceData['_expectedError'] ?? null;
        $expectedValid = $instanceData['_expectedValid'] ?? false;

        // Get value to validate (either "value" key or the object minus metadata)
        if (array_key_exists('value', $instanceData)) {
            $instance = $instanceData['value'];
        } else {
            $instance = [];
            foreach ($instanceData as $k => $v) {
                if (!str_starts_with($k, '_')) {
                    $instance[$k] = $v;
                }
            }
        }

        // Load schema
        $schemaPath = self::VALIDATION_SCHEMAS . '/' . $schemaName . '.struct.json';
        if (!file_exists($schemaPath)) {
            $this->markTestSkipped("Schema not found: {$schemaPath}");
        }

        $schema = json_decode(file_get_contents($schemaPath), true);

        // Validate with extended=true to ensure validation addins are applied
        $validator = new InstanceValidator($schema, extended: true);
        $errors = $validator->validate($instance);

        if ($expectedValid) {
            $this->assertCount(
                0,
                $errors,
                "Instance {$schemaName}/" . basename($instanceFile) . " should be VALID. " .
                "Description: {$description}. Errors: " . json_encode(array_map(fn($e) => (string) $e, $errors))
            );
        } else {
            $this->assertGreaterThan(
                0,
                count($errors),
                "Instance {$schemaName}/" . basename($instanceFile) . " should be INVALID " .
                "(validation extension keywords should be enforced). Description: {$description}"
            );
        }
    }

    public static function validationInstanceTestCasesProvider(): array
    {
        $testCases = [];

        if (!is_dir(self::VALIDATION_INSTANCES)) {
            return $testCases;
        }

        foreach (scandir(self::VALIDATION_INSTANCES) as $schemaName) {
            if ($schemaName === '.' || $schemaName === '..') {
                continue;
            }
            $schemaDir = self::VALIDATION_INSTANCES . '/' . $schemaName;
            if (!is_dir($schemaDir)) {
                continue;
            }

            $instanceFiles = glob($schemaDir . '/*.json') ?: [];
            foreach ($instanceFiles as $instanceFile) {
                $testCases["{$schemaName}/" . basename($instanceFile)] = [$schemaName, $instanceFile];
            }
        }

        return $testCases;
    }

    // =============================================================================
    // Adversarial Tests - Stress test the validators
    // =============================================================================

    /**
     * @dataProvider adversarialSchemaFilesProvider
     */
    public function testAdversarialSchema(string $schemaFile): void
    {
        $schema = json_decode(file_get_contents($schemaFile), true);

        $validator = new SchemaValidator(extended: true);
        $errors = $validator->validate($schema);

        // Check if this schema MUST be invalid
        if (in_array(basename($schemaFile), self::INVALID_ADVERSARIAL_SCHEMAS, true)) {
            $this->assertGreaterThan(0, count($errors), "Schema " . basename($schemaFile) . " should be invalid");
        } else {
            // Other adversarial schemas should validate without crashing
            $this->assertIsArray($errors);
        }
    }

    public static function adversarialSchemaFilesProvider(): array
    {
        $files = glob(self::ADVERSARIAL_SCHEMAS . '/*.struct.json') ?: [];
        $testCases = [];
        foreach ($files as $file) {
            $testCases[basename($file)] = [$file];
        }
        return $testCases;
    }

    /**
     * @dataProvider adversarialInstanceFilesProvider
     */
    public function testAdversarialInstanceDoesNotCrash(string $instanceFile): void
    {
        $schemaName = self::ADVERSARIAL_INSTANCE_SCHEMA_MAP[basename($instanceFile)] ?? null;
        if ($schemaName === null) {
            $this->markTestSkipped("No schema mapping for " . basename($instanceFile));
        }

        $schemaFile = self::ADVERSARIAL_SCHEMAS . '/' . $schemaName;
        if (!file_exists($schemaFile)) {
            $this->markTestSkipped("Schema not found: {$schemaName}");
        }

        $schema = json_decode(file_get_contents($schemaFile), true);
        $instance = json_decode(file_get_contents($instanceFile), true);

        // Remove $schema from instance before validation
        unset($instance['$schema']);

        $validator = new InstanceValidator($schema, extended: true);

        // Should complete without raising exceptions or hanging
        try {
            $errors = $validator->validate($instance);
            $this->assertIsArray($errors);
        } catch (\Exception $e) {
            $this->fail("Adversarial instance " . basename($instanceFile) . " caused unexpected exception: " . $e->getMessage());
        }
    }

    public static function adversarialInstanceFilesProvider(): array
    {
        $files = glob(self::ADVERSARIAL_INSTANCES . '/*.json') ?: [];
        $testCases = [];
        foreach ($files as $file) {
            $testCases[basename($file)] = [$file];
        }
        return $testCases;
    }
}
