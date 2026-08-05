namespace JsonStructure.Avro;

/// <summary>
/// The kind of a fatal compilation problem.
/// </summary>
/// <remarks>
/// A conformance harness asserts on this rather than on a substring of the
/// message, so that rewording an error does not silently turn a negative test
/// into one that passes for the wrong reason. The names match the Rust
/// reference implementation's error variants exactly.
/// </remarks>
public enum AvroErrorKind
{
    /// <summary>The document has no root type and none was named.</summary>
    NoRootType,

    /// <summary>A <c>$ref</c>, <c>$extends</c>, or <c>$offers</c> pointer does not resolve.</summary>
    UnresolvedRef,

    /// <summary>The schema is not expressible in Avro, or is malformed.</summary>
    Invalid,

    /// <summary>An <c>altnames</c>/<c>altenums</c> override is not a legal Avro name.</summary>
    IllegalName,

    /// <summary>An add-in named in <see cref="AvroOptions.Uses"/> is not advertised by <c>$offers</c>.</summary>
    UnknownAddIn,
}

/// <summary>
/// A JSON Structure document that cannot be represented as an Avro schema.
/// </summary>
/// <remarks>
/// The compiler is loud about what Avro cannot express rather than quietly
/// lossy, so these are thrown for genuine impossibilities. Everything that is
/// merely imprecise — a set losing its uniqueness, a <c>const</c> losing its
/// enforcement — is an <see cref="AvroWarning"/> instead.
/// </remarks>
public sealed class AvroCompileException : Exception
{
    internal AvroCompileException(AvroErrorKind kind, string message, string? path)
        : base(path is null ? message : $"{message} (at {path})")
    {
        Kind = kind;
        Path = path;
    }

    /// <summary>Which problem this is.</summary>
    public AvroErrorKind Kind { get; }

    /// <summary>JSON Pointer of the offending node, where the kind carries one.</summary>
    public string? Path { get; }

    internal static AvroCompileException NoRootType() => new(
        AvroErrorKind.NoRootType,
        "document declares neither `type` nor `$root`; nothing to compile",
        null);

    internal static AvroCompileException UnresolvedRef(string pointer, string path) => new(
        AvroErrorKind.UnresolvedRef,
        $"cannot resolve '{pointer}'",
        path);

    internal static AvroCompileException Invalid(string message, string path) =>
        new(AvroErrorKind.Invalid, message, path);

    internal static AvroCompileException IllegalName(string name, string path) => new(
        AvroErrorKind.IllegalName,
        $"'{name}' is not a legal Avro name",
        path);

    internal static AvroCompileException UnknownAddIn(string name) => new(
        AvroErrorKind.UnknownAddIn,
        $"add-in '{name}' is not offered by this schema",
        null);
}
