// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace JsonStructure.Converters;

/// <summary>
/// JSON converter for Guid that ensures consistent serialization format.
/// </summary>
public sealed class UuidStringConverter : JsonConverter<Guid>
{
    /// <inheritdoc />
    public override Guid Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (Guid.TryParse(str, out var result))
            {
                return result;
            }
            throw new JsonException($"Unable to parse '{str}' as UUID.");
        }
        throw new JsonException($"Expected string for UUID, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, Guid value, JsonSerializerOptions options)
    {
        // Use lowercase format without braces (standard format)
        writer.WriteStringValue(value.ToString("D"));
    }
}

/// <summary>
/// JSON converter for nullable Guid.
/// </summary>
public sealed class NullableUuidStringConverter : JsonConverter<Guid?>
{
    private static readonly UuidStringConverter _inner = new();

    /// <inheritdoc />
    public override Guid? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        return _inner.Read(ref reader, typeof(Guid), options);
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, Guid? value, JsonSerializerOptions options)
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
/// JSON converter for Uri that handles absolute and relative URIs.
/// </summary>
public sealed class UriStringConverter : JsonConverter<Uri>
{
    /// <inheritdoc />
    public override Uri? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (string.IsNullOrEmpty(str))
            {
                throw new JsonException("URI string cannot be null or empty.");
            }
            try
            {
                return new Uri(str, UriKind.RelativeOrAbsolute);
            }
            catch (UriFormatException)
            {
                throw new JsonException($"Unable to parse '{str}' as URI.");
            }
        }
        throw new JsonException($"Expected string for URI, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, Uri value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.OriginalString);
    }
}

/// <summary>
/// JSON converter for byte array that serializes/deserializes as base64 string.
/// Per JSON Structure spec, binary values are serialized as base64-encoded strings.
/// </summary>
public sealed class Base64BinaryConverter : JsonConverter<byte[]>
{
    /// <inheritdoc />
    public override byte[]? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (string.IsNullOrEmpty(str))
            {
                return Array.Empty<byte>();
            }
            try
            {
                return Convert.FromBase64String(str);
            }
            catch (FormatException)
            {
                throw new JsonException($"Unable to parse '{str}' as base64 binary.");
            }
        }
        throw new JsonException($"Expected string for binary, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, byte[] value, JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
        }
        else
        {
            writer.WriteStringValue(Convert.ToBase64String(value));
        }
    }
}

/// <summary>
/// JSON converter for ReadOnlyMemory&lt;byte&gt; that serializes/deserializes as base64 string.
/// </summary>
public sealed class Base64MemoryConverter : JsonConverter<ReadOnlyMemory<byte>>
{
    /// <inheritdoc />
    public override ReadOnlyMemory<byte> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (string.IsNullOrEmpty(str))
            {
                return ReadOnlyMemory<byte>.Empty;
            }
            try
            {
                return Convert.FromBase64String(str);
            }
            catch (FormatException)
            {
                throw new JsonException($"Unable to parse '{str}' as base64 binary.");
            }
        }
        throw new JsonException($"Expected string for binary, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, ReadOnlyMemory<byte> value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(Convert.ToBase64String(value.Span));
    }
}
