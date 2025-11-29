// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.IO;
using System.Text.Json.Nodes;
using FluentAssertions;
using JsonStructure.Validation;
using Xunit;

namespace JsonStructure.Tests.Validation;

public class MetaSchemaTests
{
    private static readonly string MetaDir = Path.Combine("..", "..", "..", "..", "..", "..", "meta");

    private static JsonNode LoadSchema(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var json = File.ReadAllText(fullPath);
        return JsonNode.Parse(json)!;
    }

    [Fact]
    public void CoreMetaschema_ValidatesWithoutErrors()
    {
        var coreSchema = LoadSchema(Path.Combine(MetaDir, "core", "v0", "index.json"));
        var extendedSchema = LoadSchema(Path.Combine(MetaDir, "extended", "v0", "index.json"));
        var validationSchema = LoadSchema(Path.Combine(MetaDir, "validation", "v0", "index.json"));

        var externalSchemas = new Dictionary<string, JsonNode>
        {
            [coreSchema["$id"]!.GetValue<string>()] = coreSchema,
            [extendedSchema["$id"]!.GetValue<string>()] = extendedSchema,
            [validationSchema["$id"]!.GetValue<string>()] = validationSchema
        };

        var validator = new SchemaValidator(new ValidationOptions
        {
            AllowDollar = true,
            AllowImport = true,
            ExternalSchemas = externalSchemas
        });

        // Reload fresh copy
        var schema = LoadSchema(Path.Combine(MetaDir, "core", "v0", "index.json"));
        var result = validator.Validate(schema);

        if (!result.IsValid)
        {
            foreach (var error in result.Errors)
            {
                Console.WriteLine($"Error: {error.Message} at {error.Path}");
            }
        }

        result.IsValid.Should().BeTrue();
        result.Errors.Should().BeEmpty();
    }

    [Fact]
    public void ExtendedMetaschema_ValidatesWithoutErrors()
    {
        var coreSchema = LoadSchema(Path.Combine(MetaDir, "core", "v0", "index.json"));
        var extendedSchema = LoadSchema(Path.Combine(MetaDir, "extended", "v0", "index.json"));
        var validationSchema = LoadSchema(Path.Combine(MetaDir, "validation", "v0", "index.json"));

        var externalSchemas = new Dictionary<string, JsonNode>
        {
            [coreSchema["$id"]!.GetValue<string>()] = coreSchema,
            [extendedSchema["$id"]!.GetValue<string>()] = extendedSchema,
            [validationSchema["$id"]!.GetValue<string>()] = validationSchema
        };

        var validator = new SchemaValidator(new ValidationOptions
        {
            AllowDollar = true,
            AllowImport = true,
            ExternalSchemas = externalSchemas
        });

        // Reload fresh copy
        var schema = LoadSchema(Path.Combine(MetaDir, "extended", "v0", "index.json"));
        var result = validator.Validate(schema);

        if (!result.IsValid)
        {
            foreach (var error in result.Errors)
            {
                Console.WriteLine($"Error: {error.Message} at {error.Path}");
            }
        }

        result.IsValid.Should().BeTrue();
        result.Errors.Should().BeEmpty();
    }

    [Fact]
    public void ValidationMetaschema_ValidatesWithoutErrors()
    {
        var coreSchema = LoadSchema(Path.Combine(MetaDir, "core", "v0", "index.json"));
        var extendedSchema = LoadSchema(Path.Combine(MetaDir, "extended", "v0", "index.json"));
        var validationSchema = LoadSchema(Path.Combine(MetaDir, "validation", "v0", "index.json"));

        var externalSchemas = new Dictionary<string, JsonNode>
        {
            [coreSchema["$id"]!.GetValue<string>()] = coreSchema,
            [extendedSchema["$id"]!.GetValue<string>()] = extendedSchema,
            [validationSchema["$id"]!.GetValue<string>()] = validationSchema
        };

        var validator = new SchemaValidator(new ValidationOptions
        {
            AllowDollar = true,
            AllowImport = true,
            ExternalSchemas = externalSchemas
        });

        // Reload fresh copy
        var schema = LoadSchema(Path.Combine(MetaDir, "validation", "v0", "index.json"));
        var result = validator.Validate(schema);

        if (!result.IsValid)
        {
            foreach (var error in result.Errors)
            {
                Console.WriteLine($"Error: {error.Message} at {error.Path}");
            }
        }

        result.IsValid.Should().BeTrue();
        result.Errors.Should().BeEmpty();
    }

    [Fact]
    public void CoreMetaschema_HasExpectedDefinitions()
    {
        var schema = LoadSchema(Path.Combine(MetaDir, "core", "v0", "index.json"));

        schema["definitions"].Should().NotBeNull();
        var defs = schema["definitions"] as JsonObject;
        
        defs!["SchemaDocument"].Should().NotBeNull();
        defs["ObjectType"].Should().NotBeNull();
        defs["Property"].Should().NotBeNull();
    }

    [Fact]
    public void ExtendedMetaschema_ImportsCore()
    {
        var schema = LoadSchema(Path.Combine(MetaDir, "extended", "v0", "index.json"));

        schema["$import"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/core/v0/#");
    }

    [Fact]
    public void ValidationMetaschema_ImportsExtended()
    {
        var schema = LoadSchema(Path.Combine(MetaDir, "validation", "v0", "index.json"));

        schema["$import"]!.GetValue<string>().Should().Be("https://json-structure.org/meta/extended/v0/#");
    }
}
