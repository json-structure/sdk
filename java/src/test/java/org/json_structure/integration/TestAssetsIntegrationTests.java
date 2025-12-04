// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.json_structure.validation.InstanceValidator;
import org.json_structure.validation.SchemaValidator;
import org.json_structure.validation.ValidationOptions;
import org.json_structure.validation.ValidationResult;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.DisplayName;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

/**
 * Integration tests that validate schemas and instances from the sdk/test-assets directory.
 * These tests ensure that:
 * 1. All invalid schemas in test-assets/schemas/invalid/ fail validation
 * 2. All invalid instances in test-assets/instances/invalid/ fail validation against their schemas
 * 
 * NOTE: Some test cases require validator features not yet implemented. These are tracked
 * in the KNOWN_GAPS sets and will be skipped until the corresponding validation logic is added.
 */
class TestAssetsIntegrationTests {

    private static SchemaValidator schemaValidator;
    private static InstanceValidator instanceValidator;
    private static ObjectMapper mapper;
    private static Path testAssetsPath;
    private static Path samplesPath;
    
    /**
     * Schema validation edge cases not yet implemented in the SchemaValidator.
     * These represent future enhancements to the validator.
     */
    private static final Set<String> KNOWN_SCHEMA_GAPS = Set.of(
        // All schema validation gaps have been fixed!
    );
    
    /**
     * Instance validation edge cases not yet implemented in the InstanceValidator.
     * These represent future enhancements to the validator.
     */
    private static final Set<String> KNOWN_INSTANCE_GAPS = Set.of(
        // All instance validation gaps should be fixed now!
    );

    /**
     * Schemas in the warnings directory that should NOT produce warnings
     * (e.g., those with proper $uses declarations).
     */
    private static final Set<String> SCHEMAS_WITHOUT_WARNINGS = Set.of(
        "all-extension-keywords-with-uses.struct.json"
    );

    @BeforeAll
    static void setUpAll() {
        schemaValidator = new SchemaValidator();
        instanceValidator = new InstanceValidator();
        mapper = new ObjectMapper();
        
        // Find the test-assets directory relative to the test execution location
        Path[] possiblePaths = {
            Paths.get("../../test-assets"),
            Paths.get("../../../test-assets"),
            Paths.get("../test-assets"),
            Paths.get("test-assets")
        };
        
        for (Path path : possiblePaths) {
            Path resolved = path.toAbsolutePath().normalize();
            if (Files.exists(resolved)) {
                testAssetsPath = resolved;
                break;
            }
        }
        
        // Also try to find from workspace root
        if (testAssetsPath == null) {
            Path workspaceRoot = Paths.get(System.getProperty("user.dir"));
            while (workspaceRoot != null) {
                Path candidate = workspaceRoot.resolve("sdk/test-assets");
                if (Files.exists(candidate)) {
                    testAssetsPath = candidate;
                    break;
                }
                workspaceRoot = workspaceRoot.getParent();
            }
        }
        
        // Find samples path
        if (testAssetsPath != null) {
            Path sdkPath = testAssetsPath.getParent();
            Path repoRoot = sdkPath.getParent();
            samplesPath = repoRoot.resolve("primer-and-samples/samples/core");
        }
    }

    // =============================================================================
    // Invalid Schema Tests
    // =============================================================================

    @TestFactory
    @DisplayName("All invalid schemas fail validation")
    Stream<DynamicTest> allInvalidSchemasShouldFailValidation() throws IOException {
        if (testAssetsPath == null || !Files.exists(testAssetsPath)) {
            return Stream.of(dynamicTest("test-assets path not found - skipping", () -> {
                System.out.println("Warning: test-assets directory not found. Skipping invalid schema tests.");
            }));
        }

        Path invalidSchemasDir = testAssetsPath.resolve("schemas/invalid");
        if (!Files.exists(invalidSchemasDir)) {
            return Stream.of(dynamicTest("invalid schemas directory not found - skipping", () -> {
                System.out.println("Warning: schemas/invalid directory not found. Skipping tests.");
            }));
        }

        List<DynamicTest> tests = new ArrayList<>();
        
        try (Stream<Path> schemaPaths = Files.list(invalidSchemasDir)) {
            schemaPaths
                .filter(p -> p.getFileName().toString().endsWith(".struct.json"))
                .forEach(schemaPath -> {
                    String schemaName = schemaPath.getFileName().toString();
                    tests.add(dynamicTest("Invalid schema: " + schemaName, () -> {
                        // Skip known gaps - these will be aborted (not failed) with a message
                        assumeTrue(!KNOWN_SCHEMA_GAPS.contains(schemaName),
                            "Skipping " + schemaName + " - validation not yet implemented");
                        
                        String schemaContent = Files.readString(schemaPath);
                        JsonNode schema = mapper.readTree(schemaContent);
                        String description = schema.has("description") 
                            ? schema.get("description").asText() 
                            : "No description";
                        
                        ValidationResult result = schemaValidator.validate(schema);
                        
                        assertThat(result.isValid())
                            .withFailMessage(() -> 
                                "Schema " + schemaName + " should be INVALID but passed validation. " +
                                "Description: " + description)
                            .isFalse();
                    }));
                });
        }
        
        return tests.stream();
    }

    // =============================================================================
    // Invalid Instance Tests
    // =============================================================================

    @TestFactory
    @DisplayName("All invalid instances fail validation against their schemas")
    Stream<DynamicTest> allInvalidInstancesShouldFailValidation() throws IOException {
        if (testAssetsPath == null || !Files.exists(testAssetsPath)) {
            return Stream.of(dynamicTest("test-assets path not found - skipping", () -> {
                System.out.println("Warning: test-assets directory not found. Skipping invalid instance tests.");
            }));
        }

        if (samplesPath == null || !Files.exists(samplesPath)) {
            return Stream.of(dynamicTest("samples path not found - skipping", () -> {
                System.out.println("Warning: samples directory not found. Skipping invalid instance tests.");
            }));
        }

        Path invalidInstancesDir = testAssetsPath.resolve("instances/invalid");
        if (!Files.exists(invalidInstancesDir)) {
            return Stream.of(dynamicTest("invalid instances directory not found - skipping", () -> {
                System.out.println("Warning: instances/invalid directory not found. Skipping tests.");
            }));
        }

        List<DynamicTest> tests = new ArrayList<>();
        
        try (Stream<Path> sampleDirs = Files.list(invalidInstancesDir)) {
            sampleDirs
                .filter(Files::isDirectory)
                .forEach(sampleDir -> {
                    String sampleName = sampleDir.getFileName().toString();
                    Path schemaPath = samplesPath.resolve(sampleName).resolve("schema.struct.json");
                    
                    if (!Files.exists(schemaPath)) {
                        tests.add(dynamicTest(sampleName + " - schema not found", () -> {
                            System.out.println("Warning: Schema not found for " + sampleName);
                        }));
                        return;
                    }
                    
                    try {
                        String schemaContent = Files.readString(schemaPath);
                        JsonNode schema = mapper.readTree(schemaContent);
                        
                        try (Stream<Path> instancePaths = Files.list(sampleDir)) {
                            instancePaths
                                .filter(p -> p.getFileName().toString().endsWith(".json"))
                                .forEach(instancePath -> {
                                    String instanceName = instancePath.getFileName().toString();
                                    String testKey = sampleName + "/" + instanceName;
                                    tests.add(dynamicTest(testKey, () -> {
                                        // Skip known gaps - these will be aborted (not failed) with a message
                                        assumeTrue(!KNOWN_INSTANCE_GAPS.contains(testKey),
                                            "Skipping " + testKey + " - validation not yet implemented");
                                        
                                        String instanceContent = Files.readString(instancePath);
                                        JsonNode instance = mapper.readTree(instanceContent);
                                        
                                        String description = instance.has("_description")
                                            ? instance.get("_description").asText()
                                            : "No description";
                                        
                                        // Remove metadata fields (those starting with _)
                                        if (instance instanceof ObjectNode) {
                                            ObjectNode objNode = (ObjectNode) instance;
                                            List<String> keysToRemove = new ArrayList<>();
                                            Iterator<String> fieldNames = objNode.fieldNames();
                                            while (fieldNames.hasNext()) {
                                                String key = fieldNames.next();
                                                if (key.startsWith("_")) {
                                                    keysToRemove.add(key);
                                                }
                                            }
                                            keysToRemove.forEach(objNode::remove);
                                        }
                                        
                                        ValidationResult result = instanceValidator.validate(instance, schema);
                                        
                                        assertThat(result.isValid())
                                            .withFailMessage(() -> 
                                                "Instance " + testKey + 
                                                " should be INVALID but passed validation. " +
                                                "Description: " + description)
                                            .isFalse();
                                    }));
                                });
                        }
                    } catch (IOException e) {
                        tests.add(dynamicTest(sampleName + " - error reading files", () -> {
                            fail("Failed to read files for " + sampleName + ": " + e.getMessage());
                        }));
                    }
                });
        }
        
        return tests.stream();
    }

    // =============================================================================
    // Summary Tests
    // =============================================================================

    @TestFactory
    @DisplayName("Test assets directories exist and have files")
    Stream<DynamicTest> testAssetsDirectoriesExist() {
        List<DynamicTest> tests = new ArrayList<>();
        
        tests.add(dynamicTest("Invalid schemas directory exists", () -> {
            if (testAssetsPath == null) {
                System.out.println("Warning: test-assets path not found");
                return;
            }
            
            Path invalidSchemasDir = testAssetsPath.resolve("schemas/invalid");
            assertThat(Files.exists(invalidSchemasDir))
                .withFailMessage("Invalid schemas directory should exist at " + invalidSchemasDir)
                .isTrue();
            
            long count = Files.list(invalidSchemasDir)
                .filter(p -> p.getFileName().toString().endsWith(".struct.json"))
                .count();
            
            System.out.println("Found " + count + " invalid schema files");
            assertThat(count).isGreaterThan(0);
        }));
        
        tests.add(dynamicTest("Invalid instances directory exists", () -> {
            if (testAssetsPath == null) {
                System.out.println("Warning: test-assets path not found");
                return;
            }
            
            Path invalidInstancesDir = testAssetsPath.resolve("instances/invalid");
            assertThat(Files.exists(invalidInstancesDir))
                .withFailMessage("Invalid instances directory should exist at " + invalidInstancesDir)
                .isTrue();
            
            long count = 0;
            for (Path sampleDir : Files.list(invalidInstancesDir).toList()) {
                if (Files.isDirectory(sampleDir)) {
                    count += Files.list(sampleDir)
                        .filter(p -> p.getFileName().toString().endsWith(".json"))
                        .count();
                }
            }
            
            System.out.println("Found " + count + " invalid instance files");
            assertThat(count).isGreaterThan(0);
        }));
        
        return tests.stream();
    }

    // =============================================================================
    // Warning Schema Tests
    // =============================================================================

    @TestFactory
    @DisplayName("Warning schemas produce expected warnings")
    Stream<DynamicTest> allWarningSchemasProduceExpectedWarnings() throws IOException {
        if (testAssetsPath == null || !Files.exists(testAssetsPath)) {
            return Stream.of(dynamicTest("test-assets path not found - skipping", () -> {
                System.out.println("Warning: test-assets directory not found. Skipping warning schema tests.");
            }));
        }

        Path warningSchemasDir = testAssetsPath.resolve("schemas/warnings");
        if (!Files.exists(warningSchemasDir)) {
            return Stream.of(dynamicTest("warning schemas directory not found - skipping", () -> {
                System.out.println("Warning: schemas/warnings directory not found. Skipping tests.");
            }));
        }

        List<DynamicTest> tests = new ArrayList<>();
        
        // Create a schema validator with warning support enabled (default)
        ValidationOptions options = new ValidationOptions();
        options.setWarnOnUnusedExtensionKeywords(true);
        SchemaValidator warningValidator = new SchemaValidator(options);
        
        try (Stream<Path> schemaPaths = Files.list(warningSchemasDir)) {
            schemaPaths
                .filter(p -> p.getFileName().toString().endsWith(".struct.json"))
                .forEach(schemaPath -> {
                    String schemaName = schemaPath.getFileName().toString();
                    boolean shouldHaveNoWarnings = SCHEMAS_WITHOUT_WARNINGS.contains(schemaName);
                    
                    tests.add(dynamicTest("Warning schema: " + schemaName, () -> {
                        String schemaContent = Files.readString(schemaPath);
                        JsonNode schema = mapper.readTree(schemaContent);
                        String description = schema.has("description") 
                            ? schema.get("description").asText() 
                            : "No description";
                        
                        ValidationResult result = warningValidator.validate(schema);
                        
                        // The schema should be valid (no errors)
                        assertThat(result.isValid())
                            .withFailMessage(() -> 
                                "Schema " + schemaName + " should be VALID but failed validation. " +
                                "Description: " + description + 
                                " Errors: " + result.getErrors())
                            .isTrue();
                        
                        if (shouldHaveNoWarnings) {
                            // This schema has $uses declared, so should produce no warnings
                            assertThat(result.getWarnings())
                                .withFailMessage(() -> 
                                    "Schema " + schemaName + " should produce NO warnings " +
                                    "(has proper $uses declaration). " +
                                    "Description: " + description +
                                    " Warnings: " + result.getWarnings())
                                .isEmpty();
                        } else {
                            // This schema should produce warnings for extension keywords
                            assertThat(result.getWarnings())
                                .withFailMessage(() -> 
                                    "Schema " + schemaName + " should produce warnings " +
                                    "for extension keywords without $uses. " +
                                    "Description: " + description)
                                .isNotEmpty();
                            
                            // Verify all warnings have the correct error code
                            for (var warning : result.getWarnings()) {
                                assertThat(warning.getCode())
                                    .withFailMessage(() -> 
                                        "Warning should have code SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED, " +
                                        "but got: " + warning.getCode())
                                    .isEqualTo("SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED");
                            }
                        }
                        
                        System.out.println("Schema: " + schemaName);
                        System.out.println("Description: " + description);
                        System.out.println("Warnings: " + result.getWarnings().size());
                        for (var warning : result.getWarnings()) {
                            System.out.println("  - " + warning.getPath() + ": " + warning.getMessage());
                        }
                    }));
                });
        }
        
        return tests.stream();
    }

    // =============================================================================
    // Validation Enforcement Tests
    // =============================================================================

    @TestFactory
    @DisplayName("Validation extension keywords are enforced when $uses is present")
    Stream<DynamicTest> allValidationInstancesShouldFailValidation() throws IOException {
        if (testAssetsPath == null || !Files.exists(testAssetsPath)) {
            return Stream.of(dynamicTest("test-assets path not found - skipping", () -> {
                System.out.println("Warning: test-assets directory not found. Skipping validation enforcement tests.");
            }));
        }

        Path validationInstancesDir = testAssetsPath.resolve("instances/validation");
        if (!Files.exists(validationInstancesDir)) {
            return Stream.of(dynamicTest("validation instances directory not found - skipping", () -> {
                System.out.println("Warning: instances/validation directory not found. Skipping tests.");
            }));
        }

        Path validationSchemasDir = testAssetsPath.resolve("schemas/validation");
        if (!Files.exists(validationSchemasDir)) {
            return Stream.of(dynamicTest("validation schemas directory not found - skipping", () -> {
                System.out.println("Warning: schemas/validation directory not found. Skipping tests.");
            }));
        }

        List<DynamicTest> tests = new ArrayList<>();
        
        try (Stream<Path> schemaDirs = Files.list(validationInstancesDir)) {
            schemaDirs
                .filter(Files::isDirectory)
                .forEach(schemaDir -> {
                    String schemaName = schemaDir.getFileName().toString();
                    Path schemaPath = validationSchemasDir.resolve(schemaName + ".struct.json");
                    
                    if (!Files.exists(schemaPath)) {
                        tests.add(dynamicTest(schemaName + " - schema not found", () -> {
                            System.out.println("Warning: Schema not found for " + schemaName);
                        }));
                        return;
                    }
                    
                    try {
                        String schemaContent = Files.readString(schemaPath);
                        JsonNode schema = mapper.readTree(schemaContent);
                        
                        try (Stream<Path> instancePaths = Files.list(schemaDir)) {
                            instancePaths
                                .filter(p -> p.getFileName().toString().endsWith(".json"))
                                .forEach(instancePath -> {
                                    String instanceName = instancePath.getFileName().toString();
                                    String testKey = schemaName + "/" + instanceName;
                                    tests.add(dynamicTest("Validation enforcement: " + testKey, () -> {
                                        String instanceContent = Files.readString(instancePath);
                                        JsonNode instance = mapper.readTree(instanceContent);
                                        
                                        String description = instance.has("_description")
                                            ? instance.get("_description").asText()
                                            : "No description";
                                        
                                        String expectedError = instance.has("_expectedError")
                                            ? instance.get("_expectedError").asText()
                                            : null;
                                        
                                        // Get the value to validate
                                        JsonNode valueToValidate = instance;
                                        if (instance.has("value")) {
                                            valueToValidate = instance.get("value");
                                        } else if (instance instanceof ObjectNode) {
                                            // Remove metadata fields for validation
                                            ObjectNode objNode = (ObjectNode) instance;
                                            List<String> keysToRemove = new ArrayList<>();
                                            Iterator<String> fieldNames = objNode.fieldNames();
                                            while (fieldNames.hasNext()) {
                                                String key = fieldNames.next();
                                                if (key.startsWith("_")) {
                                                    keysToRemove.add(key);
                                                }
                                            }
                                            keysToRemove.forEach(objNode::remove);
                                        }
                                        
                                        ValidationResult result = instanceValidator.validate(valueToValidate, schema);
                                        
                                        System.out.println("Testing: " + testKey);
                                        System.out.println("Description: " + description);
                                        if (!result.isValid()) {
                                            System.out.println("Errors (expected):");
                                            for (var error : result.getErrors()) {
                                                System.out.println("  [" + error.getCode() + "] " + 
                                                    error.getPath() + ": " + error.getMessage());
                                            }
                                        }
                                        
                                        assertThat(result.isValid())
                                            .withFailMessage(() -> 
                                                "Instance " + testKey + 
                                                " should be INVALID (validation extension keywords should be enforced). " +
                                                "Description: " + description)
                                            .isFalse();
                                        
                                        assertThat(result.getErrors())
                                            .withFailMessage("At least one error should be reported")
                                            .isNotEmpty();
                                        
                                        // Verify the expected error code is present if specified
                                        if (expectedError != null) {
                                            var actualCodes = result.getErrors().stream()
                                                .map(e -> e.getCode())
                                                .collect(java.util.stream.Collectors.toSet());
                                            assertThat(actualCodes)
                                                .withFailMessage(() ->
                                                    "Instance " + testKey + " should produce error code " + expectedError +
                                                    ". Actual codes: " + actualCodes)
                                                .contains(expectedError);
                                            System.out.println("✓ Expected error code verified: " + expectedError);
                                        }
                                    }));
                                });
                        }
                    } catch (IOException e) {
                        tests.add(dynamicTest(schemaName + " - error reading files", () -> {
                            fail("Failed to read files for " + schemaName + ": " + e.getMessage());
                        }));
                    }
                });
        }
        
        return tests.stream();
    }

    @TestFactory
    @DisplayName("Validation test assets directories exist and have files")
    Stream<DynamicTest> validationTestAssetsDirectoriesExist() {
        List<DynamicTest> tests = new ArrayList<>();
        
        tests.add(dynamicTest("Validation schemas directory exists", () -> {
            if (testAssetsPath == null) {
                System.out.println("Warning: test-assets path not found");
                return;
            }
            
            Path validationSchemasDir = testAssetsPath.resolve("schemas/validation");
            assertThat(Files.exists(validationSchemasDir))
                .withFailMessage("Validation schemas directory should exist at " + validationSchemasDir)
                .isTrue();
            
            long count = Files.list(validationSchemasDir)
                .filter(p -> p.getFileName().toString().endsWith(".struct.json"))
                .count();
            
            System.out.println("Found " + count + " validation schema files");
            assertThat(count).isGreaterThan(0);
        }));
        
        tests.add(dynamicTest("Validation instances directory exists", () -> {
            if (testAssetsPath == null) {
                System.out.println("Warning: test-assets path not found");
                return;
            }
            
            Path validationInstancesDir = testAssetsPath.resolve("instances/validation");
            assertThat(Files.exists(validationInstancesDir))
                .withFailMessage("Validation instances directory should exist at " + validationInstancesDir)
                .isTrue();
            
            long count = 0;
            for (Path schemaDir : Files.list(validationInstancesDir).toList()) {
                if (Files.isDirectory(schemaDir)) {
                    count += Files.list(schemaDir)
                        .filter(p -> p.getFileName().toString().endsWith(".json"))
                        .count();
                }
            }
            
            System.out.println("Found " + count + " validation instance files");
            assertThat(count).isGreaterThan(0);
        }));
        
        return tests.stream();
    }
    
    // ========================================================================
    // Adversarial Tests - stress test the validators
    // ========================================================================
    
    /**
     * Schemas that MUST fail schema validation.
     */
    private static final Set<String> INVALID_ADVERSARIAL_SCHEMAS = Set.of(
        "ref-to-nowhere.struct.json",
        "malformed-json-pointer.struct.json",
        "self-referencing-extends.struct.json",
        "extends-circular-chain.struct.json"
    );
    
    /**
     * Maps instance files to their corresponding schema.
     */
    private static final java.util.Map<String, String> ADVERSARIAL_INSTANCE_SCHEMA_MAP = java.util.Map.ofEntries(
        java.util.Map.entry("deep-nesting.json", "deep-nesting-100.struct.json"),
        java.util.Map.entry("recursive-tree.json", "recursive-array-items.struct.json"),
        java.util.Map.entry("property-name-edge-cases.json", "property-name-edge-cases.struct.json"),
        java.util.Map.entry("unicode-edge-cases.json", "unicode-edge-cases.struct.json"),
        java.util.Map.entry("string-length-surrogate.json", "string-length-surrogate.struct.json"),
        java.util.Map.entry("int64-precision.json", "int64-precision-loss.struct.json"),
        java.util.Map.entry("floating-point.json", "floating-point-precision.struct.json"),
        java.util.Map.entry("null-edge-cases.json", "null-edge-cases.struct.json"),
        java.util.Map.entry("empty-collections-invalid.json", "empty-arrays-objects.struct.json"),
        java.util.Map.entry("redos-attack.json", "redos-pattern.struct.json"),
        java.util.Map.entry("allof-conflict.json", "allof-conflicting-types.struct.json"),
        java.util.Map.entry("oneof-all-match.json", "oneof-all-match.struct.json"),
        java.util.Map.entry("type-union-int.json", "type-union-ambiguous.struct.json"),
        java.util.Map.entry("type-union-number.json", "type-union-ambiguous.struct.json"),
        java.util.Map.entry("conflicting-constraints.json", "conflicting-constraints.struct.json"),
        java.util.Map.entry("format-invalid.json", "format-edge-cases.struct.json"),
        java.util.Map.entry("format-valid.json", "format-edge-cases.struct.json"),
        java.util.Map.entry("pattern-flags.json", "pattern-with-flags.struct.json"),
        java.util.Map.entry("additionalProperties-combined.json", "additionalProperties-combined.struct.json"),
        java.util.Map.entry("extends-override.json", "extends-with-overrides.struct.json"),
        java.util.Map.entry("quadratic-blowup.json", "quadratic-blowup.struct.json"),
        java.util.Map.entry("anyof-none-match.json", "anyof-none-match.struct.json")
    );
    
    @TestFactory
    @DisplayName("Adversarial Schema Tests")
    Stream<DynamicTest> testAdversarialSchemas() throws IOException {
        if (testAssetsPath == null) {
            return Stream.of(dynamicTest("test-assets not found", () -> 
                System.out.println("Warning: test-assets path not found, skipping adversarial tests")));
        }
        
        Path adversarialSchemasDir = testAssetsPath.resolve("schemas/adversarial");
        if (!Files.exists(adversarialSchemasDir)) {
            return Stream.of(dynamicTest("adversarial schemas not found", () -> 
                System.out.println("Warning: adversarial schemas directory not found")));
        }
        
        return Files.list(adversarialSchemasDir)
            .filter(p -> p.getFileName().toString().endsWith(".struct.json"))
            .map(schemaPath -> {
                String fileName = schemaPath.getFileName().toString();
                String testName = fileName.replace(".struct.json", "");
                
                return dynamicTest(testName + " is handled correctly", () -> {
                    JsonNode schema = mapper.readTree(schemaPath.toFile());
                    
                    ValidationResult result = schemaValidator.validate(schema);
                    
                    System.out.println("Schema: " + fileName);
                    System.out.println("Valid: " + result.isValid());
                    System.out.println("Errors: " + result.getErrors().size());
                    
                    if (INVALID_ADVERSARIAL_SCHEMAS.contains(fileName)) {
                        assertThat(result.isValid())
                            .withFailMessage("Adversarial schema " + fileName + " should be invalid")
                            .isFalse();
                    }
                });
            });
    }
    
    @TestFactory
    @DisplayName("Adversarial Instance Tests")
    Stream<DynamicTest> testAdversarialInstances() throws IOException {
        if (testAssetsPath == null) {
            return Stream.of(dynamicTest("test-assets not found", () -> 
                System.out.println("Warning: test-assets path not found, skipping adversarial tests")));
        }
        
        Path adversarialInstancesDir = testAssetsPath.resolve("instances/adversarial");
        Path adversarialSchemasDir = testAssetsPath.resolve("schemas/adversarial");
        
        if (!Files.exists(adversarialInstancesDir)) {
            return Stream.of(dynamicTest("adversarial instances not found", () -> 
                System.out.println("Warning: adversarial instances directory not found")));
        }
        
        return Files.list(adversarialInstancesDir)
            .filter(p -> p.getFileName().toString().endsWith(".json"))
            .filter(p -> ADVERSARIAL_INSTANCE_SCHEMA_MAP.containsKey(p.getFileName().toString()))
            .map(instancePath -> {
                String instanceFileName = instancePath.getFileName().toString();
                String schemaFileName = ADVERSARIAL_INSTANCE_SCHEMA_MAP.get(instanceFileName);
                String testName = instanceFileName.replace(".json", "");
                
                return dynamicTest(testName + " does not crash", () -> {
                    Path schemaPath = adversarialSchemasDir.resolve(schemaFileName);
                    assumeTrue(Files.exists(schemaPath), "Schema not found: " + schemaFileName);
                    
                    JsonNode schema = mapper.readTree(schemaPath.toFile());
                    JsonNode instance = mapper.readTree(instancePath.toFile());
                    
                    // Remove $schema from instance
                    if (instance instanceof ObjectNode) {
                        ((ObjectNode) instance).remove("$schema");
                    }
                    
                    System.out.println("Instance: " + instanceFileName);
                    System.out.println("Schema: " + schemaFileName);
                    
                    // Should complete without throwing or hanging
                    ValidationResult result = instanceValidator.validate(instance, schema);
                    
                    System.out.println("Valid: " + result.isValid());
                    System.out.println("Errors: " + result.getErrors().size());
                });
            });
    }
    
    @TestFactory
    @DisplayName("Adversarial Directory Verification")
    Stream<DynamicTest> testAdversarialDirectories() {
        List<DynamicTest> tests = new ArrayList<>();
        
        tests.add(dynamicTest("Adversarial schemas directory exists", () -> {
            if (testAssetsPath == null) {
                System.out.println("Warning: test-assets path not found");
                return;
            }
            
            Path adversarialSchemasDir = testAssetsPath.resolve("schemas/adversarial");
            assertThat(Files.exists(adversarialSchemasDir))
                .withFailMessage("Adversarial schemas directory should exist at " + adversarialSchemasDir)
                .isTrue();
            
            long count = Files.list(adversarialSchemasDir)
                .filter(p -> p.getFileName().toString().endsWith(".struct.json"))
                .count();
            
            System.out.println("Found " + count + " adversarial schema files");
            assertThat(count).isGreaterThanOrEqualTo(10);
        }));
        
        return tests.stream();
    }
}
