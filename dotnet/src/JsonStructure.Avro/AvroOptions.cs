namespace JsonStructure.Avro;

/// <summary>
/// How the compiler treats a record that permits undeclared properties.
/// </summary>
/// <remarks>
/// Avro records are closed. A JSON Structure type that allows additional
/// properties therefore cannot be carried faithfully, and the only question is
/// whether that is worth stopping for.
/// </remarks>
public enum AdditionalPropertiesPolicy
{
    /// <summary>Warn and drop the undeclared properties. The default.</summary>
    Ignore,

    /// <summary>Fail the compilation.</summary>
    Error,
}

/// <summary>
/// Something the target could not express, reported rather than dropped.
/// </summary>
/// <param name="Path">JSON Pointer of the schema node that lost information.</param>
/// <param name="Message">What was lost.</param>
/// <remarks>
/// A warning is a promise that something did not survive the translation. The
/// conformance corpus asserts the exact set for every case, because an
/// unasserted warning is free to stop being emitted.
/// </remarks>
public sealed record AvroWarning(string Path, string Message)
{
    /// <summary>Renders as <c>pointer: message</c>, the corpus wire format.</summary>
    public override string ToString() => $"{Path}: {Message}";
}

/// <summary>
/// Options that steer compilation without ever affecting a generated name.
/// </summary>
/// <remarks>
/// Names and namespaces derive from the document alone. The document is the
/// source of truth and this is a translation of it, so there is deliberately no
/// option to override a namespace or rename a type — that belongs in the
/// document, where every target sees it.
/// </remarks>
public sealed class AvroOptions
{
    /// <summary>The defaults: no add-ins, open records warn, documentation is carried.</summary>
    public static AvroOptions Default { get; } = new();

    /// <summary>Add-ins from <c>$offers</c> to apply, by name.</summary>
    public IReadOnlyList<string> Uses { get; init; } = Array.Empty<string>();

    /// <summary>What to do about records that permit undeclared properties.</summary>
    public AdditionalPropertiesPolicy AdditionalProperties { get; init; }
        = AdditionalPropertiesPolicy.Ignore;

    /// <summary>Carry <c>description</c> across as Avro <c>doc</c>.</summary>
    public bool EmitDoc { get; init; } = true;
}
