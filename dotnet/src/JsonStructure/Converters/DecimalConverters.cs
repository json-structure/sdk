// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Globalization;

namespace JsonStructure.Converters;

/// <summary>
/// JSON converter for decimal that serializes/deserializes as a string to preserve precision.
/// Per JSON Structure spec, decimal values are serialized as strings to avoid
/// IEEE 754 floating-point precision issues.
/// </summary>
public sealed class DecimalStringConverter : JsonConverter<decimal>
{
    /// <inheritdoc />
    public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (decimal.TryParse(str, NumberStyles.Number, CultureInfo.InvariantCulture, out var result))
            {
                return result;
            }
            throw new JsonException($"Unable to parse '{str}' as decimal.");
        }
        else if (reader.TokenType == JsonTokenType.Number)
        {
            // Allow reading from number for backwards compatibility
            return reader.GetDecimal();
        }
        throw new JsonException($"Expected string or number for decimal, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString(CultureInfo.InvariantCulture));
    }
}

/// <summary>
/// JSON converter for nullable decimal that serializes/deserializes as a string to preserve precision.
/// </summary>
public sealed class NullableDecimalStringConverter : JsonConverter<decimal?>
{
    private static readonly DecimalStringConverter _inner = new();

    /// <inheritdoc />
    public override decimal? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        return _inner.Read(ref reader, typeof(decimal), options);
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, decimal? value, JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
        }
        else
        {
            _inner.Write(writer, value.Value, options);
        }
    }
}
