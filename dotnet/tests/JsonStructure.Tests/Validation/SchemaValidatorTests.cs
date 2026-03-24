// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;
using Shouldly;
using JsonStructure.Validation;
using Xunit;

namespace JsonStructure.Tests.Validation;

public class SchemaValidatorTests
{
    private readonly SchemaValidator _validator;

    public SchemaValidatorTests()
    {
        _validator = new SchemaValidator();
    }

    [Fact]
    public void Validate_ValidObjectSchema_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" },
                ["age"] = new JsonObject { ["type"] = "int32" }
            },
            ["required"] = new JsonArray { "name" }
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Errors.ShouldBeEmpty();
    }

    [Fact]
    public void Validate_InvalidType_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "invalid-type"
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
        var error = result.Errors.ShouldHaveSingleItem();
        error.Code.ShouldBe(ErrorCodes.SchemaTypeInvalid);
        error.Path.ShouldBe("/type");
        error.Message.ShouldContain("Invalid type");
    }

    [Fact]
    public void Validate_BooleanSchema_ReturnsSuccess()
    {
        var trueSchema = JsonValue.Create(true);
        var falseSchema = JsonValue.Create(false);

        _validator.Validate(trueSchema).IsValid.ShouldBeTrue();
        _validator.Validate(falseSchema).IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Validate_NullSchema_ReturnsError()
    {
        var result = _validator.Validate((JsonNode?)null);

        result.IsValid.ShouldBeFalse();
        var error = result.Errors.ShouldHaveSingleItem();
        error.Code.ShouldBe(ErrorCodes.SchemaNull);
        error.Message.ShouldContain("cannot be null");
    }

    [Fact]
    public void Validate_ArraySchema_ValidatesItems()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "string" },
            ["minItems"] = 1,
            ["maxItems"] = 10
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Validate_NegativeMinItems_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "string" },
            ["minItems"] = -1
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
        var error = result.Errors.ShouldHaveSingleItem();
        error.Code.ShouldBe(ErrorCodes.SchemaIntegerConstraintInvalid);
        error.Path.ShouldBe("/minItems");
        error.Message.ShouldContain("non-negative");
    }

    [Fact]
    public void Validate_InvalidPattern_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "string",
            ["pattern"] = "[invalid regex("
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
        var error = result.Errors.ShouldHaveSingleItem();
        error.Code.ShouldBe(ErrorCodes.SchemaPatternInvalid);
        error.Path.ShouldBe("/pattern");
        error.Message.ShouldContain("regular expression");
    }

    [Fact]
    public void Validate_ValidDefs_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestSchema",
            ["definitions"] = new JsonObject
            {
                ["Address"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["street"] = new JsonObject { ["type"] = "string" }
                    }
                }
            },
            ["type"] = new JsonObject { ["$ref"] = "#/definitions/Address" }
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Validate_AllPrimitiveTypes_ReturnsSuccess()
    {
        foreach (var type in SchemaValidator.PrimitiveTypes)
        {
            var schema = new JsonObject { ["$id"] = "urn:example:test-schema", ["name"] = "TestType", ["type"] = type };
            var result = _validator.Validate(schema);
            result.IsValid.ShouldBeTrue($"Type '{type}' should be valid");
        }
    }

    [Fact]
    public void Validate_AllCompoundTypes_ReturnsSuccess()
    {
        foreach (var type in SchemaValidator.CompoundTypes)
        {
            var schema = new JsonObject { ["$id"] = "urn:example:test-schema", ["name"] = "TestType", ["type"] = type };
            
            // Add required structure for compound types
            if (type == "array" || type == "set")
            {
                schema["items"] = new JsonObject { ["type"] = "string" };
            }
            else if (type == "map")
            {
                schema["values"] = new JsonObject { ["type"] = "string" };
            }
            else if (type == "tuple")
            {
                schema["tuple"] = new JsonArray { "item0" };
                schema["properties"] = new JsonObject
                {
                    ["item0"] = new JsonObject { ["type"] = "string" }
                };
            }
            else if (type == "choice")
            {
                schema["choices"] = new JsonObject
                {
                    ["opt1"] = new JsonObject { ["type"] = "string" }
                };
            }
            
            var result = _validator.Validate(schema);
            result.IsValid.ShouldBeTrue($"Type '{type}' should be valid");
        }
    }

    [Fact]
    public void Validate_ConditionalComposition_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["allOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "object" },
                new JsonObject { ["required"] = new JsonArray { "id" } }
            }
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Validate_EmptyAllOf_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["allOf"] = new JsonArray()
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
        var error = result.Errors.ShouldHaveSingleItem();
        error.Code.ShouldBe(ErrorCodes.SchemaCompositionEmpty);
        error.Path.ShouldBe("/allOf");
        error.Message.ShouldContain("cannot be empty");
    }

    [Fact]
    public void Validate_ChoiceSchema_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "choice",
            ["selector"] = "type",
            ["choices"] = new JsonObject
            {
                ["dog"] = new JsonObject { ["type"] = "object" },
                ["cat"] = new JsonObject { ["type"] = "object" }
            }
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Validate_MapSchema_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "int32" }
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Validate_TupleSchema_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "tuple",
            ["properties"] = new JsonObject
            {
                ["first"] = new JsonObject { ["type"] = "string" },
                ["second"] = new JsonObject { ["type"] = "int32" },
                ["third"] = new JsonObject { ["type"] = "boolean" }
            },
            ["tuple"] = new JsonArray { "first", "second", "third" },
            ["items"] = false
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Validate_EnumSchema_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "string",
            ["enum"] = new JsonArray { "red", "green", "blue" }
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Validate_EmptyEnum_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "string",
            ["enum"] = new JsonArray()
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
        var error = result.Errors.ShouldHaveSingleItem();
        error.Code.ShouldBe(ErrorCodes.SchemaEnumEmpty);
        error.Path.ShouldBe("/enum");
        error.Message.ShouldContain("cannot be empty");
    }

    [Fact]
    public void Validate_NumericConstraints_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "number",
            ["minimum"] = 0,
            ["maximum"] = 100,
            ["multipleOf"] = 5
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
    }

    [Fact]
    public void Validate_InvalidMultipleOf_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "number",
            ["multipleOf"] = -5
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
        var error = result.Errors.ShouldHaveSingleItem();
        error.Code.ShouldBe(ErrorCodes.SchemaPositiveNumberConstraintInvalid);
        error.Path.ShouldBe("/multipleOf");
        error.Message.ShouldContain("positive");
    }

    #region Multiple Errors Collection Tests

    [Fact]
    public void Validate_MultipleSchemaErrors_CollectsAllByDefault()
    {
        // Schema with multiple issues: negative minLength, maxLength < minLength, and invalid pattern
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "string",
            ["minLength"] = -1,
            ["maxLength"] = -2,
            ["pattern"] = "[invalid("
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
        result.Errors.Count.ShouldBeGreaterThanOrEqualTo(2, "multiple schema errors should be collected");
    }

    [Fact]
    public void Validate_MultipleSchemaErrors_StopsOnFirstWhenOptionSet()
    {
        var options = new ValidationOptions { StopOnFirstError = true };
        var validator = new SchemaValidator(options);
        
        // Use nested definitions so errors occur in separate validation steps
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "object",
            ["definitions"] = new JsonObject
            {
                ["Level1"] = new JsonObject
                {
                    ["type"] = "object",
                    ["definitions"] = new JsonObject
                    {
                        ["Level2"] = new JsonObject
                        {
                            ["type"] = "array"
                            // missing items - error
                        }
                    }
                },
                ["Level1b"] = new JsonObject
                {
                    ["type"] = "map"
                    // missing values - another error (but should not be reached)
                }
            }
        };

        var result = validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
        // With StopOnFirstError, it should stop after the first definition with an error
        result.Errors.Count.ShouldBeLessThanOrEqualTo(1, "should stop after first error step");
    }

    [Fact]
    public void Validate_MultiplePropertiesWithErrors_CollectsAllErrors()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["field1"] = new JsonObject 
                { 
                    ["type"] = "string",
                    ["minLength"] = -1 // invalid
                },
                ["field2"] = new JsonObject 
                { 
                    ["type"] = "number",
                    ["multipleOf"] = 0 // invalid
                },
                ["field3"] = new JsonObject 
                { 
                    ["type"] = "integer",
                    ["minimum"] = 100,
                    ["maximum"] = 10 // min > max
                }
            }
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
        result.Errors.Count.ShouldBeGreaterThanOrEqualTo(3, "errors in all three properties should be collected");
    }

    [Fact]
    public void Validate_NestedDefinitionsWithErrors_CollectsAllErrors()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "object",
            ["definitions"] = new JsonObject
            {
                ["Type1"] = new JsonObject
                {
                    ["type"] = "array"
                    // missing items - should be an error
                },
                ["Type2"] = new JsonObject
                {
                    ["type"] = "map"
                    // missing values - should be an error
                }
            }
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
        result.Errors.Count.ShouldBeGreaterThanOrEqualTo(2, "errors in both definitions should be collected");
        result.Errors.Select(e => e.Code).ShouldContain(ErrorCodes.SchemaArrayMissingItems);
        result.Errors.Select(e => e.Code).ShouldContain(ErrorCodes.SchemaMapMissingValues);
    }

    #endregion

    #region Extension Keyword Warnings

    [Fact]
    public void Validate_ValidationKeywordsWithoutExtension_EmitsWarnings()
    {
        // Schema using validation extension keywords without enabling the extension
        var schema = new JsonObject
        {
            ["$schema"] = "https://json-structure.org/meta/core/v0/#",
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject
                {
                    ["type"] = "string",
                    ["minLength"] = 1,
                    ["pattern"] = "^[A-Z]"
                },
                ["age"] = new JsonObject
                {
                    ["type"] = "int32",
                    ["minimum"] = 0,
                    ["maximum"] = 150
                }
            }
        };

        var result = _validator.Validate(schema);

        // Schema should still be valid (warnings don't fail validation)
        result.IsValid.ShouldBeTrue();
        
        // But we should have warnings for the validation extension keywords
        result.Warnings.Count.ShouldBeGreaterThanOrEqualTo(4);
        result.Warnings.ShouldContain(w => w.Code == ErrorCodes.SchemaExtensionKeywordNotEnabled);
        result.Warnings.ShouldContain(w => w.Message.Contains("minLength"));
        result.Warnings.ShouldContain(w => w.Message.Contains("pattern"));
        result.Warnings.ShouldContain(w => w.Message.Contains("minimum"));
        result.Warnings.ShouldContain(w => w.Message.Contains("maximum"));
    }

    [Fact]
    public void Validate_ValidationKeywordsWithExtensionEnabled_NoWarnings()
    {
        // Schema using validation extension with $uses enabling it
        var schema = new JsonObject
        {
            ["$schema"] = "https://json-structure.org/meta/extended/v0/#",
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["$uses"] = new JsonArray { "JSONStructureValidation" },
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject
                {
                    ["type"] = "string",
                    ["minLength"] = 1,
                    ["pattern"] = "^[A-Z]"
                },
                ["age"] = new JsonObject
                {
                    ["type"] = "int32",
                    ["minimum"] = 0,
                    ["maximum"] = 150
                }
            }
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Warnings.ShouldBeEmpty();
    }

    [Fact]
    public void Validate_ValidationKeywordsWithValidationMetaSchema_NoWarnings()
    {
        // Schema using validation meta-schema
        var schema = new JsonObject
        {
            ["$schema"] = "https://json-structure.org/meta/validation/v0/#",
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "string",
            ["minLength"] = 1,
            ["pattern"] = "^[A-Z]"
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Warnings.ShouldBeEmpty();
    }

    [Fact]
    public void Validate_WarningsCanBeDisabled()
    {
        var options = new ValidationOptions
        {
            WarnOnUnusedExtensionKeywords = false
        };
        var validator = new SchemaValidator(options);

        var schema = new JsonObject
        {
            ["$schema"] = "https://json-structure.org/meta/core/v0/#",
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "string",
            ["minLength"] = 1,
            ["pattern"] = "^[A-Z]"
        };

        var result = validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Warnings.ShouldBeEmpty(); // Warnings disabled
    }

    [Fact]
    public void Validate_ArrayValidationKeywordsWithoutExtension_EmitsWarnings()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "string" },
            ["minItems"] = 1,
            ["maxItems"] = 10,
            ["uniqueItems"] = true
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Warnings.Count.ShouldBeGreaterThanOrEqualTo(3);
        result.Warnings.ShouldContain(w => w.Message.Contains("minItems"));
        result.Warnings.ShouldContain(w => w.Message.Contains("maxItems"));
        result.Warnings.ShouldContain(w => w.Message.Contains("uniqueItems"));
    }

    [Fact]
    public void Validate_ObjectValidationKeywordsWithoutExtension_EmitsWarnings()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "object",
            ["minProperties"] = 1,
            ["maxProperties"] = 10
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Warnings.Count.ShouldBeGreaterThanOrEqualTo(2);
        result.Warnings.ShouldContain(w => w.Message.Contains("minProperties"));
        result.Warnings.ShouldContain(w => w.Message.Contains("maxProperties"));
    }

    [Fact]
    public void Validate_DefaultKeywordWithoutExtension_EmitsWarning()
    {
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["name"] = "TestType",
            ["type"] = "string",
            ["default"] = "hello"
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Warnings.ShouldHaveSingleItem();
        result.Warnings[0].Message.ShouldContain("default");
    }

    #endregion
}
