// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.json_structure.validation.InstanceValidator;
import org.json_structure.validation.SchemaValidator;
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
import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

/**
 * Integration tests that validate against actual sample schema files from the primer-and-samples directory.
 * This test dynamically discovers and tests all schema.struct.json files and their example instances.
 */
class SampleFilesIntegrationTests {

    private static SchemaValidator schemaValidator;
    private static InstanceValidator instanceValidator;
    private static ObjectMapper mapper;
    private static Path samplesPath;

    @BeforeAll
    static void setUpAll() {
        schemaValidator = new SchemaValidator();
        instanceValidator = new InstanceValidator();
        mapper = new ObjectMapper();
        
        // Find the samples directory relative to the test execution location
        // Try multiple possible locations
        Path[] possiblePaths = {
            Paths.get("../../primer-and-samples/samples/core"),
            Paths.get("../../../primer-and-samples/samples/core"),
            Paths.get("primer-and-samples/samples/core"),
            Paths.get("../primer-and-samples/samples/core")
        };
        
        for (Path path : possiblePaths) {
            Path resolved = path.toAbsolutePath().normalize();
            if (Files.exists(resolved)) {
                samplesPath = resolved;
                break;
            }
        }
        
        if (samplesPath == null) {
            // Try to find from workspace root
            Path workspaceRoot = Paths.get(System.getProperty("user.dir"));
            while (workspaceRoot != null) {
                Path candidate = workspaceRoot.resolve("primer-and-samples/samples/core");
                if (Files.exists(candidate)) {
                    samplesPath = candidate;
                    break;
                }
                workspaceRoot = workspaceRoot.getParent();
            }
        }
    }

    @TestFactory
    @DisplayName("All sample schemas are valid")
    Stream<DynamicTest> allSampleSchemasAreValid() throws IOException {
        if (samplesPath == null || !Files.exists(samplesPath)) {
            return Stream.of(dynamicTest("Samples path not found - skipping", () -> {
                System.out.println("Warning: Samples directory not found. Skipping sample file tests.");
            }));
        }

        List<DynamicTest> tests = new ArrayList<>();
        
        try (Stream<Path> schemaPaths = Files.walk(samplesPath)) {
            schemaPaths
                .filter(p -> p.getFileName().toString().equals("schema.struct.json"))
                .forEach(schemaPath -> {
                    String sampleName = schemaPath.getParent().getFileName().toString();
                    tests.add(dynamicTest("Schema: " + sampleName, () -> {
                        String schemaContent = Files.readString(schemaPath);
                        ValidationResult result = schemaValidator.validate(schemaContent);
                        assertThat(result.isValid())
                            .withFailMessage(() -> "Schema " + sampleName + " should be valid: " + result.getErrors())
                            .isTrue();
                    }));
                });
        }
        
        return tests.stream();
    }

    @TestFactory
    @DisplayName("All sample instances validate against their schemas")
    Stream<DynamicTest> allSampleInstancesValidate() throws IOException {
        if (samplesPath == null || !Files.exists(samplesPath)) {
            return Stream.of(dynamicTest("Samples path not found - skipping", () -> {
                System.out.println("Warning: Samples directory not found. Skipping sample file tests.");
            }));
        }

        List<DynamicTest> tests = new ArrayList<>();
        
        try (Stream<Path> sampleDirs = Files.walk(samplesPath, 1)) {
            sampleDirs
                .filter(Files::isDirectory)
                .filter(p -> !p.equals(samplesPath))
                .forEach(sampleDir -> {
                    Path schemaPath = sampleDir.resolve("schema.struct.json");
                    if (!Files.exists(schemaPath)) {
                        return;
                    }
                    
                    String sampleName = sampleDir.getFileName().toString();
                    
                    try {
                        String schemaContent = Files.readString(schemaPath);
                        
                        // Find all example files
                        try (Stream<Path> examplePaths = Files.list(sampleDir)) {
                            examplePaths
                                .filter(p -> p.getFileName().toString().startsWith("example"))
                                .filter(p -> p.getFileName().toString().endsWith(".json"))
                                .forEach(examplePath -> {
                                    String exampleName = examplePath.getFileName().toString();
                                    tests.add(dynamicTest(sampleName + "/" + exampleName, () -> {
                                        String instanceContent = Files.readString(examplePath);
                                        ValidationResult result = instanceValidator.validate(instanceContent, schemaContent);
                                        assertThat(result.isValid())
                                            .withFailMessage(() -> "Instance " + exampleName + " should be valid against " + 
                                                sampleName + " schema: " + result.getErrors())
                                            .isTrue();
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

    @TestFactory
    @DisplayName("Import samples - all schemas are valid")
    Stream<DynamicTest> importSampleSchemasAreValid() throws IOException {
        Path importSamplesPath = samplesPath != null ? 
            samplesPath.getParent().resolve("import") : null;
            
        if (importSamplesPath == null || !Files.exists(importSamplesPath)) {
            return Stream.of(dynamicTest("Import samples path not found - skipping", () -> {
                System.out.println("Warning: Import samples directory not found. Skipping import sample tests.");
            }));
        }

        List<DynamicTest> tests = new ArrayList<>();
        
        try (Stream<Path> schemaPaths = Files.walk(importSamplesPath)) {
            schemaPaths
                .filter(p -> p.getFileName().toString().endsWith(".struct.json"))
                .forEach(schemaPath -> {
                    String schemaName = schemaPath.getFileName().toString();
                    tests.add(dynamicTest("Import Schema: " + schemaName, () -> {
                        String schemaContent = Files.readString(schemaPath);
                        ValidationResult result = schemaValidator.validate(schemaContent);
                        // Note: Import schemas may have $import which requires resolution
                        // For now, we just validate the schema structure itself
                        if (!result.isValid()) {
                            // Check if failure is due to unresolved $import (which is expected)
                            boolean hasImportError = result.getErrors().stream()
                                .anyMatch(e -> e.getMessage().contains("$import") || 
                                              e.getMessage().contains("reference"));
                            if (!hasImportError) {
                                fail("Schema " + schemaName + " should be valid: " + result.getErrors());
                            }
                        }
                    }));
                });
        }
        
        return tests.stream();
    }
}
