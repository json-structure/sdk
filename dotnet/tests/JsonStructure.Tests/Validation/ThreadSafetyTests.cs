// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;
using FluentAssertions;
using JsonStructure.Validation;
using Xunit;

namespace JsonStructure.Tests.Validation;

/// <summary>
/// Tests to verify that the validator classes are thread-safe.
/// Multiple threads can use the same validator instance concurrently.
/// </summary>
public class ThreadSafetyTests
{
    [Fact]
    public async Task InstanceValidator_ConcurrentValidations_IsolateErrors()
    {
        // Arrange: Single validator instance shared across threads
        var validator = new InstanceValidator();

        // Schema that will cause validation errors for invalid instances
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["name"] = new JsonObject { ["type"] = "string" },
                ["age"] = new JsonObject { ["type"] = "integer", ["minimum"] = 0 }
            },
            ["required"] = new JsonArray { "name" }
        };

        // Run many concurrent validations
        var tasks = new List<Task<(bool isValidExpected, ValidationResult result)>>();
        const int iterations = 100;

        for (int i = 0; i < iterations; i++)
        {
            var iteration = i;
            tasks.Add(Task.Run(() =>
            {
                // Alternate between valid and invalid instances
                JsonNode instance;
                bool shouldBeValid;

                if (iteration % 3 == 0)
                {
                    // Valid instance
                    instance = new JsonObject
                    {
                        ["name"] = "John",
                        ["age"] = 30
                    };
                    shouldBeValid = true;
                }
                else if (iteration % 3 == 1)
                {
                    // Invalid: missing required field
                    instance = new JsonObject
                    {
                        ["age"] = 25
                    };
                    shouldBeValid = false;
                }
                else
                {
                    // Invalid: wrong type for age
                    instance = new JsonObject
                    {
                        ["name"] = "Jane",
                        ["age"] = "not a number"
                    };
                    shouldBeValid = false;
                }

                var result = validator.Validate(instance, schema.DeepClone());
                return (shouldBeValid, result);
            }));
        }

        // Act
        var results = await Task.WhenAll(tasks);

        // Assert: Each result should match its expected validity
        foreach (var (isValidExpected, result) in results)
        {
            result.IsValid.Should().Be(isValidExpected,
                $"Expected IsValid={isValidExpected} but got IsValid={result.IsValid}. Errors: {string.Join(", ", result.Errors.Select(e => e.Message))}");
        }
    }

    [Fact]
    public async Task InstanceValidator_ConcurrentValidations_ErrorsDoNotLeak()
    {
        // Arrange
        var validator = new InstanceValidator();
        var schema = new JsonObject { ["type"] = "string" };

        var tasks = new List<Task<ValidationResult>>();
        const int iterations = 50;

        for (int i = 0; i < iterations; i++)
        {
            var iteration = i;
            tasks.Add(Task.Run(() =>
            {
                // Even iterations: valid strings, odd iterations: invalid integers
                JsonNode instance = iteration % 2 == 0
                    ? JsonValue.Create($"string_{iteration}")!
                    : JsonValue.Create(iteration);

                return validator.Validate(instance, schema.DeepClone());
            }));
        }

        // Act
        var results = await Task.WhenAll(tasks);

        // Assert
        for (int i = 0; i < iterations; i++)
        {
            if (i % 2 == 0)
            {
                results[i].IsValid.Should().BeTrue($"Iteration {i} should be valid");
                results[i].Errors.Should().BeEmpty($"Iteration {i} should have no errors");
            }
            else
            {
                results[i].IsValid.Should().BeFalse($"Iteration {i} should be invalid");
                results[i].Errors.Should().ContainSingle($"Iteration {i} should have exactly one error");
            }
        }
    }

    [Fact]
    public async Task InstanceValidator_ConcurrentRefResolution_NoRaceConditions()
    {
        // Arrange: Schema with $ref that needs resolution
        var validator = new InstanceValidator(new ValidationOptions
        {
            ReferenceResolver = refUri =>
            {
                // Simulate some work
                Thread.Sleep(1);
                return new JsonObject { ["type"] = "string" };
            }
        });

        var schema = new JsonObject
        {
            ["$defs"] = new JsonObject
            {
                ["StringType"] = new JsonObject { ["type"] = "string" }
            },
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["value"] = new JsonObject { ["$ref"] = "#/$defs/StringType" }
            }
        };

        var tasks = new List<Task<ValidationResult>>();
        const int iterations = 50;

        for (int i = 0; i < iterations; i++)
        {
            var iteration = i;
            tasks.Add(Task.Run(() =>
            {
                var instance = new JsonObject
                {
                    ["value"] = iteration % 2 == 0 ? "valid string" : JsonValue.Create(42)
                };
                return validator.Validate(instance, schema.DeepClone());
            }));
        }

        // Act
        var results = await Task.WhenAll(tasks);

        // Assert
        for (int i = 0; i < iterations; i++)
        {
            if (i % 2 == 0)
            {
                results[i].IsValid.Should().BeTrue($"Iteration {i} should be valid");
            }
            else
            {
                results[i].IsValid.Should().BeFalse($"Iteration {i} should be invalid");
            }
        }
    }

    [Fact]
    public async Task InstanceValidator_ParallelFor_ManyIterations()
    {
        // Arrange
        var validator = new InstanceValidator();
        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["id"] = new JsonObject { ["type"] = "integer" },
                ["data"] = new JsonObject { ["type"] = "string" }
            }
        };

        var results = new ValidationResult[1000];
        var instances = new JsonObject[1000];
        var expectedValidity = new bool[1000];

        for (int i = 0; i < 1000; i++)
        {
            if (i % 2 == 0)
            {
                instances[i] = new JsonObject { ["id"] = i, ["data"] = $"data_{i}" };
                expectedValidity[i] = true;
            }
            else
            {
                instances[i] = new JsonObject { ["id"] = "not an int", ["data"] = $"data_{i}" };
                expectedValidity[i] = false;
            }
        }

        // Act
        Parallel.For(0, 1000, i =>
        {
            results[i] = validator.Validate(instances[i], schema.DeepClone());
        });

        // Assert
        for (int i = 0; i < 1000; i++)
        {
            results[i].IsValid.Should().Be(expectedValidity[i], $"Iteration {i}");
        }
    }

    [Fact]
    public async Task InstanceValidator_StringOverload_ThreadSafe()
    {
        // Arrange
        var validator = new InstanceValidator();
        var schemaJson = """{"type": "object", "properties": {"value": {"type": "number"}}}""";

        var tasks = new List<Task<ValidationResult>>();
        const int iterations = 100;

        for (int i = 0; i < iterations; i++)
        {
            var iteration = i;
            tasks.Add(Task.Run(() =>
            {
                var instanceJson = iteration % 2 == 0
                    ? $$"""{"value": {{iteration}}}"""
                    : """{"value": "not a number"}""";

                return validator.Validate(instanceJson, schemaJson);
            }));
        }

        // Act
        var results = await Task.WhenAll(tasks);

        // Assert
        for (int i = 0; i < iterations; i++)
        {
            if (i % 2 == 0)
            {
                results[i].IsValid.Should().BeTrue($"Iteration {i} should be valid");
            }
            else
            {
                results[i].IsValid.Should().BeFalse($"Iteration {i} should be invalid");
            }
        }
    }

    [Fact]
    public async Task SchemaValidator_ConcurrentValidations_ThreadSafe()
    {
        // Arrange
        var validator = new SchemaValidator();

        var tasks = new List<Task<ValidationResult>>();
        const int iterations = 50;

        for (int i = 0; i < iterations; i++)
        {
            var iteration = i;
            tasks.Add(Task.Run(() =>
            {
                JsonNode schema;
                bool shouldBeValid;

                if (iteration % 3 == 0)
                {
                    // Valid schema with required fields
                    schema = new JsonObject
                    {
                        ["$id"] = $"test://schema{iteration}",
                        ["name"] = $"TestSchema{iteration}",
                        ["type"] = "string",
                        ["minLength"] = 1
                    };
                    shouldBeValid = true;
                }
                else if (iteration % 3 == 1)
                {
                    // Valid schema with properties
                    schema = new JsonObject
                    {
                        ["$id"] = $"test://schema{iteration}",
                        ["name"] = $"TestSchema{iteration}",
                        ["type"] = "object",
                        ["properties"] = new JsonObject
                        {
                            ["name"] = new JsonObject { ["type"] = "string" }
                        }
                    };
                    shouldBeValid = true;
                }
                else
                {
                    // Invalid: minLength must be non-negative
                    schema = new JsonObject
                    {
                        ["$id"] = $"test://schema{iteration}",
                        ["name"] = $"TestSchema{iteration}",
                        ["type"] = "string",
                        ["minLength"] = -1
                    };
                    shouldBeValid = false;
                }

                return validator.Validate(schema);
            }));
        }

        // Act
        var results = await Task.WhenAll(tasks);

        // Assert
        for (int i = 0; i < iterations; i++)
        {
            var expected = i % 3 != 2; // iterations 2, 5, 8, etc. should be invalid
            var errors = string.Join("; ", results[i].Errors.Select(e => $"{e.Code}: {e.Message}"));
            results[i].IsValid.Should().Be(expected, $"Iteration {i}, errors: {errors}");
        }
    }
}
