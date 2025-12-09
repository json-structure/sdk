// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.*;

/**
 * Tests for thread safety of validators.
 */
class ThreadSafetyTests {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("InstanceValidator: Concurrent validations produce correct results")
    void instanceValidatorConcurrentValidations() throws Exception {
        InstanceValidator validator = new InstanceValidator();
        
        String schema = """
            {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "age": { "type": "int32" }
                },
                "required": ["name"]
            }
            """;

        // Valid instance
        String validInstance = """
            {
                "name": "Alice",
                "age": 30
            }
            """;

        // Invalid instance (missing required field)
        String invalidInstance = """
            {
                "age": 25
            }
            """;

        ExecutorService executor = Executors.newFixedThreadPool(10);
        List<Future<ValidationResult>> futures = new ArrayList<>();

        // Submit 50 concurrent validation tasks (mix of valid and invalid)
        for (int i = 0; i < 50; i++) {
            final String instance = (i % 2 == 0) ? validInstance : invalidInstance;
            final boolean expectedValid = (i % 2 == 0);
            
            futures.add(executor.submit(() -> {
                ValidationResult result = validator.validate(instance, schema);
                // Verify result matches expectation
                assertThat(result.isValid()).isEqualTo(expectedValid);
                return result;
            }));
        }

        // Wait for all tasks to complete
        for (Future<ValidationResult> future : futures) {
            future.get(5, TimeUnit.SECONDS);
        }

        executor.shutdown();
        assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    @DisplayName("InstanceValidator: Sequential reuse produces correct results")
    void instanceValidatorSequentialReuse() throws Exception {
        InstanceValidator validator = new InstanceValidator();
        
        String schema1 = """
            {
                "type": "string",
                "minLength": 5
            }
            """;

        String schema2 = """
            {
                "type": "int32",
                "minimum": 10
            }
            """;

        // Validate with first schema
        ValidationResult result1 = validator.validate("\"hello\"", schema1);
        assertThat(result1.isValid()).isTrue();

        ValidationResult result2 = validator.validate("\"hi\"", schema1);
        assertThat(result2.isValid()).isFalse();

        // Validate with second schema (verifying state doesn't leak)
        ValidationResult result3 = validator.validate("15", schema2);
        assertThat(result3.isValid()).isTrue();

        ValidationResult result4 = validator.validate("5", schema2);
        assertThat(result4.isValid()).isFalse();

        // Go back to first schema
        ValidationResult result5 = validator.validate("\"world\"", schema1);
        assertThat(result5.isValid()).isTrue();
    }

    @Test
    @DisplayName("InstanceValidator: No error cross-contamination")
    void instanceValidatorNoErrorContamination() throws Exception {
        InstanceValidator validator = new InstanceValidator();
        
        String schema = """
            {
                "type": "object",
                "properties": {
                    "value": { "type": "int32" }
                },
                "required": ["value"]
            }
            """;

        ExecutorService executor = Executors.newFixedThreadPool(5);
        List<Future<ValidationResult>> futures = new ArrayList<>();

        // Submit concurrent validations with different errors
        for (int i = 0; i < 10; i++) {
            final int index = i;
            futures.add(executor.submit(() -> {
                String instance;
                if (index % 3 == 0) {
                    // Missing required field
                    instance = "{}";
                } else if (index % 3 == 1) {
                    // Wrong type
                    instance = "{\"value\": \"string\"}";
                } else {
                    // Valid
                    instance = "{\"value\": 42}";
                }
                
                ValidationResult result = validator.validate(instance, schema);
                
                // Verify errors are specific to this validation
                if (index % 3 == 0) {
                    assertThat(result.getErrors())
                            .anyMatch(e -> e.getMessage().contains("required"));
                } else if (index % 3 == 1) {
                    assertThat(result.getErrors())
                            .anyMatch(e -> e.getMessage().contains("int32") || e.getMessage().contains("number"));
                } else {
                    assertThat(result.getErrors()).isEmpty();
                }
                
                return result;
            }));
        }

        // Wait for all to complete
        for (Future<ValidationResult> future : futures) {
            future.get(5, TimeUnit.SECONDS);
        }

        executor.shutdown();
        assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    @DisplayName("SchemaValidator: Concurrent validations produce correct results")
    void schemaValidatorConcurrentValidations() throws Exception {
        SchemaValidator validator = new SchemaValidator();
        
        String validSchema = """
            {
                "$id": "https://test.example.com/schema",
                "name": "TestSchema",
                "type": "object",
                "properties": {
                    "name": { "type": "string" }
                }
            }
            """;

        String invalidSchema = """
            {
                "$id": "https://test.example.com/schema",
                "name": "TestSchema",
                "type": "object",
                "properties": {
                    "name": { "type": "invalid-type" }
                }
            }
            """;

        ExecutorService executor = Executors.newFixedThreadPool(10);
        List<Future<ValidationResult>> futures = new ArrayList<>();

        // Submit 30 concurrent schema validation tasks
        for (int i = 0; i < 30; i++) {
            final String schema = (i % 2 == 0) ? validSchema : invalidSchema;
            final boolean expectedValid = (i % 2 == 0);
            
            futures.add(executor.submit(() -> {
                ValidationResult result = validator.validate(schema);
                assertThat(result.isValid()).isEqualTo(expectedValid);
                return result;
            }));
        }

        // Wait for all tasks to complete
        for (Future<ValidationResult> future : futures) {
            future.get(5, TimeUnit.SECONDS);
        }

        executor.shutdown();
        assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    @DisplayName("SchemaValidator: Sequential reuse produces correct results")
    void schemaValidatorSequentialReuse() throws Exception {
        SchemaValidator validator = new SchemaValidator();
        
        // First validation
        String schema1 = """
            {
                "$id": "https://test.example.com/schema1",
                "name": "Schema1",
                "type": "string"
            }
            """;
        ValidationResult result1 = validator.validate(schema1);
        assertThat(result1.isValid()).isTrue();

        // Second validation with different schema
        String schema2 = """
            {
                "$id": "https://test.example.com/schema2",
                "name": "Schema2",
                "type": "array",
                "items": { "type": "int32" }
            }
            """;
        ValidationResult result2 = validator.validate(schema2);
        assertThat(result2.isValid()).isTrue();

        // Invalid schema
        String invalidSchema = """
            {
                "type": "object"
            }
            """;
        ValidationResult result3 = validator.validate(invalidSchema);
        assertThat(result3.isValid()).isFalse();

        // Back to valid
        ValidationResult result4 = validator.validate(schema1);
        assertThat(result4.isValid()).isTrue();
    }
}
