// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;

namespace JsonStructure.Validation;

/// <summary>
/// Represents an error encountered during validation.
/// </summary>
/// <param name="Message">The error message describing the validation failure.</param>
/// <param name="Path">The JSON path where the error occurred.</param>
public sealed record ValidationError(string Message, string Path = "")
{
    /// <summary>
    /// Returns a string representation of the error.
    /// </summary>
    public override string ToString() => string.IsNullOrEmpty(Path) ? Message : $"{Path}: {Message}";
}

/// <summary>
/// Represents the result of a validation operation.
/// </summary>
public sealed class ValidationResult
{
    private readonly List<ValidationError> _errors;

    /// <summary>
    /// Gets whether the validation was successful (no errors).
    /// </summary>
    public bool IsValid => _errors.Count == 0;

    /// <summary>
    /// Gets the collection of validation errors.
    /// </summary>
    public IReadOnlyList<ValidationError> Errors => _errors;

    /// <summary>
    /// Initializes a new instance of <see cref="ValidationResult"/>.
    /// </summary>
    public ValidationResult()
    {
        _errors = new List<ValidationError>();
    }

    /// <summary>
    /// Initializes a new instance of <see cref="ValidationResult"/> with the specified errors.
    /// </summary>
    /// <param name="errors">The validation errors.</param>
    public ValidationResult(IEnumerable<ValidationError> errors)
    {
        _errors = errors.ToList();
    }

    /// <summary>
    /// Adds an error to the result.
    /// </summary>
    /// <param name="message">The error message.</param>
    /// <param name="path">The path where the error occurred.</param>
    public void AddError(string message, string path = "")
    {
        _errors.Add(new ValidationError(message, path));
    }

    /// <summary>
    /// Adds an error to the result.
    /// </summary>
    /// <param name="error">The error to add.</param>
    public void AddError(ValidationError error)
    {
        _errors.Add(error);
    }

    /// <summary>
    /// Adds multiple errors to the result.
    /// </summary>
    /// <param name="errors">The errors to add.</param>
    public void AddErrors(IEnumerable<ValidationError> errors)
    {
        _errors.AddRange(errors);
    }

    /// <summary>
    /// Creates a successful validation result.
    /// </summary>
    public static ValidationResult Success { get; } = new();

    /// <summary>
    /// Creates a failed validation result with a single error.
    /// </summary>
    /// <param name="message">The error message.</param>
    /// <param name="path">The path where the error occurred.</param>
    public static ValidationResult Failure(string message, string path = "") 
        => new(new[] { new ValidationError(message, path) });

    /// <summary>
    /// Creates a failed validation result with multiple errors.
    /// </summary>
    /// <param name="errors">The errors.</param>
    public static ValidationResult Failure(IEnumerable<ValidationError> errors) 
        => new(errors);

    /// <summary>
    /// Returns a string representation of the validation result.
    /// </summary>
    public override string ToString()
    {
        if (IsValid) return "Validation succeeded";
        return $"Validation failed with {_errors.Count} error(s):\n" + 
               string.Join("\n", _errors.Select(e => $"  - {e}"));
    }
}

/// <summary>
/// Options for controlling validation behavior.
/// </summary>
public sealed class ValidationOptions
{
    /// <summary>
    /// Gets or sets whether to stop on the first error. Default is false.
    /// </summary>
    public bool StopOnFirstError { get; set; }

    /// <summary>
    /// Gets or sets whether to validate extended formats strictly. Default is true.
    /// </summary>
    public bool StrictFormatValidation { get; set; } = true;

    /// <summary>
    /// Gets or sets the maximum depth for recursive schema validation. Default is 100.
    /// </summary>
    public int MaxValidationDepth { get; set; } = 100;

    /// <summary>
    /// Gets or sets a function to resolve external schema references.
    /// </summary>
    public Func<string, JsonNode?>? ReferenceResolver { get; set; }

    /// <summary>
    /// Gets or sets a function to load imported schemas.
    /// </summary>
    public Func<string, JsonNode?>? ImportLoader { get; set; }

    /// <summary>
    /// Gets a default instance of the options.
    /// </summary>
    public static ValidationOptions Default { get; } = new();
}
