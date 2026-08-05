using System.Text.Json.Nodes;
using Avro;
using Avro.Generic;
using Avro.IO;
using JsonStructure.Avro;
using Shouldly;
using Xunit;

namespace JsonStructure.Avro.Tests;

/// <summary>
/// The Avro conformance corpus, run against this implementation.
/// </summary>
/// <remarks>
/// The corpus under <c>test-assets/avro/</c> is shared by every SDK, and its
/// README defines six checks that a conforming harness must implement. All six
/// are here. The point of the exercise is that this implementation and the Rust
/// reference agree byte for byte — a port that merely produces "valid Avro"
/// would be a second dialect, not a second implementation.
/// </remarks>
public sealed class AvroCorpusTests
{
    public static TheoryData<string> ValidCases => Cases("valid");

    public static TheoryData<string> InvalidCases => Cases("invalid");

    /// <summary>Check 1: the compiled schema matches the golden, byte for byte.</summary>
    [Theory]
    [MemberData(nameof(ValidCases))]
    public void CompilesToTheGoldenSchema(string name)
    {
        var dir = CaseDir("valid", name);
        var result = AvroCompiler.Compile(ReadDocument(dir), ReadOptions(dir));
        var actual = AvroCompiler.ToAvsc(result.Schema);
        var expected = Normalize(File.ReadAllText(Path.Combine(dir, "expected.avsc")));

        actual.ShouldBe(
            expected,
            $"case '{name}' does not match its golden .avsc. Attribute order is part of the "
            + "contract (spec §7), so a difference here is a real divergence even if the "
            + "parsed JSON would compare equal.");
    }

    /// <summary>
    /// Check 2: compiling the same input ten times produces the same bytes.
    /// </summary>
    /// <remarks>
    /// This is not paranoia about the compiler being non-deterministic on
    /// purpose. It catches the ordinary way determinism dies: an unordered
    /// collection somewhere on the naming path, whose iteration order happens to
    /// be stable within one process run and is not stable across them.
    /// </remarks>
    [Theory]
    [MemberData(nameof(ValidCases))]
    public void CompilesDeterministically(string name)
    {
        var dir = CaseDir("valid", name);
        var document = ReadDocument(dir);
        var options = ReadOptions(dir);

        var first = AvroCompiler.ToAvsc(AvroCompiler.Compile(document, options).Schema);
        for (var run = 0; run < 10; run++)
        {
            AvroCompiler.ToAvsc(AvroCompiler.Compile(document, options).Schema)
                .ShouldBe(first, $"case '{name}' compiled differently on run {run}");
        }
    }

    /// <summary>Check 3: a real Avro parser accepts the output.</summary>
    [Theory]
    [MemberData(nameof(ValidCases))]
    public void ProducesSchemaTheAvroLibraryAccepts(string name)
    {
        var dir = CaseDir("valid", name);
        var schema = JsonStructureAvro.SchemaFrom(ReadDocument(dir), ReadOptions(dir));
        schema.ShouldNotBeNull();
    }

    /// <summary>
    /// Check 4: an instance written by hand survives a real write and read.
    /// </summary>
    /// <remarks>
    /// This is the one check a blessed golden cannot perform. <c>expected.avsc</c>
    /// proves this implementation agrees with the reference; it cannot prove the
    /// reference is right, because the golden was blessed from it. The instance is
    /// written against what the <em>source document</em> means, so a schema that is
    /// self-consistent but wrong fails here.
    /// <para>
    /// The instance is decoded twice where the library allows it — once by
    /// <see cref="AvroJson"/> and once by Apache.Avro's own
    /// <see cref="JsonDecoder"/> — and the two decodes must serialize to identical
    /// bytes. See <see cref="AvroJson"/> for why the library cannot be the only
    /// decoder.
    /// </para>
    /// </remarks>
    [Theory]
    [MemberData(nameof(ValidCases))]
    public void RoundTripsItsInstanceThroughAvro(string name)
    {
        var dir = CaseDir("valid", name);
        var instancePath = Path.Combine(dir, "instance.avro.json");
        File.Exists(instancePath).ShouldBeTrue(
            $"case '{name}' has no instance.avro.json, so its schema is never asked to carry "
            + "data. Every valid case must have one.");

        var schema = JsonStructureAvro.SchemaFrom(ReadDocument(dir), ReadOptions(dir));
        var text = Normalize(File.ReadAllText(instancePath)).Trim();

        var datum = AvroJson.Decode(schema, JsonNode.Parse(text));
        var bytes = WriteBinary(schema, datum);

        var readBack = new GenericDatumReader<object>(schema, schema)
            .Read(null!, new BinaryDecoder(new MemoryStream(bytes)));
        WriteBinary(schema, readBack).ShouldBe(
            bytes, $"case '{name}' did not survive a binary write, read and rewrite");

        if (TryLibraryDecode(schema, text, out var viaLibrary))
        {
            WriteBinary(schema, viaLibrary).ShouldBe(
                bytes,
                $"case '{name}' decoded differently by Apache.Avro's JsonDecoder than by the "
                + "harness reader; one of the two is misreading the Avro JSON encoding");
            Interlocked.Increment(ref _crossChecked);
        }
    }

    /// <summary>
    /// The library cross-check has not quietly stopped happening.
    /// </summary>
    /// <remarks>
    /// A cross-check wrapped in an "if the library manages it" condition degrades
    /// silently to no check at all. Exactly one case in the corpus,
    /// <c>recursion</c>, defeats Apache.Avro's <c>JsonDecoder</c> — a record whose
    /// own array field refers back to it. <c>mutual-recursion</c>, where the cycle
    /// runs through a second named type, is fine.
    /// </remarks>
    [Fact]
    public void CrossChecksMostInstancesAgainstTheLibraryDecoder()
    {
        foreach (var name in CaseNames("valid"))
        {
            RoundTripsItsInstanceThroughAvro(name);
        }

        _crossChecked.ShouldBeGreaterThanOrEqualTo(
            CaseNames("valid").Count() - 1,
            "more cases than expected fell back to the harness reader; Apache.Avro's "
            + "JsonDecoder should handle everything except the recursive schemas");
    }

    private static int _crossChecked;

    private static bool TryLibraryDecode(Schema schema, string json, out object? datum)
    {
        try
        {
            datum = new GenericDatumReader<object>(schema, schema)
                .Read(null!, new JsonDecoder(schema, json));
            return true;
        }
        catch (NullReferenceException)
        {
            // Apache.Avro 1.12's JsonDecoder cannot build a parser for a schema
            // with a recursive type reference. Nothing to report: AvroJson has
            // already decoded this instance and the round trip stands.
            datum = null;
            return false;
        }
    }

    private static byte[] WriteBinary(Schema schema, object? datum)
    {
        using var buffer = new MemoryStream();
        new GenericDatumWriter<object>(schema).Write(datum!, new BinaryEncoder(buffer));
        return buffer.ToArray();
    }

    /// <summary>Check 5: the emitted warnings match, in emission order.</summary>
    /// <remarks>
    /// A warning is a promise that something was lost. Unasserted, it is free to
    /// stop being made.
    /// </remarks>
    [Theory]
    [MemberData(nameof(ValidCases))]
    public void EmitsTheExpectedWarnings(string name)
    {
        var dir = CaseDir("valid", name);
        var result = AvroCompiler.Compile(ReadDocument(dir), ReadOptions(dir));
        var actual = result.Warnings.Select(w => w.ToString()).ToList();

        var path = Path.Combine(dir, "expected-warnings.txt");
        var expected = File.Exists(path)
            ? Normalize(File.ReadAllText(path))
                .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Select(l => l.TrimEnd())
                .ToList()
            : [];

        actual.ShouldBe(expected, $"case '{name}' emitted a different set of warnings");
    }

    /// <summary>Check 6: every negative case fails with the recorded kind, pointer and message.</summary>
    [Theory]
    [MemberData(nameof(InvalidCases))]
    public void FailsWithTheExpectedError(string name)
    {
        var dir = CaseDir("invalid", name);
        var expected = ReadExpectedError(dir);

        var thrown = Should.Throw<AvroCompileException>(
            () => AvroCompiler.Compile(ReadDocument(dir), ReadOptions(dir)),
            $"case '{name}' was expected to fail with {expected.Kind}");

        thrown.Kind.ToString().ShouldBe(expected.Kind, $"case '{name}' raised the wrong error kind");
        thrown.Path.ShouldBe(expected.Path, $"case '{name}' reported the wrong JSON Pointer");
        thrown.Message.ShouldBe(expected.Message, $"case '{name}' reported the wrong message");
    }

    /// <summary>
    /// The corpus is not empty and has not shrunk unnoticed.
    /// </summary>
    /// <remarks>
    /// A harness that discovers its own cases will pass perfectly while running
    /// none of them if the discovery ever breaks.
    /// </remarks>
    [Fact]
    public void FindsTheWholeCorpus()
    {
        Cases("valid").Count.ShouldBeGreaterThanOrEqualTo(34);
        Cases("invalid").Count.ShouldBeGreaterThanOrEqualTo(10);
    }

    // -- corpus plumbing -------------------------------------------------------

    private static TheoryData<string> Cases(string group)
    {
        var data = new TheoryData<string>();
        foreach (var name in CaseNames(group))
        {
            data.Add(name);
        }
        return data;
    }

    private static IEnumerable<string> CaseNames(string group) =>
        Directory.GetDirectories(Path.Combine(CorpusRoot, group))
            .Order(StringComparer.Ordinal)
            .Select(Path.GetFileName)
            .Select(name => name!);

    private static string CaseDir(string group, string name) =>
        Path.Combine(CorpusRoot, group, name);

    private static JsonNode ReadDocument(string dir) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "schema.struct.json")))!;

    private static AvroOptions ReadOptions(string dir)
    {
        var path = Path.Combine(dir, "options.json");
        if (!File.Exists(path))
        {
            return AvroOptions.Default;
        }

        var node = JsonNode.Parse(File.ReadAllText(path))!.AsObject();

        var uses = node["uses"] is JsonArray items
            ? items.Select(i => i!.GetValue<string>()).ToList()
            : [];

        var additional = node["additionalProperties"]?.GetValue<string>() switch
        {
            "error" => AdditionalPropertiesPolicy.Error,
            _ => AdditionalPropertiesPolicy.Ignore,
        };

        var emitDoc = node["emitDoc"]?.GetValue<bool>() ?? true;

        return new AvroOptions
        {
            Uses = uses,
            AdditionalProperties = additional,
            EmitDoc = emitDoc,
        };
    }

    private static (string Kind, string? Path, string Message) ReadExpectedError(string dir)
    {
        string? kind = null;
        string? path = null;
        string? message = null;

        foreach (var line in Normalize(File.ReadAllText(Path.Combine(dir, "expected-error.txt")))
                     .Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var cut = line.IndexOf(':');
            if (cut < 0)
            {
                continue;
            }
            var key = line[..cut].Trim();
            var value = line[(cut + 1)..].Trim();
            switch (key)
            {
                case "kind": kind = value; break;
                case "path": path = value; break;
                case "message": message = value; break;
            }
        }

        return (
            kind ?? throw new InvalidOperationException($"{dir} has no `kind:` line"),
            path,
            message ?? throw new InvalidOperationException($"{dir} has no `message:` line"));
    }

    /// <summary>
    /// Corpus files are stored with LF endings; git may hand them back with CRLF
    /// on Windows, which would fail a byte comparison for no real reason.
    /// </summary>
    private static string Normalize(string text) => text.Replace("\r\n", "\n");

    private static string CorpusRoot { get; } = FindCorpus();

    private static string FindCorpus()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null)
        {
            var candidate = Path.Combine(dir, "test-assets", "avro");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }
            dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
        }

        throw new InvalidOperationException(
            "could not locate test-assets/avro by walking up from " + AppContext.BaseDirectory);
    }
}
