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
        var result = new ValidationResult();

        if (schema is null)
        {
            result.AddError("Schema cannot be null", "");
            return result;
        }

        _resolvedRefs.Clear();
        
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
                    result.AddError($"Unable to resolve $root reference: {rootRefStr}", "");
                    return result;
                }
            }
        }
        
        ValidateInstance(instance, effectiveSchema, schema, result, "", 0);
        return result;
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
            return Validate(instance, schema);
        }
        catch (Exception ex)
        {
            return ValidationResult.Failure($"Failed to parse JSON: {ex.Message}");
        }
    }

    private void ValidateInstance(JsonNode? instance, JsonNode schema, JsonNode rootSchema, 
        ValidationResult result, string path, int depth)
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

        // Handle boolean schemas
        if (schema is JsonValue boolValue && boolValue.TryGetValue<bool>(out var b))
        {
            if (!b && instance is not null)
            {
                result.AddError("Schema 'false' rejects all values", path);
            }
            return;
        }

        if (schema is not JsonObject schemaObj)
        {
            result.AddError("Schema must be a boolean or object", path);
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
                    result.AddError($"Unable to resolve reference: {refStr}", path);
                    return;
                }
                ValidateInstance(instance, resolvedSchema, rootSchema, result, path, depth + 1);
                return;
            }
        }

        // Handle $extends
        if (schemaObj.TryGetPropertyValue("$extends", out var extendsValue))
        {
            var extendsRef = extendsValue?.GetValue<string>();
            if (!string.IsNullOrEmpty(extendsRef))
            {
                var baseSchema = ResolveRef(extendsRef, rootSchema);
                if (baseSchema is not null)
                {
                    ValidateInstance(instance, baseSchema, rootSchema, result, path, depth + 1);
                }
            }
        }

        // Handle conditional composition
        ValidateConditionals(instance, schemaObj, rootSchema, result, path, depth);

        // Get type constraint
        var typeConstraint = GetTypeConstraint(schemaObj);

        // Handle const
        if (schemaObj.TryGetPropertyValue("const", out var constValue))
        {
            if (!JsonNodeEquals(instance, constValue))
            {
                result.AddError($"Value must equal const value", path);
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
                result.AddError("Value must be one of the enum values", path);
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
                result.AddError("Value must match at least one schema in anyOf", path);
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
                result.AddError($"Value must match exactly one schema in oneOf (matched {matchCount})", path);
            }
        }

        // Handle not
        if (schema.TryGetPropertyValue("not", out var notValue) && notValue is not null)
        {
            var subResult = new ValidationResult();
            ValidateInstance(instance, notValue, rootSchema, subResult, path, depth + 1);
            if (subResult.IsValid)
            {
                result.AddError("Value must not match the schema in 'not'", path);
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
            case "float16":
            case "float32":
            case "float64":
            case "float128":
            case "decimal":
            case "decimal64":
            case "decimal128":
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
                    result.AddError($"Custom type reference not yet supported: {type}", path);
                }
                else
                {
                    result.AddError($"Unknown type: {type}", path);
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
            result.AddError("Value must be null", path);
        }
    }

    private void ValidateBoolean(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<bool>(out _))
        {
            result.AddError("Value must be a boolean", path);
        }
    }

    private void ValidateString(JsonNode? instance, JsonObject schema, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError("Value must be a string", path);
            return;
        }

        // Validate minLength
        if (schema.TryGetPropertyValue("minLength", out var minLenValue))
        {
            if (minLenValue?.GetValue<int>() is int minLen && str.Length < minLen)
            {
                result.AddError($"String length {str.Length} is less than minimum {minLen}", path);
            }
        }

        // Validate maxLength
        if (schema.TryGetPropertyValue("maxLength", out var maxLenValue))
        {
            if (maxLenValue?.GetValue<int>() is int maxLen && str.Length > maxLen)
            {
                result.AddError($"String length {str.Length} exceeds maximum {maxLen}", path);
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
                        result.AddError($"String does not match pattern: {pattern}", path);
                    }
                }
                catch (ArgumentException)
                {
                    result.AddError($"Invalid regex pattern: {pattern}", path);
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
                    result.AddError($"String is not a valid email address", path);
                }
                break;
            case "uri":
                if (!Uri.TryCreate(value, UriKind.Absolute, out _))
                {
                    result.AddError($"String is not a valid URI", path);
                }
                break;
            case "uri-reference":
                if (!Uri.TryCreate(value, UriKind.RelativeOrAbsolute, out _))
                {
                    result.AddError($"String is not a valid URI reference", path);
                }
                break;
            case "date":
                if (!DateOnly.TryParse(value, CultureInfo.InvariantCulture, out _))
                {
                    result.AddError($"String is not a valid date", path);
                }
                break;
            case "time":
                if (!TimeOnly.TryParse(value, CultureInfo.InvariantCulture, out _))
                {
                    result.AddError($"String is not a valid time", path);
                }
                break;
            case "date-time":
                if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, out _))
                {
                    result.AddError($"String is not a valid date-time", path);
                }
                break;
            case "uuid":
                if (!Guid.TryParse(value, out _))
                {
                    result.AddError($"String is not a valid UUID", path);
                }
                break;
            case "ipv4":
                if (!System.Net.IPAddress.TryParse(value, out var ip4) || 
                    ip4.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
                {
                    result.AddError($"String is not a valid IPv4 address", path);
                }
                break;
            case "ipv6":
                if (!System.Net.IPAddress.TryParse(value, out var ip6) || 
                    ip6.AddressFamily != System.Net.Sockets.AddressFamily.InterNetworkV6)
                {
                    result.AddError($"String is not a valid IPv6 address", path);
                }
                break;
            case "hostname":
                if (!Uri.CheckHostName(value).Equals(UriHostNameType.Dns))
                {
                    result.AddError($"String is not a valid hostname", path);
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
            result.AddError($"Value must be a {type}", path);
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
            result.AddError($"Value must be a {type}", path);
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
                    result.AddError("Value must be a valid int64", path);
                    return false;
                }
                break;
            case "uint64":
                if (!ulong.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
                {
                    result.AddError("Value must be a valid uint64", path);
                    return false;
                }
                break;
            case "int128":
                if (!Int128.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
                {
                    result.AddError("Value must be a valid int128", path);
                    return false;
                }
                break;
            case "uint128":
                if (!UInt128.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
                {
                    result.AddError("Value must be a valid uint128", path);
                    return false;
                }
                break;
            case "decimal":
            case "decimal64":
            case "decimal128":
                if (!decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out _))
                {
                    result.AddError($"Value must be a valid {type}", path);
                    return false;
                }
                break;
            default:
                result.AddError($"String value not expected for type {type}", path);
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
                    result.AddError($"Value {value} is not a valid int8", path);
                }
                break;
            case "int16":
                if (value < short.MinValue || value > short.MaxValue || value != Math.Truncate(value))
                {
                    result.AddError($"Value {value} is not a valid int16", path);
                }
                break;
            case "int32":
                if (value < int.MinValue || value > int.MaxValue || value != Math.Truncate(value))
                {
                    result.AddError($"Value {value} is not a valid int32", path);
                }
                break;
            case "int64":
                if (value < long.MinValue || value > long.MaxValue || value != Math.Truncate(value))
                {
                    result.AddError($"Value {value} is not a valid int64", path);
                }
                break;
            case "uint8":
                if (value < 0 || value > byte.MaxValue || value != Math.Truncate(value))
                {
                    result.AddError($"Value {value} is not a valid uint8", path);
                }
                break;
            case "uint16":
                if (value < 0 || value > ushort.MaxValue || value != Math.Truncate(value))
                {
                    result.AddError($"Value {value} is not a valid uint16", path);
                }
                break;
            case "uint32":
                if (value < 0 || value > uint.MaxValue || value != Math.Truncate(value))
                {
                    result.AddError($"Value {value} is not a valid uint32", path);
                }
                break;
            case "uint64":
                if (value < 0 || value != Math.Truncate(value))
                {
                    result.AddError($"Value {value} is not a valid uint64", path);
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
                result.AddError($"Value {value} is less than minimum {min.Value}", path);
            }
        }

        // maximum
        if (schema.TryGetPropertyValue("maximum", out var maxValue))
        {
            var max = GetDecimalValue(maxValue);
            if (max.HasValue && value > max.Value)
            {
                result.AddError($"Value {value} exceeds maximum {max.Value}", path);
            }
        }

        // exclusiveMinimum
        if (schema.TryGetPropertyValue("exclusiveMinimum", out var exclMinValue))
        {
            var exclMin = GetDecimalValue(exclMinValue);
            if (exclMin.HasValue && value <= exclMin.Value)
            {
                result.AddError($"Value {value} must be greater than {exclMin.Value}", path);
            }
        }

        // exclusiveMaximum
        if (schema.TryGetPropertyValue("exclusiveMaximum", out var exclMaxValue))
        {
            var exclMax = GetDecimalValue(exclMaxValue);
            if (exclMax.HasValue && value >= exclMax.Value)
            {
                result.AddError($"Value {value} must be less than {exclMax.Value}", path);
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
                    result.AddError($"Value {value} is not a multiple of {multipleOf.Value}", path);
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
            result.AddError("Value must be an object", path);
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
                    result.AddError($"Missing required property: {reqName}", path);
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
                            result.AddError($"Additional property not allowed: {prop.Key}", path);
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
                result.AddError($"Object has {obj.Count} properties, minimum is {minProps.Value}", path);
            }
        }

        if (schema.TryGetPropertyValue("maxProperties", out var maxPropsValue))
        {
            var maxProps = maxPropsValue?.GetValue<int>();
            if (maxProps.HasValue && obj.Count > maxProps.Value)
            {
                result.AddError($"Object has {obj.Count} properties, maximum is {maxProps.Value}", path);
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
                            result.AddError($"Property '{dep.Key}' requires property '{reqProp}'", path);
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
            result.AddError("Value must be an array", path);
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
                result.AddError($"Array has {arr.Count} items, minimum is {minItems.Value}", path);
            }
        }

        if (schema.TryGetPropertyValue("maxItems", out var maxItemsValue))
        {
            var maxItems = maxItemsValue?.GetValue<int>();
            if (maxItems.HasValue && arr.Count > maxItems.Value)
            {
                result.AddError($"Array has {arr.Count} items, maximum is {maxItems.Value}", path);
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
                result.AddError($"Array must contain at least {minContains} matching items (found {containsCount})", path);
            }

            if (containsCount > maxContains)
            {
                result.AddError($"Array must contain at most {maxContains} matching items (found {containsCount})", path);
            }
        }
    }

    private void ValidateSet(JsonNode? instance, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        if (instance is not JsonArray arr)
        {
            result.AddError("Value must be an array (set)", path);
            return;
        }

        // Check uniqueness
        var seen = new HashSet<string>();
        for (var i = 0; i < arr.Count; i++)
        {
            var itemJson = arr[i]?.ToJsonString() ?? "null";
            if (!seen.Add(itemJson))
            {
                result.AddError($"Set contains duplicate value at index {i}", path);
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
            result.AddError("Value must be an object (map)", path);
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

        // Validate propertyNames
        if (schema.TryGetPropertyValue("propertyNames", out var propNamesValue) && propNamesValue is not null)
        {
            foreach (var prop in obj)
            {
                var keyNode = JsonValue.Create(prop.Key);
                ValidateInstance(keyNode, propNamesValue, rootSchema, result,
                    AppendPath(path, $"[key:{prop.Key}]"), depth + 1);
            }
        }

        // Validate minProperties/maxProperties
        if (schema.TryGetPropertyValue("minProperties", out var minPropsValue))
        {
            var minProps = minPropsValue?.GetValue<int>();
            if (minProps.HasValue && obj.Count < minProps.Value)
            {
                result.AddError($"Map has {obj.Count} entries, minimum is {minProps.Value}", path);
            }
        }

        if (schema.TryGetPropertyValue("maxProperties", out var maxPropsValue))
        {
            var maxProps = maxPropsValue?.GetValue<int>();
            if (maxProps.HasValue && obj.Count > maxProps.Value)
            {
                result.AddError($"Map has {obj.Count} entries, maximum is {maxProps.Value}", path);
            }
        }
    }

    private void ValidateTuple(JsonNode? instance, JsonObject schema, JsonNode rootSchema,
        ValidationResult result, string path, int depth)
    {
        if (instance is not JsonArray arr)
        {
            result.AddError("Value must be an array (tuple)", path);
            return;
        }

        // Validate prefixItems
        if (schema.TryGetPropertyValue("prefixItems", out var prefixValue) && prefixValue is JsonArray prefixArr)
        {
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
            if (schema.TryGetPropertyValue("items", out var itemsValue))
            {
                if (itemsValue is JsonValue jv && jv.TryGetValue<bool>(out var allowed))
                {
                    if (!allowed && arr.Count > prefixArr.Count)
                    {
                        result.AddError($"Tuple has {arr.Count} items but only {prefixArr.Count} are defined", path);
                    }
                }
                else if (itemsValue is JsonObject additionalSchema)
                {
                    for (var i = prefixArr.Count; i < arr.Count; i++)
                    {
                        ValidateInstance(arr[i], additionalSchema, rootSchema, result,
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
            result.AddError("Value must be an object (choice)", path);
            return;
        }

        if (!schema.TryGetPropertyValue("options", out var optionsValue) || optionsValue is not JsonObject options)
        {
            result.AddError("Choice schema must have 'options'", path);
            return;
        }

        // Get discriminator
        string? discriminator = null;
        if (schema.TryGetPropertyValue("discriminator", out var discValue))
        {
            discriminator = discValue?.GetValue<string>();
        }

        if (!string.IsNullOrEmpty(discriminator))
        {
            // Use discriminator to determine type
            if (!obj.TryGetPropertyValue(discriminator, out var discValueNode))
            {
                result.AddError($"Choice requires discriminator property: {discriminator}", path);
                return;
            }

            var discStr = discValueNode?.GetValue<string>();
            if (string.IsNullOrEmpty(discStr))
            {
                result.AddError($"Discriminator value must be a string", path);
                return;
            }

            if (!options.TryGetPropertyValue(discStr, out var optionSchema) || optionSchema is null)
            {
                result.AddError($"Unknown choice option: {discStr}", path);
                return;
            }

            ValidateInstance(instance, optionSchema, rootSchema, result, path, depth + 1);
        }
        else
        {
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
                result.AddError("Value does not match any choice option", path);
            }
            else if (matchCount > 1)
            {
                result.AddError($"Value matches {matchCount} choice options (should match exactly one)", path);
            }
        }
    }

    private void ValidateDate(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError("Date must be a string", path);
            return;
        }

        if (!DateOnly.TryParseExact(str, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
        {
            result.AddError($"Invalid date format: {str}", path);
        }
    }

    private void ValidateTime(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError("Time must be a string", path);
            return;
        }

        if (!TimeOnly.TryParse(str, CultureInfo.InvariantCulture, out _))
        {
            result.AddError($"Invalid time format: {str}", path);
        }
    }

    private void ValidateDateTime(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError("DateTime must be a string", path);
            return;
        }

        if (!DateTimeOffset.TryParse(str, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _))
        {
            result.AddError($"Invalid datetime format: {str}", path);
        }
    }

    private void ValidateDuration(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError("Duration must be a string", path);
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
                result.AddError($"Invalid duration format: {str}", path);
            }
        }
    }

    private void ValidateUuid(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError("UUID must be a string", path);
            return;
        }

        if (!Guid.TryParse(str, out _))
        {
            result.AddError($"Invalid UUID format: {str}", path);
        }
    }

    private void ValidateUri(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError("URI must be a string", path);
            return;
        }

        if (!System.Uri.TryCreate(str, UriKind.RelativeOrAbsolute, out _))
        {
            result.AddError($"Invalid URI format: {str}", path);
        }
    }

    private void ValidateBinary(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError("Binary must be a base64 string", path);
            return;
        }

        try
        {
            Convert.FromBase64String(str);
        }
        catch
        {
            result.AddError($"Invalid base64 encoding", path);
        }
    }

    private void ValidateJsonPointer(JsonNode? instance, ValidationResult result, string path)
    {
        if (instance is not JsonValue jv || !jv.TryGetValue<string>(out var str))
        {
            result.AddError("JSON Pointer must be a string", path);
            return;
        }

        // JSON Pointer must be empty or start with /
        if (!string.IsNullOrEmpty(str) && !str.StartsWith('/'))
        {
            result.AddError($"Invalid JSON Pointer format: {str}", path);
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
                            result.AddError($"String length {str.Length} is less than minimum {minLen}", path);
                        }
                    }

                    // Validate maxLength
                    if (schema.TryGetPropertyValue("maxLength", out var maxLenValue))
                    {
                        if (maxLenValue?.GetValue<int>() is int maxLen && str.Length > maxLen)
                        {
                            result.AddError($"String length {str.Length} exceeds maximum {maxLen}", path);
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
                                    result.AddError($"String does not match pattern: {pattern}", path);
                                }
                            }
                            catch (ArgumentException)
                            {
                                result.AddError($"Invalid regex pattern: {pattern}", path);
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

        var parts = pointer.Split('/').Skip(1); // Skip empty first part
        var current = node;

        foreach (var part in parts)
        {
            if (current is null) return null;

            // Unescape JSON Pointer tokens
            var unescaped = part.Replace("~1", "/").Replace("~0", "~");

            if (current is JsonObject obj)
            {
                if (!obj.TryGetPropertyValue(unescaped, out current))
                {
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
}
