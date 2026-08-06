using System.Text.Json;
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

    /// <summary>Check 1: the compiled schema matches the expected file, byte for byte.</summary>
    [Theory]
    [MemberData(nameof(ValidCases))]
    public void CompilesToTheExpectedSchema(string name)
    {
        var dir = CaseDir("valid", name);
        var result = AvroCompiler.Compile(ReadDocument(dir), ReadOptions(dir));
        var actual = AvroCompiler.ToAvsc(result.Schema);
        var expected = Normalize(File.ReadAllText(Path.Combine(dir, "expected.avsc")));

        actual.ShouldBe(
            expected,
            $"case '{name}' does not match its expected .avsc. Attribute order is part of the "
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
    /// This is the one check a blessed expected file cannot perform. <c>expected.avsc</c>
    /// proves this implementation agrees with the reference; it cannot prove the
    /// reference is right, because the expected file was blessed from it. The instance is
    /// written against what the <em>source document</em> means, so a schema that is
    /// self-consistent but wrong fails here.
    /// <para>
    /// The bytes are then compared against <c>expected.avro.b64</c>, which the Rust
    /// harness blessed from the same instance. That is what keeps this honest: a
    /// round trip only proves this SDK agrees with itself, while the pinned bytes
    /// prove the two SDKs read the same instance the same way and hand Avro the
    /// same datum. Cases containing a <c>map</c> are exempt, because Avro writes
    /// map entries in iteration order and no two implementations need agree on it.
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

        if (TryReadPinnedBytes(dir, out var pinned))
        {
            Convert.ToBase64String(bytes).ShouldBe(
                pinned,
                $"case '{name}' encoded to different bytes than expected.avro.b64, which the "
                + "Rust harness blessed from the same instance. Either the two decoders read "
                + "the Plain JSON encoding differently, or the two compilers emit different "
                + "schemas");
            Interlocked.Increment(ref _pinned);
        }
        else
        {
            ContainsMap(schema).ShouldBeTrue(
                $"case '{name}' has no expected.avro.b64 but contains no map either. Only "
                + "map-bearing cases may skip the pinned bytes; bless the rest from the Rust "
                + "harness");
            Interlocked.Increment(ref _unordered);
        }
    }

    /// <summary>
    /// The pinned-bytes check has not quietly stopped happening.
    /// </summary>
    /// <remarks>
    /// A check wrapped in "if there is an expected file for it" degrades silently to no
    /// check at all when the expected files go missing, so both sides of that condition
    /// are counted and asserted. The same trap has fired twice in this corpus
    /// already.
    /// </remarks>
    [Fact]
    public void PinsTheEncodedBytesOfMostInstances()
    {
        foreach (var name in CaseNames("valid"))
        {
            RoundTripsItsInstanceThroughAvro(name);
        }

        _pinned.ShouldBeGreaterThan(0, "no case pinned its encoded bytes");
        _unordered.ShouldBeGreaterThan(
            0, "no case contains a map any more, so the exemption above is dead code");
    }

    private static int _pinned;
    private static int _unordered;

    private static bool TryReadPinnedBytes(string dir, out string base64)
    {
        var path = Path.Combine(dir, "expected.avro.b64");
        base64 = File.Exists(path) ? File.ReadAllText(path).Trim() : string.Empty;
        return base64.Length > 0;
    }

    /// <summary>
    /// Whether a schema contains a <c>map</c> anywhere, and so has no stable byte
    /// encoding.
    /// </summary>
    /// <remarks>
    /// Walking the serialized JSON is simpler, and more obviously exhaustive, than
    /// walking every <see cref="Schema"/> subclass.
    /// </remarks>
    private static bool ContainsMap(Schema schema)
    {
        static bool Walk(JsonNode? node) => node switch
        {
            JsonObject obj =>
                obj.TryGetPropertyValue("type", out var type)
                && type?.GetValueKind() == JsonValueKind.String
                && type.GetValue<string>() == "map"
                || obj.Any(entry => Walk(entry.Value)),
            JsonArray items => items.Any(Walk),
            _ => false,
        };

        return Walk(JsonNode.Parse(schema.ToString()));
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
        Cases("valid").Count.ShouldBeGreaterThanOrEqualTo(39);
        Cases("invalid").Count.ShouldBeGreaterThanOrEqualTo(10);
    }

    /// <summary>
    /// <c>full</c> mode adds metadata and changes nothing else.
    /// </summary>
    /// <remarks>
    /// Strip everything the mode is allowed to add — <c>doc</c>, and a
    /// <c>logicalType</c> that is not <c>decimal</c>, which §2.3 emits in both
    /// modes — and the two schemas must be the same bytes. Anything left over is
    /// a wire change the mode was never allowed to make.
    /// </remarks>
    [Theory]
    [MemberData(nameof(ValidCases))]
    public void FullModeOnlyAddsMetadata(string name)
    {
        var dir = CaseDir("valid", name);
        var document = ReadDocument(dir);
        var options = ReadOptions(dir);

        var compact = AvroCompiler.Compile(document, WithMode(options, AvroMode.Compact));
        var full = AvroCompiler.Compile(document, WithMode(options, AvroMode.Full));

        AvroCompiler.ToAvsc(Strip(full.Schema.DeepClone())).ShouldBe(
            AvroCompiler.ToAvsc(Strip(compact.Schema.DeepClone())),
            $"case '{name}': full mode changed the wire format, not just the metadata");

        // Warnings describe lost information, which is a property of the
        // document rather than of how much metadata was asked for.
        full.Warnings.Select(w => w.ToString()).ShouldBe(
            compact.Warnings.Select(w => w.ToString()),
            $"case '{name}': the two modes disagreed about what was lost");
    }

    private static AvroOptions WithMode(AvroOptions options, AvroMode mode) => new()
    {
        Uses = options.Uses,
        AdditionalProperties = options.AdditionalProperties,
        EmitDoc = options.EmitDoc,
        Mode = mode,
    };

    /// <summary>
    /// Rebuilds <paramref name="value"/> without anything <c>full</c> mode is
    /// allowed to add — <c>doc</c>, the <c>annotations</c> constraint
    /// attribute, and a non-<c>decimal</c> <c>logicalType</c>. Builds a new tree
    /// rather than editing in place: a <see cref="JsonNode"/> carries a parent
    /// pointer, so reassigning one into the tree it already belongs to throws.
    /// </summary>
    private static JsonNode? Strip(JsonNode? value)
    {
        if (value is JsonArray items)
        {
            var outItems = new JsonArray();
            foreach (var item in items)
            {
                outItems.Add(Strip(item?.DeepClone()));
            }
            return outItems;
        }

        if (value is not JsonObject map)
        {
            return value;
        }

        var outMap = new JsonObject();
        foreach (var (key, child) in map)
        {
            if (key is "doc" or "annotations")
            {
                continue;
            }
            // `decimal` is not a `full`-mode annotation -- §2.3 emits it in both
            // modes -- so it and its `precision` and `scale` stay.
            if (key == "logicalType"
                && (child as JsonValue)?.GetValue<string>() != "decimal")
            {
                continue;
            }
            outMap[key] = Strip(child?.DeepClone());
        }

        // An annotation-only object collapses back to its base type, which is
        // how `compact` would have written it in the first place.
        if (outMap.Count == 1 && (outMap["type"] as JsonValue)?.GetValue<string>() is { } baseName)
        {
            return JsonValue.Create(baseName);
        }
        return outMap;
    }
    /// <summary>
    /// The wire-compatibility claim, proved on bytes rather than schema shape.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="FullModeOnlyAddsMetadata"/> checks that the two schemas
    /// <i>look</i> the same once annotations are stripped. This checks what
    /// actually matters: that the same value encodes to the same bytes under
    /// both modes. If that holds, turning <c>full</c> on for a deployed schema
    /// is safe, which is the whole promise.
    /// </para>
    /// <para>
    /// Unlike Rust's <c>apache-avro</c>, which discards a <c>logicalType</c> it
    /// does not recognize, Apache.Avro models every registered name as a
    /// <c>LogicalSchema</c> — so here every annotated case reaches the byte
    /// comparison rather than collapsing into schema equality first.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheTwoModesEncodeIdenticalBytes()
    {
        var compared = 0;

        foreach (var name in CaseNames("valid"))
        {
            var dir = CaseDir("valid", name);
            var document = ReadDocument(dir);
            var options = ReadOptions(dir);

            var compact = JsonStructureAvro.SchemaFrom(document, WithMode(options, AvroMode.Compact));
            var full = JsonStructureAvro.SchemaFrom(document, WithMode(options, AvroMode.Full));
            if (compact.ToString() == full.ToString())
            {
                continue;
            }
            compared++;

            var text = Normalize(File.ReadAllText(Path.Combine(dir, "instance.avro.json"))).Trim();
            var json = JsonNode.Parse(text);

            WriteBinary(full, AvroJson.Decode(full, json)).ShouldBe(
                WriteBinary(compact, AvroJson.Decode(compact, json)),
                $"case '{name}': the two modes encoded the same value to different bytes");
        }

        compared.ShouldBeGreaterThan(
            0,
            "no case exercises a difference between the modes, so this test proves nothing");
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

        var mode = node["mode"]?.GetValue<string>() switch
        {
            "full" => AvroMode.Full,
            _ => AvroMode.Compact,
        };

        return new AvroOptions
        {
            Uses = uses,
            AdditionalProperties = additional,
            EmitDoc = emitDoc,
            Mode = mode,
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
