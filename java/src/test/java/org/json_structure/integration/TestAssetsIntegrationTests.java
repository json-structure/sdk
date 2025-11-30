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
}
