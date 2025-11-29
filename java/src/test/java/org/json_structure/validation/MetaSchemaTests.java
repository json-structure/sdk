// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.*;

/**
 * Tests for validating the JSON Structure metaschemas.
 * These tests verify that the SDK can validate the metaschemas themselves.
 */
class MetaSchemaTests {

    private static ObjectMapper objectMapper;
    private static Path metaPath;
    private static JsonNode coreMetaSchema;
    private static JsonNode extendedMetaSchema;
    private static JsonNode validationMetaSchema;

    @BeforeAll
    static void setUpAll() throws IOException {
        objectMapper = new ObjectMapper();
        
        // Find the meta directory relative to the test file location
        // The structure is: sdk/java/src/test/java/... and meta is at sdk/meta
        Path currentPath = Paths.get("").toAbsolutePath();
        
        // Try different possible locations for meta directory
        Path[] possiblePaths = {
            currentPath.resolve("meta"),
            currentPath.resolve("sdk/meta"),
            currentPath.getParent().resolve("meta"),
            currentPath.resolve("../../meta").normalize()
        };
        
        metaPath = null;
        for (Path p : possiblePaths) {
            if (Files.exists(p.resolve("core/v0/index.json"))) {
                metaPath = p;
                break;
            }
        }
        
        if (metaPath == null) {
            // When running from sdk/java directory
            metaPath = Paths.get("../meta").toAbsolutePath().normalize();
        }
        
        assertThat(Files.exists(metaPath.resolve("core/v0/index.json")))
            .as("Meta directory should exist at " + metaPath)
            .isTrue();
        
        // Load metaschemas
        coreMetaSchema = objectMapper.readTree(
            Files.readString(metaPath.resolve("core/v0/index.json")));
        extendedMetaSchema = objectMapper.readTree(
            Files.readString(metaPath.resolve("extended/v0/index.json")));
        validationMetaSchema = objectMapper.readTree(
            Files.readString(metaPath.resolve("validation/v0/index.json")));
    }

    @Test
    @DisplayName("Core metaschema should be a valid schema")
    void coreMetaSchemaIsValid() {
        ValidationOptions options = new ValidationOptions()
            .setAllowDollar(true);
        SchemaValidator validator = new SchemaValidator(options);
        
        ValidationResult result = validator.validate(coreMetaSchema);
        
        if (!result.isValid()) {
            System.out.println("Core metaschema validation errors:");
            for (ValidationError error : result.getErrors()) {
                System.out.println("  " + error.getPath() + ": " + error.getMessage());
            }
        }
        
        assertThat(result.isValid())
            .as("Core metaschema should be valid")
            .isTrue();
    }

    @Test
    @DisplayName("Extended metaschema should be valid with import processing")
    void extendedMetaSchemaIsValidWithImport() {
        // Extended metaschema imports core using the full URI
        Map<String, JsonNode> externalSchemas = new HashMap<>();
        externalSchemas.put("https://json-structure.org/meta/core/v0/#", coreMetaSchema);
        
        ValidationOptions options = new ValidationOptions()
            .setAllowDollar(true)
            .setAllowImport(true)
            .setExternalSchemas(externalSchemas);
        SchemaValidator validator = new SchemaValidator(options);
        
        // Make a copy to avoid modifying the original
        JsonNode extendedCopy = extendedMetaSchema.deepCopy();
        ValidationResult result = validator.validate(extendedCopy);
        
        if (!result.isValid()) {
            System.out.println("Extended metaschema validation errors:");
            for (ValidationError error : result.getErrors()) {
                System.out.println("  " + error.getPath() + ": " + error.getMessage());
            }
        }
        
        assertThat(result.isValid())
            .as("Extended metaschema should be valid with import processing")
            .isTrue();
    }

    @Test
    @DisplayName("Validation metaschema should be valid with chained imports")
    void validationMetaSchemaIsValidWithChainedImports() {
        // Validation metaschema imports extended (which imports core)
        Map<String, JsonNode> externalSchemas = new HashMap<>();
        externalSchemas.put("https://json-structure.org/meta/core/v0/#", coreMetaSchema.deepCopy());
        externalSchemas.put("https://json-structure.org/meta/extended/v0/#", extendedMetaSchema.deepCopy());
        
        ValidationOptions options = new ValidationOptions()
            .setAllowDollar(true)
            .setAllowImport(true)
            .setExternalSchemas(externalSchemas);
        SchemaValidator validator = new SchemaValidator(options);
        
        // Make a copy to avoid modifying the original
        JsonNode validationCopy = validationMetaSchema.deepCopy();
        ValidationResult result = validator.validate(validationCopy);
        
        if (!result.isValid()) {
            System.out.println("Validation metaschema validation errors:");
            for (ValidationError error : result.getErrors()) {
                System.out.println("  " + error.getPath() + ": " + error.getMessage());
            }
        }
        
        assertThat(result.isValid())
            .as("Validation metaschema should be valid with chained imports")
            .isTrue();
    }

    @Test
    @DisplayName("Core metaschema loads and parses successfully")
    void coreMetaSchemaLoadsSuccessfully() {
        assertThat(coreMetaSchema).isNotNull();
        assertThat(coreMetaSchema.has("$schema")).isTrue();
        assertThat(coreMetaSchema.has("definitions")).isTrue();
    }

    @Test
    @DisplayName("Extended metaschema has import directive")
    void extendedMetaSchemaHasImport() {
        assertThat(extendedMetaSchema).isNotNull();
        assertThat(extendedMetaSchema.has("$import")).isTrue();
        assertThat(extendedMetaSchema.get("$import").asText()).contains("core");
    }

    @Test
    @DisplayName("Validation metaschema has import directive")
    void validationMetaSchemaHasImport() {
        assertThat(validationMetaSchema).isNotNull();
        assertThat(validationMetaSchema.has("$import")).isTrue();
        assertThat(validationMetaSchema.get("$import").asText()).contains("extended");
    }
}
