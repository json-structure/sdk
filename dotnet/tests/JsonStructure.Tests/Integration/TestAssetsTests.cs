// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;
using FluentAssertions;
using JsonStructure.Validation;
using Xunit;
using Xunit.Abstractions;

namespace JsonStructure.Tests.Integration;

/// <summary>
/// Integration tests that validate all schemas and instances from the sdk/test-assets directory.
/// These tests ensure that invalid schemas fail validation and invalid instances fail validation.
/// </summary>
public class TestAssetsTests
{
    private readonly ITestOutputHelper _output;
    private readonly SchemaValidator _schemaValidator;
    private readonly InstanceValidator _instanceValidator;
    private readonly string? _testAssetsPath;
    private readonly string? _samplesPath;
    
    /// <summary>
    /// Schema validation edge cases not yet implemented in the SchemaValidator.
    /// These represent future enhancements to the validator.
    /// </summary>
    private static readonly HashSet<string> KnownSchemaGaps = new()
    {
        // All schema validation gaps have been addressed
    };
    
    /// <summary>
    /// Instance validation edge cases not yet implemented in the InstanceValidator.
    /// These represent future enhancements to the validator.
    /// </summary>
    private static readonly HashSet<string> KnownInstanceGaps = new()
    {
        // All instance validation gaps have been addressed
    };

    public TestAssetsTests(ITestOutputHelper output)
    {
        _output = output;
        _schemaValidator = new SchemaValidator();
        _instanceValidator = new InstanceValidator();
        
        // Find the test-assets directory relative to test execution
        var currentDir = Directory.GetCurrentDirectory();
        var searchDir = currentDir;
        
        // Walk up to find the repository root (look for test-assets or dotnet folder)
        while (searchDir != null)
        {
            // Check for test-assets at this level (sdk repo structure)
            var testAssetsPath = Path.Combine(searchDir, "test-assets");
            if (Directory.Exists(testAssetsPath))
            {
                _testAssetsPath = testAssetsPath;
                // primer-and-samples is a sibling submodule in the sdk repo
                _samplesPath = Path.Combine(searchDir, "primer-and-samples", "samples", "core");
                break;
            }
            
            // Also check for sdk/test-assets (when running from a parent directory)
            var sdkTestAssetsPath = Path.Combine(searchDir, "sdk", "test-assets");
            if (Directory.Exists(sdkTestAssetsPath))
            {
                _testAssetsPath = sdkTestAssetsPath;
                _samplesPath = Path.Combine(searchDir, "primer-and-samples", "samples", "core");
                break;
            }
            
            searchDir = Directory.GetParent(searchDir)?.FullName;
        }
    }

    #region Invalid Schema Tests

    public static IEnumerable<object[]> GetInvalidSchemaFiles()
    {
        var currentDir = Directory.GetCurrentDirectory();
        var searchDir = currentDir;
        string? testAssetsPath = null;
        
        while (searchDir != null)
        {
            // Check for test-assets at this level (sdk repo structure)
            var candidatePath = Path.Combine(searchDir, "test-assets", "schemas", "invalid");
            if (Directory.Exists(candidatePath))
            {
                testAssetsPath = candidatePath;
                break;
            }
            
            // Also check for sdk/test-assets (when running from a parent directory)
            var sdkCandidatePath = Path.Combine(searchDir, "sdk", "test-assets", "schemas", "invalid");
            if (Directory.Exists(sdkCandidatePath))
            {
                testAssetsPath = sdkCandidatePath;
                break;
            }
            
            searchDir = Directory.GetParent(searchDir)?.FullName;
        }
        
        if (testAssetsPath == null || !Directory.Exists(testAssetsPath))
        {
            yield break;
        }
        
        foreach (var file in Directory.GetFiles(testAssetsPath, "*.struct.json"))
        {
            yield return new object[] { Path.GetFileName(file) };
        }
    }

    [SkippableTheory]
    [MemberData(nameof(GetInvalidSchemaFiles))]
    public void InvalidSchema_ShouldFailValidation(string schemaFileName)
    {
        // Arrange
        Skip.If(_testAssetsPath == null, "test-assets directory not found");
        Skip.If(KnownSchemaGaps.Contains(schemaFileName), $"Skipping {schemaFileName} - validation not yet implemented");
        
        var schemaPath = Path.Combine(_testAssetsPath, "schemas", "invalid", schemaFileName);
        Skip.If(!File.Exists(schemaPath), $"Schema file not found: {schemaPath}");
        
        var schemaJson = File.ReadAllText(schemaPath);
        var schema = JsonNode.Parse(schemaJson);
        var description = schema?["description"]?.GetValue<string>() ?? "No description";

        // Act
        var result = _schemaValidator.Validate(schema);

        // Assert
        _output.WriteLine($"Testing invalid schema: {schemaFileName}");
        _output.WriteLine($"Description: {description}");
        
        if (result.IsValid)
        {
            _output.WriteLine("WARNING: Schema passed validation but should have failed");
        }
        else
        {
            _output.WriteLine("Errors (expected):");
            foreach (var error in result.Errors)
            {
                _output.WriteLine($"  {error.Path}: {error.Message}");
            }
        }
        
        result.IsValid.Should().BeFalse($"Schema {schemaFileName} should be invalid. Description: {description}");
    }

    #endregion

    #region Invalid Instance Tests

    public static IEnumerable<object[]> GetInvalidInstanceFiles()
    {
        var currentDir = Directory.GetCurrentDirectory();
        var searchDir = currentDir;
        string? invalidInstancesPath = null;
        
        while (searchDir != null)
        {
            // Check for test-assets at this level (sdk repo structure)
            var candidatePath = Path.Combine(searchDir, "test-assets", "instances", "invalid");
            if (Directory.Exists(candidatePath))
            {
                invalidInstancesPath = candidatePath;
                break;
            }
            
            // Also check for sdk/test-assets (when running from a parent directory)
            var sdkCandidatePath = Path.Combine(searchDir, "sdk", "test-assets", "instances", "invalid");
            if (Directory.Exists(sdkCandidatePath))
            {
                invalidInstancesPath = sdkCandidatePath;
                break;
            }
            
            searchDir = Directory.GetParent(searchDir)?.FullName;
        }
        
        if (invalidInstancesPath == null || !Directory.Exists(invalidInstancesPath))
        {
            yield break;
        }
        
        foreach (var sampleDir in Directory.GetDirectories(invalidInstancesPath))
        {
            var sampleName = Path.GetFileName(sampleDir);
            foreach (var instanceFile in Directory.GetFiles(sampleDir, "*.json"))
            {
                yield return new object[] { sampleName, Path.GetFileName(instanceFile) };
            }
        }
    }

    [SkippableTheory]
    [MemberData(nameof(GetInvalidInstanceFiles))]
    public void InvalidInstance_ShouldFailValidation(string sampleName, string instanceFileName)
    {
        // Arrange
        Skip.If(_testAssetsPath == null, "test-assets directory not found");
        Skip.If(_samplesPath == null, "samples directory not found");
        
        var testKey = $"{sampleName}/{instanceFileName}";
        Skip.If(KnownInstanceGaps.Contains(testKey), $"Skipping {testKey} - validation not yet implemented");
        
        var instancePath = Path.Combine(_testAssetsPath, "instances", "invalid", sampleName, instanceFileName);
        var schemaPath = Path.Combine(_samplesPath, sampleName, "schema.struct.json");
        
        Skip.If(!File.Exists(instancePath), $"Instance file not found: {instancePath}");
        Skip.If(!File.Exists(schemaPath), $"Schema file not found: {schemaPath}");
        
        var instanceJson = File.ReadAllText(instancePath);
        var schemaJson = File.ReadAllText(schemaPath);
        
        var instance = JsonNode.Parse(instanceJson);
        var schema = JsonNode.Parse(schemaJson);
        
        var description = instance?["_description"]?.GetValue<string>() ?? "No description";
        
        // Remove metadata fields
        if (instance is JsonObject instanceObj)
        {
            var keysToRemove = instanceObj.Select(p => p.Key).Where(k => k.StartsWith("_")).ToList();
            foreach (var key in keysToRemove)
            {
                instanceObj.Remove(key);
            }
        }

        // Get the $root reference if present
        var rootRef = schema?["$root"]?.GetValue<string>();
        JsonNode? targetSchema = schema;
        
        if (rootRef != null && rootRef.StartsWith("#/"))
        {
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
        _output.WriteLine($"Testing invalid instance: {sampleName}/{instanceFileName}");
        _output.WriteLine($"Description: {description}");
        
        if (result.IsValid)
        {
            _output.WriteLine("WARNING: Instance passed validation but should have failed");
        }
        else
        {
            _output.WriteLine("Errors (expected):");
            foreach (var error in result.Errors)
            {
                _output.WriteLine($"  {error.Path}: {error.Message}");
            }
        }
        
        result.IsValid.Should().BeFalse(
            $"Instance {sampleName}/{instanceFileName} should be invalid. Description: {description}");
    }

    #endregion

    #region Summary Tests

    [SkippableFact]
    public void InvalidSchemasDirectory_ShouldExistAndHaveFiles()
    {
        Skip.If(_testAssetsPath == null, "test-assets directory not found");
        
        var invalidSchemasDir = Path.Combine(_testAssetsPath, "schemas", "invalid");
        var exists = Directory.Exists(invalidSchemasDir);
        
        Skip.If(!exists, $"Invalid schemas directory not found at {invalidSchemasDir}");
        
        var schemaFiles = Directory.GetFiles(invalidSchemasDir, "*.struct.json");
        _output.WriteLine($"Found {schemaFiles.Length} invalid schema files");
        
        schemaFiles.Should().NotBeEmpty("Invalid schemas directory should contain test files");
    }

    [SkippableFact]
    public void InvalidInstancesDirectory_ShouldExistAndHaveFiles()
    {
        Skip.If(_testAssetsPath == null, "test-assets directory not found");
        
        var invalidInstancesDir = Path.Combine(_testAssetsPath, "instances", "invalid");
        var exists = Directory.Exists(invalidInstancesDir);
        
        Skip.If(!exists, $"Invalid instances directory not found at {invalidInstancesDir}");
        
        var instanceCount = 0;
        foreach (var sampleDir in Directory.GetDirectories(invalidInstancesDir))
        {
            instanceCount += Directory.GetFiles(sampleDir, "*.json").Length;
        }
        
        _output.WriteLine($"Found {instanceCount} invalid instance files");
        
        instanceCount.Should().BeGreaterThan(0, "Invalid instances directory should contain test files");
    }

    #endregion

    #region Helper Methods

    private static JsonNode? ResolveJsonPointer(string pointer, JsonNode? node)
    {
        if (node is null || string.IsNullOrEmpty(pointer) || pointer == "/")
        {
            return node;
        }

        var parts = pointer.Split('/').Skip(1);
        var current = node;

        foreach (var part in parts)
        {
            if (current is null) return null;

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
}
