using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avro;
using Avro.Generic;

namespace JsonStructure.Avro.Tests;

/// <summary>
/// Reads the Avro JSON encoding into the datum shapes Apache.Avro's generic
/// writer expects.
/// </summary>
/// <remarks>
/// <para>
/// Apache.Avro ships a <c>JsonDecoder</c> that does this, and the harness uses it
/// wherever it can. It cannot be used everywhere: its parser throws a
/// <see cref="NullReferenceException"/> on any schema containing a recursive type
/// reference. That is a limitation of the library and not of the compiled schema —
/// a hand-written recursive <c>.avsc</c>, with no involvement from this project at
/// all, fails in exactly the same place.
/// </para>
/// <para>
/// Rather than drop the recursive cases from the round-trip check, the harness
/// decodes with this reader and, where <c>JsonDecoder</c> also works, asserts the
/// two decodes serialize to identical bytes. That keeps a real library on the
/// critical path for most of the corpus while still moving bytes for all of it.
/// </para>
/// </remarks>
internal static class AvroJson
{
    /// <summary>Decodes <paramref name="json"/> as an instance of <paramref name="schema"/>.</summary>
    public static object? Decode(Schema schema, JsonNode? json) => schema.Tag switch
    {
        Schema.Type.Null => json is null
            ? null
            : throw Bad(schema, json, "expected null"),

        Schema.Type.Boolean => json!.GetValue<bool>(),
        Schema.Type.Int => json!.GetValue<int>(),
        Schema.Type.Long => json!.GetValue<long>(),
        Schema.Type.Float => json!.GetValue<float>(),
        Schema.Type.Double => json!.GetValue<double>(),
        Schema.Type.String => json!.GetValue<string>(),

        // Avro JSON writes bytes as a string whose code points are the byte
        // values — Latin-1, not UTF-8.
        Schema.Type.Bytes => Encoding.Latin1.GetBytes(json!.GetValue<string>()),

        Schema.Type.Enumeration => new GenericEnum((EnumSchema)schema, json!.GetValue<string>()),
        Schema.Type.Array => DecodeArray((ArraySchema)schema, json),
        Schema.Type.Map => DecodeMap((MapSchema)schema, json),
        Schema.Type.Record => DecodeRecord((RecordSchema)schema, json),
        Schema.Type.Union => DecodeUnion((UnionSchema)schema, json),

        _ => throw Bad(schema, json, $"unsupported schema type {schema.Tag}"),
    };

    private static object DecodeArray(ArraySchema schema, JsonNode? json)
    {
        var items = json as JsonArray ?? throw Bad(schema, json, "expected an array");
        return items.Select(item => Decode(schema.ItemSchema, item)).ToArray();
    }

    private static object DecodeMap(MapSchema schema, JsonNode? json)
    {
        var entries = json as JsonObject ?? throw Bad(schema, json, "expected an object");
        var map = new Dictionary<string, object?>();
        foreach (var (key, value) in entries)
        {
            map[key] = Decode(schema.ValueSchema, value);
        }
        return map;
    }

    private static object DecodeRecord(RecordSchema schema, JsonNode? json)
    {
        var fields = json as JsonObject ?? throw Bad(schema, json, "expected an object");
        var record = new GenericRecord(schema);

        foreach (var field in schema.Fields)
        {
            if (fields.TryGetPropertyValue(field.Name, out var value))
            {
                record.Add(field.Name, Decode(field.Schema, value));
            }
            else if (field.DefaultValue is not null)
            {
                record.Add(field.Name, Decode(field.Schema, ToNode(field.DefaultValue)));
            }
            else
            {
                throw Bad(schema, json, $"field `{field.Name}` is absent and has no default");
            }
        }

        foreach (var (key, _) in fields)
        {
            if (!schema.Fields.Any(f => f.Name == key))
            {
                throw Bad(schema, json, $"`{key}` is not a field of {schema.Fullname}");
            }
        }

        return record;
    }

    /// <summary>
    /// Reads the tagged form the Avro JSON encoding uses for unions.
    /// </summary>
    /// <remarks>
    /// The tag is what makes this encoding unambiguous, and it is the part a
    /// structural "try each branch until one fits" decoder gets wrong: two record
    /// branches with compatible shapes are indistinguishable without it. The tag
    /// is the branch's type name — the fullname for a named type, the bare type
    /// name for everything else — and <c>null</c> is written bare.
    /// </remarks>
    private static object? DecodeUnion(UnionSchema schema, JsonNode? json)
    {
        if (json is null)
        {
            return schema.Schemas.Any(b => b.Tag == Schema.Type.Null)
                ? null
                : throw Bad(schema, json, "null is not a branch of this union");
        }

        var wrapper = json as JsonObject
            ?? throw Bad(schema, json, "a non-null union value must be tagged: {\"<branch>\": value}");

        if (wrapper.Count != 1)
        {
            throw Bad(schema, json, $"a tagged union value must have exactly one key, found {wrapper.Count}");
        }

        var (tag, tagged) = wrapper.First();

        foreach (var branch in schema.Schemas)
        {
            if (Tag(branch) == tag)
            {
                return Decode(branch, tagged);
            }
        }

        throw Bad(
            schema,
            json,
            $"`{tag}` is not a branch of this union; expected one of "
            + string.Join(", ", schema.Schemas.Select(Tag)));
    }

    private static string Tag(Schema branch) => branch switch
    {
        NamedSchema named => named.Fullname,
        _ => branch.Name,
    };

    private static JsonNode? ToNode(Newtonsoft.Json.Linq.JToken token) =>
        token.Type == Newtonsoft.Json.Linq.JTokenType.Null
            ? null
            : JsonNode.Parse(token.ToString(Newtonsoft.Json.Formatting.None));

    private static InvalidOperationException Bad(Schema schema, JsonNode? json, string what) =>
        new($"{what} (schema: {schema.Name}, json: {json?.ToJsonString() ?? "null"})");
}
