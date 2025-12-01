// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;
using FluentAssertions;
using JsonStructure.Validation;
using Xunit;

namespace JsonStructure.Tests.Validation;

public class InstanceValidatorTests
{
    private readonly InstanceValidator _validator;

    public InstanceValidatorTests()
    {
        _validator = new InstanceValidator();
    }

    [Fact]
    public void Validate_StringType_ValidInstance_ReturnsSuccess()
    {
        var schema = new JsonObject { ["type"] = "string" };
        var instance = JsonValue.Create("hello");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_StringType_InvalidInstance_ReturnsError()
    {
        var schema = new JsonObject { ["type"] = "string" };
        var instance = JsonValue.Create(42);

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceStringExpected);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("string");
    }

    [Fact]
    public void Validate_BooleanType_ValidInstance_ReturnsSuccess()
    {
        var schema = new JsonObject { ["type"] = "boolean" };
        var instance = JsonValue.Create(true);

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_NullType_ValidInstance_ReturnsSuccess()
    {
        var schema = new JsonObject { ["type"] = "null" };
        JsonNode? instance = null;

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_ObjectWithProperties_ValidInstance_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" },
                ["age"] = new JsonObject { ["type"] = "int32" }
            }
        };

        var instance = new JsonObject
        {
            ["name"] = "John",
            ["age"] = 30
        };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_ObjectWithRequired_MissingProperty_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" }
            },
            ["required"] = new JsonArray { "name" }
        };

        var instance = new JsonObject();

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceRequiredPropertyMissing);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("required");
    }

    [Fact]
    public void Validate_Array_ValidInstance_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "int32" }
        };

        var instance = new JsonArray { 1, 2, 3, 4, 5 };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Array_InvalidItem_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "int32" }
        };

        var instance = new JsonArray { 1, "not a number", 3 };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceStringNotExpected);
        error.Path.Should().Be("/1");
    }

    [Fact]
    public void Validate_ArrayMinItems_TooFew_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["minItems"] = 3
        };

        var instance = new JsonArray { 1, 2 };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceMinItems);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("minimum");
    }

    [Fact]
    public void Validate_StringMinLength_TooShort_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["minLength"] = 5
        };

        var instance = JsonValue.Create("hi");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceStringMinLength);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("minimum");
    }

    [Fact]
    public void Validate_StringPattern_Matches_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["pattern"] = @"^\d{3}-\d{4}$"
        };

        var instance = JsonValue.Create("123-4567");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_StringPattern_NoMatch_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["pattern"] = @"^\d{3}-\d{4}$"
        };

        var instance = JsonValue.Create("12-34567");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceStringPatternMismatch);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("pattern");
    }

    [Fact]
    public void Validate_NumberMinimum_TooLow_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["minimum"] = 10
        };

        var instance = JsonValue.Create(5);

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceNumberMinimum);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("minimum");
    }

    [Fact]
    public void Validate_Enum_ValidValue_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["enum"] = new JsonArray { "red", "green", "blue" }
        };

        var instance = JsonValue.Create("green");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Enum_InvalidValue_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["enum"] = new JsonArray { "red", "green", "blue" }
        };

        var instance = JsonValue.Create("yellow");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceEnumMismatch);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("enum");
    }

    [Fact]
    public void Validate_Const_Matches_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["const"] = "fixed-value"
        };

        var instance = JsonValue.Create("fixed-value");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Const_NoMatch_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["const"] = "fixed-value"
        };

        var instance = JsonValue.Create("other-value");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceConstMismatch);
        error.Path.Should().BeEmpty();
    }

    [Fact]
    public void Validate_Ref_ResolvesLocal_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["definitions"] = new JsonObject
            {
                ["Name"] = new JsonObject { ["type"] = "string" }
            },
            ["type"] = new JsonObject { ["$ref"] = "#/definitions/Name" }
        };

        var instance = JsonValue.Create("John");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_AllOf_AllMatch_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["allOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "object" },
                new JsonObject 
                { 
                    ["properties"] = new JsonObject
                    {
                        ["id"] = new JsonObject { ["type"] = "int32" }
                    }
                }
            }
        };

        var instance = new JsonObject { ["id"] = 1 };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_AnyOf_OneMatches_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["anyOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "int32" }
            }
        };

        var instance = JsonValue.Create(42);

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_AnyOf_NoneMatch_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["anyOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "int32" }
            }
        };

        var instance = JsonValue.Create(true);

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceAnyOfNoneMatched);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("anyOf");
    }

    [Fact]
    public void Validate_NestedProperty_InvalidValue_ReturnsCorrectPath()
    {
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["address"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["city"] = new JsonObject { ["type"] = "string" }
                    }
                }
            }
        };

        var instance = new JsonObject
        {
            ["address"] = new JsonObject
            {
                ["city"] = 12345 // Should be string, not number
            }
        };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceStringExpected);
        error.Path.Should().Be("/address/city");
    }

    [Fact]
    public void Validate_ArrayItem_InvalidValue_ReturnsCorrectPath()
    {
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "int32" }
        };

        var instance = new JsonArray { 1, 2, "not a number", 4 };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceStringNotExpected);
        error.Path.Should().Be("/2"); // Third item (0-indexed)
    }

    [Fact]
    public void Validate_OneOf_ExactlyOneMatches_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["oneOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "int32" }
            }
        };

        var instance = JsonValue.Create("hello");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Not_NoMatch_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["not"] = new JsonObject { ["type"] = "string" }
        };

        var instance = JsonValue.Create(42);

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Not_Matches_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["not"] = new JsonObject { ["type"] = "string" }
        };

        var instance = JsonValue.Create("hello");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceNotMatched);
        error.Path.Should().BeEmpty();
    }

    [Fact]
    public void Validate_IfThenElse_IfTrue_ValidatesThen()
    {
        var schema = new JsonObject
        {
            ["if"] = new JsonObject
            {
                ["properties"] = new JsonObject
                {
                    ["type"] = new JsonObject { ["const"] = "premium" }
                },
                ["required"] = new JsonArray { "type" }
            },
            ["then"] = new JsonObject
            {
                ["properties"] = new JsonObject
                {
                    ["discount"] = new JsonObject { ["minimum"] = 10 }
                },
                ["required"] = new JsonArray { "discount" }
            }
        };

        var instance = new JsonObject
        {
            ["type"] = "premium",
            ["discount"] = 5 // Less than minimum
        };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceNumberMinimum);
        error.Path.Should().Be("/discount");
    }

    [Fact]
    public void Validate_Date_ValidFormat_ReturnsSuccess()
    {
        var schema = new JsonObject { ["type"] = "date" };
        var instance = JsonValue.Create("2024-06-15");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Date_InvalidFormat_ReturnsError()
    {
        var schema = new JsonObject { ["type"] = "date" };
        var instance = JsonValue.Create("15-06-2024"); // Wrong format

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceDateFormatInvalid);
        error.Path.Should().BeEmpty();
    }

    [Fact]
    public void Validate_Uuid_ValidFormat_ReturnsSuccess()
    {
        var schema = new JsonObject { ["type"] = "uuid" };
        var instance = JsonValue.Create("550e8400-e29b-41d4-a716-446655440000");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Binary_ValidBase64_ReturnsSuccess()
    {
        var schema = new JsonObject { ["type"] = "binary" };
        var instance = JsonValue.Create("SGVsbG8gV29ybGQ="); // "Hello World" in base64

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Binary_InvalidBase64_ReturnsError()
    {
        var schema = new JsonObject { ["type"] = "binary" };
        var instance = JsonValue.Create("not-valid-base64!!!");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceBinaryEncodingInvalid);
        error.Path.Should().BeEmpty();
    }

    [Fact]
    public void Validate_BooleanSchemaTrue_AllowsEverything()
    {
        var schema = JsonValue.Create(true);
        var instance = new JsonObject { ["anything"] = "goes" };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_BooleanSchemaFalse_RejectsEverything()
    {
        var schema = JsonValue.Create(false);
        var instance = JsonValue.Create("anything");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceSchemaFalse);
        error.Path.Should().BeEmpty();
    }

    [Fact]
    public void Validate_Set_UniqueItems_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "set",
            ["items"] = new JsonObject { ["type"] = "int32" }
        };

        var instance = new JsonArray { 1, 2, 3 };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Set_DuplicateItems_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "set",
            ["items"] = new JsonObject { ["type"] = "int32" }
        };

        var instance = new JsonArray { 1, 2, 2, 3 };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceSetDuplicate);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("duplicate");
    }

    [Fact]
    public void Validate_Map_ValidEntries_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "int32" }
        };

        var instance = new JsonObject
        {
            ["a"] = 1,
            ["b"] = 2,
            ["c"] = 3
        };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Tuple_ValidPrefixItems_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "tuple",
            ["prefixItems"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "int32" }
            }
        };

        var instance = new JsonArray { "name", 42 };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_AdditionalPropertiesFalse_ExtraProperty_ReturnsError()
    {
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
            ["name"] = "John",
            ["extra"] = "not allowed"
        };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceAdditionalPropertyNotAllowed);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("Additional property");
    }

    [Fact]
    public void Validate_MultipleOf_Valid_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["multipleOf"] = 5
        };

        var instance = JsonValue.Create(15);

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_MultipleOf_Invalid_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["multipleOf"] = 5
        };

        var instance = JsonValue.Create(17);

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceNumberMultipleOf);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("multiple");
    }

    [Fact]
    public void Validate_Int64AsString_ValidInstance_ReturnsSuccess()
    {
        var schema = new JsonObject { ["type"] = "int64" };
        var instance = JsonValue.Create("9007199254740993"); // Beyond JS safe integer

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Duration_ValidISO8601_ReturnsSuccess()
    {
        var schema = new JsonObject { ["type"] = "duration" };
        var instance = JsonValue.Create("PT1H30M");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_JsonPointer_ValidFormat_ReturnsSuccess()
    {
        var schema = new JsonObject { ["type"] = "jsonpointer" };
        var instance = JsonValue.Create("/foo/bar/0");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_JsonPointer_InvalidFormat_ReturnsError()
    {
        var schema = new JsonObject { ["type"] = "jsonpointer" };
        var instance = JsonValue.Create("not-a-pointer"); // Doesn't start with /

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceJsonpointerFormatInvalid);
        error.Path.Should().BeEmpty();
    }

    [Fact]
    public void Validate_Time_ValidISOFormat_ReturnsSuccess()
    {
        var schema = new JsonObject { ["type"] = "time" };
        var instance = JsonValue.Create("09:00:00");

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_Time_InvalidFormat_ReturnsError()
    {
        var schema = new JsonObject { ["type"] = "time" };
        var instance = JsonValue.Create("9:00 AM");  // 12-hour format is not valid ISO time

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceTimeFormatInvalid);
        error.Path.Should().BeEmpty();
        error.Message.Should().Contain("time");
    }

    [Fact]
    public void Validate_MapWithTimeValues_InvalidTime_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["open"] = new JsonObject { ["type"] = "time" }
                }
            }
        };
        
        var instance = new JsonObject
        {
            ["monday"] = new JsonObject
            {
                ["open"] = "9:00 AM"  // Invalid time format
            }
        };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Code.Should().Be(ErrorCodes.InstanceTimeFormatInvalid);
        error.Path.Should().Be("/monday/open");
    }

    [Fact]
    public void Validate_WithStringOverload_ReturnsSourceLocation()
    {
        var schema = """{"type": "object", "properties": {"name": {"type": "string"}}}""";
        var instance = """
{
  "name": 123
}
""";

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Path.Should().Be("/name");
        error.Location.IsKnown.Should().BeTrue();
        error.Location.Line.Should().BeGreaterThan(0); // Line tracking is working
        error.Location.Column.Should().BeGreaterThan(0);
    }

    [Fact]
    public void Validate_WithJsonNodeOverload_ReturnsUnknownLocation()
    {
        var schema = new JsonObject { ["type"] = "string" };
        var instance = JsonValue.Create(42);

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        var error = result.Errors.Should().ContainSingle().Subject;
        error.Location.IsKnown.Should().BeFalse();
    }

    #region Multiple Errors Collection Tests

    [Fact]
    public void Validate_MultipleErrors_CollectsAllByDefault()
    {
        // Schema with multiple required properties
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" },
                ["age"] = new JsonObject { ["type"] = "int32" },
                ["email"] = new JsonObject { ["type"] = "string" }
            },
            ["required"] = new JsonArray { "name", "age", "email" }
        };
        
        // Instance missing all required properties
        var instance = new JsonObject();

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().HaveCount(3, "all three missing properties should be reported");
        result.Errors.Should().AllSatisfy(e => e.Code.Should().Be(ErrorCodes.InstanceRequiredPropertyMissing));
    }

    [Fact]
    public void Validate_MultipleErrors_StopsOnFirstWhenOptionSet()
    {
        var options = new ValidationOptions { StopOnFirstError = true };
        var validator = new InstanceValidator(options);
        
        // Use nested objects so errors occur in separate validation steps
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["level1"] = new JsonObject 
                { 
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["level2"] = new JsonObject { ["type"] = "string" }
                    },
                    ["required"] = new JsonArray { "level2" }
                }
            },
            ["required"] = new JsonArray { "level1" }
        };
        
        // Instance missing the first required property - should stop there
        var instance = new JsonObject();

        var result = validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        // With StopOnFirstError, it stops after the first validation step that produces an error
        result.Errors.Should().HaveCountLessOrEqualTo(1, "should stop after first error step");
    }

    [Fact]
    public void Validate_ArrayWithMultipleInvalidItems_CollectsAllErrors()
    {
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "int32" }
        };
        
        // Array with multiple invalid string items
        var instance = new JsonArray { "one", "two", "three" };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().HaveCount(3, "all three invalid items should be reported");
        result.Errors.Select(e => e.Path).Should().BeEquivalentTo(new[] { "/0", "/1", "/2" });
    }

    [Fact]
    public void Validate_NestedObjectsWithMultipleErrors_CollectsAllErrors()
    {
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["person"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["name"] = new JsonObject { ["type"] = "string" },
                        ["age"] = new JsonObject { ["type"] = "int32" }
                    },
                    ["required"] = new JsonArray { "name", "age" }
                }
            },
            ["required"] = new JsonArray { "person" }
        };
        
        // Instance with nested object missing both required properties
        var instance = new JsonObject
        {
            ["person"] = new JsonObject()
        };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().HaveCount(2, "both missing nested properties should be reported");
        result.Errors.Should().AllSatisfy(e => e.Path.Should().StartWith("/person"));
    }

    [Fact]
    public void Validate_MixedErrorTypes_CollectsAllErrors()
    {
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject 
                { 
                    ["type"] = "string",
                    ["minLength"] = 3
                },
                ["age"] = new JsonObject 
                { 
                    ["type"] = "int32",
                    ["minimum"] = 0
                }
            },
            ["required"] = new JsonArray { "name", "age" }
        };
        
        // Instance with wrong type for name and missing age
        var instance = new JsonObject
        {
            ["name"] = 123 // wrong type
            // age is missing
        };

        var result = _validator.Validate(instance, schema);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().HaveCountGreaterOrEqualTo(2, "at least type error and missing property should be reported");
        result.Errors.Select(e => e.Code).Should().Contain(ErrorCodes.InstanceRequiredPropertyMissing);
    }

    #endregion
}
