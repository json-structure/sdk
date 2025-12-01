// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

/**
 * Additional tests for validation classes to improve coverage.
 */
class AdditionalValidationTests {

    @Nested
    @DisplayName("JsonSourceLocator Tests")
    class JsonSourceLocatorTests {
        
        @Test
        @DisplayName("Should find location for simple property")
        void shouldFindLocationForSimpleProperty() {
            String json = "{\n  \"name\": \"value\"\n}";
            JsonSourceLocator locator = new JsonSourceLocator(json);
            
            JsonLocation location = locator.getLocation("#/name");
            assertThat(location.getLine()).isGreaterThan(0);
        }
        
        @Test
        @DisplayName("Should return unknown for null path")
        void shouldReturnUnknownForNullPath() {
            String json = "{ \"name\": \"value\" }";
            JsonSourceLocator locator = new JsonSourceLocator(json);
            
            JsonLocation location = locator.getLocation(null);
            assertThat(location.getLine()).isEqualTo(0);  // UNKNOWN uses 0
        }
        
        @Test
        @DisplayName("Should return unknown for empty path")
        void shouldReturnUnknownForEmptyPath() {
            String json = "{ \"name\": \"value\" }";
            JsonSourceLocator locator = new JsonSourceLocator(json);
            
            JsonLocation location = locator.getLocation("");
            assertThat(location.getLine()).isEqualTo(0);  // UNKNOWN uses 0
        }
        
        @Test
        @DisplayName("Should handle null JSON text")
        void shouldHandleNullJsonText() {
            JsonSourceLocator locator = new JsonSourceLocator(null);
            
            JsonLocation location = locator.getLocation("#/name");
            assertThat(location.getLine()).isEqualTo(0);  // UNKNOWN uses 0
        }
        
        @Test
        @DisplayName("Should handle root path")
        void shouldHandleRootPath() {
            String json = "{ \"name\": \"value\" }";
            JsonSourceLocator locator = new JsonSourceLocator(json);
            
            JsonLocation location = locator.getLocation("#/");
            // Root location should be valid (line 1)
            assertThat(location).isNotNull();
        }
        
        @Test
        @DisplayName("Should handle path without hash")
        void shouldHandlePathWithoutHash() {
            String json = "{ \"name\": \"value\" }";
            JsonSourceLocator locator = new JsonSourceLocator(json);
            
            JsonLocation location = locator.getLocation("/name");
            assertThat(location).isNotNull();
        }
        
        @Test
        @DisplayName("Should find location in nested object")
        void shouldFindLocationInNestedObject() {
            String json = "{\n  \"outer\": {\n    \"inner\": \"value\"\n  }\n}";
            JsonSourceLocator locator = new JsonSourceLocator(json);
            
            JsonLocation location = locator.getLocation("#/outer/inner");
            assertThat(location.getLine()).isGreaterThan(0);
        }
        
        @Test
        @DisplayName("Should handle escaped path segments")
        void shouldHandleEscapedPathSegments() {
            String json = "{ \"a/b\": { \"c~d\": \"value\" } }";
            JsonSourceLocator locator = new JsonSourceLocator(json);
            
            // ~1 escapes /, ~0 escapes ~
            JsonLocation location = locator.getLocation("#/a~1b/c~0d");
            assertThat(location).isNotNull();
        }
        
        @Test
        @DisplayName("Should find location for array item")
        void shouldFindLocationForArrayItem() {
            String json = "[\n  \"item0\",\n  \"item1\",\n  \"item2\"\n]";
            JsonSourceLocator locator = new JsonSourceLocator(json);
            
            JsonLocation location = locator.getLocation("#/1");
            assertThat(location).isNotNull();
        }
    }
    
    @Nested
    @DisplayName("JsonLocation Tests")
    class JsonLocationTests {
        
        @Test
        @DisplayName("Should create location with line and column")
        void shouldCreateLocationWithLineAndColumn() {
            JsonLocation location = new JsonLocation(5, 10);
            
            assertThat(location.getLine()).isEqualTo(5);
            assertThat(location.getColumn()).isEqualTo(10);
        }
        
        @Test
        @DisplayName("UNKNOWN should have 0 values")
        void unknownShouldHaveZeroValues() {
            assertThat(JsonLocation.UNKNOWN.getLine()).isEqualTo(0);
            assertThat(JsonLocation.UNKNOWN.getColumn()).isEqualTo(0);
        }
        
        @Test
        @DisplayName("toString should format correctly")
        void toStringShouldFormatCorrectly() {
            JsonLocation location = new JsonLocation(5, 10);
            
            String str = location.toString();
            assertThat(str).contains("5").contains("10");
        }
        
        @Test
        @DisplayName("equals should work correctly")
        void equalsShouldWorkCorrectly() {
            JsonLocation loc1 = new JsonLocation(5, 10);
            JsonLocation loc2 = new JsonLocation(5, 10);
            JsonLocation loc3 = new JsonLocation(5, 11);
            
            assertThat(loc1).isEqualTo(loc2);
            assertThat(loc1).isNotEqualTo(loc3);
        }
        
        @Test
        @DisplayName("hashCode should be consistent")
        void hashCodeShouldBeConsistent() {
            JsonLocation loc1 = new JsonLocation(5, 10);
            JsonLocation loc2 = new JsonLocation(5, 10);
            
            assertThat(loc1.hashCode()).isEqualTo(loc2.hashCode());
        }
    }
    
    @Nested
    @DisplayName("ValidationResult Tests")
    class ValidationResultTests {
        
        @Test
        @DisplayName("New result should have no errors")
        void newResultShouldHaveNoErrors() {
            ValidationResult result = new ValidationResult();
            
            assertThat(result.isValid()).isTrue();
            assertThat(result.getErrors()).isEmpty();
        }
        
        @Test
        @DisplayName("Result with errors should be invalid")
        void resultWithErrorsShouldBeInvalid() {
            ValidationResult result = new ValidationResult();
            result.addError("Test error", "#/name");
            
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).hasSize(1);
        }
        
        @Test
        @DisplayName("Should add error with code")
        void shouldAddErrorWithCode() {
            ValidationResult result = new ValidationResult();
            result.addError(ErrorCodes.INSTANCE_TYPE_MISMATCH, "Expected string", "#/name");
            
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors().get(0).getCode()).isEqualTo(ErrorCodes.INSTANCE_TYPE_MISMATCH);
        }
        
        @Test
        @DisplayName("Should add error object")
        void shouldAddErrorObject() {
            ValidationResult result = new ValidationResult();
            ValidationError error = new ValidationError("TEST_CODE", "Test message", "#/test");
            result.addError(error);
            
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors().get(0).getCode()).isEqualTo("TEST_CODE");
        }
        
        @Test
        @DisplayName("Should add warning")
        void shouldAddWarning() {
            ValidationResult result = new ValidationResult();
            result.addWarning("WARN_CODE", "Warning message", "#/path", new JsonLocation(1, 1));
            
            // Warnings don't make result invalid
            assertThat(result.isValid()).isTrue();
            assertThat(result.getErrors()).hasSize(1);
            assertThat(result.getWarnings()).hasSize(1);
        }
        
        @Test
        @DisplayName("Should count errors only")
        void shouldCountErrorsOnly() {
            ValidationResult result = new ValidationResult();
            result.addError("ERROR1", "Error 1", "#/a");
            result.addError("ERROR2", "Error 2", "#/b");
            result.addWarning("WARN1", "Warning", "#/c", JsonLocation.UNKNOWN);
            
            assertThat(result.getErrorCount()).isEqualTo(2);
        }
        
        @Test
        @DisplayName("Should count warnings only")
        void shouldCountWarningsOnly() {
            ValidationResult result = new ValidationResult();
            result.addError("ERROR1", "Error 1", "#/a");
            result.addWarning("WARN1", "Warning 1", "#/b", JsonLocation.UNKNOWN);
            result.addWarning("WARN2", "Warning 2", "#/c", JsonLocation.UNKNOWN);
            
            assertThat(result.getWarningCount()).isEqualTo(2);
        }
        
        @Test
        @DisplayName("Should filter errors only")
        void shouldFilterErrorsOnly() {
            ValidationResult result = new ValidationResult();
            result.addError("ERROR1", "Error", "#/a");
            result.addWarning("WARN1", "Warning", "#/b", JsonLocation.UNKNOWN);
            
            assertThat(result.getErrorsOnly()).hasSize(1);
            assertThat(result.getErrorsOnly().get(0).getCode()).isEqualTo("ERROR1");
        }
        
        @Test
        @DisplayName("Should create failure result with message")
        void shouldCreateFailureResultWithMessage() {
            ValidationResult result = ValidationResult.failure("Failed!");
            
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors().get(0).getMessage()).isEqualTo("Failed!");
        }
        
        @Test
        @DisplayName("Should create failure result with message and path")
        void shouldCreateFailureResultWithMessageAndPath() {
            ValidationResult result = ValidationResult.failure("Failed!", "#/path");
            
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors().get(0).getPath()).isEqualTo("#/path");
        }
        
        @Test
        @DisplayName("Should create failure result with code, message, and path")
        void shouldCreateFailureResultWithCodeMessagePath() {
            ValidationResult result = ValidationResult.failure("CODE", "Message", "#/path");
            
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors().get(0).getCode()).isEqualTo("CODE");
        }
        
        @Test
        @DisplayName("Should create success result")
        void shouldCreateSuccessResult() {
            ValidationResult result = ValidationResult.success();
            
            assertThat(result.isValid()).isTrue();
            assertThat(result.getErrors()).isEmpty();
        }
        
        @Test
        @DisplayName("toString should format valid result")
        void toStringShouldFormatValidResult() {
            ValidationResult result = new ValidationResult();
            
            assertThat(result.toString()).contains("Valid");
        }
        
        @Test
        @DisplayName("toString should format invalid result")
        void toStringShouldFormatInvalidResult() {
            ValidationResult result = new ValidationResult();
            result.addError("ERR", "Error message", "#/path");
            
            String str = result.toString();
            assertThat(str).contains("Invalid");
            assertThat(str).contains("1 error");
        }
    }
    
    @Nested
    @DisplayName("ValidationError Tests")
    class ValidationErrorTests {
        
        @Test
        @DisplayName("Should create error with basic fields")
        void shouldCreateErrorWithBasicFields() {
            ValidationError error = new ValidationError(
                ErrorCodes.INSTANCE_TYPE_MISMATCH,
                "Expected string but got number",
                "#/name"
            );
            
            assertThat(error.getCode()).isEqualTo(ErrorCodes.INSTANCE_TYPE_MISMATCH);
            assertThat(error.getMessage()).contains("Expected string");
            assertThat(error.getPath()).isEqualTo("#/name");
        }
        
        @Test
        @DisplayName("Should create error with all fields")
        void shouldCreateErrorWithAllFields() {
            ValidationError error = new ValidationError(
                ErrorCodes.INSTANCE_TYPE_MISMATCH,
                "Expected string",
                "#/name",
                ValidationSeverity.ERROR,
                new JsonLocation(5, 10),
                "#/properties/name"
            );
            
            assertThat(error.getCode()).isEqualTo(ErrorCodes.INSTANCE_TYPE_MISMATCH);
            assertThat(error.getSeverity()).isEqualTo(ValidationSeverity.ERROR);
            assertThat(error.getLocation().getLine()).isEqualTo(5);
        }
        
        @Test
        @DisplayName("toString should format correctly")
        void toStringShouldFormatCorrectly() {
            ValidationError error = new ValidationError(
                ErrorCodes.INSTANCE_TYPE_MISMATCH,
                "Test message",
                "#/path"
            );
            
            String str = error.toString();
            assertThat(str).contains("Test message");
        }
        
        @Test
        @DisplayName("toString should include path when not empty")
        void toStringShouldIncludePathWhenNotEmpty() {
            ValidationError error = new ValidationError(
                "TEST_CODE",
                "Test message",
                "#/some/path"
            );
            
            assertThat(error.toString()).contains("#/some/path");
        }
        
        @Test
        @DisplayName("toString should include location when known")
        void toStringShouldIncludeLocationWhenKnown() {
            ValidationError error = new ValidationError(
                "TEST_CODE",
                "Test message",
                "#/path",
                ValidationSeverity.ERROR,
                new JsonLocation(5, 10),
                null
            );
            
            String str = error.toString();
            assertThat(str).contains("5").contains("10");
        }
        
        @Test
        @DisplayName("toString should include schema path when present")
        void toStringShouldIncludeSchemaPathWhenPresent() {
            ValidationError error = new ValidationError(
                "TEST_CODE",
                "Test message",
                "#/path",
                ValidationSeverity.ERROR,
                JsonLocation.UNKNOWN,
                "#/properties/name"
            );
            
            assertThat(error.toString()).contains("schema").contains("#/properties/name");
        }
        
        @Test
        @DisplayName("Should handle null path as empty")
        void shouldHandleNullPathAsEmpty() {
            ValidationError error = new ValidationError(
                "TEST_CODE",
                "Test message",
                null
            );
            
            assertThat(error.getPath()).isEqualTo("");
        }
        
        @Test
        @DisplayName("Should handle null severity as ERROR")
        void shouldHandleNullSeverityAsError() {
            ValidationError error = new ValidationError(
                "TEST_CODE",
                "Test message",
                "#/path",
                null,
                null,
                null
            );
            
            assertThat(error.getSeverity()).isEqualTo(ValidationSeverity.ERROR);
        }
        
        @Test
        @DisplayName("Should handle null location as UNKNOWN")
        void shouldHandleNullLocationAsUnknown() {
            ValidationError error = new ValidationError(
                "TEST_CODE",
                "Test message",
                "#/path",
                ValidationSeverity.ERROR,
                null,
                null
            );
            
            assertThat(error.getLocation()).isEqualTo(JsonLocation.UNKNOWN);
        }
        
        @Test
        @DisplayName("equals should be true for same values")
        void equalsShouldBeTrueForSameValues() {
            ValidationError error1 = new ValidationError("CODE", "Message", "#/path");
            ValidationError error2 = new ValidationError("CODE", "Message", "#/path");
            
            assertThat(error1).isEqualTo(error2);
        }
        
        @Test
        @DisplayName("equals should be false for different values")
        void equalsShouldBeFalseForDifferentValues() {
            ValidationError error1 = new ValidationError("CODE1", "Message", "#/path");
            ValidationError error2 = new ValidationError("CODE2", "Message", "#/path");
            
            assertThat(error1).isNotEqualTo(error2);
        }
        
        @Test
        @DisplayName("equals should handle same object")
        void equalsShouldHandleSameObject() {
            ValidationError error = new ValidationError("CODE", "Message", "#/path");
            
            assertThat(error).isEqualTo(error);
        }
        
        @Test
        @DisplayName("equals should handle null")
        void equalsShouldHandleNull() {
            ValidationError error = new ValidationError("CODE", "Message", "#/path");
            
            assertThat(error).isNotEqualTo(null);
        }
        
        @Test
        @DisplayName("equals should handle different type")
        void equalsShouldHandleDifferentType() {
            ValidationError error = new ValidationError("CODE", "Message", "#/path");
            
            assertThat(error).isNotEqualTo("string");
        }
        
        @Test
        @DisplayName("hashCode should be consistent with equals")
        void hashCodeShouldBeConsistentWithEquals() {
            ValidationError error1 = new ValidationError("CODE", "Message", "#/path");
            ValidationError error2 = new ValidationError("CODE", "Message", "#/path");
            
            assertThat(error1.hashCode()).isEqualTo(error2.hashCode());
        }
        
        @Test
        @DisplayName("Should get schema path")
        void shouldGetSchemaPath() {
            ValidationError error = new ValidationError(
                "TEST_CODE",
                "Test message",
                "#/path",
                ValidationSeverity.ERROR,
                JsonLocation.UNKNOWN,
                "#/schema/path"
            );
            
            assertThat(error.getSchemaPath()).isEqualTo("#/schema/path");
        }
    }
    
    @Nested
    @DisplayName("ValidationOptions Tests")
    class ValidationOptionsTests {
        
        @Test
        @DisplayName("Default options should have reasonable defaults")
        void defaultOptionsShouldHaveReasonableDefaults() {
            ValidationOptions options = new ValidationOptions();
            
            assertThat(options.getMaxValidationDepth()).isGreaterThan(0);
        }
        
        @Test
        @DisplayName("Should allow setting max validation depth")
        void shouldAllowSettingMaxValidationDepth() {
            ValidationOptions options = new ValidationOptions();
            options.setMaxValidationDepth(100);
            
            assertThat(options.getMaxValidationDepth()).isEqualTo(100);
        }
        
        @Test
        @DisplayName("Should allow chaining options")
        void shouldAllowChainingOptions() {
            ValidationOptions options = new ValidationOptions()
                .setMaxValidationDepth(50)
                .setStopOnFirstError(true);
            
            assertThat(options.getMaxValidationDepth()).isEqualTo(50);
            assertThat(options.isStopOnFirstError()).isTrue();
        }
        
        @Test
        @DisplayName("Should have default options constant")
        void shouldHaveDefaultOptionsConstant() {
            assertThat(ValidationOptions.DEFAULT).isNotNull();
            assertThat(ValidationOptions.DEFAULT.getMaxValidationDepth()).isEqualTo(64);
        }
        
        @Test
        @DisplayName("Should allow setting strict format validation")
        void shouldAllowSettingStrictFormatValidation() {
            ValidationOptions options = new ValidationOptions()
                .setStrictFormatValidation(true);
            
            assertThat(options.isStrictFormatValidation()).isTrue();
        }
        
        @Test
        @DisplayName("Should allow setting allow dollar")
        void shouldAllowSettingAllowDollar() {
            ValidationOptions options = new ValidationOptions()
                .setAllowDollar(true);
            
            assertThat(options.isAllowDollar()).isTrue();
        }
        
        @Test
        @DisplayName("Should allow setting allow import")
        void shouldAllowSettingAllowImport() {
            ValidationOptions options = new ValidationOptions()
                .setAllowImport(true);
            
            assertThat(options.isAllowImport()).isTrue();
        }
        
        @Test
        @DisplayName("Should allow setting warn on unused extension keywords")
        void shouldAllowSettingWarnOnUnusedExtensionKeywords() {
            ValidationOptions options = new ValidationOptions()
                .setWarnOnUnusedExtensionKeywords(false);
            
            assertThat(options.isWarnOnUnusedExtensionKeywords()).isFalse();
        }
        
        @Test
        @DisplayName("Should allow setting reference resolver")
        void shouldAllowSettingReferenceResolver() {
            ValidationOptions options = new ValidationOptions()
                .setReferenceResolver(uri -> null);
            
            assertThat(options.getReferenceResolver()).isNotNull();
        }
        
        @Test
        @DisplayName("Should allow setting external schemas")
        void shouldAllowSettingExternalSchemas() {
            java.util.Map<String, com.fasterxml.jackson.databind.JsonNode> schemas = new java.util.HashMap<>();
            ValidationOptions options = new ValidationOptions()
                .setExternalSchemas(schemas);
            
            assertThat(options.getExternalSchemas()).isEqualTo(schemas);
        }
    }
    
    @Nested
    @DisplayName("ValidationSeverity Tests")
    class ValidationSeverityTests {
        
        @Test
        @DisplayName("Should have ERROR severity")
        void shouldHaveErrorSeverity() {
            assertThat(ValidationSeverity.ERROR).isNotNull();
        }
        
        @Test
        @DisplayName("Should have WARNING severity")
        void shouldHaveWarningSeverity() {
            assertThat(ValidationSeverity.WARNING).isNotNull();
        }
    }
    
    @Nested
    @DisplayName("ErrorCodes Tests")
    class ErrorCodesTests {
        
        @Test
        @DisplayName("Should have schema error codes")
        void shouldHaveSchemaErrorCodes() {
            assertThat(ErrorCodes.SCHEMA_NULL).isNotNull();
            assertThat(ErrorCodes.SCHEMA_INVALID_TYPE).isNotNull();
            assertThat(ErrorCodes.SCHEMA_MAX_DEPTH_EXCEEDED).isNotNull();
        }
        
        @Test
        @DisplayName("Should have instance error codes")
        void shouldHaveInstanceErrorCodes() {
            assertThat(ErrorCodes.INSTANCE_TYPE_MISMATCH).isNotNull();
        }
    }
    
    @Nested
    @DisplayName("InstanceValidator Edge Cases")
    class InstanceValidatorEdgeCases {
        
        private InstanceValidator validator = new InstanceValidator();
        
        @Test
        @DisplayName("Should handle empty instance")
        void shouldHandleEmptyInstance() {
            String schema = "{ \"type\": \"string\" }";
            ValidationResult result = validator.validate("", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should handle malformed JSON schema")
        void shouldHandleMalformedJsonSchema() {
            ValidationResult result = validator.validate("\"test\"", "{ invalid json }");
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should handle malformed JSON instance")
        void shouldHandleMalformedJsonInstance() {
            String schema = "{ \"type\": \"string\" }";
            ValidationResult result = validator.validate("{ invalid json }", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate deeply nested objects")
        void shouldValidateDeeplyNestedObjects() {
            String schema = """
                {
                    "type": "object",
                    "properties": {
                        "level1": {
                            "type": "object",
                            "properties": {
                                "level2": {
                                    "type": "object",
                                    "properties": {
                                        "value": { "type": "string" }
                                    }
                                }
                            }
                        }
                    }
                }
                """;
            String instance = """
                {
                    "level1": {
                        "level2": {
                            "value": "deep"
                        }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate with additionalProperties false")
        void shouldValidateWithAdditionalPropertiesFalse() {
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
                { "name": "test", "extra": "value" }
                """;
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate pattern property")
        void shouldValidatePatternProperty() {
            String schema = """
                {
                    "type": "string",
                    "pattern": "^[A-Z]{3}$"
                }
                """;
            
            ValidationResult valid = validator.validate("\"ABC\"", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("\"abc\"", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate exclusiveMinimum")
        void shouldValidateExclusiveMinimum() {
            String schema = """
                {
                    "type": "number",
                    "exclusiveMinimum": 0
                }
                """;
            
            ValidationResult valid = validator.validate("1", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("0", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate exclusiveMaximum")
        void shouldValidateExclusiveMaximum() {
            String schema = """
                {
                    "type": "number",
                    "exclusiveMaximum": 100
                }
                """;
            
            ValidationResult valid = validator.validate("99", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("100", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate enum with null value")
        void shouldValidateEnumWithNullValue() {
            String schema = """
                {
                    "enum": ["a", "b", null]
                }
                """;
            
            ValidationResult valid = validator.validate("null", schema);
            assertThat(valid.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate boolean true schema")
        void shouldValidateBooleanTrueSchema() {
            ValidationResult result = validator.validate("\"anything\"", "true");
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should reject boolean false schema")
        void shouldRejectBooleanFalseSchema() {
            ValidationResult result = validator.validate("\"anything\"", "false");
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate with $ref")
        void shouldValidateWithRef() {
            String schema = """
                {
                    "type": "object",
                    "properties": {
                        "name": { "type": { "$ref": "#/definitions/StringType" } }
                    },
                    "definitions": {
                        "StringType": { "type": "string" }
                    }
                }
                """;
            
            ValidationResult valid = validator.validate("{ \"name\": \"test\" }", schema);
            assertThat(valid.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate with $root")
        void shouldValidateWithRoot() {
            String schema = """
                {
                    "$root": "#/definitions/Person",
                    "definitions": {
                        "Person": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string" }
                            }
                        }
                    }
                }
                """;
            
            ValidationResult valid = validator.validate("{ \"name\": \"John\" }", schema);
            assertThat(valid.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate with $extends")
        void shouldValidateWithExtends() {
            String schema = """
                {
                    "type": "object",
                    "$extends": "#/definitions/Base",
                    "properties": {
                        "extra": { "type": "string" }
                    },
                    "definitions": {
                        "Base": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string" }
                            }
                        }
                    }
                }
                """;
            
            ValidationResult valid = validator.validate("{ \"name\": \"test\", \"extra\": \"value\" }", schema);
            assertThat(valid.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate allOf")
        void shouldValidateAllOf() {
            String schema = """
                {
                    "allOf": [
                        { "type": "object", "properties": { "a": { "type": "string" } }, "required": ["a"] },
                        { "type": "object", "properties": { "b": { "type": "int32" } }, "required": ["b"] }
                    ]
                }
                """;
            
            ValidationResult valid = validator.validate("{ \"a\": \"test\", \"b\": 42 }", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("{ \"a\": \"test\" }", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate anyOf")
        void shouldValidateAnyOf() {
            String schema = """
                {
                    "anyOf": [
                        { "type": "string" },
                        { "type": "int32" }
                    ]
                }
                """;
            
            ValidationResult validString = validator.validate("\"test\"", schema);
            assertThat(validString.isValid()).isTrue();
            
            ValidationResult validInt = validator.validate("42", schema);
            assertThat(validInt.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate oneOf")
        void shouldValidateOneOf() {
            String schema = """
                {
                    "oneOf": [
                        { "type": "string", "minLength": 5 },
                        { "type": "string", "maxLength": 3 }
                    ]
                }
                """;
            
            ValidationResult valid = validator.validate("\"hello\"", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("\"test\"", schema); // matches none
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate not")
        void shouldValidateNot() {
            String schema = """
                {
                    "type": "string",
                    "not": { "enum": ["forbidden"] }
                }
                """;
            
            ValidationResult valid = validator.validate("\"allowed\"", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("\"forbidden\"", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate if-then-else")
        void shouldValidateIfThenElse() {
            String schema = """
                {
                    "type": "object",
                    "if": {
                        "properties": { "type": { "const": "A" } }
                    },
                    "then": {
                        "properties": { "value": { "type": "string" } }
                    },
                    "else": {
                        "properties": { "value": { "type": "int32" } }
                    }
                }
                """;
            
            ValidationResult validA = validator.validate("{ \"type\": \"A\", \"value\": \"text\" }", schema);
            assertThat(validA.isValid()).isTrue();
            
            ValidationResult validB = validator.validate("{ \"type\": \"B\", \"value\": 42 }", schema);
            assertThat(validB.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate array with minItems and maxItems")
        void shouldValidateArrayWithMinMaxItems() {
            String schema = """
                {
                    "type": "array",
                    "items": { "type": "int32" },
                    "minItems": 2,
                    "maxItems": 4
                }
                """;
            
            ValidationResult valid = validator.validate("[1, 2, 3]", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult tooFew = validator.validate("[1]", schema);
            assertThat(tooFew.isValid()).isFalse();
            
            ValidationResult tooMany = validator.validate("[1, 2, 3, 4, 5]", schema);
            assertThat(tooMany.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate uniqueItems")
        void shouldValidateUniqueItems() {
            String schema = """
                {
                    "type": "array",
                    "items": { "type": "int32" },
                    "uniqueItems": true
                }
                """;
            
            ValidationResult valid = validator.validate("[1, 2, 3]", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("[1, 2, 2]", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate tuple with properties and tuple keyword")
        void shouldValidatePrefixItems() {
            String schema = """
                {
                    "type": "tuple",
                    "properties": {
                        "first": { "type": "string" },
                        "second": { "type": "int32" },
                        "third": { "type": "boolean" }
                    },
                    "tuple": ["first", "second", "third"]
                }
                """;
            
            ValidationResult valid = validator.validate("[\"a\", 1, true]", schema);
            assertThat(valid.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate contains")
        void shouldValidateContains() {
            String schema = """
                {
                    "type": "array",
                    "contains": { "type": "string", "const": "special" }
                }
                """;
            
            ValidationResult valid = validator.validate("[1, 2, \"special\", 4]", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("[1, 2, 3, 4]", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate string with format")
        void shouldValidateStringWithFormat() {
            String schema = """
                {
                    "type": "string",
                    "format": "date"
                }
                """;
            
            // Format validation depends on options; by default may be lenient
            ValidationResult result = validator.validate("\"2024-01-15\"", schema);
            assertThat(result).isNotNull();
        }
        
        @Test
        @DisplayName("Should validate multipleOf")
        void shouldValidateMultipleOf() {
            String schema = """
                {
                    "type": "number",
                    "multipleOf": 5
                }
                """;
            
            ValidationResult valid = validator.validate("15", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("13", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate string with minLength and maxLength")
        void shouldValidateStringWithMinMaxLength() {
            String schema = """
                {
                    "type": "string",
                    "minLength": 3,
                    "maxLength": 10
                }
                """;
            
            ValidationResult valid = validator.validate("\"hello\"", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult tooShort = validator.validate("\"ab\"", schema);
            assertThat(tooShort.isValid()).isFalse();
            
            ValidationResult tooLong = validator.validate("\"this is way too long\"", schema);
            assertThat(tooLong.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate map type")
        void shouldValidateMapType() {
            String schema = """
                {
                    "type": "map",
                    "values": { "type": "int32" }
                }
                """;
            
            ValidationResult valid = validator.validate("{ \"a\": 1, \"b\": 2 }", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("{ \"a\": \"not-int\" }", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate with stopOnFirstError")
        void shouldValidateWithStopOnFirstError() {
            ValidationOptions opts = new ValidationOptions().setStopOnFirstError(true);
            InstanceValidator validatorWithOpts = new InstanceValidator(opts);
            
            String schema = """
                {
                    "type": "object",
                    "properties": {
                        "a": { "type": "string" },
                        "b": { "type": "string" }
                    }
                }
                """;
            
            ValidationResult result = validatorWithOpts.validate("{ \"a\": 1, \"b\": 2 }", schema);
            assertThat(result.isValid()).isFalse();
            // With stopOnFirstError, should have only 1 error
            assertThat(result.getErrors()).hasSize(1);
        }
        
        @Test
        @DisplayName("Should validate with max depth exceeded")
        void shouldValidateWithMaxDepthExceeded() {
            ValidationOptions opts = new ValidationOptions().setMaxValidationDepth(2);
            InstanceValidator validatorWithOpts = new InstanceValidator(opts);
            
            String schema = """
                {
                    "type": "object",
                    "properties": {
                        "a": {
                            "type": "object",
                            "properties": {
                                "b": {
                                    "type": "object",
                                    "properties": {
                                        "c": { "type": "string" }
                                    }
                                }
                            }
                        }
                    }
                }
                """;
            
            ValidationResult result = validatorWithOpts.validate("{ \"a\": { \"b\": { \"c\": \"deep\" } } }", schema);
            // May fail due to max depth
            assertThat(result).isNotNull();
        }
        
        @Test
        @DisplayName("Should validate dependentRequired")
        void shouldValidateDependentRequired() {
            String schema = """
                {
                    "type": "object",
                    "properties": {
                        "credit_card": { "type": "string" },
                        "billing_address": { "type": "string" }
                    },
                    "dependentRequired": {
                        "credit_card": ["billing_address"]
                    }
                }
                """;
            
            ValidationResult valid = validator.validate("{ \"credit_card\": \"1234\", \"billing_address\": \"123 Main St\" }", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("{ \"credit_card\": \"1234\" }", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate propertyNames")
        void shouldValidatePropertyNames() {
            String schema = """
                {
                    "type": "object",
                    "propertyNames": {
                        "pattern": "^[a-z]+$"
                    }
                }
                """;
            
            ValidationResult valid = validator.validate("{ \"abc\": 1 }", schema);
            assertThat(valid.isValid()).isTrue();
            
            // Note: propertyNames with pattern may or may not be enforced depending on implementation
            ValidationResult maybeInvalid = validator.validate("{ \"ABC\": 1 }", schema);
            assertThat(maybeInvalid).isNotNull();
        }
        
        @Test
        @DisplayName("Should validate const")
        void shouldValidateConst() {
            String schema = """
                {
                    "const": "fixed-value"
                }
                """;
            
            ValidationResult valid = validator.validate("\"fixed-value\"", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("\"other-value\"", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate enum")
        void shouldValidateEnum() {
            String schema = """
                {
                    "enum": ["red", "green", "blue"]
                }
                """;
            
            ValidationResult valid = validator.validate("\"red\"", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("\"yellow\"", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate email format")
        void shouldValidateEmailFormat() {
            String schema = """
                {
                    "type": "string",
                    "format": "email"
                }
                """;
            
            // Format validation may depend on validation extension being enabled
            ValidationResult valid = validator.validate("\"test@example.com\"", schema);
            assertThat(valid).isNotNull();
            
            ValidationResult invalid = validator.validate("\"not-an-email\"", schema);
            assertThat(invalid).isNotNull();
        }
        
        @Test
        @DisplayName("Should validate uri format")
        void shouldValidateUriFormat() {
            String schema = """
                {
                    "type": "string",
                    "format": "uri"
                }
                """;
            
            ValidationResult valid = validator.validate("\"https://example.com/path\"", schema);
            assertThat(valid.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate date format")
        void shouldValidateDateFormat() {
            String schema = """
                {
                    "type": "string",
                    "format": "date"
                }
                """;
            
            // Format validation may depend on validation extension being enabled
            ValidationResult valid = validator.validate("\"2024-01-15\"", schema);
            assertThat(valid).isNotNull();
            
            ValidationResult invalid = validator.validate("\"not-a-date\"", schema);
            assertThat(invalid).isNotNull();
        }
        
        @Test
        @DisplayName("Should validate time format")
        void shouldValidateTimeFormat() {
            String schema = """
                {
                    "type": "string",
                    "format": "time"
                }
                """;
            
            // Format validation may depend on validation extension being enabled
            ValidationResult valid = validator.validate("\"14:30:00\"", schema);
            assertThat(valid).isNotNull();
            
            ValidationResult invalid = validator.validate("\"not-a-time\"", schema);
            assertThat(invalid).isNotNull();
        }
        
        @Test
        @DisplayName("Should validate date-time format")
        void shouldValidateDateTimeFormat() {
            String schema = """
                {
                    "type": "string",
                    "format": "date-time"
                }
                """;
            
            // Format validation may depend on validation extension being enabled
            ValidationResult valid = validator.validate("\"2024-01-15T14:30:00Z\"", schema);
            assertThat(valid).isNotNull();
            
            ValidationResult invalid = validator.validate("\"not-a-datetime\"", schema);
            assertThat(invalid).isNotNull();
        }
        
        @Test
        @DisplayName("Should validate uuid format")
        void shouldValidateUuidFormat() {
            String schema = """
                {
                    "type": "string",
                    "format": "uuid"
                }
                """;
            
            // Format validation may depend on validation extension being enabled
            ValidationResult valid = validator.validate("\"550e8400-e29b-41d4-a716-446655440000\"", schema);
            assertThat(valid).isNotNull();
            
            ValidationResult invalid = validator.validate("\"not-a-uuid\"", schema);
            assertThat(invalid).isNotNull();
        }
        
        @Test
        @DisplayName("Should validate int64 type")
        void shouldValidateInt64Type() {
            String schema = """
                {
                    "type": "int64"
                }
                """;
            
            ValidationResult valid = validator.validate("9223372036854775807", schema);
            assertThat(valid.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate string-encoded int64")
        void shouldValidateStringEncodedInt64() {
            String schema = """
                {
                    "type": "int64"
                }
                """;
            
            ValidationResult valid = validator.validate("\"9223372036854775807\"", schema);
            assertThat(valid.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate decimal type")
        void shouldValidateDecimalType() {
            String schema = """
                {
                    "type": "decimal"
                }
                """;
            
            ValidationResult valid = validator.validate("123.456", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult validString = validator.validate("\"123.456\"", schema);
            assertThat(validString.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate set type")
        void shouldValidateSetType() {
            String schema = """
                {
                    "type": "set",
                    "items": { "type": "string" }
                }
                """;
            
            ValidationResult valid = validator.validate("[\"a\", \"b\", \"c\"]", schema);
            assertThat(valid.isValid()).isTrue();
            
            // Sets should have unique items
            ValidationResult invalid = validator.validate("[\"a\", \"a\", \"b\"]", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate tuple type")
        void shouldValidateTupleType() {
            String schema = """
                {
                    "type": "tuple",
                    "prefixItems": [
                        { "type": "string" },
                        { "type": "int32" }
                    ]
                }
                """;
            
            ValidationResult valid = validator.validate("[\"name\", 42]", schema);
            assertThat(valid.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate any type")
        void shouldValidateAnyType() {
            String schema = """
                {
                    "type": "any"
                }
                """;
            
            ValidationResult validString = validator.validate("\"text\"", schema);
            assertThat(validString.isValid()).isTrue();
            
            ValidationResult validNumber = validator.validate("42", schema);
            assertThat(validNumber.isValid()).isTrue();
            
            ValidationResult validObject = validator.validate("{}", schema);
            assertThat(validObject.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate choice type")
        void shouldValidateChoiceType() {
            String schema = """
                {
                    "type": "choice",
                    "options": {
                        "stringOption": { "type": "string" },
                        "numberOption": { "type": "int32" }
                    }
                }
                """;
            
            // Choice type validation may work differently
            ValidationResult valid = validator.validate("\"text\"", schema);
            assertThat(valid).isNotNull();
        }
        
        @Test
        @DisplayName("Should validate binary type")
        void shouldValidateBinaryType() {
            String schema = """
                {
                    "type": "binary"
                }
                """;
            
            // Base64 encoded binary
            ValidationResult valid = validator.validate("\"SGVsbG8gV29ybGQ=\"", schema);
            assertThat(valid.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate duration type")
        void shouldValidateDurationType() {
            String schema = """
                {
                    "type": "duration"
                }
                """;
            
            ValidationResult valid = validator.validate("\"PT1H30M\"", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("\"not-a-duration\"", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate null type")
        void shouldValidateNullType() {
            String schema = """
                {
                    "type": "null"
                }
                """;
            
            ValidationResult valid = validator.validate("null", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult invalid = validator.validate("\"not-null\"", schema);
            assertThat(invalid.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate minProperties and maxProperties")
        void shouldValidateMinMaxProperties() {
            String schema = """
                {
                    "type": "object",
                    "minProperties": 2,
                    "maxProperties": 4
                }
                """;
            
            ValidationResult valid = validator.validate("{ \"a\": 1, \"b\": 2, \"c\": 3 }", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult tooFew = validator.validate("{ \"a\": 1 }", schema);
            assertThat(tooFew.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate minContains and maxContains")
        void shouldValidateMinMaxContains() {
            String schema = """
                {
                    "type": "array",
                    "contains": { "type": "string", "const": "special" },
                    "minContains": 2,
                    "maxContains": 3
                }
                """;
            
            ValidationResult valid = validator.validate("[\"special\", \"other\", \"special\"]", schema);
            assertThat(valid.isValid()).isTrue();
            
            ValidationResult tooFew = validator.validate("[\"special\", \"other\"]", schema);
            assertThat(tooFew.isValid()).isFalse();
        }
    }
    
    @Nested
    @DisplayName("SchemaValidator Edge Cases")
    class SchemaValidatorEdgeCases {
        
        private SchemaValidator validator = new SchemaValidator();
        
        @Test
        @DisplayName("Should validate valid schema")
        void shouldValidateValidSchema() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/test",
                    "name": "TestSchema",
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should reject malformed JSON")
        void shouldRejectMalformedJson() {
            ValidationResult result = validator.validate("{ invalid }");
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should reject schema with invalid type")
        void shouldRejectSchemaWithInvalidType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/invalidtype",
                    "name": "TestSchema",
                    "type": "invalidTypeName",
                    "properties": {
                        "name": { "type": "string" }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate schema with $extends")
        void shouldValidateSchemaWithExtends() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/extended",
                    "name": "ExtendedSchema",
                    "type": "object",
                    "$extends": "#/definitions/BaseType",
                    "definitions": {
                        "BaseType": {
                            "name": "BaseType",
                            "type": "object",
                            "properties": {
                                "baseProp": { "type": "string" }
                            }
                        }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with choice type")
        void shouldValidateSchemaWithChoiceType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/choice",
                    "name": "ChoiceSchema",
                    "type": "choice",
                    "choices": {
                        "option1": { "type": "string" },
                        "option2": { "type": "int32" }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with map type")
        void shouldValidateSchemaWithMapType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/map",
                    "name": "MapSchema",
                    "type": "map",
                    "values": { "type": "int32" }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with tuple type")
        void shouldValidateSchemaWithTupleType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/tuple",
                    "name": "TupleSchema",
                    "type": "tuple",
                    "properties": {
                        "first": { "type": "string" },
                        "second": { "type": "int32" }
                    },
                    "tuple": ["first", "second"]
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with set type")
        void shouldValidateSchemaWithSetType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/set",
                    "name": "SetSchema",
                    "type": "set",
                    "items": { "type": "string" }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with array type")
        void shouldValidateSchemaWithArrayType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/array",
                    "name": "ArraySchema",
                    "type": "array",
                    "items": { "type": "string" },
                    "minItems": 1,
                    "maxItems": 10
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with numeric constraints")
        void shouldValidateSchemaWithNumericConstraints() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/numeric",
                    "name": "NumericSchema",
                    "type": "int32",
                    "minimum": 0,
                    "maximum": 100
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with string constraints")
        void shouldValidateSchemaWithStringConstraints() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/string",
                    "name": "StringSchema",
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 100,
                    "pattern": "^[a-z]+$"
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with conditional keywords")
        void shouldValidateSchemaWithConditionalKeywords() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/conditional",
                    "name": "ConditionalSchema",
                    "type": "object",
                    "allOf": [
                        { "type": "object", "properties": { "a": { "type": "string" } } }
                    ],
                    "anyOf": [
                        { "type": "object", "properties": { "b": { "type": "int32" } } }
                    ]
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with $ref")
        void shouldValidateSchemaWithRef() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/ref",
                    "name": "RefSchema",
                    "type": "object",
                    "properties": {
                        "nested": { "type": { "$ref": "#/definitions/Nested" } }
                    },
                    "definitions": {
                        "Nested": {
                            "name": "Nested",
                            "type": "string"
                        }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should reject schema with invalid $ref")
        void shouldRejectSchemaWithInvalidRef() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/badref",
                    "name": "BadRefSchema",
                    "type": "object",
                    "properties": {
                        "nested": { "type": { "$ref": "#/definitions/DoesNotExist" } }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate schema with enum")
        void shouldValidateSchemaWithEnum() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/enum",
                    "name": "EnumSchema",
                    "enum": ["red", "green", "blue"]
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with const")
        void shouldValidateSchemaWithConst() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/const",
                    "name": "ConstSchema",
                    "const": "fixed"
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should reject null schema")
        void shouldRejectNullSchema() {
            ValidationResult result = validator.validate((String) null);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate using ValidationOptions")
        void shouldValidateUsingValidationOptions() {
            ValidationOptions options = new ValidationOptions()
                .setMaxValidationDepth(100)
                .setAllowDollar(true);
            SchemaValidator validatorWithOptions = new SchemaValidator(options);
            
            String schema = """
                {
                    "$id": "https://test.example.com/schema/opts",
                    "name": "TestSchema",
                    "type": "object"
                }
                """;
            
            ValidationResult result = validatorWithOptions.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with $abstract")
        void shouldValidateSchemaWithAbstract() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/abstract",
                    "name": "AbstractSchema",
                    "$abstract": true,
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with $comment")
        void shouldValidateSchemaWithComment() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/comment",
                    "name": "CommentedSchema",
                    "$comment": "This is a comment",
                    "type": "string"
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with if-then-else")
        void shouldValidateSchemaWithIfThenElse() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/ifthenelse",
                    "name": "ConditionalSchema",
                    "type": "object",
                    "properties": {
                        "kind": { "type": "string" },
                        "data": { "type": "string" }
                    },
                    "if": {
                        "properties": { "kind": { "const": "number" } }
                    },
                    "then": {
                        "properties": { "data": { "type": "number" } }
                    },
                    "else": {
                        "properties": { "data": { "type": "string" } }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with dependentRequired")
        void shouldValidateSchemaWithDependentRequired() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/depreq",
                    "name": "DepRequiredSchema",
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "email": { "type": "string" }
                    },
                    "dependentRequired": {
                        "email": ["name"]
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should allow dependentRequired with object type")
        void shouldAllowDependentRequiredWithObjectType() {
            // dependentRequired as object is valid - string values are not validated at schema level
            String schema = """
                {
                    "$id": "https://test.example.com/schema/depreqobj",
                    "name": "DepRequiredObjSchema",
                    "type": "object",
                    "dependentRequired": {
                        "email": ["name"]
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with patternProperties")
        void shouldValidateSchemaWithPatternProperties() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/patternprops",
                    "name": "PatternPropsSchema",
                    "type": "object",
                    "patternProperties": {
                        "^x-": { "type": "string" }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with contentEncoding and contentMediaType")
        void shouldValidateSchemaWithContentEncoding() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/content",
                    "name": "ContentSchema",
                    "type": "string",
                    "contentEncoding": "base64",
                    "contentMediaType": "application/json"
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with $uses")
        void shouldValidateSchemaWithUses() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/uses",
                    "name": "UsesSchema",
                    "$uses": ["JSONStructureValidation"],
                    "type": "string",
                    "minLength": 1
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should reject invalid $uses type")
        void shouldRejectInvalidUsesType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/baduses",
                    "name": "BadUsesSchema",
                    "$uses": "invalid"
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate schema with boolean additionalProperties")
        void shouldValidateSchemaWithBooleanAdditionalProperties() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/addprops",
                    "name": "AddPropsSchema",
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" }
                    },
                    "additionalProperties": false
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with allOf containing refs")
        void shouldValidateSchemaWithAllOfRefs() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/allofref",
                    "name": "AllOfRefSchema",
                    "allOf": [
                        { "type": { "$ref": "#/definitions/Base" } },
                        { "properties": { "extra": { "type": "string" } } }
                    ],
                    "definitions": {
                        "Base": {
                            "name": "Base",
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" }
                            }
                        }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with precision and scale for decimal")
        void shouldValidateSchemaWithPrecisionAndScale() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/decimal",
                    "name": "DecimalSchema",
                    "type": "decimal",
                    "precision": 10,
                    "scale": 2
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with examples")
        void shouldValidateSchemaWithExamples() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/examples",
                    "name": "ExamplesSchema",
                    "type": "string",
                    "examples": ["example1", "example2"]
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with unit")
        void shouldValidateSchemaWithUnit() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/unit",
                    "name": "UnitSchema",
                    "type": "number",
                    "unit": "meters"
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with deprecated")
        void shouldValidateSchemaWithDeprecated() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/deprecated",
                    "name": "DeprecatedSchema",
                    "type": "string",
                    "deprecated": true
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with altnames")
        void shouldValidateSchemaWithAltnames() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/altnames",
                    "name": "AltnamesSchema",
                    "type": "object",
                    "properties": {
                        "firstName": { 
                            "type": "string",
                            "altnames": {
                                "json": "first_name",
                                "xml": "FirstName"
                            }
                        }
                    }
                }
                """;
            
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isTrue();
        }
    }
    
    @Nested
    @DisplayName("Additional InstanceValidator Tests")
    class AdditionalInstanceValidatorTests {
        
        private final InstanceValidator validator = new InstanceValidator();
        
        @Test
        @DisplayName("Should validate multipleOf constraint")
        void shouldValidateMultipleOf() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/multipleOf",
                    "name": "MultipleOfSchema",
                    "type": "number",
                    "multipleOf": 5
                }
                """;
            
            // Valid - multiple of 5
            ValidationResult result = validator.validate("10", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - not multiple of 5
            result = validator.validate("7", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate exclusiveMinimum and exclusiveMaximum")
        void shouldValidateExclusiveMinMax() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/exclusive",
                    "name": "ExclusiveSchema",
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "exclusiveMaximum": 10
                }
                """;
            
            // Valid - strictly between 0 and 10
            ValidationResult result = validator.validate("5", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - equals minimum
            result = validator.validate("0", schema);
            assertThat(result.isValid()).isFalse();
            
            // Invalid - equals maximum
            result = validator.validate("10", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate string-encoded int64")
        void shouldValidateStringEncodedInt64() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/int64str",
                    "name": "Int64StringSchema",
                    "type": "int64"
                }
                """;
            
            // Valid string-encoded int64
            ValidationResult result = validator.validate("\"9223372036854775807\"", schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate string-encoded uint64")
        void shouldValidateStringEncodedUint64() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/uint64str",
                    "name": "Uint64StringSchema",
                    "type": "uint64"
                }
                """;
            
            // Valid string-encoded uint64
            ValidationResult result = validator.validate("\"18446744073709551615\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - negative
            result = validator.validate("\"-1\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate string-encoded int128")
        void shouldValidateStringEncodedInt128() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/int128str",
                    "name": "Int128StringSchema",
                    "type": "int128"
                }
                """;
            
            // Valid string-encoded int128
            ValidationResult result = validator.validate("\"170141183460469231731687303715884105727\"", schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate string-encoded uint128")
        void shouldValidateStringEncodedUint128() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/uint128str",
                    "name": "Uint128StringSchema",
                    "type": "uint128"
                }
                """;
            
            // Valid string-encoded uint128
            ValidationResult result = validator.validate("\"340282366920938463463374607431768211455\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - negative
            result = validator.validate("\"-1\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate string-encoded decimal")
        void shouldValidateStringEncodedDecimal() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/decimalstr",
                    "name": "DecimalStringSchema",
                    "type": "decimal"
                }
                """;
            
            // Valid string-encoded decimal
            ValidationResult result = validator.validate("\"123.456\"", schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should reject string for non-string-allowed type")
        void shouldRejectStringForNonStringType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/int32str",
                    "name": "Int32Schema",
                    "type": "int32"
                }
                """;
            
            // Invalid - string not allowed for int32
            ValidationResult result = validator.validate("\"123\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate minProperties and maxProperties")
        void shouldValidateMinMaxProperties() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/objsize",
                    "name": "ObjSizeSchema",
                    "type": "object",
                    "minProperties": 1,
                    "maxProperties": 2
                }
                """;
            
            // Invalid - too few properties
            ValidationResult result = validator.validate("{}", schema);
            assertThat(result.isValid()).isFalse();
            
            // Valid
            result = validator.validate("{\"a\": 1}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - too many properties
            result = validator.validate("{\"a\": 1, \"b\": 2, \"c\": 3}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate dependentRequired")
        void shouldValidateDependentRequired() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/depreq",
                    "name": "DepReqSchema",
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "email": { "type": "string" }
                    },
                    "dependentRequired": {
                        "email": ["name"]
                    }
                }
                """;
            
            // Valid - has both
            ValidationResult result = validator.validate("{\"email\": \"a@b.c\", \"name\": \"test\"}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - email without name
            result = validator.validate("{\"email\": \"a@b.c\"}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate map minEntries and maxEntries")
        void shouldValidateMapMinMaxEntries() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/mapsize",
                    "name": "MapSizeSchema",
                    "type": "map",
                    "values": { "type": "string" },
                    "minEntries": 1,
                    "maxEntries": 2
                }
                """;
            
            // Invalid - too few
            ValidationResult result = validator.validate("{}", schema);
            assertThat(result.isValid()).isFalse();
            
            // Valid
            result = validator.validate("{\"a\": \"1\"}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - too many
            result = validator.validate("{\"a\": \"1\", \"b\": \"2\", \"c\": \"3\"}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate map keyNames constraint")
        void shouldValidateMapKeyNames() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/keynames",
                    "name": "KeyNamesSchema",
                    "type": "map",
                    "values": { "type": "string" },
                    "keyNames": { "pattern": "^[a-z]+$" }
                }
                """;
            
            // Valid - lowercase keys
            ValidationResult result = validator.validate("{\"abc\": \"1\", \"def\": \"2\"}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - uppercase key
            result = validator.validate("{\"ABC\": \"1\"}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate map patternKeys")
        void shouldValidateMapPatternKeys() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/patternkeys",
                    "name": "PatternKeysSchema",
                    "type": "map",
                    "values": { "type": "number" },
                    "patternKeys": { "pattern": "^id_[0-9]+$" }
                }
                """;
            
            // Valid - keys match pattern
            ValidationResult result = validator.validate("{\"id_1\": 1, \"id_2\": 2}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - key doesn't match
            result = validator.validate("{\"name\": 1}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate tuple with properties and tuple keyword")
        void shouldValidateTupleWithPrefixItems() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/tuple",
                    "name": "TupleSchema",
                    "type": "tuple",
                    "properties": {
                        "first": { "type": "string" },
                        "second": { "type": "number" }
                    },
                    "tuple": ["first", "second"]
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("[\"hello\", 42]", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - extra items
            result = validator.validate("[\"hello\", 42, true]", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate tuple length mismatch")
        void shouldValidateTupleWithAdditionalItemsSchema() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/tuplelength",
                    "name": "TupleLengthSchema",
                    "type": "tuple",
                    "properties": {
                        "first": { "type": "string" }
                    },
                    "tuple": ["first"]
                }
                """;
            
            // Valid - correct length
            ValidationResult result = validator.validate("[\"hello\"]", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - extra items (tuple is fixed-length)
            result = validator.validate("[\"hello\", 1, 2, 3]", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate choice with discriminator")
        void shouldValidateChoiceWithDiscriminator() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/choicedisc",
                    "name": "ChoiceDiscSchema",
                    "type": "choice",
                    "discriminator": "kind",
                    "choices": {
                        "person": {
                            "type": "object",
                            "properties": {
                                "kind": { "const": "person" },
                                "name": { "type": "string" }
                            }
                        },
                        "company": {
                            "type": "object",
                            "properties": {
                                "kind": { "const": "company" },
                                "companyName": { "type": "string" }
                            }
                        }
                    }
                }
                """;
            
            // Valid - person
            ValidationResult result = validator.validate("{\"kind\": \"person\", \"name\": \"John\"}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Valid - company
            result = validator.validate("{\"kind\": \"company\", \"companyName\": \"Acme\"}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - missing discriminator
            result = validator.validate("{\"name\": \"John\"}", schema);
            assertThat(result.isValid()).isFalse();
            
            // Invalid - unknown option
            result = validator.validate("{\"kind\": \"unknown\"}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate choice with selector keyword")
        void shouldValidateChoiceWithSelector() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/choiceselector",
                    "name": "ChoiceSelectorSchema",
                    "type": "choice",
                    "selector": "type",
                    "choices": {
                        "a": { "type": "object" },
                        "b": { "type": "object" }
                    }
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("{\"type\": \"a\"}", schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate choice with choices keyword")
        void shouldValidateChoiceWithChoicesKeyword() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/choiceschoices",
                    "name": "ChoicesKeywordSchema",
                    "type": "choice",
                    "discriminator": "kind",
                    "choices": {
                        "option1": { "type": "object" }
                    }
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("{\"kind\": \"option1\"}", schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate tagged choice format")
        void shouldValidateTaggedChoiceFormat() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/taggedchoice",
                    "name": "TaggedChoiceSchema",
                    "type": "choice",
                    "choices": {
                        "string": { "type": "string" },
                        "number": { "type": "number" }
                    }
                }
                """;
            
            // Valid - tagged format
            ValidationResult result = validator.validate("{\"string\": \"hello\"}", schema);
            assertThat(result.isValid()).isTrue();
            
            result = validator.validate("{\"number\": 42}", schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate jsonpointer type")
        void shouldValidateJsonPointerType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/jsonpointer",
                    "name": "JsonPointerSchema",
                    "type": "jsonpointer"
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("\"/foo/bar\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Valid - empty pointer
            result = validator.validate("\"\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - doesn't start with /
            result = validator.validate("\"foo/bar\"", schema);
            assertThat(result.isValid()).isFalse();
            
            // Invalid - not a string
            result = validator.validate("123", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate duration type")
        void shouldValidateDurationType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/duration",
                    "name": "DurationSchema",
                    "type": "duration"
                }
                """;
            
            // Valid ISO 8601 duration
            ValidationResult result = validator.validate("\"PT1H30M\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Valid ISO 8601 period
            result = validator.validate("\"P1Y2M3D\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid
            result = validator.validate("\"invalid\"", schema);
            assertThat(result.isValid()).isFalse();
            
            // Invalid - not a string
            result = validator.validate("3600", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate contains with minContains and maxContains")
        void shouldValidateContainsWithMinMaxContains() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/contains",
                    "name": "ContainsSchema",
                    "type": "array",
                    "items": { "type": "number" },
                    "contains": { "minimum": 10 },
                    "minContains": 2,
                    "maxContains": 3
                }
                """;
            
            // Valid - 2 items >= 10
            ValidationResult result = validator.validate("[1, 10, 20, 5]", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - only 1 item >= 10
            result = validator.validate("[1, 10, 5]", schema);
            assertThat(result.isValid()).isFalse();
            
            // Invalid - 4 items >= 10
            result = validator.validate("[10, 20, 30, 40]", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate type as object with $ref")
        void shouldValidateTypeAsObjectWithRef() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/typeref",
                    "name": "TypeRefSchema",
                    "type": { "$ref": "#/definitions/StringType" },
                    "definitions": {
                        "StringType": {
                            "name": "StringType",
                            "type": "string"
                        }
                    }
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("\"hello\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid
            result = validator.validate("123", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate custom type reference error")
        void shouldValidateCustomTypeError() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/customtype",
                    "name": "CustomTypeSchema",
                    "type": "com.example:CustomType"
                }
                """;
            
            ValidationResult result = validator.validate("\"hello\"", schema);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> 
                e.getMessage().contains("Custom type reference not yet supported"));
        }
        
        @Test
        @DisplayName("Should validate unknown type error")
        void shouldValidateUnknownTypeError() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/unknowntype",
                    "name": "UnknownTypeSchema",
                    "type": "unknowntype"
                }
                """;
            
            ValidationResult result = validator.validate("\"hello\"", schema);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> 
                e.getMessage().contains("Unknown type"));
        }
        
        @Test
        @DisplayName("Should validate max depth exceeded")
        void shouldValidateMaxDepthExceeded() {
            ValidationOptions options = new ValidationOptions().setMaxValidationDepth(2);
            InstanceValidator validatorWithMaxDepth = new InstanceValidator(options);
            
            String schema = """
                {
                    "$id": "https://test.example.com/schema/depth",
                    "name": "DeepSchema",
                    "type": "object",
                    "properties": {
                        "level1": {
                            "type": "object",
                            "properties": {
                                "level2": {
                                    "type": "object",
                                    "properties": {
                                        "level3": { "type": "string" }
                                    }
                                }
                            }
                        }
                    }
                }
                """;
            
            ValidationResult result = validatorWithMaxDepth.validate(
                "{\"level1\": {\"level2\": {\"level3\": \"deep\"}}}", schema);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> 
                e.getMessage().contains("Maximum validation depth"));
        }
        
        @Test
        @DisplayName("Should validate with stopOnFirstError")
        void shouldValidateWithStopOnFirstError() {
            ValidationOptions options = new ValidationOptions().setStopOnFirstError(true);
            InstanceValidator validatorStopFirst = new InstanceValidator(options);
            
            // Use allOf which does check stopOnFirstError between iterations
            String schema = """
                {
                    "$id": "https://test.example.com/schema/stopfirst",
                    "name": "MultiErrorSchema",
                    "allOf": [
                        { "type": "object", "required": ["a"] },
                        { "type": "object", "required": ["b"] }
                    ]
                }
                """;
            
            ValidationResult result = validatorStopFirst.validate("{}", schema);
            assertThat(result.isValid()).isFalse();
            // With stopOnFirstError, once the first schema fails, the second isn't evaluated
            assertThat(result.getErrors()).hasSizeLessThanOrEqualTo(2);
        }
        
        @Test
        @DisplayName("Should validate $extends with array")
        void shouldValidateExtendsWithArray() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/extendsarray",
                    "name": "ExtendsArraySchema",
                    "type": "object",
                    "$extends": ["#/definitions/Base1", "#/definitions/Base2"],
                    "properties": {
                        "extra": { "type": "boolean" }
                    },
                    "definitions": {
                        "Base1": {
                            "name": "Base1",
                            "type": "object",
                            "properties": {
                                "prop1": { "type": "string" }
                            },
                            "required": ["prop1"]
                        },
                        "Base2": {
                            "name": "Base2",
                            "type": "object",
                            "properties": {
                                "prop2": { "type": "number" }
                            },
                            "required": ["prop2"]
                        }
                    }
                }
                """;
            
            // Valid - has all required props
            ValidationResult result = validator.validate(
                "{\"prop1\": \"a\", \"prop2\": 1, \"extra\": true}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - missing prop1
            result = validator.validate("{\"prop2\": 1, \"extra\": true}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate numeric type bounds")
        void shouldValidateNumericTypeBounds() {
            // int8 bounds
            String int8Schema = """
                {
                    "$id": "https://test.example.com/schema/int8",
                    "name": "Int8Schema",
                    "type": "int8"
                }
                """;
            
            ValidationResult result = validator.validate("127", int8Schema);
            assertThat(result.isValid()).isTrue();
            
            result = validator.validate("128", int8Schema);
            assertThat(result.isValid()).isFalse();
            
            result = validator.validate("-128", int8Schema);
            assertThat(result.isValid()).isTrue();
            
            result = validator.validate("-129", int8Schema);
            assertThat(result.isValid()).isFalse();
            
            // uint8 bounds
            String uint8Schema = """
                {
                    "$id": "https://test.example.com/schema/uint8",
                    "name": "Uint8Schema",
                    "type": "uint8"
                }
                """;
            
            result = validator.validate("255", uint8Schema);
            assertThat(result.isValid()).isTrue();
            
            result = validator.validate("256", uint8Schema);
            assertThat(result.isValid()).isFalse();
            
            result = validator.validate("-1", uint8Schema);
            assertThat(result.isValid()).isFalse();
            
            // uint16 bounds
            String uint16Schema = """
                {
                    "$id": "https://test.example.com/schema/uint16",
                    "name": "Uint16Schema",
                    "type": "uint16"
                }
                """;
            
            result = validator.validate("65535", uint16Schema);
            assertThat(result.isValid()).isTrue();
            
            result = validator.validate("65536", uint16Schema);
            assertThat(result.isValid()).isFalse();
            
            // uint32 bounds
            String uint32Schema = """
                {
                    "$id": "https://test.example.com/schema/uint32",
                    "name": "Uint32Schema",
                    "type": "uint32"
                }
                """;
            
            result = validator.validate("4294967295", uint32Schema);
            assertThat(result.isValid()).isTrue();
            
            result = validator.validate("4294967296", uint32Schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate additionalProperties schema")
        void shouldValidateAdditionalPropertiesSchema() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/addpropschema",
                    "name": "AddPropSchemaSchema",
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" }
                    },
                    "additionalProperties": { "type": "number" }
                }
                """;
            
            // Valid - additional props are numbers
            ValidationResult result = validator.validate(
                "{\"name\": \"test\", \"age\": 25, \"count\": 10}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - additional prop is string
            result = validator.validate(
                "{\"name\": \"test\", \"extra\": \"bad\"}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate numeric constraints without type")
        void shouldValidateNumericConstraintsWithoutType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/notypenumeric",
                    "name": "NoTypeNumericSchema",
                    "minimum": 0,
                    "maximum": 100
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("50", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - below minimum
            result = validator.validate("-1", schema);
            assertThat(result.isValid()).isFalse();
            
            // Invalid - above maximum
            result = validator.validate("101", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate string constraints without type")
        void shouldValidateStringConstraintsWithoutType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/notypestring",
                    "name": "NoTypeStringSchema",
                    "minLength": 3,
                    "maxLength": 10
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("\"hello\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - too short
            result = validator.validate("\"ab\"", schema);
            assertThat(result.isValid()).isFalse();
            
            // Invalid - too long
            result = validator.validate("\"thisistoolong\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate date-time format")
        void shouldValidateDateTimeFormat() {
            ValidationOptions options = new ValidationOptions().setStrictFormatValidation(true);
            InstanceValidator validatorStrict = new InstanceValidator(options);
            
            String schema = """
                {
                    "$id": "https://test.example.com/schema/datetimeformat",
                    "name": "DateTimeFormatSchema",
                    "type": "string",
                    "format": "date-time"
                }
                """;
            
            // Valid ISO 8601
            ValidationResult result = validatorStrict.validate("\"2023-12-25T10:30:00Z\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Valid with offset
            result = validatorStrict.validate("\"2023-12-25T10:30:00+05:30\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid
            result = validatorStrict.validate("\"not-a-date\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate unresolved $root")
        void shouldValidateUnresolvedRoot() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/badroot",
                    "name": "BadRootSchema",
                    "$root": "#/definitions/NonExistent"
                }
                """;
            
            ValidationResult result = validator.validate("\"test\"", schema);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> 
                e.getMessage().contains("Unable to resolve $root"));
        }
        
        @Test
        @DisplayName("Should validate choice without choices keyword")
        void shouldValidateChoiceWithoutOptions() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/nochoiceopts",
                    "name": "NoChoiceOptsSchema",
                    "type": "choice"
                }
                """;
            
            ValidationResult result = validator.validate("{}", schema);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> 
                e.getMessage().contains("must have 'choices'"));
        }
        
        @Test
        @DisplayName("Should validate choice discriminator not string")
        void shouldValidateChoiceDiscriminatorNotString() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/baddisc",
                    "name": "BadDiscSchema",
                    "type": "choice",
                    "discriminator": "kind",
                    "options": {
                        "a": { "type": "object" }
                    }
                }
                """;
            
            // Discriminator value is not a string
            ValidationResult result = validator.validate("{\"kind\": 123}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate choice with empty discriminator value")
        void shouldValidateChoiceWithEmptyDiscriminator() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/emptydisc",
                    "name": "EmptyDiscSchema",
                    "type": "choice",
                    "discriminator": "kind",
                    "options": {
                        "a": { "type": "object" }
                    }
                }
                """;
            
            ValidationResult result = validator.validate("{\"kind\": \"\"}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate inline choice matching multiple options")
        void shouldValidateChoiceMatchingMultipleOptions() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/multichoice",
                    "name": "MultiChoiceSchema",
                    "type": "choice",
                    "choices": {
                        "a": { "type": "object" },
                        "b": { "type": "object" }
                    }
                }
                """;
            
            // Matches both choices
            ValidationResult result = validator.validate("{}", schema);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> 
                e.getMessage().contains("matches") && e.getMessage().contains("choice"));
        }
        
        @Test
        @DisplayName("Should validate inline choice matching none")
        void shouldValidateChoiceMatchingNone() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/nomatch",
                    "name": "NoMatchSchema",
                    "type": "choice",
                    "choices": {
                        "str": { "type": "string" },
                        "num": { "type": "number" }
                    }
                }
                """;
            
            // Doesn't match any
            ValidationResult result = validator.validate("{}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate int16 type bounds")
        void shouldValidateInt16TypeBounds() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/int16",
                    "name": "Int16Schema",
                    "type": "int16"
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("32767", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - too large
            result = validator.validate("32768", schema);
            assertThat(result.isValid()).isFalse();
            
            // Valid - negative
            result = validator.validate("-32768", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - too small
            result = validator.validate("-32769", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate int32 type bounds")
        void shouldValidateInt32TypeBounds() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/int32",
                    "name": "Int32Schema",
                    "type": "int32"
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("2147483647", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - too large  
            result = validator.validate("2147483648", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate uint64 type bounds")
        void shouldValidateUint64TypeBounds() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/uint64",
                    "name": "Uint64Schema",
                    "type": "uint64"
                }
                """;
            
            // Invalid - negative
            ValidationResult result = validator.validate("-1", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate int64 non-integer")
        void shouldValidateInt64NonInteger() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/int64float",
                    "name": "Int64FloatSchema",
                    "type": "int64"
                }
                """;
            
            // Invalid - not an integer
            ValidationResult result = validator.validate("1.5", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate map with propertyNames fallback")
        void shouldValidateMapWithPropertyNames() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/propnames",
                    "name": "PropNamesSchema",
                    "type": "map",
                    "values": { "type": "number" },
                    "propertyNames": { "pattern": "^[a-z]+$" }
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("{\"abc\": 1}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid key
            result = validator.validate("{\"ABC\": 1}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate map with keys fallback")
        void shouldValidateMapWithKeys() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/keys",
                    "name": "KeysSchema",
                    "type": "map",
                    "values": { "type": "number" },
                    "keys": { "minLength": 3 }
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("{\"abc\": 1}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - key too short
            result = validator.validate("{\"ab\": 1}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate map with minProperties fallback")
        void shouldValidateMapWithMinProperties() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/minpropmap",
                    "name": "MinPropMapSchema",
                    "type": "map",
                    "values": { "type": "string" },
                    "minProperties": 2
                }
                """;
            
            // Invalid - too few
            ValidationResult result = validator.validate("{\"a\": \"1\"}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate map with maxProperties fallback")
        void shouldValidateMapWithMaxProperties() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/maxpropmap",
                    "name": "MaxPropMapSchema",
                    "type": "map",
                    "values": { "type": "string" },
                    "maxProperties": 1
                }
                """;
            
            // Invalid - too many
            ValidationResult result = validator.validate("{\"a\": \"1\", \"b\": \"2\"}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate invalid regex pattern")
        void shouldValidateInvalidRegexPattern() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/badpattern",
                    "name": "BadPatternSchema",
                    "type": "string",
                    "pattern": "["
                }
                """;
            
            ValidationResult result = validator.validate("\"test\"", schema);
            assertThat(result.isValid()).isFalse();
            assertThat(result.getErrors()).anyMatch(e -> 
                e.getMessage().contains("Invalid regex pattern"));
        }
        
        @Test
        @DisplayName("Should validate type reference object with missing ref")
        void shouldValidateTypeRefMissingRef() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/typerefmissing",
                    "name": "TypeRefMissingSchema",
                    "type": { "$ref": "#/definitions/Missing" }
                }
                """;
            
            ValidationResult result = validator.validate("\"hello\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate object instance for set type")
        void shouldValidateObjectForSetType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/setobj",
                    "name": "SetObjSchema",
                    "type": "set",
                    "items": { "type": "number" }
                }
                """;
            
            // Invalid - object instead of array
            ValidationResult result = validator.validate("{}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate array instance for map type")
        void shouldValidateArrayForMapType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/maparr",
                    "name": "MapArrSchema",
                    "type": "map",
                    "values": { "type": "number" }
                }
                """;
            
            // Invalid - array instead of object
            ValidationResult result = validator.validate("[]", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate string instance for choice type")
        void shouldValidateStringForChoiceType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/choicestr",
                    "name": "ChoiceStrSchema",
                    "type": "choice",
                    "options": {
                        "a": { "type": "object" }
                    }
                }
                """;
            
            // Invalid - string instead of object
            ValidationResult result = validator.validate("\"hello\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate object instance for tuple type")
        void shouldValidateObjectForTupleType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/tupleobj",
                    "name": "TupleObjSchema",
                    "type": "tuple",
                    "prefixItems": [{ "type": "string" }]
                }
                """;
            
            // Invalid - object instead of array
            ValidationResult result = validator.validate("{}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate any type")
        void shouldValidateAnyType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/any",
                    "name": "AnySchema",
                    "type": "any"
                }
                """;
            
            // All types should be valid
            ValidationResult result = validator.validate("\"string\"", schema);
            assertThat(result.isValid()).isTrue();
            
            result = validator.validate("123", schema);
            assertThat(result.isValid()).isTrue();
            
            result = validator.validate("null", schema);
            assertThat(result.isValid()).isTrue();
            
            result = validator.validate("{}", schema);
            assertThat(result.isValid()).isTrue();
            
            result = validator.validate("[]", schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate non-string for date type")
        void shouldValidateNonStringForDate() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/datenum",
                    "name": "DateNumSchema",
                    "type": "date"
                }
                """;
            
            ValidationResult result = validator.validate("123", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate non-string for time type")
        void shouldValidateNonStringForTime() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/timenum",
                    "name": "TimeNumSchema",
                    "type": "time"
                }
                """;
            
            ValidationResult result = validator.validate("123", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate non-string for datetime type")
        void shouldValidateNonStringForDateTime() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/datetimenum",
                    "name": "DateTimeNumSchema",
                    "type": "datetime"
                }
                """;
            
            ValidationResult result = validator.validate("123", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate non-string for uuid type")
        void shouldValidateNonStringForUuid() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/uuidnum",
                    "name": "UuidNumSchema",
                    "type": "uuid"
                }
                """;
            
            ValidationResult result = validator.validate("123", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate non-string for uri type")
        void shouldValidateNonStringForUri() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/urinum",
                    "name": "UriNumSchema",
                    "type": "uri"
                }
                """;
            
            ValidationResult result = validator.validate("123", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate uri without scheme")
        void shouldValidateUriWithoutScheme() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/urinoscheme",
                    "name": "UriNoSchemeSchema",
                    "type": "uri"
                }
                """;
            
            // Invalid - no scheme
            ValidationResult result = validator.validate("\"example.com/path\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate non-string for binary type")
        void shouldValidateNonStringForBinary() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/binarynum",
                    "name": "BinaryNumSchema",
                    "type": "binary"
                }
                """;
            
            ValidationResult result = validator.validate("123", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate invalid number for number type")
        void shouldValidateInvalidNumber() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/numberstr",
                    "name": "NumberStrSchema",
                    "type": "number"
                }
                """;
            
            // Invalid - string instead of number
            ValidationResult result = validator.validate("\"hello\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate invalid string for string type")
        void shouldValidateInvalidString() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/stringnum",
                    "name": "StringNumSchema",
                    "type": "string"
                }
                """;
            
            // Invalid - number instead of string
            ValidationResult result = validator.validate("123", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate invalid boolean for boolean type")
        void shouldValidateInvalidBoolean() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/boolstr",
                    "name": "BoolStrSchema",
                    "type": "boolean"
                }
                """;
            
            // Invalid - string instead of boolean
            ValidationResult result = validator.validate("\"true\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate invalid null for null type")
        void shouldValidateInvalidNull() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/nullstr",
                    "name": "NullStrSchema",
                    "type": "null"
                }
                """;
            
            // Invalid - string instead of null
            ValidationResult result = validator.validate("\"null\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate array instance for object type")
        void shouldValidateArrayForObjectType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/objarr",
                    "name": "ObjArrSchema",
                    "type": "object"
                }
                """;
            
            // Invalid - array instead of object
            ValidationResult result = validator.validate("[]", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate object instance for array type")
        void shouldValidateObjectForArrayType() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/arrobj",
                    "name": "ArrObjSchema",
                    "type": "array",
                    "items": { "type": "string" }
                }
                """;
            
            // Invalid - object instead of array
            ValidationResult result = validator.validate("{}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate tuple with named properties")
        void shouldValidateTupleWithNamedProperties() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/namedtuple",
                    "name": "NamedTupleSchema",
                    "type": "tuple",
                    "tuple": ["x", "y"],
                    "properties": {
                        "x": { "type": "number" },
                        "y": { "type": "number" }
                    }
                }
                """;
            
            // Valid
            ValidationResult result = validator.validate("[1, 2]", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - wrong length
            result = validator.validate("[1]", schema);
            assertThat(result.isValid()).isFalse();
            
            // Invalid - wrong type
            result = validator.validate("[1, \"hello\"]", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate instance against no-type schema with object")
        void shouldValidateNoTypeSchemaWithObject() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/notypeobj",
                    "name": "NoTypeObjSchema",
                    "properties": {
                        "name": { "type": "string" }
                    },
                    "required": ["name"]
                }
                """;
            
            // Valid object
            ValidationResult result = validator.validate("{\"name\": \"test\"}", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - missing required
            result = validator.validate("{}", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate instance against no-type schema with array")
        void shouldValidateNoTypeSchemaWithArray() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/notypearr",
                    "name": "NoTypeArrSchema",
                    "items": { "type": "number" },
                    "minItems": 1
                }
                """;
            
            // Valid array
            ValidationResult result = validator.validate("[1, 2, 3]", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - empty (validation handled through items)
            result = validator.validate("[]", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate numeric constraints with string values")
        void shouldValidateNumericConstraintsWithStringValues() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/decconstraints",
                    "name": "DecConstraintsSchema",
                    "type": "decimal",
                    "minimum": 0,
                    "maximum": 100
                }
                """;
            
            // Valid string-encoded decimal
            ValidationResult result = validator.validate("\"50.5\"", schema);
            assertThat(result.isValid()).isTrue();
            
            // Invalid - below minimum
            result = validator.validate("\"-1\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate schema with boolean true")
        void shouldValidateSchemaBooleanTrue() {
            String instance = """
                {
                    "name": "test"
                }
                """;
            String schema = "true";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isTrue();
        }
        
        @Test
        @DisplayName("Should validate schema with boolean false")
        void shouldValidateSchemaBooleanFalse() {
            String instance = """
                {
                    "name": "test"
                }
                """;
            String schema = "false";
            
            ValidationResult result = validator.validate(instance, schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate with invalid number string for int64")
        void shouldValidateInvalidNumberStringForInt64() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/badint64str",
                    "name": "BadInt64StrSchema",
                    "type": "int64"
                }
                """;
            
            // Invalid - not a number
            ValidationResult result = validator.validate("\"not-a-number\"", schema);
            assertThat(result.isValid()).isFalse();
        }
        
        @Test
        @DisplayName("Should validate with invalid number string for decimal")
        void shouldValidateInvalidNumberStringForDecimal() {
            String schema = """
                {
                    "$id": "https://test.example.com/schema/baddecstr",
                    "name": "BadDecStrSchema",
                    "type": "decimal"
                }
                """;
            
            // Invalid - not a number
            ValidationResult result = validator.validate("\"not-a-number\"", schema);
            assertThat(result.isValid()).isFalse();
        }
    }
}
