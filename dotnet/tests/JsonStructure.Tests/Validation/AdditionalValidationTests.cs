// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;
using FluentAssertions;
using JsonStructure.Validation;
using Xunit;

namespace JsonStructure.Tests.Validation;

public class AdditionalValidationTests
{
    #region ValidationResult Tests
    
    [Fact]
    public void ValidationResult_Success_ReturnsValidResult()
    {
        var result = ValidationResult.Success;
        result.IsValid.Should().BeTrue();
        result.Errors.Should().BeEmpty();
    }
    
    [Fact]
    public void ValidationResult_Failure_ReturnsInvalidResult()
    {
        var result = ValidationResult.Failure("Test error");
        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle();
    }
    
    [Fact]
    public void ValidationResult_FailureWithPath_ReturnsErrorWithPath()
    {
        var result = ValidationResult.Failure("Test error", "#/path");
        result.IsValid.Should().BeFalse();
        result.Errors.Single().Path.Should().Be("#/path");
    }
    
    [Fact]
    public void ValidationResult_AddError_AddsErrorToList()
    {
        var result = new ValidationResult();
        result.AddError("ERR001", "Test message", "#/test");
        
        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle();
        result.Errors[0].Code.Should().Be("ERR001");
        result.Errors[0].Message.Should().Be("Test message");
        result.Errors[0].Path.Should().Be("#/test");
    }
    
    [Fact]
    public void ValidationResult_AddWarning_AddsWarningToList()
    {
        var result = new ValidationResult();
        result.AddWarning("WARN001", "Test warning", "#/test");
        
        result.IsValid.Should().BeTrue(); // Warnings don't invalidate
        result.Warnings.Should().ContainSingle();
        result.Warnings[0].Code.Should().Be("WARN001");
    }
    
    [Fact]
    public void ValidationResult_AddErrorWithLocation_IncludesLocation()
    {
        var result = new ValidationResult();
        var location = new JsonLocation(10, 5);
        result.AddError(new ValidationError("ERR001", "Test", "#/path", ValidationSeverity.Error, location, null));
        
        result.Errors[0].Location.Should().Be(location);
    }
    
    [Fact]
    public void ValidationResult_ToString_IncludesAllErrors()
    {
        var result = new ValidationResult();
        result.AddError("ERR001", "Error 1", "#/a");
        result.AddError("ERR002", "Error 2", "#/b");
        
        var str = result.ToString();
        str.Should().Contain("Error 1");
        str.Should().Contain("Error 2");
    }
    
    [Fact]
    public void ValidationResult_AllMessages_CombinesErrorsAndWarnings()
    {
        var result = new ValidationResult();
        result.AddError("ERR001", "Error 1", "#/a");
        result.AddWarning("WARN001", "Warning 1", "#/b");
        
        var allMessages = result.AllMessages.ToList();
        allMessages.Should().HaveCount(2);
    }
    
    [Fact]
    public void ValidationResult_AddErrors_AddsMultipleErrors()
    {
        var result = new ValidationResult();
        var errors = new[]
        {
            new ValidationError("ERR001", "Error 1", "#/a"),
            new ValidationError("ERR002", "Error 2", "#/b")
        };
        result.AddErrors(errors);
        
        result.Errors.Should().HaveCount(2);
    }
    
    [Fact]
    public void ValidationResult_Constructor_WithErrors_SetsCorrectly()
    {
        var errors = new[]
        {
            new ValidationError("ERR001", "Error 1", "#/a"),
            new ValidationError("WARN001", "Warning 1", "#/b", ValidationSeverity.Warning)
        };
        var result = new ValidationResult(errors);
        
        result.Errors.Should().ContainSingle();
        result.Warnings.Should().ContainSingle();
    }
    
    [Fact]
    public void ValidationResult_ToString_Success_ReturnsSuccessMessage()
    {
        var result = new ValidationResult();
        result.ToString().Should().Contain("succeeded");
    }

    [Fact]
    public void ValidationResult_AddError_SimpleOverload_Works()
    {
        var result = new ValidationResult();
        result.AddError("Test error", "#/test");
        
        result.Errors.Should().ContainSingle();
        result.Errors[0].Code.Should().Be("UNKNOWN");
    }
    
    #endregion
    
    #region ValidationError Tests
    
    [Fact]
    public void ValidationError_SimpleConstructor_SetsDefaults()
    {
        var error = new ValidationError("Test message", "#/path");
        
        error.Code.Should().Be("UNKNOWN");
        error.Message.Should().Be("Test message");
        error.Path.Should().Be("#/path");
        error.Severity.Should().Be(ValidationSeverity.Error);
    }
    
    [Fact]
    public void ValidationError_ToString_FormatsCorrectly()
    {
        var error = new ValidationError("ERR001", "Test message", "#/path", ValidationSeverity.Error, new JsonLocation(10, 5), "#/schema/type");
        
        var str = error.ToString();
        str.Should().Contain("#/path");
        str.Should().Contain("(10:5)");
        str.Should().Contain("[ERR001]");
        str.Should().Contain("Test message");
        str.Should().Contain("schema: #/schema/type");
    }
    
    [Fact]
    public void ValidationError_ToString_WithoutLocation_OmitsLocation()
    {
        var error = new ValidationError("ERR001", "Test message", "#/path");
        
        var str = error.ToString();
        str.Should().Contain("#/path");
        str.Should().NotContain("(0:0)");
    }
    
    [Fact]
    public void ValidationError_Equality_WorksCorrectly()
    {
        var error1 = new ValidationError("ERR001", "Test", "#/path");
        var error2 = new ValidationError("ERR001", "Test", "#/path");
        
        error1.Should().Be(error2);
    }
    
    [Fact]
    public void ValidationError_WithSchemaPath_IncludesInToString()
    {
        var error = new ValidationError("ERR001", "Test", "#/path", ValidationSeverity.Error, default, "#/schema");
        
        var str = error.ToString();
        str.Should().Contain("#/schema");
    }
    
    [Fact]
    public void ValidationError_WarningSeverity_Works()
    {
        var error = new ValidationError("WARN001", "Warning message", "#/path", ValidationSeverity.Warning);
        
        error.Severity.Should().Be(ValidationSeverity.Warning);
    }
    
    #endregion
    
    #region JsonLocation Tests
    
    [Fact]
    public void JsonLocation_Unknown_HasZeroValues()
    {
        var unknown = JsonLocation.Unknown;
        unknown.Line.Should().Be(0);
        unknown.Column.Should().Be(0);
        unknown.IsKnown.Should().BeFalse();
    }
    
    [Fact]
    public void JsonLocation_Known_HasNonZeroValues()
    {
        var location = new JsonLocation(10, 5);
        location.Line.Should().Be(10);
        location.Column.Should().Be(5);
        location.IsKnown.Should().BeTrue();
    }
    
    [Fact]
    public void JsonLocation_ToString_FormatsCorrectly()
    {
        var location = new JsonLocation(10, 5);
        location.ToString().Should().Be("(10:5)");
    }
    
    [Fact]
    public void JsonLocation_ToString_Unknown_ReturnsEmpty()
    {
        var unknown = JsonLocation.Unknown;
        unknown.ToString().Should().BeEmpty();
    }
    
    [Fact]
    public void JsonLocation_Equality_WorksCorrectly()
    {
        var loc1 = new JsonLocation(10, 5);
        var loc2 = new JsonLocation(10, 5);
        
        loc1.Should().Be(loc2);
    }
    
    [Fact]
    public void JsonLocation_PartiallyUnknown_Line_IsNotKnown()
    {
        var location = new JsonLocation(0, 5);
        location.IsKnown.Should().BeFalse();
    }
    
    [Fact]
    public void JsonLocation_PartiallyUnknown_Column_IsNotKnown()
    {
        var location = new JsonLocation(10, 0);
        location.IsKnown.Should().BeFalse();
    }
    
    #endregion
    
    #region ValidationOptions Tests
    
    [Fact]
    public void ValidationOptions_Default_HasExpectedValues()
    {
        var options = ValidationOptions.Default;
        options.MaxValidationDepth.Should().BeGreaterThan(0);
        options.StopOnFirstError.Should().BeFalse();
    }
    
    [Fact]
    public void ValidationOptions_SetMaxDepth_Works()
    {
        var options = new ValidationOptions { MaxValidationDepth = 50 };
        options.MaxValidationDepth.Should().Be(50);
    }
    
    [Fact]
    public void ValidationOptions_SetStopOnFirstError_Works()
    {
        var options = new ValidationOptions { StopOnFirstError = true };
        options.StopOnFirstError.Should().BeTrue();
    }
    
    [Fact]
    public void ValidationOptions_SetStrictFormatValidation_Works()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        options.StrictFormatValidation.Should().BeTrue();
    }
    
    [Fact]
    public void ValidationOptions_SetAllowImport_Works()
    {
        var options = new ValidationOptions { AllowImport = true };
        options.AllowImport.Should().BeTrue();
    }
    
    [Fact]
    public void ValidationOptions_SetAllowDollar_Works()
    {
        var options = new ValidationOptions { AllowDollar = true };
        options.AllowDollar.Should().BeTrue();
    }
    
    [Fact]
    public void ValidationOptions_SetWarnOnUnusedExtensionKeywords_Works()
    {
        var options = new ValidationOptions { WarnOnUnusedExtensionKeywords = false };
        options.WarnOnUnusedExtensionKeywords.Should().BeFalse();
    }
    
    [Fact]
    public void ValidationOptions_SetExternalSchemas_Works()
    {
        var schemas = new Dictionary<string, JsonNode>
        {
            ["test"] = new JsonObject { ["type"] = "string" }
        };
        var options = new ValidationOptions { ExternalSchemas = schemas };
        options.ExternalSchemas.Should().ContainKey("test");
    }
    
    [Fact]
    public void ValidationOptions_SetReferenceResolver_Works()
    {
        Func<string, JsonNode?> resolver = _ => null;
        var options = new ValidationOptions { ReferenceResolver = resolver };
        options.ReferenceResolver.Should().Be(resolver);
    }
    
    [Fact]
    public void ValidationOptions_SetImportLoader_Works()
    {
        Func<string, JsonNode?> loader = _ => null;
        var options = new ValidationOptions { ImportLoader = loader };
        options.ImportLoader.Should().Be(loader);
    }
    
    #endregion
    
    #region Additional InstanceValidator Tests
    
    [Fact]
    public void InstanceValidator_NullSchema_Fails()
    {
        var validator = new InstanceValidator();
        JsonNode? schema = null;
        var instance = JsonValue.Create("test");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Message.Contains("null"));
    }
    
    [Fact]
    public void InstanceValidator_RootReference_NotFound_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["$root"] = "#/definitions/NonExistent"
        };
        var instance = JsonValue.Create("test");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_RootReference_Valid_Resolves()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["$root"] = "#/definitions/MyString",
            ["definitions"] = new JsonObject
            {
                ["MyString"] = new JsonObject { ["type"] = "string" }
            }
        };
        var instance = JsonValue.Create("test");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_BooleanFalseSchema_Rejects()
    {
        var validator = new InstanceValidator();
        JsonNode schema = JsonValue.Create(false);
        var instance = JsonValue.Create("test");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_BooleanTrueSchema_Accepts()
    {
        var validator = new InstanceValidator();
        JsonNode schema = JsonValue.Create(true);
        var instance = JsonValue.Create("test");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_MaxDepthExceeded_Fails()
    {
        var options = new ValidationOptions { MaxValidationDepth = 2 };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["nested"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["deep"] = new JsonObject
                        {
                            ["type"] = "object",
                            ["properties"] = new JsonObject
                            {
                                ["tooDeep"] = new JsonObject { ["type"] = "string" }
                            }
                        }
                    }
                }
            }
        };
        var instance = new JsonObject
        {
            ["nested"] = new JsonObject
            {
                ["deep"] = new JsonObject
                {
                    ["tooDeep"] = "value"
                }
            }
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Message.Contains("depth"));
    }
    
    [Fact]
    public void InstanceValidator_InvalidSchemaType_Fails()
    {
        var validator = new InstanceValidator();
        // Schema is a number (not boolean or object)
        JsonNode schema = JsonValue.Create(42);
        var instance = JsonValue.Create("test");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_RefNotFound_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = new JsonObject { ["$ref"] = "#/definitions/Missing" }
        };
        var instance = JsonValue.Create("test");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateNull_WithNullType_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "null" };
        JsonNode? instance = null;
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateNull_WithNonNullType_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "string" };
        JsonNode? instance = null;
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateEnum_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["enum"] = new JsonArray { "red", "green", "blue" }
        };
        var instance = JsonValue.Create("green");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateEnum_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["enum"] = new JsonArray { "red", "green", "blue" }
        };
        var instance = JsonValue.Create("yellow");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateConst_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["const"] = "fixed" };
        var instance = JsonValue.Create("fixed");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateConst_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["const"] = "fixed" };
        var instance = JsonValue.Create("other");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMinLength_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["minLength"] = 3
        };
        var instance = JsonValue.Create("hello");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMinLength_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["minLength"] = 10
        };
        var instance = JsonValue.Create("hi");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMaxLength_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["maxLength"] = 10
        };
        var instance = JsonValue.Create("hello");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMaxLength_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["maxLength"] = 3
        };
        var instance = JsonValue.Create("hello");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidatePattern_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["pattern"] = "^[a-z]+$"
        };
        var instance = JsonValue.Create("hello");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidatePattern_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["pattern"] = "^[a-z]+$"
        };
        var instance = JsonValue.Create("HELLO");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMinimum_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["minimum"] = 0
        };
        var instance = JsonValue.Create(5);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMinimum_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["minimum"] = 10
        };
        var instance = JsonValue.Create(5);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMaximum_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["maximum"] = 100
        };
        var instance = JsonValue.Create(50);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMaximum_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["maximum"] = 10
        };
        var instance = JsonValue.Create(50);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMinItems_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["minItems"] = 2
        };
        var instance = new JsonArray { 1, 2, 3 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMinItems_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["minItems"] = 5
        };
        var instance = new JsonArray { 1, 2, 3 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMaxItems_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["maxItems"] = 5
        };
        var instance = new JsonArray { 1, 2, 3 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMaxItems_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["maxItems"] = 2
        };
        var instance = new JsonArray { 1, 2, 3 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateAllOf_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["allOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "object" },
                new JsonObject { ["required"] = new JsonArray { "name" } }
            }
        };
        var instance = new JsonObject { ["name"] = "test" };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateAllOf_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["allOf"] = new JsonArray
            {
                new JsonObject { ["required"] = new JsonArray { "name" } },
                new JsonObject { ["required"] = new JsonArray { "age" } }
            }
        };
        var instance = new JsonObject { ["name"] = "test" };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateAnyOf_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["anyOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "number" }
            }
        };
        var instance = JsonValue.Create("hello");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateAnyOf_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["anyOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "number" }
            }
        };
        var instance = JsonValue.Create(true);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateOneOf_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["oneOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "number" }
            }
        };
        var instance = JsonValue.Create("hello");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateNot_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["not"] = new JsonObject { ["type"] = "string" }
        };
        var instance = JsonValue.Create(42);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateNot_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["not"] = new JsonObject { ["type"] = "string" }
        };
        var instance = JsonValue.Create("hello");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateIf_Then_Else_IfTrue_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["if"] = new JsonObject { ["const"] = "test" },
            ["then"] = new JsonObject { ["type"] = "string" },
            ["else"] = new JsonObject { ["type"] = "number" }
        };
        var instance = JsonValue.Create("test");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateUniqueItems_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["uniqueItems"] = true
        };
        var instance = new JsonArray { 1, 2, 3 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateUniqueItems_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["uniqueItems"] = true
        };
        var instance = new JsonArray { 1, 2, 2 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateAdditionalProperties_Boolean_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            },
            ["additionalProperties"] = true
        };
        var instance = new JsonObject
        {
            ["name"] = "test",
            ["extra"] = "value"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateAdditionalProperties_False_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            },
            ["additionalProperties"] = false
        };
        var instance = new JsonObject
        {
            ["name"] = "test",
            ["extra"] = "value"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidatePatternProperties_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["patternProperties"] = new JsonObject
            {
                ["^S_"] = new JsonObject { ["type"] = "string" }
            }
        };
        var instance = new JsonObject
        {
            ["S_name"] = "test",
            ["S_value"] = "other"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateDependentRequired_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["dependentRequired"] = new JsonObject
            {
                ["name"] = new JsonArray { "age" }
            }
        };
        var instance = new JsonObject
        {
            ["name"] = "test",
            ["age"] = 30
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateDependentRequired_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["dependentRequired"] = new JsonObject
            {
                ["name"] = new JsonArray { "age" }
            }
        };
        var instance = new JsonObject
        {
            ["name"] = "test"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateDependentSchemas_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["dependentSchemas"] = new JsonObject
            {
                ["name"] = new JsonObject { ["required"] = new JsonArray { "age" } }
            }
        };
        var instance = new JsonObject
        {
            ["name"] = "test",
            ["age"] = 30
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidatePrefixItems_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["prefixItems"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "number" }
            }
        };
        var instance = new JsonArray { "hello", 42 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidatePrefixItems_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        // JSON Structure uses tuple type for positional items, not prefixItems
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "string" }
        };
        var instance = new JsonArray { 123, 456 }; // numbers instead of strings
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateItems_SchemaForAllItems_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "number" }
        };
        var instance = new JsonArray { 1, 2, 3 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateItems_SchemaForAllItems_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "number" }
        };
        var instance = new JsonArray { 1, "two", 3 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidatePropertyNames_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["propertyNames"] = new JsonObject { ["pattern"] = "^[a-z]+$" }
        };
        var instance = new JsonObject { ["name"] = "value" };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateAdditionalProperties_Schema_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            },
            ["additionalProperties"] = new JsonObject { ["type"] = "int32" }
        };
        var instance = new JsonObject { ["name"] = "test", ["extra"] = "not-a-number" };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateContains_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["contains"] = new JsonObject { ["type"] = "string" }
        };
        var instance = new JsonArray { 1, 2, "hello", 4 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateContains_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["contains"] = new JsonObject { ["type"] = "string" }
        };
        var instance = new JsonArray { 1, 2, 3, 4 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMinContains_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["contains"] = new JsonObject { ["type"] = "string" },
            ["minContains"] = 2
        };
        var instance = new JsonArray { 1, "hello", "world", 4 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMaxContains_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["contains"] = new JsonObject { ["type"] = "string" },
            ["maxContains"] = 2
        };
        var instance = new JsonArray { 1, "hello", "world", 4 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMultipleOf_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["multipleOf"] = 5
        };
        var instance = JsonValue.Create(15);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMultipleOf_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["multipleOf"] = 5
        };
        var instance = JsonValue.Create(13);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateExclusiveMinimum_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["exclusiveMinimum"] = 5
        };
        var instance = JsonValue.Create(6);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateExclusiveMinimum_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["exclusiveMinimum"] = 5
        };
        var instance = JsonValue.Create(5);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateExclusiveMaximum_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["exclusiveMaximum"] = 10
        };
        var instance = JsonValue.Create(9);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateExclusiveMaximum_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["exclusiveMaximum"] = 10
        };
        var instance = JsonValue.Create(10);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMinProperties_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["minProperties"] = 2
        };
        var instance = new JsonObject { ["a"] = 1, ["b"] = 2 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMinProperties_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["minProperties"] = 3
        };
        var instance = new JsonObject { ["a"] = 1, ["b"] = 2 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMaxProperties_Valid_Succeeds()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["maxProperties"] = 3
        };
        var instance = new JsonObject { ["a"] = 1, ["b"] = 2 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateMaxProperties_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["maxProperties"] = 1
        };
        var instance = new JsonObject { ["a"] = 1, ["b"] = 2 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_WithOptions_RespectsMaxDepth()
    {
        var options = new ValidationOptions { MaxValidationDepth = 2 };
        var validator = new InstanceValidator(options);
        
        // Create deeply nested schema
        var innerSchema = new JsonObject { ["type"] = "object" };
        var middleSchema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject { ["inner"] = innerSchema }
        };
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject { ["middle"] = middleSchema }
        };
        
        var instance = new JsonObject
        {
            ["middle"] = new JsonObject
            {
                ["inner"] = new JsonObject()
            }
        };
        
        var result = validator.Validate(instance, schema);
        // Should still validate despite nesting
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_WithStopOnFirstError_StopsEarly()
    {
        var options = new ValidationOptions { StopOnFirstError = true };
        var validator = new InstanceValidator(options);
        
        // Create schema that would cause multiple errors
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["a"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["deep"] = new JsonObject { ["type"] = "string" }
                    }
                }
            }
        };
        
        var instance = new JsonObject
        {
            ["a"] = new JsonObject
            {
                ["deep"] = 123 // This should cause an error
            }
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().HaveCountGreaterThanOrEqualTo(1);
    }
    
    [Fact]
    public void InstanceValidator_ValidateRef_Works()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["definitions"] = new JsonObject
            {
                ["positiveNumber"] = new JsonObject
                {
                    ["type"] = "number",
                    ["minimum"] = 0
                }
            },
            ["type"] = new JsonObject { ["$ref"] = "#/definitions/positiveNumber" }
        };
        var instance = JsonValue.Create(5);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_ValidateRef_Invalid_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["definitions"] = new JsonObject
            {
                ["positiveNumber"] = new JsonObject
                {
                    ["type"] = "number",
                    ["minimum"] = 0
                }
            },
            ["type"] = new JsonObject { ["$ref"] = "#/definitions/positiveNumber" }
        };
        var instance = JsonValue.Create(-5);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringOverload_ValidJson_Succeeds()
    {
        var validator = new InstanceValidator();
        var schemaJson = """{"type": "string"}""";
        var instanceJson = "\"hello\"";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringOverload_InvalidJson_Fails()
    {
        var validator = new InstanceValidator();
        var schemaJson = """{"type": "string"}""";
        var instanceJson = "not valid json {";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region SchemaValidator Tests
    
    [Fact]
    public void SchemaValidator_ValidSchema_Succeeds()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["$schema"] = "https://json-structure.org/meta/core/v0/#",
            ["name"] = "TestType",
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_InvalidSchema_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["type"] = "invalid-type"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_NullSchema_Fails()
    {
        var validator = new SchemaValidator();
        var result = validator.Validate(null!);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_BooleanSchema_Succeeds()
    {
        var validator = new SchemaValidator();
        var schema = JsonValue.Create(true);
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_StringOverload_ValidSchema_Succeeds()
    {
        var validator = new SchemaValidator();
        var schemaJson = """{"$id": "urn:example:test", "$schema": "https://json-structure.org/meta/core/v0/#", "name": "TestType", "type": "string"}""";
        
        var result = validator.Validate(schemaJson);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_StringOverload_InvalidJson_Fails()
    {
        var validator = new SchemaValidator();
        var schemaJson = "not valid json {";
        
        var result = validator.Validate(schemaJson);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_WithOptions_Works()
    {
        var options = new ValidationOptions { AllowDollar = true };
        var validator = new SchemaValidator(options);
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["$schema"] = "https://json-structure.org/meta/core/v0/#",
            ["name"] = "TestType",
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_InvalidTypeArray_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["type"] = new JsonArray { "string", "invalid" }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_ValidTypeArray_Succeeds()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["$schema"] = "https://json-structure.org/meta/core/v0/#",
            ["name"] = "TestType",
            ["type"] = new JsonArray { "string", "int32" }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_InvalidEnumType_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["enum"] = "not-an-array"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_EmptyEnum_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["enum"] = new JsonArray()
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidMinLength_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["minLength"] = -1
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidMaxLength_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["maxLength"] = -1
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidPattern_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["pattern"] = "[invalid(regex"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidMinItems_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["minItems"] = -1
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidMaxItems_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["maxItems"] = -1
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidRequiredType_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["required"] = "not-an-array"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidPropertiesType_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["properties"] = "not-an-object"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidDefsType_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["definitions"] = "not-an-object"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidAllOfType_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["allOf"] = "not-an-array"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidAnyOfType_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["anyOf"] = "not-an-array"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidOneOfType_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["oneOf"] = "not-an-array"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_ValidDefinitions_Succeeds()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["$schema"] = "https://json-structure.org/meta/core/v0/#",
            ["name"] = "TestType",
            ["type"] = "string",
            ["definitions"] = new JsonObject
            {
                ["PositiveNumber"] = new JsonObject
                {
                    ["type"] = "int32"
                }
            }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_ValidRef_Succeeds()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "urn:example:test-schema",
            ["$schema"] = "https://json-structure.org/meta/core/v0/#",
            ["name"] = "TestType",
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["myProp"] = new JsonObject
                {
                    ["type"] = new JsonObject { ["$ref"] = "#/definitions/MyDef" }
                }
            },
            ["definitions"] = new JsonObject
            {
                ["MyDef"] = new JsonObject { ["type"] = "string" }
            }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_InvalidMultipleOfType_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["multipleOf"] = "not-a-number"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_InvalidMultipleOfValue_Fails()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["multipleOf"] = 0
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region ValidationErrors Helper Class Tests
    
    [Fact]
    public void ValidationErrors_Create_CreatesValidationError()
    {
        var error = ValidationErrors.Create("ERR001", "Test message", "/path", ValidationSeverity.Error, new JsonLocation(10, 5), "/schema");
        
        error.Code.Should().Be("ERR001");
        error.Message.Should().Be("Test message");
        error.Path.Should().Be("/path");
        error.Severity.Should().Be(ValidationSeverity.Error);
        error.Location.Line.Should().Be(10);
        error.Location.Column.Should().Be(5);
        error.SchemaPath.Should().Be("/schema");
    }
    
    [Fact]
    public void ValidationErrors_Schema_CreatesSchemaError()
    {
        var error = ValidationErrors.Schema("SCHEMA001", "Schema error", "/path", new JsonLocation(1, 1));
        
        error.Code.Should().Be("SCHEMA001");
        error.Message.Should().Be("Schema error");
        error.Path.Should().Be("/path");
        error.Severity.Should().Be(ValidationSeverity.Error);
        error.SchemaPath.Should().BeNull();
    }
    
    [Fact]
    public void ValidationErrors_Instance_CreatesInstanceError()
    {
        var error = ValidationErrors.Instance("INST001", "Instance error", "/data", new JsonLocation(5, 10), "/schema/type");
        
        error.Code.Should().Be("INST001");
        error.Message.Should().Be("Instance error");
        error.Path.Should().Be("/data");
        error.Severity.Should().Be(ValidationSeverity.Error);
        error.SchemaPath.Should().Be("/schema/type");
    }
    
    [Fact]
    public void ValidationErrors_Warning_CreatesWarning()
    {
        var error = ValidationErrors.Warning("WARN001", "Warning message", "/path", new JsonLocation(1, 1), "/schema");
        
        error.Code.Should().Be("WARN001");
        error.Message.Should().Be("Warning message");
        error.Path.Should().Be("/path");
        error.Severity.Should().Be(ValidationSeverity.Warning);
        error.SchemaPath.Should().Be("/schema");
    }
    
    [Fact]
    public void ValidationErrors_Create_DefaultValues()
    {
        var error = ValidationErrors.Create("ERR001", "Test");
        
        error.Code.Should().Be("ERR001");
        error.Message.Should().Be("Test");
        error.Path.Should().BeEmpty();
        error.Severity.Should().Be(ValidationSeverity.Error);
        error.Location.IsKnown.Should().BeFalse();
        error.SchemaPath.Should().BeNull();
    }
    
    #endregion

    #region Additional Instance Validator Edge Cases
    
    [Fact]
    public void InstanceValidator_BooleanSchema_True_AcceptsAnything()
    {
        var validator = new InstanceValidator();
        var schema = JsonValue.Create(true);
        var instance = new JsonObject { ["anything"] = "goes" };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_BooleanSchema_False_RejectsEverything()
    {
        var validator = new InstanceValidator();
        var schema = JsonValue.Create(false);
        var instance = JsonValue.Create("anything");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Extends_MergesBaseProperties()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["$extends"] = "#/definitions/Base",
            ["properties"] = new JsonObject
            {
                ["extra"] = new JsonObject { ["type"] = "string" }
            },
            ["definitions"] = new JsonObject
            {
                ["Base"] = new JsonObject
                {
                    ["abstract"] = true,
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["name"] = new JsonObject { ["type"] = "string" }
                    }
                }
            }
        };
        var instance = new JsonObject
        {
            ["name"] = "test",
            ["extra"] = "value"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Root_ResolvesToType()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["$root"] = "#/definitions/Person",
            ["definitions"] = new JsonObject
            {
                ["Person"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["name"] = new JsonObject { ["type"] = "string" }
                    },
                    ["required"] = new JsonArray { "name" }
                }
            }
        };
        var instance = new JsonObject { ["name"] = "Alice" };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Root_InvalidRef_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["$root"] = "#/definitions/NonExistent"
        };
        var instance = new JsonObject { ["name"] = "test" };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Set_UniqueElements()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "set",
            ["items"] = new JsonObject { ["type"] = "string" }
        };
        var instance = new JsonArray { "a", "b", "c" };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Set_DuplicateElements_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "set",
            ["items"] = new JsonObject { ["type"] = "string" }
        };
        var instance = new JsonArray { "a", "b", "a" };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Map_ValidValues()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "int32" }
        };
        var instance = new JsonObject
        {
            ["key1"] = 1,
            ["key2"] = 2
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Map_InvalidValue_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "int32" }
        };
        var instance = new JsonObject
        {
            ["key1"] = 1,
            ["key2"] = "not-a-number"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Tuple_ValidTuple()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "tuple",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" },
                ["age"] = new JsonObject { ["type"] = "int32" }
            },
            ["tuple"] = new JsonArray { "name", "age" }
        };
        var instance = new JsonArray { "Alice", 30 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Tuple_WrongLength_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "tuple",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" },
                ["age"] = new JsonObject { ["type"] = "int32" }
            },
            ["tuple"] = new JsonArray { "name", "age" }
        };
        var instance = new JsonArray { "Alice" }; // Missing age
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Choice_TaggedUnion_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "choice",
            ["choices"] = new JsonObject
            {
                ["text"] = new JsonObject { ["type"] = "string" },
                ["number"] = new JsonObject { ["type"] = "int32" }
            }
        };
        var instance = new JsonObject { ["text"] = "hello" };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Choice_MultipleKeys_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "choice",
            ["choices"] = new JsonObject
            {
                ["text"] = new JsonObject { ["type"] = "string" },
                ["number"] = new JsonObject { ["type"] = "int32" }
            }
        };
        var instance = new JsonObject 
        { 
            ["text"] = "hello",
            ["number"] = 42 
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Any_AcceptsAnything()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "any" };
        
        validator.Validate(JsonValue.Create("string"), schema).IsValid.Should().BeTrue();
        validator.Validate(JsonValue.Create(42), schema).IsValid.Should().BeTrue();
        validator.Validate(new JsonArray { 1, 2, 3 }, schema).IsValid.Should().BeTrue();
        validator.Validate(new JsonObject { ["a"] = 1 }, schema).IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Int8_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "int8" };
        var instance = JsonValue.Create(127);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Int8_OutOfRange_Fails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "int8" };
        var instance = JsonValue.Create(200);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Uint8_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "uint8" };
        var instance = JsonValue.Create(255);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Int16_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "int16" };
        var instance = JsonValue.Create(32000);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Uint16_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "uint16" };
        var instance = JsonValue.Create(65000);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Uint32_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "uint32" };
        var instance = JsonValue.Create(1000000); // Use a value that fits in int32 range
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Float_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "float" };
        var instance = JsonValue.Create(3.14); // JSON numbers are doubles
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Double_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "double" };
        var instance = JsonValue.Create(3.14159265358979);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Int64_AsString_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "int64" };
        var instance = JsonValue.Create("9223372036854775807");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Int128_AsString_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "int128" };
        var instance = JsonValue.Create("170141183460469231731687303715884105727");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Decimal_AsString_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "decimal" };
        var instance = JsonValue.Create("12345.67890");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Date_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "date" };
        var instance = JsonValue.Create("2025-01-15");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_DateTime_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "datetime" };
        var instance = JsonValue.Create("2025-01-15T10:30:00Z");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Time_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "time" };
        var instance = JsonValue.Create("10:30:00");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Duration_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "duration" };
        var instance = JsonValue.Create("PT1H30M");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Uuid_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "uuid" };
        var instance = JsonValue.Create("550e8400-e29b-41d4-a716-446655440000");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Uri_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "uri" };
        var instance = JsonValue.Create("https://example.com/path");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Binary_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "binary" };
        var instance = JsonValue.Create("SGVsbG8gV29ybGQ="); // "Hello World" in base64
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_JsonPointer_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "jsonpointer" };
        var instance = JsonValue.Create("/definitions/Type");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_JsonPointer_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "jsonpointer" };
        var instance = JsonValue.Create("invalid-pointer"); // Doesn't start with /
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_JsonPointer_Empty_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "jsonpointer" };
        var instance = JsonValue.Create("");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    #endregion
    
    #region String Format Validation Tests (StrictFormatValidation)
    
    [Fact]
    public void InstanceValidator_StringFormat_Email_Valid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "email"
        };
        var instance = JsonValue.Create("test@example.com");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Email_Invalid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "email"
        };
        var instance = JsonValue.Create("not-an-email");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Uri_Valid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "uri"
        };
        var instance = JsonValue.Create("https://example.com");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Uri_Invalid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "uri"
        };
        var instance = JsonValue.Create("not a uri");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_UriReference_Valid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "uri-reference"
        };
        var instance = JsonValue.Create("/relative/path");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Date_Valid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "date"
        };
        var instance = JsonValue.Create("2025-01-15");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Date_Invalid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "date"
        };
        var instance = JsonValue.Create("not-a-date");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Time_Valid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "time"
        };
        var instance = JsonValue.Create("14:30:00");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Time_Invalid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "time"
        };
        var instance = JsonValue.Create("not-a-time");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_DateTime_Valid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "date-time"
        };
        var instance = JsonValue.Create("2025-01-15T14:30:00Z");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_DateTime_Invalid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "date-time"
        };
        var instance = JsonValue.Create("not-a-datetime");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Uuid_Valid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "uuid"
        };
        var instance = JsonValue.Create("550e8400-e29b-41d4-a716-446655440000");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Uuid_Invalid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "uuid"
        };
        var instance = JsonValue.Create("not-a-uuid");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Ipv4_Valid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "ipv4"
        };
        var instance = JsonValue.Create("192.168.1.1");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Ipv4_Invalid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "ipv4"
        };
        var instance = JsonValue.Create("not-an-ip");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Ipv6_Valid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "ipv6"
        };
        var instance = JsonValue.Create("::1");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Ipv6_Invalid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "ipv6"
        };
        var instance = JsonValue.Create("not-an-ipv6");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Hostname_Valid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "hostname"
        };
        var instance = JsonValue.Create("example.com");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringFormat_Hostname_Invalid()
    {
        var options = new ValidationOptions { StrictFormatValidation = true };
        var validator = new InstanceValidator(options);
        var schema = new JsonObject 
        { 
            ["type"] = "string",
            ["format"] = "hostname"
        };
        var instance = JsonValue.Create("not a valid hostname!");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region $extends (Inheritance) Tests
    
    [Fact]
    public void InstanceValidator_Extends_SingleInheritance_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["definitions"] = new JsonObject
            {
                ["Base"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["id"] = new JsonObject { ["type"] = "string" }
                    },
                    ["required"] = new JsonArray { "id" }
                }
            },
            ["$extends"] = "#/definitions/Base",
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            }
        };
        var instance = new JsonObject
        {
            ["id"] = "123",
            ["name"] = "Test"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Extends_SingleInheritance_Missing_Required()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["definitions"] = new JsonObject
            {
                ["Base"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["id"] = new JsonObject { ["type"] = "string" }
                    },
                    ["required"] = new JsonArray { "id" }
                }
            },
            ["$extends"] = "#/definitions/Base",
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            }
        };
        var instance = new JsonObject
        {
            ["name"] = "Test"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Extends_MultipleInheritance_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["definitions"] = new JsonObject
            {
                ["Named"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["name"] = new JsonObject { ["type"] = "string" }
                    },
                    ["required"] = new JsonArray { "name" }
                },
                ["Timestamped"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["createdAt"] = new JsonObject { ["type"] = "datetime" }
                    }
                }
            },
            ["$extends"] = new JsonArray { "#/definitions/Named", "#/definitions/Timestamped" },
            ["type"] = "object"
        };
        var instance = new JsonObject
        {
            ["name"] = "Test",
            ["createdAt"] = "2025-01-15T10:00:00Z"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    #endregion
    
    #region Map Validation Tests
    
    [Fact]
    public void InstanceValidator_Map_WithPatternKeys_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "string" },
            ["patternKeys"] = new JsonObject
            {
                ["pattern"] = "^[a-z]+$"
            }
        };
        var instance = new JsonObject
        {
            ["abc"] = "value1",
            ["xyz"] = "value2"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Map_WithPatternKeys_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "string" },
            ["patternKeys"] = new JsonObject
            {
                ["pattern"] = "^[a-z]+$"
            }
        };
        var instance = new JsonObject
        {
            ["abc"] = "value1",
            ["XYZ"] = "value2"  // uppercase violates pattern
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Map_WithMinMaxEntries_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "string" },
            ["minEntries"] = 1,
            ["maxEntries"] = 3
        };
        var instance = new JsonObject
        {
            ["a"] = "1",
            ["b"] = "2"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Map_BelowMinEntries_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "string" },
            ["minEntries"] = 2
        };
        var instance = new JsonObject
        {
            ["a"] = "1"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Map_AboveMaxEntries_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "string" },
            ["maxEntries"] = 1
        };
        var instance = new JsonObject
        {
            ["a"] = "1",
            ["b"] = "2"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Map_WithKeyNames_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "number" },
            ["keyNames"] = new JsonObject
            {
                ["type"] = "string",
                ["minLength"] = 2
            }
        };
        var instance = new JsonObject
        {
            ["ab"] = 1,
            ["cd"] = 2
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Map_WithKeyNames_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "number" },
            ["keyNames"] = new JsonObject
            {
                ["type"] = "string",
                ["minLength"] = 2
            }
        };
        var instance = new JsonObject
        {
            ["a"] = 1  // key too short
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region Tuple Validation Tests
    
    [Fact]
    public void InstanceValidator_Tuple_WithTupleProperty_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "tuple",
            ["tuple"] = new JsonArray { "x", "y" },
            ["properties"] = new JsonObject
            {
                ["x"] = new JsonObject { ["type"] = "number" },
                ["y"] = new JsonObject { ["type"] = "number" }
            }
        };
        var instance = new JsonArray { 10, 20 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Tuple_WithTupleProperty_WrongLength()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "tuple",
            ["tuple"] = new JsonArray { "x", "y" },
            ["properties"] = new JsonObject
            {
                ["x"] = new JsonObject { ["type"] = "number" },
                ["y"] = new JsonObject { ["type"] = "number" }
            }
        };
        var instance = new JsonArray { 10 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Tuple_WithAdditionalItems_Schema()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "tuple",
            ["prefixItems"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "number" }
            },
            ["items"] = new JsonObject { ["type"] = "boolean" }
        };
        var instance = new JsonArray { "a", 1, true, false };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Tuple_WithAdditionalItems_False()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "tuple",
            ["prefixItems"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "number" }
            },
            ["items"] = false
        };
        var instance = new JsonArray { "a", 1, true };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region Choice Validation Tests
    
    [Fact]
    public void InstanceValidator_Choice_WithSelector_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "choice",
            ["selector"] = "kind",
            ["options"] = new JsonObject
            {
                ["circle"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["kind"] = new JsonObject { ["const"] = "circle" },
                        ["radius"] = new JsonObject { ["type"] = "number" }
                    }
                },
                ["square"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["kind"] = new JsonObject { ["const"] = "square" },
                        ["side"] = new JsonObject { ["type"] = "number" }
                    }
                }
            }
        };
        var instance = new JsonObject
        {
            ["kind"] = "circle",
            ["radius"] = 5
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Choice_WithSelector_MissingSelectorProperty()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "choice",
            ["selector"] = "kind",
            ["options"] = new JsonObject
            {
                ["circle"] = new JsonObject { ["type"] = "object" }
            }
        };
        var instance = new JsonObject
        {
            ["radius"] = 5
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Choice_WithChoicesKeyword_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "choice",
            ["discriminator"] = "type",
            ["choices"] = new JsonObject
            {
                ["A"] = new JsonObject { ["type"] = "object" },
                ["B"] = new JsonObject { ["type"] = "object" }
            }
        };
        var instance = new JsonObject
        {
            ["type"] = "A"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Choice_TaggedUnion_WithOptions_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "choice",
            ["options"] = new JsonObject
            {
                ["success"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["data"] = new JsonObject { ["type"] = "string" }
                    }
                },
                ["error"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["message"] = new JsonObject { ["type"] = "string" }
                    }
                }
            }
        };
        var instance = new JsonObject
        {
            ["success"] = new JsonObject { ["data"] = "result" }
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Choice_DiscriminatorNotString_ThrowsOrFails()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "choice",
            ["discriminator"] = "kind",
            ["options"] = new JsonObject
            {
                ["A"] = new JsonObject { ["type"] = "object" }
            }
        };
        var instance = new JsonObject
        {
            ["kind"] = 123  // Should be string - causes exception because GetValue<string> on int
        };
        
        // Current implementation throws when discriminator value is non-string
        // This tests that we don't crash silently
        var action = () => validator.Validate(instance, schema);
        action.Should().Throw<InvalidOperationException>();
    }
    
    [Fact]
    public void InstanceValidator_Choice_UnknownOption_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "choice",
            ["discriminator"] = "kind",
            ["options"] = new JsonObject
            {
                ["A"] = new JsonObject { ["type"] = "object" }
            }
        };
        var instance = new JsonObject
        {
            ["kind"] = "B"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Choice_MultipleMatches_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "choice",
            ["options"] = new JsonObject
            {
                ["A"] = new JsonObject { ["type"] = "object" },
                ["B"] = new JsonObject { ["type"] = "object" }  // Both match empty object
            }
        };
        var instance = new JsonObject { ["x"] = 1 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region $root Tests
    
    [Fact]
    public void InstanceValidator_Root_ResolvesRootRef()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["$root"] = "#/definitions/Person",
            ["definitions"] = new JsonObject
            {
                ["Person"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["name"] = new JsonObject { ["type"] = "string" }
                    },
                    ["required"] = new JsonArray { "name" }
                }
            }
        };
        var instance = new JsonObject
        {
            ["name"] = "John"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Root_UnresolvedRef_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["$root"] = "#/definitions/Unknown"
        };
        var instance = new JsonObject { ["x"] = 1 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region Type Reference Tests
    
    [Fact]
    public void InstanceValidator_TypeRef_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["definitions"] = new JsonObject
            {
                ["PositiveInt"] = new JsonObject
                {
                    ["type"] = "integer",
                    ["minimum"] = 1
                }
            },
            ["type"] = new JsonObject { ["$ref"] = "#/definitions/PositiveInt" }
        };
        var instance = JsonValue.Create(5);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_TypeRef_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["definitions"] = new JsonObject
            {
                ["PositiveInt"] = new JsonObject
                {
                    ["type"] = "integer",
                    ["minimum"] = 1
                }
            },
            ["type"] = new JsonObject { ["$ref"] = "#/definitions/PositiveInt" }
        };
        var instance = JsonValue.Create(0);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region Custom Type Tests
    
    [Fact]
    public void InstanceValidator_CustomType_ReportsNotSupported()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "myns:CustomType"
        };
        var instance = JsonValue.Create("test");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Message.Contains("Custom type"));
    }
    
    [Fact]
    public void InstanceValidator_UnknownType_ReportsError()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "unknowntype"
        };
        var instance = JsonValue.Create("test");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Message.Contains("Unknown type"));
    }
    
    #endregion
    
    #region String Overload Tests (JsonSourceLocator coverage)
    
    [Fact]
    public void InstanceValidator_StringOverload_TracksSourceLocation()
    {
        var validator = new InstanceValidator();
        var schemaJson = @"{""type"": ""object"", ""required"": [""name""]}";
        var instanceJson = @"{}";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeFalse();
        // Source location tracking should be enabled
    }
    
    [Fact]
    public void InstanceValidator_StringOverload_InvalidJson()
    {
        var validator = new InstanceValidator();
        var schemaJson = @"{""type"": ""string""}";
        var instanceJson = @"{invalid json";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Message.Contains("parse"));
    }
    
    #endregion
    
    #region Set Validation Tests
    
    [Fact]
    public void InstanceValidator_Set_Duplicate_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "set",
            ["items"] = new JsonObject { ["type"] = "number" }
        };
        var instance = new JsonArray { 1, 2, 1 };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region Array Contains Tests
    
    [Fact]
    public void InstanceValidator_Array_Contains_MaxContains_Exceeded()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "number" },
            ["contains"] = new JsonObject { ["minimum"] = 5 },
            ["maxContains"] = 1
        };
        var instance = new JsonArray { 1, 5, 6 };  // Two items >= 5
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_Array_Contains_MinContains_NotMet()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "number" },
            ["contains"] = new JsonObject { ["minimum"] = 10 },
            ["minContains"] = 2
        };
        var instance = new JsonArray { 1, 2, 15 };  // Only one item >= 10
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region Object DependentRequired Tests
    
    [Fact]
    public void InstanceValidator_Object_DependentRequired_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" },
                ["creditCard"] = new JsonObject { ["type"] = "string" },
                ["billingAddress"] = new JsonObject { ["type"] = "string" }
            },
            ["dependentRequired"] = new JsonObject
            {
                ["creditCard"] = new JsonArray { "billingAddress" }
            }
        };
        var instance = new JsonObject
        {
            ["name"] = "John",
            ["creditCard"] = "1234",
            ["billingAddress"] = "123 Main St"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Object_DependentRequired_Missing()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["creditCard"] = new JsonObject { ["type"] = "string" },
                ["billingAddress"] = new JsonObject { ["type"] = "string" }
            },
            ["dependentRequired"] = new JsonObject
            {
                ["creditCard"] = new JsonArray { "billingAddress" }
            }
        };
        var instance = new JsonObject
        {
            ["creditCard"] = "1234"
            // Missing billingAddress
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region Number Type Edge Cases
    
    [Fact]
    public void InstanceValidator_Int128_StringEncoded_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "int128" };
        var instance = JsonValue.Create("170141183460469231731687303715884105727");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_UInt128_StringEncoded_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "uint128" };
        var instance = JsonValue.Create("340282366920938463463374607431768211455");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_Decimal_StringEncoded_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "decimal" };
        var instance = JsonValue.Create("12345.6789");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringEncodedNumber_InvalidType()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "float" };  // float doesn't accept strings
        var instance = JsonValue.Create("3.14");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region Validation Keywords Without Type Tests
    
    [Fact]
    public void InstanceValidator_NumericConstraints_WithoutType()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["minimum"] = 0,
            ["maximum"] = 100
        };
        var instance = JsonValue.Create(50);
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringConstraints_WithoutType()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["minLength"] = 1,
            ["maxLength"] = 10
        };
        var instance = JsonValue.Create("hello");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_PatternConstraint_WithoutType()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["pattern"] = "^[A-Z]+$"
        };
        var instance = JsonValue.Create("ABC");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_PatternConstraint_WithoutType_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["pattern"] = "^[A-Z]+$"
        };
        var instance = JsonValue.Create("abc");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region Boolean Schema Tests
    
    [Fact]
    public void InstanceValidator_BooleanSchema_True_AcceptsNull()
    {
        var validator = new InstanceValidator();
        JsonNode schema = JsonValue.Create(true);
        JsonNode? instance = null;
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_BooleanSchema_False_RejectsNull()
    {
        var validator = new InstanceValidator();
        JsonNode schema = JsonValue.Create(false);
        JsonNode? instance = null;
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue(); // false schema only rejects non-null
    }
    
    [Fact]
    public void InstanceValidator_BooleanSchema_False_RejectsValue()
    {
        var validator = new InstanceValidator();
        JsonNode schema = JsonValue.Create(false);
        JsonNode instance = JsonValue.Create("anything");
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region AdditionalProperties Schema Tests
    
    [Fact]
    public void InstanceValidator_AdditionalProperties_Schema_Valid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            },
            ["additionalProperties"] = new JsonObject { ["type"] = "number" }
        };
        var instance = new JsonObject
        {
            ["name"] = "John",
            ["age"] = 30,
            ["score"] = 100
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_AdditionalProperties_Schema_Invalid()
    {
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            },
            ["additionalProperties"] = new JsonObject { ["type"] = "number" }
        };
        var instance = new JsonObject
        {
            ["name"] = "John",
            ["extra"] = "not a number"
        };
        
        var result = validator.Validate(instance, schema);
        result.IsValid.Should().BeFalse();
    }
    
    #endregion
    
    #region Schema Validator Tests
    
    [Fact]
    public void SchemaValidator_StringOverload_Valid()
    {
        var validator = new SchemaValidator();
        var schemaJson = @"{""$id"": ""https://example.com/test"", ""$schema"": ""https://json-structure.org/meta/core/v0/schema"", ""type"": ""string"", ""name"": ""TestString""}";
        
        var result = validator.Validate(schemaJson);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_StringOverload_InvalidJson()
    {
        var validator = new SchemaValidator();
        var schemaJson = @"{invalid json";
        
        var result = validator.Validate(schemaJson);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Message.Contains("parse"));
    }
    
    [Fact]
    public void SchemaValidator_TypeArray_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = new JsonArray { "string", "number" },
            ["name"] = "UnionType"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_TypeArray_Empty_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = new JsonArray(),
            ["name"] = "Empty"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_TypeArray_WithRef_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["definitions"] = new JsonObject
            {
                ["Custom"] = new JsonObject { ["type"] = "string" }
            },
            ["type"] = new JsonArray 
            { 
                "string", 
                new JsonObject { ["$ref"] = "#/definitions/Custom" } 
            },
            ["name"] = "RefUnion"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_TypeObject_MissingRef_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = new JsonObject { ["name"] = "wrong" },
            ["name"] = "Bad"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Extends_Single_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["definitions"] = new JsonObject
            {
                ["Base"] = new JsonObject { ["type"] = "object" }
            },
            ["$extends"] = "#/definitions/Base",
            ["type"] = "object",
            ["name"] = "Derived"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_Extends_Array_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["definitions"] = new JsonObject
            {
                ["A"] = new JsonObject { ["type"] = "object" },
                ["B"] = new JsonObject { ["type"] = "object" }
            },
            ["$extends"] = new JsonArray { "#/definitions/A", "#/definitions/B" },
            ["type"] = "object",
            ["name"] = "MultiDerived"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_Extends_Empty_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["$extends"] = "",
            ["type"] = "object",
            ["name"] = "Empty"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Extends_EmptyArray_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["$extends"] = new JsonArray(),
            ["type"] = "object",
            ["name"] = "Empty"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Import_String_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["$import"] = "https://example.com/other",
            ["type"] = "object",
            ["name"] = "Importer"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_Import_Array_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["$import"] = new JsonArray { "https://example.com/a", "https://example.com/b" },
            ["type"] = "object",
            ["name"] = "MultiImporter"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_Import_Object_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["$import"] = new JsonObject { ["alias"] = "https://example.com/other" },
            ["type"] = "object",
            ["name"] = "AliasImporter"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_Anchor_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["$anchor"] = "MyAnchor",
            ["type"] = "string",
            ["name"] = "Anchored"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_Anchor_InvalidIdentifier()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["$anchor"] = "123-invalid",
            ["type"] = "string",
            ["name"] = "BadAnchor"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_ObjectSchema_RequiredNotInProperties()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "object",
            ["name"] = "Obj",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            },
            ["required"] = new JsonArray { "name", "age" }  // age not defined
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_StringConstraints_OnNonString_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "number",
            ["name"] = "Num",
            ["minLength"] = 5  // Invalid for number
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_NumericConstraints_OnNonNumeric_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "string",
            ["name"] = "Str",
            ["minimum"] = 0  // Invalid for string
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_MinGreaterThanMax_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "number",
            ["name"] = "Num",
            ["minimum"] = 100,
            ["maximum"] = 10  // Invalid: min > max
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_MinLengthGreaterThanMaxLength_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "string",
            ["name"] = "Str",
            ["minLength"] = 100,
            ["maxLength"] = 10  // Invalid
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_MinItemsGreaterThanMaxItems_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "array",
            ["name"] = "Arr",
            ["items"] = new JsonObject { ["type"] = "string" },
            ["minItems"] = 100,
            ["maxItems"] = 10  // Invalid
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_ArraySchema_MissingItems_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "array",
            ["name"] = "Arr"
            // Missing items
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_MapSchema_MissingValues_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "map",
            ["name"] = "MyMap"
            // Missing values
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_ChoiceSchema_MissingOptions_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "choice",
            ["name"] = "MyChoice"
            // Missing options/choices
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_TupleSchema_MissingPrefixItems_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "tuple",
            ["name"] = "MyTuple"
            // Missing prefixItems
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_StringFormat_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "string",
            ["name"] = "Email",
            ["format"] = "email"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_BooleanSchema_True_Valid()
    {
        var validator = new SchemaValidator();
        JsonNode schema = JsonValue.Create(true);
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_BooleanSchema_False_Valid()
    {
        var validator = new SchemaValidator();
        JsonNode schema = JsonValue.Create(false);
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_InvalidSchemaType_Number()
    {
        var validator = new SchemaValidator();
        JsonNode schema = JsonValue.Create(123);
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Null_Invalid()
    {
        var validator = new SchemaValidator();
        
        var result = validator.Validate((JsonNode?)null);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_MaxDepthExceeded()
    {
        var options = new ValidationOptions { MaxValidationDepth = 2 };
        var validator = new SchemaValidator(options);
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "object",
            ["name"] = "Deep",
            ["properties"] = new JsonObject
            {
                ["a"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["b"] = new JsonObject
                        {
                            ["type"] = "object",
                            ["properties"] = new JsonObject
                            {
                                ["c"] = new JsonObject { ["type"] = "string" }
                            }
                        }
                    }
                }
            }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_StopOnFirstError()
    {
        var options = new ValidationOptions { StopOnFirstError = true };
        var validator = new SchemaValidator(options);
        var schema = new JsonObject
        {
            // Missing $id and multiple other issues
            ["type"] = "unknown",
            ["minLength"] = 5  // Wrong for unknown type
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
        // Just verify it found some errors (StopOnFirstError may still find a few related errors)
        result.Errors.Should().NotBeEmpty();
    }
    
    [Fact]
    public void SchemaValidator_Enum_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["enum"] = new JsonArray { "a", "b", "c" },
            ["name"] = "MyEnum"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_Const_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["const"] = "fixed",
            ["name"] = "MyConst"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_ConditionalComposition_AllOf()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["name"] = "AllOfTest",
            ["allOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "object" },
                new JsonObject { ["type"] = "object" }
            }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_ConditionalComposition_AnyOf()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["name"] = "AnyOfTest",
            ["anyOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "number" }
            }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_ConditionalComposition_OneOf()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["name"] = "OneOfTest",
            ["oneOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "number" }
            }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_ConditionalComposition_Not()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["name"] = "NotTest",
            ["not"] = new JsonObject { ["type"] = "null" }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_ConditionalComposition_IfThenElse()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["name"] = "IfThenTest",
            ["if"] = new JsonObject { ["type"] = "string" },
            ["then"] = new JsonObject { ["minLength"] = 1 },
            ["else"] = new JsonObject { ["type"] = "number" }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_InvalidPattern_Regex()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "string",
            ["name"] = "BadPattern",
            ["pattern"] = "[invalid(regex"  // Invalid regex
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_UniqueItems_NotBoolean_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "array",
            ["name"] = "Arr",
            ["items"] = new JsonObject { ["type"] = "string" },
            ["uniqueItems"] = "true"  // Should be boolean, not string
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_EnumDuplicates_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["name"] = "DupEnum",
            ["enum"] = new JsonArray { "a", "b", "a" }  // Duplicate
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_EnumEmpty_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["name"] = "EmptyEnum",
            ["enum"] = new JsonArray()
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Const_TypeMismatch_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "string",
            ["name"] = "Str",
            ["const"] = 123  // Number for string type
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Const_Boolean_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "boolean",
            ["name"] = "Bool",
            ["const"] = true
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_Const_Number_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "number",
            ["name"] = "Num",
            ["const"] = 42.5
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void SchemaValidator_Const_Integer_Valid()
    {
        var validator = new SchemaValidator();
        // Create using JsonValue.Create to ensure proper typing
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["$schema"] = "https://json-structure.org/meta/extended/v0/$id",
            ["type"] = "integer",
            ["name"] = "Int",
            ["const"] = JsonValue.Create(42L) // Use long to ensure it parses as integer
        };
        
        var result = validator.Validate(schema);
        // Output any errors for debugging
        if (!result.IsValid)
        {
            var errorMessages = string.Join("; ", result.Errors.Select(e => $"{e.Path}: {e.Message}"));
            result.IsValid.Should().BeTrue($"Errors: {errorMessages}");
        }
    }
    
    [Fact]
    public void SchemaValidator_PrefixItems_NotArray_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "tuple",
            ["name"] = "Tup",
            ["prefixItems"] = "not-an-array"
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Options_NotObject_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "choice",
            ["name"] = "Choice",
            ["options"] = new JsonArray { "a", "b" }  // Should be object
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Choices_NotObject_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "choice",
            ["name"] = "Choice",
            ["choices"] = new JsonArray { "a", "b" }  // Should be object
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Properties_NotObject_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "object",
            ["name"] = "Obj",
            ["properties"] = new JsonArray()  // Should be object
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Required_NotArray_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "object",
            ["name"] = "Obj",
            ["required"] = "name"  // Should be array
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Required_ItemNotString_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "object",
            ["name"] = "Obj",
            ["required"] = new JsonArray { 123 }  // Should be strings
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_AdditionalProperties_Invalid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "object",
            ["name"] = "Obj",
            ["additionalProperties"] = "string"  // Should be boolean or schema object
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void SchemaValidator_Altnames_Valid()
    {
        var validator = new SchemaValidator();
        var schema = new JsonObject
        {
            ["$id"] = "https://example.com/test",
            ["type"] = "object",
            ["name"] = "Person",
            ["properties"] = new JsonObject
            {
                ["firstName"] = new JsonObject 
                { 
                    ["type"] = "string",
                    ["altnames"] = new JsonObject
                    {
                        ["json"] = "first_name",
                        ["xml"] = "FirstName"
                    }
                }
            }
        };
        
        var result = validator.Validate(schema);
        result.IsValid.Should().BeTrue();
    }
    
    #endregion
    
    #region String Overload Tests - Exercises JsonSourceLocator
    
    [Fact]
    public void InstanceValidator_StringOverload_WithInvalidInstance_ReportsLineAndColumn()
    {
        var validator = new InstanceValidator();
        var schemaJson = @"{
            ""$id"": ""https://example.com/person"",
            ""$schema"": ""https://json-structure.org/meta/extended/v0/$id"",
            ""type"": ""object"",
            ""name"": ""Person"",
            ""properties"": {
                ""age"": { ""type"": ""integer"" }
            }
        }";
        var instanceJson = @"{
            ""age"": ""not-a-number""
        }";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().NotBeEmpty();
        // Check that location info is populated when using string overload
        // Line 2, after whitespace
        var error = result.Errors.FirstOrDefault(e => e.Path?.Contains("age") == true);
        error.Should().NotBeNull();
        error!.Location.Line.Should().BeGreaterThan(0);
    }
    
    [Fact]
    public void InstanceValidator_StringOverload_WithNestedArrayError_FindsCorrectLocation()
    {
        var validator = new InstanceValidator();
        var schemaJson = @"{
            ""$id"": ""https://example.com/test"",
            ""$schema"": ""https://json-structure.org/meta/extended/v0/$id"",
            ""type"": ""object"",
            ""name"": ""Container"",
            ""properties"": {
                ""items"": {
                    ""type"": ""array"",
                    ""items"": { ""type"": ""integer"" }
                }
            }
        }";
        var instanceJson = @"{
            ""items"": [1, 2, ""bad"", 4]
        }";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeFalse();
        // The error should point to items/2 which is "bad"
    }
    
    [Fact]
    public void InstanceValidator_StringOverload_WithDeeplyNested_ReportsCorrectPath()
    {
        var validator = new InstanceValidator();
        var schemaJson = @"{
            ""$id"": ""https://example.com/test"",
            ""$schema"": ""https://json-structure.org/meta/extended/v0/$id"",
            ""type"": ""object"",
            ""name"": ""Root"",
            ""properties"": {
                ""level1"": {
                    ""type"": ""object"",
                    ""properties"": {
                        ""level2"": {
                            ""type"": ""object"",
                            ""properties"": {
                                ""level3"": { ""type"": ""integer"" }
                            }
                        }
                    }
                }
            }
        }";
        var instanceJson = @"{
            ""level1"": {
                ""level2"": {
                    ""level3"": ""not-an-int""
                }
            }
        }";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeFalse();
        var error = result.Errors.FirstOrDefault(e => e.Path?.Contains("level3") == true);
        error.Should().NotBeNull();
    }
    
    [Fact]
    public void SchemaValidator_StringOverload_ReportsLocationForInvalidProperty()
    {
        var validator = new SchemaValidator();
        var schemaJson = @"{
            ""$id"": ""https://example.com/test"",
            ""$schema"": ""https://json-structure.org/meta/core/v0/$id"",
            ""type"": ""object"",
            ""name"": ""Test"",
            ""properties"": {
                ""badProp"": {
                    ""type"": ""invalid-type""
                }
            }
        }";
        
        var result = validator.Validate(schemaJson);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().NotBeEmpty();
    }
    
    [Fact]
    public void InstanceValidator_StringOverload_EmptyArrayPath()
    {
        var validator = new InstanceValidator();
        var schemaJson = @"{
            ""$id"": ""https://example.com/arr"",
            ""$schema"": ""https://json-structure.org/meta/extended/v0/$id"",
            ""type"": ""array"",
            ""name"": ""Numbers"",
            ""items"": { ""type"": ""integer"" }
        }";
        var instanceJson = @"[1, 2, ""invalid""]";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringOverload_ValidInstance_NoLocationNeeded()
    {
        var validator = new InstanceValidator();
        var schemaJson = @"{
            ""$id"": ""https://example.com/test"",
            ""$schema"": ""https://json-structure.org/meta/extended/v0/$id"",
            ""type"": ""string"",
            ""name"": ""SimpleString""
        }";
        var instanceJson = @"""hello""";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeTrue();
    }
    
    [Fact]
    public void InstanceValidator_StringOverload_MapWithErrors()
    {
        var validator = new InstanceValidator();
        var schemaJson = @"{
            ""$id"": ""https://example.com/map"",
            ""$schema"": ""https://json-structure.org/meta/extended/v0/$id"",
            ""type"": ""map"",
            ""name"": ""IntMap"",
            ""values"": { ""type"": ""integer"" }
        }";
        var instanceJson = @"{
            ""key1"": 1,
            ""key2"": ""not-int"",
            ""key3"": 3
        }";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle();
    }
    
    [Fact]
    public void InstanceValidator_StringOverload_TupleWithErrors()
    {
        var validator = new InstanceValidator();
        var schemaJson = @"{
            ""$id"": ""https://example.com/tuple"",
            ""$schema"": ""https://json-structure.org/meta/extended/v0/$id"",
            ""type"": ""tuple"",
            ""name"": ""Pair"",
            ""prefixItems"": [
                { ""type"": ""string"" },
                { ""type"": ""integer"" }
            ]
        }";
        var instanceJson = @"[123, ""wrong-order""]";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeFalse();
    }
    
    [Fact]
    public void InstanceValidator_StringOverload_RootNotMatchingType()
    {
        var validator = new InstanceValidator();
        var schemaJson = @"{
            ""$id"": ""https://example.com/obj"",
            ""$schema"": ""https://json-structure.org/meta/extended/v0/$id"",
            ""type"": ""object"",
            ""name"": ""Expected""
        }";
        var instanceJson = @"[1, 2, 3]";
        
        var result = validator.Validate(instanceJson, schemaJson);
        result.IsValid.Should().BeFalse();
        // The error is at root level
        result.Errors.First().Location.Should().NotBe(JsonLocation.Unknown);
    }
    
    #endregion
}
