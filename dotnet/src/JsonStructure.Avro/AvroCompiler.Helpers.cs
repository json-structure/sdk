using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace JsonStructure.Avro;

/// <summary>
/// Small accessors over <see cref="JsonNode"/> that return <c>null</c> rather
/// than throwing on a type mismatch.
/// </summary>
/// <remarks>
/// The compiler reads an untrusted document and reports problems with a JSON
/// Pointer, so it needs to ask "is this a string?" without an exception being
/// the answer. Note the trap these wrap: System.Text.Json represents JSON
/// <c>null</c> as a C# <c>null</c> node, so a missing member and a member
/// explicitly set to <c>null</c> are indistinguishable through the indexer.
/// Anywhere that distinction matters the compiler calls
/// <see cref="JsonObject.TryGetPropertyValue(string, out JsonNode)"/> directly.
/// </remarks>
internal static class Js
{
    /// <summary>Compact JSON, escaped the way serde_json escapes.</summary>
    /// <remarks>
    /// Only <c>"</c>, <c>\</c> and the control characters. The default
    /// System.Text.Json encoder also escapes <c>&lt;</c>, <c>&gt;</c>, <c>&amp;</c>,
    /// <c>'</c>, <c>+</c> and every non-ASCII character, which would put this
    /// implementation's error messages and output out of step with the reference
    /// implementation's for no benefit.
    /// </remarks>
    internal static readonly JsonSerializerOptions Compact_ = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    /// <summary>Pretty JSON: two-space indent, matching <c>serde_json::to_string_pretty</c>.</summary>
    /// <remarks>
    /// <see cref="JsonSerializerOptions.WriteIndented"/> breaks lines with
    /// <see cref="Environment.NewLine"/>, which is CRLF on Windows. The expected
    /// <c>.avsc</c> files are LF, so <see cref="AvroCompiler.ToAvsc"/> normalizes
    /// afterwards rather than depending on a writer option that only exists from
    /// .NET 9 onward.
    /// </remarks>
    internal static readonly JsonSerializerOptions Pretty = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = true,
    };

    internal static JsonNode? Get(JsonNode? node, string key) =>
        node is JsonObject map && map.TryGetPropertyValue(key, out var value) ? value : null;

    internal static JsonObject? Obj(JsonNode? node) => node as JsonObject;

    internal static JsonArray? Arr(JsonNode? node) => node as JsonArray;

    internal static string? Str(JsonNode? node) =>
        node?.GetValueKind() == JsonValueKind.String ? node.GetValue<string>() : null;

    internal static bool? Bool(JsonNode? node) => node?.GetValueKind() switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null,
    };

    /// <summary>Renders a node for an error message. JSON <c>null</c> renders as <c>null</c>.</summary>
    internal static string Compact(JsonNode? node) =>
        node is null ? "null" : node.ToJsonString(Compact_);
}

public static partial class AvroCompiler
{
    /// <summary>
    /// Serializes a compiled schema the way the conformance corpus is written:
    /// two-space indent, a trailing newline, and no gratuitous escaping.
    /// </summary>
    /// <param name="schema">A schema produced by <see cref="Compile(JsonNode)"/>.</param>
    /// <returns>The <c>.avsc</c> text.</returns>
    /// <remarks>
    /// Byte-for-byte agreement with the other SDKs is a conformance requirement,
    /// not a nicety — see §7 of the mapping spec — so the exact writer settings
    /// are part of the contract and live here rather than at each call site.
    /// That includes the line ending: LF, on every platform. A raw CR can only
    /// come from the indenting writer, never from the content, because a carriage
    /// return inside a JSON string is written as the two-character escape
    /// <c>\r</c>.
    /// </remarks>
    public static string ToAvsc(JsonNode schema)
    {
        ArgumentNullException.ThrowIfNull(schema);
        return schema.ToJsonString(Js.Pretty).Replace("\r\n", "\n") + "\n";
    }

    /// <summary>The primitive mapping table of §2. <c>null</c> means the name is not a primitive.</summary>
    private static string? AvroPrimitive(string typeName) => typeName switch
    {
        "null" => "null",
        "boolean" => "boolean",
        "string" => "string",
        "number" => "double",
        "integer" or "int8" or "int16" or "int32" or "uint8" or "uint16" => "int",
        "int64" or "uint32" => "long",
        // Lossless by construction: these exceed a signed 64-bit range or have
        // no bounded binary form, so they travel in their lexical form (§2.2).
        "int128" or "uint64" or "uint128" => "string",
        "float8" or "float" => "float",
        "double" => "double",
        // Avro has no offset-carrying temporal type; RFC 3339 text keeps it.
        "date" or "time" or "datetime" or "duration" => "string",
        "uuid" or "uri" or "jsonpointer" => "string",
        "binary" => "bytes",
        // §2.3: the base for Avro's own `decimal` logical type, in both modes.
        // `DecimalValue` may still fall back to `string` when the declaration
        // gives Avro nothing it can work with.
        "decimal" => "bytes",
        _ => null,
    };

    /// <summary>
    /// The <c>full</c>-mode annotation for a primitive (§2.5), or <c>null</c>
    /// where the mode adds nothing. Purely additive: it rides on top of the
    /// base type <see cref="AvroPrimitive"/> already chose.
    /// </summary>
    /// <remarks>
    /// The <c>rfc3339-*</c> names are Avrotize's extension, and are not
    /// reserved Avro logical types. That is exactly the point: a reader that
    /// does not know the name sees the <c>string</c> base and is correct, so
    /// the two modes describe byte-identical data.
    /// </remarks>
    private static string? AvroLogical(string typeName) => typeName switch
    {
        "date" => "rfc3339-date",
        "time" => "rfc3339-time-micros",
        "datetime" => "rfc3339-timestamp-micros",
        "duration" => "rfc3339-duration",
        "uuid" => "uuid",
        _ => null,
    };

    /// <summary>
    /// The keywords §6.4.1 carries in the <c>annotations</c> attribute in
    /// <c>full</c> mode, in their fixed emission order.
    /// </summary>
    /// <remarks>
    /// Three groups, in this order: the constraints Avro's type system cannot
    /// express, the unit and symbol annotations of JSON Structure Units, and
    /// the semantic annotations that carry no property names. The order is
    /// fixed rather than derived from the source document so that two
    /// conforming implementations emit the same bytes.
    /// </remarks>
    private static readonly string[] AnnotationKeywords =
    [
        // Constraints (JSON Structure Core and Validation).
        "maxLength",
        "minLength",
        "precision",
        "scale",
        "pattern",
        "minimum",
        "maximum",
        "contentEncoding",
        "contentMediaType",
        "contentCompression",
        // Symbols, units, and currencies.
        "symbol",
        "symbols",
        "unit",
        "ucumUnit",
        "currency",
        // Semantic annotations whose values are self-contained.
        "concepts",
        "observedProperty",
        "semanticRole",
        "derivation",
        "statistic",
        "phenomenonTimeRelation",
        "supportPeriod",
        "cadence",
        "codedValues",
        "measurementConditioning",
    ];

    /// <summary>
    /// The semantic annotations that bind <em>property names</em> of the type
    /// they annotate, and are therefore dropped with a warning rather than
    /// copied.
    /// </summary>
    /// <remarks>
    /// <c>coordinateReferenceSystem</c>, for instance, carries a
    /// <c>coordinates</c> array naming the properties that form a coordinate.
    /// Those are JSON Structure property names, and JSON Structure Semantic
    /// Annotations is explicit that an alternate name does not change the
    /// identity an annotation binds. Avro is the renamed world:
    /// <c>altnames.avro</c> and the name rules of §6 mean a field can reach the
    /// schema under a different name, or as a member of a different record
    /// after flattening. Copying the annotation verbatim would leave it naming
    /// fields that do not exist, silently, which is worse than not carrying it
    /// at all.
    /// </remarks>
    private static readonly string[] NameBindingAnnotations =
    [
        "coordinateReferenceSystem",
        "vectorReferenceFrames",
        "tensorReferenceFrames",
        "frameTransforms",
        "linearReferenceSystem",
        "colorSpaces",
        "audioChannels",
        "spectralBands",
        "temporalReferenceSystem",
        "referenceRole",
    ];

    /// <summary>
    /// Whether this declaration's <c>precision</c> and <c>scale</c> reached the
    /// wire as Avro <c>decimal</c> attributes, in which case §6.4.1 forbids
    /// repeating them.
    /// </summary>
    /// <remarks>
    /// Mirrors the fallback conditions of <c>DecimalValue</c>: a <c>decimal</c>
    /// with no <c>precision</c>, or a <c>scale</c> above it, is carried as a
    /// lexical string and its constraints are annotated like anyone else's.
    /// </remarks>
    private static bool CarriesDecimalConstraints(JsonObject decl)
    {
        if (Js.Str(Js.Get(decl, "type")) != "decimal")
        {
            return false;
        }
        if (Unsigned(Js.Get(decl, "precision")) is not { } precision)
        {
            return false;
        }
        return (Unsigned(Js.Get(decl, "scale")) ?? 0) <= precision;
    }

    /// <summary>Reads a JSON node as an unsigned integer, or <c>null</c>.</summary>
    private static ulong? Unsigned(JsonNode? node) =>
        node?.GetValueKind() == JsonValueKind.Number && node.AsValue().TryGetValue<ulong>(out var value)
            ? value
            : null;

    /// <summary>Avro identifier rule, which is also JSON Structure's identifier rule.</summary>
    private static bool IsAvroName(string name)
    {
        if (name.Length == 0)
        {
            return false;
        }
        var first = name[0];
        if (!(char.IsAsciiLetter(first) || first == '_'))
        {
            return false;
        }
        for (var i = 1; i < name.Length; i++)
        {
            var c = name[i];
            if (!(char.IsAsciiLetterOrDigit(c) || c == '_'))
            {
                return false;
            }
        }
        return true;
    }

    private static string Qualify(string ns, string name) =>
        ns.Length == 0 ? name : $"{ns}.{name}";

    private static string DefinitionPointer(IReadOnlyList<string> path) =>
        path.Count == 0 ? "#/definitions" : $"#/definitions/{string.Join("/", path)}";

    private static List<string>? DefinitionPath(string pointer)
    {
        const string Prefix = "#/definitions/";
        if (!pointer.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return null;
        }
        var rest = pointer[Prefix.Length..];
        return rest.Length == 0 ? null : [.. rest.Split('/')];
    }

    private static List<string> PointerList(JsonNode? value, string path)
    {
        if (Js.Str(value) is { } single)
        {
            return [single];
        }

        if (Js.Arr(value) is { } items)
        {
            var result = new List<string>(items.Count);
            foreach (var item in items)
            {
                result.Add(Js.Str(item)
                    ?? throw AvroCompileException.Invalid(
                        "`$extends` entries must be JSON Pointers", path));
            }
            return result;
        }

        throw AvroCompileException.Invalid(
            "`$extends` must be a JSON Pointer or an array of them", path);
    }

    /// <summary>
    /// Core lets <c>required</c> be either a flat list of names or a list of
    /// <em>alternative</em> sets, any one of which satisfies the type. Neither
    /// Avro nor Protobuf can express that disjunction.
    /// </summary>
    /// <remarks>
    /// The sound reduction is the <strong>intersection</strong>: a property in
    /// every alternative is present no matter which alternative holds, so it can
    /// be a non-null field. A property in only some alternatives may legitimately
    /// be absent, so it must stay optional. Taking the union instead would emit
    /// non-null fields for data that is allowed to omit them, which fails at write
    /// time; dropping the keyword quietly retypes every field in the record.
    /// </remarks>
    private static (HashSet<string> Required, string? Note) RequiredSet(JsonObject decl)
    {
        if (Js.Arr(Js.Get(decl, "required")) is not { } items)
        {
            return (new HashSet<string>(StringComparer.Ordinal), null);
        }

        var alternatives = new List<HashSet<string>>();
        foreach (var item in items)
        {
            if (Js.Arr(item) is not { } set)
            {
                continue;
            }
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in set)
            {
                if (Js.Str(entry) is { } name)
                {
                    names.Add(name);
                }
            }
            alternatives.Add(names);
        }

        if (alternatives.Count == 0)
        {
            var flat = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in items)
            {
                if (Js.Str(item) is { } name)
                {
                    flat.Add(name);
                }
            }
            return (flat, null);
        }

        var intersection = new HashSet<string>(alternatives[0], StringComparer.Ordinal);
        for (var i = 1; i < alternatives.Count; i++)
        {
            intersection.IntersectWith(alternatives[i]);
        }

        var shared = intersection.ToList();
        shared.Sort(StringComparer.Ordinal);
        var note =
            $"`required` declares {alternatives.Count} alternative sets; the target has no way "
            + "to express that choice. Only the properties common to every alternative "
            + $"[{string.Join(", ", shared)}] are emitted as non-null, and the alternatives are "
            + "not enforced on the wire";
        return (intersection, note);
    }

    /// <summary>
    /// Every <c>selector</c> name belonging to an inline union anywhere in the
    /// document. Core permits an inline union's selector to shadow a base-type
    /// property, so these names are exempt from the no-redefinition rule.
    /// </summary>
    private static HashSet<string> CollectSelectors(JsonNode? doc)
    {
        var found = new HashSet<string>(StringComparer.Ordinal);
        Walk(doc, found);
        return found;

        static void Walk(JsonNode? node, HashSet<string> outNames)
        {
            switch (node)
            {
                case JsonObject map:
                    if (map.ContainsKey("$extends") && Js.Str(Js.Get(map, "selector")) is { } selector)
                    {
                        outNames.Add(selector);
                    }
                    foreach (var (_, value) in map)
                    {
                        Walk(value, outNames);
                    }
                    break;

                case JsonArray items:
                    foreach (var value in items)
                    {
                        Walk(value, outNames);
                    }
                    break;
            }
        }
    }

    private static JsonObject EmptyRecord(string name, string ns)
    {
        var outNode = new JsonObject
        {
            ["type"] = "record",
            ["name"] = name,
        };
        if (ns.Length > 0)
        {
            outNode["namespace"] = ns;
        }
        outNode["fields"] = new JsonArray();
        return outNode;
    }

    /// <summary>
    /// Whether this node declares a type, as opposed to being a namespace holding
    /// further definitions.
    /// </summary>
    private static bool IsTypeDeclaration(JsonObject node) =>
        node.ContainsKey("type") || node.ContainsKey("$extends") || node.ContainsKey("abstract");

    private static bool IsNullBranch(JsonNode? value) => Js.Str(value) == "null";

    private static List<JsonNode> FlattenUnion(JsonNode value)
    {
        if (value is not JsonArray items)
        {
            return [value];
        }

        var flat = new List<JsonNode>();
        foreach (var item in items.ToList())
        {
            if (item is null)
            {
                continue;
            }
            flat.AddRange(FlattenUnion(item.DeepClone()));
        }
        return flat;
    }

    /// <summary>
    /// Positions <paramref name="defaultValue"/> so that Avro will accept it,
    /// reordering <paramref name="branches"/> if it has to, and rejects it if no
    /// branch can hold it.
    /// </summary>
    /// <remarks>
    /// Avro checks a field default against exactly one schema: the first branch of
    /// a union, or the type itself when there is no union. That is a placement
    /// rule, not a value rule, so a default naming some other branch is fixed by
    /// moving the branch, not by dropping the default. Emitting the default anyway
    /// is the dangerous option — the schema parses cleanly and the failure surfaces
    /// much later as a resolution error against real data.
    /// <para>
    /// A JSON Structure tagged-union default arrives as <c>{"&lt;branch&gt;": value}</c>;
    /// the tag is consumed here because Avro writes a union default as the bare
    /// value of its first branch.
    /// </para>
    /// </remarks>
    private static JsonNode? PlaceDefault(List<JsonNode> branches, JsonNode? defaultValue, string pointer)
    {
        // A tagged default names its branch outright, which is more reliable than
        // inferring one from the JSON shape.
        if (branches.Count > 1 && defaultValue is JsonObject map && map.Count == 1)
        {
            var (tag, tagged) = map.First();
            var index = branches.FindIndex(b => BranchTag(b) == tag);
            if (index >= 0)
            {
                var inner = tagged?.DeepClone();
                // A branch whose Avro name did not already match the choice key was
                // wrapped in a single-field record (§3.7.1), so the default has to be
                // wrapped the same way.
                if (!DefaultMatches(branches[index], inner) && IsBranchWrapper(branches[index]))
                {
                    inner = new JsonObject { ["value"] = inner };
                }
                if (!DefaultMatches(branches[index], inner))
                {
                    throw RejectDefault(inner, branches, pointer);
                }
                RotateToFront(branches, index);
                return inner;
            }
        }

        var match = branches.FindIndex(b => DefaultMatches(b, defaultValue));
        if (match < 0)
        {
            throw RejectDefault(defaultValue, branches, pointer);
        }
        RotateToFront(branches, match);
        return defaultValue?.DeepClone();
    }

    /// <summary>Moves the branch at <paramref name="index"/> to the front, keeping the rest in order.</summary>
    private static void RotateToFront(List<JsonNode> branches, int index)
    {
        if (index <= 0)
        {
            return;
        }
        var branch = branches[index];
        branches.RemoveAt(index);
        branches.Insert(0, branch);
    }

    private static AvroCompileException RejectDefault(
        JsonNode? value,
        List<JsonNode> branches,
        string pointer)
    {
        var tags = branches.Select(b => BranchTag(b) ?? "?");
        return AvroCompileException.Invalid(
            $"`default` {Js.Compact(value)} matches no branch of the generated Avro type "
            + $"[{string.Join(", ", tags)}]; Avro validates a default against the first branch only",
            pointer);
    }

    /// <summary>
    /// Whether this branch is the single-field record §3.7.1 generates for a
    /// choice key that did not already name an Avro type.
    /// </summary>
    private static bool IsBranchWrapper(JsonNode branch)
    {
        if (Js.Obj(branch) is not { } map || Js.Str(Js.Get(map, "type")) != "record")
        {
            return false;
        }
        if (Js.Arr(Js.Get(map, "fields")) is not { } fields || fields.Count != 1)
        {
            return false;
        }
        return Js.Str(Js.Get(fields[0], "name")) == "value";
    }

    /// <summary>
    /// The name a tagged union value would use for this branch: the unqualified
    /// Avro name.
    /// </summary>
    private static string? BranchTag(JsonNode? branch)
    {
        string? name;
        if (Js.Str(branch) is { } literal)
        {
            name = literal;
        }
        else if (Js.Obj(branch) is { } map)
        {
            name = Js.Str(Js.Get(map, "name")) ?? Js.Str(Js.Get(map, "type"));
        }
        else
        {
            return null;
        }

        if (name is null)
        {
            return null;
        }
        var cut = name.LastIndexOf('.');
        return cut < 0 ? name : name[(cut + 1)..];
    }

    /// <summary>Whether a JSON default <em>could</em> be an Avro value of this schema.</summary>
    /// <remarks>
    /// Deliberately structural rather than exhaustive: it catches the mismatches
    /// that corrupt reads — an object where a number belongs, a tagged union value
    /// left wrapped — without reimplementing Avro's validator.
    /// </remarks>
    private static bool DefaultMatches(JsonNode branch, JsonNode? defaultValue)
    {
        string typeName;
        if (Js.Str(branch) is { } literal)
        {
            typeName = literal;
        }
        else if (Js.Obj(branch) is { } map)
        {
            if (Js.Str(Js.Get(map, "type")) is not { } declared)
            {
                // A nested union in a branch position; Avro forbids it, and
                // FlattenUnion has already removed it.
                return true;
            }
            typeName = declared;
        }
        else
        {
            // An array here is a union, which FlattenUnion has already removed.
            return true;
        }

        var kind = defaultValue?.GetValueKind() ?? JsonValueKind.Null;
        return typeName switch
        {
            "null" => kind == JsonValueKind.Null,
            "boolean" => kind is JsonValueKind.True or JsonValueKind.False,
            "int" or "long" => IsIntegral(defaultValue),
            "float" or "double" => kind == JsonValueKind.Number,
            // Avro encodes `bytes` and `fixed` defaults as strings.
            "string" or "bytes" or "fixed" or "enum" => kind == JsonValueKind.String,
            "array" => kind == JsonValueKind.Array,
            "record" or "map" => kind == JsonValueKind.Object,
            // A bare name referring to a previously defined type. The definition is
            // not in hand here, so accept anything but a plainly impossible shape.
            _ => true,
        };
    }

    private static bool IsIntegral(JsonNode? node)
    {
        if (node?.GetValueKind() != JsonValueKind.Number)
        {
            return false;
        }
        // Ask the text, not a conversion: `3.0` is a number that is not an Avro
        // `int`, and every numeric CLR conversion would happily round it.
        var text = node.ToJsonString(Js.Compact_);
        return text.IndexOfAny(['.', 'e', 'E']) < 0;
    }

    /// <summary>
    /// Builds a union from <paramref name="branches"/>, deduplicating by Avro
    /// type identity and collapsing a single branch to the bare type (§3.8).
    /// </summary>
    private static JsonNode UnionOf(List<JsonNode> branches)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var kept = new List<JsonNode>();
        foreach (var branch in branches)
        {
            foreach (var flat in FlattenUnion(branch))
            {
                if (seen.Add(TypeKey(flat)))
                {
                    kept.Add(flat);
                }
            }
        }

        if (kept.Count == 1)
        {
            return kept[0];
        }

        var union = new JsonArray();
        foreach (var branch in kept)
        {
            union.Add(branch);
        }
        return union;
    }

    /// <summary>
    /// Identity of an Avro type for union deduplication. Named types are
    /// identified by their fully-qualified name so a definition and a later
    /// reference to it collapse to one branch.
    /// </summary>
    /// <remarks>
    /// Everything else is identified by its Avro <i>type</i>, which is exactly
    /// the rule Avro states: a union may not hold two schemas of the same type
    /// unless they are <c>record</c>, <c>enum</c>, or <c>fixed</c>. That matters
    /// in <c>full</c> mode, where an annotated <c>date</c> would otherwise sit
    /// beside a plain <c>string</c> in a union no Avro parser will accept.
    /// </remarks>
    private static string TypeKey(JsonNode value)
    {
        if (Js.Str(value) is { } literal)
        {
            return literal;
        }

        if (Js.Obj(value) is { } map && Js.Str(Js.Get(map, "type")) is { } typeName)
        {
            if (typeName is "record" or "enum" or "fixed")
            {
                var name = Js.Str(Js.Get(map, "name")) ?? string.Empty;
                var ns = Js.Str(Js.Get(map, "namespace")) ?? string.Empty;
                return Qualify(ns, name);
            }
            return typeName;
        }

        return Js.Compact(value);
    }

    /// <summary>The unqualified Avro name of a compiled type, if it has one.</summary>
    private static string? UnqualifiedName(JsonNode value)
    {
        if (Js.Str(value) is { } literal)
        {
            var cut = literal.LastIndexOf('.');
            return cut < 0 ? literal : literal[(cut + 1)..];
        }
        return Js.Obj(value) is { } map ? Js.Str(Js.Get(map, "name")) : null;
    }
}
