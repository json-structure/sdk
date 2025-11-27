// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace JsonStructure.Converters;

/// <summary>
/// Provides a collection of all JSON Structure type converters for System.Text.Json.
/// Use <see cref="ConfigureOptions"/> to add all converters to JsonSerializerOptions.
/// </summary>
public static class JsonStructureConverters
{
    /// <summary>
    /// Gets a collection of all JSON Structure converters.
    /// </summary>
    public static IReadOnlyList<JsonConverter> All { get; } = new JsonConverter[]
    {
        // Large integer converters (serialized as strings)
        new Int64StringConverter(),
        new NullableInt64StringConverter(),
        new UInt64StringConverter(),
        new NullableUInt64StringConverter(),
        new Int128StringConverter(),
        new NullableInt128StringConverter(),
        new UInt128StringConverter(),
        new NullableUInt128StringConverter(),

        // Decimal converter (serialized as string)
        new DecimalStringConverter(),
        new NullableDecimalStringConverter(),

        // Temporal converters
        new DurationStringConverter(),
        new NullableDurationStringConverter(),
        new DateOnlyConverter(),
        new NullableDateOnlyConverter(),
        new TimeOnlyConverter(),
        new NullableTimeOnlyConverter(),

        // Common converters
        new UuidStringConverter(),
        new NullableUuidStringConverter(),
        new UriStringConverter(),
        new Base64BinaryConverter(),
        new Base64MemoryConverter(),
    };

    /// <summary>
    /// Adds all JSON Structure type converters to the specified options.
    /// </summary>
    /// <param name="options">The serializer options to configure.</param>
    /// <returns>The configured options for method chaining.</returns>
    public static JsonSerializerOptions ConfigureOptions(JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        foreach (var converter in All)
        {
            options.Converters.Add(converter);
        }

        return options;
    }

    /// <summary>
    /// Creates a new <see cref="JsonSerializerOptions"/> instance configured with all JSON Structure converters.
    /// </summary>
    /// <param name="defaults">Optional defaults for the new options.</param>
    /// <returns>A new configured <see cref="JsonSerializerOptions"/> instance.</returns>
    public static JsonSerializerOptions CreateOptions(JsonSerializerDefaults defaults = JsonSerializerDefaults.General)
    {
        var options = new JsonSerializerOptions(defaults);
        ConfigureOptions(options);
        return options;
    }

    /// <summary>
    /// Creates a new <see cref="JsonSerializerOptions"/> instance configured with all JSON Structure converters,
    /// copying settings from the specified source options.
    /// </summary>
    /// <param name="source">The source options to copy settings from.</param>
    /// <returns>A new configured <see cref="JsonSerializerOptions"/> instance.</returns>
    public static JsonSerializerOptions CreateOptions(JsonSerializerOptions source)
    {
        ArgumentNullException.ThrowIfNull(source);

        var options = new JsonSerializerOptions(source);
        ConfigureOptions(options);
        return options;
    }
}
