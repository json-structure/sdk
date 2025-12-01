// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
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
            "$schema", "$id", "$ref", "definitions", "$import", "$importdefs",
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

    /**
     * Validation extension keywords that require the JSONStructureValidation feature.
     */
    private static final Set<String> VALIDATION_EXTENSION_KEYWORDS = Set.of(
            // Numeric validation
            "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
            // String validation
            "minLength", "maxLength", "pattern", "format",
            // Array/Set validation
            "minItems", "maxItems", "uniqueItems", "contains", "minContains", "maxContains",
            // Object/Map validation
            "minProperties", "maxProperties", "dependentRequired", "patternProperties", "propertyNames",
            // Map-specific
            "minEntries", "maxEntries", "patternKeys", "keyNames",
            // Content validation
            "contentEncoding", "contentMediaType",
            // Other
            "has", "default"
    );

    private final ValidationOptions options;
    private final ObjectMapper objectMapper;
    private Map<String, JsonNode> externalSchemaMap; // Map of import URI to schema for import processing
    private Set<String> definedRefs; // Track defined definitions for $ref validation
    private Set<String> importNamespaces; // Track namespaces with $import/$importdefs
    private JsonSourceLocator sourceLocator; // For source location tracking
    private JsonNode rootSchema; // Store root schema for resolving local refs
    private boolean validationExtensionEnabled; // Whether validation extension is enabled via $schema or $uses

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
        
        // Build external schema map and pre-process imports in external schemas
        this.externalSchemaMap = new HashMap<>();
        if (this.options.getExternalSchemas() != null) {
            // First pass: collect all external schemas
            for (Map.Entry<String, JsonNode> entry : this.options.getExternalSchemas().entrySet()) {
                externalSchemaMap.put(entry.getKey(), entry.getValue());
            }
            // Process imports in external schemas (may require multiple passes for chained imports)
            int maxPasses = 10;
            for (int pass = 0; pass < maxPasses; pass++) {
                boolean anyChanges = false;
                for (Map.Entry<String, JsonNode> entry : new HashMap<>(externalSchemaMap).entrySet()) {
                    if (processImportsInExternalSchema(entry.getValue())) {
                        anyChanges = true;
                    }
                }
                if (!anyChanges) break;
            }
        }
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

        // Store root schema for resolving local refs
        this.rootSchema = schema;
        
        // Detect if validation extensions are enabled
        this.validationExtensionEnabled = isValidationExtensionEnabled(schema);
        
        // Process imports if allowed (merge definitions from external schemas)
        if (options.isAllowImport() && schema.isObject()) {
            processImportsInExternalSchema(schema);
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
     * Checks if the validation extension is enabled via $schema or $uses.
     */
    private static boolean isValidationExtensionEnabled(JsonNode schema) {
        if (schema == null || !schema.isObject()) {
            return false;
        }

        // Check $schema - validation meta-schema enables all validation keywords
        JsonNode schemaNode = schema.get("$schema");
        if (schemaNode != null && schemaNode.isTextual()) {
            String schemaUri = schemaNode.asText();
            // Check for validation meta-schema
            if (schemaUri.contains("/meta/validation/")) {
                return true;
            }
        }

        // Check $uses for JSONStructureValidation
        JsonNode usesNode = schema.get("$uses");
        if (usesNode != null && usesNode.isArray()) {
            for (JsonNode useItem : usesNode) {
                if (useItem.isTextual() && "JSONStructureValidation".equals(useItem.asText())) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Adds a warning for validation extension keywords used without the extension enabled.
     */
    private void addExtensionKeywordWarning(ValidationResult result, String keyword, String path) {
        if (!options.isWarnOnUnusedExtensionKeywords()) {
            return;
        }

        if (validationExtensionEnabled) {
            return;
        }

        if (!VALIDATION_EXTENSION_KEYWORDS.contains(keyword)) {
            return;
        }

        String fullPath = path.isEmpty() ? keyword : path + "/" + keyword;
        JsonLocation location = sourceLocator != null ? sourceLocator.getLocation(fullPath) : JsonLocation.UNKNOWN;
        result.addWarning(
                ErrorCodes.SCHEMA_EXTENSION_KEYWORD_NOT_ENABLED,
                "Validation extension keyword '" + keyword + "' is used but validation extensions are not enabled. " +
                "Add '\"$uses\": [\"JSONStructureValidation\"]' to enable validation, or this keyword will be ignored.",
                fullPath,
                location);
    }

    /**
     * Resolves a local JSON pointer reference to the target node.
     * @param refStr The reference string (e.g., "#/definitions/MyType")
     * @return The target JsonNode, or null if not found
     */
    private JsonNode resolveLocalRef(String refStr) {
        if (rootSchema == null || !refStr.startsWith("#/")) {
            return null;
        }
        
        String path = refStr.substring(2); // Remove "#/"
        String[] segments = path.split("/");
        JsonNode current = rootSchema;
        
        for (String segment : segments) {
            if (current == null || !current.isObject()) {
                return null;
            }
            current = current.get(segment);
        }
        
        return current;
    }

    /**
     * Collects all defined references (definitions) from the schema.
     */
    private Set<String> collectDefinedRefs(JsonNode schema) {
        Set<String> refs = new HashSet<>();
        collectDefinedRefsRecursive(schema, "#", refs);
        return refs;
    }

    private void collectDefinedRefsRecursive(JsonNode node, String path, Set<String> refs) {
        if (!node.isObject()) return;
        
        // Note: $defs is NOT a JSON Structure keyword (it's JSON Schema).
        // JSON Structure uses 'definitions' keyword.
        
        if (node.has("definitions") && node.get("definitions").isObject()) {
            JsonNode defs = node.get("definitions");
            Iterator<String> names = defs.fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                String refPath = path + "/definitions/" + name;
                refs.add(refPath);
                JsonNode defNode = defs.get(name);
                collectDefinedRefsRecursive(defNode, refPath, refs);
                // Also recurse into nested namespace objects (objects with nested definitions but no type)
                if (defNode.isObject() && !defNode.has("type") && !defNode.has("$ref") && 
                    !defNode.has("allOf") && !defNode.has("anyOf") && !defNode.has("oneOf")) {
                    collectNestedNamespaceRefs(defNode, refPath, refs);
                }
            }
        }
    }

    /**
     * Collects refs from nested namespace objects (objects containing type definitions without themselves being types).
     */
    private void collectNestedNamespaceRefs(JsonNode node, String path, Set<String> refs) {
        if (!node.isObject()) return;
        
        Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            String fieldName = field.getKey();
            // Skip meta-properties
            if (fieldName.startsWith("$")) continue;
            
            JsonNode fieldValue = field.getValue();
            if (!fieldValue.isObject()) continue;
            
            String nestedPath = path + "/" + fieldName;
            refs.add(nestedPath);
            
            // Recurse if this is also a namespace
            if (!fieldValue.has("type") && !fieldValue.has("$ref") && 
                !fieldValue.has("allOf") && !fieldValue.has("anyOf") && !fieldValue.has("oneOf")) {
                collectNestedNamespaceRefs(fieldValue, nestedPath, refs);
            }
            collectDefinedRefsRecursive(fieldValue, nestedPath, refs);
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
        
        // Root schema requirements per JSON Structure Core spec
        boolean isRoot = path.isEmpty();
        if (isRoot) {
            // Root schema must have $id
            if (!schema.has("$id")) {
                addError(result, ErrorCodes.SCHEMA_ROOT_MISSING_ID, "Missing required '$id' keyword at root", "");
            }
            
            // Root schema with 'type' must have 'name'
            if (schema.has("type") && !schema.has("name")) {
                addError(result, ErrorCodes.SCHEMA_ROOT_MISSING_NAME, "Root schema with 'type' must have a 'name' property", "");
            }
        }

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

        // Check for bare $ref - this is NOT permitted per spec Section 3.4.1
        // $ref is ONLY permitted inside the 'type' attribute value
        if (schema.has("$ref")) {
            addError(result, ErrorCodes.SCHEMA_REF_NOT_IN_TYPE, 
                    "'$ref' is only permitted inside the 'type' attribute. Use { \"type\": { \"$ref\": \"...\" } } instead of { \"$ref\": \"...\" }", 
                    appendPath(path, "$ref"));
        }

        // Validate $anchor if present
        if (schema.has("$anchor")) {
            validateIdentifier(schema.get("$anchor"), "$anchor", path, result);
        }

        // $defs is NOT a JSON Structure keyword (it's JSON Schema) - reject it
        if (schema.has("$defs")) {
            addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, 
                    "'$defs' is not a valid JSON Structure keyword. Use 'definitions' instead.", 
                    appendPath(path, "$defs"));
        }

        // Validate definitions if present
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

        // Validate $extends if present (can be a string or array of strings)
        if (schema.has("$extends")) {
            validateExtendsKeyword(schema.get("$extends"), path, result);
        }

        // Get type for constraint validation
        String typeStr = null;
        
        // Validate type if present
        if (schema.has("type")) {
            JsonNode typeValue = schema.get("type");
            validateType(typeValue, path, result, visitedRefs);
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

        // Add warning for default extension keyword
        if (schema.has("default")) {
            addExtensionKeywordWarning(result, "default", path);
        }

        // Validate altnames if present
        if (schema.has("altnames")) {
            validateAltnames(schema.get("altnames"), path, result);
        }
        
        // A schema must have at least one schema-defining keyword (type, allOf, anyOf, oneOf, $extends)
        // unless it only defines definitions (a pure definition container) or uses conditional keywords
        // Note: $ref is NOT a valid schema-level keyword - it can only appear inside 'type'
        boolean hasSchemaKeyword = schema.has("type") || 
                                   schema.has("allOf") || schema.has("anyOf") || 
                                   schema.has("oneOf") || schema.has("$extends") ||
                                   schema.has("enum") || schema.has("const") ||
                                   schema.has("if") || schema.has("properties") ||
                                   schema.has("items") || schema.has("prefixItems") ||
                                   schema.has("not") || schema.has("$import") ||
                                   schema.has("$importdefs");
        boolean isPureDefContainer = schema.has("definitions") &&
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

    private void validateExtendsKeyword(JsonNode value, String path, ValidationResult result) {
        // $extends can be a string (single base type) or array of strings (multiple inheritance)
        if (value.isTextual()) {
            String str = value.asText();
            if (str.isBlank()) {
                addError(result, ErrorCodes.SCHEMA_KEYWORD_EMPTY, "$extends cannot be empty", appendPath(path, "$extends"));
            }
            return;
        }

        if (value.isArray()) {
            if (value.isEmpty()) {
                addError(result, ErrorCodes.SCHEMA_KEYWORD_EMPTY, "$extends array cannot be empty", appendPath(path, "$extends"));
                return;
            }
            
            for (JsonNode item : value) {
                if (!item.isTextual()) {
                    addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, "$extends array items must be strings", appendPath(path, "$extends"));
                    break;
                }
                if (item.asText().isBlank()) {
                    addError(result, ErrorCodes.SCHEMA_KEYWORD_EMPTY, "$extends array items cannot be empty", appendPath(path, "$extends"));
                    break;
                }
            }
            return;
        }

        addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, "$extends must be a string or array of strings", appendPath(path, "$extends"));
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

    private void validateType(JsonNode value, String path, ValidationResult result, Set<String> visitedRefs) {
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
                        // Also check that the ref resolves
                        validateRefResolution(item.get("$ref").asText(), appendPath(typePath, "$ref"), result);
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
                String refStr = value.get("$ref").asText();
                validateReference(value.get("$ref"), "$ref", typePath, result);
                // Also check that the ref resolves
                validateRefResolution(refStr, appendPath(typePath, "$ref"), result);
                
                // Check for circular reference (type: { $ref } with no other content in the target)
                if (refStr.startsWith("#/") && visitedRefs.contains(refStr)) {
                    JsonNode target = resolveLocalRef(refStr);
                    if (target != null && target.isObject()) {
                        ObjectNode targetObj = (ObjectNode) target;
                        // Check if this definition only contains type: { $ref } (direct circular with no content)
                        if (targetObj.size() == 1 && targetObj.has("type")) {
                            JsonNode typeNode = targetObj.get("type");
                            if (typeNode.isObject() && typeNode.size() == 1 && typeNode.has("$ref")) {
                                addError(result, ErrorCodes.SCHEMA_REF_CIRCULAR, "Circular reference detected: " + refStr, appendPath(typePath, "$ref"));
                            }
                        }
                    }
                }
            } else {
                addError(result, ErrorCodes.SCHEMA_TYPE_OBJECT_MISSING_REF, "type object must contain $ref", typePath);
            }
            return;
        }

        addError(result, ErrorCodes.SCHEMA_KEYWORD_INVALID_TYPE, "type must be a string, array of strings, or object with $ref", typePath);
    }

    /**
     * Validates that a $ref string actually resolves to a valid target in the schema.
     */
    private void validateRefResolution(String refStr, String path, ValidationResult result) {
        if (refStr == null || refStr.isBlank()) {
            return;  // Already handled by validateReference
        }
        
        if (refStr.startsWith("#/")) {
            JsonNode resolved = resolveLocalRef(refStr);
            if (resolved == null) {
                // Check if this ref points into an import namespace
                boolean isImportedRef = false;
                for (String importNs : importNamespaces) {
                    if (refStr.startsWith(importNs + "/")) {
                        isImportedRef = true;
                        break;
                    }
                }
                if (!isImportedRef) {
                    addError(result, ErrorCodes.SCHEMA_REF_NOT_FOUND, "$ref target does not exist: " + refStr, path);
                }
            }
        }
    }

    private String getTypeString(JsonNode value) {
        if (value != null && value.isTextual()) {
            return value.asText();
        }
        return null;
    }

    private boolean isNumericType(String type) {
        return type != null && NUMERIC_TYPES.contains(type);
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

        // Add warnings for extension keywords
        if (schema.has("minProperties")) addExtensionKeywordWarning(result, "minProperties", path);
        if (schema.has("maxProperties")) addExtensionKeywordWarning(result, "maxProperties", path);
        if (schema.has("dependentRequired")) addExtensionKeywordWarning(result, "dependentRequired", path);
        if (schema.has("patternProperties")) addExtensionKeywordWarning(result, "patternProperties", path);
        if (schema.has("propertyNames")) addExtensionKeywordWarning(result, "propertyNames", path);

        // Validate minProperties/maxProperties
        validateNonNegativeInteger(schema, "minProperties", path, result);
        validateNonNegativeInteger(schema, "maxProperties", path, result);
    }

    private void validateArraySchema(ObjectNode schema, String path, ValidationResult result, int depth, Set<String> visitedRefs) {
        // Add warnings for extension keywords
        if (schema.has("minItems")) addExtensionKeywordWarning(result, "minItems", path);
        if (schema.has("maxItems")) addExtensionKeywordWarning(result, "maxItems", path);
        if (schema.has("uniqueItems")) addExtensionKeywordWarning(result, "uniqueItems", path);
        if (schema.has("contains")) addExtensionKeywordWarning(result, "contains", path);
        if (schema.has("minContains")) addExtensionKeywordWarning(result, "minContains", path);
        if (schema.has("maxContains")) addExtensionKeywordWarning(result, "maxContains", path);

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
        // JSON Structure tuples use 'properties' + 'tuple' keyword (NOT prefixItems)
        boolean hasTupleKeyword = schema.has("tuple") && schema.has("properties");
        
        if (!hasTupleKeyword) {
            addError(result, ErrorCodes.SCHEMA_TUPLE_MISSING_DEFINITION, "tuple type requires 'properties' and 'tuple' keyword defining element order", path);
            return;
        }
        
        JsonNode tupleNode = schema.get("tuple");
        if (!tupleNode.isArray()) {
            addError(result, ErrorCodes.SCHEMA_TUPLE_ORDER_NOT_ARRAY, "tuple must be an array of property names", appendPath(path, "tuple"));
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
        // Add warnings for extension keywords
        if (schema.has("minProperties")) addExtensionKeywordWarning(result, "minProperties", path);
        if (schema.has("maxProperties")) addExtensionKeywordWarning(result, "maxProperties", path);
        if (schema.has("propertyNames")) addExtensionKeywordWarning(result, "propertyNames", path);
        // Map-specific extension keywords
        if (schema.has("minEntries")) addExtensionKeywordWarning(result, "minEntries", path);
        if (schema.has("maxEntries")) addExtensionKeywordWarning(result, "maxEntries", path);
        if (schema.has("keyNames")) addExtensionKeywordWarning(result, "keyNames", path);
        if (schema.has("patternKeys")) addExtensionKeywordWarning(result, "patternKeys", path);

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
        // Choice type requires 'choices' keyword (JSON Structure)
        boolean hasChoices = schema.has("choices");
        if (!hasChoices) {
            addError(result, ErrorCodes.SCHEMA_CHOICE_MISSING_CHOICES, "choice type requires 'choices' keyword", path);
        }

        // Validate choices keyword
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
        // Add warnings for extension keywords (minLength is extension, maxLength is core)
        if (schema.has("minLength")) addExtensionKeywordWarning(result, "minLength", path);
        if (schema.has("pattern")) addExtensionKeywordWarning(result, "pattern", path);
        if (schema.has("format")) addExtensionKeywordWarning(result, "format", path);
        if (schema.has("contentEncoding")) addExtensionKeywordWarning(result, "contentEncoding", path);
        if (schema.has("contentMediaType")) addExtensionKeywordWarning(result, "contentMediaType", path);

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
        // Add warnings for extension keywords
        if (schema.has("minimum")) addExtensionKeywordWarning(result, "minimum", path);
        if (schema.has("maximum")) addExtensionKeywordWarning(result, "maximum", path);
        if (schema.has("exclusiveMinimum")) addExtensionKeywordWarning(result, "exclusiveMinimum", path);
        if (schema.has("exclusiveMaximum")) addExtensionKeywordWarning(result, "exclusiveMaximum", path);
        if (schema.has("multipleOf")) addExtensionKeywordWarning(result, "multipleOf", path);

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

    /**
     * Process $import/$importdefs in an external schema and merge definitions.
     * Returns true if any imports were processed.
     */
    private boolean processImportsInExternalSchema(JsonNode schema) {
        if (schema == null || !schema.isObject()) {
            return false;
        }
        
        ObjectNode schemaObj = (ObjectNode) schema;
        boolean processed = false;
        
        // Handle root-level $import
        if (schemaObj.has("$import")) {
            processImport(schemaObj, "$import", true);
            processed = true;
        }
        
        // Handle $import in definitions
        if (schemaObj.has("definitions") && schemaObj.get("definitions").isObject()) {
            ObjectNode defs = (ObjectNode) schemaObj.get("definitions");
            Iterator<String> names = defs.fieldNames();
            List<String> namesList = new ArrayList<>();
            while (names.hasNext()) {
                namesList.add(names.next());
            }
            for (String name : namesList) {
                JsonNode defNode = defs.get(name);
                if (defNode.isObject()) {
                    ObjectNode def = (ObjectNode) defNode;
                    if (def.has("$import")) {
                        // This is an import namespace
                        processImport(def, "$import", false);
                        // Merge children into parent definitions
                        Iterator<Map.Entry<String, JsonNode>> fields = def.fields();
                        List<Map.Entry<String, JsonNode>> fieldsList = new ArrayList<>();
                        while (fields.hasNext()) {
                            fieldsList.add(fields.next());
                        }
                        for (Map.Entry<String, JsonNode> field : fieldsList) {
                            if (!field.getKey().startsWith("$")) {
                                // Keep as nested definition under namespace
                            }
                        }
                        processed = true;
                    } else if (def.has("$importdefs")) {
                        processImport(def, "$importdefs", false);
                        processed = true;
                    }
                }
            }
        }
        
        // Handle $import in definitions
        if (schemaObj.has("definitions") && schemaObj.get("definitions").isObject()) {
            ObjectNode defs = (ObjectNode) schemaObj.get("definitions");
            Iterator<String> names = defs.fieldNames();
            List<String> namesList = new ArrayList<>();
            while (names.hasNext()) {
                namesList.add(names.next());
            }
            for (String name : namesList) {
                JsonNode defNode = defs.get(name);
                if (defNode.isObject()) {
                    ObjectNode def = (ObjectNode) defNode;
                    if (def.has("$import")) {
                        processImport(def, "$import", false);
                        processed = true;
                    } else if (def.has("$importdefs")) {
                        processImport(def, "$importdefs", false);
                        processed = true;
                    }
                }
            }
        }
        
        return processed;
    }

    /**
     * Process an $import or $importdefs directive, merging definitions from imported schemas.
     */
    private void processImport(ObjectNode target, String importKeyword, boolean isRoot) {
        JsonNode importNode = target.get(importKeyword);
        if (importNode == null) return;
        
        List<String> importUris = new ArrayList<>();
        
        if (importNode.isTextual()) {
            importUris.add(importNode.asText());
        } else if (importNode.isArray()) {
            for (JsonNode item : importNode) {
                if (item.isTextual()) {
                    importUris.add(item.asText());
                }
            }
        } else if (importNode.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = importNode.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                if (field.getValue().isTextual()) {
                    importUris.add(field.getValue().asText());
                }
            }
        }
        
        // Get or create definitions container
        ObjectNode defs;
        if (target.has("definitions")) {
            defs = (ObjectNode) target.get("definitions");
        } else {
            defs = objectMapper.createObjectNode();
            target.set("definitions", defs);
        }
        
        // Process each import
        for (String uri : importUris) {
            JsonNode importedSchema = externalSchemaMap.get(uri);
            if (importedSchema == null || !importedSchema.isObject()) continue;
            
            ObjectNode importedObj = (ObjectNode) importedSchema;
            
            // Merge definitions from imported schema
            if (importedObj.has("definitions") && importedObj.get("definitions").isObject()) {
                mergeDefinitions(defs, (ObjectNode) importedObj.get("definitions"), uri);
            }
        }
        
        // Remove the import directive after processing
        target.remove(importKeyword);
    }

    /**
     * Merge definitions from source into target, rewriting $ref pointers.
     */
    private void mergeDefinitions(ObjectNode target, ObjectNode source, String sourceUri) {
        Iterator<Map.Entry<String, JsonNode>> fields = source.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            String name = field.getKey();
            JsonNode value = field.getValue();
            
            if (!target.has(name)) {
                // Clone and rewrite refs
                JsonNode cloned = value.deepCopy();
                rewriteRefs(cloned);
                target.set(name, cloned);
            }
        }
    }

    /**
     * Rewrite $ref and $extends pointers to use #/definitions/ prefix.
     */
    private void rewriteRefs(JsonNode node) {
        if (!node.isObject() && !node.isArray()) return;
        
        if (node.isArray()) {
            for (JsonNode item : node) {
                rewriteRefs(item);
            }
            return;
        }
        
        ObjectNode obj = (ObjectNode) node;
        
        // Rewrite $ref
        if (obj.has("$ref")) {
            JsonNode refNode = obj.get("$ref");
            if (refNode.isTextual()) {
                String ref = refNode.asText();
                if (ref.startsWith("#/$defs/")) {
                    obj.put("$ref", "#/definitions/" + ref.substring(8));
                } else if (!ref.startsWith("#/") && !ref.contains("://")) {
                    // Relative ref - prepend #/definitions/
                    obj.put("$ref", "#/definitions/" + ref);
                }
            }
        }
        
        // Rewrite $extends (can be string or array of strings)
        if (obj.has("$extends")) {
            JsonNode extendsNode = obj.get("$extends");
            if (extendsNode.isTextual()) {
                String ref = extendsNode.asText();
                if (ref.startsWith("#/$defs/")) {
                    obj.put("$extends", "#/definitions/" + ref.substring(8));
                } else if (!ref.startsWith("#/") && !ref.contains("://")) {
                    obj.put("$extends", "#/definitions/" + ref);
                }
            } else if (extendsNode.isArray()) {
                ArrayNode rewrittenArray = objectMapper.createArrayNode();
                for (JsonNode item : extendsNode) {
                    if (item.isTextual()) {
                        String ref = item.asText();
                        if (ref.startsWith("#/$defs/")) {
                            rewrittenArray.add("#/definitions/" + ref.substring(8));
                        } else if (!ref.startsWith("#/") && !ref.contains("://")) {
                            rewrittenArray.add("#/definitions/" + ref);
                        } else {
                            rewrittenArray.add(ref);
                        }
                    } else {
                        rewrittenArray.add(item.deepCopy());
                    }
                }
                obj.set("$extends", rewrittenArray);
            }
        }
        
        // Recurse into properties
        Iterator<Map.Entry<String, JsonNode>> fields = obj.fields();
        while (fields.hasNext()) {
            rewriteRefs(fields.next().getValue());
        }
    }
}
