// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;
using FluentAssertions;
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
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" },
                ["age"] = new JsonObject { ["type"] = "int32" }
            },
            ["required"] = new JsonArray { "name" }
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeTrue();
        result.Errors.Should().BeEmpty();
    }

    [Fact]
    public void Validate_InvalidType_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "invalid-type"
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle()
            .Which.Message.Should().Contain("Invalid type");
    }

    [Fact]
    public void Validate_BooleanSchema_ReturnsSuccess()
    {
        var trueSchema = JsonValue.Create(true);
        var falseSchema = JsonValue.Create(false);

        _validator.Validate(trueSchema).IsValid.Should().BeTrue();
        _validator.Validate(falseSchema).IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_NullSchema_ReturnsError()
    {
        var result = _validator.Validate((JsonNode?)null);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle()
            .Which.Message.Should().Contain("cannot be null");
    }

    [Fact]
    public void Validate_ArraySchema_ValidatesItems()
    {
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "string" },
            ["minItems"] = 1,
            ["maxItems"] = 10
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_NegativeMinItems_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "array",
            ["items"] = new JsonObject { ["type"] = "string" },
            ["minItems"] = -1
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle()
            .Which.Message.Should().Contain("non-negative");
    }

    [Fact]
    public void Validate_InvalidPattern_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["pattern"] = "[invalid regex("
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle()
            .Which.Message.Should().Contain("regular expression");
    }

    [Fact]
    public void Validate_ValidDefs_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["$defs"] = new JsonObject
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
            ["$ref"] = "#/$defs/Address"
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_AllPrimitiveTypes_ReturnsSuccess()
    {
        foreach (var type in SchemaValidator.PrimitiveTypes)
        {
            var schema = new JsonObject { ["type"] = type };
            var result = _validator.Validate(schema);
            result.IsValid.Should().BeTrue($"Type '{type}' should be valid");
        }
    }

    [Fact]
    public void Validate_AllCompoundTypes_ReturnsSuccess()
    {
        foreach (var type in SchemaValidator.CompoundTypes)
        {
            var schema = new JsonObject { ["type"] = type };
            
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
                schema["prefixItems"] = new JsonArray
                {
                    new JsonObject { ["type"] = "string" }
                };
            }
            else if (type == "choice")
            {
                schema["options"] = new JsonObject
                {
                    ["opt1"] = new JsonObject { ["type"] = "string" }
                };
            }
            
            var result = _validator.Validate(schema);
            result.IsValid.Should().BeTrue($"Type '{type}' should be valid");
        }
    }

    [Fact]
    public void Validate_ConditionalComposition_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["allOf"] = new JsonArray
            {
                new JsonObject { ["type"] = "object" },
                new JsonObject { ["required"] = new JsonArray { "id" } }
            }
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_EmptyAllOf_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["allOf"] = new JsonArray()
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle()
            .Which.Message.Should().Contain("cannot be empty");
    }

    [Fact]
    public void Validate_ChoiceSchema_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "choice",
            ["discriminator"] = "type",
            ["options"] = new JsonObject
            {
                ["dog"] = new JsonObject { ["type"] = "object" },
                ["cat"] = new JsonObject { ["type"] = "object" }
            }
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_MapSchema_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "map",
            ["values"] = new JsonObject { ["type"] = "int32" }
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_TupleSchema_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "tuple",
            ["prefixItems"] = new JsonArray
            {
                new JsonObject { ["type"] = "string" },
                new JsonObject { ["type"] = "int32" },
                new JsonObject { ["type"] = "boolean" }
            },
            ["items"] = false
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_EnumSchema_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["enum"] = new JsonArray { "red", "green", "blue" }
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_EmptyEnum_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "string",
            ["enum"] = new JsonArray()
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle()
            .Which.Message.Should().Contain("cannot be empty");
    }

    [Fact]
    public void Validate_NumericConstraints_ReturnsSuccess()
    {
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["minimum"] = 0,
            ["maximum"] = 100,
            ["multipleOf"] = 5
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeTrue();
    }

    [Fact]
    public void Validate_InvalidMultipleOf_ReturnsError()
    {
        var schema = new JsonObject
        {
            ["type"] = "number",
            ["multipleOf"] = -5
        };

        var result = _validator.Validate(schema);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle()
            .Which.Message.Should().Contain("positive");
    }
}
