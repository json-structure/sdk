// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.json_structure.validation.InstanceValidator;
import org.json_structure.validation.SchemaValidator;
import org.json_structure.validation.ValidationResult;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.assertj.core.api.Assertions.*;

/**
 * Integration tests that validate against sample schemas from the primer.
 */
class PrimerSamplesIntegrationTests {

    private static SchemaValidator schemaValidator;
    private static InstanceValidator instanceValidator;
    private static ObjectMapper mapper;

    @BeforeAll
    static void setUpAll() {
        schemaValidator = new SchemaValidator();
        instanceValidator = new InstanceValidator();
        mapper = new ObjectMapper();
    }

    @Nested
    @DisplayName("Person Schema Tests")
    class PersonSchemaTests {

        private static final String PERSON_SCHEMA = """
            {
                "$schema": "https://json-structure.org/draft/2025-02/schema",
                "$id": "https://test.example.com/person/person-schema",
                "name": "Person",
                "type": "object",
                "properties": {
                    "firstName": { "type": "string" },
                    "lastName": { "type": "string" },
                    "age": { "type": "int32", "minimum": 0 },
                    "email": { "type": "string", "pattern": "^[^@]+@[^@]+\\\\.[^@]+$" }
                },
                "required": ["firstName", "lastName"]
            }
            """;

        @Test
        @DisplayName("Schema is valid")
        void schemaIsValid() {
            ValidationResult result = schemaValidator.validate(PERSON_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Schema should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Valid person instance")
        void validPersonInstance() {
            String instance = """
                {
                    "firstName": "John",
                    "lastName": "Doe",
                    "age": 30,
                    "email": "john.doe@example.com"
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, PERSON_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Instance should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Valid person with only required fields")
        void validPersonWithOnlyRequiredFields() {
            String instance = """
                {
                    "firstName": "John",
                    "lastName": "Doe"
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, PERSON_SCHEMA);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid person - missing required field")
        void invalidPersonMissingRequiredField() {
            String instance = """
                {
                    "firstName": "John"
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, PERSON_SCHEMA);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> 
                e.getMessage().contains("lastName") || e.getMessage().contains("required"));
        }

        @Test
        @DisplayName("Invalid person - negative age")
        void invalidPersonNegativeAge() {
            String instance = """
                {
                    "firstName": "John",
                    "lastName": "Doe",
                    "age": -5
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, PERSON_SCHEMA);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Invalid person - invalid email format")
        void invalidPersonInvalidEmailFormat() {
            String instance = """
                {
                    "firstName": "John",
                    "lastName": "Doe",
                    "email": "not-an-email"
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, PERSON_SCHEMA);
            assertThat(result.isValid()).isFalse();
        }
    }

    @Nested
    @DisplayName("Product Catalog Schema Tests")
    class ProductCatalogSchemaTests {

        private static final String PRODUCT_SCHEMA = """
            {
                "$schema": "https://json-structure.org/draft/2025-02/schema",
                "$id": "https://test.example.com/product/product-catalog-schema",
                "name": "ProductCatalog",
                "$defs": {
                    "price": {
                        "type": "object",
                        "properties": {
                            "amount": { "type": "double", "minimum": 0 },
                            "currency": { "type": "string", "minLength": 3, "maxLength": 3 }
                        },
                        "required": ["amount", "currency"]
                    },
                    "product": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "uuid" },
                            "name": { "type": "string", "minLength": 1 },
                            "description": { "type": "string" },
                            "price": { "$ref": "#/$defs/price" },
                            "inStock": { "type": "boolean" }
                        },
                        "required": ["id", "name", "price"]
                    }
                },
                "type": "object",
                "properties": {
                    "catalog": {
                        "type": "array",
                        "items": { "$ref": "#/$defs/product" }
                    }
                }
            }
            """;

        @Test
        @DisplayName("Schema is valid")
        void schemaIsValid() {
            ValidationResult result = schemaValidator.validate(PRODUCT_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Schema should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Valid product catalog")
        void validProductCatalog() {
            String instance = """
                {
                    "catalog": [
                        {
                            "id": "550e8400-e29b-41d4-a716-446655440000",
                            "name": "Widget",
                            "description": "A useful widget",
                            "price": { "amount": 19.99, "currency": "USD" },
                            "inStock": true
                        },
                        {
                            "id": "550e8400-e29b-41d4-a716-446655440001",
                            "name": "Gadget",
                            "price": { "amount": 49.99, "currency": "EUR" },
                            "inStock": false
                        }
                    ]
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, PRODUCT_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Instance should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Invalid product - missing required price")
        void invalidProductMissingPrice() {
            String instance = """
                {
                    "catalog": [
                        {
                            "id": "550e8400-e29b-41d4-a716-446655440000",
                            "name": "Widget"
                        }
                    ]
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, PRODUCT_SCHEMA);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Invalid product - invalid currency length")
        void invalidProductInvalidCurrencyLength() {
            String instance = """
                {
                    "catalog": [
                        {
                            "id": "550e8400-e29b-41d4-a716-446655440000",
                            "name": "Widget",
                            "price": { "amount": 19.99, "currency": "US" }
                        }
                    ]
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, PRODUCT_SCHEMA);
            assertThat(result.isValid()).isFalse();
        }
    }

    @Nested
    @DisplayName("Event Schema Tests")
    class EventSchemaTests {

        private static final String EVENT_SCHEMA = """
            {
                "$schema": "https://json-structure.org/draft/2025-02/schema",
                "$id": "https://test.example.com/event/event-schema",
                "name": "Event",
                "type": "object",
                "properties": {
                    "eventId": { "type": "uuid" },
                    "eventType": { "type": "string", "enum": ["created", "updated", "deleted"] },
                    "timestamp": { "type": "datetime" },
                    "payload": { "type": "object" }
                },
                "required": ["eventId", "eventType", "timestamp"]
            }
            """;

        @Test
        @DisplayName("Schema is valid")
        void schemaIsValid() {
            ValidationResult result = schemaValidator.validate(EVENT_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Schema should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Valid event")
        void validEvent() {
            String instance = """
                {
                    "eventId": "550e8400-e29b-41d4-a716-446655440000",
                    "eventType": "created",
                    "timestamp": "2024-01-15T10:30:00Z",
                    "payload": { "data": "value" }
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, EVENT_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Instance should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Invalid event - invalid eventType")
        void invalidEventInvalidEventType() {
            String instance = """
                {
                    "eventId": "550e8400-e29b-41d4-a716-446655440000",
                    "eventType": "unknown",
                    "timestamp": "2024-01-15T10:30:00Z"
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, EVENT_SCHEMA);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Invalid event - invalid datetime format")
        void invalidEventInvalidDatetimeFormat() {
            String instance = """
                {
                    "eventId": "550e8400-e29b-41d4-a716-446655440000",
                    "eventType": "created",
                    "timestamp": "not-a-datetime"
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, EVENT_SCHEMA);
            assertThat(result.isValid()).isFalse();
        }
    }

    @Nested
    @DisplayName("Configuration Schema Tests")
    class ConfigurationSchemaTests {

        private static final String CONFIG_SCHEMA = """
            {
                "$schema": "https://json-structure.org/draft/2025-02/schema",
                "$id": "https://test.example.com/configuration/config-schema",
                "name": "Configuration",
                "type": "object",
                "properties": {
                    "server": {
                        "type": "object",
                        "properties": {
                            "host": { "type": "string" },
                            "port": { "type": "uint16" },
                            "timeout": { "type": "duration" }
                        },
                        "required": ["host", "port"]
                    },
                    "features": {
                        "type": "set",
                        "items": { "type": "string" }
                    },
                    "metadata": {
                        "type": "map",
                        "values": { "type": "string" }
                    }
                }
            }
            """;

        @Test
        @DisplayName("Schema is valid")
        void schemaIsValid() {
            ValidationResult result = schemaValidator.validate(CONFIG_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Schema should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Valid configuration")
        void validConfiguration() {
            String instance = """
                {
                    "server": {
                        "host": "localhost",
                        "port": 8080,
                        "timeout": "PT30S"
                    },
                    "features": ["logging", "metrics", "tracing"],
                    "metadata": {
                        "environment": "production",
                        "version": "1.0.0"
                    }
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, CONFIG_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Instance should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Invalid configuration - duplicate features in set")
        void invalidConfigurationDuplicateFeaturesInSet() {
            String instance = """
                {
                    "server": {
                        "host": "localhost",
                        "port": 8080
                    },
                    "features": ["logging", "metrics", "logging"]
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, CONFIG_SCHEMA);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> 
                e.getMessage().contains("duplicate") || e.getMessage().contains("unique"));
        }

        @Test
        @DisplayName("Invalid configuration - port out of uint16 range")
        void invalidConfigurationPortOutOfRange() {
            String instance = """
                {
                    "server": {
                        "host": "localhost",
                        "port": 70000
                    }
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, CONFIG_SCHEMA);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Invalid configuration - invalid duration format")
        void invalidConfigurationInvalidDurationFormat() {
            String instance = """
                {
                    "server": {
                        "host": "localhost",
                        "port": 8080,
                        "timeout": "30 seconds"
                    }
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, CONFIG_SCHEMA);
            assertThat(result.isValid()).isFalse();
        }
    }

    @Nested
    @DisplayName("Conditional Schema Tests")
    class ConditionalSchemaTests {

        private static final String VEHICLE_SCHEMA = """
            {
                "$schema": "https://json-structure.org/draft/2025-02/schema",
                "$id": "https://test.example.com/conditional/vehicle-schema",
                "name": "Vehicle",
                "type": "object",
                "properties": {
                    "vehicleType": { "type": "string", "enum": ["car", "motorcycle", "truck"] },
                    "wheels": { "type": "int32" },
                    "hasSidecar": { "type": "boolean" }
                },
                "required": ["vehicleType"],
                "allOf": [
                    {
                        "if": {
                            "properties": { "vehicleType": { "const": "car" } }
                        },
                        "then": {
                            "properties": { "wheels": { "const": 4 } }
                        }
                    },
                    {
                        "if": {
                            "properties": { "vehicleType": { "const": "motorcycle" } }
                        },
                        "then": {
                            "properties": { 
                                "wheels": { "enum": [2, 3] }
                            }
                        }
                    }
                ]
            }
            """;

        @Test
        @DisplayName("Schema is valid")
        void schemaIsValid() {
            ValidationResult result = schemaValidator.validate(VEHICLE_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Schema should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Valid car with 4 wheels")
        void validCarWith4Wheels() {
            String instance = """
                {
                    "vehicleType": "car",
                    "wheels": 4
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, VEHICLE_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Instance should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Valid motorcycle with 2 wheels")
        void validMotorcycleWith2Wheels() {
            String instance = """
                {
                    "vehicleType": "motorcycle",
                    "wheels": 2
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, VEHICLE_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Instance should be valid: " + result.getErrors())
                .isTrue();
        }

        @Test
        @DisplayName("Valid motorcycle with sidecar (3 wheels)")
        void validMotorcycleWithSidecar() {
            String instance = """
                {
                    "vehicleType": "motorcycle",
                    "wheels": 3,
                    "hasSidecar": true
                }
                """;
            
            ValidationResult result = instanceValidator.validate(instance, VEHICLE_SCHEMA);
            assertThat(result.isValid())
                .withFailMessage(() -> "Instance should be valid: " + result.getErrors())
                .isTrue();
        }
    }
}
