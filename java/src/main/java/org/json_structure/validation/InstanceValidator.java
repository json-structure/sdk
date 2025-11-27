// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URI;
import java.time.*;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Validates JSON instances against JSON Structure schemas.
 */
public final class InstanceValidator {

    private final ValidationOptions options;
    private final ObjectMapper objectMapper;
    private final Map<String, JsonNode> resolvedRefs = new HashMap<>();

    /**
     * Creates a new InstanceValidator with default options.
     */
    public InstanceValidator() {
        this(ValidationOptions.DEFAULT);
    }

    /**
     * Creates a new InstanceValidator with the specified options.
     *
     * @param options the validation options
     */
    public InstanceValidator(ValidationOptions options) {
        this.options = options != null ? options : ValidationOptions.DEFAULT;
        this.objectMapper = new ObjectMapper();
    }

    /**
     * Validates an instance against a schema.
     *
     * @param instance the instance to validate
     * @param schema   the schema to validate against
     * @return the validation result
     */
    public ValidationResult validate(JsonNode instance, JsonNode schema) {
        ValidationResult result = new ValidationResult();

        if (schema == null) {
            result.addError("Schema cannot be null", "");
            return result;
        }

        resolvedRefs.clear();

        // Handle $root - if the schema has a $root property, resolve it and use that as the validation target
        JsonNode effectiveSchema = schema;
        if (schema.isObject() && schema.has("$root")) {
            String rootRef = schema.get("$root").asText();
            if (rootRef != null && !rootRef.isEmpty()) {
                JsonNode resolved = resolveRef(rootRef, schema);
                if (resolved != null) {
                    effectiveSchema = resolved;
                } else {
                    result.addError("Unable to resolve $root reference: " + rootRef, "");
                    return result;
                }
            }
        }

        validateInstance(instance, effectiveSchema, schema, result, "", 0);
        return result;
    }

    /**
     * Validates an instance against a schema from JSON strings.
     *
     * @param instanceJson the instance JSON string
     * @param schemaJson   the schema JSON string
     * @return the validation result
     */
    public ValidationResult validate(String instanceJson, String schemaJson) {
        try {
            JsonNode instance = objectMapper.readTree(instanceJson);
            JsonNode schema = objectMapper.readTree(schemaJson);
            return validate(instance, schema);
        } catch (JsonProcessingException e) {
            return ValidationResult.failure("Failed to parse JSON: " + e.getMessage());
        }
    }

    private void validateInstance(JsonNode instance, JsonNode schema, JsonNode rootSchema,
                                  ValidationResult result, String path, int depth) {
        if (depth > options.getMaxValidationDepth()) {
            result.addError("Maximum validation depth (" + options.getMaxValidationDepth() + ") exceeded", path);
            return;
        }

        if (options.isStopOnFirstError() && !result.isValid()) {
            return;
        }

        // Handle boolean schemas
        if (schema.isBoolean()) {
            if (!schema.asBoolean() && instance != null) {
                result.addError("Schema 'false' rejects all values", path);
            }
            return;
        }

        if (!schema.isObject()) {
            result.addError("Schema must be a boolean or object", path);
            return;
        }

        ObjectNode schemaObj = (ObjectNode) schema;

        // Handle $ref
        if (schemaObj.has("$ref")) {
            String refStr = schemaObj.get("$ref").asText();
            if (refStr != null && !refStr.isEmpty()) {
                JsonNode resolvedSchema = resolveRef(refStr, rootSchema);
                if (resolvedSchema == null) {
                    result.addError("Unable to resolve reference: " + refStr, path);
                    return;
                }
                validateInstance(instance, resolvedSchema, rootSchema, result, path, depth + 1);
                return;
            }
        }

        // Handle $extends
        if (schemaObj.has("$extends")) {
            String extendsRef = schemaObj.get("$extends").asText();
            if (extendsRef != null && !extendsRef.isEmpty()) {
                JsonNode baseSchema = resolveRef(extendsRef, rootSchema);
                if (baseSchema != null) {
                    validateInstance(instance, baseSchema, rootSchema, result, path, depth + 1);
                }
            }
        }

        // Handle conditional composition
        validateConditionals(instance, schemaObj, rootSchema, result, path, depth);

        // Get type constraint
        String typeConstraint = getTypeConstraint(schemaObj);

        // Handle const
        if (schemaObj.has("const")) {
            if (!jsonNodeEquals(instance, schemaObj.get("const"))) {
                result.addError("Value must equal const value", path);
            }
            return;
        }

        // Handle enum
        if (schemaObj.has("enum")) {
            ArrayNode enumArr = (ArrayNode) schemaObj.get("enum");
            boolean matches = false;
            for (JsonNode enumItem : enumArr) {
                if (jsonNodeEquals(instance, enumItem)) {
                    matches = true;
                    break;
                }
            }
            if (!matches) {
                result.addError("Value must be one of the enum values", path);
            }
            return;
        }

        // Handle type as reference object (e.g., "type": { "$ref": "#/definitions/..." })
        if (schemaObj.has("type") && schemaObj.get("type").isObject()) {
            JsonNode typeNode = schemaObj.get("type");
            if (typeNode.has("$ref")) {
                String refStr = typeNode.get("$ref").asText();
                if (refStr != null && !refStr.isEmpty()) {
                    JsonNode resolvedSchema = resolveRef(refStr, rootSchema);
                    if (resolvedSchema != null) {
                        validateInstance(instance, resolvedSchema, rootSchema, result, path, depth + 1);
                        return;
                    } else {
                        result.addError("Unable to resolve type reference: " + refStr, path);
                        return;
                    }
                }
            }
        }

        // Validate based on type
        if (typeConstraint != null) {
            validateType(instance, typeConstraint, schemaObj, rootSchema, result, path, depth);
        } else {
            // No type constraint, validate based on instance type
            validateInstanceByJsonType(instance, schemaObj, rootSchema, result, path, depth);
        }

        // Validate additional constraints
        validateValidationKeywords(instance, schemaObj, result, path);
    }

    private void validateConditionals(JsonNode instance, ObjectNode schema, JsonNode rootSchema,
                                      ValidationResult result, String path, int depth) {
        // Handle allOf
        if (schema.has("allOf") && schema.get("allOf").isArray()) {
            for (JsonNode subSchema : schema.get("allOf")) {
                validateInstance(instance, subSchema, rootSchema, result, path, depth + 1);
            }
        }

        // Handle anyOf
        if (schema.has("anyOf") && schema.get("anyOf").isArray()) {
            boolean anyValid = false;
            for (JsonNode subSchema : schema.get("anyOf")) {
                ValidationResult subResult = new ValidationResult();
                validateInstance(instance, subSchema, rootSchema, subResult, path, depth + 1);
                if (subResult.isValid()) {
                    anyValid = true;
                    break;
                }
            }
            if (!anyValid) {
                result.addError("Value must match at least one schema in anyOf", path);
            }
        }

        // Handle oneOf
        if (schema.has("oneOf") && schema.get("oneOf").isArray()) {
            int matchCount = 0;
            for (JsonNode subSchema : schema.get("oneOf")) {
                ValidationResult subResult = new ValidationResult();
                validateInstance(instance, subSchema, rootSchema, subResult, path, depth + 1);
                if (subResult.isValid()) {
                    matchCount++;
                }
            }
            if (matchCount != 1) {
                result.addError("Value must match exactly one schema in oneOf (matched " + matchCount + ")", path);
            }
        }

        // Handle not
        if (schema.has("not")) {
            ValidationResult subResult = new ValidationResult();
            validateInstance(instance, schema.get("not"), rootSchema, subResult, path, depth + 1);
            if (subResult.isValid()) {
                result.addError("Value must not match the schema in 'not'", path);
            }
        }

        // Handle if/then/else
        if (schema.has("if")) {
            ValidationResult ifResult = new ValidationResult();
            validateInstance(instance, schema.get("if"), rootSchema, ifResult, path, depth + 1);

            if (ifResult.isValid()) {
                if (schema.has("then")) {
                    validateInstance(instance, schema.get("then"), rootSchema, result, path, depth + 1);
                }
            } else {
                if (schema.has("else")) {
                    validateInstance(instance, schema.get("else"), rootSchema, result, path, depth + 1);
                }
            }
        }
    }

    private String getTypeConstraint(ObjectNode schema) {
        if (schema.has("type")) {
            JsonNode typeNode = schema.get("type");
            if (typeNode.isTextual()) {
                return typeNode.asText();
            } else if (typeNode.isObject()) {
                // Handle type as object with $ref
                if (typeNode.has("$ref")) {
                    // This is a reference to another type - the actual validation
                    // should be done by resolving the reference
                    return null; // Return null, the $ref handling will deal with this
                } else if (typeNode.has("type")) {
                    // Nested type object
                    return getTypeConstraint((ObjectNode) typeNode);
                }
            }
        }
        return null;
    }

    private void validateType(JsonNode instance, String type, ObjectNode schema, JsonNode rootSchema,
                              ValidationResult result, String path, int depth) {
        switch (type) {
            case "null" -> validateNull(instance, result, path);
            case "boolean" -> validateBoolean(instance, result, path);
            case "string" -> validateString(instance, schema, result, path);
            case "number", "integer", "int8", "int16", "int32", "int64", "int128",
                 "uint8", "uint16", "uint32", "uint64", "uint128",
                 "float8", "float16", "float32", "float64", "float128",
                 "double", "decimal", "decimal64", "decimal128" ->
                    validateNumber(instance, type, schema, result, path);
            case "object" -> validateObject(instance, schema, rootSchema, result, path, depth);
            case "array" -> validateArray(instance, schema, rootSchema, result, path, depth);
            case "set" -> validateSet(instance, schema, rootSchema, result, path, depth);
            case "map" -> validateMap(instance, schema, rootSchema, result, path, depth);
            case "tuple" -> validateTuple(instance, schema, rootSchema, result, path, depth);
            case "choice" -> validateChoice(instance, schema, rootSchema, result, path, depth);
            case "any" -> { /* Any type accepts any value */ }
            case "date" -> validateDate(instance, result, path);
            case "time" -> validateTime(instance, result, path);
            case "datetime" -> validateDateTime(instance, result, path);
            case "duration" -> validateDuration(instance, result, path);
            case "uuid" -> validateUuid(instance, result, path);
            case "uri" -> validateUri(instance, result, path);
            case "binary" -> validateBinary(instance, result, path);
            case "jsonpointer" -> validateJsonPointer(instance, result, path);
            default -> {
                if (type.contains(":")) {
                    result.addError("Custom type reference not yet supported: " + type, path);
                } else {
                    result.addError("Unknown type: " + type, path);
                }
            }
        }
    }

    private void validateInstanceByJsonType(JsonNode instance, ObjectNode schema, JsonNode rootSchema,
                                            ValidationResult result, String path, int depth) {
        if (instance == null || instance.isNull()) {
            return; // null is valid when no type constraint
        }

        if (instance.isObject()) {
            validateObject(instance, schema, rootSchema, result, path, depth);
        } else if (instance.isArray()) {
            validateArray(instance, schema, rootSchema, result, path, depth);
        }
    }

    private void validateNull(JsonNode instance, ValidationResult result, String path) {
        if (instance != null && !instance.isNull()) {
            result.addError("Value must be null", path);
        }
    }

    private void validateBoolean(JsonNode instance, ValidationResult result, String path) {
        if (!instance.isBoolean()) {
            result.addError("Value must be a boolean", path);
        }
    }

    private void validateString(JsonNode instance, ObjectNode schema, ValidationResult result, String path) {
        if (!instance.isTextual()) {
            result.addError("Value must be a string", path);
            return;
        }

        String str = instance.asText();

        // Validate minLength
        if (schema.has("minLength")) {
            int minLen = schema.get("minLength").asInt();
            if (str.length() < minLen) {
                result.addError("String length " + str.length() + " is less than minimum " + minLen, path);
            }
        }

        // Validate maxLength
        if (schema.has("maxLength")) {
            int maxLen = schema.get("maxLength").asInt();
            if (str.length() > maxLen) {
                result.addError("String length " + str.length() + " exceeds maximum " + maxLen, path);
            }
        }

        // Validate pattern
        if (schema.has("pattern")) {
            String pattern = schema.get("pattern").asText();
            try {
                if (!Pattern.matches(pattern, str)) {
                    result.addError("String does not match pattern: " + pattern, path);
                }
            } catch (PatternSyntaxException e) {
                result.addError("Invalid regex pattern: " + pattern, path);
            }
        }

        // Validate format
        if (options.isStrictFormatValidation() && schema.has("format")) {
            String format = schema.get("format").asText();
            validateStringFormat(str, format, result, path);
        }
    }

    private void validateStringFormat(String value, String format, ValidationResult result, String path) {
        if (format == null) return;

        switch (format) {
            case "email" -> {
                if (!isValidEmail(value)) {
                    result.addError("String is not a valid email address", path);
                }
            }
            case "uri" -> {
                try {
                    new URI(value);
                } catch (Exception e) {
                    result.addError("String is not a valid URI", path);
                }
            }
            case "date" -> {
                try {
                    LocalDate.parse(value);
                } catch (DateTimeParseException e) {
                    result.addError("String is not a valid date", path);
                }
            }
            case "time" -> {
                try {
                    LocalTime.parse(value);
                } catch (DateTimeParseException e) {
                    result.addError("String is not a valid time", path);
                }
            }
            case "date-time" -> {
                try {
                    OffsetDateTime.parse(value);
                } catch (DateTimeParseException e) {
                    try {
                        Instant.parse(value);
                    } catch (DateTimeParseException e2) {
                        result.addError("String is not a valid date-time", path);
                    }
                }
            }
            case "uuid" -> {
                try {
                    UUID.fromString(value);
                } catch (IllegalArgumentException e) {
                    result.addError("String is not a valid UUID", path);
                }
            }
        }
    }

    private boolean isValidEmail(String email) {
        if (email == null || email.isBlank()) return false;
        int atIndex = email.indexOf('@');
        return atIndex > 0 && atIndex < email.length() - 1 && !email.contains(" ");
    }

    private void validateNumber(JsonNode instance, String type, ObjectNode schema,
                                ValidationResult result, String path) {
        // Handle string-encoded large integers
        if (instance.isTextual()) {
            String strValue = instance.asText();
            if (!validateStringEncodedNumber(strValue, type, result, path)) {
                return;
            }
            // For string-encoded numbers, we still need to validate numeric constraints
            try {
                BigDecimal decVal = new BigDecimal(strValue);
                validateNumericConstraints(decVal, schema, result, path);
            } catch (NumberFormatException e) {
                // Already reported error
            }
            return;
        }

        if (!instance.isNumber()) {
            result.addError("Value must be a " + type, path);
            return;
        }

        double numValue = instance.asDouble();

        // Validate type-specific constraints
        validateNumericType(numValue, type, result, path);

        // Validate numeric constraints
        validateNumericConstraints(BigDecimal.valueOf(numValue), schema, result, path);
    }

    private boolean validateStringEncodedNumber(String value, String type, ValidationResult result, String path) {
        try {
            switch (type) {
                case "int64" -> Long.parseLong(value);
                case "uint64" -> {
                    BigInteger bi = new BigInteger(value);
                    if (bi.signum() < 0 || bi.compareTo(new BigInteger("18446744073709551615")) > 0) {
                        result.addError("Value must be a valid uint64", path);
                        return false;
                    }
                }
                case "int128" -> new BigInteger(value);
                case "uint128" -> {
                    BigInteger bi = new BigInteger(value);
                    if (bi.signum() < 0) {
                        result.addError("Value must be a valid uint128", path);
                        return false;
                    }
                }
                case "decimal", "decimal64", "decimal128" -> new BigDecimal(value);
                default -> {
                    result.addError("String value not expected for type " + type, path);
                    return false;
                }
            }
        } catch (NumberFormatException e) {
            result.addError("Value must be a valid " + type, path);
            return false;
        }
        return true;
    }

    private void validateNumericType(double value, String type, ValidationResult result, String path) {
        switch (type) {
            case "int8" -> {
                if (value < Byte.MIN_VALUE || value > Byte.MAX_VALUE || value != Math.floor(value)) {
                    result.addError("Value " + value + " is not a valid int8", path);
                }
            }
            case "int16" -> {
                if (value < Short.MIN_VALUE || value > Short.MAX_VALUE || value != Math.floor(value)) {
                    result.addError("Value " + value + " is not a valid int16", path);
                }
            }
            case "int32" -> {
                if (value < Integer.MIN_VALUE || value > Integer.MAX_VALUE || value != Math.floor(value)) {
                    result.addError("Value " + value + " is not a valid int32", path);
                }
            }
            case "int64" -> {
                if (value < Long.MIN_VALUE || value > Long.MAX_VALUE || value != Math.floor(value)) {
                    result.addError("Value " + value + " is not a valid int64", path);
                }
            }
            case "uint8" -> {
                if (value < 0 || value > 255 || value != Math.floor(value)) {
                    result.addError("Value " + value + " is not a valid uint8", path);
                }
            }
            case "uint16" -> {
                if (value < 0 || value > 65535 || value != Math.floor(value)) {
                    result.addError("Value " + value + " is not a valid uint16", path);
                }
            }
            case "uint32" -> {
                if (value < 0 || value > 4294967295L || value != Math.floor(value)) {
                    result.addError("Value " + value + " is not a valid uint32", path);
                }
            }
            case "uint64" -> {
                if (value < 0 || value != Math.floor(value)) {
                    result.addError("Value " + value + " is not a valid uint64", path);
                }
            }
        }
    }

    private void validateNumericConstraints(BigDecimal value, ObjectNode schema, ValidationResult result, String path) {
        // minimum
        if (schema.has("minimum")) {
            BigDecimal min = new BigDecimal(schema.get("minimum").asText());
            if (value.compareTo(min) < 0) {
                result.addError("Value " + value + " is less than minimum " + min, path);
            }
        }

        // maximum
        if (schema.has("maximum")) {
            BigDecimal max = new BigDecimal(schema.get("maximum").asText());
            if (value.compareTo(max) > 0) {
                result.addError("Value " + value + " exceeds maximum " + max, path);
            }
        }

        // exclusiveMinimum
        if (schema.has("exclusiveMinimum")) {
            BigDecimal exclMin = new BigDecimal(schema.get("exclusiveMinimum").asText());
            if (value.compareTo(exclMin) <= 0) {
                result.addError("Value " + value + " must be greater than " + exclMin, path);
            }
        }

        // exclusiveMaximum
        if (schema.has("exclusiveMaximum")) {
            BigDecimal exclMax = new BigDecimal(schema.get("exclusiveMaximum").asText());
            if (value.compareTo(exclMax) >= 0) {
                result.addError("Value " + value + " must be less than " + exclMax, path);
            }
        }

        // multipleOf
        if (schema.has("multipleOf")) {
            BigDecimal multipleOf = new BigDecimal(schema.get("multipleOf").asText());
            if (multipleOf.compareTo(BigDecimal.ZERO) != 0) {
                BigDecimal remainder = value.remainder(multipleOf);
                if (remainder.compareTo(BigDecimal.ZERO) != 0) {
                    result.addError("Value " + value + " is not a multiple of " + multipleOf, path);
                }
            }
        }
    }

    private void validateObject(JsonNode instance, ObjectNode schema, JsonNode rootSchema,
                                ValidationResult result, String path, int depth) {
        if (!instance.isObject()) {
            result.addError("Value must be an object", path);
            return;
        }

        ObjectNode obj = (ObjectNode) instance;
        Set<String> definedProps = new HashSet<>();

        // Validate properties
        if (schema.has("properties") && schema.get("properties").isObject()) {
            ObjectNode props = (ObjectNode) schema.get("properties");
            Iterator<Map.Entry<String, JsonNode>> fields = props.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                definedProps.add(field.getKey());
                if (obj.has(field.getKey())) {
                    validateInstance(obj.get(field.getKey()), field.getValue(), rootSchema,
                            result, appendPath(path, field.getKey()), depth + 1);
                }
            }
        }

        // Validate required
        if (schema.has("required") && schema.get("required").isArray()) {
            for (JsonNode req : schema.get("required")) {
                String reqName = req.asText();
                if (!obj.has(reqName)) {
                    result.addError("Missing required property: " + reqName, path);
                }
            }
        }

        // Validate additionalProperties
        if (schema.has("additionalProperties")) {
            JsonNode additional = schema.get("additionalProperties");
            if (additional.isBoolean() && !additional.asBoolean()) {
                Iterator<String> fieldNames = obj.fieldNames();
                while (fieldNames.hasNext()) {
                    String fieldName = fieldNames.next();
                    // Skip $schema - it's a meta-property
                    if (fieldName.equals("$schema")) continue;
                    if (!definedProps.contains(fieldName)) {
                        result.addError("Additional property not allowed: " + fieldName, path);
                    }
                }
            } else if (additional.isObject()) {
                Iterator<Map.Entry<String, JsonNode>> fields = obj.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> field = fields.next();
                    // Skip $schema
                    if (field.getKey().equals("$schema")) continue;
                    if (!definedProps.contains(field.getKey())) {
                        validateInstance(field.getValue(), additional, rootSchema,
                                result, appendPath(path, field.getKey()), depth + 1);
                    }
                }
            }
        }

        // Validate minProperties/maxProperties
        if (schema.has("minProperties")) {
            int minProps = schema.get("minProperties").asInt();
            if (obj.size() < minProps) {
                result.addError("Object has " + obj.size() + " properties, minimum is " + minProps, path);
            }
        }

        if (schema.has("maxProperties")) {
            int maxProps = schema.get("maxProperties").asInt();
            if (obj.size() > maxProps) {
                result.addError("Object has " + obj.size() + " properties, maximum is " + maxProps, path);
            }
        }

        // Validate dependentRequired
        if (schema.has("dependentRequired") && schema.get("dependentRequired").isObject()) {
            ObjectNode depReq = (ObjectNode) schema.get("dependentRequired");
            Iterator<Map.Entry<String, JsonNode>> deps = depReq.fields();
            while (deps.hasNext()) {
                Map.Entry<String, JsonNode> dep = deps.next();
                if (obj.has(dep.getKey()) && dep.getValue().isArray()) {
                    for (JsonNode required : dep.getValue()) {
                        String reqProp = required.asText();
                        if (!obj.has(reqProp)) {
                            result.addError("Property '" + dep.getKey() + "' requires property '" + reqProp + "'", path);
                        }
                    }
                }
            }
        }
    }

    private void validateArray(JsonNode instance, ObjectNode schema, JsonNode rootSchema,
                               ValidationResult result, String path, int depth) {
        if (!instance.isArray()) {
            result.addError("Value must be an array", path);
            return;
        }

        ArrayNode arr = (ArrayNode) instance;

        // Validate items
        if (schema.has("items")) {
            JsonNode items = schema.get("items");
            for (int i = 0; i < arr.size(); i++) {
                validateInstance(arr.get(i), items, rootSchema, result,
                        appendPath(path, String.valueOf(i)), depth + 1);
            }
        }

        // Validate minItems/maxItems
        if (schema.has("minItems")) {
            int minItems = schema.get("minItems").asInt();
            if (arr.size() < minItems) {
                result.addError("Array has " + arr.size() + " items, minimum is " + minItems, path);
            }
        }

        if (schema.has("maxItems")) {
            int maxItems = schema.get("maxItems").asInt();
            if (arr.size() > maxItems) {
                result.addError("Array has " + arr.size() + " items, maximum is " + maxItems, path);
            }
        }

        // Validate contains
        if (schema.has("contains")) {
            JsonNode containsSchema = schema.get("contains");
            int containsCount = 0;
            for (JsonNode item : arr) {
                ValidationResult itemResult = new ValidationResult();
                validateInstance(item, containsSchema, rootSchema, itemResult, path, depth + 1);
                if (itemResult.isValid()) {
                    containsCount++;
                }
            }

            int minContains = schema.has("minContains") ? schema.get("minContains").asInt() : 1;
            int maxContains = schema.has("maxContains") ? schema.get("maxContains").asInt() : Integer.MAX_VALUE;

            if (containsCount < minContains) {
                result.addError("Array must contain at least " + minContains + " matching items (found " + containsCount + ")", path);
            }

            if (containsCount > maxContains) {
                result.addError("Array must contain at most " + maxContains + " matching items (found " + containsCount + ")", path);
            }
        }
    }

    private void validateSet(JsonNode instance, ObjectNode schema, JsonNode rootSchema,
                             ValidationResult result, String path, int depth) {
        if (!instance.isArray()) {
            result.addError("Value must be an array (set)", path);
            return;
        }

        ArrayNode arr = (ArrayNode) instance;

        // Check uniqueness
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < arr.size(); i++) {
            String itemJson = arr.get(i).toString();
            if (!seen.add(itemJson)) {
                result.addError("Set contains duplicate value at index " + i, path);
            }
        }

        // Validate items
        validateArray(instance, schema, rootSchema, result, path, depth);
    }

    private void validateMap(JsonNode instance, ObjectNode schema, JsonNode rootSchema,
                             ValidationResult result, String path, int depth) {
        if (!instance.isObject()) {
            result.addError("Value must be an object (map)", path);
            return;
        }

        ObjectNode obj = (ObjectNode) instance;

        // Validate values schema
        if (schema.has("values")) {
            JsonNode valuesSchema = schema.get("values");
            Iterator<Map.Entry<String, JsonNode>> fields = obj.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                validateInstance(field.getValue(), valuesSchema, rootSchema, result,
                        appendPath(path, field.getKey()), depth + 1);
            }
        }

        // Validate propertyNames
        if (schema.has("propertyNames")) {
            JsonNode propNamesSchema = schema.get("propertyNames");
            Iterator<String> fieldNames = obj.fieldNames();
            while (fieldNames.hasNext()) {
                String fieldName = fieldNames.next();
                JsonNode keyNode = objectMapper.valueToTree(fieldName);
                validateInstance(keyNode, propNamesSchema, rootSchema, result,
                        appendPath(path, "[key:" + fieldName + "]"), depth + 1);
            }
        }

        // Validate minProperties/maxProperties
        if (schema.has("minProperties")) {
            int minProps = schema.get("minProperties").asInt();
            if (obj.size() < minProps) {
                result.addError("Map has " + obj.size() + " entries, minimum is " + minProps, path);
            }
        }

        if (schema.has("maxProperties")) {
            int maxProps = schema.get("maxProperties").asInt();
            if (obj.size() > maxProps) {
                result.addError("Map has " + obj.size() + " entries, maximum is " + maxProps, path);
            }
        }
    }

    private void validateTuple(JsonNode instance, ObjectNode schema, JsonNode rootSchema,
                               ValidationResult result, String path, int depth) {
        if (!instance.isArray()) {
            result.addError("Value must be an array (tuple)", path);
            return;
        }

        ArrayNode arr = (ArrayNode) instance;

        // Handle JSON Structure tuple with "tuple" and "properties" keywords
        if (schema.has("tuple") && schema.get("tuple").isArray() && schema.has("properties")) {
            ArrayNode tupleOrder = (ArrayNode) schema.get("tuple");
            ObjectNode properties = (ObjectNode) schema.get("properties");
            
            // Check tuple length matches
            if (arr.size() != tupleOrder.size()) {
                result.addError("Tuple has " + arr.size() + " elements but expected " + tupleOrder.size(), path);
                return;
            }
            
            // Validate each element against its corresponding property schema
            for (int i = 0; i < tupleOrder.size(); i++) {
                String propName = tupleOrder.get(i).asText();
                if (properties.has(propName)) {
                    JsonNode propSchema = properties.get(propName);
                    if (i < arr.size()) {
                        validateInstance(arr.get(i), propSchema, rootSchema, result,
                                appendPath(path, String.valueOf(i)), depth + 1);
                    }
                } else {
                    result.addError("Tuple property '" + propName + "' not defined in properties", path);
                }
            }
            return;
        }

        // Validate prefixItems (JSON Schema style)
        if (schema.has("prefixItems") && schema.get("prefixItems").isArray()) {
            ArrayNode prefixArr = (ArrayNode) schema.get("prefixItems");
            for (int i = 0; i < prefixArr.size(); i++) {
                if (i < arr.size()) {
                    validateInstance(arr.get(i), prefixArr.get(i), rootSchema, result,
                            appendPath(path, String.valueOf(i)), depth + 1);
                }
            }

            // Check for additional items
            if (schema.has("items")) {
                JsonNode items = schema.get("items");
                if (items.isBoolean()) {
                    if (!items.asBoolean() && arr.size() > prefixArr.size()) {
                        result.addError("Tuple has " + arr.size() + " items but only " + prefixArr.size() + " are defined", path);
                    }
                } else if (items.isObject()) {
                    for (int i = prefixArr.size(); i < arr.size(); i++) {
                        validateInstance(arr.get(i), items, rootSchema, result,
                                appendPath(path, String.valueOf(i)), depth + 1);
                    }
                }
            }
        }
    }

    private void validateChoice(JsonNode instance, ObjectNode schema, JsonNode rootSchema,
                                ValidationResult result, String path, int depth) {
        if (!instance.isObject()) {
            result.addError("Value must be an object (choice)", path);
            return;
        }

        ObjectNode obj = (ObjectNode) instance;

        // Accept either "options" or "choices" keyword
        String optionsKey = schema.has("options") ? "options" : (schema.has("choices") ? "choices" : null);
        if (optionsKey == null || !schema.get(optionsKey).isObject()) {
            result.addError("Choice schema must have 'options' or 'choices'", path);
            return;
        }

        ObjectNode options = (ObjectNode) schema.get(optionsKey);

        // Get discriminator or selector
        String discriminator = schema.has("discriminator") ? schema.get("discriminator").asText() : null;
        String selector = schema.has("selector") ? schema.get("selector").asText() : null;
        String discProp = (discriminator != null && !discriminator.isEmpty()) ? discriminator 
                        : (selector != null && !selector.isEmpty()) ? selector : null;

        if (discProp != null) {
            // Use discriminator/selector property to determine type
            if (!obj.has(discProp)) {
                result.addError("Choice requires discriminator/selector property: " + discProp, path);
                return;
            }

            String discValue = obj.get(discProp).asText();
            if (discValue == null || discValue.isEmpty()) {
                result.addError("Discriminator/selector value must be a string", path);
                return;
            }

            if (!options.has(discValue)) {
                result.addError("Unknown choice option: " + discValue, path);
                return;
            }

            validateInstance(instance, options.get(discValue), rootSchema, result, path, depth + 1);
        } else {
            // No discriminator - check if this is a tagged choice format
            // Tagged format: single-key object where key is the option name
            List<String> objKeys = new ArrayList<>();
            Iterator<String> fieldNames = obj.fieldNames();
            while (fieldNames.hasNext()) {
                objKeys.add(fieldNames.next());
            }
            
            // Check for tagged union format: instance has a key that matches a choice option
            String matchedTag = null;
            for (String key : objKeys) {
                if (options.has(key)) {
                    matchedTag = key;
                    break;
                }
            }
            
            if (matchedTag != null) {
                // This is a tagged choice - validate the value against the option schema
                JsonNode optionSchema = options.get(matchedTag);
                JsonNode tagValue = obj.get(matchedTag);
                validateInstance(tagValue, optionSchema, rootSchema, result, appendPath(path, matchedTag), depth + 1);
                return;
            }
            
            // Try to match one of the options directly (inline/untagged union)
            int matchCount = 0;
            Iterator<Map.Entry<String, JsonNode>> optFields = options.fields();
            while (optFields.hasNext()) {
                Map.Entry<String, JsonNode> opt = optFields.next();
                ValidationResult optResult = new ValidationResult();
                validateInstance(instance, opt.getValue(), rootSchema, optResult, path, depth + 1);
                if (optResult.isValid()) {
                    matchCount++;
                }
            }

            if (matchCount == 0) {
                result.addError("Value does not match any choice option", path);
            } else if (matchCount > 1) {
                result.addError("Value matches " + matchCount + " choice options (should match exactly one)", path);
            }
        }
    }

    private void validateDate(JsonNode instance, ValidationResult result, String path) {
        if (!instance.isTextual()) {
            result.addError("Date must be a string", path);
            return;
        }

        try {
            LocalDate.parse(instance.asText());
        } catch (DateTimeParseException e) {
            result.addError("Invalid date format: " + instance.asText(), path);
        }
    }

    private void validateTime(JsonNode instance, ValidationResult result, String path) {
        if (!instance.isTextual()) {
            result.addError("Time must be a string", path);
            return;
        }

        try {
            LocalTime.parse(instance.asText());
        } catch (DateTimeParseException e) {
            result.addError("Invalid time format: " + instance.asText(), path);
        }
    }

    private void validateDateTime(JsonNode instance, ValidationResult result, String path) {
        if (!instance.isTextual()) {
            result.addError("DateTime must be a string", path);
            return;
        }

        String str = instance.asText();
        try {
            OffsetDateTime.parse(str);
        } catch (DateTimeParseException e) {
            try {
                Instant.parse(str);
            } catch (DateTimeParseException e2) {
                result.addError("Invalid datetime format: " + str, path);
            }
        }
    }

    private void validateDuration(JsonNode instance, ValidationResult result, String path) {
        if (!instance.isTextual()) {
            result.addError("Duration must be a string", path);
            return;
        }

        String str = instance.asText();
        try {
            Duration.parse(str);
        } catch (DateTimeParseException e) {
            // Try ISO 8601 period format
            try {
                Period.parse(str);
            } catch (DateTimeParseException e2) {
                result.addError("Invalid duration format: " + str, path);
            }
        }
    }

    private void validateUuid(JsonNode instance, ValidationResult result, String path) {
        if (!instance.isTextual()) {
            result.addError("UUID must be a string", path);
            return;
        }

        try {
            UUID.fromString(instance.asText());
        } catch (IllegalArgumentException e) {
            result.addError("Invalid UUID format: " + instance.asText(), path);
        }
    }

    private void validateUri(JsonNode instance, ValidationResult result, String path) {
        if (!instance.isTextual()) {
            result.addError("URI must be a string", path);
            return;
        }

        String uriStr = instance.asText();
        try {
            URI uri = new URI(uriStr);
            // Require absolute URIs with a scheme
            if (uri.getScheme() == null) {
                result.addError("Invalid URI format (missing scheme): " + uriStr, path);
            }
        } catch (Exception e) {
            result.addError("Invalid URI format: " + uriStr, path);
        }
    }

    private void validateBinary(JsonNode instance, ValidationResult result, String path) {
        if (!instance.isTextual()) {
            result.addError("Binary must be a base64 string", path);
            return;
        }

        try {
            Base64.getDecoder().decode(instance.asText());
        } catch (IllegalArgumentException e) {
            result.addError("Invalid base64 encoding", path);
        }
    }

    private void validateJsonPointer(JsonNode instance, ValidationResult result, String path) {
        if (!instance.isTextual()) {
            result.addError("JSON Pointer must be a string", path);
            return;
        }

        String str = instance.asText();
        // JSON Pointer must be empty or start with /
        if (!str.isEmpty() && !str.startsWith("/")) {
            result.addError("Invalid JSON Pointer format: " + str, path);
        }
    }

    private void validateValidationKeywords(JsonNode instance, ObjectNode schema, ValidationResult result, String path) {
        // Only validate constraints here if there's no type constraint
        if (schema.has("type")) {
            return;
        }

        if (instance == null || instance.isNull()) return;

        // If instance is a number and schema has numeric constraints, validate them
        if (instance.isNumber()) {
            if (schema.has("minimum") || schema.has("maximum") ||
                    schema.has("exclusiveMinimum") || schema.has("exclusiveMaximum") ||
                    schema.has("multipleOf")) {
                validateNumericConstraints(BigDecimal.valueOf(instance.asDouble()), schema, result, path);
            }
        }

        // If instance is a string and schema has string constraints, validate them
        if (instance.isTextual()) {
            String str = instance.asText();
            if (schema.has("minLength") || schema.has("maxLength") ||
                    schema.has("pattern") || schema.has("format")) {
                if (schema.has("minLength")) {
                    int minLen = schema.get("minLength").asInt();
                    if (str.length() < minLen) {
                        result.addError("String length " + str.length() + " is less than minimum " + minLen, path);
                    }
                }
                if (schema.has("maxLength")) {
                    int maxLen = schema.get("maxLength").asInt();
                    if (str.length() > maxLen) {
                        result.addError("String length " + str.length() + " exceeds maximum " + maxLen, path);
                    }
                }
                if (schema.has("pattern")) {
                    String pattern = schema.get("pattern").asText();
                    try {
                        if (!Pattern.matches(pattern, str)) {
                            result.addError("String does not match pattern: " + pattern, path);
                        }
                    } catch (PatternSyntaxException e) {
                        result.addError("Invalid regex pattern: " + pattern, path);
                    }
                }
            }
        }
    }

    private JsonNode resolveRef(String reference, JsonNode rootSchema) {
        if (resolvedRefs.containsKey(reference)) {
            return resolvedRefs.get(reference);
        }

        JsonNode resolved = null;

        // Handle JSON Pointer references
        if (reference.startsWith("#/")) {
            String pointer = reference.substring(1); // Remove leading #
            resolved = resolveJsonPointer(pointer, rootSchema);
        } else if (reference.startsWith("#")) {
            // Anchor reference
            String anchor = reference.substring(1);
            resolved = findAnchor(anchor, rootSchema);
        } else if (options.getReferenceResolver() != null) {
            resolved = options.getReferenceResolver().apply(reference);
        }

        if (resolved != null) {
            resolvedRefs.put(reference, resolved);
        }

        return resolved;
    }

    private JsonNode resolveJsonPointer(String pointer, JsonNode node) {
        if (pointer.isEmpty() || pointer.equals("/")) {
            return node;
        }

        String[] parts = pointer.split("/");
        JsonNode current = node;

        for (int i = 1; i < parts.length; i++) { // Skip empty first part
            if (current == null) return null;

            // Unescape JSON Pointer tokens
            String part = parts[i].replace("~1", "/").replace("~0", "~");

            if (current.isObject()) {
                current = current.get(part);
            } else if (current.isArray()) {
                try {
                    int index = Integer.parseInt(part);
                    if (index >= 0 && index < current.size()) {
                        current = current.get(index);
                    } else {
                        return null;
                    }
                } catch (NumberFormatException e) {
                    return null;
                }
            } else {
                return null;
            }
        }

        return current;
    }

    private JsonNode findAnchor(String anchor, JsonNode node) {
        if (node.isObject()) {
            if (node.has("$anchor") && anchor.equals(node.get("$anchor").asText())) {
                return node;
            }
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                JsonNode found = findAnchor(anchor, fields.next().getValue());
                if (found != null) return found;
            }
        } else if (node.isArray()) {
            for (JsonNode item : node) {
                JsonNode found = findAnchor(anchor, item);
                if (found != null) return found;
            }
        }
        return null;
    }

    private boolean jsonNodeEquals(JsonNode a, JsonNode b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        return a.equals(b);
    }

    private static String appendPath(String basePath, String segment) {
        if (basePath.isEmpty()) {
            return "/" + segment;
        }
        return basePath + "/" + segment;
    }
}
