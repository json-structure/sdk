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
    /// These types are defined in the JSON Structure Core specification.
    /// </summary>
    public static readonly HashSet<string> PrimitiveTypes = new(StringComparer.Ordinal)
    {
        // JSON Primitive Types (Section 3.2.1)
        "string", "number", "boolean", "null",
        // Extended Primitive Types - Integers (Section 3.2.2)
        "int8", "int16", "int32", "int64", "int128",
        "uint8", "uint16", "uint32", "uint64", "uint128",
        // Extended Primitive Types - Floating Point (Section 3.2.2)
        "float8", "float", "double",
        // Extended Primitive Types - Decimal (Section 3.2.2)
        "decimal",
        // Extended Primitive Types - Date/Time (Section 3.2.2)
        "date", "time", "datetime", "duration",
        // Extended Primitive Types - Other (Section 3.2.2)
        "uuid", "uri", "binary", "jsonpointer",
        // Aliases for JSON Schema compatibility
        "integer" // alias for int32
    };

    /// <summary>
    /// The valid compound types in JSON Structure.
    /// These types are defined in the JSON Structure Core specification (Section 3.2.3).
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
    private HashSet<string> _definedRefs = new();
    private HashSet<string> _importNamespaces = new();
    private JsonNode? _rootSchema;
    private JsonSourceLocator? _sourceLocator;

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
        if (schema is null)
        {
            var result = new ValidationResult();
            AddError(result, ErrorCodes.SchemaNull, "Schema cannot be null", "");
            return result;
        }

        // Serialize to string for source location tracking
        try
        {
            var serialized = schema.ToJsonString(new System.Text.Json.JsonSerializerOptions 
            { 
                WriteIndented = true,
                TypeInfoResolver = new System.Text.Json.Serialization.Metadata.DefaultJsonTypeInfoResolver()
            });
            _sourceLocator = new JsonSourceLocator(serialized);
        }
        catch
        {
            // If serialization fails, continue without source location
            _sourceLocator = null;
        }

        return ValidateCore(schema);
    }
    
    /// <summary>
    /// Resolves a local JSON Pointer reference to its target schema.
    /// </summary>
    private JsonNode? ResolveLocalRef(string refPath)
    {
        if (_rootSchema is null || !refPath.StartsWith("#/"))
            return null;
            
        var path = refPath[2..]; // Remove "#/"
        var segments = path.Split('/');
        
        JsonNode? current = _rootSchema;
        foreach (var segment in segments)
        {
            if (current is null) return null;
            
            // Handle JSON Pointer escaping
            var unescaped = segment.Replace("~1", "/").Replace("~0", "~");
            
            if (current is JsonObject obj)
            {
                if (!obj.TryGetPropertyValue(unescaped, out current))
                    return null;
            }
            else if (current is JsonArray arr && int.TryParse(unescaped, out var index))
            {
                if (index < 0 || index >= arr.Count)
                    return null;
                current = arr[index];
            }
            else
            {
                return null;
            }
        }
        
        return current;
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
            _sourceLocator = new JsonSourceLocator(json);
            return ValidateCore(schema);
        }
        catch (Exception ex)
        {
            return ValidationResult.Failure($"Failed to parse JSON: {ex.Message}");
        }
    }

    private ValidationResult ValidateCore(JsonNode? schema)
    {
        var result = new ValidationResult();

        if (schema is null)
        {
            AddError(result, ErrorCodes.SchemaNull, "Schema cannot be null", "");
            return result;
        }

        // Store root schema for ref resolution
        _rootSchema = schema;
        
        // Collect all defined references for $ref validation
        _definedRefs = CollectDefinedRefs(schema);
        
        // Collect namespaces with $import/$importdefs for lenient $ref validation
        _importNamespaces = CollectImportNamespaces(schema);

        ValidateSchemaCore(schema, result, "", 0, new HashSet<string>());
        return result;
    }

    /// <summary>
    /// Gets the source location for a JSON path.
    /// </summary>
    private JsonLocation GetLocation(string path)
    {
        return _sourceLocator?.GetLocation(path) ?? default;
    }

    /// <summary>
    /// Adds an error to the result with source location.
    /// </summary>
    private void AddError(ValidationResult result, string code, string message, string path)
    {
        result.AddError(code, message, path, GetLocation(path));
    }

    private HashSet<string> CollectDefinedRefs(JsonNode schema)
    {
        var refs = new HashSet<string>();
        CollectDefinedRefsRecursive(schema, "#", refs);
        return refs;
    }

    private void CollectDefinedRefsRecursive(JsonNode? node, string path, HashSet<string> refs)
    {
        if (node is not JsonObject obj) return;

        if (obj.TryGetPropertyValue("$defs", out var defs) && defs is JsonObject defsObj)
        {
            foreach (var prop in defsObj)
            {
                var refPath = $"{path}/$defs/{prop.Key}";
                refs.Add(refPath);
                CollectDefinedRefsRecursive(prop.Value, refPath, refs);
            }
        }

        if (obj.TryGetPropertyValue("definitions", out var definitions) && definitions is JsonObject defsObj2)
        {
            foreach (var prop in defsObj2)
            {
                var refPath = $"{path}/definitions/{prop.Key}";
                refs.Add(refPath);
                CollectDefinedRefsRecursive(prop.Value, refPath, refs);
            }
        }
    }

    private HashSet<string> CollectImportNamespaces(JsonNode schema)
    {
        var namespaces = new HashSet<string>();
        CollectImportNamespacesRecursive(schema, "#", namespaces);
        return namespaces;
    }

    private void CollectImportNamespacesRecursive(JsonNode? node, string path, HashSet<string> namespaces)
    {
        if (node is not JsonObject obj) return;

        // Check if this node has $import or $importdefs
        if (obj.ContainsKey("$import") || obj.ContainsKey("$importdefs"))
        {
            namespaces.Add(path);
        }

        // Recurse into $defs
        if (obj.TryGetPropertyValue("$defs", out var defs) && defs is JsonObject defsObj)
        {
            foreach (var prop in defsObj)
            {
                CollectImportNamespacesRecursive(prop.Value, $"{path}/$defs/{prop.Key}", namespaces);
            }
        }

        // Recurse into definitions
        if (obj.TryGetPropertyValue("definitions", out var definitions) && definitions is JsonObject defsObj2)
        {
            foreach (var prop in defsObj2)
            {
                CollectImportNamespacesRecursive(prop.Value, $"{path}/definitions/{prop.Key}", namespaces);
            }
        }
    }

    private void ValidateSchemaCore(JsonNode node, ValidationResult result, string path, int depth, HashSet<string> visitedRefs)
    {
        if (depth > _options.MaxValidationDepth)
        {
            AddError(result, ErrorCodes.SchemaMaxDepthExceeded, $"Maximum validation depth ({_options.MaxValidationDepth}) exceeded", path);
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
            AddError(result, ErrorCodes.SchemaInvalidType, "Schema must be a boolean or object", path);
            return;
        }

        if (node is not JsonObject schema)
        {
            AddError(result, ErrorCodes.SchemaInvalidType, "Schema must be a boolean or object", path);
            return;
        }

        // Validate $schema if present
        if (schema.TryGetPropertyValue("$schema", out var schemaValue))
        {
            if (schemaValue is not JsonValue sv || !sv.TryGetValue<string>(out var schemaUri))
            {
                AddError(result, ErrorCodes.SchemaKeywordInvalidType, "$schema must be a string", AppendPath(path, "$schema"));
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

        // Validate $ref if present - check if target exists and isn't circular
        if (schema.TryGetPropertyValue("$ref", out var refValue))
        {
            ValidateReference(refValue, "$ref", path, result);
            if (refValue is JsonValue rv && rv.TryGetValue<string>(out var refStr))
            {
                if (refStr.StartsWith("#/"))
                {
                    if (!_definedRefs.Contains(refStr))
                    {
                        // Check if this ref points into an import namespace
                        var isImportedRef = _importNamespaces.Any(ns => refStr.StartsWith(ns + "/"));
                        if (!isImportedRef)
                        {
                            AddError(result, ErrorCodes.SchemaRefNotFound, $"$ref target does not exist: {refStr}", AppendPath(path, "$ref"));
                        }
                    }
                    else
                    {
                        // Check for circular reference
                        if (visitedRefs.Contains(refStr))
                        {
                            // Circular references to properly defined types are valid in JSON Structure
                            // (e.g., ObjectType -> Property -> Type -> ObjectType in metaschemas)
                            // However, a direct self-reference with no content is invalid
                            var targetSchema = ResolveLocalRef(refStr);
                            if (targetSchema is JsonObject targetObj)
                            {
                                // Check if this is a definition that's only a $ref (no actual content)
                                var keys = targetObj.AsObject().Select(p => p.Key).ToList();
                                if (keys.Count == 1 && keys[0] == "$ref")
                                {
                                    AddError(result, ErrorCodes.SchemaRefCircular, $"Circular reference detected: {refStr}", AppendPath(path, "$ref"));
                                }
                            }
                            // For other circular refs, just stop recursing to prevent infinite loops
                        }
                        else
                        {
                            // Follow the ref to validate its target (with this ref in visited set)
                            var targetSchema = ResolveLocalRef(refStr);
                            if (targetSchema is JsonObject targetObj)
                            {
                                var newVisited = new HashSet<string>(visitedRefs) { refStr };
                                ValidateSchemaCore(targetObj, result, refStr, depth + 1, newVisited);
                            }
                        }
                    }
                }
            }
        }

        // Validate $anchor if present
        if (schema.TryGetPropertyValue("$anchor", out var anchorValue))
        {
            ValidateIdentifier(anchorValue, "$anchor", path, result);
        }

        // Validate $defs if present
        if (schema.TryGetPropertyValue("$defs", out var defsValue))
        {
            ValidateDefinitions(defsValue, "$defs", path, result, depth, visitedRefs);
        }

        // Validate definitions if present (alternate name for $defs)
        if (schema.TryGetPropertyValue("definitions", out var definitionsValue))
        {
            ValidateDefinitions(definitionsValue, "definitions", path, result, depth, visitedRefs);
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

        // Check if type is required - schemas defining data should have a type
        // Root schemas can have $root OR type, non-root schemas need type or composition keywords
        var isRootSchema = string.IsNullOrEmpty(path);
        var hasSchemaDefiningKeyword = schema.ContainsKey("type") || schema.ContainsKey("$ref") ||
            schema.ContainsKey("allOf") || schema.ContainsKey("anyOf") || schema.ContainsKey("oneOf") ||
            schema.ContainsKey("enum") || schema.ContainsKey("const") || schema.ContainsKey("$root") ||
            schema.ContainsKey("if") || schema.ContainsKey("then") || schema.ContainsKey("properties") ||
            schema.ContainsKey("items") || schema.ContainsKey("not") || schema.ContainsKey("$extends") ||
            schema.ContainsKey("required") || schema.ContainsKey("minItems") || schema.ContainsKey("maxItems") ||
            schema.ContainsKey("minLength") || schema.ContainsKey("maxLength") || schema.ContainsKey("minimum") ||
            schema.ContainsKey("maximum") || schema.ContainsKey("pattern") || schema.ContainsKey("format");
        
        // For root schemas, we need either $root or type/composition keywords
        // For non-root schemas in nested positions, we need type/composition keywords
        if (isRootSchema)
        {
            // Root schema should have $root, type, or other schema-defining keywords
            // But skip if it's just $defs (pure definition container)
            var hasOnlyMeta = schema.All(p => 
                p.Key == "$schema" || p.Key == "description" || p.Key == "title" || 
                p.Key == "$id" || p.Key == "$comment");
            
            if (hasOnlyMeta && !hasSchemaDefiningKeyword)
            {
                AddError(result, ErrorCodes.SchemaRootMissingType, "Root schema must have 'type', '$root', or other schema-defining keyword", path);
            }
        }
        else if (!hasSchemaDefiningKeyword && 
            !schema.ContainsKey("$import") && !schema.ContainsKey("$importdefs") &&
            !schema.ContainsKey("abstract") && !schema.ContainsKey("$abstract"))
        {
            AddError(result, ErrorCodes.SchemaMissingType, "Schema must have a 'type' keyword or other schema-defining keyword", path);
        }

        // Validate type if present
        string? typeStr = null;
        if (schema.TryGetPropertyValue("type", out var typeValue))
        {
            ValidateType(typeValue, path, result);
            typeStr = GetTypeString(typeValue);
            
            // Type-specific validation
            if (typeStr is not null)
            {
                switch (typeStr)
                {
                    case "object":
                        ValidateObjectSchema(schema, path, result, depth, visitedRefs);
                        break;
                    case "array":
                    case "set":
                        ValidateArraySchema(schema, path, result, depth, visitedRefs);
                        break;
                    case "tuple":
                        ValidateTupleSchema(schema, path, result, depth, visitedRefs);
                        break;
                    case "map":
                        ValidateMapSchema(schema, path, result, depth, visitedRefs);
                        break;
                    case "choice":
                        ValidateChoiceSchema(schema, path, result, depth, visitedRefs);
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

        // Cross-type constraint validation
        ValidateCrossTypeConstraints(schema, typeStr, path, result);

        // Range consistency validation
        ValidateRangeConsistency(schema, path, result);

        // Validate enum if present
        if (schema.TryGetPropertyValue("enum", out var enumValue))
        {
            ValidateEnum(enumValue, path, result);
        }

        // Validate const if present - const value must be conformant with the type definition
        if (schema.TryGetPropertyValue("const", out var constValue))
        {
            ValidateConstValue(constValue, typeStr, path, result);
        }

        // Validate conditional composition keywords
        ValidateConditionalComposition(schema, path, result, depth, visitedRefs);

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
            AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"{keyword} must be a string", AppendPath(path, keyword));
        }
    }

    private void ValidateIdentifier(JsonNode? value, string keyword, string path, ValidationResult result)
    {
        if (value is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"{keyword} must be a string", AppendPath(path, keyword));
            return;
        }

        if (!IdentifierPattern.IsMatch(str))
        {
            AddError(result, ErrorCodes.SchemaNameInvalid, $"{keyword} must be a valid identifier (start with letter or underscore, contain only letters, digits, underscores)", 
                AppendPath(path, keyword));
        }
    }

    private void ValidateReference(JsonNode? value, string keyword, string path, ValidationResult result)
    {
        if (value is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"{keyword} must be a string", AppendPath(path, keyword));
            return;
        }

        // References should be valid URI references or JSON pointers
        if (string.IsNullOrWhiteSpace(str))
        {
            AddError(result, ErrorCodes.SchemaKeywordEmpty, $"{keyword} cannot be empty", AppendPath(path, keyword));
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
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"{keyword} array items must be strings", AppendPath(path, keyword));
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
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"{keyword} object values must be strings", AppendPath(path, $"{keyword}/{prop.Key}"));
                }
            }
            return;
        }

        AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"{keyword} must be a string, array, or object", AppendPath(path, keyword));
    }

    private void ValidateDefinitions(JsonNode? value, string keyword, string path, ValidationResult result, int depth, HashSet<string> visitedRefs)
    {
        if (value is not JsonObject defs)
        {
            AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"{keyword} must be an object", AppendPath(path, keyword));
            return;
        }

        foreach (var prop in defs)
        {
            if (prop.Value is not null)
            {
                ValidateDefinitionOrNamespace(prop.Value, AppendPath(path, $"{keyword}/{prop.Key}"), result, depth + 1, visitedRefs);
            }
        }
    }

    private void ValidateDefinitionOrNamespace(JsonNode value, string path, ValidationResult result, int depth, HashSet<string> visitedRefs)
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
                ValidateSchemaCore(value, result, path, depth, visitedRefs);
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
                        ValidateDefinitionOrNamespace(prop.Value, AppendPath(path, prop.Key), result, depth + 1, visitedRefs);
                    }
                }
            }
        }
        else
        {
            ValidateSchemaCore(value, result, path, depth, visitedRefs);
        }
    }

    private void ValidateType(JsonNode? value, string path, ValidationResult result)
    {
        var typePath = AppendPath(path, "type");

        if (value is JsonValue jv && jv.TryGetValue<string>(out var typeStr))
        {
            if (!AllTypes.Contains(typeStr) && !typeStr.Contains(':'))
            {
                AddError(result, ErrorCodes.SchemaTypeInvalid, $"Invalid type: '{typeStr}'", typePath);
            }
            return;
        }

        if (value is JsonArray arr)
        {
            if (arr.Count == 0)
            {
                AddError(result, ErrorCodes.SchemaTypeArrayEmpty, "type array cannot be empty", typePath);
                return;
            }

            foreach (var item in arr)
            {
                // Type union can contain strings or objects with $ref
                if (item is JsonValue itemValue && itemValue.TryGetValue<string>(out var itemType))
                {
                    if (!AllTypes.Contains(itemType) && !itemType.Contains(':'))
                    {
                        AddError(result, ErrorCodes.SchemaTypeInvalid, $"Invalid type in array: '{itemType}'", typePath);
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
                        AddError(result, ErrorCodes.SchemaTypeObjectMissingRef, "type array objects must contain $ref", typePath);
                    }
                }
                else
                {
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, "type array items must be strings or objects with $ref", typePath);
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
                AddError(result, ErrorCodes.SchemaTypeObjectMissingRef, "type object must contain $ref", typePath);
            }
            return;
        }

        AddError(result, ErrorCodes.SchemaKeywordInvalidType, "type must be a string, array of strings, or object with $ref", typePath);
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
        "float8" or "float" or "double" or "decimal";

    private void ValidateCrossTypeConstraints(JsonObject schema, string? typeStr, string path, ValidationResult result)
    {
        var isString = typeStr == "string";
        var isNumeric = IsNumericType(typeStr);
        var isArray = typeStr is "array" or "set";

        // String constraints on non-string types
        if (!isString && typeStr is not null)
        {
            if (schema.ContainsKey("minLength"))
                AddError(result, ErrorCodes.SchemaConstraintInvalidForType, $"'minLength' constraint is only valid for string type, not '{typeStr}'", AppendPath(path, "minLength"));
            if (schema.ContainsKey("maxLength"))
                AddError(result, ErrorCodes.SchemaConstraintInvalidForType, $"'maxLength' constraint is only valid for string type, not '{typeStr}'", AppendPath(path, "maxLength"));
            if (schema.ContainsKey("pattern"))
                AddError(result, ErrorCodes.SchemaConstraintInvalidForType, $"'pattern' constraint is only valid for string type, not '{typeStr}'", AppendPath(path, "pattern"));
        }

        // Numeric constraints on non-numeric types  
        if (!isNumeric && typeStr is not null)
        {
            if (schema.ContainsKey("minimum"))
                AddError(result, ErrorCodes.SchemaConstraintInvalidForType, $"'minimum' constraint is only valid for numeric types, not '{typeStr}'", AppendPath(path, "minimum"));
            if (schema.ContainsKey("maximum"))
                AddError(result, ErrorCodes.SchemaConstraintInvalidForType, $"'maximum' constraint is only valid for numeric types, not '{typeStr}'", AppendPath(path, "maximum"));
            if (schema.ContainsKey("exclusiveMinimum"))
                AddError(result, ErrorCodes.SchemaConstraintInvalidForType, $"'exclusiveMinimum' constraint is only valid for numeric types, not '{typeStr}'", AppendPath(path, "exclusiveMinimum"));
            if (schema.ContainsKey("exclusiveMaximum"))
                AddError(result, ErrorCodes.SchemaConstraintInvalidForType, $"'exclusiveMaximum' constraint is only valid for numeric types, not '{typeStr}'", AppendPath(path, "exclusiveMaximum"));
        }

        // Array constraints on non-array types
        if (!isArray && typeStr is not "tuple" and not null)
        {
            if (schema.ContainsKey("minItems"))
                AddError(result, ErrorCodes.SchemaConstraintInvalidForType, $"'minItems' constraint is only valid for array/set/tuple types, not '{typeStr}'", AppendPath(path, "minItems"));
            if (schema.ContainsKey("maxItems"))
                AddError(result, ErrorCodes.SchemaConstraintInvalidForType, $"'maxItems' constraint is only valid for array/set/tuple types, not '{typeStr}'", AppendPath(path, "maxItems"));
        }
    }

    private void ValidateRangeConsistency(JsonObject schema, string path, ValidationResult result)
    {
        // Check minimum <= maximum
        if (schema.TryGetPropertyValue("minimum", out var minNode) && schema.TryGetPropertyValue("maximum", out var maxNode))
        {
            var min = GetNumber(minNode);
            var max = GetNumber(maxNode);
            if (min.HasValue && max.HasValue && min.Value > max.Value)
            {
                AddError(result, ErrorCodes.SchemaMinGreaterThanMax, "'minimum' cannot be greater than 'maximum'", path);
            }
        }

        // Check minLength <= maxLength
        if (schema.TryGetPropertyValue("minLength", out var minLenNode) && schema.TryGetPropertyValue("maxLength", out var maxLenNode))
        {
            var minLen = GetInteger(minLenNode);
            var maxLen = GetInteger(maxLenNode);
            if (minLen.HasValue && maxLen.HasValue && minLen.Value > maxLen.Value)
            {
                AddError(result, ErrorCodes.SchemaMinGreaterThanMax, "'minLength' cannot be greater than 'maxLength'", path);
            }
        }

        // Check minItems <= maxItems
        if (schema.TryGetPropertyValue("minItems", out var minItemsNode) && schema.TryGetPropertyValue("maxItems", out var maxItemsNode))
        {
            var minItems = GetInteger(minItemsNode);
            var maxItems = GetInteger(maxItemsNode);
            if (minItems.HasValue && maxItems.HasValue && minItems.Value > maxItems.Value)
            {
                AddError(result, ErrorCodes.SchemaMinGreaterThanMax, "'minItems' cannot be greater than 'maxItems'", path);
            }
        }
    }

    private static double? GetNumber(JsonNode? node)
    {
        if (node is JsonValue jv)
        {
            if (jv.TryGetValue<double>(out var d)) return d;
            if (jv.TryGetValue<int>(out var i)) return i;
            if (jv.TryGetValue<long>(out var l)) return l;
        }
        return null;
    }

    private static int? GetInteger(JsonNode? node)
    {
        if (node is JsonValue jv)
        {
            if (jv.TryGetValue<int>(out var i)) return i;
            if (jv.TryGetValue<long>(out var l)) return (int)l;
        }
        return null;
    }

    private void ValidateObjectSchema(JsonObject schema, string path, ValidationResult result, int depth, HashSet<string> visitedRefs)
    {
        var definedProps = new HashSet<string>();
        
        // Validate properties
        if (schema.TryGetPropertyValue("properties", out var propsValue))
        {
            if (propsValue is not JsonObject props)
            {
                AddError(result, ErrorCodes.SchemaPropertiesNotObject, "properties must be an object", AppendPath(path, "properties"));
            }
            else
            {
                foreach (var prop in props)
                {
                    definedProps.Add(prop.Key);
                    if (prop.Value is not null)
                    {
                        ValidateSchemaCore(prop.Value, result, AppendPath(path, $"properties/{prop.Key}"), depth + 1, visitedRefs);
                    }
                }
            }
        }

        // Validate required - check that required properties are defined
        if (schema.TryGetPropertyValue("required", out var requiredValue))
        {
            if (requiredValue is not JsonArray reqArr)
            {
                AddError(result, ErrorCodes.SchemaRequiredNotArray, "required must be an array", AppendPath(path, "required"));
            }
            else
            {
                foreach (var item in reqArr)
                {
                    if (item is not JsonValue itemValue || !itemValue.TryGetValue<string>(out var reqProp))
                    {
                        AddError(result, ErrorCodes.SchemaRequiredItemNotString, "required array items must be strings", AppendPath(path, "required"));
                        break;
                    }
                    else if (definedProps.Count > 0 && !definedProps.Contains(reqProp))
                    {
                        AddError(result, ErrorCodes.SchemaRequiredPropertyNotDefined, $"Required property '{reqProp}' is not defined in properties", AppendPath(path, "required"));
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
                ValidateSchemaCore(additionalValue, result, AppendPath(path, "additionalProperties"), depth + 1, visitedRefs);
            }
            else
            {
                AddError(result, ErrorCodes.SchemaAdditionalPropertiesInvalid, "additionalProperties must be a boolean or schema", AppendPath(path, "additionalProperties"));
            }
        }

        // Validate minProperties/maxProperties
        ValidateNonNegativeInteger(schema, "minProperties", path, result);
        ValidateNonNegativeInteger(schema, "maxProperties", path, result);
    }

    private void ValidateArraySchema(JsonObject schema, string path, ValidationResult result, int depth, HashSet<string> visitedRefs)
    {
        // Array type requires items schema
        if (!schema.ContainsKey("items") && !schema.ContainsKey("contains"))
        {
            AddError(result, ErrorCodes.SchemaArrayMissingItems, "array type requires 'items' or 'contains' schema", path);
        }

        // Validate items
        if (schema.TryGetPropertyValue("items", out var itemsValue))
        {
            ValidateSchemaCore(itemsValue!, result, AppendPath(path, "items"), depth + 1, visitedRefs);
        }

        // Validate minItems/maxItems
        ValidateNonNegativeInteger(schema, "minItems", path, result);
        ValidateNonNegativeInteger(schema, "maxItems", path, result);

        // Validate uniqueItems
        if (schema.TryGetPropertyValue("uniqueItems", out var uniqueValue))
        {
            if (uniqueValue is not JsonValue jv || !jv.TryGetValue<bool>(out _))
            {
                AddError(result, ErrorCodes.SchemaUniqueItemsNotBoolean, "uniqueItems must be a boolean", AppendPath(path, "uniqueItems"));
            }
        }

        // Validate contains
        if (schema.TryGetPropertyValue("contains", out var containsValue))
        {
            ValidateSchemaCore(containsValue!, result, AppendPath(path, "contains"), depth + 1, visitedRefs);
        }

        ValidateNonNegativeInteger(schema, "minContains", path, result);
        ValidateNonNegativeInteger(schema, "maxContains", path, result);
    }

    private void ValidateTupleSchema(JsonObject schema, string path, ValidationResult result, int depth, HashSet<string> visitedRefs)
    {
        var hasPrefixItems = schema.ContainsKey("prefixItems");
        var hasTupleProperties = schema.ContainsKey("tuple") && schema.ContainsKey("properties");
        
        // Tuple requires either prefixItems or (tuple + properties) format
        if (!hasPrefixItems && !hasTupleProperties)
        {
            AddError(result, ErrorCodes.SchemaTupleMissingPrefixItems, "tuple type requires 'prefixItems' or 'tuple' with 'properties'", path);
        }
        
        // Validate prefixItems
        if (schema.TryGetPropertyValue("prefixItems", out var prefixValue))
        {
            if (prefixValue is not JsonArray prefixArr)
            {
                AddError(result, ErrorCodes.SchemaPrefixItemsNotArray, "prefixItems must be an array", AppendPath(path, "prefixItems"));
            }
            else
            {
                for (var i = 0; i < prefixArr.Count; i++)
                {
                    var item = prefixArr[i];
                    if (item is not null)
                    {
                        ValidateSchemaCore(item, result, AppendPath(path, $"prefixItems/{i}"), depth + 1, visitedRefs);
                    }
                }
            }
        }
        
        // Validate tuple + properties format
        if (hasTupleProperties)
        {
            if (schema.TryGetPropertyValue("tuple", out var tupleValue) && tupleValue is JsonArray tupleArr)
            {
                if (schema.TryGetPropertyValue("properties", out var propsValue) && propsValue is JsonObject props)
                {
                    foreach (var propName in tupleArr)
                    {
                        var name = propName?.GetValue<string>();
                        if (name is not null && props.TryGetPropertyValue(name, out var propSchema))
                        {
                            ValidateSchemaCore(propSchema!, result, AppendPath(path, $"properties/{name}"), depth + 1, visitedRefs);
                        }
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
                ValidateSchemaCore(itemsValue, result, AppendPath(path, "items"), depth + 1, visitedRefs);
            }
            else
            {
                AddError(result, ErrorCodes.SchemaItemsInvalidForTuple, "items must be a boolean or schema for tuple type", AppendPath(path, "items"));
            }
        }
    }

    private void ValidateMapSchema(JsonObject schema, string path, ValidationResult result, int depth, HashSet<string> visitedRefs)
    {
        // Map type requires values schema
        if (!schema.ContainsKey("values"))
        {
            AddError(result, ErrorCodes.SchemaMapMissingValues, "map type requires 'values' schema", path);
        }

        // Validate values schema
        if (schema.TryGetPropertyValue("values", out var valuesValue))
        {
            ValidateSchemaCore(valuesValue!, result, AppendPath(path, "values"), depth + 1, visitedRefs);
        }

        // Validate propertyNames (for key constraints)
        if (schema.TryGetPropertyValue("propertyNames", out var propNamesValue))
        {
            ValidateSchemaCore(propNamesValue!, result, AppendPath(path, "propertyNames"), depth + 1, visitedRefs);
        }

        ValidateNonNegativeInteger(schema, "minProperties", path, result);
        ValidateNonNegativeInteger(schema, "maxProperties", path, result);
    }

    private void ValidateChoiceSchema(JsonObject schema, string path, ValidationResult result, int depth, HashSet<string> visitedRefs)
    {
        // Choice type requires options, choices, or oneOf
        var hasOptions = schema.ContainsKey("options");
        var hasChoices = schema.ContainsKey("choices");
        var hasOneOf = schema.ContainsKey("oneOf");
        if (!hasOptions && !hasChoices && !hasOneOf)
        {
            AddError(result, ErrorCodes.SchemaChoiceMissingOptions, "choice type requires 'options', 'choices', or 'oneOf'", path);
        }

        // Validate options (legacy keyword)
        if (schema.TryGetPropertyValue("options", out var optionsValue))
        {
            if (optionsValue is not JsonObject opts)
            {
                AddError(result, ErrorCodes.SchemaOptionsNotObject, "options must be an object", AppendPath(path, "options"));
            }
            else
            {
                foreach (var opt in opts)
                {
                    if (opt.Value is not null)
                    {
                        ValidateSchemaCore(opt.Value, result, AppendPath(path, $"options/{opt.Key}"), depth + 1, visitedRefs);
                    }
                }
            }
        }

        // Validate choices (current keyword)
        if (schema.TryGetPropertyValue("choices", out var choicesValue))
        {
            if (choicesValue is not JsonObject choices)
            {
                AddError(result, ErrorCodes.SchemaChoicesNotObject, "choices must be an object", AppendPath(path, "choices"));
            }
            else
            {
                foreach (var choice in choices)
                {
                    if (choice.Value is not null)
                    {
                        ValidateSchemaCore(choice.Value, result, AppendPath(path, $"choices/{choice.Key}"), depth + 1, visitedRefs);
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
                AddError(result, ErrorCodes.SchemaPatternNotString, "pattern must be a string", AppendPath(path, "pattern"));
            }
            else
            {
                try
                {
                    _ = new Regex(pattern);
                }
                catch (ArgumentException)
                {
                    AddError(result, ErrorCodes.SchemaPatternInvalid, $"pattern is not a valid regular expression: '{pattern}'", AppendPath(path, "pattern"));
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
            AddError(result, ErrorCodes.SchemaEnumNotArray, "enum must be an array", AppendPath(path, "enum"));
            return;
        }

        if (arr.Count == 0)
        {
            AddError(result, ErrorCodes.SchemaEnumEmpty, "enum array cannot be empty", AppendPath(path, "enum"));
            return;
        }

        // Check for duplicate enum values
        var seen = new HashSet<string>();
        foreach (var item in arr)
        {
            var itemJson = item?.ToJsonString() ?? "null";
            if (!seen.Add(itemJson))
            {
                AddError(result, ErrorCodes.SchemaEnumDuplicates, "enum array contains duplicate values", AppendPath(path, "enum"));
                break;
            }
        }
    }

    private void ValidateConstValue(JsonNode? constValue, string? typeStr, string path, ValidationResult result)
    {
        if (string.IsNullOrEmpty(typeStr))
        {
            // No type specified, const can be any value
            return;
        }

        var constPath = AppendPath(path, "const");
        
        // Validate that const value matches the declared type
        switch (typeStr)
        {
            case "null":
                if (constValue is not null)
                {
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, "const value must be null for type 'null'", constPath);
                }
                break;
                
            case "boolean":
                if (constValue is not JsonValue jvBool || !jvBool.TryGetValue<bool>(out _))
                {
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, "const value must be a boolean for type 'boolean'", constPath);
                }
                break;
                
            case "string":
            case "date":
            case "time":
            case "datetime":
            case "duration":
            case "uuid":
            case "uri":
            case "binary":
            case "jsonpointer":
                if (constValue is not JsonValue jvStr || !jvStr.TryGetValue<string>(out _))
                {
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"const value must be a string for type '{typeStr}'", constPath);
                }
                break;
                
            case "number":
            case "float":
            case "float8":
            case "double":
                if (constValue is not JsonValue jvNum || 
                    (!jvNum.TryGetValue<double>(out _) && !jvNum.TryGetValue<decimal>(out _)))
                {
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"const value must be a number for type '{typeStr}'", constPath);
                }
                break;
                
            case "integer":
            case "int8":
            case "int16":
            case "int32":
            case "uint8":
            case "uint16":
            case "uint32":
                if (constValue is not JsonValue jvInt || !jvInt.TryGetValue<long>(out _))
                {
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"const value must be an integer for type '{typeStr}'", constPath);
                }
                break;
                
            case "int64":
            case "uint64":
            case "int128":
            case "uint128":
            case "decimal":
                // These are represented as strings in JSON
                if (constValue is not JsonValue jvBigInt || !jvBigInt.TryGetValue<string>(out _))
                {
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"const value must be a string (numeric representation) for type '{typeStr}'", constPath);
                }
                break;
                
            case "object":
                if (constValue is not JsonObject)
                {
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, "const value must be an object for type 'object'", constPath);
                }
                break;
                
            case "array":
            case "set":
            case "tuple":
                if (constValue is not JsonArray)
                {
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, $"const value must be an array for type '{typeStr}'", constPath);
                }
                break;
                
            case "map":
                if (constValue is not JsonObject)
                {
                    AddError(result, ErrorCodes.SchemaKeywordInvalidType, "const value must be an object for type 'map'", constPath);
                }
                break;
                
            case "any":
                // Any value is valid for type 'any'
                break;
                
            case "choice":
                // Choice const validation would require knowing the choice options
                // For now, we just accept any value
                break;
        }
    }

    private void ValidateConditionalComposition(JsonObject schema, string path, ValidationResult result, int depth, HashSet<string> visitedRefs)
    {
        // Validate allOf
        if (schema.TryGetPropertyValue("allOf", out var allOfValue))
        {
            ValidateSchemaArray(allOfValue, "allOf", path, result, depth, visitedRefs);
        }

        // Validate anyOf
        if (schema.TryGetPropertyValue("anyOf", out var anyOfValue))
        {
            ValidateSchemaArray(anyOfValue, "anyOf", path, result, depth, visitedRefs);
        }

        // Validate oneOf
        if (schema.TryGetPropertyValue("oneOf", out var oneOfValue))
        {
            ValidateSchemaArray(oneOfValue, "oneOf", path, result, depth, visitedRefs);
        }

        // Validate not
        if (schema.TryGetPropertyValue("not", out var notValue))
        {
            ValidateSchemaCore(notValue!, result, AppendPath(path, "not"), depth + 1, visitedRefs);
        }

        // Validate if/then/else
        if (schema.TryGetPropertyValue("if", out var ifValue))
        {
            ValidateSchemaCore(ifValue!, result, AppendPath(path, "if"), depth + 1, visitedRefs);
        }

        if (schema.TryGetPropertyValue("then", out var thenValue))
        {
            ValidateSchemaCore(thenValue!, result, AppendPath(path, "then"), depth + 1, visitedRefs);
        }

        if (schema.TryGetPropertyValue("else", out var elseValue))
        {
            ValidateSchemaCore(elseValue!, result, AppendPath(path, "else"), depth + 1, visitedRefs);
        }
    }

    private void ValidateSchemaArray(JsonNode? value, string keyword, string path, ValidationResult result, int depth, HashSet<string> visitedRefs)
    {
        var keywordPath = AppendPath(path, keyword);

        if (value is not JsonArray arr)
        {
            AddError(result, ErrorCodes.SchemaCompositionNotArray, $"{keyword} must be an array", keywordPath);
            return;
        }

        if (arr.Count == 0)
        {
            AddError(result, ErrorCodes.SchemaCompositionEmpty, $"{keyword} array cannot be empty", keywordPath);
            return;
        }

        for (var i = 0; i < arr.Count; i++)
        {
            var item = arr[i];
            if (item is not null)
            {
                ValidateSchemaCore(item, result, AppendPath(keywordPath, i.ToString()), depth + 1, visitedRefs);
            }
        }
    }

    private void ValidateAltnames(JsonNode? value, string path, ValidationResult result)
    {
        if (value is not JsonObject altnames)
        {
            AddError(result, ErrorCodes.SchemaAltnamesNotObject, "altnames must be an object", AppendPath(path, "altnames"));
            return;
        }

        foreach (var prop in altnames)
        {
            if (prop.Value is not JsonValue jv || !jv.TryGetValue<string>(out _))
            {
                AddError(result, ErrorCodes.SchemaAltnamesValueNotString, $"altnames values must be strings", AppendPath(path, $"altnames/{prop.Key}"));
            }
        }
    }

    private void ValidateNonNegativeInteger(JsonObject schema, string keyword, string path, ValidationResult result)
    {
        if (schema.TryGetPropertyValue(keyword, out var value))
        {
            if (value is not JsonValue jv)
            {
                AddError(result, ErrorCodes.SchemaIntegerConstraintInvalid, $"{keyword} must be a non-negative integer", AppendPath(path, keyword));
                return;
            }

            if (jv.TryGetValue<int>(out var intVal))
            {
                if (intVal < 0)
                {
                    AddError(result, ErrorCodes.SchemaIntegerConstraintInvalid, $"{keyword} must be a non-negative integer", AppendPath(path, keyword));
                }
            }
            else if (jv.TryGetValue<long>(out var longVal))
            {
                if (longVal < 0)
                {
                    AddError(result, ErrorCodes.SchemaIntegerConstraintInvalid, $"{keyword} must be a non-negative integer", AppendPath(path, keyword));
                }
            }
            else
            {
                AddError(result, ErrorCodes.SchemaIntegerConstraintInvalid, $"{keyword} must be a non-negative integer", AppendPath(path, keyword));
            }
        }
    }

    private void ValidateNumber(JsonObject schema, string keyword, string path, ValidationResult result)
    {
        if (schema.TryGetPropertyValue(keyword, out var value))
        {
            if (value is not JsonValue jv)
            {
                AddError(result, ErrorCodes.SchemaNumberConstraintInvalid, $"{keyword} must be a number", AppendPath(path, keyword));
                return;
            }

            if (!jv.TryGetValue<double>(out _) && !jv.TryGetValue<int>(out _) && !jv.TryGetValue<long>(out _))
            {
                AddError(result, ErrorCodes.SchemaNumberConstraintInvalid, $"{keyword} must be a number", AppendPath(path, keyword));
            }
        }
    }

    private void ValidatePositiveNumber(JsonObject schema, string keyword, string path, ValidationResult result)
    {
        if (schema.TryGetPropertyValue(keyword, out var value))
        {
            if (value is not JsonValue jv)
            {
                AddError(result, ErrorCodes.SchemaPositiveNumberConstraintInvalid, $"{keyword} must be a positive number", AppendPath(path, keyword));
                return;
            }

            if (jv.TryGetValue<double>(out var dVal))
            {
                if (dVal <= 0)
                {
                    AddError(result, ErrorCodes.SchemaPositiveNumberConstraintInvalid, $"{keyword} must be a positive number", AppendPath(path, keyword));
                }
            }
            else if (jv.TryGetValue<int>(out var intVal))
            {
                if (intVal <= 0)
                {
                    AddError(result, ErrorCodes.SchemaPositiveNumberConstraintInvalid, $"{keyword} must be a positive number", AppendPath(path, keyword));
                }
            }
            else
            {
                AddError(result, ErrorCodes.SchemaPositiveNumberConstraintInvalid, $"{keyword} must be a positive number", AppendPath(path, keyword));
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
