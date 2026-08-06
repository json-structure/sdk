using System.Globalization;
using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Avro;
using Avro.Generic;
using Avro.Util;

namespace JsonStructure.Avro.Tests;

/// <summary>
/// Reads the corpus instance encoding — "Plain JSON" — into the datum shapes
/// Apache.Avro's generic writer expects.
/// </summary>
/// <remarks>
/// <para>
/// The corpus does not use Avro's own JSON encoding. Avro JSON writes binary as
/// Latin-1 code points, temporals as bare epoch numbers, and every union value
/// wrapped in a single-key object naming the branch — none of which an ordinary
/// JSON producer emits or an ordinary JSON consumer understands. The corpus uses
/// the Plain JSON encoding instead: base64 for binary, RFC 3339 strings for
/// temporals, quoted numbers for <c>long</c> and <c>decimal</c>, and untagged
/// union values resolved by structure.
/// </para>
/// <para>
/// The cost is that no shipping Avro library will read the corpus instances, so
/// Apache.Avro's <c>JsonDecoder</c> can no longer serve as a second opinion on
/// this decoder. The corpus replaces that with something stronger and
/// cross-language: <c>expected.avro.b64</c> pins the bytes each instance must
/// encode to, so this decoder is checked against the Rust one rather than
/// against itself.
/// </para>
/// </remarks>
internal static class AvroJson
{
    /// <summary>Decodes <paramref name="json"/> as an instance of <paramref name="schema"/>.</summary>
    public static object? Decode(Schema schema, JsonNode? json) =>
        TryDecode(schema, json, out var value, out var why)
            ? value
            : throw new InvalidOperationException(why);

    /// <summary>
    /// The fallible core of <see cref="Decode"/>.
    /// </summary>
    /// <remarks>
    /// Failure has to be an ordinary answer rather than an exception, because
    /// Plain JSON drops the union branch tag: the only way to find the branch is
    /// to try them all and see which one fits.
    /// </remarks>
    private static bool TryDecode(Schema schema, JsonNode? json, out object? value, out string why)
    {
        value = null;
        why = string.Empty;

        string Wrong(string what) => $"expected {what}, found {json?.ToJsonString() ?? "null"}";

        switch (schema.Tag)
        {
            case Schema.Type.Null:
                if (json is not null)
                {
                    why = Wrong("null");
                    return false;
                }
                return true;

            case Schema.Type.Boolean:
                if (Kind(json) is not JsonValueKind.True and not JsonValueKind.False)
                {
                    why = Wrong("a boolean");
                    return false;
                }
                value = json!.GetValue<bool>();
                return true;

            case Schema.Type.Int:
                if (!TryLong(json, out var asInt) || asInt is < int.MinValue or > int.MaxValue)
                {
                    why = Wrong("an int");
                    return false;
                }
                value = (int)asInt;
                return true;

            // Feature 3: a `long` travels as a *string* in JSON number syntax,
            // because JSON numbers are only guaranteed to survive to 2^53 and an
            // Avro long runs to 2^63.
            case Schema.Type.Long:
                if (Kind(json) != JsonValueKind.String
                    || !long.TryParse(json!.GetValue<string>(), NumberStyles.Integer,
                        CultureInfo.InvariantCulture, out var asLong))
                {
                    why = Wrong("a long as a quoted number");
                    return false;
                }
                value = asLong;
                return true;

            case Schema.Type.Float:
                if (!TryDouble(json, out var asFloat))
                {
                    why = Wrong("a float");
                    return false;
                }
                value = (float)asFloat;
                return true;

            case Schema.Type.Double:
                if (!TryDouble(json, out var asDouble))
                {
                    why = Wrong("a double");
                    return false;
                }
                value = asDouble;
                return true;

            case Schema.Type.String:
                if (Kind(json) != JsonValueKind.String)
                {
                    why = Wrong("a string");
                    return false;
                }
                value = json!.GetValue<string>();
                return true;

            // Feature 2: bytes are base64, not Avro JSON's Latin-1 code points.
            case Schema.Type.Bytes:
                if (!TryBase64(json, out var bytes))
                {
                    why = Wrong("base64 bytes");
                    return false;
                }
                value = bytes;
                return true;

            case Schema.Type.Fixed:
            {
                var fixedSchema = (FixedSchema)schema;
                if (!TryBase64(json, out var raw))
                {
                    why = Wrong("base64 bytes");
                    return false;
                }
                if (raw.Length != fixedSchema.Size)
                {
                    why = $"fixed({fixedSchema.Fullname}) needs {fixedSchema.Size} bytes, found {raw.Length}";
                    return false;
                }
                value = new GenericFixed(fixedSchema, raw);
                return true;
            }

            case Schema.Type.Enumeration:
            {
                var enumSchema = (EnumSchema)schema;
                if (Kind(json) != JsonValueKind.String)
                {
                    why = Wrong("an enum symbol");
                    return false;
                }
                var symbol = json!.GetValue<string>();
                if (!enumSchema.Symbols.Contains(symbol))
                {
                    why = $"'{symbol}' is not a symbol of {enumSchema.Fullname}";
                    return false;
                }
                value = new GenericEnum(enumSchema, symbol);
                return true;
            }

            case Schema.Type.Array:
            {
                var arraySchema = (ArraySchema)schema;
                if (json is not JsonArray items)
                {
                    why = Wrong("an array");
                    return false;
                }
                var decoded = new object?[items.Count];
                for (var i = 0; i < items.Count; i++)
                {
                    if (!TryDecode(arraySchema.ItemSchema, items[i], out decoded[i], out why))
                    {
                        why = $"item {i}: {why}";
                        return false;
                    }
                }
                value = decoded;
                return true;
            }

            case Schema.Type.Map:
            {
                var mapSchema = (MapSchema)schema;
                if (json is not JsonObject entries)
                {
                    why = Wrong("an object");
                    return false;
                }
                var map = new Dictionary<string, object?>();
                foreach (var (key, child) in entries)
                {
                    if (!TryDecode(mapSchema.ValueSchema, child, out var item, out why))
                    {
                        why = $"entry '{key}': {why}";
                        return false;
                    }
                    map[key] = item;
                }
                value = map;
                return true;
            }

            case Schema.Type.Record:
                return TryDecodeRecord((RecordSchema)schema, json, out value, out why);

            case Schema.Type.Union:
                return TryDecodeUnion((UnionSchema)schema, json, out value, out why);

            case Schema.Type.Logical:
                return TryDecodeLogical((LogicalSchema)schema, json, out value, out why);

            default:
                why = $"unsupported schema type {schema.Tag}";
                return false;
        }
    }

    private static bool TryDecodeRecord(RecordSchema schema, JsonNode? json, out object? value, out string why)
    {
        value = null;
        why = string.Empty;

        if (json is not JsonObject entries)
        {
            why = $"expected an object, found {json?.ToJsonString() ?? "null"}";
            return false;
        }

        var record = new GenericRecord(schema);
        foreach (var field in schema.Fields)
        {
            if (entries.TryGetPropertyValue(field.Name, out var child))
            {
                if (!TryDecode(field.Schema, child, out var decoded, out why))
                {
                    why = $"field '{field.Name}': {why}";
                    return false;
                }
                record.Add(field.Name, decoded);
                continue;
            }

            // Feature 5 lets a null-valued field be left out entirely, which is
            // what a JSON producer that omits empty properties will hand us.
            if (!HoldsNull(field.Schema))
            {
                why = $"missing field '{field.Name}'";
                return false;
            }
            record.Add(field.Name, null);
        }

        foreach (var (key, _) in entries)
        {
            if (!schema.Fields.Any(f => f.Name == key))
            {
                why = $"'{key}' is not a field of {schema.Fullname}";
                return false;
            }
        }

        value = record;
        return true;
    }

    /// <summary>
    /// Features 5 and 6: Plain JSON carries no branch tag, so the branch is
    /// whichever one the value fits.
    /// </summary>
    /// <remarks>
    /// Ambiguity is an error rather than a first-match race. A union whose
    /// branches are not structurally distinguishable cannot be decoded from
    /// plain JSON by anybody, and saying so is better than taking the first
    /// match and handing back a plausible wrong answer.
    /// </remarks>
    private static bool TryDecodeUnion(UnionSchema schema, JsonNode? json, out object? value, out string why)
    {
        value = null;
        why = string.Empty;

        var matched = -1;
        object? match = null;
        var reasons = new List<string>();

        for (var index = 0; index < schema.Count; index++)
        {
            if (!TryDecode(schema[index], json, out var candidate, out var reason))
            {
                reasons.Add($"  branch {index}: {reason}");
                continue;
            }
            if (matched >= 0)
            {
                why = $"ambiguous union: the value fits both branch {matched} and branch {index}, "
                    + "so no decoder can choose";
                return false;
            }
            matched = index;
            match = candidate;
        }

        if (matched < 0)
        {
            why = "no union branch fits:\n" + string.Join("\n", reasons);
            return false;
        }

        value = match;
        return true;
    }

    /// <summary>Decodes a value carrying a <c>logicalType</c>.</summary>
    /// <remarks>
    /// Apache.Avro's writer runs a logical datum through
    /// <c>ConvertToBaseValue</c>, so what it wants here is the library's
    /// <i>logical</i> representation. For the <c>rfc3339-*</c> family that is the
    /// base value itself — the SDK registers those with an identity conversion
    /// over a <c>string</c> base — but <c>uuid</c> and <c>decimal</c> have
    /// representations of their own.
    /// </remarks>
    private static bool TryDecodeLogical(LogicalSchema schema, JsonNode? json, out object? value, out string why)
    {
        value = null;
        why = string.Empty;

        switch (schema.LogicalTypeName)
        {
            case "uuid":
                if (Kind(json) != JsonValueKind.String
                    || !Guid.TryParse(json!.GetValue<string>(), out var uuid))
                {
                    why = $"expected a uuid string, found {json?.ToJsonString() ?? "null"}";
                    return false;
                }
                value = uuid;
                return true;

            // Feature 3 again: a decimal is its *numeric* value as a string, not
            // the unscaled bytes. That is the whole interoperability point — a
            // plain JSON consumer can read `"1.25"` and cannot read `"fQ=="`.
            case "decimal":
            {
                if (Kind(json) != JsonValueKind.String)
                {
                    why = $"expected a decimal as a quoted number, found {json?.ToJsonString() ?? "null"}";
                    return false;
                }
                var scale = int.Parse(schema.GetProperty("scale"), CultureInfo.InvariantCulture);
                if (!TryUnscaled(json!.GetValue<string>(), scale, out var unscaled, out why))
                {
                    return false;
                }
                value = new AvroDecimal(unscaled, scale);
                return true;
            }

            default:
                return TryDecode(schema.BaseSchema, json, out value, out why);
        }
    }

    /// <summary>Reads a decimal in JSON number syntax into its unscaled integer.</summary>
    private static bool TryUnscaled(string text, int scale, out BigInteger unscaled, out string why)
    {
        unscaled = BigInteger.Zero;
        why = string.Empty;

        var sign = BigInteger.One;
        var digits = text;
        if (digits.StartsWith('-'))
        {
            sign = BigInteger.MinusOne;
            digits = digits[1..];
        }
        else if (digits.StartsWith('+'))
        {
            digits = digits[1..];
        }

        var dot = digits.IndexOf('.');
        var whole = dot < 0 ? digits : digits[..dot];
        var fraction = dot < 0 ? string.Empty : digits[(dot + 1)..];

        if (fraction.Length > scale)
        {
            why = $"'{text}' has {fraction.Length} fraction digits, more than the schema's scale of {scale}";
            return false;
        }

        var padded = whole + fraction + new string('0', scale - fraction.Length);
        if (padded.Length == 0
            || !padded.All(char.IsAsciiDigit)
            || !BigInteger.TryParse(padded, NumberStyles.None, CultureInfo.InvariantCulture, out var magnitude))
        {
            why = $"'{text}' is not a decimal";
            return false;
        }

        unscaled = sign * magnitude;
        return true;
    }

    /// <summary>Whether a schema can hold null, for the omitted-field rule.</summary>
    private static bool HoldsNull(Schema schema) => schema.Tag switch
    {
        Schema.Type.Null => true,
        Schema.Type.Union => ((UnionSchema)schema).Schemas.Any(branch => branch.Tag == Schema.Type.Null),
        _ => false,
    };

    private static JsonValueKind? Kind(JsonNode? json) => json?.GetValueKind();

    private static bool TryLong(JsonNode? json, out long number)
    {
        number = 0;
        return Kind(json) == JsonValueKind.Number && json!.AsValue().TryGetValue(out number);
    }

    private static bool TryDouble(JsonNode? json, out double number)
    {
        number = 0;
        return Kind(json) == JsonValueKind.Number && json!.AsValue().TryGetValue(out number);
    }

    private static bool TryBase64(JsonNode? json, out byte[] bytes)
    {
        bytes = [];
        if (Kind(json) != JsonValueKind.String)
        {
            return false;
        }
        try
        {
            bytes = Convert.FromBase64String(json!.GetValue<string>());
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
