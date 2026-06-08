// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;
using JsonStructure.Validation;
using Shouldly;
using Xunit;

namespace JsonStructure.Tests.Validation;

public class RelationsValidationTests
{
    private readonly SchemaValidator _validator = new();

    private static JsonObject CreateRelationsSchema()
    {
        return new JsonObject
        {
            ["$schema"] = "https://json-structure.org/meta/extended/v0/#",
            ["$id"] = "urn:example:relations-schema",
            ["name"] = "Order",
            ["$uses"] = new JsonArray("JSONStructureRelations"),
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["id"] = new JsonObject { ["type"] = "string" },
                ["tenantId"] = new JsonObject { ["type"] = "string" },
                ["customerId"] = new JsonObject { ["type"] = "string" },
                ["itemIds"] = new JsonObject
                {
                    ["type"] = "array",
                    ["items"] = new JsonObject { ["type"] = "string" },
                },
                ["qualifier"] = new JsonObject { ["type"] = "string" },
            },
            ["definitions"] = new JsonObject
            {
                ["Customer"] = new JsonObject
                {
                    ["name"] = "Customer",
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["id"] = new JsonObject { ["type"] = "string" },
                    },
                },
                ["Item"] = new JsonObject
                {
                    ["name"] = "Item",
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["id"] = new JsonObject { ["type"] = "string" },
                    },
                },
                ["RelationQualifier"] = new JsonObject
                {
                    ["name"] = "RelationQualifier",
                    ["type"] = "string",
                },
            },
        };
    }

    [Fact]
    public void Validate_ObjectIdentityArray_ReturnsSuccess()
    {
        var schema = CreateRelationsSchema();
        schema["identity"] = new JsonArray("id", "tenantId");

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Errors.ShouldBeEmpty();
    }

    [Fact]
    public void Validate_RelationsDeclarations_ReturnsSuccess()
    {
        var schema = CreateRelationsSchema();
        schema["relations"] = new JsonObject
        {
            ["customer"] = new JsonObject
            {
                ["cardinality"] = "single",
                ["targettype"] = new JsonObject { ["$ref"] = "#/definitions/Customer" },
            },
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Errors.ShouldBeEmpty();
    }

    [Fact]
    public void Validate_SingleCardinalityRelationWithTargettypeRef_ReturnsSuccess()
    {
        var schema = CreateRelationsSchema();
        schema["relations"] = new JsonObject
        {
            ["customer"] = new JsonObject
            {
                ["cardinality"] = "single",
                ["targettype"] = new JsonObject { ["$ref"] = "#/definitions/Customer" },
            },
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Errors.ShouldBeEmpty();
    }

    [Fact]
    public void Validate_MultipleCardinalityRelationWithScope_ReturnsSuccess()
    {
        var schema = CreateRelationsSchema();
        schema["relations"] = new JsonObject
        {
            ["items"] = new JsonObject
            {
                ["cardinality"] = "multiple",
                ["targettype"] = new JsonObject { ["$ref"] = "#/definitions/Item" },
                ["scope"] = "line-items",
            },
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Errors.ShouldBeEmpty();
    }

    [Fact]
    public void Validate_RelationWithQualifierType_ReturnsSuccess()
    {
        var schema = CreateRelationsSchema();
        schema["relations"] = new JsonObject
        {
            ["qualifiedCustomer"] = new JsonObject
            {
                ["cardinality"] = "single",
                ["targettype"] = new JsonObject { ["$ref"] = "#/definitions/Customer" },
                ["qualifiertype"] = new JsonObject { ["$ref"] = "#/definitions/RelationQualifier" },
            },
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeTrue();
        result.Errors.ShouldBeEmpty();
    }

    [Fact]
    public void Validate_IdentityOnNonObjectType_ReturnsError()
    {
        var result = _validator.Validate(new JsonObject
        {
            ["$schema"] = "https://json-structure.org/meta/extended/v0/#",
            ["$id"] = "urn:example:identity-on-string",
            ["name"] = "IdentityOnString",
            ["$uses"] = new JsonArray("JSONStructureRelations"),
            ["type"] = "string",
            ["identity"] = new JsonArray("id"),
        });

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public void Validate_IdentityThatIsNotArray_ReturnsError()
    {
        var schema = CreateRelationsSchema();
        schema["identity"] = "id";

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public void Validate_IdentityWithUnknownProperty_ReturnsError()
    {
        var schema = CreateRelationsSchema();
        schema["identity"] = new JsonArray("missing");

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public void Validate_RelationsOnNonObjectType_ReturnsError()
    {
        var result = _validator.Validate(new JsonObject
        {
            ["$schema"] = "https://json-structure.org/meta/extended/v0/#",
            ["$id"] = "urn:example:relations-on-string",
            ["name"] = "RelationsOnString",
            ["$uses"] = new JsonArray("JSONStructureRelations"),
            ["type"] = "string",
            ["relations"] = new JsonObject(),
        });

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public void Validate_InvalidRelationCardinality_ReturnsError()
    {
        var schema = CreateRelationsSchema();
        schema["relations"] = new JsonObject
        {
            ["customer"] = new JsonObject
            {
                ["cardinality"] = "many",
                ["targettype"] = new JsonObject { ["$ref"] = "#/definitions/Customer" },
            },
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public void Validate_RelationMissingTargettype_ReturnsError()
    {
        var schema = CreateRelationsSchema();
        schema["relations"] = new JsonObject
        {
            ["customer"] = new JsonObject
            {
                ["cardinality"] = "single",
            },
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public void Validate_RelationMissingCardinality_ReturnsError()
    {
        var schema = CreateRelationsSchema();
        schema["relations"] = new JsonObject
        {
            ["customer"] = new JsonObject
            {
                ["targettype"] = new JsonObject { ["$ref"] = "#/definitions/Customer" },
            },
        };

        var result = _validator.Validate(schema);

        result.IsValid.ShouldBeFalse();
    }
}
