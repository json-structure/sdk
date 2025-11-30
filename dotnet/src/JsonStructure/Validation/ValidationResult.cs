// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;

namespace JsonStructure.Validation;

/// <summary>
/// Represents the severity of a validation message.
/// </summary>
public enum ValidationSeverity
{
    /// <summary>
    /// An error that prevents validation from succeeding.
    /// </summary>
    Error,
    
    /// <summary>
    /// A warning that does not prevent validation from succeeding.
    /// </summary>
    Warning
}

/// <summary>
/// Represents a location in a JSON document with line and column information.
/// </summary>
/// <param name="Line">The 1-based line number.</param>
/// <param name="Column">The 1-based column number.</param>
public readonly record struct JsonLocation(int Line, int Column)
{
    /// <summary>
    /// Gets a location representing an unknown position.
    /// </summary>
    public static JsonLocation Unknown { get; } = new(0, 0);
    
    /// <summary>
    /// Gets whether this location is known (non-zero).
    /// </summary>
    public bool IsKnown => Line > 0 && Column > 0;
    
    /// <summary>
    /// Returns a string representation of the location.
    /// </summary>
    public override string ToString() => IsKnown ? $"({Line}:{Column})" : "";
}

/// <summary>
/// Represents an error or warning encountered during validation.
/// </summary>
/// <param name="Code">The unique error code (e.g., SCHEMA_NULL, INSTANCE_TYPE_MISMATCH).</param>
/// <param name="Message">The error message describing the validation failure.</param>
/// <param name="Path">The JSON path where the error occurred.</param>
/// <param name="Severity">The severity of the message (Error or Warning).</param>
/// <param name="Location">The line and column in the source JSON where the error occurred.</param>
/// <param name="SchemaPath">For instance validation, the path to the schema rule that caused the error.</param>
public sealed record ValidationError(
    string Code,
    string Message, 
    string Path = "",
    ValidationSeverity Severity = ValidationSeverity.Error,
    JsonLocation Location = default,
    string? SchemaPath = null)
{
    /// <summary>
    /// Creates a ValidationError with just a message and path (for backward compatibility).
    /// </summary>
    public ValidationError(string message, string path) 
        : this("UNKNOWN", message, path, ValidationSeverity.Error, default, null)
    {
    }

    /// <summary>
    /// Returns a string representation of the error.
    /// </summary>
    public override string ToString()
    {
        var parts = new List<string>();
        
        if (!string.IsNullOrEmpty(Path))
            parts.Add(Path);
            
        if (Location.IsKnown)
            parts.Add(Location.ToString());
            
        parts.Add($"[{Code}]");
        parts.Add(Message);
        
        if (!string.IsNullOrEmpty(SchemaPath))
            parts.Add($"(schema: {SchemaPath})");
            
        return string.Join(" ", parts);
    }
}

/// <summary>
/// Represents the result of a validation operation.
/// </summary>
public sealed class ValidationResult
{
    private readonly List<ValidationError> _errors;
    private readonly List<ValidationError> _warnings;

    /// <summary>
    /// Gets whether the validation was successful (no errors).
    /// </summary>
    public bool IsValid => _errors.Count == 0;

    /// <summary>
    /// Gets the collection of validation errors.
    /// </summary>
    public IReadOnlyList<ValidationError> Errors => _errors;

    /// <summary>
    /// Gets the collection of validation warnings.
    /// </summary>
    public IReadOnlyList<ValidationError> Warnings => _warnings;

    /// <summary>
    /// Gets all messages (errors and warnings combined).
    /// </summary>
    public IEnumerable<ValidationError> AllMessages => _errors.Concat(_warnings);

    /// <summary>
    /// Initializes a new instance of <see cref="ValidationResult"/>.
    /// </summary>
    public ValidationResult()
    {
        _errors = new List<ValidationError>();
        _warnings = new List<ValidationError>();
    }

    /// <summary>
    /// Initializes a new instance of <see cref="ValidationResult"/> with the specified errors.
    /// </summary>
    /// <param name="errors">The validation errors.</param>
    public ValidationResult(IEnumerable<ValidationError> errors)
    {
        _errors = errors.Where(e => e.Severity == ValidationSeverity.Error).ToList();
        _warnings = errors.Where(e => e.Severity == ValidationSeverity.Warning).ToList();
    }

    /// <summary>
    /// Adds an error to the result (backward compatible).
    /// </summary>
    /// <param name="message">The error message.</param>
    /// <param name="path">The path where the error occurred.</param>
    public void AddError(string message, string path = "")
    {
        _errors.Add(new ValidationError(message, path));
    }

    /// <summary>
    /// Adds an error with a code to the result.
    /// </summary>
    /// <param name="code">The error code.</param>
    /// <param name="message">The error message.</param>
    /// <param name="path">The path where the error occurred.</param>
    /// <param name="location">The source location.</param>
    /// <param name="schemaPath">The schema path for instance validation errors.</param>
    public void AddError(string code, string message, string path = "", JsonLocation location = default, string? schemaPath = null)
    {
        _errors.Add(new ValidationError(code, message, path, ValidationSeverity.Error, location, schemaPath));
    }

    /// <summary>
    /// Adds an error to the result.
    /// </summary>
    /// <param name="error">The error to add.</param>
    public void AddError(ValidationError error)
    {
        if (error.Severity == ValidationSeverity.Warning)
            _warnings.Add(error);
        else
            _errors.Add(error);
    }

    /// <summary>
    /// Adds a warning to the result.
    /// </summary>
    /// <param name="code">The warning code.</param>
    /// <param name="message">The warning message.</param>
    /// <param name="path">The path where the warning occurred.</param>
    /// <param name="location">The source location.</param>
    /// <param name="schemaPath">The schema path for instance validation warnings.</param>
    public void AddWarning(string code, string message, string path = "", JsonLocation location = default, string? schemaPath = null)
    {
        _warnings.Add(new ValidationError(code, message, path, ValidationSeverity.Warning, location, schemaPath));
    }

    /// <summary>
    /// Adds multiple errors to the result.
    /// </summary>
    /// <param name="errors">The errors to add.</param>
    public void AddErrors(IEnumerable<ValidationError> errors)
    {
        foreach (var error in errors)
        {
            AddError(error);
        }
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
    /// Gets or sets the maximum depth for recursive schema validation. Default is 64.
    /// </summary>
    public int MaxValidationDepth { get; set; } = 64;

    /// <summary>
    /// Gets or sets a function to resolve external schema references.
    /// </summary>
    public Func<string, JsonNode?>? ReferenceResolver { get; set; }

    /// <summary>
    /// Gets or sets a function to load imported schemas.
    /// </summary>
    public Func<string, JsonNode?>? ImportLoader { get; set; }

    /// <summary>
    /// Gets or sets whether to allow $ in property names (required for validating metaschemas).
    /// </summary>
    public bool AllowDollar { get; set; }

    /// <summary>
    /// Gets or sets whether to enable processing of $import/$importdefs.
    /// </summary>
    public bool AllowImport { get; set; }

    /// <summary>
    /// Gets or sets pre-loaded schemas for import resolution by $id.
    /// </summary>
    public Dictionary<string, JsonNode>? ExternalSchemas { get; set; }

    /// <summary>
    /// Gets or sets whether to emit warnings when extension keywords are used without being enabled
    /// via $schema or $uses. When true (default), the validator will emit warnings for validation
    /// extension keywords (like minimum, maximum, minLength, maxLength, pattern, format, minItems,
    /// maxItems, etc.) that are present in a schema but won't be enforced because the validation
    /// extension is not enabled. Set to false to suppress these warnings.
    /// </summary>
    /// <remarks>
    /// Extension keywords are optional features defined in JSON Structure Validation extension.
    /// They require either the validation meta-schema or a $uses clause with "JSONStructureValidation"
    /// to be enforced. Using them without enabling the extension means they will be ignored during
    /// validation, which might not be the author's intent.
    /// </remarks>
    public bool WarnOnUnusedExtensionKeywords { get; set; } = true;

    /// <summary>
    /// Gets a default instance of the options.
    /// </summary>
    public static ValidationOptions Default { get; } = new();
}
