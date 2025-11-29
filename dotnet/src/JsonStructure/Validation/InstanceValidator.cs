// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Globalization;
using System.Numerics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace JsonStructure.Validation;

/// <summary>
/// Validates JSON instances against JSON Structure schemas.
/// </summary>
public sealed class InstanceValidator
{
    private readonly ValidationOptions _options;
    private readonly Dictionary<string, JsonNode> _resolvedRefs = new();
    private readonly Dictionary<string, JsonNode?> _loadedImports = new();
    private JsonSourceLocator? _instanceLocator;

    /// <summary>
    /// Initializes a new instance of <see cref="InstanceValidator"/>.
    /// </summary>
    /// <param name="options">Optional validation options.</param>
    public InstanceValidator(ValidationOptions? options = null)
    {
        _options = options ?? ValidationOptions.Default;
    }

    /// <summary>
    /// Validates an instance against a schema.
    /// </summary>
    /// <param name="instance">The instance to validate.</param>
    /// <param name="schema">The schema to validate against.</param>
    /// <returns>The validation result.</returns>
    public ValidationResult Validate(JsonNode? instance, JsonNode? schema)
    {
        _instanceLocator = null; // No source tracking for JsonNode overload
        return ValidateCore(instance, schema);
    }

    /// <summary>
    /// Validates an instance against a schema from JSON strings.
    /// </summary>
    /// <param name="instanceJson">The instance JSON string.</param>
    /// <param name="schemaJson">The schema JSON string.</param>
    /// <returns>The validation result.</returns>
    public ValidationResult Validate(string instanceJson, string schemaJson)
    {
        try
        {
            var instance = JsonNode.Parse(instanceJson);
            var schema = JsonNode.Parse(schemaJson);
            _instanceLocator = new JsonSourceLocator(instanceJson);
            return ValidateCore(instance, schema);
        }
        catch (Exception ex)
        {
            return ValidationResult.Failure($"Failed to parse JSON: {ex.Message}");
        }
    }

    private ValidationResult ValidateCore(JsonNode? instance, JsonNode? schema)
    {
        var result = new ValidationResult();

        if (schema is null)
        {
            AddError(result, ErrorCodes.SchemaNull, "Schema cannot be null", "");
            return result;
        }

        _resolvedRefs.Clear();
        _loadedImports.Clear();
        
        // Handle $root - if the schema has a $root property, resolve it and use that as the validation target
        var effectiveSchema = schema;
        if (schema is JsonObject schemaObj && schemaObj.TryGetPropertyValue("$root", out var rootRef))
        {
            var rootRefStr = rootRef?.GetValue<string>();
            if (!string.IsNullOrEmpty(rootRefStr))
            {
                var resolved = ResolveRef(rootRefStr, schema);
                if (resolved is not null)
                {
                    effectiveSchema = resolved;
                }
                else
                {
                    AddError(result, ErrorCodes.InstanceRootUnresolved, $"Unable to resolve $root reference: {rootRefStr}", "");
                    return result;
                }
            }
        }
        
        ValidateInstance(instance, effectiveSchema, schema, result, "", 0);
        return result;
    }

    private void ValidateInstance(JsonNode? instance, JsonNode schema, JsonNode rootSchema, 
        ValidationResult result, string path, int depth)
    {
        if (depth > _options.MaxValidationDepth)
        {
            AddError(result, ErrorCodes.InstanceMaxDepthExceeded, $"Maximum validation depth ({_options.MaxValidationDepth}) exceeded", path);
            return;
        }

        if (_options.StopOnFirstError && !result.IsValid)
        {
            return;
        }

        // Handle boolean schemas
        if (schema is JsonValue boolValue && boolValue.TryGetValue<bool>(out var b))
        {
            if (!b && instance is not null)
            {
                AddError(result, ErrorCodes.InstanceSchemaFalse, "Schema 'false' rejects all values", path);
            }
            return;
        }

        if (schema is not JsonObject schemaObj)
        {
            AddError(result, ErrorCodes.SchemaInvalidType, "Schema must be a boolean or object", path);
            return;
        }

        // Handle $ref
        if (schemaObj.TryGetPropertyValue("$ref", out var refValue))
        {
            var refStr = refValue?.GetValue<string>();
            if (!string.IsNullOrEmpty(refStr))
            {
                var resolvedSchema = ResolveRef(refStr, rootSchema);
                if (resolvedSchema is null)
                {
                    AddError(result, ErrorCodes.InstanceRefUnresolved, $"Unable to resolve reference: {refStr}", path);
                    return;
                }
                ValidateInstance(instance, resolvedSchema, rootSchema, result, path, depth + 1);
                return;
            }
        }

        // Handle $extends (can be a string or array of strings for multiple inheritance)
        if (schemaObj.TryGetPropertyValue("$extends", out var extendsValue))
        {
            var extendsRefs = new List<string>();
            
            if (extendsValue is JsonValue jv && jv.TryGetValue<string>(out var singleRef))
            {
                extendsRefs.Add(singleRef);
            }
            else if (extendsValue is JsonArray extendsArr)
            {
                foreach (var item in extendsArr)
                {
                    if (item is JsonValue itemVal && itemVal.TryGetValue<string>(out var itemRef))
                    {
                        extendsRefs.Add(itemRef);
                    }
                }
            }
            
            if (extendsRefs.Count > 0)
            {
                // Merge base types in order (first-wins for properties)
                var mergedProperties = new JsonObject();
                var mergedRequired = new HashSet<string>();
                
                foreach (var extRef in extendsRefs)
                {
                    var baseSchema = ResolveRef(extRef, rootSchema);
                    if (baseSchema is JsonObject baseObj)
                    {
                        // Merge properties (first-wins)
                        if (baseObj.TryGetPropertyValue("properties", out var baseProps) && baseProps is JsonObject basePropObj)
                        {
                            foreach (var prop in basePropObj)
                            {
                                if (!mergedProperties.ContainsKey(prop.Key))
                                {
                                    mergedProperties[prop.Key] = prop.Value?.DeepClone();
                                }
                            }
                        }
                        // Merge required
                        if (baseObj.TryGetPropertyValue("required", out var baseReq) && baseReq is JsonArray baseReqArr)
                        {
                            foreach (var r in baseReqArr)
                            {
                                if (r is JsonValue rv && rv.TryGetValue<string>(out var reqStr))
                                {
                                    mergedRequired.Add(reqStr);
                                }
                            }
                        }
                    }
                }
                
                // Merge derived schema's properties on top
                if (schemaObj.TryGetPropertyValue("properties", out var schemaProps) && schemaProps is JsonObject schemaPropObj)
                {
                    foreach (var prop in schemaPropObj)
                    {
                        mergedProperties[prop.Key] = prop.Value?.DeepClone();
                    }
                }
                if (schemaObj.TryGetPropertyValue("required", out var schemaReq) && schemaReq is JsonArray schemaReqArr)
                {
                    foreach (var r in schemaReqArr)
                    {
                        if (r is JsonValue rv && rv.TryGetValue<string>(out var reqStr))
                        {
                            mergedRequired.Add(reqStr);
                        }
                    }
                }
                
                // Create merged schema
                var merged = new JsonObject();
                foreach (var prop in schemaObj)
                {
                    if (prop.Key != "$extends")
                    {
                        merged[prop.Key] = prop.Value?.DeepClone();
                    }
                }
                if (mergedProperties.Count > 0)
                {
                    merged["properties"] = mergedProperties;
                }
                if (mergedRequired.Count > 0)
                {
                    merged["required"] = new JsonArray(mergedRequired.Select(r => JsonValue.Create(r)).ToArray());
                }
                
                ValidateInstance(instance, merged, rootSchema, result, path, depth + 1);
                return;
            }
        }

        // Handle conditional composition
        ValidateConditionals(instance, schemaObj, rootSchema, result, path, depth);

        // Get type constraint
        var typeConstraint = GetTypeConstraint(schemaObj);

        // Handle type: { "$ref": ... } format
        if (schemaObj.TryGetPropertyValue("type", out var typeNode) && typeNode is JsonObject typeRefObj)
        {
            if (typeRefObj.TryGetPropertyValue("$ref", out var typeRefValue))
            {
                var typeRefStr = typeRefValue?.GetValue<string>();
                if (!string.IsNullOrEmpty(typeRefStr))
                {
                    var resolvedTypeSchema = ResolveRef(typeRefStr, rootSchema);
                    if (resolvedTypeSchema is not null)
                    {
                        ValidateInstance(instance, resolvedTypeSchema, rootSchema, result, path, depth + 1);
                        return;
                    }
                }
            }
        }

        // Handle const
        if (schemaObj.TryGetPropertyValue("const", out var constValue))
        {
            if (!JsonNodeEquals(instance, constValue))
            {
                AddError(result, ErrorCodes.InstanceConstMismatch, $"Value must equal const value", path);
            }
            return;
        }

        // Handle enum
        if (schemaObj.TryGetPropertyValue("enum", out var enumValue) && enumValue is JsonArray enumArr)
        {
            var matches = false;
            foreach (var enumItem in enumArr)
            {
                if (JsonNodeEquals(instance, enumItem))
                {
                    matches = true;
                    break;
                }
            }
            if (!matches)
            {
                AddError(result, ErrorCodes.InstanceEnumMismatch, "Value must be one of the enum values", path);
            }
            return;
        }

        // Validate based on type
        if (typeConstraint is not null)
        {
            ValidateType(instance, typeConstraint, schemaObj, rootSchema, result, path, depth);
        }
        else
        {
            // No type constraint, validate based on instance type
            ValidateInstanceByJsonType(instance, schemaObj, rootSchema, result, path, depth);
        }

        // Validate additional constraints
        ValidateValidationKeywords(instance, schemaObj, result, path);
    }

    private void ValidateConditionals(JsonNode? instance, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        // Handle allOf
        if (schema.TryGetPropertyValue("allOf", out var allOfValue) && allOfValue is JsonArray allOfArr)
        {
            foreach (var subSchema in allOfArr)
            {
                if (subSchema is not null)
                {
                    ValidateInstance(instance, subSchema, rootSchema, result, path, depth + 1);
                }
            }
        }

        // Handle anyOf
        if (schema.TryGetPropertyValue("anyOf", out var anyOfValue) && anyOfValue is JsonArray anyOfArr)
        {
            var anyValid = false;
            foreach (var subSchema in anyOfArr)
            {
                if (subSchema is not null)
                {
                    var subResult = new ValidationResult();
                    ValidateInstance(instance, subSchema, rootSchema, subResult, path, depth + 1);
                    if (subResult.IsValid)
                    {
                        anyValid = true;
                        break;
                    }
                }
            }
            if (!anyValid)
            {
                AddError(result, ErrorCodes.InstanceAnyOfNoneMatched, "Value must match at least one schema in anyOf", path);
            }
        }

        // Handle oneOf
        if (schema.TryGetPropertyValue("oneOf", out var oneOfValue) && oneOfValue is JsonArray oneOfArr)
        {
            var matchCount = 0;
            foreach (var subSchema in oneOfArr)
            {
                if (subSchema is not null)
                {
                    var subResult = new ValidationResult();
                    ValidateInstance(instance, subSchema, rootSchema, subResult, path, depth + 1);
                    if (subResult.IsValid)
                    {
                        matchCount++;
                    }
                }
            }
            if (matchCount != 1)
            {
                AddError(result, ErrorCodes.InstanceOneOfInvalidCount, $"Value must match exactly one schema in oneOf (matched {matchCount})", path);
            }
        }

        // Handle not
        if (schema.TryGetPropertyValue("not", out var notValue) && notValue is not null)
        {
            var subResult = new ValidationResult();
            ValidateInstance(instance, notValue, rootSchema, subResult, path, depth + 1);
            if (subResult.IsValid)
            {
                AddError(result, ErrorCodes.InstanceNotMatched, "Value must not match the schema in 'not'", path);
            }
        }

        // Handle if/then/else
        if (schema.TryGetPropertyValue("if", out var ifValue) && ifValue is not null)
        {
            var ifResult = new ValidationResult();
            ValidateInstance(instance, ifValue, rootSchema, ifResult, path, depth + 1);

            if (ifResult.IsValid)
            {
                if (schema.TryGetPropertyValue("then", out var thenValue) && thenValue is not null)
                {
                    ValidateInstance(instance, thenValue, rootSchema, result, path, depth + 1);
                }
            }
            else
            {
                if (schema.TryGetPropertyValue("else", out var elseValue) && elseValue is not null)
                {
                    ValidateInstance(instance, elseValue, rootSchema, result, path, depth + 1);
                }
            }
        }
    }

    private string? GetTypeConstraint(JsonObject schema)
    {
        if (schema.TryGetPropertyValue("type", out var typeValue))
        {
            if (typeValue is JsonValue jv && jv.TryGetValue<string>(out var typeStr))
            {
                return typeStr;
            }
            // Handle type: { "$ref": "..." } format
            if (typeValue is JsonObject typeObj && typeObj.TryGetPropertyValue("$ref", out _))
            {
                return null; // Will be handled as $ref resolution in ValidateInstance
            }
        }
        return null;
    }

    private void ValidateType(JsonNode? instance, string type, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        switch (type)
        {
            case "null":
                ValidateNull(instance, result, path);
                break;
            case "boolean":
                ValidateBoolean(instance, result, path);
                break;
            case "string":
                ValidateString(instance, schema, result, path);
                break;
            case "number":
            case "integer":  // Alias
            case "int8":
            case "int16":
            case "int32":
            case "int64":
            case "int128":
            case "uint8":
            case "uint16":
            case "uint32":
            case "uint64":
            case "uint128":
            case "float8":
            case "float":
            case "double":
            case "decimal":
                ValidateNumber(instance, type, schema, result, path);
                break;
            case "object":
                ValidateObject(instance, schema, rootSchema, result, path, depth);
                break;
            case "array":
                ValidateArray(instance, schema, rootSchema, result, path, depth);
                break;
            case "set":
                ValidateSet(instance, schema, rootSchema, result, path, depth);
                break;
            case "map":
                ValidateMap(instance, schema, rootSchema, result, path, depth);
                break;
            case "tuple":
                ValidateTuple(instance, schema, rootSchema, result, path, depth);
                break;
            case "choice":
                ValidateChoice(instance, schema, rootSchema, result, path, depth);
                break;
            case "any":
                // Any type accepts any value
                break;
            case "date":
                ValidateDate(instance, result, path);
                break;
            case "time":
                ValidateTime(instance, result, path);
                break;
            case "datetime":
                ValidateDateTime(instance, result, path);
                break;
            case "duration":
                ValidateDuration(instance, result, path);
                break;
            case "uuid":
                ValidateUuid(instance, result, path);
                break;
            case "uri":
                ValidateUri(instance, result, path);
                break;
            case "binary":
                ValidateBinary(instance, result, path);
                break;
            case "jsonpointer":
                ValidateJsonPointer(instance, result, path);
                break;
            default:
                if (type.Contains(':'))
                {
                    // Custom type reference - would need to resolve
                    AddError(result, ErrorCodes.InstanceCustomTypeNotSupported, $"Custom type reference not yet supported: {type}", path);
                }
                else
                {
                    AddError(result, ErrorCodes.InstanceTypeUnknown, $"Unknown type: {type}", path);
                }
                break;
        }
    }

    private void ValidateInstanceByJsonType(JsonNode? instance, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        if (instance is null)
        {
            return; // null is valid when no type constraint
        }

        if (instance is JsonObject)
        {
            ValidateObject(instance, schema, rootSchema, result, path, depth);
        }
        else if (instance is JsonArray)
        {
            ValidateArray(instance, schema, rootSchema, result, path, depth);
        }
    }

    private void ValidateNull(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not null)
        {
            AddError(result, ErrorCodes.InstanceNullExpected, "Value must be null", path);
        }
    }

    private void ValidateBoolean(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<bool>(out _))
        {
            AddError(result, ErrorCodes.InstanceBooleanExpected, "Value must be a boolean", path);
        }
    }

    private void ValidateString(JsonNode? instance, JsonObject schema, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.InstanceStringExpected, "Value must be a string", path);
            return;
        }

        // Validate minLength
        if (schema.TryGetPropertyValue("minLength", out var minLenValue))
        {
            if (minLenValue?.GetValue<int>() is int minLen && str.Length < minLen)
            {
                AddError(result, ErrorCodes.InstanceStringMinLength, $"String length {str.Length} is less than minimum {minLen}", path);
            }
        }

        // Validate maxLength
        if (schema.TryGetPropertyValue("maxLength", out var maxLenValue))
        {
            if (maxLenValue?.GetValue<int>() is int maxLen && str.Length > maxLen)
            {
                AddError(result, ErrorCodes.InstanceStringMaxLength, $"String length {str.Length} exceeds maximum {maxLen}", path);
            }
        }

        // Validate pattern
        if (schema.TryGetPropertyValue("pattern", out var patternValue))
        {
            var pattern = patternValue?.GetValue<string>();
            if (!string.IsNullOrEmpty(pattern))
            {
                try
                {
                    if (!Regex.IsMatch(str, pattern))
                    {
                        AddError(result, ErrorCodes.InstanceStringPatternMismatch, $"String does not match pattern: {pattern}", path);
                    }
                }
                catch (ArgumentException)
                {
                    AddError(result, ErrorCodes.InstancePatternInvalid, $"Invalid regex pattern: {pattern}", path);
                }
            }
        }

        // Validate format
        if (_options.StrictFormatValidation && schema.TryGetPropertyValue("format", out var formatValue))
        {
            var format = formatValue?.GetValue<string>();
            ValidateStringFormat(str, format, result, path);
        }
    }

    private void ValidateStringFormat(string value, string? format, ValidationResult result, string path)
    {
        if (string.IsNullOrEmpty(format)) return;

        switch (format)
        {
            case "email":
                if (!IsValidEmail(value))
                {
                    AddError(result, ErrorCodes.InstanceFormatEmailInvalid, $"String is not a valid email address", path);
                }
                break;
            case "uri":
                if (!Uri.TryCreate(value, UriKind.Absolute, out _))
                {
                    AddError(result, ErrorCodes.InstanceFormatUriInvalid, $"String is not a valid URI", path);
                }
                break;
            case "uri-reference":
                if (!Uri.TryCreate(value, UriKind.RelativeOrAbsolute, out _))
                {
                    AddError(result, ErrorCodes.InstanceFormatUriReferenceInvalid, $"String is not a valid URI reference", path);
                }
                break;
            case "date":
                if (!DateOnly.TryParse(value, CultureInfo.InvariantCulture, out _))
                {
                    AddError(result, ErrorCodes.InstanceFormatDateInvalid, $"String is not a valid date", path);
                }
                break;
            case "time":
                if (!TimeOnly.TryParse(value, CultureInfo.InvariantCulture, out _))
                {
                    AddError(result, ErrorCodes.InstanceFormatTimeInvalid, $"String is not a valid time", path);
                }
                break;
            case "date-time":
                if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, out _))
                {
                    AddError(result, ErrorCodes.InstanceFormatDatetimeInvalid, $"String is not a valid date-time", path);
                }
                break;
            case "uuid":
                if (!Guid.TryParse(value, out _))
                {
                    AddError(result, ErrorCodes.InstanceFormatUuidInvalid, $"String is not a valid UUID", path);
                }
                break;
            case "ipv4":
                if (!System.Net.IPAddress.TryParse(value, out var ip4) || 
                    ip4.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
                {
                    AddError(result, ErrorCodes.InstanceFormatIpv4Invalid, $"String is not a valid IPv4 address", path);
                }
                break;
            case "ipv6":
                if (!System.Net.IPAddress.TryParse(value, out var ip6) || 
                    ip6.AddressFamily != System.Net.Sockets.AddressFamily.InterNetworkV6)
                {
                    AddError(result, ErrorCodes.InstanceFormatIpv6Invalid, $"String is not a valid IPv6 address", path);
                }
                break;
            case "hostname":
                if (!Uri.CheckHostName(value).Equals(UriHostNameType.Dns))
                {
                    AddError(result, ErrorCodes.InstanceFormatHostnameInvalid, $"String is not a valid hostname", path);
                }
                break;
        }
    }

    private static bool IsValidEmail(string email)
    {
        if (string.IsNullOrWhiteSpace(email)) return false;
        var atIndex = email.IndexOf('@');
        return atIndex > 0 && atIndex < email.Length - 1 && !email.Contains(' ');
    }

    private void ValidateNumber(JsonNode? instance, string type, JsonObject schema, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv)
        {
            AddError(result, ErrorCodes.InstanceNumberExpected, $"Value must be a {type}", path);
            return;
        }

        // Handle string-encoded large integers
        if (jv.TryGetValue<string>(out var strValue))
        {
            if (!ValidateStringEncodedNumber(strValue, type, result, path))
            {
                return;
            }
            // For string-encoded numbers, we still need to validate numeric constraints
            if (decimal.TryParse(strValue, NumberStyles.Any, CultureInfo.InvariantCulture, out var decVal))
            {
                ValidateNumericConstraints(decVal, schema, result, path);
            }
            return;
        }

        // Get the numeric value
        double numValue;
        if (jv.TryGetValue<double>(out var d))
        {
            numValue = d;
        }
        else if (jv.TryGetValue<long>(out var l))
        {
            numValue = l;
        }
        else if (jv.TryGetValue<int>(out var i))
        {
            numValue = i;
        }
        else if (jv.TryGetValue<decimal>(out var dec))
        {
            numValue = (double)dec;
        }
        else
        {
            AddError(result, ErrorCodes.InstanceNumberExpected, $"Value must be a {type}", path);
            return;
        }

        // Validate type-specific constraints
        ValidateNumericType(numValue, type, result, path);

        // Validate numeric constraints
        ValidateNumericConstraints((decimal)numValue, schema, result, path);
    }

    private bool ValidateStringEncodedNumber(string value, string type, ValidationResult result, string path)
    {
        switch (type)
        {
            case "int64":
                if (!long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
                {
                    AddError(result, ErrorCodes.InstanceIntegerExpected, "Value must be a valid int64", path);
                    return false;
                }
                break;
            case "uint64":
                if (!ulong.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
                {
                    AddError(result, ErrorCodes.InstanceIntegerExpected, "Value must be a valid uint64", path);
                    return false;
                }
                break;
            case "int128":
                if (!Int128.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
                {
                    AddError(result, ErrorCodes.InstanceIntegerExpected, "Value must be a valid int128", path);
                    return false;
                }
                break;
            case "uint128":
                if (!UInt128.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
                {
                    AddError(result, ErrorCodes.InstanceIntegerExpected, "Value must be a valid uint128", path);
                    return false;
                }
                break;
            case "decimal":
                if (!decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out _))
                {
                    AddError(result, ErrorCodes.InstanceDecimalExpected, $"Value must be a valid {type}", path);
                    return false;
                }
                break;
            default:
                AddError(result, ErrorCodes.InstanceStringNotExpected, $"String value not expected for type {type}", path);
                return false;
        }
        return true;
    }

    private void ValidateNumericType(double value, string type, ValidationResult result, string path)
    {
        switch (type)
        {
            case "int8":
                if (value < sbyte.MinValue || value > sbyte.MaxValue || value != Math.Truncate(value))
                {
                    AddError(result, ErrorCodes.InstanceIntRangeInvalid, $"Value {value} is not a valid int8", path);
                }
                break;
            case "int16":
                if (value < short.MinValue || value > short.MaxValue || value != Math.Truncate(value))
                {
                    AddError(result, ErrorCodes.InstanceIntRangeInvalid, $"Value {value} is not a valid int16", path);
                }
                break;
            case "int32":
                if (value < int.MinValue || value > int.MaxValue || value != Math.Truncate(value))
                {
                    AddError(result, ErrorCodes.InstanceIntRangeInvalid, $"Value {value} is not a valid int32", path);
                }
                break;
            case "int64":
                if (value < long.MinValue || value > long.MaxValue || value != Math.Truncate(value))
                {
                    AddError(result, ErrorCodes.InstanceIntRangeInvalid, $"Value {value} is not a valid int64", path);
                }
                break;
            case "uint8":
                if (value < 0 || value > byte.MaxValue || value != Math.Truncate(value))
                {
                    AddError(result, ErrorCodes.InstanceIntRangeInvalid, $"Value {value} is not a valid uint8", path);
                }
                break;
            case "uint16":
                if (value < 0 || value > ushort.MaxValue || value != Math.Truncate(value))
                {
                    AddError(result, ErrorCodes.InstanceIntRangeInvalid, $"Value {value} is not a valid uint16", path);
                }
                break;
            case "uint32":
                if (value < 0 || value > uint.MaxValue || value != Math.Truncate(value))
                {
                    AddError(result, ErrorCodes.InstanceIntRangeInvalid, $"Value {value} is not a valid uint32", path);
                }
                break;
            case "uint64":
                if (value < 0 || value != Math.Truncate(value))
                {
                    AddError(result, ErrorCodes.InstanceIntRangeInvalid, $"Value {value} is not a valid uint64", path);
                }
                break;
        }
    }

    private void ValidateNumericConstraints(decimal value, JsonObject schema, ValidationResult result, string path)
    {
        // minimum
        if (schema.TryGetPropertyValue("minimum", out var minValue))
        {
            var min = GetDecimalValue(minValue);
            if (min.HasValue && value < min.Value)
            {
                AddError(result, ErrorCodes.InstanceNumberMinimum, $"Value {value} is less than minimum {min.Value}", path);
            }
        }

        // maximum
        if (schema.TryGetPropertyValue("maximum", out var maxValue))
        {
            var max = GetDecimalValue(maxValue);
            if (max.HasValue && value > max.Value)
            {
                AddError(result, ErrorCodes.InstanceNumberMaximum, $"Value {value} exceeds maximum {max.Value}", path);
            }
        }

        // exclusiveMinimum
        if (schema.TryGetPropertyValue("exclusiveMinimum", out var exclMinValue))
        {
            var exclMin = GetDecimalValue(exclMinValue);
            if (exclMin.HasValue && value <= exclMin.Value)
            {
                AddError(result, ErrorCodes.InstanceNumberExclusiveMinimum, $"Value {value} must be greater than {exclMin.Value}", path);
            }
        }

        // exclusiveMaximum
        if (schema.TryGetPropertyValue("exclusiveMaximum", out var exclMaxValue))
        {
            var exclMax = GetDecimalValue(exclMaxValue);
            if (exclMax.HasValue && value >= exclMax.Value)
            {
                AddError(result, ErrorCodes.InstanceNumberExclusiveMaximum, $"Value {value} must be less than {exclMax.Value}", path);
            }
        }

        // multipleOf
        if (schema.TryGetPropertyValue("multipleOf", out var multipleOfValue))
        {
            var multipleOf = GetDecimalValue(multipleOfValue);
            if (multipleOf.HasValue && multipleOf.Value != 0)
            {
                var remainder = value % multipleOf.Value;
                if (remainder != 0)
                {
                    AddError(result, ErrorCodes.InstanceNumberMultipleOf, $"Value {value} is not a multiple of {multipleOf.Value}", path);
                }
            }
        }
    }

    private decimal? GetDecimalValue(JsonNode? node)
    {
        if (node is JsonValue jv)
        {
            if (jv.TryGetValue<decimal>(out var d)) return d;
            if (jv.TryGetValue<double>(out var dbl)) return (decimal)dbl;
            if (jv.TryGetValue<long>(out var l)) return l;
            if (jv.TryGetValue<int>(out var i)) return i;
        }
        return null;
    }

    private void ValidateObject(JsonNode? instance, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        if (instance is not JsonObject obj)
        {
            AddError(result, ErrorCodes.InstanceObjectExpected, "Value must be an object", path);
            return;
        }

        var definedProps = new HashSet<string>();

        // Validate properties
        if (schema.TryGetPropertyValue("properties", out var propsValue) && propsValue is JsonObject props)
        {
            foreach (var prop in props)
            {
                definedProps.Add(prop.Key);
                if (obj.TryGetPropertyValue(prop.Key, out var propInstance))
                {
                    if (prop.Value is not null)
                    {
                        ValidateInstance(propInstance, prop.Value, rootSchema, result,
                            AppendPath(path, prop.Key), depth + 1);
                    }
                }
            }
        }

        // Validate required
        if (schema.TryGetPropertyValue("required", out var reqValue) && reqValue is JsonArray reqArr)
        {
            foreach (var req in reqArr)
            {
                var reqName = req?.GetValue<string>();
                if (!string.IsNullOrEmpty(reqName) && !obj.ContainsKey(reqName))
                {
                    AddError(result, ErrorCodes.InstanceRequiredPropertyMissing, $"Missing required property: {reqName}", path);
                }
            }
        }

        // Validate additionalProperties
        if (schema.TryGetPropertyValue("additionalProperties", out var additionalValue))
        {
            if (additionalValue is JsonValue apv && apv.TryGetValue<bool>(out var allowed))
            {
                if (!allowed)
                {
                    foreach (var prop in obj)
                    {
                        // Skip $schema - it's a meta-property, not data
                        if (prop.Key == "$schema") continue;
                        
                        if (!definedProps.Contains(prop.Key))
                        {
                            AddError(result, ErrorCodes.InstanceAdditionalPropertyNotAllowed, $"Additional property not allowed: {prop.Key}", path);
                        }
                    }
                }
            }
            else if (additionalValue is JsonObject additionalSchema)
            {
                foreach (var prop in obj)
                {
                    // Skip $schema - it's a meta-property, not data
                    if (prop.Key == "$schema") continue;
                    
                    if (!definedProps.Contains(prop.Key))
                    {
                        ValidateInstance(prop.Value, additionalSchema, rootSchema, result,
                            AppendPath(path, prop.Key), depth + 1);
                    }
                }
            }
        }

        // Validate minProperties/maxProperties
        if (schema.TryGetPropertyValue("minProperties", out var minPropsValue))
        {
            var minProps = minPropsValue?.GetValue<int>();
            if (minProps.HasValue && obj.Count < minProps.Value)
            {
                AddError(result, ErrorCodes.InstanceMinProperties, $"Object has {obj.Count} properties, minimum is {minProps.Value}", path);
            }
        }

        if (schema.TryGetPropertyValue("maxProperties", out var maxPropsValue))
        {
            var maxProps = maxPropsValue?.GetValue<int>();
            if (maxProps.HasValue && obj.Count > maxProps.Value)
            {
                AddError(result, ErrorCodes.InstanceMaxProperties, $"Object has {obj.Count} properties, maximum is {maxProps.Value}", path);
            }
        }

        // Validate dependentRequired
        if (schema.TryGetPropertyValue("dependentRequired", out var depReqValue) && depReqValue is JsonObject depReq)
        {
            foreach (var dep in depReq)
            {
                if (obj.ContainsKey(dep.Key) && dep.Value is JsonArray depArr)
                {
                    foreach (var required in depArr)
                    {
                        var reqProp = required?.GetValue<string>();
                        if (!string.IsNullOrEmpty(reqProp) && !obj.ContainsKey(reqProp))
                        {
                            AddError(result, ErrorCodes.InstanceDependentRequired, $"Property '{dep.Key}' requires property '{reqProp}'", path);
                        }
                    }
                }
            }
        }
    }

    private void ValidateArray(JsonNode? instance, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        if (instance is not JsonArray arr)
        {
            AddError(result, ErrorCodes.InstanceArrayExpected, "Value must be an array", path);
            return;
        }

        // Validate items
        if (schema.TryGetPropertyValue("items", out var itemsValue) && itemsValue is not null)
        {
            for (var i = 0; i < arr.Count; i++)
            {
                ValidateInstance(arr[i], itemsValue, rootSchema, result,
                    AppendPath(path, i.ToString()), depth + 1);
            }
        }

        // Validate minItems/maxItems
        if (schema.TryGetPropertyValue("minItems", out var minItemsValue))
        {
            var minItems = minItemsValue?.GetValue<int>();
            if (minItems.HasValue && arr.Count < minItems.Value)
            {
                AddError(result, ErrorCodes.InstanceMinItems, $"Array has {arr.Count} items, minimum is {minItems.Value}", path);
            }
        }

        if (schema.TryGetPropertyValue("maxItems", out var maxItemsValue))
        {
            var maxItems = maxItemsValue?.GetValue<int>();
            if (maxItems.HasValue && arr.Count > maxItems.Value)
            {
                AddError(result, ErrorCodes.InstanceMaxItems, $"Array has {arr.Count} items, maximum is {maxItems.Value}", path);
            }
        }

        // Validate contains
        if (schema.TryGetPropertyValue("contains", out var containsValue) && containsValue is not null)
        {
            var containsCount = 0;
            foreach (var item in arr)
            {
                var itemResult = new ValidationResult();
                ValidateInstance(item, containsValue, rootSchema, itemResult, path, depth + 1);
                if (itemResult.IsValid)
                {
                    containsCount++;
                }
            }

            var minContains = 1;
            var maxContains = int.MaxValue;

            if (schema.TryGetPropertyValue("minContains", out var minContainsValue))
            {
                minContains = minContainsValue?.GetValue<int>() ?? 1;
            }

            if (schema.TryGetPropertyValue("maxContains", out var maxContainsValue))
            {
                maxContains = maxContainsValue?.GetValue<int>() ?? int.MaxValue;
            }

            if (containsCount < minContains)
            {
                AddError(result, ErrorCodes.InstanceMinContains, $"Array must contain at least {minContains} matching items (found {containsCount})", path);
            }

            if (containsCount > maxContains)
            {
                AddError(result, ErrorCodes.InstanceMaxContains, $"Array must contain at most {maxContains} matching items (found {containsCount})", path);
            }
        }
    }

    private void ValidateSet(JsonNode? instance, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        if (instance is not JsonArray arr)
        {
            AddError(result, ErrorCodes.InstanceSetExpected, "Value must be an array (set)", path);
            return;
        }

        // Check uniqueness
        var seen = new HashSet<string>();
        for (var i = 0; i < arr.Count; i++)
        {
            var itemJson = arr[i]?.ToJsonString() ?? "null";
            if (!seen.Add(itemJson))
            {
                AddError(result, ErrorCodes.InstanceSetDuplicate, $"Set contains duplicate value at index {i}", path);
            }
        }

        // Validate items
        ValidateArray(instance, schema, rootSchema, result, path, depth);
    }

    private void ValidateMap(JsonNode? instance, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        if (instance is not JsonObject obj)
        {
            AddError(result, ErrorCodes.InstanceMapExpected, "Value must be an object (map)", path);
            return;
        }

        // Validate values schema
        if (schema.TryGetPropertyValue("values", out var valuesValue) && valuesValue is not null)
        {
            foreach (var prop in obj)
            {
                ValidateInstance(prop.Value, valuesValue, rootSchema, result,
                    AppendPath(path, prop.Key), depth + 1);
            }
        }

        // Validate propertyNames (JSON Schema) or keys (JSON Structure)
        JsonNode? keySchema = null;
        if (schema.TryGetPropertyValue("propertyNames", out var propNamesValue) && propNamesValue is not null)
        {
            keySchema = propNamesValue;
        }
        else if (schema.TryGetPropertyValue("keys", out var keysValue) && keysValue is not null)
        {
            keySchema = keysValue;
        }
        
        if (keySchema is not null)
        {
            foreach (var prop in obj)
            {
                var keyNode = JsonValue.Create(prop.Key);
                ValidateInstance(keyNode, keySchema, rootSchema, result,
                    AppendPath(path, $"[key:{prop.Key}]"), depth + 1);
            }
        }

        // Validate minProperties/maxProperties
        if (schema.TryGetPropertyValue("minProperties", out var minPropsValue))
        {
            var minProps = minPropsValue?.GetValue<int>();
            if (minProps.HasValue && obj.Count < minProps.Value)
            {
                AddError(result, ErrorCodes.InstanceMapMinEntries, $"Map has {obj.Count} entries, minimum is {minProps.Value}", path);
            }
        }

        if (schema.TryGetPropertyValue("maxProperties", out var maxPropsValue))
        {
            var maxProps = maxPropsValue?.GetValue<int>();
            if (maxProps.HasValue && obj.Count > maxProps.Value)
            {
                AddError(result, ErrorCodes.InstanceMapMaxEntries, $"Map has {obj.Count} entries, maximum is {maxProps.Value}", path);
            }
        }
    }

    private void ValidateTuple(JsonNode? instance, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        if (instance is not JsonArray arr)
        {
            AddError(result, ErrorCodes.InstanceTupleExpected, "Value must be an array (tuple)", path);
            return;
        }

        // Validate prefixItems format
        if (schema.TryGetPropertyValue("prefixItems", out var prefixValue) && prefixValue is JsonArray prefixArr)
        {
            // Validate tuple length (exact match required for prefixItems format)
            if (arr.Count != prefixArr.Count)
            {
                // Check if additional items are allowed
                if (schema.TryGetPropertyValue("items", out var itemsValue))
                {
                    if (itemsValue is JsonValue jv && jv.TryGetValue<bool>(out var allowed) && !allowed)
                    {
                        if (arr.Count != prefixArr.Count)
                        {
                            AddError(result, ErrorCodes.InstanceTupleLengthMismatch, $"Tuple has {arr.Count} items but schema defines {prefixArr.Count}", path);
                        }
                    }
                }
                else if (arr.Count < prefixArr.Count)
                {
                    AddError(result, ErrorCodes.InstanceTupleLengthMismatch, $"Tuple has {arr.Count} items but schema defines {prefixArr.Count}", path);
                }
            }

            for (var i = 0; i < prefixArr.Count; i++)
            {
                if (i < arr.Count)
                {
                    var itemSchema = prefixArr[i];
                    if (itemSchema is not null)
                    {
                        ValidateInstance(arr[i], itemSchema, rootSchema, result,
                            AppendPath(path, i.ToString()), depth + 1);
                    }
                }
            }

            // Check for additional items
            if (schema.TryGetPropertyValue("items", out var additionalItemsValue))
            {
                if (additionalItemsValue is JsonValue jv && jv.TryGetValue<bool>(out var allowed))
                {
                    if (!allowed && arr.Count > prefixArr.Count)
                    {
                        AddError(result, ErrorCodes.InstanceTupleAdditionalItems, $"Tuple has {arr.Count} items but only {prefixArr.Count} are defined", path);
                    }
                }
                else if (additionalItemsValue is JsonObject additionalSchema)
                {
                    for (var i = prefixArr.Count; i < arr.Count; i++)
                    {
                        ValidateInstance(arr[i], additionalSchema, rootSchema, result,
                            AppendPath(path, i.ToString()), depth + 1);
                    }
                }
            }
        }
        // Validate tuple + properties format
        else if (schema.TryGetPropertyValue("tuple", out var tupleValue) && tupleValue is JsonArray tupleArr)
        {
            if (schema.TryGetPropertyValue("properties", out var propsValue) && propsValue is JsonObject props)
            {
                // Validate tuple length
                if (arr.Count != tupleArr.Count)
                {
                    AddError(result, ErrorCodes.InstanceTupleLengthMismatch, $"Tuple has {arr.Count} elements but schema defines {tupleArr.Count}", path);
                }

                // Validate each element according to the tuple order
                for (var i = 0; i < tupleArr.Count && i < arr.Count; i++)
                {
                    var propName = tupleArr[i]?.GetValue<string>();
                    if (propName is not null && props.TryGetPropertyValue(propName, out var propSchema) && propSchema is not null)
                    {
                        ValidateInstance(arr[i], propSchema, rootSchema, result,
                            AppendPath(path, i.ToString()), depth + 1);
                    }
                }
            }
        }
    }

    private void ValidateChoice(JsonNode? instance, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        if (instance is not JsonObject obj)
        {
            AddError(result, ErrorCodes.InstanceChoiceExpected, "Value must be an object (choice)", path);
            return;
        }

        // Support both "options" and "choices" keywords
        JsonObject? options = null;
        if (schema.TryGetPropertyValue("options", out var optionsValue) && optionsValue is JsonObject optionsObj)
        {
            options = optionsObj;
        }
        else if (schema.TryGetPropertyValue("choices", out var choicesValue) && choicesValue is JsonObject choicesObj)
        {
            options = choicesObj;
        }

        if (options is null)
        {
            AddError(result, ErrorCodes.InstanceChoiceMissingOptions, "Choice schema must have 'options' or 'choices'", path);
            return;
        }

        // Get discriminator - support both "discriminator" and "selector"
        string? discriminator = null;
        if (schema.TryGetPropertyValue("discriminator", out var discValue))
        {
            discriminator = discValue?.GetValue<string>();
        }
        else if (schema.TryGetPropertyValue("selector", out var selectorValue))
        {
            discriminator = selectorValue?.GetValue<string>();
        }

        if (!string.IsNullOrEmpty(discriminator))
        {
            // Use discriminator to determine type
            if (!obj.TryGetPropertyValue(discriminator, out var discValueNode))
            {
                AddError(result, ErrorCodes.InstanceChoiceDiscriminatorMissing, $"Choice requires discriminator property: {discriminator}", path);
                return;
            }

            var discStr = discValueNode?.GetValue<string>();
            if (string.IsNullOrEmpty(discStr))
            {
                AddError(result, ErrorCodes.InstanceChoiceDiscriminatorNotString, $"Discriminator value must be a string", path);
                return;
            }

            if (!options.TryGetPropertyValue(discStr, out var optionSchema) || optionSchema is null)
            {
                AddError(result, ErrorCodes.InstanceChoiceOptionUnknown, $"Unknown choice option: {discStr}", path);
                return;
            }

            ValidateInstance(instance, optionSchema, rootSchema, result, path, depth + 1);
        }
        else
        {
            // Check for tagged union format (single key matching option name)
            if (obj.Count == 1)
            {
                var key = obj.First().Key;
                if (options.TryGetPropertyValue(key, out var taggedSchema) && taggedSchema is not null)
                {
                    // Validate the value against the matched option schema
                    ValidateInstance(obj[key], taggedSchema, rootSchema, result, AppendPath(path, key), depth + 1);
                    return;
                }
            }

            // Try to match one of the options
            var matchCount = 0;
            foreach (var option in options)
            {
                if (option.Value is not null)
                {
                    var optResult = new ValidationResult();
                    ValidateInstance(instance, option.Value, rootSchema, optResult, path, depth + 1);
                    if (optResult.IsValid)
                    {
                        matchCount++;
                    }
                }
            }

            if (matchCount == 0)
            {
                AddError(result, ErrorCodes.InstanceChoiceNoMatch, "Value does not match any choice option", path);
            }
            else if (matchCount > 1)
            {
                AddError(result, ErrorCodes.InstanceChoiceMultipleMatches, $"Value matches {matchCount} choice options (should match exactly one)", path);
            }
        }
    }

    private void ValidateDate(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.InstanceDateExpected, "Date must be a string", path);
            return;
        }

        if (!DateOnly.TryParseExact(str, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
        {
            AddError(result, ErrorCodes.InstanceDateFormatInvalid, $"Invalid date format: {str}", path);
        }
    }

    private void ValidateTime(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.InstanceTimeExpected, "Time must be a string", path);
            return;
        }

        // RFC 3339 time format: HH:mm:ss or HH:mm:ss.fff (with optional timezone)
        // Must be 24-hour format, no AM/PM
        // Valid formats: "09:00:00", "09:00", "09:00:00.123", "09:00:00Z", "09:00:00+01:00"
        var formats = new[]
        {
            "HH:mm:ss",
            "HH:mm:ss.f",
            "HH:mm:ss.ff",
            "HH:mm:ss.fff",
            "HH:mm:ss.ffff",
            "HH:mm:ss.fffff",
            "HH:mm:ss.ffffff",
            "HH:mm:ss.fffffff",
            "HH:mm",
            "HH:mm:ssK",
            "HH:mm:ss.fK",
            "HH:mm:ss.ffK",
            "HH:mm:ss.fffK",
            "HH:mm:ss.ffffK",
            "HH:mm:ss.fffffK",
            "HH:mm:ss.ffffffK",
            "HH:mm:ss.fffffffK",
        };
        
        if (!TimeOnly.TryParseExact(str, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
        {
            AddError(result, ErrorCodes.InstanceTimeFormatInvalid, $"Invalid time format: {str}", path);
        }
    }

    private void ValidateDateTime(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.InstanceDatetimeExpected, "DateTime must be a string", path);
            return;
        }

        if (!DateTimeOffset.TryParse(str, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _))
        {
            AddError(result, ErrorCodes.InstanceDatetimeFormatInvalid, $"Invalid datetime format: {str}", path);
        }
    }

    private void ValidateDuration(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.InstanceDurationExpected, "Duration must be a string", path);
            return;
        }

        try
        {
            System.Xml.XmlConvert.ToTimeSpan(str);
        }
        catch
        {
            if (!TimeSpan.TryParse(str, CultureInfo.InvariantCulture, out _))
            {
                AddError(result, ErrorCodes.InstanceDurationFormatInvalid, $"Invalid duration format: {str}", path);
            }
        }
    }

    private void ValidateUuid(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.InstanceUuidExpected, "UUID must be a string", path);
            return;
        }

        if (!Guid.TryParse(str, out _))
        {
            AddError(result, ErrorCodes.InstanceUuidFormatInvalid, $"Invalid UUID format: {str}", path);
        }
    }

    private void ValidateUri(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.InstanceUriExpected, "URI must be a string", path);
            return;
        }

        if (!System.Uri.TryCreate(str, UriKind.Absolute, out var uri))
        {
            AddError(result, ErrorCodes.InstanceUriFormatInvalid, $"Invalid URI format: {str}", path);
            return;
        }

        // Must have a scheme
        if (string.IsNullOrEmpty(uri.Scheme))
        {
            AddError(result, ErrorCodes.InstanceUriMissingScheme, $"URI must have a scheme: {str}", path);
        }
    }

    private void ValidateBinary(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.InstanceBinaryExpected, "Binary must be a base64 string", path);
            return;
        }

        try
        {
            Convert.FromBase64String(str);
        }
        catch
        {
            AddError(result, ErrorCodes.InstanceBinaryEncodingInvalid, "Invalid base64 encoding", path);
        }
    }

    private void ValidateJsonPointer(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            AddError(result, ErrorCodes.InstanceJsonpointerExpected, "JSON Pointer must be a string", path);
            return;
        }

        // JSON Pointer must be empty or start with /
        if (!string.IsNullOrEmpty(str) && !str.StartsWith('/'))
        {
            AddError(result, ErrorCodes.InstanceJsonpointerFormatInvalid, $"Invalid JSON Pointer format: {str}", path);
        }
    }

    private void ValidateValidationKeywords(JsonNode? instance, JsonObject schema, ValidationResult result, string path)
    {
        // Only validate constraints here if there's no type constraint.
        // If there IS a type constraint, the type-specific validators already handle constraints.
        if (schema.ContainsKey("type"))
        {
            return;
        }

        if (instance is null) return;

        // If instance is a number and schema has numeric constraints, validate them
        if (instance is JsonValue jv)
        {
            decimal? numValue = null;
            if (jv.TryGetValue<double>(out var d))
                numValue = (decimal)d;
            else if (jv.TryGetValue<long>(out var l))
                numValue = l;
            else if (jv.TryGetValue<int>(out var i))
                numValue = i;
            else if (jv.TryGetValue<decimal>(out var dec))
                numValue = dec;

            if (numValue.HasValue)
            {
                // Check numeric constraints even without explicit type
                if (schema.ContainsKey("minimum") || schema.ContainsKey("maximum") ||
                    schema.ContainsKey("exclusiveMinimum") || schema.ContainsKey("exclusiveMaximum") ||
                    schema.ContainsKey("multipleOf"))
                {
                    ValidateNumericConstraints(numValue.Value, schema, result, path);
                }
            }

            // If instance is a string and schema has string constraints, validate them
            if (jv.TryGetValue<string>(out var str))
            {
                if (schema.ContainsKey("minLength") || schema.ContainsKey("maxLength") ||
                    schema.ContainsKey("pattern") || schema.ContainsKey("format"))
                {
                    // Validate minLength
                    if (schema.TryGetPropertyValue("minLength", out var minLenValue))
                    {
                        if (minLenValue?.GetValue<int>() is int minLen && str.Length < minLen)
                        {
                            AddError(result, ErrorCodes.InstanceStringMinLength, $"String length {str.Length} is less than minimum {minLen}", path);
                        }
                    }

                    // Validate maxLength
                    if (schema.TryGetPropertyValue("maxLength", out var maxLenValue))
                    {
                        if (maxLenValue?.GetValue<int>() is int maxLen && str.Length > maxLen)
                        {
                            AddError(result, ErrorCodes.InstanceStringMaxLength, $"String length {str.Length} exceeds maximum {maxLen}", path);
                        }
                    }

                    // Validate pattern
                    if (schema.TryGetPropertyValue("pattern", out var patternValue))
                    {
                        var pattern = patternValue?.GetValue<string>();
                        if (!string.IsNullOrEmpty(pattern))
                        {
                            try
                            {
                                if (!Regex.IsMatch(str, pattern))
                                {
                                    AddError(result, ErrorCodes.InstanceStringPatternMismatch, $"String does not match pattern: {pattern}", path);
                                }
                            }
                            catch (ArgumentException)
                            {
                                AddError(result, ErrorCodes.InstancePatternInvalid, $"Invalid regex pattern: {pattern}", path);
                            }
                        }
                    }
                }
            }
        }
    }

    private JsonNode? ResolveRef(string reference, JsonNode rootSchema)
    {
        if (_resolvedRefs.TryGetValue(reference, out var cached))
        {
            return cached;
        }

        JsonNode? resolved = null;

        // Handle JSON Pointer references
        if (reference.StartsWith("#/"))
        {
            var pointer = reference[1..]; // Remove leading #
            resolved = ResolveJsonPointer(pointer, rootSchema);
        }
        else if (reference.StartsWith("#"))
        {
            // Anchor reference
            var anchor = reference[1..];
            resolved = FindAnchor(anchor, rootSchema);
        }
        else if (_options.ReferenceResolver is not null)
        {
            resolved = _options.ReferenceResolver(reference);
        }

        if (resolved is not null)
        {
            _resolvedRefs[reference] = resolved;
        }

        return resolved;
    }

    private JsonNode? ResolveJsonPointer(string pointer, JsonNode node)
    {
        if (string.IsNullOrEmpty(pointer) || pointer == "/")
        {
            return node;
        }

        var parts = pointer.Split('/').Skip(1).ToArray(); // Skip empty first part
        var current = node;

        for (var i = 0; i < parts.Length; i++)
        {
            if (current is null) return null;

            // Unescape JSON Pointer tokens
            var unescaped = parts[i].Replace("~1", "/").Replace("~0", "~");

            if (current is JsonObject obj)
            {
                if (obj.TryGetPropertyValue(unescaped, out var next))
                {
                    current = next;
                }
                else
                {
                    // Property not found directly - check for $import or $importdefs
                    // This handles the case where we're at a namespace node that imports definitions
                    JsonNode? importValue = null;
                    JsonNode? importDefsValue = null;
                    
                    if (obj.TryGetPropertyValue("$import", out importValue) || 
                        obj.TryGetPropertyValue("$importdefs", out importDefsValue))
                    {
                        var importUri = (importValue ?? importDefsValue)?.GetValue<string>();
                        if (!string.IsNullOrEmpty(importUri))
                        {
                            var importedSchema = LoadImport(importUri);
                            if (importedSchema is JsonObject importedObj)
                            {
                                // For $importdefs, look in definitions of imported schema
                                // For $import, look directly in the imported schema
                                var hasImportDefs = importDefsValue is not null;
                                
                                // Build remaining path
                                var remainingParts = parts.Skip(i).ToArray();
                                var remainingPath = "/" + string.Join("/", remainingParts);
                                
                                if (hasImportDefs)
                                {
                                    // For $importdefs, the remaining path resolves against definitions
                                    if (importedObj.TryGetPropertyValue("definitions", out var defs) && defs is not null)
                                    {
                                        return ResolveJsonPointer(remainingPath, defs);
                                    }
                                    else if (importedObj.TryGetPropertyValue("$defs", out var dollarDefs) && dollarDefs is not null)
                                    {
                                        return ResolveJsonPointer(remainingPath, dollarDefs);
                                    }
                                }
                                else
                                {
                                    // For $import, resolve against the whole imported schema
                                    return ResolveJsonPointer(remainingPath, importedSchema);
                                }
                            }
                        }
                    }
                    return null;
                }
            }
            else if (current is JsonArray arr)
            {
                if (int.TryParse(unescaped, out var index) && index >= 0 && index < arr.Count)
                {
                    current = arr[index];
                }
                else
                {
                    return null;
                }
            }
            else
            {
                return null;
            }
        }

        return current;
    }

    /// <summary>
    /// Loads an imported schema from a URI using the ImportLoader.
    /// </summary>
    private JsonNode? LoadImport(string uri)
    {
        if (_loadedImports.TryGetValue(uri, out var cached))
        {
            return cached;
        }

        JsonNode? loaded = null;
        if (_options.ImportLoader is not null)
        {
            loaded = _options.ImportLoader(uri);
        }

        _loadedImports[uri] = loaded;
        return loaded;
    }

    private JsonNode? FindAnchor(string anchor, JsonNode node)
    {
        if (node is JsonObject obj)
        {
            if (obj.TryGetPropertyValue("$anchor", out var anchorValue))
            {
                if (anchorValue?.GetValue<string>() == anchor)
                {
                    return obj;
                }
            }

            foreach (var prop in obj)
            {
                if (prop.Value is not null)
                {
                    var found = FindAnchor(anchor, prop.Value);
                    if (found is not null) return found;
                }
            }
        }
        else if (node is JsonArray arr)
        {
            foreach (var item in arr)
            {
                if (item is not null)
                {
                    var found = FindAnchor(anchor, item);
                    if (found is not null) return found;
                }
            }
        }

        return null;
    }

    private bool JsonNodeEquals(JsonNode? a, JsonNode? b)
    {
        if (a is null && b is null) return true;
        if (a is null || b is null) return false;

        return a.ToJsonString() == b.ToJsonString();
    }

    private static string AppendPath(string basePath, string segment)
    {
        if (string.IsNullOrEmpty(basePath))
        {
            return "/" + segment;
        }
        return basePath + "/" + segment;
    }

    /// <summary>
    /// Adds an error with source location tracking.
    /// </summary>
    private void AddError(ValidationResult result, string code, string message, string path, string? schemaPath = null)
    {
        var location = _instanceLocator?.GetLocation(path) ?? JsonLocation.Unknown;
        result.AddError(code, message, path, location, schemaPath);
    }
}
