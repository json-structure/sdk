// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.*;

/**
 * Tests for SchemaValidator.
 */
class SchemaValidatorTests {

    private SchemaValidator validator;

    @BeforeEach
    void setUp() {
        validator = new SchemaValidator();
    }

    // === Valid Schema Tests ===

    @Test
    @DisplayName("Valid schema with primitive types")
    void validSchemaWithPrimitiveTypes() {
        String schema = """
            {
                "$schema": "https://json-structure.org/meta/core/v1.0",
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "age": { "type": "int32" },
                    "active": { "type": "boolean" }
                }
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Test
    @DisplayName("Valid schema with extended numeric types")
    void validSchemaWithExtendedNumericTypes() {
        String schema = """
            {
                "type": "object",
                "properties": {
                    "small": { "type": "int8" },
                    "medium": { "type": "int16" },
                    "large": { "type": "int64" },
                    "huge": { "type": "int128" },
                    "unsigned": { "type": "uint64" },
                    "precise": { "type": "decimal" }
                }
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid schema with temporal types")
    void validSchemaWithTemporalTypes() {
        String schema = """
            {
                "type": "object",
                "properties": {
                    "birthDate": { "type": "date" },
                    "startTime": { "type": "time" },
                    "created": { "type": "datetime" },
                    "validity": { "type": "duration" }
                }
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid schema with compound types")
    void validSchemaWithCompoundTypes() {
        String schema = """
            {
                "type": "object",
                "properties": {
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "uniqueTags": { "type": "set", "items": { "type": "string" } },
                    "metadata": { "type": "map", "values": { "type": "string" } }
                }
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid schema with $defs and $ref")
    void validSchemaWithDefsAndRef() {
        String schema = """
            {
                "$defs": {
                    "Address": {
                        "type": "object",
                        "properties": {
                            "street": { "type": "string" },
                            "city": { "type": "string" }
                        }
                    }
                },
                "type": "object",
                "properties": {
                    "home": { "$ref": "#/$defs/Address" },
                    "work": { "$ref": "#/$defs/Address" }
                }
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid schema with enum")
    void validSchemaWithEnum() {
        String schema = """
            {
                "type": "string",
                "enum": ["pending", "approved", "rejected"]
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid schema with string constraints")
    void validSchemaWithStringConstraints() {
        String schema = """
            {
                "type": "string",
                "minLength": 1,
                "maxLength": 100,
                "pattern": "^[a-zA-Z]+$"
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid schema with numeric constraints")
    void validSchemaWithNumericConstraints() {
        String schema = """
            {
                "type": "int32",
                "minimum": 0,
                "maximum": 100,
                "multipleOf": 5
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid schema with allOf composition")
    void validSchemaWithAllOfComposition() {
        String schema = """
            {
                "allOf": [
                    { "type": "object", "properties": { "a": { "type": "string" } } },
                    { "type": "object", "properties": { "b": { "type": "int32" } } }
                ]
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid tuple schema")
    void validTupleSchema() {
        String schema = """
            {
                "type": "tuple",
                "prefixItems": [
                    { "type": "string" },
                    { "type": "int32" },
                    { "type": "boolean" }
                ],
                "items": false
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid choice schema with discriminator")
    void validChoiceSchemaWithDiscriminator() {
        String schema = """
            {
                "type": "choice",
                "discriminator": "type",
                "options": {
                    "circle": { "type": "object", "properties": { "radius": { "type": "double" } } },
                    "rectangle": { "type": "object", "properties": { "width": { "type": "double" }, "height": { "type": "double" } } }
                }
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Boolean schema true is valid")
    void booleanSchemaTrue() {
        String schema = "true";
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Boolean schema false is valid")
    void booleanSchemaFalse() {
        String schema = "false";
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    // === Invalid Schema Tests ===

    @Test
    @DisplayName("Invalid type value")
    void invalidTypeValue() {
        String schema = """
            {
                "type": "invalidType"
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("Invalid type"));
    }

    @Test
    @DisplayName("Invalid - type must be string or array")
    void invalidTypeNotStringOrArray() {
        String schema = """
            {
                "type": 123
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
    }

    @Test
    @DisplayName("Invalid - empty type array")
    void invalidEmptyTypeArray() {
        String schema = """
            {
                "type": []
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("empty"));
    }

    @Test
    @DisplayName("Invalid - empty enum array")
    void invalidEmptyEnumArray() {
        String schema = """
            {
                "type": "string",
                "enum": []
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("empty"));
    }

    @Test
    @DisplayName("Invalid - required must be array")
    void invalidRequiredNotArray() {
        String schema = """
            {
                "type": "object",
                "properties": {
                    "name": { "type": "string" }
                },
                "required": "name"
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("must be an array"));
    }

    @Test
    @DisplayName("Invalid - properties must be object")
    void invalidPropertiesNotObject() {
        String schema = """
            {
                "type": "object",
                "properties": "invalid"
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("must be an object"));
    }

    @Test
    @DisplayName("Invalid - negative minLength")
    void invalidNegativeMinLength() {
        String schema = """
            {
                "type": "string",
                "minLength": -1
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("non-negative"));
    }

    @Test
    @DisplayName("Invalid - multipleOf must be positive")
    void invalidNonPositiveMultipleOf() {
        String schema = """
            {
                "type": "number",
                "multipleOf": 0
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("positive"));
    }

    @Test
    @DisplayName("Invalid regex pattern")
    void invalidRegexPattern() {
        String schema = """
            {
                "type": "string",
                "pattern": "[invalid("
            }
            """;
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("regular expression"));
    }

    @Test
    @DisplayName("Null schema is invalid")
    void nullSchemaIsInvalid() {
        ValidationResult result = validator.validate((String) null);
        assertThat(result.isValid()).isFalse();
    }

    @Test
    @DisplayName("Invalid JSON is caught")
    void invalidJsonIsCaught() {
        String schema = "{ not valid json }";
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
        assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("parse"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"int8", "int16", "int32", "int64", "int128",
            "uint8", "uint16", "uint32", "uint64", "uint128",
            "float8", "float", "double", "decimal",
            "string", "boolean", "date", "time", "datetime", "duration",
            "uuid", "uri", "binary", "object"})
    @DisplayName("All primitive and object JSON Structure types are valid")
    void allJsonStructureTypesAreValid(String typeName) {
        String schema = """
            {
                "type": "%s"
            }
            """.formatted(typeName);
        
        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Array type requires items")
    void arrayTypeRequiresItems() {
        String validSchema = """
            {
                "type": "array",
                "items": { "type": "string" }
            }
            """;
        assertThat(validator.validate(validSchema).isValid()).isTrue();

        String invalidSchema = """
            {
                "type": "array"
            }
            """;
        assertThat(validator.validate(invalidSchema).isValid()).isFalse();
    }

    @Test
    @DisplayName("Set type requires items")
    void setTypeRequiresItems() {
        String validSchema = """
            {
                "type": "set",
                "items": { "type": "string" }
            }
            """;
        assertThat(validator.validate(validSchema).isValid()).isTrue();

        String invalidSchema = """
            {
                "type": "set"
            }
            """;
        assertThat(validator.validate(invalidSchema).isValid()).isFalse();
    }

    @Test
    @DisplayName("Map type requires values")
    void mapTypeRequiresValues() {
        String validSchema = """
            {
                "type": "map",
                "values": { "type": "string" }
            }
            """;
        assertThat(validator.validate(validSchema).isValid()).isTrue();

        String invalidSchema = """
            {
                "type": "map"
            }
            """;
        assertThat(validator.validate(invalidSchema).isValid()).isFalse();
    }

    @Test
    @DisplayName("Tuple type requires prefixItems")
    void tupleTypeRequiresPrefixItems() {
        String validSchema = """
            {
                "type": "tuple",
                "prefixItems": [
                    { "type": "string" },
                    { "type": "int32" }
                ]
            }
            """;
        assertThat(validator.validate(validSchema).isValid()).isTrue();

        String invalidSchema = """
            {
                "type": "tuple"
            }
            """;
        assertThat(validator.validate(invalidSchema).isValid()).isFalse();
    }

    @Test
    @DisplayName("Choice type requires discriminator or oneOf")
    void choiceTypeRequiresDiscriminator() {
        String validSchema = """
            {
                "type": "choice",
                "discriminator": "type",
                "options": {
                    "a": { "type": "object", "properties": {} },
                    "b": { "type": "object", "properties": {} }
                }
            }
            """;
        assertThat(validator.validate(validSchema).isValid()).isTrue();

        String invalidSchema = """
            {
                "type": "choice"
            }
            """;
        assertThat(validator.validate(invalidSchema).isValid()).isFalse();
    }
}
