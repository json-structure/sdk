// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;

import static org.assertj.core.api.Assertions.*;

/**
 * Tests for InstanceValidator.
 */
class InstanceValidatorTests {

    private InstanceValidator validator;

    @BeforeEach
    void setUp() {
        validator = new InstanceValidator();
    }

    @Nested
    @DisplayName("Primitive Type Validation")
    class PrimitiveTypeValidation {

        @Test
        @DisplayName("Valid string")
        void validString() {
            String schema = """
                { "type": "string" }
                """;
            String instance = "\"hello\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid string - number provided")
        void invalidStringNumberProvided() {
            String schema = """
                { "type": "string" }
                """;
            String instance = "123";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid boolean true")
        void validBooleanTrue() {
            String schema = """
                { "type": "boolean" }
                """;
            String instance = "true";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Valid boolean false")
        void validBooleanFalse() {
            String schema = """
                { "type": "boolean" }
                """;
            String instance = "false";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Valid null")
        void validNull() {
            String schema = """
                { "type": "null" }
                """;
            String instance = "null";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }
    }

    @Nested
    @DisplayName("Numeric Type Validation")
    class NumericTypeValidation {

        @Test
        @DisplayName("Valid int32")
        void validInt32() {
            String schema = """
                { "type": "int32" }
                """;
            String instance = "42";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid int8 - out of range")
        void invalidInt8OutOfRange() {
            String schema = """
                { "type": "int8" }
                """;
            String instance = "256";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid uint8")
        void validUint8() {
            String schema = """
                { "type": "uint8" }
                """;
            String instance = "255";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid uint8 - negative")
        void invalidUint8Negative() {
            String schema = """
                { "type": "uint8" }
                """;
            String instance = "-1";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid double")
        void validDouble() {
            String schema = """
                { "type": "double" }
                """;
            String instance = "3.14159";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Valid int64 as string")
        void validInt64AsString() {
            String schema = """
                { "type": "int64" }
                """;
            String instance = "\"9007199254740993\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Valid minimum constraint")
        void validMinimumConstraint() {
            String schema = """
                { "type": "int32", "minimum": 0 }
                """;
            String instance = "10";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid minimum constraint")
        void invalidMinimumConstraint() {
            String schema = """
                { "type": "int32", "minimum": 0 }
                """;
            String instance = "-5";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid maximum constraint")
        void validMaximumConstraint() {
            String schema = """
                { "type": "int32", "maximum": 100 }
                """;
            String instance = "50";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid maximum constraint")
        void invalidMaximumConstraint() {
            String schema = """
                { "type": "int32", "maximum": 100 }
                """;
            String instance = "150";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid multipleOf constraint")
        void validMultipleOfConstraint() {
            String schema = """
                { "type": "int32", "multipleOf": 5 }
                """;
            String instance = "25";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid multipleOf constraint")
        void invalidMultipleOfConstraint() {
            String schema = """
                { "type": "int32", "multipleOf": 5 }
                """;
            String instance = "23";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }
    }

    @Nested
    @DisplayName("String Constraint Validation")
    class StringConstraintValidation {

        @Test
        @DisplayName("Valid minLength")
        void validMinLength() {
            String schema = """
                { "type": "string", "minLength": 3 }
                """;
            String instance = "\"hello\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid minLength")
        void invalidMinLength() {
            String schema = """
                { "type": "string", "minLength": 10 }
                """;
            String instance = "\"hello\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid maxLength")
        void validMaxLength() {
            String schema = """
                { "type": "string", "maxLength": 10 }
                """;
            String instance = "\"hello\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid maxLength")
        void invalidMaxLength() {
            String schema = """
                { "type": "string", "maxLength": 3 }
                """;
            String instance = "\"hello\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid pattern")
        void validPattern() {
            String schema = """
                { "type": "string", "pattern": "^[a-z]+$" }
                """;
            String instance = "\"hello\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid pattern")
        void invalidPattern() {
            String schema = """
                { "type": "string", "pattern": "^[a-z]+$" }
                """;
            String instance = "\"Hello123\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }
    }

    @Nested
    @DisplayName("Object Validation")
    class ObjectValidation {

        @Test
        @DisplayName("Valid object with properties")
        void validObjectWithProperties() {
            String schema = """
                {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "age": { "type": "int32" }
                    }
                }
                """;
            String instance = """
                { "name": "Alice", "age": 30 }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid object - wrong property type")
        void invalidObjectWrongPropertyType() {
            String schema = """
                {
                    "type": "object",
                    "properties": {
                        "age": { "type": "int32" }
                    }
                }
                """;
            String instance = """
                { "age": "thirty" }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid object with required properties")
        void validObjectWithRequiredProperties() {
            String schema = """
                {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" }
                    },
                    "required": ["name"]
                }
                """;
            String instance = """
                { "name": "Alice" }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid object - missing required property")
        void invalidObjectMissingRequiredProperty() {
            String schema = """
                {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" }
                    },
                    "required": ["name"]
                }
                """;
            String instance = """
                { "other": "value" }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("required"));
        }

        @Test
        @DisplayName("Invalid object - additionalProperties false")
        void invalidObjectAdditionalPropertiesFalse() {
            String schema = """
                {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" }
                    },
                    "additionalProperties": false
                }
                """;
            String instance = """
                { "name": "Alice", "extra": "value" }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("not allowed"));
        }
    }

    @Nested
    @DisplayName("Array Validation")
    class ArrayValidation {

        @Test
        @DisplayName("Valid array with items")
        void validArrayWithItems() {
            String schema = """
                {
                    "type": "array",
                    "items": { "type": "string" }
                }
                """;
            String instance = """
                ["a", "b", "c"]
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid array - wrong item type")
        void invalidArrayWrongItemType() {
            String schema = """
                {
                    "type": "array",
                    "items": { "type": "string" }
                }
                """;
            String instance = """
                ["a", 123, "c"]
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid minItems")
        void validMinItems() {
            String schema = """
                {
                    "type": "array",
                    "minItems": 2
                }
                """;
            String instance = """
                [1, 2, 3]
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid minItems")
        void invalidMinItems() {
            String schema = """
                {
                    "type": "array",
                    "minItems": 5
                }
                """;
            String instance = """
                [1, 2, 3]
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }
    }

    @Nested
    @DisplayName("Set Validation")
    class SetValidation {

        @Test
        @DisplayName("Valid set with unique items")
        void validSetWithUniqueItems() {
            String schema = """
                {
                    "type": "set",
                    "items": { "type": "string" }
                }
                """;
            String instance = """
                ["a", "b", "c"]
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid set - duplicate items")
        void invalidSetDuplicateItems() {
            String schema = """
                {
                    "type": "set",
                    "items": { "type": "string" }
                }
                """;
            String instance = """
                ["a", "b", "a"]
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> e.getMessage().contains("duplicate"));
        }
    }

    @Nested
    @DisplayName("Temporal Type Validation")
    class TemporalTypeValidation {

        @Test
        @DisplayName("Valid date")
        void validDate() {
            String schema = """
                { "type": "date" }
                """;
            String instance = "\"2024-01-15\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid date format")
        void invalidDateFormat() {
            String schema = """
                { "type": "date" }
                """;
            String instance = "\"01/15/2024\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid time")
        void validTime() {
            String schema = """
                { "type": "time" }
                """;
            String instance = "\"14:30:00\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Valid datetime")
        void validDateTime() {
            String schema = """
                { "type": "datetime" }
                """;
            String instance = "\"2024-01-15T14:30:00Z\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Valid duration")
        void validDuration() {
            String schema = """
                { "type": "duration" }
                """;
            String instance = "\"PT1H30M\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }
    }

    @Nested
    @DisplayName("Other Type Validation")
    class OtherTypeValidation {

        @Test
        @DisplayName("Valid UUID")
        void validUuid() {
            String schema = """
                { "type": "uuid" }
                """;
            String instance = "\"550e8400-e29b-41d4-a716-446655440000\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid UUID")
        void invalidUuid() {
            String schema = """
                { "type": "uuid" }
                """;
            String instance = "\"not-a-uuid\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid URI")
        void validUri() {
            String schema = """
                { "type": "uri" }
                """;
            String instance = "\"https://example.com/path\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Valid binary (base64)")
        void validBinary() {
            String schema = """
                { "type": "binary" }
                """;
            String instance = "\"SGVsbG8gV29ybGQ=\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }
    }

    @Nested
    @DisplayName("Enum and Const Validation")
    class EnumAndConstValidation {

        @Test
        @DisplayName("Valid enum value")
        void validEnumValue() {
            String schema = """
                {
                    "type": "string",
                    "enum": ["red", "green", "blue"]
                }
                """;
            String instance = "\"green\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid enum value")
        void invalidEnumValue() {
            String schema = """
                {
                    "type": "string",
                    "enum": ["red", "green", "blue"]
                }
                """;
            String instance = "\"yellow\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid const value")
        void validConstValue() {
            String schema = """
                {
                    "const": "fixed"
                }
                """;
            String instance = "\"fixed\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid const value")
        void invalidConstValue() {
            String schema = """
                {
                    "const": "fixed"
                }
                """;
            String instance = "\"other\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }
    }

    @Nested
    @DisplayName("Composition Validation")
    class CompositionValidation {

        @Test
        @DisplayName("Valid allOf")
        void validAllOf() {
            String schema = """
                {
                    "allOf": [
                        { "type": "object", "properties": { "a": { "type": "string" } }, "required": ["a"] },
                        { "type": "object", "properties": { "b": { "type": "int32" } }, "required": ["b"] }
                    ]
                }
                """;
            String instance = """
                { "a": "hello", "b": 42 }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid allOf - missing property")
        void invalidAllOfMissingProperty() {
            String schema = """
                {
                    "allOf": [
                        { "type": "object", "properties": { "a": { "type": "string" } }, "required": ["a"] },
                        { "type": "object", "properties": { "b": { "type": "int32" } }, "required": ["b"] }
                    ]
                }
                """;
            String instance = """
                { "a": "hello" }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid anyOf")
        void validAnyOf() {
            String schema = """
                {
                    "anyOf": [
                        { "type": "string" },
                        { "type": "int32" }
                    ]
                }
                """;
            String instance = "\"hello\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid anyOf")
        void invalidAnyOf() {
            String schema = """
                {
                    "anyOf": [
                        { "type": "string" },
                        { "type": "int32" }
                    ]
                }
                """;
            String instance = "true";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }

        @Test
        @DisplayName("Valid oneOf - exactly one match")
        void validOneOf() {
            String schema = """
                {
                    "oneOf": [
                        { "type": "string", "minLength": 5 },
                        { "type": "string", "maxLength": 3 }
                    ]
                }
                """;
            String instance = "\"hello world\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Valid not")
        void validNot() {
            String schema = """
                {
                    "not": { "type": "string" }
                }
                """;
            String instance = "42";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid not")
        void invalidNot() {
            String schema = """
                {
                    "not": { "type": "string" }
                }
                """;
            String instance = "\"hello\"";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }
    }

    @Nested
    @DisplayName("Reference Validation")
    class ReferenceValidation {

        @Test
        @DisplayName("Valid $ref")
        void validRef() {
            String schema = """
                {
                    "$defs": {
                        "name": { "type": "string", "minLength": 1 }
                    },
                    "type": "object",
                    "properties": {
                        "firstName": { "$ref": "#/$defs/name" },
                        "lastName": { "$ref": "#/$defs/name" }
                    }
                }
                """;
            String instance = """
                { "firstName": "John", "lastName": "Doe" }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }

        @Test
        @DisplayName("Invalid $ref - violates referenced schema")
        void invalidRefViolatesReferencedSchema() {
            String schema = """
                {
                    "$defs": {
                        "name": { "type": "string", "minLength": 1 }
                    },
                    "type": "object",
                    "properties": {
                        "firstName": { "$ref": "#/$defs/name" }
                    }
                }
                """;
            String instance = """
                { "firstName": "" }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }
    }
}
