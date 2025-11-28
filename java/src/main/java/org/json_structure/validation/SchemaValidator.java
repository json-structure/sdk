// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Validates JSON Structure schema documents.
 */
public final class SchemaValidator {

    /**
     * The valid primitive types in JSON Structure.
     * These types are defined in the JSON Structure Core specification.
     */
    public static final Set<String> PRIMITIVE_TYPES = Set.of(
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
    );

    /**
     * The numeric types for which numeric constraints apply.
     */
    public static final Set<String> NUMERIC_TYPES = Set.of(
            "number", "integer", "double", "float",
            "int8", "int16", "int32", "int64", "int128",
            "uint8", "uint16", "uint32", "uint64", "uint128",
            "float8", "decimal"
    );

    /**
     * The valid compound types in JSON Structure.
     */
    public static final Set<String> COMPOUND_TYPES = Set.of(
            "object", "array", "set", "map", "tuple", "choice", "any"
    );

    /**
     * All valid type names.
     */
    public static final Set<String> ALL_TYPES;

    /**
     * Valid top-level schema keywords.
     */
    public static final Set<String> SCHEMA_KEYWORDS = Set.of(
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
    );

    private static final Pattern NAMESPACE_PATTERN = Pattern.compile(
            "^[a-zA-Z][a-zA-Z0-9]*(\\.[a-zA-Z][a-zA-Z0-9]*)*$");

    private static final Pattern IDENTIFIER_PATTERN = Pattern.compile(
            "^[a-zA-Z_][a-zA-Z0-9_]*$");

    private final ValidationOptions options;
    private final ObjectMapper objectMapper;
    private Set<String> definedRefs; // Track defined $defs/$definitions for $ref validation
    private Set<String> importNamespaces; // Track namespaces with $import/$importdefs
    private JsonSourceLocator sourceLocator; // For source location tracking

    static {
        Set<String> allTypes = new HashSet<>(PRIMITIVE_TYPES);
        allTypes.addAll(COMPOUND_TYPES);
        ALL_TYPES = Set.copyOf(allTypes);
    }

    /**
     * Creates a new SchemaValidator with default options.
     */
    public SchemaValidator() {
        this(ValidationOptions.DEFAULT);
    }

    /**
     * Creates a new SchemaValidator with the specified options.
     *
     * @param options the validation options
     */
    public SchemaValidator(ValidationOptions options) {
        this.options = options != null ? options : ValidationOptions.DEFAULT;
        this.objectMapper = new ObjectMapper();
    }

    /**
     * Validates a JSON Structure schema document.
     *
     * @param schema the schema node to validate
     * @return the validation result
     */
    public ValidationResult validate(JsonNode schema) {
        sourceLocator = null; // No source text available
        return validateCore(schema);
    }

    /**
     * Validates a JSON Structure schema document from a JSON string.
     *
     * @param json the JSON string containing the schema
     * @return the validation result
     */
    public ValidationResult validate(String json) {
        if (json == null) {
            return ValidationResult.failure("Schema cannot be null");
        }
        try {
            JsonNode schema = objectMapper.readTree(json);
            sourceLocator = new JsonSourceLocator(json);
            return validateCore(schema);
        } catch (JsonProcessingException e) {
            return ValidationResult.failure("Failed to parse JSON: " + e.getMessage());
        }
    }

    private ValidationResult validateCore(JsonNode schema) {
        ValidationResult result = new ValidationResult();

        if (schema == null) {
            addError(result, ErrorCodes.SCHEMA_NULL, "Schema cannot be null", "");
            return result;
        }

        // Collect all defined references first for $ref validation
        definedRefs = collectDefinedRefs(schema);
        
        // Collect namespaces with $import/$importdefs for lenient $ref validation
        importNamespaces = collectImportNamespaces(schema);
        
        validateSchemaCore(schema, result, "", 0, new HashSet<>());
        return result;
    }

    /**
     * Adds an error to the result with source location.
     */
    private void addError(ValidationResult result, String code, String message, String path) {
        JsonLocation location = sourceLocator != null ? sourceLocator.getLocation(path) : JsonLocation.UNKNOWN;
        result.addError(new ValidationError(code, message, path, ValidationSeverity.ERROR, location, null));
    }

    /**
     * Collects all defined references ($defs and definitions) from the schema.
     */
    private Set<String> collectDefinedRefs(JsonNode schema) {
        Set<String> refs = new HashSet<>();
        collectDefinedRefsRecursive(schema, "#", refs);
        return refs;
    }

    private void collectDefinedRefsRecursive(JsonNode node, String path, Set<String> refs) {
        if (!node.isObject()) return;
        
        if (node.has("$defs") && node.get("$defs").isObject()) {
            Iterator<String> names = node.get("$defs").fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                String refPath = path + "/$defs/" + name;
                refs.add(refPath);
                collectDefinedRefsRecursive(node.get("$defs").get(name), refPath, refs);
            }
        }
        
        if (node.has("definitions") && node.get("definitions").isObject()) {
            Iterator<String> names = node.get("definitions").fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                String refPath = path + "/definitions/" + name;
                refs.add(refPath);
                collectDefinedRefsRecursive(node.get("definitions").get(name), refPath, refs);
            }
        }
    }

    /**
     * Collects namespaces that have $import or $importdefs directives.
     * References into these namespaces may be valid even if not locally defined.
     */
    private Set<String> collectImportNamespaces(JsonNode schema) {
        Set<String> namespaces = new HashSet<>();
        collectImportNamespacesRecursive(schema, "#", namespaces);
        return namespaces;
    }

    private void collectImportNamespacesRecursive(JsonNode node, String path, Set<String> namespaces) {
        if (!node.isObject()) return;
        
        // Check if this node has $import or $importdefs - if so, it's an import namespace
        if (node.has("$import") || node.has("$importdefs")) {
            namespaces.add(path);
        }
        
        // Recurse into $defs
        if (node.has("$defs") && node.get("$defs").isObject()) {
            Iterator<String> names = node.get("$defs").fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                String defPath = path + "/$defs/" + name;
                collectImportNamespacesRecursive(node.get("$defs").get(name), defPath, namespaces);
            }
        }
        
        // Recurse into definitions
        if (node.has("definitions") && node.get("definitions").isObject()) {
            Iterator<String> names = node.get("definitions").fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                String defPath = path + "/definitions/" + name;
                collectImportNamespacesRecursive(node.get("definitions").get(name), defPath, namespaces);
            }
        }
    }

    private void validateSchemaCore(JsonNode node, ValidationResult result, String path, int depth, Set<String> visitedRefs) {
        if (depth > options.getMaxValidationDepth()) {
            addError(result, ErrorCodes.SCHEMA_MAX_DEPTH_EXCEEDED, "Maximum validation depth (" + options.getMaxValidationDepth() + ") exceeded", path);
            return;
        }

        if (options.isStopOnFirstError() && !result.isValid()) {
            return;
        }

        // Schema must be boolean or object
        if (node.isBoolean()) {
            // Boolean schemas are valid (true = allow all, false = deny all)
            return;
        }

        if (!node.isObject()) {
            addError(result, ErrorCodes.SCHEMA_INVALID_TYPE, "Schema must be a boolean or object", path);
            return;
        }

        ObjectNode schema = (ObjectNode) node;

        // Validate $schema if present
        if (schema.has("$schema")) {
            JsonNode schemaValue = schema.get("$schema");
            if (!schemaValue.isTextual()) {
                addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, "$schema must be a string", appendPath(path, "$schema"));
            }
        }

        // Validate $id if present
        if (schema.has("$id")) {
            validateStringProperty(schema.get("$id"), "$id", path, result);
        }

        // Validate $ref if present - check if target exists
        if (schema.has("$ref")) {
            JsonNode refNode = schema.get("$ref");
            validateReference(refNode, "$ref", path, result);
            if (refNode.isTextual()) {
                String refStr = refNode.asText();
                // Check if reference target exists
                if (refStr.startsWith("#/")) {
                    if (!definedRefs.contains(refStr)) {
                        // Check if this ref points into an import namespace
                        // (e.g., #/definitions/FinanceTypes/PaymentMethod where FinanceTypes has $importdefs)
                        boolean isImportedRef = false;
                        for (String importNs : importNamespaces) {
                            if (refStr.startsWith(importNs + "/")) {
                                isImportedRef = true;
                                break;
                            }
                        }
                        if (!isImportedRef) {
                            addError(result, ErrorCodes.SCHEMA_REF_NOT_FOUND, "$ref target does not exist: " + refStr, appendPath(path, "$ref"));
                        }
                    } else {
                        // Check for circular reference
                        if (visitedRefs.contains(refStr)) {
                            addError(result, ErrorCodes.SCHEMA_REF_CIRCULAR, "Circular reference detected: " + refStr, appendPath(path, "$ref"));
                        }
                    }
                }
            }
        }

        // Validate $anchor if present
        if (schema.has("$anchor")) {
            validateIdentifier(schema.get("$anchor"), "$anchor", path, result);
        }

        // Validate $defs if present
        if (schema.has("$defs")) {
            validateDefinitions(schema.get("$defs"), "$defs", path, result, depth, visitedRefs);
        }

        // Validate definitions if present (alternate name for $defs)
        if (schema.has("definitions")) {
            validateDefinitions(schema.get("definitions"), "definitions", path, result, depth, visitedRefs);
        }

        // Validate $import if present
        if (schema.has("$import")) {
            validateImport(schema.get("$import"), "$import", path, result);
        }

        // Validate $importdefs if present
        if (schema.has("$importdefs")) {
            validateImport(schema.get("$importdefs"), "$importdefs", path, result);
        }

        // Validate $extends if present
        if (schema.has("$extends")) {
            validateReference(schema.get("$extends"), "$extends", path, result);
        }

        // Get type for constraint validation
        String typeStr = null;
        
        // Validate type if present
        if (schema.has("type")) {
            JsonNode typeValue = schema.get("type");
            validateType(typeValue, path, result);
            typeStr = getTypeString(typeValue);

            // Type-specific validation
            if (typeStr != null) {
                switch (typeStr) {
                    case "object" -> validateObjectSchema(schema, path, result, depth, visitedRefs);
                    case "array", "set" -> validateArraySchema(schema, path, result, depth, visitedRefs);
                    case "tuple" -> validateTupleSchema(schema, path, result, depth, visitedRefs);
                    case "map" -> validateMapSchema(schema, path, result, depth, visitedRefs);
                    case "choice" -> validateChoiceSchema(schema, path, result, depth, visitedRefs);
                    case "string" -> validateStringSchema(schema, path, result);
                    default -> {
                        if (isNumericType(typeStr)) {
                            validateNumericSchema(schema, path, result);
                        }
                    }
                }
            }
        }
        
        // Validate type-constraint compatibility
        validateTypeConstraintCompatibility(schema, typeStr, path, result);

        // Validate enum if present
        if (schema.has("enum")) {
            validateEnum(schema.get("enum"), path, result);
        }

        // Validate conditional composition keywords
        validateConditionalComposition(schema, path, result, depth, visitedRefs);

        // Validate altnames if present
        if (schema.has("altnames")) {
            validateAltnames(schema.get("altnames"), path, result);
        }
        
        // A schema must have at least one schema-defining keyword (type, $ref, allOf, anyOf, oneOf, $extends)
        // unless it only defines $defs/definitions (a pure definition container) or uses conditional keywords
        boolean hasSchemaKeyword = schema.has("type") || schema.has("$ref") || 
                                   schema.has("allOf") || schema.has("anyOf") || 
                                   schema.has("oneOf") || schema.has("$extends") ||
                                   schema.has("enum") || schema.has("const") ||
                                   schema.has("if") || schema.has("properties") ||
                                   schema.has("items") || schema.has("prefixItems") ||
                                   schema.has("not") || schema.has("$import") ||
                                   schema.has("$importdefs");
        boolean isPureDefContainer = (schema.has("$defs") || schema.has("definitions")) &&
                                     !schema.has("properties") && !schema.has("items") &&
                                     !schema.has("prefixItems") && !schema.has("values");
        
        if (!hasSchemaKeyword && !isPureDefContainer) {
            addError(result, ErrorCodes.SCHEMA_MISSING_TYPE, "Schema must have a 'type', '$ref', 'allOf', 'anyOf', 'oneOf', or '$extends' keyword", path);
        }
    }
    
    /**
     * Validates that constraints are compatible with the declared type.
     */
    private void validateTypeConstraintCompatibility(ObjectNode schema, String typeStr, String path, ValidationResult result) {
        if (typeStr == null) return;
        
        boolean isNumeric = NUMERIC_TYPES.contains(typeStr);
        boolean isString = "string".equals(typeStr);
        boolean isArray = "array".equals(typeStr) || "set".equals(typeStr);
        
        // Numeric constraints on non-numeric types
        if (!isNumeric) {
            if (schema.has("minimum")) {
                addError(result, ErrorCodes.SCHEMA_CONSTRAINT_INVALID_FOR_TYPE, "'minimum' constraint is only valid for numeric types, not '" + typeStr + "'", 
                        appendPath(path, "minimum"));
            }
            if (schema.has("maximum")) {
                addError(result, ErrorCodes.SCHEMA_CONSTRAINT_INVALID_FOR_TYPE, "'maximum' constraint is only valid for numeric types, not '" + typeStr + "'", 
                        appendPath(path, "maximum"));
            }
            if (schema.has("exclusiveMinimum")) {
                addError(result, ErrorCodes.SCHEMA_CONSTRAINT_INVALID_FOR_TYPE, "'exclusiveMinimum' constraint is only valid for numeric types, not '" + typeStr + "'", 
                        appendPath(path, "exclusiveMinimum"));
            }
            if (schema.has("exclusiveMaximum")) {
                addError(result, ErrorCodes.SCHEMA_CONSTRAINT_INVALID_FOR_TYPE, "'exclusiveMaximum' constraint is only valid for numeric types, not '" + typeStr + "'", 
                        appendPath(path, "exclusiveMaximum"));
            }
            if (schema.has("multipleOf")) {
                addError(result, ErrorCodes.SCHEMA_CONSTRAINT_INVALID_FOR_TYPE, "'multipleOf' constraint is only valid for numeric types, not '" + typeStr + "'", 
                        appendPath(path, "multipleOf"));
            }
        }
        
        // String constraints on non-string types
        if (!isString) {
            if (schema.has("minLength")) {
                addError(result, ErrorCodes.SCHEMA_CONSTRAINT_INVALID_FOR_TYPE, "'minLength' constraint is only valid for string type, not '" + typeStr + "'", 
                        appendPath(path, "minLength"));
            }
            if (schema.has("maxLength")) {
                addError(result, ErrorCodes.SCHEMA_CONSTRAINT_INVALID_FOR_TYPE, "'maxLength' constraint is only valid for string type, not '" + typeStr + "'", 
                        appendPath(path, "maxLength"));
            }
            if (schema.has("pattern")) {
                addError(result, ErrorCodes.SCHEMA_CONSTRAINT_INVALID_FOR_TYPE, "'pattern' constraint is only valid for string type, not '" + typeStr + "'", 
                        appendPath(path, "pattern"));
            }
        }
        
        // Array constraints on non-array types
        if (!isArray && !"tuple".equals(typeStr)) {
            if (schema.has("minItems")) {
                addError(result, ErrorCodes.SCHEMA_CONSTRAINT_INVALID_FOR_TYPE, "'minItems' constraint is only valid for array/set/tuple types, not '" + typeStr + "'", 
                        appendPath(path, "minItems"));
            }
            if (schema.has("maxItems")) {
                addError(result, ErrorCodes.SCHEMA_CONSTRAINT_INVALID_FOR_TYPE, "'maxItems' constraint is only valid for array/set/tuple types, not '" + typeStr + "'", 
                        appendPath(path, "maxItems"));
            }
        }
    }

    private void validateStringProperty(JsonNode value, String keyword, String path, ValidationResult result) {
        if (value == null || !value.isTextual()) {
            addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, keyword + " must be a string", appendPath(path, keyword));
        }
    }

    private void validateIdentifier(JsonNode value, String keyword, String path, ValidationResult result) {
        if (value == null || !value.isTextual()) {
            addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, keyword + " must be a string", appendPath(path, keyword));
            return;
        }

        String str = value.asText();
        if (!IDENTIFIER_PATTERN.matcher(str).matches()) {
            addError(result, ErrorCodes.SCHEMA_NAME_INVALID, keyword + " must be a valid identifier (start with letter or underscore, contain only letters, digits, underscores)",
                    appendPath(path, keyword));
        }
    }

    private void validateReference(JsonNode value, String keyword, String path, ValidationResult result) {
        if (value == null || !value.isTextual()) {
            addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, keyword + " must be a string", appendPath(path, keyword));
            return;
        }

        String str = value.asText();
        if (str.isBlank()) {
            addError(result, ErrorCodes.SCHEMA_KEYWORD_EMPTY, keyword + " cannot be empty", appendPath(path, keyword));
        }
    }

    private void validateImport(JsonNode value, String keyword, String path, ValidationResult result) {
        if (value.isTextual()) {
            return; // Single import string is valid
        }

        if (value.isArray()) {
            for (JsonNode item : value) {
                if (!item.isTextual()) {
                    addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, keyword + " array items must be strings", appendPath(path, keyword));
                    break;
                }
            }
            return;
        }

        if (value.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = value.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                if (!field.getValue().isTextual()) {
                    addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, keyword + " object values must be strings",
                            appendPath(path, keyword + "/" + field.getKey()));
                }
            }
            return;
        }

        addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, keyword + " must be a string, array, or object", appendPath(path, keyword));
    }

    private void validateDefinitions(JsonNode value, String keyword, String path, ValidationResult result, int depth, Set<String> visitedRefs) {
        if (!value.isObject()) {
            addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, keyword + " must be an object", appendPath(path, keyword));
            return;
        }

        Iterator<Map.Entry<String, JsonNode>> fields = value.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            String defPath = appendPath(path, keyword + "/" + field.getKey());
            // Track this definition for circular reference detection
            Set<String> newVisited = new HashSet<>(visitedRefs);
            newVisited.add("#" + defPath);
            validateDefinitionOrNamespace(field.getValue(), defPath, result, depth + 1, newVisited);
        }
    }

    private void validateDefinitionOrNamespace(JsonNode value, String path, ValidationResult result, int depth, Set<String> visitedRefs) {
        if (value.isObject()) {
            ObjectNode obj = (ObjectNode) value;
            // If it has schema keywords, it's a schema
            if (obj.has("type") || obj.has("$ref") || obj.has("allOf") ||
                    obj.has("anyOf") || obj.has("oneOf") || obj.has("properties") ||
                    obj.has("items") || obj.has("enum") || obj.has("const") ||
                    obj.has("$extends") || obj.has("abstract")) {
                validateSchemaCore(value, result, path, depth, visitedRefs);
            } else if (obj.has("$import") || obj.has("$importdefs")) {
                // This is an import container
                if (obj.has("$import")) {
                    validateImport(obj.get("$import"), "$import", path, result);
                }
                if (obj.has("$importdefs")) {
                    validateImport(obj.get("$importdefs"), "$importdefs", path, result);
                }
            } else {
                // Otherwise, it might be a namespace containing nested definitions
                Iterator<Map.Entry<String, JsonNode>> fields = obj.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> field = fields.next();
                    validateDefinitionOrNamespace(field.getValue(),
                            appendPath(path, field.getKey()), result, depth + 1, visitedRefs);
                }
            }
        } else {
            validateSchemaCore(value, result, path, depth, visitedRefs);
        }
    }

    private void validateType(JsonNode value, String path, ValidationResult result) {
        String typePath = appendPath(path, "type");

        if (value.isTextual()) {
            String typeStr = value.asText();
            if (!ALL_TYPES.contains(typeStr) && !typeStr.contains(":")) {
                addError(result, ErrorCodes.SCHEMA_TYPE_INVALID, "Invalid type: '" + typeStr + "'", typePath);
            }
            return;
        }

        if (value.isArray()) {
            ArrayNode arr = (ArrayNode) value;
            if (arr.isEmpty()) {
                addError(result, ErrorCodes.SCHEMA_TYPE_ARRAY_EMPTY, "type array cannot be empty", typePath);
                return;
            }

            for (JsonNode item : arr) {
                if (item.isTextual()) {
                    String itemType = item.asText();
                    if (!ALL_TYPES.contains(itemType) && !itemType.contains(":")) {
                        addError(result, ErrorCodes.SCHEMA_TYPE_INVALID, "Invalid type in array: '" + itemType + "'", typePath);
                    }
                } else if (item.isObject()) {
                    // Type union can include $ref objects
                    if (item.has("$ref")) {
                        validateReference(item.get("$ref"), "$ref", typePath, result);
                    } else {
                        addError(result, ErrorCodes.SCHEMA_TYPE_OBJECT_MISSING_REF, "type array objects must contain $ref", typePath);
                    }
                } else {
                    addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, "type array items must be strings or objects with $ref", typePath);
                }
            }
            return;
        }

        // JSON Structure allows type to be an object with $ref
        if (value.isObject()) {
            if (value.has("$ref")) {
                validateReference(value.get("$ref"), "$ref", typePath, result);
            } else {
                addError(result, ErrorCodes.SCHEMA_TYPE_OBJECT_MISSING_REF, "type object must contain $ref", typePath);
            }
            return;
        }

        addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, "type must be a string, array of strings, or object with $ref", typePath);
    }

    private String getTypeString(JsonNode value) {
        if (value != null && value.isTextual()) {
            return value.asText();
        }
        return null;
    }

    private boolean isNumericType(String type) {
        return type != null && (
                type.equals("number") ||
                        type.startsWith("int") || type.startsWith("uint") ||
                        type.startsWith("float") || type.startsWith("decimal")
        );
    }

    private void validateObjectSchema(ObjectNode schema, String path, ValidationResult result, int depth, Set<String> visitedRefs) {
        // Validate properties
        if (schema.has("properties")) {
            JsonNode props = schema.get("properties");
            if (!props.isObject()) {
                addError(result, ErrorCodes.SCHEMA_PROPERTIES_NOT_OBJECT, "properties must be an object", appendPath(path, "properties"));
            } else {
                Iterator<Map.Entry<String, JsonNode>> fields = props.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> field = fields.next();
                    validateSchemaCore(field.getValue(),
                            result, appendPath(path, "properties/" + field.getKey()), depth + 1, visitedRefs);
                }
            }
        }

        // Validate additionalProperties
        if (schema.has("additionalProperties")) {
            JsonNode additional = schema.get("additionalProperties");
            if (additional.isBoolean()) {
                // Boolean is valid
            } else if (additional.isObject()) {
                validateSchemaCore(additional, result, appendPath(path, "additionalProperties"), depth + 1, visitedRefs);
            } else {
                addError(result, ErrorCodes.SCHEMA_ADDITIONAL_PROPERTIES_INVALID, "additionalProperties must be a boolean or schema",
                        appendPath(path, "additionalProperties"));
            }
        }

        // Validate required
        if (schema.has("required")) {
            JsonNode required = schema.get("required");
            if (!required.isArray()) {
                addError(result, ErrorCodes.SCHEMA_REQUIRED_NOT_ARRAY, "required must be an array", appendPath(path, "required"));
            } else {
                Set<String> definedProperties = new HashSet<>();
                if (schema.has("properties") && schema.get("properties").isObject()) {
                    Iterator<String> propNames = schema.get("properties").fieldNames();
                    while (propNames.hasNext()) {
                        definedProperties.add(propNames.next());
                    }
                }
                
                for (JsonNode item : required) {
                    if (!item.isTextual()) {
                        addError(result, ErrorCodes.SCHEMA_REQUIRED_ITEM_NOT_STRING, "required array items must be strings", appendPath(path, "required"));
                        break;
                    }
                    // Check if required property is defined in properties
                    String reqProp = item.asText();
                    if (!definedProperties.isEmpty() && !definedProperties.contains(reqProp)) {
                        addError(result, ErrorCodes.SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED, "required property '" + reqProp + "' is not defined in properties", 
                                appendPath(path, "required"));
                    }
                }
            }
        }

        // Validate minProperties/maxProperties
        validateNonNegativeInteger(schema, "minProperties", path, result);
        validateNonNegativeInteger(schema, "maxProperties", path, result);
    }

    private void validateArraySchema(ObjectNode schema, String path, ValidationResult result, int depth, Set<String> visitedRefs) {
        // Array type requires items definition
        if (!schema.has("items")) {
            addError(result, ErrorCodes.SCHEMA_ARRAY_MISSING_ITEMS, "array type requires 'items' definition", path);
        } else {
            validateSchemaCore(schema.get("items"), result, appendPath(path, "items"), depth + 1, visitedRefs);
        }

        // Validate minItems/maxItems
        validateNonNegativeInteger(schema, "minItems", path, result);
        validateNonNegativeInteger(schema, "maxItems", path, result);
        
        // Check minItems <= maxItems
        if (schema.has("minItems") && schema.has("maxItems")) {
            long minItems = schema.get("minItems").asLong();
            long maxItems = schema.get("maxItems").asLong();
            if (minItems > maxItems) {
                addError(result, ErrorCodes.SCHEMA_MIN_GREATER_THAN_MAX, "minItems (" + minItems + ") cannot exceed maxItems (" + maxItems + ")", path);
            }
        }

        // Validate uniqueItems
        if (schema.has("uniqueItems")) {
            if (!schema.get("uniqueItems").isBoolean()) {
                addError(result, ErrorCodes.SCHEMA_UNIQUE_ITEMS_NOT_BOOLEAN, "uniqueItems must be a boolean", appendPath(path, "uniqueItems"));
            }
        }

        // Validate contains
        if (schema.has("contains")) {
            validateSchemaCore(schema.get("contains"), result, appendPath(path, "contains"), depth + 1, visitedRefs);
        }

        validateNonNegativeInteger(schema, "minContains", path, result);
        validateNonNegativeInteger(schema, "maxContains", path, result);
    }

    private void validateTupleSchema(ObjectNode schema, String path, ValidationResult result, int depth, Set<String> visitedRefs) {
        // Tuple type can use either:
        // 1. prefixItems (JSON Schema style)
        // 2. tuple + properties (JSON Structure style)
        boolean hasPrefixItems = schema.has("prefixItems");
        boolean hasTupleKeyword = schema.has("tuple") && schema.has("properties");
        
        if (!hasPrefixItems && !hasTupleKeyword) {
            addError(result, ErrorCodes.SCHEMA_TUPLE_MISSING_PREFIX_ITEMS, "tuple type requires 'prefixItems' or 'tuple' with 'properties' definition", path);
            return;
        }
        
        if (hasPrefixItems) {
            JsonNode prefixItems = schema.get("prefixItems");
            if (!prefixItems.isArray()) {
                addError(result, ErrorCodes.SCHEMA_PREFIX_ITEMS_NOT_ARRAY, "prefixItems must be an array", appendPath(path, "prefixItems"));
            } else {
                ArrayNode arr = (ArrayNode) prefixItems;
                for (int i = 0; i < arr.size(); i++) {
                    validateSchemaCore(arr.get(i), result, appendPath(path, "prefixItems/" + i), depth + 1, visitedRefs);
                }
            }
        }
        
        if (hasTupleKeyword) {
            JsonNode tupleNode = schema.get("tuple");
            if (!tupleNode.isArray()) {
                addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, "tuple must be an array of property names", appendPath(path, "tuple"));
            } else {
                // Validate that all items in tuple array refer to valid properties
                ObjectNode properties = (ObjectNode) schema.get("properties");
                for (JsonNode item : tupleNode) {
                    if (!item.isTextual()) {
                        addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, "tuple array must contain strings", appendPath(path, "tuple"));
                    } else {
                        String propName = item.asText();
                        if (!properties.has(propName)) {
                            addError(result, ErrorCodes.SCHEMA_REF_NOT_FOUND, "tuple references undefined property: " + propName, appendPath(path, "tuple"));
                        }
                    }
                }
            }
        }

        // Validate items (for additional items after prefixItems)
        if (schema.has("items")) {
            JsonNode items = schema.get("items");
            if (items.isBoolean()) {
                // Boolean is valid
            } else if (items.isObject()) {
                validateSchemaCore(items, result, appendPath(path, "items"), depth + 1, visitedRefs);
            } else {
                addError(result, ErrorCodes.SCHEMA_ITEMS_INVALID_FOR_TUPLE, "items must be a boolean or schema for tuple type", appendPath(path, "items"));
            }
        }
    }

    private void validateMapSchema(ObjectNode schema, String path, ValidationResult result, int depth, Set<String> visitedRefs) {
        // Map type requires values definition
        if (!schema.has("values")) {
            addError(result, ErrorCodes.SCHEMA_MAP_MISSING_VALUES, "map type requires 'values' definition", path);
        } else {
            validateSchemaCore(schema.get("values"), result, appendPath(path, "values"), depth + 1, visitedRefs);
        }

        // Validate propertyNames
        if (schema.has("propertyNames")) {
            validateSchemaCore(schema.get("propertyNames"), result, appendPath(path, "propertyNames"), depth + 1, visitedRefs);
        }

        validateNonNegativeInteger(schema, "minProperties", path, result);
        validateNonNegativeInteger(schema, "maxProperties", path, result);
    }

    private void validateChoiceSchema(ObjectNode schema, String path, ValidationResult result, int depth, Set<String> visitedRefs) {
        // Choice type requires options, choices, or oneOf
        boolean hasOptions = schema.has("options");
        boolean hasChoices = schema.has("choices");
        boolean hasOneOf = schema.has("oneOf");
        if (!hasOptions && !hasChoices && !hasOneOf) {
            addError(result, ErrorCodes.SCHEMA_CHOICE_MISSING_OPTIONS, "choice type requires 'options', 'choices', or 'oneOf'", path);
        }

        // Validate options (legacy keyword)
        if (schema.has("options")) {
            JsonNode options = schema.get("options");
            if (!options.isObject()) {
                addError(result, ErrorCodes.SCHEMA_OPTIONS_NOT_OBJECT, "options must be an object", appendPath(path, "options"));
            } else {
                Iterator<Map.Entry<String, JsonNode>> fields = options.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> field = fields.next();
                    validateSchemaCore(field.getValue(),
                            result, appendPath(path, "options/" + field.getKey()), depth + 1, visitedRefs);
                }
            }
        }

        // Validate choices (current keyword)
        if (schema.has("choices")) {
            JsonNode choices = schema.get("choices");
            if (!choices.isObject()) {
                addError(result, ErrorCodes.SCHEMA_CHOICES_NOT_OBJECT, "choices must be an object", appendPath(path, "choices"));
            } else {
                Iterator<Map.Entry<String, JsonNode>> fields = choices.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> field = fields.next();
                    validateSchemaCore(field.getValue(),
                            result, appendPath(path, "choices/" + field.getKey()), depth + 1, visitedRefs);
                }
            }
        }

        // Validate discriminator
        if (schema.has("discriminator")) {
            validateStringProperty(schema.get("discriminator"), "discriminator", path, result);
        }

        // Validate selector
        if (schema.has("selector")) {
            validateStringProperty(schema.get("selector"), "selector", path, result);
        }
    }

    private void validateStringSchema(ObjectNode schema, String path, ValidationResult result) {
        validateNonNegativeInteger(schema, "minLength", path, result);
        validateNonNegativeInteger(schema, "maxLength", path, result);
        
        // Check minLength <= maxLength
        if (schema.has("minLength") && schema.has("maxLength")) {
            long minLength = schema.get("minLength").asLong();
            long maxLength = schema.get("maxLength").asLong();
            if (minLength > maxLength) {
                addError(result, ErrorCodes.SCHEMA_MIN_GREATER_THAN_MAX, "minLength (" + minLength + ") cannot exceed maxLength (" + maxLength + ")", path);
            }
        }

        // Validate pattern
        if (schema.has("pattern")) {
            JsonNode pattern = schema.get("pattern");
            if (!pattern.isTextual()) {
                addError(result, ErrorCodes.SCHEMA_PATTERN_NOT_STRING, "pattern must be a string", appendPath(path, "pattern"));
            } else {
                try {
                    Pattern.compile(pattern.asText());
                } catch (PatternSyntaxException e) {
                    addError(result, ErrorCodes.SCHEMA_PATTERN_INVALID, "pattern is not a valid regular expression: '" + pattern.asText() + "'",
                            appendPath(path, "pattern"));
                }
            }
        }

        // Validate format
        if (schema.has("format")) {
            validateStringProperty(schema.get("format"), "format", path, result);
        }

        // Validate contentEncoding
        if (schema.has("contentEncoding")) {
            validateStringProperty(schema.get("contentEncoding"), "contentEncoding", path, result);
        }

        // Validate contentMediaType
        if (schema.has("contentMediaType")) {
            validateStringProperty(schema.get("contentMediaType"), "contentMediaType", path, result);
        }
    }

    private void validateNumericSchema(ObjectNode schema, String path, ValidationResult result) {
        validateNumber(schema, "minimum", path, result);
        validateNumber(schema, "maximum", path, result);
        validateNumber(schema, "exclusiveMinimum", path, result);
        validateNumber(schema, "exclusiveMaximum", path, result);
        validatePositiveNumber(schema, "multipleOf", path, result);
        
        // Check minimum <= maximum
        if (schema.has("minimum") && schema.has("maximum")) {
            double minimum = schema.get("minimum").asDouble();
            double maximum = schema.get("maximum").asDouble();
            if (minimum > maximum) {
                addError(result, ErrorCodes.SCHEMA_MIN_GREATER_THAN_MAX, "minimum (" + minimum + ") cannot exceed maximum (" + maximum + ")", path);
            }
        }
    }

    private void validateEnum(JsonNode value, String path, ValidationResult result) {
        if (!value.isArray()) {
            addError(result, ErrorCodes.SCHEMA_ENUM_NOT_ARRAY, "enum must be an array", appendPath(path, "enum"));
            return;
        }

        ArrayNode arr = (ArrayNode) value;
        if (arr.isEmpty()) {
            addError(result, ErrorCodes.SCHEMA_ENUM_EMPTY, "enum array cannot be empty", appendPath(path, "enum"));
            return;
        }
        
        // Check for duplicates
        Set<String> seen = new HashSet<>();
        for (JsonNode item : arr) {
            String itemStr = item.toString(); // Use JSON representation for comparison
            if (!seen.add(itemStr)) {
                addError(result, ErrorCodes.SCHEMA_ENUM_DUPLICATES, "enum contains duplicate values", appendPath(path, "enum"));
                break;
            }
        }
    }

    private void validateConditionalComposition(ObjectNode schema, String path, ValidationResult result, int depth, Set<String> visitedRefs) {
        // Validate allOf
        if (schema.has("allOf")) {
            validateSchemaArray(schema.get("allOf"), "allOf", path, result, depth, visitedRefs);
        }

        // Validate anyOf
        if (schema.has("anyOf")) {
            validateSchemaArray(schema.get("anyOf"), "anyOf", path, result, depth, visitedRefs);
        }

        // Validate oneOf
        if (schema.has("oneOf")) {
            validateSchemaArray(schema.get("oneOf"), "oneOf", path, result, depth, visitedRefs);
        }

        // Validate not
        if (schema.has("not")) {
            validateSchemaCore(schema.get("not"), result, appendPath(path, "not"), depth + 1, visitedRefs);
        }

        // Validate if/then/else
        if (schema.has("if")) {
            validateSchemaCore(schema.get("if"), result, appendPath(path, "if"), depth + 1, visitedRefs);
        }

        if (schema.has("then")) {
            validateSchemaCore(schema.get("then"), result, appendPath(path, "then"), depth + 1, visitedRefs);
        }

        if (schema.has("else")) {
            validateSchemaCore(schema.get("else"), result, appendPath(path, "else"), depth + 1, visitedRefs);
        }
    }

    private void validateSchemaArray(JsonNode value, String keyword, String path, ValidationResult result, int depth, Set<String> visitedRefs) {
        String keywordPath = appendPath(path, keyword);

        if (!value.isArray()) {
            addError(result, ErrorCodes.SCHEMA_COMPOSITION_NOT_ARRAY, keyword + " must be an array", keywordPath);
            return;
        }

        ArrayNode arr = (ArrayNode) value;
        if (arr.isEmpty()) {
            addError(result, ErrorCodes.SCHEMA_COMPOSITION_EMPTY, keyword + " array cannot be empty", keywordPath);
            return;
        }

        for (int i = 0; i < arr.size(); i++) {
            validateSchemaCore(arr.get(i), result, appendPath(keywordPath, String.valueOf(i)), depth + 1, visitedRefs);
        }
    }

    private void validateAltnames(JsonNode value, String path, ValidationResult result) {
        if (!value.isObject()) {
            addError(result, ErrorCodes.SCHEMA_ALTNAMES_NOT_OBJECT, "altnames must be an object", appendPath(path, "altnames"));
            return;
        }

        Iterator<Map.Entry<String, JsonNode>> fields = value.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            if (!field.getValue().isTextual()) {
                addError(result, ErrorCodes.SCHEMA_ALTNAMES_VALUE_NOT_STRING, "altnames values must be strings",
                        appendPath(path, "altnames/" + field.getKey()));
            }
        }
    }

    private void validateNonNegativeInteger(ObjectNode schema, String keyword, String path, ValidationResult result) {
        if (schema.has(keyword)) {
            JsonNode value = schema.get(keyword);
            if (!value.isInt() && !value.isLong()) {
                addError(result, ErrorCodes.SCHEMA_INTEGER_CONSTRAINT_INVALID, keyword + " must be a non-negative integer", appendPath(path, keyword));
                return;
            }
            if (value.asLong() < 0) {
                addError(result, ErrorCodes.SCHEMA_INTEGER_CONSTRAINT_INVALID, keyword + " must be a non-negative integer", appendPath(path, keyword));
            }
        }
    }

    private void validateNumber(ObjectNode schema, String keyword, String path, ValidationResult result) {
        if (schema.has(keyword)) {
            JsonNode value = schema.get(keyword);
            if (!value.isNumber()) {
                addError(result, ErrorCodes.SCHEMA_NUMBER_CONSTRAINT_INVALID, keyword + " must be a number", appendPath(path, keyword));
            }
        }
    }

    private void validatePositiveNumber(ObjectNode schema, String keyword, String path, ValidationResult result) {
        if (schema.has(keyword)) {
            JsonNode value = schema.get(keyword);
            if (!value.isNumber()) {
                addError(result, ErrorCodes.SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID, keyword + " must be a positive number", appendPath(path, keyword));
                return;
            }
            if (value.asDouble() <= 0) {
                addError(result, ErrorCodes.SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID, keyword + " must be a positive number", appendPath(path, keyword));
            }
        }
    }

    private static String appendPath(String basePath, String segment) {
        if (basePath.isEmpty()) {
            return "/" + segment;
        }
        return basePath + "/" + segment;
    }
}
