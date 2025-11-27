// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Globalization;
using System.Numerics;

namespace JsonStructure.Converters;

/// <summary>
/// JSON converter for Int128 that serializes/deserializes as a string.
/// Per JSON Structure spec, int128 values are serialized as strings because
/// they exceed the range of JSON numbers.
/// </summary>
public sealed class Int128StringConverter : JsonConverter<Int128>
{
    /// <inheritdoc />
    public override Int128 Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (Int128.TryParse(str, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result))
            {
                return result;
            }
            throw new JsonException($"Unable to parse '{str}' as Int128.");
        }
        throw new JsonException($"Expected string for Int128, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, Int128 value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString(CultureInfo.InvariantCulture));
    }
}

/// <summary>
/// JSON converter for nullable Int128 that serializes/deserializes as a string.
/// </summary>
public sealed class NullableInt128StringConverter : JsonConverter<Int128?>
{
    private static readonly Int128StringConverter _inner = new();

    /// <inheritdoc />
    public override Int128? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        return _inner.Read(ref reader, typeof(Int128), options);
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, Int128? value, JsonSerializerOptions options)
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
/// JSON converter for UInt128 that serializes/deserializes as a string.
/// Per JSON Structure spec, uint128 values are serialized as strings because
/// they exceed the range of JSON numbers.
/// </summary>
public sealed class UInt128StringConverter : JsonConverter<UInt128>
{
    /// <inheritdoc />
    public override UInt128 Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (UInt128.TryParse(str, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result))
            {
                return result;
            }
            throw new JsonException($"Unable to parse '{str}' as UInt128.");
        }
        throw new JsonException($"Expected string for UInt128, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, UInt128 value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString(CultureInfo.InvariantCulture));
    }
}

/// <summary>
/// JSON converter for nullable UInt128 that serializes/deserializes as a string.
/// </summary>
public sealed class NullableUInt128StringConverter : JsonConverter<UInt128?>
{
    private static readonly UInt128StringConverter _inner = new();

    /// <inheritdoc />
    public override UInt128? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        return _inner.Read(ref reader, typeof(UInt128), options);
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, UInt128? value, JsonSerializerOptions options)
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
/// JSON converter for BigInteger that serializes/deserializes as a string.
/// </summary>
public sealed class BigIntegerStringConverter : JsonConverter<BigInteger>
{
    /// <inheritdoc />
    public override BigInteger Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (BigInteger.TryParse(str, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result))
            {
                return result;
            }
            throw new JsonException($"Unable to parse '{str}' as BigInteger.");
        }
        throw new JsonException($"Expected string for BigInteger, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, BigInteger value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString(CultureInfo.InvariantCulture));
    }
}

/// <summary>
/// JSON converter for nullable BigInteger that serializes/deserializes as a string.
/// </summary>
public sealed class NullableBigIntegerStringConverter : JsonConverter<BigInteger?>
{
    private static readonly BigIntegerStringConverter _inner = new();

    /// <inheritdoc />
    public override BigInteger? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        return _inner.Read(ref reader, typeof(BigInteger), options);
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, BigInteger? value, JsonSerializerOptions options)
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
