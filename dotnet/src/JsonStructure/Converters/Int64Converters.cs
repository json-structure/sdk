// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Globalization;

namespace JsonStructure.Converters;

/// <summary>
/// JSON converter for Int64 that serializes/deserializes as a string to preserve precision.
/// Per JSON Structure spec, int64 values are serialized as strings because JSON numbers
/// (IEEE 754 double) cannot accurately represent the full int64 range.
/// </summary>
public sealed class Int64StringConverter : JsonConverter<long>
{
    /// <inheritdoc />
    public override long Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (long.TryParse(str, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result))
            {
                return result;
            }
            throw new JsonException($"Unable to parse '{str}' as Int64.");
        }
        else if (reader.TokenType == JsonTokenType.Number)
        {
            // Allow reading from number for backwards compatibility
            return reader.GetInt64();
        }
        throw new JsonException($"Expected string or number for Int64, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, long value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString(CultureInfo.InvariantCulture));
    }
}

/// <summary>
/// JSON converter for nullable Int64 that serializes/deserializes as a string to preserve precision.
/// </summary>
public sealed class NullableInt64StringConverter : JsonConverter<long?>
{
    private static readonly Int64StringConverter _inner = new();

    /// <inheritdoc />
    public override long? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        return _inner.Read(ref reader, typeof(long), options);
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, long? value, JsonSerializerOptions options)
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

/// <summary>
/// JSON converter for UInt64 that serializes/deserializes as a string to preserve precision.
/// Per JSON Structure spec, uint64 values are serialized as strings because JSON numbers
/// (IEEE 754 double) cannot accurately represent the full uint64 range.
/// </summary>
public sealed class UInt64StringConverter : JsonConverter<ulong>
{
    /// <inheritdoc />
    public override ulong Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (ulong.TryParse(str, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result))
            {
                return result;
            }
            throw new JsonException($"Unable to parse '{str}' as UInt64.");
        }
        else if (reader.TokenType == JsonTokenType.Number)
        {
            return reader.GetUInt64();
        }
        throw new JsonException($"Expected string or number for UInt64, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, ulong value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString(CultureInfo.InvariantCulture));
    }
}

/// <summary>
/// JSON converter for nullable UInt64 that serializes/deserializes as a string to preserve precision.
/// </summary>
public sealed class NullableUInt64StringConverter : JsonConverter<ulong?>
{
    private static readonly UInt64StringConverter _inner = new();

    /// <inheritdoc />
    public override ulong? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        return _inner.Read(ref reader, typeof(ulong), options);
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, ulong? value, JsonSerializerOptions options)
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
