// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;
using JsonStructure.Validation;
using Shouldly;
using Xunit;

namespace JsonStructure.Tests.Validation;

public class UcumUnitValidationTests
{
    private readonly SchemaValidator _validator = new();

    private static JsonObject CreateUcumUnitSchema(string type, JsonNode ucumUnit)
    {
        return new JsonObject
        {
            ["$schema"] = "https://json-structure.org/meta/extended/v0/#",
            ["$id"] = $"urn:example:ucum-{type}",
            ["name"] = $"{type}WithUcumUnit",
            ["$uses"] = new JsonArray("JSONStructureUnits"),
            ["type"] = type,
            ["ucumUnit"] = ucumUnit,
        };
    }

    [Fact]
    public void Validate_NumericTypeWithUcumUnit_ReturnsSuccess()
    {
        var result = _validator.Validate(CreateUcumUnitSchema("number", JsonValue.Create("m")!));

        result.IsValid.ShouldBeTrue();
        result.Errors.ShouldBeEmpty();
    }

    [Fact]
    public void Validate_NumericTypeWithUnitAndUcumUnit_ReturnsSuccess()
    {
        var schema = CreateUcumUnitSchema("number", JsonValue.Create("m")!);
        schema["unit"] = "meter";

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Errors.ShouldBeEmpty();
    }

    [Theory]
    [InlineData("int32")]
    [InlineData("float")]
    [InlineData("double")]
    [InlineData("decimal")]
    public void Validate_ExtendedNumericTypeWithUcumUnit_ReturnsSuccess(string type)
    {
        var result = _validator.Validate(CreateUcumUnitSchema(type, JsonValue.Create("m")!));

        result.IsValid.ShouldBeTrue();
        result.Errors.ShouldBeEmpty();
    }

    [Fact(Skip = "Pending ucumUnit keyword enforcement in the .NET schema validator")]
    public void Validate_NonNumericTypeWithUcumUnit_ReturnsError()
    {
        var result = _validator.Validate(CreateUcumUnitSchema("string", JsonValue.Create("m")!));

        result.IsValid.ShouldBeFalse();
    }

    [Fact(Skip = "Pending ucumUnit keyword enforcement in the .NET schema validator")]
    public void Validate_NumericUcumUnitValue_ReturnsError()
    {
        var result = _validator.Validate(CreateUcumUnitSchema("number", JsonValue.Create(42)!));

        result.IsValid.ShouldBeFalse();
    }

    [Fact(Skip = "Pending ucumUnit keyword enforcement in the .NET schema validator")]
    public void Validate_ArrayUcumUnitValue_ReturnsError()
    {
        var result = _validator.Validate(CreateUcumUnitSchema("number", new JsonArray("m")));

        result.IsValid.ShouldBeFalse();
    }

    [Fact(Skip = "Pending ucumUnit keyword enforcement in the .NET schema validator")]
    public void Validate_ObjectUcumUnitValue_ReturnsError()
    {
        var result = _validator.Validate(CreateUcumUnitSchema("number", new JsonObject { ["code"] = "m" }));

        result.IsValid.ShouldBeFalse();
    }
}
