// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace JsonStructure.Validation;

/// <summary>
/// Validates JSON Structure schema documents.
/// </summary>
public sealed class SchemaValidator
{
    /// <summary>
    /// The valid primitive types in JSON Structure.
    /// </summary>
    public static readonly HashSet<string> PrimitiveTypes = new(StringComparer.Ordinal)
    {
        "string", "number", "boolean", "null",
        "int8", "int16", "int32", "int64", "int128",
        "uint8", "uint16", "uint32", "uint64", "uint128",
        "float8", "float16", "float32", "float64", "float128",
        "decimal", "decimal64", "decimal128",
        "date", "time", "datetime", "duration",
        "uuid", "uri", "binary", "jsonpointer",
        // Aliases for compatibility
        "integer", "double", "float"
    };

    /// <summary>
    /// The valid compound types in JSON Structure.
    /// </summary>
    public static readonly HashSet<string> CompoundTypes = new(StringComparer.Ordinal)
    {
        "object", "array", "set", "map", "tuple", "choice", "any"
    };

    /// <summary>
    /// All valid type names.
    /// </summary>
    public static readonly HashSet<string> AllTypes;

    /// <summary>
    /// Valid top-level schema keywords.
    /// </summary>
    public static readonly HashSet<string> SchemaKeywords = new(StringComparer.Ordinal)
    {
        "$schema", "$id", "$ref", "$defs", "definitions", "$import", "$importdefs",
        "$comment", "$anchor", "$extends", "$abstract", "$root", "$uses",
        "name", "abstract",
        "type", "enum", "const", "default", "deprecated",
        "title", "description", "examples",
        // Object keywords
        "properties", "additionalProperties", "required", "propertyNames",
        "minProperties", "maxProperties", "dependentRequired",
        // Array/Set/Tuple keywords
        "items", "prefixItems", "minItems", "maxItems", "uniqueItems", "contains",
        "minContains", "maxContains",
        // String keywords
        "minLength", "maxLength", "pattern", "format", "contentEncoding", "contentMediaType",
        // Number keywords
        "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
        "precision", "scale",
        // Map keywords
        "values",
        // Choice keywords
        "options", "choices", "discriminator", "selector",
        // Tuple keywords
        "tuple",
        // Conditional composition
        "allOf", "anyOf", "oneOf", "not", "if", "then", "else",
        // Alternate names
        "altnames",
        // Units
        "unit"
    };

    private static readonly Regex NamespacePattern = new(
        @"^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$",
        RegexOptions.Compiled);

    private static readonly Regex IdentifierPattern = new(
        @"^[a-zA-Z_][a-zA-Z0-9_]*$",
        RegexOptions.Compiled);

    private readonly ValidationOptions _options;

    static SchemaValidator()
    {
        AllTypes = new HashSet<string>(PrimitiveTypes, StringComparer.Ordinal);
        foreach (var t in CompoundTypes) AllTypes.Add(t);
    }

    /// <summary>
    /// Initializes a new instance of <see cref="SchemaValidator"/>.
    /// </summary>
    /// <param name="options">Optional validation options.</param>
    public SchemaValidator(ValidationOptions? options = null)
    {
        _options = options ?? ValidationOptions.Default;
    }

    /// <summary>
    /// Validates a JSON Structure schema document.
    /// </summary>
    /// <param name="schema">The schema document to validate.</param>
    /// <returns>The validation result.</returns>
    public ValidationResult Validate(JsonNode? schema)
    {
        var result = new ValidationResult();

        if (schema is null)
        {
            result.AddError("Schema cannot be null", "");
            return result;
        }

        ValidateSchemaCore(schema, result, "", 0);
        return result;
    }

    /// <summary>
    /// Validates a JSON Structure schema document from JSON string.
    /// </summary>
    /// <param name="json">The JSON string containing the schema.</param>
    /// <returns>The validation result.</returns>
    public ValidationResult Validate(string json)
    {
        try
        {
            var schema = JsonNode.Parse(json);
            return Validate(schema);
        }
        catch (Exception ex)
        {
            return ValidationResult.Failure($"Failed to parse JSON: {ex.Message}");
        }
    }

    private void ValidateSchemaCore(JsonNode node, ValidationResult result, string path, int depth)
    {
        if (depth > _options.MaxValidationDepth)
        {
            result.AddError($"Maximum validation depth ({_options.MaxValidationDepth}) exceeded", path);
            return;
        }

        if (_options.StopOnFirstError && !result.IsValid)
        {
            return;
        }

        // Schema must be boolean or object
        if (node is JsonValue value)
        {
            if (value.TryGetValue<bool>(out _))
            {
                // Boolean schemas are valid (true = allow all, false = deny all)
                return;
            }
            result.AddError("Schema must be a boolean or object", path);
            return;
        }

        if (node is not JsonObject schema)
        {
            result.AddError("Schema must be a boolean or object", path);
            return;
        }

        // Validate $schema if present
        if (schema.TryGetPropertyValue("$schema", out var schemaValue))
        {
            if (schemaValue is not JsonValue sv || !sv.TryGetValue<string>(out var schemaUri))
            {
                result.AddError("$schema must be a string", AppendPath(path, "$schema"));
            }
            else if (!schemaUri.StartsWith("https://json-structure.org/") && 
                     !schemaUri.StartsWith("http://json-structure.org/"))
            {
                // Allow other schema URIs but note if it's not a JSON Structure schema
            }
        }

        // Validate $id if present
        if (schema.TryGetPropertyValue("$id", out var idValue))
        {
            ValidateStringProperty(idValue, "$id", path, result);
        }

        // Validate $ref if present
        if (schema.TryGetPropertyValue("$ref", out var refValue))
        {
            ValidateReference(refValue, "$ref", path, result);
        }

        // Validate $anchor if present
        if (schema.TryGetPropertyValue("$anchor", out var anchorValue))
        {
            ValidateIdentifier(anchorValue, "$anchor", path, result);
        }

        // Validate $defs if present
        if (schema.TryGetPropertyValue("$defs", out var defsValue))
        {
            ValidateDefinitions(defsValue, "$defs", path, result, depth);
        }

        // Validate definitions if present (alternate name for $defs)
        if (schema.TryGetPropertyValue("definitions", out var definitionsValue))
        {
            ValidateDefinitions(definitionsValue, "definitions", path, result, depth);
        }

        // Validate $import if present
        if (schema.TryGetPropertyValue("$import", out var importValue))
        {
            ValidateImport(importValue, "$import", path, result);
        }

        // Validate $importdefs if present
        if (schema.TryGetPropertyValue("$importdefs", out var importDefsValue))
        {
            ValidateImport(importDefsValue, "$importdefs", path, result);
        }

        // Validate $extends if present
        if (schema.TryGetPropertyValue("$extends", out var extendsValue))
        {
            ValidateReference(extendsValue, "$extends", path, result);
        }

        // Validate type if present
        if (schema.TryGetPropertyValue("type", out var typeValue))
        {
            ValidateType(typeValue, path, result);
            var typeStr = GetTypeString(typeValue);
            
            // Type-specific validation
            if (typeStr is not null)
            {
                switch (typeStr)
                {
                    case "object":
                        ValidateObjectSchema(schema, path, result, depth);
                        break;
                    case "array":
                    case "set":
                        ValidateArraySchema(schema, path, result, depth);
                        break;
                    case "tuple":
                        ValidateTupleSchema(schema, path, result, depth);
                        break;
                    case "map":
                        ValidateMapSchema(schema, path, result, depth);
                        break;
                    case "choice":
                        ValidateChoiceSchema(schema, path, result, depth);
                        break;
                    case "string":
                        ValidateStringSchema(schema, path, result);
                        break;
                    case var t when IsNumericType(t):
                        ValidateNumericSchema(schema, path, result);
                        break;
                }
            }
        }

        // Validate enum if present
        if (schema.TryGetPropertyValue("enum", out var enumValue))
        {
            ValidateEnum(enumValue, path, result);
        }

        // Validate const if present  
        if (schema.TryGetPropertyValue("const", out _))
        {
            // const can be any value
        }

        // Validate conditional composition keywords
        ValidateConditionalComposition(schema, path, result, depth);

        // Validate altnames if present
        if (schema.TryGetPropertyValue("altnames", out var altnamesValue))
        {
            ValidateAltnames(altnamesValue, path, result);
        }
    }

    private void ValidateStringProperty(JsonNode? value, string keyword, string path, ValidationResult result)
    {
        if (value is not JsonValue jv || !jv.TryGetValue<string>(out _))
        {
            result.AddError($"{keyword} must be a string", AppendPath(path, keyword));
        }
    }

    private void ValidateIdentifier(JsonNode? value, string keyword, string path, ValidationResult result)
    {
        if (value is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError($"{keyword} must be a string", AppendPath(path, keyword));
            return;
        }

        if (!IdentifierPattern.IsMatch(str))
        {
            result.AddError($"{keyword} must be a valid identifier (start with letter or underscore, contain only letters, digits, underscores)", 
                AppendPath(path, keyword));
        }
    }

    private void ValidateReference(JsonNode? value, string keyword, string path, ValidationResult result)
    {
        if (value is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError($"{keyword} must be a string", AppendPath(path, keyword));
            return;
        }

        // References should be valid URI references or JSON pointers
        if (string.IsNullOrWhiteSpace(str))
        {
            result.AddError($"{keyword} cannot be empty", AppendPath(path, keyword));
        }
    }

    private void ValidateImport(JsonNode? value, string keyword, string path, ValidationResult result)
    {
        if (value is JsonValue jv && jv.TryGetValue<string>(out _))
        {
            return; // Single import string is valid
        }

        if (value is JsonArray arr)
        {
            foreach (var item in arr)
            {
                if (item is not JsonValue itemValue || !itemValue.TryGetValue<string>(out _))
                {
                    result.AddError($"{keyword} array items must be strings", AppendPath(path, keyword));
                    break;
                }
            }
            return;
        }

        if (value is JsonObject obj)
        {
            foreach (var prop in obj)
            {
                if (prop.Value is not JsonValue propValue || !propValue.TryGetValue<string>(out _))
                {
                    result.AddError($"{keyword} object values must be strings", AppendPath(path, $"{keyword}/{prop.Key}"));
                }
            }
            return;
        }

        result.AddError($"{keyword} must be a string, array, or object", AppendPath(path, keyword));
    }

    private void ValidateDefinitions(JsonNode? value, string keyword, string path, ValidationResult result, int depth)
    {
        if (value is not JsonObject defs)
        {
            result.AddError($"{keyword} must be an object", AppendPath(path, keyword));
            return;
        }

        foreach (var prop in defs)
        {
            if (prop.Value is not null)
            {
                ValidateDefinitionOrNamespace(prop.Value, AppendPath(path, $"{keyword}/{prop.Key}"), result, depth + 1);
            }
        }
    }

    private void ValidateDefinitionOrNamespace(JsonNode value, string path, ValidationResult result, int depth)
    {
        // Check if this is a namespace (object without 'type' but containing nested schemas)
        // or a schema definition (object with 'type' or other schema keywords)
        if (value is JsonObject obj)
        {
            // If it has 'type', '$ref', 'allOf', 'anyOf', 'oneOf', 'properties', or other schema keywords, it's a schema
            if (obj.ContainsKey("type") || obj.ContainsKey("$ref") || obj.ContainsKey("allOf") || 
                obj.ContainsKey("anyOf") || obj.ContainsKey("oneOf") || obj.ContainsKey("properties") ||
                obj.ContainsKey("items") || obj.ContainsKey("enum") || obj.ContainsKey("const") ||
                obj.ContainsKey("$extends") || obj.ContainsKey("abstract"))
            {
                ValidateSchemaCore(value, result, path, depth);
            }
            else if (obj.ContainsKey("$import") || obj.ContainsKey("$importdefs"))
            {
                // This is an import container - validate the import URLs
                if (obj.TryGetPropertyValue("$import", out var importValue))
                {
                    ValidateImport(importValue, "$import", path, result);
                }
                if (obj.TryGetPropertyValue("$importdefs", out var importDefsValue))
                {
                    ValidateImport(importDefsValue, "$importdefs", path, result);
                }
            }
            else
            {
                // Otherwise, it might be a namespace containing nested definitions
                foreach (var prop in obj)
                {
                    if (prop.Value is not null)
                    {
                        ValidateDefinitionOrNamespace(prop.Value, AppendPath(path, prop.Key), result, depth + 1);
                    }
                }
            }
        }
        else
        {
            ValidateSchemaCore(value, result, path, depth);
        }
    }

    private void ValidateType(JsonNode? value, string path, ValidationResult result)
    {
        var typePath = AppendPath(path, "type");

        if (value is JsonValue jv && jv.TryGetValue<string>(out var typeStr))
        {
            if (!AllTypes.Contains(typeStr) && !typeStr.Contains(':'))
            {
                result.AddError($"Invalid type: '{typeStr}'", typePath);
            }
            return;
        }

        if (value is JsonArray arr)
        {
            if (arr.Count == 0)
            {
                result.AddError("type array cannot be empty", typePath);
                return;
            }

            foreach (var item in arr)
            {
                // Type union can contain strings or objects with $ref
                if (item is JsonValue itemValue && itemValue.TryGetValue<string>(out var itemType))
                {
                    if (!AllTypes.Contains(itemType) && !itemType.Contains(':'))
                    {
                        result.AddError($"Invalid type in array: '{itemType}'", typePath);
                    }
                }
                else if (item is JsonObject typeRefObj)
                {
                    // Type union can include $ref objects
                    if (typeRefObj.TryGetPropertyValue("$ref", out var refValue))
                    {
                        ValidateReference(refValue, "$ref", typePath, result);
                    }
                    else
                    {
                        result.AddError("type array objects must contain $ref", typePath);
                    }
                }
                else
                {
                    result.AddError("type array items must be strings or objects with $ref", typePath);
                }
            }
            return;
        }

        // JSON Structure allows type to be an object with $ref for type references
        if (value is JsonObject typeObj)
        {
            if (typeObj.TryGetPropertyValue("$ref", out var refValue))
            {
                ValidateReference(refValue, "$ref", typePath, result);
            }
            else
            {
                result.AddError("type object must contain $ref", typePath);
            }
            return;
        }

        result.AddError("type must be a string, array of strings, or object with $ref", typePath);
    }

    private string? GetTypeString(JsonNode? value)
    {
        if (value is JsonValue jv && jv.TryGetValue<string>(out var str))
        {
            return str;
        }
        return null;
    }

    private bool IsNumericType(string? type) => type is 
        "number" or "int8" or "int16" or "int32" or "int64" or "int128" or
        "uint8" or "uint16" or "uint32" or "uint64" or "uint128" or
        "float16" or "float32" or "float64" or "float128" or
        "decimal" or "decimal64" or "decimal128";

    private void ValidateObjectSchema(JsonObject schema, string path, ValidationResult result, int depth)
    {
        // Validate properties
        if (schema.TryGetPropertyValue("properties", out var propsValue))
        {
            if (propsValue is not JsonObject props)
            {
                result.AddError("properties must be an object", AppendPath(path, "properties"));
            }
            else
            {
                foreach (var prop in props)
                {
                    if (prop.Value is not null)
                    {
                        ValidateSchemaCore(prop.Value, result, AppendPath(path, $"properties/{prop.Key}"), depth + 1);
                    }
                }
            }
        }

        // Validate additionalProperties
        if (schema.TryGetPropertyValue("additionalProperties", out var additionalValue))
        {
            if (additionalValue is JsonValue jv && jv.TryGetValue<bool>(out _))
            {
                // Boolean is valid
            }
            else if (additionalValue is JsonObject)
            {
                ValidateSchemaCore(additionalValue, result, AppendPath(path, "additionalProperties"), depth + 1);
            }
            else
            {
                result.AddError("additionalProperties must be a boolean or schema", AppendPath(path, "additionalProperties"));
            }
        }

        // Validate required
        if (schema.TryGetPropertyValue("required", out var requiredValue))
        {
            if (requiredValue is not JsonArray reqArr)
            {
                result.AddError("required must be an array", AppendPath(path, "required"));
            }
            else
            {
                foreach (var item in reqArr)
                {
                    if (item is not JsonValue itemValue || !itemValue.TryGetValue<string>(out _))
                    {
                        result.AddError("required array items must be strings", AppendPath(path, "required"));
                        break;
                    }
                }
            }
        }

        // Validate minProperties/maxProperties
        ValidateNonNegativeInteger(schema, "minProperties", path, result);
        ValidateNonNegativeInteger(schema, "maxProperties", path, result);
    }

    private void ValidateArraySchema(JsonObject schema, string path, ValidationResult result, int depth)
    {
        // Validate items
        if (schema.TryGetPropertyValue("items", out var itemsValue))
        {
            ValidateSchemaCore(itemsValue!, result, AppendPath(path, "items"), depth + 1);
        }

        // Validate minItems/maxItems
        ValidateNonNegativeInteger(schema, "minItems", path, result);
        ValidateNonNegativeInteger(schema, "maxItems", path, result);

        // Validate uniqueItems
        if (schema.TryGetPropertyValue("uniqueItems", out var uniqueValue))
        {
            if (uniqueValue is not JsonValue jv || !jv.TryGetValue<bool>(out _))
            {
                result.AddError("uniqueItems must be a boolean", AppendPath(path, "uniqueItems"));
            }
        }

        // Validate contains
        if (schema.TryGetPropertyValue("contains", out var containsValue))
        {
            ValidateSchemaCore(containsValue!, result, AppendPath(path, "contains"), depth + 1);
        }

        ValidateNonNegativeInteger(schema, "minContains", path, result);
        ValidateNonNegativeInteger(schema, "maxContains", path, result);
    }

    private void ValidateTupleSchema(JsonObject schema, string path, ValidationResult result, int depth)
    {
        // Validate prefixItems
        if (schema.TryGetPropertyValue("prefixItems", out var prefixValue))
        {
            if (prefixValue is not JsonArray prefixArr)
            {
                result.AddError("prefixItems must be an array", AppendPath(path, "prefixItems"));
            }
            else
            {
                for (var i = 0; i < prefixArr.Count; i++)
                {
                    var item = prefixArr[i];
                    if (item is not null)
                    {
                        ValidateSchemaCore(item, result, AppendPath(path, $"prefixItems/{i}"), depth + 1);
                    }
                }
            }
        }

        // Validate items (for additional items after prefixItems)
        if (schema.TryGetPropertyValue("items", out var itemsValue))
        {
            if (itemsValue is JsonValue jv && jv.TryGetValue<bool>(out _))
            {
                // Boolean is valid
            }
            else if (itemsValue is JsonObject)
            {
                ValidateSchemaCore(itemsValue, result, AppendPath(path, "items"), depth + 1);
            }
            else
            {
                result.AddError("items must be a boolean or schema for tuple type", AppendPath(path, "items"));
            }
        }
    }

    private void ValidateMapSchema(JsonObject schema, string path, ValidationResult result, int depth)
    {
        // Validate values schema
        if (schema.TryGetPropertyValue("values", out var valuesValue))
        {
            ValidateSchemaCore(valuesValue!, result, AppendPath(path, "values"), depth + 1);
        }

        // Validate propertyNames (for key constraints)
        if (schema.TryGetPropertyValue("propertyNames", out var propNamesValue))
        {
            ValidateSchemaCore(propNamesValue!, result, AppendPath(path, "propertyNames"), depth + 1);
        }

        ValidateNonNegativeInteger(schema, "minProperties", path, result);
        ValidateNonNegativeInteger(schema, "maxProperties", path, result);
    }

    private void ValidateChoiceSchema(JsonObject schema, string path, ValidationResult result, int depth)
    {
        // Validate options (legacy keyword)
        if (schema.TryGetPropertyValue("options", out var optionsValue))
        {
            if (optionsValue is not JsonObject opts)
            {
                result.AddError("options must be an object", AppendPath(path, "options"));
            }
            else
            {
                foreach (var opt in opts)
                {
                    if (opt.Value is not null)
                    {
                        ValidateSchemaCore(opt.Value, result, AppendPath(path, $"options/{opt.Key}"), depth + 1);
                    }
                }
            }
        }

        // Validate choices (current keyword)
        if (schema.TryGetPropertyValue("choices", out var choicesValue))
        {
            if (choicesValue is not JsonObject choices)
            {
                result.AddError("choices must be an object", AppendPath(path, "choices"));
            }
            else
            {
                foreach (var choice in choices)
                {
                    if (choice.Value is not null)
                    {
                        ValidateSchemaCore(choice.Value, result, AppendPath(path, $"choices/{choice.Key}"), depth + 1);
                    }
                }
            }
        }

        // Validate discriminator
        if (schema.TryGetPropertyValue("discriminator", out var discValue))
        {
            ValidateStringProperty(discValue, "discriminator", path, result);
        }

        // Validate selector (alternative to discriminator)
        if (schema.TryGetPropertyValue("selector", out var selectorValue))
        {
            ValidateStringProperty(selectorValue, "selector", path, result);
        }
    }

    private void ValidateStringSchema(JsonObject schema, string path, ValidationResult result)
    {
        ValidateNonNegativeInteger(schema, "minLength", path, result);
        ValidateNonNegativeInteger(schema, "maxLength", path, result);

        // Validate pattern
        if (schema.TryGetPropertyValue("pattern", out var patternValue))
        {
            if (patternValue is not JsonValue jv || !jv.TryGetValue<string>(out var pattern))
            {
                result.AddError("pattern must be a string", AppendPath(path, "pattern"));
            }
            else
            {
                try
                {
                    _ = new Regex(pattern);
                }
                catch (ArgumentException)
                {
                    result.AddError($"pattern is not a valid regular expression: '{pattern}'", AppendPath(path, "pattern"));
                }
            }
        }

        // Validate format
        if (schema.TryGetPropertyValue("format", out var formatValue))
        {
            ValidateStringProperty(formatValue, "format", path, result);
        }

        // Validate contentEncoding
        if (schema.TryGetPropertyValue("contentEncoding", out var encodingValue))
        {
            ValidateStringProperty(encodingValue, "contentEncoding", path, result);
        }

        // Validate contentMediaType
        if (schema.TryGetPropertyValue("contentMediaType", out var mediaTypeValue))
        {
            ValidateStringProperty(mediaTypeValue, "contentMediaType", path, result);
        }
    }

    private void ValidateNumericSchema(JsonObject schema, string path, ValidationResult result)
    {
        // Validate minimum/maximum
        ValidateNumber(schema, "minimum", path, result);
        ValidateNumber(schema, "maximum", path, result);
        ValidateNumber(schema, "exclusiveMinimum", path, result);
        ValidateNumber(schema, "exclusiveMaximum", path, result);
        ValidatePositiveNumber(schema, "multipleOf", path, result);
    }

    private void ValidateEnum(JsonNode? value, string path, ValidationResult result)
    {
        if (value is not JsonArray arr)
        {
            result.AddError("enum must be an array", AppendPath(path, "enum"));
            return;
        }

        if (arr.Count == 0)
        {
            result.AddError("enum array cannot be empty", AppendPath(path, "enum"));
        }
    }

    private void ValidateConditionalComposition(JsonObject schema, string path, ValidationResult result, int depth)
    {
        // Validate allOf
        if (schema.TryGetPropertyValue("allOf", out var allOfValue))
        {
            ValidateSchemaArray(allOfValue, "allOf", path, result, depth);
        }

        // Validate anyOf
        if (schema.TryGetPropertyValue("anyOf", out var anyOfValue))
        {
            ValidateSchemaArray(anyOfValue, "anyOf", path, result, depth);
        }

        // Validate oneOf
        if (schema.TryGetPropertyValue("oneOf", out var oneOfValue))
        {
            ValidateSchemaArray(oneOfValue, "oneOf", path, result, depth);
        }

        // Validate not
        if (schema.TryGetPropertyValue("not", out var notValue))
        {
            ValidateSchemaCore(notValue!, result, AppendPath(path, "not"), depth + 1);
        }

        // Validate if/then/else
        if (schema.TryGetPropertyValue("if", out var ifValue))
        {
            ValidateSchemaCore(ifValue!, result, AppendPath(path, "if"), depth + 1);
        }

        if (schema.TryGetPropertyValue("then", out var thenValue))
        {
            ValidateSchemaCore(thenValue!, result, AppendPath(path, "then"), depth + 1);
        }

        if (schema.TryGetPropertyValue("else", out var elseValue))
        {
            ValidateSchemaCore(elseValue!, result, AppendPath(path, "else"), depth + 1);
        }
    }

    private void ValidateSchemaArray(JsonNode? value, string keyword, string path, ValidationResult result, int depth)
    {
        var keywordPath = AppendPath(path, keyword);

        if (value is not JsonArray arr)
        {
            result.AddError($"{keyword} must be an array", keywordPath);
            return;
        }

        if (arr.Count == 0)
        {
            result.AddError($"{keyword} array cannot be empty", keywordPath);
            return;
        }

        for (var i = 0; i < arr.Count; i++)
        {
            var item = arr[i];
            if (item is not null)
            {
                ValidateSchemaCore(item, result, AppendPath(keywordPath, i.ToString()), depth + 1);
            }
        }
    }

    private void ValidateAltnames(JsonNode? value, string path, ValidationResult result)
    {
        if (value is not JsonObject altnames)
        {
            result.AddError("altnames must be an object", AppendPath(path, "altnames"));
            return;
        }

        foreach (var prop in altnames)
        {
            if (prop.Value is not JsonValue jv || !jv.TryGetValue<string>(out _))
            {
                result.AddError($"altnames values must be strings", AppendPath(path, $"altnames/{prop.Key}"));
            }
        }
    }

    private void ValidateNonNegativeInteger(JsonObject schema, string keyword, string path, ValidationResult result)
    {
        if (schema.TryGetPropertyValue(keyword, out var value))
        {
            if (value is not JsonValue jv)
            {
                result.AddError($"{keyword} must be a non-negative integer", AppendPath(path, keyword));
                return;
            }

            if (jv.TryGetValue<int>(out var intVal))
            {
                if (intVal < 0)
                {
                    result.AddError($"{keyword} must be a non-negative integer", AppendPath(path, keyword));
                }
            }
            else if (jv.TryGetValue<long>(out var longVal))
            {
                if (longVal < 0)
                {
                    result.AddError($"{keyword} must be a non-negative integer", AppendPath(path, keyword));
                }
            }
            else
            {
                result.AddError($"{keyword} must be a non-negative integer", AppendPath(path, keyword));
            }
        }
    }

    private void ValidateNumber(JsonObject schema, string keyword, string path, ValidationResult result)
    {
        if (schema.TryGetPropertyValue(keyword, out var value))
        {
            if (value is not JsonValue jv)
            {
                result.AddError($"{keyword} must be a number", AppendPath(path, keyword));
                return;
            }

            if (!jv.TryGetValue<double>(out _) && !jv.TryGetValue<int>(out _) && !jv.TryGetValue<long>(out _))
            {
                result.AddError($"{keyword} must be a number", AppendPath(path, keyword));
            }
        }
    }

    private void ValidatePositiveNumber(JsonObject schema, string keyword, string path, ValidationResult result)
    {
        if (schema.TryGetPropertyValue(keyword, out var value))
        {
            if (value is not JsonValue jv)
            {
                result.AddError($"{keyword} must be a positive number", AppendPath(path, keyword));
                return;
            }

            if (jv.TryGetValue<double>(out var dVal))
            {
                if (dVal <= 0)
                {
                    result.AddError($"{keyword} must be a positive number", AppendPath(path, keyword));
                }
            }
            else if (jv.TryGetValue<int>(out var intVal))
            {
                if (intVal <= 0)
                {
                    result.AddError($"{keyword} must be a positive number", AppendPath(path, keyword));
                }
            }
            else
            {
                result.AddError($"{keyword} must be a positive number", AppendPath(path, keyword));
            }
        }
    }

    private static string AppendPath(string basePath, string segment)
    {
        if (string.IsNullOrEmpty(basePath))
        {
            return "/" + segment;
        }
        return basePath + "/" + segment;
    }
}
