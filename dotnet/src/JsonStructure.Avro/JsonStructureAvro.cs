using System.Text.Json.Nodes;
using Avro;
using Avro.Util;

namespace JsonStructure.Avro;

/// <summary>
/// Loads a JSON Structure document as a ready-to-use Apache Avro schema.
/// </summary>
/// <remarks>
/// <para>
/// This is the seam that makes the <c>.avsc</c> disappear. Wherever an
/// application would have called <see cref="Schema.Parse(string)"/> on a
/// hand-maintained <c>.avsc</c>, it calls <see cref="SchemaFrom(string)"/> on its
/// JSON Structure document instead, and everything downstream — the datum
/// writers, the readers, the file writers — is unchanged.
/// </para>
/// <para>
/// The type name carries the qualification rather than the method name, because
/// C# resolves types by simple name after a <c>using</c>: a bare
/// <c>SchemaFrom</c> would say nothing at the call site about what it replaces.
/// </para>
/// <example>
/// <code>
/// var schema = (RecordSchema)JsonStructureAvro.SchemaFrom(personStructJson);
/// var record = new GenericRecord(schema);
/// record.Add("name", "Alice");
///
/// using var stream = new MemoryStream();
/// new GenericDatumWriter&lt;GenericRecord&gt;(schema)
///     .Write(record, new BinaryEncoder(stream));
/// </code>
/// </example>
/// <para>
/// Compilation is cheap but not free, and a schema embedded in the assembly is
/// compiled from the same bytes every time. It costs a few microseconds per
/// declared property and is linear in document size, which is nothing once and a
/// great deal per message — so hold the result in a <c>static readonly</c> field
/// or a <see cref="Lazy{T}"/> rather than calling this per operation.
/// </para>
/// </remarks>
public static class JsonStructureAvro
{
    /// <summary>Compiles a JSON Structure document from a string.</summary>
    /// <param name="source">The document text.</param>
    /// <returns>The parsed Avro schema.</returns>
    /// <exception cref="AvroCompileException">The document cannot be represented in Avro.</exception>
    public static Schema SchemaFrom(string source) => SchemaFrom(source, AvroOptions.Default);

    /// <summary>Compiles a JSON Structure document from a string, with options.</summary>
    /// <param name="source">The document text.</param>
    /// <param name="options">Compilation options.</param>
    /// <returns>The parsed Avro schema.</returns>
    /// <exception cref="AvroCompileException">The document cannot be represented in Avro.</exception>
    public static Schema SchemaFrom(string source, AvroOptions options)
    {
        ArgumentNullException.ThrowIfNull(source);
        var document = JsonNode.Parse(source)
            ?? throw AvroCompileException.Invalid("schema document must be a JSON object", "#");
        return SchemaFrom(document, options);
    }

    /// <summary>Compiles an already-parsed JSON Structure document.</summary>
    /// <param name="document">The document.</param>
    /// <returns>The parsed Avro schema.</returns>
    /// <exception cref="AvroCompileException">The document cannot be represented in Avro.</exception>
    public static Schema SchemaFrom(JsonNode document) => SchemaFrom(document, AvroOptions.Default);

    /// <summary>Compiles an already-parsed JSON Structure document, with options.</summary>
    /// <param name="document">The document.</param>
    /// <param name="options">Compilation options.</param>
    /// <returns>The parsed Avro schema.</returns>
    /// <exception cref="AvroCompileException">The document cannot be represented in Avro.</exception>
    public static Schema SchemaFrom(JsonNode document, AvroOptions options)
    {
        var compiled = AvroCompiler.Compile(document, options).Schema;
        RegisterLogicalTypes();
        return Schema.Parse(compiled.ToJsonString(Js.Compact_));
    }

    private static readonly object RegistrationGate = new();
    private static bool _registered;

    /// <summary>
    /// Teaches the Apache Avro runtime the <c>rfc3339-*</c> logical types that
    /// <see cref="AvroMode.Full"/> emits, so that it can parse what this SDK
    /// writes. Idempotent, thread-safe, and called for you by every
    /// <c>SchemaFrom</c> overload.
    /// </summary>
    /// <remarks>
    /// Call this directly only when parsing a <c>full</c>-mode schema that
    /// reached you some other way — off a schema registry, say, or out of a
    /// container file header. Without it, <see cref="Schema.Parse(string)"/>
    /// throws <c>Logical type 'rfc3339-date' is not supported</c>.
    /// </remarks>
    public static void RegisterLogicalTypes()
    {
        if (Volatile.Read(ref _registered))
        {
            return;
        }
        lock (RegistrationGate)
        {
            if (_registered)
            {
                return;
            }
            foreach (var name in Rfc3339Names)
            {
                LogicalTypeFactory.Instance.Register(new Rfc3339LogicalType(name));
            }
            Volatile.Write(ref _registered, true);
        }
    }

    private static readonly string[] Rfc3339Names =
    [
        "rfc3339-date",
        "rfc3339-time-micros",
        "rfc3339-timestamp-micros",
        "rfc3339-duration",
    ];

    /// <summary>Compiles a JSON Structure document read from disk.</summary>
    /// <param name="path">Path to the document.</param>
    /// <returns>The parsed Avro schema.</returns>
    /// <exception cref="AvroCompileException">The document cannot be represented in Avro.</exception>
    public static Schema SchemaFromFile(string path) => SchemaFromFile(path, AvroOptions.Default);

    /// <summary>Compiles a JSON Structure document read from disk, with options.</summary>
    /// <param name="path">Path to the document.</param>
    /// <param name="options">Compilation options.</param>
    /// <returns>The parsed Avro schema.</returns>
    /// <exception cref="AvroCompileException">The document cannot be represented in Avro.</exception>
    public static Schema SchemaFromFile(string path, AvroOptions options)
    {
        ArgumentNullException.ThrowIfNull(path);
        return SchemaFrom(File.ReadAllText(path), options);
    }
}
