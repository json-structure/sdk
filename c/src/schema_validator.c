/**
 * @file schema_validator.c
 * @brief JSON Structure schema validator implementation
 *
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#include "json_structure/schema_validator.h"
#include <string.h>
#include <stdio.h>

/* ============================================================================
 * Internal Constants
 * ============================================================================ */

#define MAX_DEPTH 100
#define PATH_BUFFER_SIZE 1024

/* Valid primitive types */
static const char* g_primitive_types[] = {
    "null", "boolean", "integer", "number", "string", "binary",
    "int8", "int16", "int32", "int64",
    "uint8", "uint16", "uint32", "uint64",
    "float16", "float32", "float64", "float128", "float", "double",
    "decimal", "decimal64", "decimal128",
    "datetime", "date", "time", "duration",
    "uuid", "uri", "uri-reference", "uri-template",
    "regex", "char",
    "ipv4", "ipv6",
    "email", "idn-email", "hostname", "idn-hostname",
    "iri", "iri-reference",
    "json-pointer", "relative-json-pointer",
    "any",
    NULL
};

/* Valid compound types */
static const char* g_compound_types[] = {
    "object", "array", "map", "set", "tuple", "choice", "abstract",
    NULL
};

/* ============================================================================
 * Internal Types
 * ============================================================================ */

typedef struct validate_context {
    const js_schema_validator_t* validator;
    js_result_t* result;
    const cJSON* root_schema;
    const cJSON* definitions;
    char path[PATH_BUFFER_SIZE];
    int depth;
} validate_context_t;

/* ============================================================================
 * Forward Declarations
 * ============================================================================ */

static bool validate_schema_node(validate_context_t* ctx, const cJSON* schema);
static bool validate_object_properties(validate_context_t* ctx, const cJSON* schema);
static bool validate_array_items(validate_context_t* ctx, const cJSON* schema);
static bool validate_map_values(validate_context_t* ctx, const cJSON* schema);
static bool validate_choice_schema(validate_context_t* ctx, const cJSON* schema);
static bool validate_constraints(validate_context_t* ctx, const cJSON* schema, const char* type_name);

/* ============================================================================
 * Helper Functions
 * ============================================================================ */

static void push_path(validate_context_t* ctx, const char* segment) {
    size_t len = strlen(ctx->path);
    if (len == 0) {
        snprintf(ctx->path, PATH_BUFFER_SIZE, "%s", segment);
    } else if (segment[0] == '[') {
        snprintf(ctx->path + len, PATH_BUFFER_SIZE - len, "%s", segment);
    } else {
        snprintf(ctx->path + len, PATH_BUFFER_SIZE - len, ".%s", segment);
    }
}

static void pop_path(validate_context_t* ctx, size_t prev_len) {
    ctx->path[prev_len] = '\0';
}

static void add_error(validate_context_t* ctx, js_error_code_t code, const char* message) {
    js_result_add_error(ctx->result, code, message, ctx->path);
}

static void add_warning(validate_context_t* ctx, js_error_code_t code, const char* message) {
    js_result_add_warning(ctx->result, code, message, ctx->path);
}

static bool is_string_in_list(const char* str, const char** list) {
    if (!str) return false;
    for (const char** p = list; *p != NULL; ++p) {
        if (strcmp(str, *p) == 0) return true;
    }
    return false;
}

/* ============================================================================
 * Type Validation
 * ============================================================================ */

bool js_schema_is_valid_primitive_type(const char* type_name) {
    return is_string_in_list(type_name, g_primitive_types);
}

bool js_schema_is_valid_compound_type(const char* type_name) {
    return is_string_in_list(type_name, g_compound_types);
}

static bool is_valid_type_name(const char* type_name) {
    return js_schema_is_valid_primitive_type(type_name) ||
           js_schema_is_valid_compound_type(type_name);
}

/* ============================================================================
 * Reference Resolution
 * ============================================================================ */

static const cJSON* resolve_ref(validate_context_t* ctx, const char* ref) {
    if (!ref) return NULL;

    /* Handle internal references: #/$defs/Name */
    if (ref[0] == '#') {
        if (strncmp(ref, "#/$defs/", 8) == 0) {
            const char* def_name = ref + 8;
            if (ctx->definitions) {
                return cJSON_GetObjectItemCaseSensitive(ctx->definitions, def_name);
            }
        }
        /* Also handle older $definitions path */
        if (strncmp(ref, "#/$definitions/", 15) == 0) {
            const char* def_name = ref + 15;
            if (ctx->definitions) {
                return cJSON_GetObjectItemCaseSensitive(ctx->definitions, def_name);
            }
        }
    }

    return NULL;
}

/* ============================================================================
 * Constraint Validation
 * ============================================================================ */

static bool validate_string_constraints(validate_context_t* ctx, const cJSON* schema) {
    bool valid = true;
    const cJSON* minLength = cJSON_GetObjectItemCaseSensitive(schema, "minLength");
    const cJSON* maxLength = cJSON_GetObjectItemCaseSensitive(schema, "maxLength");
    const cJSON* pattern = cJSON_GetObjectItemCaseSensitive(schema, "pattern");
    
    if (minLength) {
        if (!cJSON_IsNumber(minLength)) {
            add_error(ctx, JS_SCHEMA_MINLENGTH_INVALID, "minLength must be a number");
            valid = false;
        } else if (minLength->valuedouble < 0) {
            add_error(ctx, JS_SCHEMA_MINLENGTH_NEGATIVE, "minLength cannot be negative");
            valid = false;
        }
    }
    
    if (maxLength) {
        if (!cJSON_IsNumber(maxLength)) {
            add_error(ctx, JS_SCHEMA_MAXLENGTH_INVALID, "maxLength must be a number");
            valid = false;
        } else if (maxLength->valuedouble < 0) {
            add_error(ctx, JS_SCHEMA_MAXLENGTH_NEGATIVE, "maxLength cannot be negative");
            valid = false;
        }
    }
    
    if (minLength && maxLength && cJSON_IsNumber(minLength) && cJSON_IsNumber(maxLength)) {
        if (minLength->valuedouble > maxLength->valuedouble) {
            add_error(ctx, JS_SCHEMA_MINLENGTH_EXCEEDS_MAXLENGTH, "minLength exceeds maxLength");
            valid = false;
        }
    }
    
    if (pattern) {
        if (!cJSON_IsString(pattern)) {
            add_error(ctx, JS_SCHEMA_PATTERN_INVALID, "pattern must be a string");
            valid = false;
        }
        /* TODO: Validate regex syntax if PCRE2 is available */
    }
    
    return valid;
}

static bool validate_numeric_constraints(validate_context_t* ctx, const cJSON* schema) {
    bool valid = true;
    const cJSON* minimum = cJSON_GetObjectItemCaseSensitive(schema, "minimum");
    const cJSON* maximum = cJSON_GetObjectItemCaseSensitive(schema, "maximum");
    const cJSON* exclusiveMinimum = cJSON_GetObjectItemCaseSensitive(schema, "exclusiveMinimum");
    const cJSON* exclusiveMaximum = cJSON_GetObjectItemCaseSensitive(schema, "exclusiveMaximum");
    const cJSON* multipleOf = cJSON_GetObjectItemCaseSensitive(schema, "multipleOf");
    
    if (minimum && !cJSON_IsNumber(minimum)) {
        add_error(ctx, JS_SCHEMA_MIN_MAX_INVALID, "minimum must be a number");
        valid = false;
    }
    
    if (maximum && !cJSON_IsNumber(maximum)) {
        add_error(ctx, JS_SCHEMA_MIN_MAX_INVALID, "maximum must be a number");
        valid = false;
    }
    
    if (exclusiveMinimum && !cJSON_IsNumber(exclusiveMinimum)) {
        add_error(ctx, JS_SCHEMA_MIN_MAX_INVALID, "exclusiveMinimum must be a number");
        valid = false;
    }
    
    if (exclusiveMaximum && !cJSON_IsNumber(exclusiveMaximum)) {
        add_error(ctx, JS_SCHEMA_MIN_MAX_INVALID, "exclusiveMaximum must be a number");
        valid = false;
    }
    
    if (minimum && maximum && cJSON_IsNumber(minimum) && cJSON_IsNumber(maximum)) {
        if (minimum->valuedouble > maximum->valuedouble) {
            add_error(ctx, JS_SCHEMA_MINIMUM_EXCEEDS_MAXIMUM, "minimum exceeds maximum");
            valid = false;
        }
    }
    
    if (multipleOf) {
        if (!cJSON_IsNumber(multipleOf)) {
            add_error(ctx, JS_SCHEMA_MULTIPLEOF_INVALID, "multipleOf must be a number");
            valid = false;
        } else if (multipleOf->valuedouble <= 0) {
            add_error(ctx, JS_SCHEMA_MULTIPLEOF_INVALID, "multipleOf must be positive");
            valid = false;
        }
    }
    
    return valid;
}

static bool validate_array_constraints(validate_context_t* ctx, const cJSON* schema) {
    bool valid = true;
    const cJSON* minItems = cJSON_GetObjectItemCaseSensitive(schema, "minItems");
    const cJSON* maxItems = cJSON_GetObjectItemCaseSensitive(schema, "maxItems");
    
    if (minItems) {
        if (!cJSON_IsNumber(minItems)) {
            add_error(ctx, JS_SCHEMA_MINITEMS_NEGATIVE, "minItems must be a number");
            valid = false;
        } else if (minItems->valuedouble < 0) {
            add_error(ctx, JS_SCHEMA_MINITEMS_NEGATIVE, "minItems cannot be negative");
            valid = false;
        }
    }
    
    if (maxItems) {
        if (!cJSON_IsNumber(maxItems)) {
            add_error(ctx, JS_SCHEMA_MIN_MAX_INVALID, "maxItems must be a number");
            valid = false;
        }
    }
    
    if (minItems && maxItems && cJSON_IsNumber(minItems) && cJSON_IsNumber(maxItems)) {
        if (minItems->valuedouble > maxItems->valuedouble) {
            add_error(ctx, JS_SCHEMA_MINITEMS_EXCEEDS_MAXITEMS, "minItems exceeds maxItems");
            valid = false;
        }
    }
    
    return valid;
}

static bool validate_constraints(validate_context_t* ctx, const cJSON* schema, const char* type_name) {
    bool valid = true;
    
    /* String constraints */
    if (strcmp(type_name, "string") == 0 || js_type_is_string(js_type_from_name(type_name))) {
        valid = validate_string_constraints(ctx, schema) && valid;
    }
    
    /* Numeric constraints */
    if (strcmp(type_name, "number") == 0 || strcmp(type_name, "integer") == 0 ||
        js_type_is_numeric(js_type_from_name(type_name))) {
        valid = validate_numeric_constraints(ctx, schema) && valid;
    }
    
    /* Array constraints */
    if (strcmp(type_name, "array") == 0 || strcmp(type_name, "set") == 0) {
        valid = validate_array_constraints(ctx, schema) && valid;
    }
    
    return valid;
}

/* ============================================================================
 * Schema Node Validation
 * ============================================================================ */

static bool validate_type_value(validate_context_t* ctx, const cJSON* type_node) {
    if (cJSON_IsString(type_node)) {
        const char* type_str = type_node->valuestring;
        if (!is_valid_type_name(type_str)) {
            char msg[256];
            snprintf(msg, sizeof(msg), "Unknown type: '%s'", type_str);
            add_error(ctx, JS_SCHEMA_TYPE_INVALID, msg);
            return false;
        }
        return true;
    }
    
    if (cJSON_IsArray(type_node)) {
        if (cJSON_GetArraySize(type_node) == 0) {
            add_error(ctx, JS_SCHEMA_TYPE_ARRAY_EMPTY, "Type array cannot be empty");
            return false;
        }
        
        bool valid = true;
        cJSON* item;
        cJSON_ArrayForEach(item, type_node) {
            if (!cJSON_IsString(item)) {
                add_error(ctx, JS_SCHEMA_TYPE_NOT_STRING, "Type array items must be strings");
                valid = false;
            } else if (!is_valid_type_name(item->valuestring)) {
                char msg[256];
                snprintf(msg, sizeof(msg), "Unknown type in array: '%s'", item->valuestring);
                add_error(ctx, JS_SCHEMA_TYPE_INVALID, msg);
                valid = false;
            }
        }
        return valid;
    }
    
    add_error(ctx, JS_SCHEMA_TYPE_NOT_STRING, "Type must be a string or array of strings");
    return false;
}

static bool validate_definitions(validate_context_t* ctx, const cJSON* defs) {
    if (!cJSON_IsObject(defs)) {
        add_error(ctx, JS_SCHEMA_DEFINITIONS_MUST_BE_OBJECT, "$defs must be an object");
        return false;
    }
    
    bool valid = true;
    size_t prev_len = strlen(ctx->path);
    push_path(ctx, "$defs");
    
    cJSON* def;
    cJSON_ArrayForEach(def, defs) {
        size_t def_prev_len = strlen(ctx->path);
        push_path(ctx, def->string);
        
        if (!validate_schema_node(ctx, def)) {
            valid = false;
        }
        
        pop_path(ctx, def_prev_len);
    }
    
    pop_path(ctx, prev_len);
    return valid;
}

static bool validate_object_properties(validate_context_t* ctx, const cJSON* schema) {
    const cJSON* properties = cJSON_GetObjectItemCaseSensitive(schema, "properties");
    const cJSON* required = cJSON_GetObjectItemCaseSensitive(schema, "required");
    const cJSON* additionalProperties = cJSON_GetObjectItemCaseSensitive(schema, "additionalProperties");
    
    bool valid = true;
    
    if (properties) {
        if (!cJSON_IsObject(properties)) {
            add_error(ctx, JS_SCHEMA_PROPERTIES_MUST_BE_OBJECT, "properties must be an object");
            valid = false;
        } else {
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, "properties");
            
            cJSON* prop;
            cJSON_ArrayForEach(prop, properties) {
                size_t prop_prev_len = strlen(ctx->path);
                push_path(ctx, prop->string);
                
                if (!validate_schema_node(ctx, prop)) {
                    valid = false;
                }
                
                pop_path(ctx, prop_prev_len);
            }
            
            pop_path(ctx, prev_len);
        }
    }
    
    if (required) {
        if (!cJSON_IsArray(required)) {
            add_error(ctx, JS_SCHEMA_REQUIRED_MUST_BE_ARRAY, "required must be an array");
            valid = false;
        } else {
            cJSON* req_item;
            cJSON_ArrayForEach(req_item, required) {
                if (!cJSON_IsString(req_item)) {
                    add_error(ctx, JS_SCHEMA_REQUIRED_ITEM_MUST_BE_STRING, 
                             "required items must be strings");
                    valid = false;
                } else if (properties && cJSON_IsObject(properties)) {
                    if (!cJSON_GetObjectItemCaseSensitive(properties, req_item->valuestring)) {
                        char msg[256];
                        snprintf(msg, sizeof(msg), "Required property '%s' not defined in properties",
                                req_item->valuestring);
                        add_warning(ctx, JS_SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED, msg);
                    }
                }
            }
        }
    }
    
    if (additionalProperties) {
        if (!cJSON_IsBool(additionalProperties) && !cJSON_IsObject(additionalProperties)) {
            add_error(ctx, JS_SCHEMA_ADDITIONAL_PROPERTIES_INVALID, 
                     "additionalProperties must be a boolean or schema");
            valid = false;
        } else if (cJSON_IsObject(additionalProperties)) {
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, "additionalProperties");
            if (!validate_schema_node(ctx, additionalProperties)) {
                valid = false;
            }
            pop_path(ctx, prev_len);
        }
    }
    
    return valid;
}

static bool validate_array_items(validate_context_t* ctx, const cJSON* schema) {
    const cJSON* items = cJSON_GetObjectItemCaseSensitive(schema, "items");
    
    if (!items) {
        add_error(ctx, JS_SCHEMA_ARRAY_MISSING_ITEMS, "Array type requires items definition");
        return false;
    }
    
    size_t prev_len = strlen(ctx->path);
    push_path(ctx, "items");
    bool valid = validate_schema_node(ctx, items);
    pop_path(ctx, prev_len);
    
    return valid;
}

static bool validate_map_values(validate_context_t* ctx, const cJSON* schema) {
    const cJSON* values = cJSON_GetObjectItemCaseSensitive(schema, "values");
    
    if (!values) {
        add_error(ctx, JS_SCHEMA_MAP_MISSING_VALUES, "Map type requires values definition");
        return false;
    }
    
    size_t prev_len = strlen(ctx->path);
    push_path(ctx, "values");
    bool valid = validate_schema_node(ctx, values);
    pop_path(ctx, prev_len);
    
    return valid;
}

static bool validate_tuple_schema(validate_context_t* ctx, const cJSON* schema) {
    const cJSON* tuple_arr = cJSON_GetObjectItemCaseSensitive(schema, "tuple");
    const cJSON* properties = cJSON_GetObjectItemCaseSensitive(schema, "properties");
    
    bool valid = true;
    
    /* tuple type requires tuple keyword */
    if (!tuple_arr) {
        add_error(ctx, JS_SCHEMA_TUPLE_MISSING_DEFINITION, "Tuple type requires tuple keyword");
        valid = false;
    } else if (!cJSON_IsArray(tuple_arr)) {
        add_error(ctx, JS_SCHEMA_TUPLE_INVALID_FORMAT, "tuple must be an array");
        valid = false;
    }
    
    /* tuple type requires properties keyword */
    if (!properties) {
        add_error(ctx, JS_SCHEMA_TUPLE_MISSING_PROPERTIES, "Tuple type requires properties");
        valid = false;
    } else if (!cJSON_IsObject(properties)) {
        add_error(ctx, JS_SCHEMA_PROPERTIES_MUST_BE_OBJECT, "properties must be an object");
        valid = false;
    }
    
    /* If both are present and valid, validate that tuple references properties */
    if (tuple_arr && cJSON_IsArray(tuple_arr) && properties && cJSON_IsObject(properties)) {
        cJSON* tuple_item;
        cJSON_ArrayForEach(tuple_item, tuple_arr) {
            if (!cJSON_IsString(tuple_item)) {
                add_error(ctx, JS_SCHEMA_TUPLE_INVALID_FORMAT, "tuple array items must be strings");
                valid = false;
            } else {
                if (!cJSON_GetObjectItemCaseSensitive(properties, tuple_item->valuestring)) {
                    char msg[256];
                    snprintf(msg, sizeof(msg), "tuple references undefined property '%s'",
                            tuple_item->valuestring);
                    add_error(ctx, JS_SCHEMA_TUPLE_PROPERTY_NOT_DEFINED, msg);
                    valid = false;
                }
            }
        }
        
        /* Validate the properties themselves */
        size_t prev_len = strlen(ctx->path);
        push_path(ctx, "properties");
        
        cJSON* prop;
        cJSON_ArrayForEach(prop, properties) {
            size_t prop_prev_len = strlen(ctx->path);
            push_path(ctx, prop->string);
            
            if (!validate_schema_node(ctx, prop)) {
                valid = false;
            }
            
            pop_path(ctx, prop_prev_len);
        }
        
        pop_path(ctx, prev_len);
    }
    
    return valid;
}

static bool validate_choice_schema(validate_context_t* ctx, const cJSON* schema) {
    const cJSON* choices = cJSON_GetObjectItemCaseSensitive(schema, "choices");
    const cJSON* selector = cJSON_GetObjectItemCaseSensitive(schema, "selector");
    
    bool valid = true;
    
    if (!choices) {
        add_error(ctx, JS_SCHEMA_CHOICE_MISSING_CHOICES, "Choice type requires choices definition");
        return false;
    }
    
    if (!cJSON_IsObject(choices)) {
        add_error(ctx, JS_SCHEMA_CHOICES_NOT_OBJECT, "choices must be an object");
        return false;
    }
    
    if (selector && !cJSON_IsString(selector)) {
        add_error(ctx, JS_SCHEMA_SELECTOR_NOT_STRING, "selector must be a string");
        valid = false;
    }
    
    size_t prev_len = strlen(ctx->path);
    push_path(ctx, "choices");
    
    cJSON* choice;
    cJSON_ArrayForEach(choice, choices) {
        size_t choice_prev_len = strlen(ctx->path);
        push_path(ctx, choice->string);
        
        if (!validate_schema_node(ctx, choice)) {
            valid = false;
        }
        
        pop_path(ctx, choice_prev_len);
    }
    
    pop_path(ctx, prev_len);
    return valid;
}

static bool validate_enum(validate_context_t* ctx, const cJSON* enum_node) {
    if (!cJSON_IsArray(enum_node)) {
        add_error(ctx, JS_SCHEMA_ENUM_NOT_ARRAY, "enum must be an array");
        return false;
    }
    
    int size = cJSON_GetArraySize(enum_node);
    if (size == 0) {
        add_error(ctx, JS_SCHEMA_ENUM_EMPTY, "enum cannot be empty");
        return false;
    }
    
    /* Check for duplicates */
    for (int i = 0; i < size; i++) {
        const cJSON* a = cJSON_GetArrayItem(enum_node, i);
        for (int j = i + 1; j < size; j++) {
            const cJSON* b = cJSON_GetArrayItem(enum_node, j);
            if (cJSON_Compare(a, b, true)) {
                add_error(ctx, JS_SCHEMA_ENUM_DUPLICATES, "enum contains duplicate values");
                return false;
            }
        }
    }
    
    return true;
}

static bool validate_composition(validate_context_t* ctx, const cJSON* schema) {
    bool valid = true;
    const cJSON* allOf = cJSON_GetObjectItemCaseSensitive(schema, "allOf");
    const cJSON* anyOf = cJSON_GetObjectItemCaseSensitive(schema, "anyOf");
    const cJSON* oneOf = cJSON_GetObjectItemCaseSensitive(schema, "oneOf");
    const cJSON* not_schema = cJSON_GetObjectItemCaseSensitive(schema, "not");
    const cJSON* if_schema = cJSON_GetObjectItemCaseSensitive(schema, "if");
    const cJSON* then_schema = cJSON_GetObjectItemCaseSensitive(schema, "then");
    const cJSON* else_schema = cJSON_GetObjectItemCaseSensitive(schema, "else");
    
    if (allOf) {
        if (!cJSON_IsArray(allOf)) {
            add_error(ctx, JS_SCHEMA_ALLOF_NOT_ARRAY, "allOf must be an array");
            valid = false;
        } else {
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, "allOf");
            int idx = 0;
            cJSON* item;
            cJSON_ArrayForEach(item, allOf) {
                char idx_str[32];
                snprintf(idx_str, sizeof(idx_str), "[%d]", idx);
                size_t item_prev_len = strlen(ctx->path);
                push_path(ctx, idx_str);
                if (!validate_schema_node(ctx, item)) valid = false;
                pop_path(ctx, item_prev_len);
                idx++;
            }
            pop_path(ctx, prev_len);
        }
    }
    
    if (anyOf) {
        if (!cJSON_IsArray(anyOf)) {
            add_error(ctx, JS_SCHEMA_ANYOF_NOT_ARRAY, "anyOf must be an array");
            valid = false;
        } else {
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, "anyOf");
            int idx = 0;
            cJSON* item;
            cJSON_ArrayForEach(item, anyOf) {
                char idx_str[32];
                snprintf(idx_str, sizeof(idx_str), "[%d]", idx);
                size_t item_prev_len = strlen(ctx->path);
                push_path(ctx, idx_str);
                if (!validate_schema_node(ctx, item)) valid = false;
                pop_path(ctx, item_prev_len);
                idx++;
            }
            pop_path(ctx, prev_len);
        }
    }
    
    if (oneOf) {
        if (!cJSON_IsArray(oneOf)) {
            add_error(ctx, JS_SCHEMA_ONEOF_NOT_ARRAY, "oneOf must be an array");
            valid = false;
        } else {
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, "oneOf");
            int idx = 0;
            cJSON* item;
            cJSON_ArrayForEach(item, oneOf) {
                char idx_str[32];
                snprintf(idx_str, sizeof(idx_str), "[%d]", idx);
                size_t item_prev_len = strlen(ctx->path);
                push_path(ctx, idx_str);
                if (!validate_schema_node(ctx, item)) valid = false;
                pop_path(ctx, item_prev_len);
                idx++;
            }
            pop_path(ctx, prev_len);
        }
    }
    
    if (not_schema) {
        size_t prev_len = strlen(ctx->path);
        push_path(ctx, "not");
        if (!validate_schema_node(ctx, not_schema)) valid = false;
        pop_path(ctx, prev_len);
    }
    
    if (then_schema && !if_schema) {
        add_error(ctx, JS_SCHEMA_THEN_WITHOUT_IF, "then requires if");
        valid = false;
    }
    
    if (else_schema && !if_schema) {
        add_error(ctx, JS_SCHEMA_ELSE_WITHOUT_IF, "else requires if");
        valid = false;
    }
    
    if (if_schema) {
        size_t prev_len = strlen(ctx->path);
        push_path(ctx, "if");
        if (!validate_schema_node(ctx, if_schema)) valid = false;
        pop_path(ctx, prev_len);
        
        if (then_schema) {
            prev_len = strlen(ctx->path);
            push_path(ctx, "then");
            if (!validate_schema_node(ctx, then_schema)) valid = false;
            pop_path(ctx, prev_len);
        }
        
        if (else_schema) {
            prev_len = strlen(ctx->path);
            push_path(ctx, "else");
            if (!validate_schema_node(ctx, else_schema)) valid = false;
            pop_path(ctx, prev_len);
        }
    }
    
    return valid;
}

static bool validate_schema_node(validate_context_t* ctx, const cJSON* schema) {
    if (!schema) {
        add_error(ctx, JS_SCHEMA_NULL, "Schema is null");
        return false;
    }
    
    if (!cJSON_IsObject(schema)) {
        add_error(ctx, JS_SCHEMA_INVALID_TYPE, "Schema must be an object");
        return false;
    }
    
    ctx->depth++;
    if (ctx->depth > MAX_DEPTH) {
        add_error(ctx, JS_SCHEMA_MAX_DEPTH_EXCEEDED, "Maximum nesting depth exceeded");
        ctx->depth--;
        return false;
    }
    
    bool valid = true;
    
    /* Check for $ref */
    const cJSON* ref = cJSON_GetObjectItemCaseSensitive(schema, "$ref");
    if (ref) {
        if (!cJSON_IsString(ref)) {
            add_error(ctx, JS_SCHEMA_REF_NOT_STRING, "$ref must be a string");
            valid = false;
        }
        /* TODO: Validate reference resolution and circular refs */
        ctx->depth--;
        return valid;
    }
    
    /* Get type */
    const cJSON* type_node = cJSON_GetObjectItemCaseSensitive(schema, "type");
    if (type_node) {
        if (!validate_type_value(ctx, type_node)) {
            valid = false;
        }
        
        const char* type_str = cJSON_IsString(type_node) ? type_node->valuestring : NULL;
        
        if (type_str) {
            /* Validate type-specific constraints */
            if (!validate_constraints(ctx, schema, type_str)) {
                valid = false;
            }
            
            /* Type-specific validation */
            if (strcmp(type_str, "object") == 0) {
                if (!validate_object_properties(ctx, schema)) valid = false;
            } else if (strcmp(type_str, "array") == 0 || strcmp(type_str, "set") == 0) {
                if (!validate_array_items(ctx, schema)) valid = false;
            } else if (strcmp(type_str, "map") == 0) {
                if (!validate_map_values(ctx, schema)) valid = false;
            } else if (strcmp(type_str, "tuple") == 0) {
                if (!validate_tuple_schema(ctx, schema)) valid = false;
            } else if (strcmp(type_str, "choice") == 0) {
                if (!validate_choice_schema(ctx, schema)) valid = false;
            }
        }
    }
    
    /* Validate enum if present */
    const cJSON* enum_node = cJSON_GetObjectItemCaseSensitive(schema, "enum");
    if (enum_node) {
        if (!validate_enum(ctx, enum_node)) valid = false;
    }
    
    /* Validate definitions */
    const cJSON* defs = cJSON_GetObjectItemCaseSensitive(schema, "$defs");
    if (defs) {
        if (!validate_definitions(ctx, defs)) valid = false;
    }
    
    /* Legacy support */
    const cJSON* definitions = cJSON_GetObjectItemCaseSensitive(schema, "$definitions");
    if (definitions && !defs) {
        if (!validate_definitions(ctx, definitions)) valid = false;
    }
    
    /* Validate composition keywords */
    if (!validate_composition(ctx, schema)) {
        valid = false;
    }
    
    ctx->depth--;
    return valid;
}

/* ============================================================================
 * Root Schema Validation
 * ============================================================================ */

static bool validate_root_schema(validate_context_t* ctx, const cJSON* schema) {
    bool valid = true;
    
    /* Check for required root properties */
    const cJSON* id = cJSON_GetObjectItemCaseSensitive(schema, "$id");
    const cJSON* schema_prop = cJSON_GetObjectItemCaseSensitive(schema, "$schema");
    const cJSON* name = cJSON_GetObjectItemCaseSensitive(schema, "name");
    const cJSON* type = cJSON_GetObjectItemCaseSensitive(schema, "type");
    
    if (!id) {
        add_warning(ctx, JS_SCHEMA_ROOT_MISSING_ID, "Root schema missing $id");
    }
    
    if (!schema_prop) {
        add_warning(ctx, JS_SCHEMA_ROOT_MISSING_SCHEMA, "Root schema missing $schema");
    }
    
    if (!name) {
        add_warning(ctx, JS_SCHEMA_ROOT_MISSING_NAME, "Root schema missing name");
    }
    
    /* Check for composition keywords at root as alternative to type */
    const cJSON* root_ref = cJSON_GetObjectItemCaseSensitive(schema, "$root");
    const cJSON* allOf = cJSON_GetObjectItemCaseSensitive(schema, "allOf");
    const cJSON* anyOf = cJSON_GetObjectItemCaseSensitive(schema, "anyOf");
    const cJSON* oneOf = cJSON_GetObjectItemCaseSensitive(schema, "oneOf");
    const cJSON* not_schema = cJSON_GetObjectItemCaseSensitive(schema, "not");
    
    bool has_type = type != NULL;
    bool has_root = root_ref != NULL;
    bool has_composition = allOf != NULL || anyOf != NULL || oneOf != NULL || not_schema != NULL;
    
    if (!has_type && !has_root && !has_composition) {
        /* Type, $root, or composition keywords required for meaningful validation */
        add_error(ctx, JS_SCHEMA_ROOT_MISSING_TYPE, "Root schema must have 'type', '$root', or composition keywords");
        valid = false;
    }
    
    /* Cache definitions for reference resolution */
    ctx->definitions = cJSON_GetObjectItemCaseSensitive(schema, "$defs");
    if (!ctx->definitions) {
        ctx->definitions = cJSON_GetObjectItemCaseSensitive(schema, "$definitions");
    }
    
    /* Validate the schema tree */
    if (!validate_schema_node(ctx, schema)) {
        valid = false;
    }
    
    return valid;
}

/* ============================================================================
 * Public API
 * ============================================================================ */

void js_schema_validator_init(js_schema_validator_t* validator) {
    if (validator) {
        validator->options = JS_SCHEMA_OPTIONS_DEFAULT;
    }
}

void js_schema_validator_init_with_options(js_schema_validator_t* validator,
                                           js_schema_options_t options) {
    if (validator) {
        validator->options = options;
    }
}

bool js_schema_validate(const js_schema_validator_t* validator,
                        const cJSON* schema,
                        js_result_t* result) {
    if (!validator || !result) return false;
    
    js_result_init(result);
    
    if (!schema) {
        js_result_add_error(result, JS_SCHEMA_NULL, "Schema is null", "");
        return false;
    }
    
    validate_context_t ctx = {
        .validator = validator,
        .result = result,
        .root_schema = schema,
        .definitions = NULL,
        .path = "",
        .depth = 0
    };
    
    return validate_root_schema(&ctx, schema);
}

bool js_schema_validate_string(const js_schema_validator_t* validator,
                               const char* json_str,
                               js_result_t* result) {
    if (!validator || !result) return false;
    
    js_result_init(result);
    
    if (!json_str) {
        js_result_add_error(result, JS_SCHEMA_NULL, "JSON string is null", "");
        return false;
    }
    
    cJSON* schema = cJSON_Parse(json_str);
    if (!schema) {
        const char* error_ptr = cJSON_GetErrorPtr();
        char msg[256];
        if (error_ptr) {
            snprintf(msg, sizeof(msg), "JSON parse error near: %.50s", error_ptr);
        } else {
            snprintf(msg, sizeof(msg), "JSON parse error");
        }
        js_result_add_error(result, JS_SCHEMA_INVALID_TYPE, msg, "");
        return false;
    }
    
    bool valid = js_schema_validate(validator, schema, result);
    cJSON_Delete(schema);
    return valid;
}

/* Alias for C++ bindings */
bool js_schema_validator_validate_string(const js_schema_validator_t* validator,
                                         const char* json_str,
                                         js_result_t* result) {
    return js_schema_validate_string(validator, json_str, result);
}
