// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;
using FluentAssertions;
using JsonStructure.Validation;
using Xunit;
using Xunit.Abstractions;

namespace JsonStructure.Tests.Integration;

/// <summary>
/// Integration tests that validate all schemas and instances from the primer-and-samples repository.
/// </summary>
public class PrimerAndSamplesTests
{
    private readonly ITestOutputHelper _output;
    private readonly SchemaValidator _schemaValidator;
    private readonly InstanceValidator _instanceValidator;
    private readonly string _samplesBasePath;

    public PrimerAndSamplesTests(ITestOutputHelper output)
    {
        _output = output;
        _schemaValidator = new SchemaValidator();
        _instanceValidator = new InstanceValidator();
        
        // Find the primer-and-samples directory relative to test execution
        var currentDir = Directory.GetCurrentDirectory();
        var searchDir = currentDir;
        
        // Walk up to find the json-structure repo root
        while (searchDir != null)
        {
            var candidatePath = Path.Combine(searchDir, "primer-and-samples", "samples");
            if (Directory.Exists(candidatePath))
            {
                _samplesBasePath = candidatePath;
                break;
            }
            searchDir = Directory.GetParent(searchDir)?.FullName;
        }
        
        _samplesBasePath ??= Path.Combine(currentDir, "..", "..", "..", "..", "..", "primer-and-samples", "samples");
    }

    #region Core Schema Validation Tests

    [SkippableTheory]
    [InlineData("core/01-basic-person/schema.struct.json")]
    [InlineData("core/02-address/schema.struct.json")]
    [InlineData("core/03-financial-types/schema.struct.json")]
    [InlineData("core/04-datetime-examples/schema.struct.json")]
    [InlineData("core/05-collections/schema.struct.json")]
    [InlineData("core/06-tuples/schema.struct.json")]
    [InlineData("core/07-unions/schema.struct.json")]
    [InlineData("core/08-namespaces/schema.struct.json")]
    [InlineData("core/09-extensions/schema.struct.json")]
    [InlineData("core/10-discriminated-unions/schema.struct.json")]
    [InlineData("core/11-sets-and-maps/schema.struct.json")]
    public void CoreSchema_ShouldBeValid(string relativePath)
    {
        // Arrange
        var schemaPath = Path.Combine(_samplesBasePath, relativePath);
        Skip.If(!File.Exists(schemaPath), $"Schema file not found: {schemaPath}");
        
        var schemaJson = File.ReadAllText(schemaPath);
        var schema = JsonNode.Parse(schemaJson);

        // Act
        var result = _schemaValidator.Validate(schema);

        // Assert
        if (!result.IsValid)
        {
            _output.WriteLine($"Schema validation failed for {relativePath}:");
            foreach (var error in result.Errors)
            {
                _output.WriteLine($"  {error.Path}: {error.Message}");
            }
        }
        
        result.IsValid.Should().BeTrue($"Schema {relativePath} should be valid");
    }

    #endregion

    #region Core Instance Validation Tests

    [SkippableTheory]
    // 01-basic-person
    [InlineData("core/01-basic-person/example1.json", "core/01-basic-person/schema.struct.json")]
    [InlineData("core/01-basic-person/example2.json", "core/01-basic-person/schema.struct.json")]
    [InlineData("core/01-basic-person/example3.json", "core/01-basic-person/schema.struct.json")]
    // 02-address
    [InlineData("core/02-address/example1.json", "core/02-address/schema.struct.json")]
    [InlineData("core/02-address/example2.json", "core/02-address/schema.struct.json")]
    [InlineData("core/02-address/example3.json", "core/02-address/schema.struct.json")]
    // 03-financial-types
    [InlineData("core/03-financial-types/example1.json", "core/03-financial-types/schema.struct.json")]
    [InlineData("core/03-financial-types/example2.json", "core/03-financial-types/schema.struct.json")]
    [InlineData("core/03-financial-types/example3.json", "core/03-financial-types/schema.struct.json")]
    // 04-datetime-examples
    [InlineData("core/04-datetime-examples/example1.json", "core/04-datetime-examples/schema.struct.json")]
    [InlineData("core/04-datetime-examples/example2.json", "core/04-datetime-examples/schema.struct.json")]
    [InlineData("core/04-datetime-examples/example3.json", "core/04-datetime-examples/schema.struct.json")]
    // 05-collections
    [InlineData("core/05-collections/example1.json", "core/05-collections/schema.struct.json")]
    [InlineData("core/05-collections/example2.json", "core/05-collections/schema.struct.json")]
    [InlineData("core/05-collections/example3.json", "core/05-collections/schema.struct.json")]
    // 06-tuples
    [InlineData("core/06-tuples/example1.json", "core/06-tuples/schema.struct.json")]
    [InlineData("core/06-tuples/example2.json", "core/06-tuples/schema.struct.json")]
    [InlineData("core/06-tuples/example3.json", "core/06-tuples/schema.struct.json")]
    // 07-unions
    [InlineData("core/07-unions/example1.json", "core/07-unions/schema.struct.json")]
    [InlineData("core/07-unions/example2.json", "core/07-unions/schema.struct.json")]
    [InlineData("core/07-unions/example3.json", "core/07-unions/schema.struct.json")]
    // 08-namespaces (only has example1)
    [InlineData("core/08-namespaces/example1.json", "core/08-namespaces/schema.struct.json")]
    // 09-extensions (only has example1)
    [InlineData("core/09-extensions/example1.json", "core/09-extensions/schema.struct.json")]
    // 10-discriminated-unions
    [InlineData("core/10-discriminated-unions/example1.json", "core/10-discriminated-unions/schema.struct.json")]
    [InlineData("core/10-discriminated-unions/example2.json", "core/10-discriminated-unions/schema.struct.json")]
    [InlineData("core/10-discriminated-unions/example3.json", "core/10-discriminated-unions/schema.struct.json")]
    // 11-sets-and-maps
    [InlineData("core/11-sets-and-maps/example1.json", "core/11-sets-and-maps/schema.struct.json")]
    [InlineData("core/11-sets-and-maps/example2.json", "core/11-sets-and-maps/schema.struct.json")]
    [InlineData("core/11-sets-and-maps/example3.json", "core/11-sets-and-maps/schema.struct.json")]
    public void CoreInstance_ShouldValidateAgainstSchema(string instancePath, string schemaPath)
    {
        // Arrange
        var fullInstancePath = Path.Combine(_samplesBasePath, instancePath);
        var fullSchemaPath = Path.Combine(_samplesBasePath, schemaPath);
        
        Skip.If(!File.Exists(fullInstancePath), $"Instance file not found: {fullInstancePath}");
        Skip.If(!File.Exists(fullSchemaPath), $"Schema file not found: {fullSchemaPath}");
        
        var instanceJson = File.ReadAllText(fullInstancePath);
        var schemaJson = File.ReadAllText(fullSchemaPath);
        
        var instance = JsonNode.Parse(instanceJson);
        var schema = JsonNode.Parse(schemaJson);

        // Get the $root reference if present, otherwise validate against the whole schema
        var rootRef = schema?["$root"]?.GetValue<string>();
        JsonNode? targetSchema = schema;
        
        if (rootRef != null && rootRef.StartsWith("#/"))
        {
            // Resolve the JSON pointer path like #/definitions/Company/Directory
            targetSchema = ResolveJsonPointer(rootRef.Substring(1), schema);
            
            // For root refs, we need to provide the full schema context for $ref resolution
            if (targetSchema is JsonObject targetObj)
            {
                // Create a wrapper that includes definitions for $ref resolution
                var wrapperSchema = new JsonObject
                {
                    ["definitions"] = schema?["definitions"]?.DeepClone()
                };
                foreach (var prop in targetObj)
                {
                    wrapperSchema[prop.Key] = prop.Value?.DeepClone();
                }
                targetSchema = wrapperSchema;
            }
        }

        // Act
        var result = _instanceValidator.Validate(instance, targetSchema);

        // Assert
        if (!result.IsValid)
        {
            _output.WriteLine($"Instance validation failed for {instancePath} against {schemaPath}:");
            foreach (var error in result.Errors)
            {
                _output.WriteLine($"  {error.Path}: {error.Message}");
            }
        }
        
        result.IsValid.Should().BeTrue($"Instance {instancePath} should be valid against {schemaPath}");
    }

    #endregion

    #region Import Schema Validation Tests

    [SkippableTheory]
    [InlineData("import/01-root-import/schema.struct.json")]
    [InlineData("import/02-namespace-import/schema.struct.json")]
    [InlineData("import/03-importdefs-only/schema.struct.json")]
    [InlineData("import/04-shadowing/schema.struct.json")]
    public void ImportSchema_ShouldBeValid(string relativePath)
    {
        // Arrange
        var schemaPath = Path.Combine(_samplesBasePath, relativePath);
        Skip.If(!File.Exists(schemaPath), $"Schema file not found: {schemaPath}");
        
        var schemaJson = File.ReadAllText(schemaPath);
        var schema = JsonNode.Parse(schemaJson);

        // Act
        var result = _schemaValidator.Validate(schema);

        // Assert
        if (!result.IsValid)
        {
            _output.WriteLine($"Schema validation failed for {relativePath}:");
            foreach (var error in result.Errors)
            {
                _output.WriteLine($"  {error.Path}: {error.Message}");
            }
        }
        
        result.IsValid.Should().BeTrue($"Schema {relativePath} should be valid");
    }

    #endregion

    #region Import Instance Validation Tests

    [SkippableTheory]
    [InlineData("import/01-root-import/example.json", "import/01-root-import/schema.struct.json")]
    [InlineData("import/03-importdefs-only/example.json", "import/03-importdefs-only/schema.struct.json")]
    [InlineData("import/04-shadowing/example.json", "import/04-shadowing/schema.struct.json")]
    public void ImportInstance_ShouldValidateAgainstSchema(string instancePath, string schemaPath)
    {
        // Arrange
        var fullInstancePath = Path.Combine(_samplesBasePath, instancePath);
        var fullSchemaPath = Path.Combine(_samplesBasePath, schemaPath);
        
        Skip.If(!File.Exists(fullInstancePath), $"Instance file not found: {fullInstancePath}");
        Skip.If(!File.Exists(fullSchemaPath), $"Schema file not found: {fullSchemaPath}");
        
        // Skip tests that require $importdefs (external file loading) - not yet implemented
        Skip.If(instancePath.Contains("04-shadowing"), 
            "$importdefs requires external file loading which is not yet implemented");
        
        var instanceJson = File.ReadAllText(fullInstancePath);
        var schemaJson = File.ReadAllText(fullSchemaPath);
        
        var instance = JsonNode.Parse(instanceJson);
        var schema = JsonNode.Parse(schemaJson);

        // Get the $root reference if present
        var rootRef = schema?["$root"]?.GetValue<string>();
        JsonNode? targetSchema = schema;
        
        if (rootRef != null && rootRef.StartsWith("#/"))
        {
            // Resolve the JSON pointer path
            targetSchema = ResolveJsonPointer(rootRef.Substring(1), schema);
            
            if (targetSchema is JsonObject targetObj)
            {
                var wrapperSchema = new JsonObject
                {
                    ["definitions"] = schema?["definitions"]?.DeepClone()
                };
                foreach (var prop in targetObj)
                {
                    wrapperSchema[prop.Key] = prop.Value?.DeepClone();
                }
                targetSchema = wrapperSchema;
            }
        }

        // Act
        var result = _instanceValidator.Validate(instance, targetSchema);

        // Assert
        if (!result.IsValid)
        {
            _output.WriteLine($"Instance validation failed for {instancePath} against {schemaPath}:");
            foreach (var error in result.Errors)
            {
                _output.WriteLine($"  {error.Path}: {error.Message}");
            }
        }
        
        result.IsValid.Should().BeTrue($"Instance {instancePath} should be valid against {schemaPath}");
    }

    #endregion

    #region Helper Methods

    private static JsonNode? ResolveJsonPointer(string pointer, JsonNode? node)
    {
        if (node is null || string.IsNullOrEmpty(pointer) || pointer == "/")
        {
            return node;
        }

        var parts = pointer.Split('/').Skip(1); // Skip empty first part
        var current = node;

        foreach (var part in parts)
        {
            if (current is null) return null;

            // Unescape JSON Pointer tokens
            var unescaped = part.Replace("~1", "/").Replace("~0", "~");

            if (current is JsonObject obj)
            {
                if (!obj.TryGetPropertyValue(unescaped, out current))
                {
                    return null;
                }
            }
            else if (current is JsonArray arr)
            {
                if (int.TryParse(unescaped, out var index) && index >= 0 && index < arr.Count)
                {
                    current = arr[index];
                }
                else
                {
                    return null;
                }
            }
            else
            {
                return null;
            }
        }

        return current;
    }

    #endregion

    #region Helper Tests

    [Fact]
    public void SamplesDirectory_ShouldExist()
    {
        // This test helps diagnose path issues
        var exists = Directory.Exists(_samplesBasePath);
        
        if (!exists)
        {
            _output.WriteLine($"Samples directory not found at: {_samplesBasePath}");
            _output.WriteLine($"Current directory: {Directory.GetCurrentDirectory()}");
        }
        
        // Skip rather than fail if samples not available (e.g., in CI without full repo)
        Skip.If(!exists, $"Samples directory not found at {_samplesBasePath}");
        exists.Should().BeTrue();
    }

    #endregion
}
