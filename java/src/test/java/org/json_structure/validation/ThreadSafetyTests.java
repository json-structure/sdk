// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests to verify that the validator classes are thread-safe.
 * Multiple threads can use the same validator instance concurrently.
 */
public class ThreadSafetyTests {
    
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    public void instanceValidator_concurrentValidations_isolateErrors() throws Exception {
        // Arrange: Single validator instance shared across threads
        InstanceValidator validator = new InstanceValidator();

        ObjectNode schema = mapper.createObjectNode();
        schema.put("type", "object");
        ObjectNode properties = schema.putObject("properties");
        properties.putObject("name").put("type", "string");
        ObjectNode ageSchema = properties.putObject("age");
        ageSchema.put("type", "integer");
        ageSchema.put("minimum", 0);
        ArrayNode required = schema.putArray("required");
        required.add("name");

        // Run many concurrent validations
        int iterations = 100;
        ExecutorService executor = Executors.newFixedThreadPool(10);
        List<Future<Boolean>> futures = new ArrayList<>();

        for (int i = 0; i < iterations; i++) {
            final int iteration = i;
            futures.add(executor.submit(() -> {
                ObjectNode instance;
                boolean shouldBeValid;

                if (iteration % 3 == 0) {
                    // Valid instance
                    instance = mapper.createObjectNode();
                    instance.put("name", "John");
                    instance.put("age", 30);
                    shouldBeValid = true;
                } else if (iteration % 3 == 1) {
                    // Invalid: missing required field
                    instance = mapper.createObjectNode();
                    instance.put("age", 25);
                    shouldBeValid = false;
                } else {
                    // Invalid: wrong type for age
                    instance = mapper.createObjectNode();
                    instance.put("name", "Jane");
                    instance.put("age", "not a number");
                    shouldBeValid = false;
                }

                ValidationResult result = validator.validate(instance, schema.deepCopy());
                return result.isValid() == shouldBeValid;
            }));
        }

        executor.shutdown();
        assertTrue(executor.awaitTermination(30, TimeUnit.SECONDS));

        // Assert: Each result should match its expected validity
        for (int i = 0; i < iterations; i++) {
            assertTrue(futures.get(i).get(), "Iteration " + i + " did not match expected validity");
        }
    }

    @Test
    public void instanceValidator_concurrentValidations_errorsDoNotLeak() throws Exception {
        // Arrange
        InstanceValidator validator = new InstanceValidator();
        ObjectNode schema = mapper.createObjectNode();
        schema.put("type", "string");

        int iterations = 50;
        ExecutorService executor = Executors.newFixedThreadPool(10);
        List<Future<ValidationResult>> futures = new ArrayList<>();

        for (int i = 0; i < iterations; i++) {
            final int iteration = i;
            futures.add(executor.submit(() -> {
                JsonNode instance;
                if (iteration % 2 == 0) {
                    instance = mapper.valueToTree("string_" + iteration);
                } else {
                    instance = mapper.valueToTree(iteration);
                }
                return validator.validate(instance, schema.deepCopy());
            }));
        }

        executor.shutdown();
        assertTrue(executor.awaitTermination(30, TimeUnit.SECONDS));

        // Assert
        for (int i = 0; i < iterations; i++) {
            ValidationResult result = futures.get(i).get();
            if (i % 2 == 0) {
                assertTrue(result.isValid(), "Iteration " + i + " should be valid");
                assertTrue(result.getErrors().isEmpty(), "Iteration " + i + " should have no errors");
            } else {
                assertFalse(result.isValid(), "Iteration " + i + " should be invalid");
                assertEquals(1, result.getErrors().size(), "Iteration " + i + " should have exactly one error");
            }
        }
    }

    @Test
    public void instanceValidator_parallelStreams_manyIterations() throws Exception {
        // Arrange
        InstanceValidator validator = new InstanceValidator();
        ObjectNode schema = mapper.createObjectNode();
        ObjectNode properties = schema.putObject("properties");
        properties.putObject("id").put("type", "integer");
        properties.putObject("data").put("type", "string");
        schema.put("type", "object");

        int iterations = 1000;
        boolean[] expectedValidity = new boolean[iterations];
        ObjectNode[] instances = new ObjectNode[iterations];

        for (int i = 0; i < iterations; i++) {
            instances[i] = mapper.createObjectNode();
            if (i % 2 == 0) {
                instances[i].put("id", i);
                instances[i].put("data", "data_" + i);
                expectedValidity[i] = true;
            } else {
                instances[i].put("id", "not an int");
                instances[i].put("data", "data_" + i);
                expectedValidity[i] = false;
            }
        }

        // Act: Use parallel stream for concurrent validation
        ValidationResult[] results = new ValidationResult[iterations];
        java.util.stream.IntStream.range(0, iterations).parallel().forEach(i -> {
            results[i] = validator.validate(instances[i], schema.deepCopy());
        });

        // Assert
        for (int i = 0; i < iterations; i++) {
            assertEquals(expectedValidity[i], results[i].isValid(), "Iteration " + i);
        }
    }

    @Test
    public void instanceValidator_stringOverload_threadSafe() throws Exception {
        // Arrange
        InstanceValidator validator = new InstanceValidator();
        String schemaJson = "{\"type\": \"object\", \"properties\": {\"value\": {\"type\": \"number\"}}}";

        int iterations = 100;
        ExecutorService executor = Executors.newFixedThreadPool(10);
        List<Future<ValidationResult>> futures = new ArrayList<>();

        for (int i = 0; i < iterations; i++) {
            final int iteration = i;
            futures.add(executor.submit(() -> {
                String instanceJson = iteration % 2 == 0
                        ? "{\"value\": " + iteration + "}"
                        : "{\"value\": \"not a number\"}";
                return validator.validate(instanceJson, schemaJson);
            }));
        }

        executor.shutdown();
        assertTrue(executor.awaitTermination(30, TimeUnit.SECONDS));

        // Assert
        for (int i = 0; i < iterations; i++) {
            ValidationResult result = futures.get(i).get();
            if (i % 2 == 0) {
                assertTrue(result.isValid(), "Iteration " + i + " should be valid");
            } else {
                assertFalse(result.isValid(), "Iteration " + i + " should be invalid");
            }
        }
    }

    @Test
    public void schemaValidator_concurrentValidations_threadSafe() throws Exception {
        // Arrange
        SchemaValidator validator = new SchemaValidator();

        int iterations = 50;
        ExecutorService executor = Executors.newFixedThreadPool(10);
        List<Future<ValidationResult>> futures = new ArrayList<>();

        for (int i = 0; i < iterations; i++) {
            final int iteration = i;
            futures.add(executor.submit(() -> {
                ObjectNode schema = mapper.createObjectNode();

                if (iteration % 3 == 0) {
                    // Valid schema with required fields
                    schema.put("$id", "test://schema" + iteration);
                    schema.put("name", "TestSchema" + iteration);
                    schema.put("type", "string");
                    schema.put("minLength", 1);
                } else if (iteration % 3 == 1) {
                    // Valid schema with properties
                    schema.put("$id", "test://schema" + iteration);
                    schema.put("name", "TestSchema" + iteration);
                    schema.put("type", "object");
                    ObjectNode properties = schema.putObject("properties");
                    properties.putObject("name").put("type", "string");
                } else {
                    // Invalid: minLength must be non-negative
                    schema.put("$id", "test://schema" + iteration);
                    schema.put("name", "TestSchema" + iteration);
                    schema.put("type", "string");
                    schema.put("minLength", -1);
                }

                return validator.validate(schema);
            }));
        }

        executor.shutdown();
        assertTrue(executor.awaitTermination(30, TimeUnit.SECONDS));

        // Assert
        for (int i = 0; i < iterations; i++) {
            boolean expected = i % 3 != 2; // iterations 2, 5, 8, etc. should be invalid
            ValidationResult result = futures.get(i).get();
            assertEquals(expected, result.isValid(), 
                    "Iteration " + i + " - errors: " + result.getErrors());
        }
    }
}
