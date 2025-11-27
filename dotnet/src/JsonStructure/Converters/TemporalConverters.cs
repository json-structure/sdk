// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml;

namespace JsonStructure.Converters;

/// <summary>
/// JSON converter for TimeSpan that serializes/deserializes as an ISO 8601 duration string.
/// Per JSON Structure spec, duration values are serialized as strings in ISO 8601 format.
/// </summary>
public sealed class DurationStringConverter : JsonConverter<TimeSpan>
{
    /// <inheritdoc />
    public override TimeSpan Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (string.IsNullOrEmpty(str))
            {
                throw new JsonException("Duration string cannot be null or empty.");
            }

            try
            {
                // Parse ISO 8601 duration format (e.g., "P1DT2H3M4S", "PT1H30M", etc.)
                return XmlConvert.ToTimeSpan(str);
            }
            catch (FormatException)
            {
                // Try alternative formats
                if (TimeSpan.TryParse(str, CultureInfo.InvariantCulture, out var result))
                {
                    return result;
                }
                throw new JsonException($"Unable to parse '{str}' as duration.");
            }
        }
        throw new JsonException($"Expected string for duration, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, TimeSpan value, JsonSerializerOptions options)
    {
        // Write in ISO 8601 duration format
        writer.WriteStringValue(XmlConvert.ToString(value));
    }
}

/// <summary>
/// JSON converter for nullable TimeSpan that serializes/deserializes as an ISO 8601 duration string.
/// </summary>
public sealed class NullableDurationStringConverter : JsonConverter<TimeSpan?>
{
    private static readonly DurationStringConverter _inner = new();

    /// <inheritdoc />
    public override TimeSpan? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        return _inner.Read(ref reader, typeof(TimeSpan), options);
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, TimeSpan? value, JsonSerializerOptions options)
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
/// JSON converter for DateOnly that serializes/deserializes as an RFC 3339 date string.
/// </summary>
public sealed class DateOnlyConverter : JsonConverter<DateOnly>
{
    private const string DateFormat = "yyyy-MM-dd";

    /// <inheritdoc />
    public override DateOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (DateOnly.TryParseExact(str, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var result))
            {
                return result;
            }
            throw new JsonException($"Unable to parse '{str}' as DateOnly.");
        }
        throw new JsonException($"Expected string for date, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, DateOnly value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString(DateFormat, CultureInfo.InvariantCulture));
    }
}

/// <summary>
/// JSON converter for nullable DateOnly.
/// </summary>
public sealed class NullableDateOnlyConverter : JsonConverter<DateOnly?>
{
    private static readonly DateOnlyConverter _inner = new();

    /// <inheritdoc />
    public override DateOnly? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        return _inner.Read(ref reader, typeof(DateOnly), options);
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, DateOnly? value, JsonSerializerOptions options)
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
/// JSON converter for TimeOnly that serializes/deserializes as an RFC 3339 time string.
/// </summary>
public sealed class TimeOnlyConverter : JsonConverter<TimeOnly>
{
    private const string TimeFormat = "HH:mm:ss.FFFFFFF";

    /// <inheritdoc />
    public override TimeOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var str = reader.GetString();
            if (TimeOnly.TryParse(str, CultureInfo.InvariantCulture, DateTimeStyles.None, out var result))
            {
                return result;
            }
            throw new JsonException($"Unable to parse '{str}' as TimeOnly.");
        }
        throw new JsonException($"Expected string for time, got {reader.TokenType}.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, TimeOnly value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString(TimeFormat, CultureInfo.InvariantCulture));
    }
}

/// <summary>
/// JSON converter for nullable TimeOnly.
/// </summary>
public sealed class NullableTimeOnlyConverter : JsonConverter<TimeOnly?>
{
    private static readonly TimeOnlyConverter _inner = new();

    /// <inheritdoc />
    public override TimeOnly? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }
        return _inner.Read(ref reader, typeof(TimeOnly), options);
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, TimeOnly? value, JsonSerializerOptions options)
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
