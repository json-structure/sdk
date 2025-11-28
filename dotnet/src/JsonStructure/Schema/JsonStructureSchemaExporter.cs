// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace JsonStructure.Schema;

/// <summary>
/// Options for controlling JSON Structure schema generation.
/// </summary>
public sealed class JsonStructureSchemaExporterOptions
{
    /// <summary>
    /// Gets or sets the schema URI to use. Defaults to JSON Structure 1.0.
    /// </summary>
    public string SchemaUri { get; set; } = "https://json-structure.org/meta/core/v1.0";

    /// <summary>
    /// Gets or sets whether to include the $schema property. Default is true.
    /// </summary>
    public bool IncludeSchemaKeyword { get; set; } = true;

    /// <summary>
    /// Gets or sets whether to include title from XML documentation or DisplayName. Default is true.
    /// </summary>
    public bool IncludeTitles { get; set; } = true;

    /// <summary>
    /// Gets or sets whether to include description from XML documentation or Description attribute. Default is true.
    /// </summary>
    public bool IncludeDescriptions { get; set; } = true;

    /// <summary>
    /// Gets or sets whether to mark non-nullable reference types as required. Default is true.
    /// </summary>
    public bool TreatNullObliviousAsNonNullable { get; set; } = true;

    /// <summary>
    /// Gets or sets a callback to transform the generated schema.
    /// </summary>
    public Func<JsonStructureSchemaExporterContext, JsonNode, JsonNode>? TransformSchema { get; set; }
}

/// <summary>
/// Context provided to schema transformation callbacks.
/// </summary>
public sealed class JsonStructureSchemaExporterContext
{
    /// <summary>
    /// Gets the type being processed.
    /// </summary>
    public required Type Type { get; init; }

    /// <summary>
    /// Gets the property info if processing a property.
    /// </summary>
    public PropertyInfo? PropertyInfo { get; init; }

    /// <summary>
    /// Gets the JSON property info if available.
    /// </summary>
    public JsonPropertyInfo? JsonPropertyInfo { get; init; }

    /// <summary>
    /// Gets the path in the schema.
    /// </summary>
    public required string Path { get; init; }

    /// <summary>
    /// Gets whether this is the root schema.
    /// </summary>
    public bool IsRoot => string.IsNullOrEmpty(Path);
}

/// <summary>
/// Generates JSON Structure schemas from .NET types.
/// Similar to System.Text.Json.Schema.JsonSchemaExporter but for JSON Structure format.
/// </summary>
public static class JsonStructureSchemaExporter
{
    private static readonly ConcurrentDictionary<(Type, string), JsonNode> _schemaCache = new();

    /// <summary>
    /// Gets the JSON Structure schema for the specified type.
    /// </summary>
    /// <typeparam name="T">The type to generate a schema for.</typeparam>
    /// <param name="options">Optional serializer options.</param>
    /// <param name="exporterOptions">Optional exporter options.</param>
    /// <returns>A JsonNode representing the schema.</returns>
    public static JsonNode GetJsonStructureSchemaAsNode<T>(
        JsonSerializerOptions? options = null,
        JsonStructureSchemaExporterOptions? exporterOptions = null)
    {
        return GetJsonStructureSchemaAsNode(typeof(T), options, exporterOptions);
    }

    /// <summary>
    /// Gets the JSON Structure schema for the specified type.
    /// </summary>
    /// <param name="type">The type to generate a schema for.</param>
    /// <param name="options">Optional serializer options.</param>
    /// <param name="exporterOptions">Optional exporter options.</param>
    /// <returns>A JsonNode representing the schema.</returns>
    public static JsonNode GetJsonStructureSchemaAsNode(
        Type type,
        JsonSerializerOptions? options = null,
        JsonStructureSchemaExporterOptions? exporterOptions = null)
    {
        ArgumentNullException.ThrowIfNull(type);

        options ??= JsonSerializerOptions.Default;
        exporterOptions ??= new JsonStructureSchemaExporterOptions();

        // Note: Caching could be implemented here using (type, options) as key
        return GenerateSchema(type, options, exporterOptions, "", new HashSet<Type>());
    }

    private static JsonNode GenerateSchema(
        Type type,
        JsonSerializerOptions options,
        JsonStructureSchemaExporterOptions exporterOptions,
        string path,
        HashSet<Type> visitedTypes)
    {
        var schema = new JsonObject();
        var isRoot = string.IsNullOrEmpty(path);

        // Add $schema for root
        if (isRoot && exporterOptions.IncludeSchemaKeyword)
        {
            schema["$schema"] = exporterOptions.SchemaUri;
        }

        // Handle nullable types
        var underlyingType = Nullable.GetUnderlyingType(type);
        if (underlyingType is not null)
        {
            type = underlyingType;
        }

        // Check for recursion
        if (visitedTypes.Contains(type) && !type.IsPrimitive && type != typeof(string))
        {
            // Use $ref for recursive types
            schema["$ref"] = $"#/$defs/{GetTypeName(type)}";
            return schema;
        }

        // Map .NET type to JSON Structure type
        var structureType = GetJsonStructureType(type);
        if (structureType is not null)
        {
            schema["type"] = structureType;
        }

        // Add metadata
        if (exporterOptions.IncludeTitles)
        {
            var displayName = type.GetCustomAttribute<System.ComponentModel.DisplayNameAttribute>();
            if (displayName is not null)
            {
                schema["title"] = displayName.DisplayName;
            }
            else
            {
                schema["title"] = GetFriendlyTypeName(type);
            }
        }

        if (exporterOptions.IncludeDescriptions)
        {
            var description = type.GetCustomAttribute<System.ComponentModel.DescriptionAttribute>();
            if (description is not null)
            {
                schema["description"] = description.Description;
            }
        }

        // Handle enums
        if (type.IsEnum)
        {
            schema["type"] = "string";
            var enumValues = new JsonArray();
            foreach (var value in Enum.GetNames(type))
            {
                var jsonName = GetEnumValueName(type, value, options);
                enumValues.Add(jsonName);
            }
            schema["enum"] = enumValues;
            return ApplyTransform(schema, type, null, null, path, exporterOptions);
        }

        // Handle arrays/collections
        if (type.IsArray)
        {
            schema["type"] = "array";
            var elementType = type.GetElementType()!;
            schema["items"] = GenerateSchema(elementType, options, exporterOptions, 
                path + "/items", new HashSet<Type>(visitedTypes));
            return ApplyTransform(schema, type, null, null, path, exporterOptions);
        }

        if (type.IsGenericType)
        {
            var genericDef = type.GetGenericTypeDefinition();

            // IEnumerable<T>, List<T>, etc.
            if (IsCollectionType(genericDef))
            {
                schema["type"] = "array";
                var elementType = type.GetGenericArguments()[0];
                schema["items"] = GenerateSchema(elementType, options, exporterOptions,
                    path + "/items", new HashSet<Type>(visitedTypes));

                // Check for HashSet -> set type
                if (genericDef == typeof(HashSet<>) || genericDef == typeof(ISet<>))
                {
                    schema["type"] = "set";
                }

                return ApplyTransform(schema, type, null, null, path, exporterOptions);
            }

            // Dictionary<K,V>
            if (IsDictionaryType(genericDef))
            {
                schema["type"] = "map";
                var valueType = type.GetGenericArguments()[1];
                schema["values"] = GenerateSchema(valueType, options, exporterOptions,
                    path + "/values", new HashSet<Type>(visitedTypes));
                return ApplyTransform(schema, type, null, null, path, exporterOptions);
            }
        }

        // Handle complex objects
        if (structureType == "object" && !type.IsPrimitive && type != typeof(string))
        {
            visitedTypes.Add(type);

            var properties = new JsonObject();
            var required = new JsonArray();

            foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                // Skip properties with JsonIgnore
                if (prop.GetCustomAttribute<JsonIgnoreAttribute>() is not null)
                {
                    continue;
                }

                // Get JSON property name
                var jsonName = GetJsonPropertyName(prop, options);

                // Generate property schema
                var propSchema = GenerateSchema(prop.PropertyType, options, exporterOptions,
                    path + "/properties/" + jsonName, new HashSet<Type>(visitedTypes));

                // Add property metadata
                if (propSchema is JsonObject propSchemaObj)
                {
                    if (exporterOptions.IncludeDescriptions)
                    {
                        var desc = prop.GetCustomAttribute<System.ComponentModel.DescriptionAttribute>();
                        if (desc is not null)
                        {
                            propSchemaObj["description"] = desc.Description;
                        }
                    }

                    // Check for deprecated
                    if (prop.GetCustomAttribute<ObsoleteAttribute>() is not null)
                    {
                        propSchemaObj["deprecated"] = true;
                    }

                    // Check for range constraints
                    var range = prop.GetCustomAttribute<System.ComponentModel.DataAnnotations.RangeAttribute>();
                    if (range is not null)
                    {
                        if (range.Minimum is not null)
                        {
                            propSchemaObj["minimum"] = JsonValue.Create(Convert.ToDouble(range.Minimum));
                        }
                        if (range.Maximum is not null)
                        {
                            propSchemaObj["maximum"] = JsonValue.Create(Convert.ToDouble(range.Maximum));
                        }
                    }

                    // Check for string length constraints
                    var stringLength = prop.GetCustomAttribute<System.ComponentModel.DataAnnotations.StringLengthAttribute>();
                    if (stringLength is not null)
                    {
                        propSchemaObj["minLength"] = stringLength.MinimumLength;
                        propSchemaObj["maxLength"] = stringLength.MaximumLength;
                    }

                    // Check for regex pattern
                    var regex = prop.GetCustomAttribute<System.ComponentModel.DataAnnotations.RegularExpressionAttribute>();
                    if (regex is not null)
                    {
                        propSchemaObj["pattern"] = regex.Pattern;
                    }

                    propSchema = ApplyTransform(propSchemaObj, prop.PropertyType, prop, null, 
                        path + "/properties/" + jsonName, exporterOptions);
                }

                properties[jsonName] = propSchema;

                // Check if required
                if (IsPropertyRequired(prop, exporterOptions))
                {
                    required.Add(jsonName);
                }
            }

            schema["properties"] = properties;
            if (required.Count > 0)
            {
                schema["required"] = required;
            }

            visitedTypes.Remove(type);
        }

        return ApplyTransform(schema, type, null, null, path, exporterOptions);
    }

    private static string? GetJsonStructureType(Type type)
    {
        // Handle nullable
        var underlying = Nullable.GetUnderlyingType(type);
        if (underlying is not null)
        {
            type = underlying;
        }

        // Primitive types
        if (type == typeof(string)) return "string";
        if (type == typeof(bool)) return "boolean";
        
        // Integer types - use size-specific types
        if (type == typeof(sbyte)) return "int8";
        if (type == typeof(short)) return "int16";
        if (type == typeof(int)) return "int32";
        if (type == typeof(long)) return "int64";
        if (type == typeof(Int128)) return "int128";
        if (type == typeof(byte)) return "uint8";
        if (type == typeof(ushort)) return "uint16";
        if (type == typeof(uint)) return "uint32";
        if (type == typeof(ulong)) return "uint64";
        if (type == typeof(UInt128)) return "uint128";

        // Floating point - use spec names: float (32-bit), double (64-bit)
        // Note: Half (16-bit) maps to float as the closest available spec type
        if (type == typeof(Half)) return "float";
        if (type == typeof(float)) return "float";
        if (type == typeof(double)) return "double";
        if (type == typeof(decimal)) return "decimal";

        // Date/time types
        if (type == typeof(DateOnly)) return "date";
        if (type == typeof(TimeOnly)) return "time";
        if (type == typeof(DateTime)) return "datetime";
        if (type == typeof(DateTimeOffset)) return "datetime";
        if (type == typeof(TimeSpan)) return "duration";

        // Other types
        if (type == typeof(Guid)) return "uuid";
        if (type == typeof(Uri)) return "uri";
        if (type == typeof(byte[])) return "binary";
        if (type == typeof(ReadOnlyMemory<byte>)) return "binary";
        if (type == typeof(Memory<byte>)) return "binary";

        // Object for complex types
        if (type.IsClass || type.IsValueType)
        {
            return "object";
        }

        return null;
    }

    private static string GetJsonPropertyName(PropertyInfo prop, JsonSerializerOptions options)
    {
        // Check for JsonPropertyName attribute
        var attr = prop.GetCustomAttribute<JsonPropertyNameAttribute>();
        if (attr is not null)
        {
            return attr.Name;
        }

        // Use naming policy if configured
        if (options.PropertyNamingPolicy is not null)
        {
            return options.PropertyNamingPolicy.ConvertName(prop.Name);
        }

        return prop.Name;
    }

    private static string GetEnumValueName(Type enumType, string valueName, JsonSerializerOptions options)
    {
        var field = enumType.GetField(valueName);
        if (field is not null)
        {
            var attr = field.GetCustomAttribute<JsonPropertyNameAttribute>();
            if (attr is not null)
            {
                return attr.Name;
            }
        }

        if (options.PropertyNamingPolicy is not null)
        {
            return options.PropertyNamingPolicy.ConvertName(valueName);
        }

        return valueName;
    }

    private static bool IsPropertyRequired(PropertyInfo prop, JsonStructureSchemaExporterOptions options)
    {
        // Check for Required attribute
        if (prop.GetCustomAttribute<System.ComponentModel.DataAnnotations.RequiredAttribute>() is not null)
        {
            return true;
        }

        // Check for JsonRequired attribute
        if (prop.GetCustomAttribute<JsonRequiredAttribute>() is not null)
        {
            return true;
        }

        // Check nullability context if treating null-oblivious as non-nullable
        if (options.TreatNullObliviousAsNonNullable)
        {
            var context = new NullabilityInfoContext();
            var nullabilityInfo = context.Create(prop);
            if (nullabilityInfo.WriteState == NullabilityState.NotNull)
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsCollectionType(Type genericDef)
    {
        return genericDef == typeof(List<>) ||
               genericDef == typeof(IList<>) ||
               genericDef == typeof(ICollection<>) ||
               genericDef == typeof(IEnumerable<>) ||
               genericDef == typeof(IReadOnlyList<>) ||
               genericDef == typeof(IReadOnlyCollection<>) ||
               genericDef == typeof(HashSet<>) ||
               genericDef == typeof(ISet<>);
    }

    private static bool IsDictionaryType(Type genericDef)
    {
        return genericDef == typeof(Dictionary<,>) ||
               genericDef == typeof(IDictionary<,>) ||
               genericDef == typeof(IReadOnlyDictionary<,>);
    }

    private static string GetTypeName(Type type)
    {
        if (type.IsGenericType)
        {
            var name = type.Name;
            var index = name.IndexOf('`');
            if (index > 0)
            {
                name = name[..index];
            }
            var args = string.Join("_", type.GetGenericArguments().Select(GetTypeName));
            return $"{name}_{args}";
        }
        return type.Name;
    }

    private static string GetFriendlyTypeName(Type type)
    {
        if (type.IsGenericType)
        {
            var name = type.Name;
            var index = name.IndexOf('`');
            if (index > 0)
            {
                name = name[..index];
            }
            var args = string.Join(", ", type.GetGenericArguments().Select(GetFriendlyTypeName));
            return $"{name}<{args}>";
        }
        return type.Name;
    }

    private static JsonNode ApplyTransform(
        JsonNode schema,
        Type type,
        PropertyInfo? prop,
        JsonPropertyInfo? jsonProp,
        string path,
        JsonStructureSchemaExporterOptions options)
    {
        if (options.TransformSchema is null)
        {
            return schema;
        }

        var context = new JsonStructureSchemaExporterContext
        {
            Type = type,
            PropertyInfo = prop,
            JsonPropertyInfo = jsonProp,
            Path = path
        };

        return options.TransformSchema(context, schema);
    }

    /// <summary>
    /// Gets the JSON Structure schema for the specified type using JsonSerializerOptions.
    /// </summary>
    /// <param name="options">The serializer options.</param>
    /// <param name="type">The type to generate a schema for.</param>
    /// <param name="exporterOptions">Optional exporter options.</param>
    /// <returns>A JsonNode representing the schema.</returns>
    public static JsonNode GetJsonStructureSchemaAsNode(
        this JsonSerializerOptions options,
        Type type,
        JsonStructureSchemaExporterOptions? exporterOptions = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(type);

        return GetJsonStructureSchemaAsNode(type, options, exporterOptions);
    }

    /// <summary>
    /// Gets the JSON Structure schema for the specified type using JsonTypeInfo.
    /// </summary>
    /// <param name="typeInfo">The type info.</param>
    /// <param name="exporterOptions">Optional exporter options.</param>
    /// <returns>A JsonNode representing the schema.</returns>
    public static JsonNode GetJsonStructureSchemaAsNode(
        this JsonTypeInfo typeInfo,
        JsonStructureSchemaExporterOptions? exporterOptions = null)
    {
        ArgumentNullException.ThrowIfNull(typeInfo);

        return GetJsonStructureSchemaAsNode(typeInfo.Type, typeInfo.Options, exporterOptions);
    }
}
