/**
 * @file instance_validator.c
 * @brief JSON Structure instance validator implementation
 *
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#include "json_structure/instance_validator.h"
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <ctype.h>
#include <stdint.h>

/* ============================================================================
 * Internal Constants
 * ============================================================================ */

#define MAX_DEPTH 100
#define PATH_BUFFER_SIZE 1024

/* ============================================================================
 * Internal Types
 * ============================================================================ */

typedef struct validate_context {
    const js_instance_validator_t* validator;
    js_result_t* result;
    const cJSON* root_schema;
    const cJSON* definitions;
    char path[PATH_BUFFER_SIZE];
    int depth;
} validate_context_t;

/* ============================================================================
 * Forward Declarations
 * ============================================================================ */

static bool validate_instance(validate_context_t* ctx, const cJSON* instance, const cJSON* schema);
static bool validate_set_instance(validate_context_t* ctx, const cJSON* instance, const cJSON* schema);
static bool check_integer_range(validate_context_t* ctx, double value, const char* type_name);

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
 * Format Validation Helpers
 * ============================================================================ */

/* Validate ISO 8601 datetime format: YYYY-MM-DDTHH:MM:SSZ or similar */
static bool is_valid_datetime(const char* str) {
    size_t len = strlen(str);
    if (len < 20) return false; /* Minimum: 2024-01-01T00:00:00Z */
    
    /* Check date part */
    if (str[4] != '-' || str[7] != '-') return false;
    if (str[10] != 'T' && str[10] != 't') return false;
    
    /* Check year */
    for (int i = 0; i < 4; i++) {
        if (!isdigit((unsigned char)str[i])) return false;
    }
    
    /* Check month */
    if (!isdigit((unsigned char)str[5]) || !isdigit((unsigned char)str[6])) return false;
    int month = (str[5] - '0') * 10 + (str[6] - '0');
    if (month < 1 || month > 12) return false;
    
    /* Check day */
    if (!isdigit((unsigned char)str[8]) || !isdigit((unsigned char)str[9])) return false;
    int day = (str[8] - '0') * 10 + (str[9] - '0');
    if (day < 1 || day > 31) return false;
    
    /* Check time separator and time format */
    if (str[13] != ':' || str[16] != ':') return false;
    
    /* Check hours */
    if (!isdigit((unsigned char)str[11]) || !isdigit((unsigned char)str[12])) return false;
    int hour = (str[11] - '0') * 10 + (str[12] - '0');
    if (hour > 23) return false;
    
    /* Check minutes */
    if (!isdigit((unsigned char)str[14]) || !isdigit((unsigned char)str[15])) return false;
    int minute = (str[14] - '0') * 10 + (str[15] - '0');
    if (minute > 59) return false;
    
    /* Check seconds */
    if (!isdigit((unsigned char)str[17]) || !isdigit((unsigned char)str[18])) return false;
    int second = (str[17] - '0') * 10 + (str[18] - '0');
    if (second > 59) return false;
    
    /* Check timezone - either Z or +/-HH:MM */
    size_t tz_start = 19;
    if (str[tz_start] == '.') {
        /* Skip fractional seconds */
        tz_start++;
        while (tz_start < len && isdigit((unsigned char)str[tz_start])) {
            tz_start++;
        }
    }
    
    if (tz_start >= len) return false;
    
    if (str[tz_start] == 'Z' || str[tz_start] == 'z') {
        return tz_start + 1 == len;
    }
    
    if (str[tz_start] == '+' || str[tz_start] == '-') {
        /* Check offset format: +HH:MM or +HHMM */
        if (len - tz_start >= 6 && str[tz_start + 3] == ':') {
            return isdigit((unsigned char)str[tz_start + 1]) &&
                   isdigit((unsigned char)str[tz_start + 2]) &&
                   isdigit((unsigned char)str[tz_start + 4]) &&
                   isdigit((unsigned char)str[tz_start + 5]);
        }
    }
    
    return false;
}

/* Validate UUID format: 8-4-4-4-12 hex digits */
static bool is_valid_uuid(const char* str) {
    size_t len = strlen(str);
    if (len != 36) return false;
    
    const int segments[] = {8, 4, 4, 4, 12};
    int pos = 0;
    
    for (int seg = 0; seg < 5; seg++) {
        for (int i = 0; i < segments[seg]; i++) {
            char c = str[pos++];
            if (!isxdigit((unsigned char)c)) return false;
        }
        if (seg < 4) {
            if (str[pos++] != '-') return false;
        }
    }
    
    return pos == 36;
}

/* ============================================================================
 * Type Validation
 * ============================================================================ */

static bool check_type_match(const cJSON* instance, const char* type_name) {
    if (strcmp(type_name, "any") == 0) return true;
    if (strcmp(type_name, "null") == 0) return cJSON_IsNull(instance);
    if (strcmp(type_name, "boolean") == 0) return cJSON_IsBool(instance);
    if (strcmp(type_name, "number") == 0) return cJSON_IsNumber(instance);
    if (strcmp(type_name, "integer") == 0) {
        if (!cJSON_IsNumber(instance)) return false;
        double val = instance->valuedouble;
        return val == floor(val);
    }
    if (strcmp(type_name, "string") == 0) return cJSON_IsString(instance);
    if (strcmp(type_name, "object") == 0) return cJSON_IsObject(instance);
    if (strcmp(type_name, "array") == 0) return cJSON_IsArray(instance);
    if (strcmp(type_name, "map") == 0) return cJSON_IsObject(instance);
    if (strcmp(type_name, "set") == 0) return cJSON_IsArray(instance);
    
    /* Numeric types - all are represented as JSON numbers */
    if (strcmp(type_name, "int8") == 0 || strcmp(type_name, "int16") == 0 ||
        strcmp(type_name, "int32") == 0 || strcmp(type_name, "int64") == 0 ||
        strcmp(type_name, "uint8") == 0 || strcmp(type_name, "uint16") == 0 ||
        strcmp(type_name, "uint32") == 0 || strcmp(type_name, "uint64") == 0) {
        if (!cJSON_IsNumber(instance)) return false;
        double val = instance->valuedouble;
        return val == floor(val);
    }
    
    if (strcmp(type_name, "float") == 0 || strcmp(type_name, "float16") == 0 ||
        strcmp(type_name, "float32") == 0 || strcmp(type_name, "float64") == 0 ||
        strcmp(type_name, "float128") == 0 || strcmp(type_name, "double") == 0 ||
        strcmp(type_name, "decimal") == 0 || strcmp(type_name, "decimal64") == 0 ||
        strcmp(type_name, "decimal128") == 0) {
        return cJSON_IsNumber(instance);
    }
    
    /* String-based types with format validation */
    if (strcmp(type_name, "datetime") == 0) {
        if (!cJSON_IsString(instance)) return false;
        return is_valid_datetime(instance->valuestring);
    }
    
    if (strcmp(type_name, "uuid") == 0) {
        if (!cJSON_IsString(instance)) return false;
        return is_valid_uuid(instance->valuestring);
    }
    
    /* String-based types without strict format validation */
    if (strcmp(type_name, "binary") == 0 ||
        strcmp(type_name, "date") == 0 ||
        strcmp(type_name, "time") == 0 || strcmp(type_name, "duration") == 0 ||
        strcmp(type_name, "uri") == 0 ||
        strcmp(type_name, "uri-reference") == 0 || strcmp(type_name, "uri-template") == 0 ||
        strcmp(type_name, "regex") == 0 || strcmp(type_name, "char") == 0 ||
        strcmp(type_name, "ipv4") == 0 || strcmp(type_name, "ipv6") == 0 ||
        strcmp(type_name, "email") == 0 || strcmp(type_name, "idn-email") == 0 ||
        strcmp(type_name, "hostname") == 0 || strcmp(type_name, "idn-hostname") == 0 ||
        strcmp(type_name, "iri") == 0 || strcmp(type_name, "iri-reference") == 0 ||
        strcmp(type_name, "json-pointer") == 0 || strcmp(type_name, "relative-json-pointer") == 0) {
        return cJSON_IsString(instance);
    }
    
    /* Abstract and choice types need special handling */
    if (strcmp(type_name, "abstract") == 0) return cJSON_IsObject(instance);
    if (strcmp(type_name, "choice") == 0) return cJSON_IsObject(instance);
    if (strcmp(type_name, "tuple") == 0) return cJSON_IsArray(instance);
    
    return false;
}

/* Check if integer value is within the range for the given integer type */
static bool check_integer_range(validate_context_t* ctx, double value, const char* type_name) {
    /* Ensure it's an integer first */
    if (value != floor(value)) {
        return false;
    }
    
    int64_t int_val = (int64_t)value;
    
    if (strcmp(type_name, "int8") == 0) {
        if (int_val < -128 || int_val > 127) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %lld is out of int8 range [-128, 127]", (long long)int_val);
            add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
            return false;
        }
    } else if (strcmp(type_name, "int16") == 0) {
        if (int_val < -32768 || int_val > 32767) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %lld is out of int16 range [-32768, 32767]", (long long)int_val);
            add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
            return false;
        }
    } else if (strcmp(type_name, "int32") == 0 || strcmp(type_name, "integer") == 0) {
        if (int_val < INT32_MIN || int_val > INT32_MAX) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %lld is out of int32 range", (long long)int_val);
            add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
            return false;
        }
    } else if (strcmp(type_name, "uint8") == 0) {
        if (int_val < 0 || int_val > 255) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %lld is out of uint8 range [0, 255]", (long long)int_val);
            add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
            return false;
        }
    } else if (strcmp(type_name, "uint16") == 0) {
        if (int_val < 0 || int_val > 65535) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %lld is out of uint16 range [0, 65535]", (long long)int_val);
            add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
            return false;
        }
    } else if (strcmp(type_name, "uint32") == 0) {
        if (int_val < 0 || (uint64_t)int_val > UINT32_MAX) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %lld is out of uint32 range [0, 4294967295]", (long long)int_val);
            add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
            return false;
        }
    }
    /* int64, uint64 - no range check needed as they match the native type */
    
    return true;
}

/* ============================================================================
 * Constraint Validation
 * ============================================================================ */

static bool validate_string_constraints(validate_context_t* ctx, const cJSON* instance, 
                                         const cJSON* schema) {
    const char* str = instance->valuestring;
    size_t len = strlen(str);
    bool valid = true;
    
    const cJSON* minLength = cJSON_GetObjectItemCaseSensitive(schema, "minLength");
    const cJSON* maxLength = cJSON_GetObjectItemCaseSensitive(schema, "maxLength");
    const cJSON* pattern = cJSON_GetObjectItemCaseSensitive(schema, "pattern");
    
    if (minLength && cJSON_IsNumber(minLength)) {
        if (len < (size_t)minLength->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "String too short (min %d, got %zu)",
                    (int)minLength->valuedouble, len);
            add_error(ctx, JS_INSTANCE_STRING_TOO_SHORT, msg);
            valid = false;
        }
    }
    
    if (maxLength && cJSON_IsNumber(maxLength)) {
        if (len > (size_t)maxLength->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "String too long (max %d, got %zu)",
                    (int)maxLength->valuedouble, len);
            add_error(ctx, JS_INSTANCE_STRING_TOO_LONG, msg);
            valid = false;
        }
    }
    
    if (pattern && cJSON_IsString(pattern)) {
        /* TODO: Implement regex matching with PCRE2 when available */
        (void)pattern;
    }
    
    return valid;
}

static bool validate_numeric_constraints(validate_context_t* ctx, const cJSON* instance,
                                          const cJSON* schema) {
    double value = instance->valuedouble;
    bool valid = true;
    
    const cJSON* minimum = cJSON_GetObjectItemCaseSensitive(schema, "minimum");
    const cJSON* maximum = cJSON_GetObjectItemCaseSensitive(schema, "maximum");
    const cJSON* exclusiveMinimum = cJSON_GetObjectItemCaseSensitive(schema, "exclusiveMinimum");
    const cJSON* exclusiveMaximum = cJSON_GetObjectItemCaseSensitive(schema, "exclusiveMaximum");
    const cJSON* multipleOf = cJSON_GetObjectItemCaseSensitive(schema, "multipleOf");
    
    if (minimum && cJSON_IsNumber(minimum)) {
        if (value < minimum->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %g is less than minimum %g",
                    value, minimum->valuedouble);
            add_error(ctx, JS_INSTANCE_NUMBER_TOO_SMALL, msg);
            valid = false;
        }
    }
    
    if (maximum && cJSON_IsNumber(maximum)) {
        if (value > maximum->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %g is greater than maximum %g",
                    value, maximum->valuedouble);
            add_error(ctx, JS_INSTANCE_NUMBER_TOO_LARGE, msg);
            valid = false;
        }
    }
    
    if (exclusiveMinimum && cJSON_IsNumber(exclusiveMinimum)) {
        if (value <= exclusiveMinimum->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %g must be greater than %g",
                    value, exclusiveMinimum->valuedouble);
            add_error(ctx, JS_INSTANCE_NUMBER_TOO_SMALL, msg);
            valid = false;
        }
    }
    
    if (exclusiveMaximum && cJSON_IsNumber(exclusiveMaximum)) {
        if (value >= exclusiveMaximum->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %g must be less than %g",
                    value, exclusiveMaximum->valuedouble);
            add_error(ctx, JS_INSTANCE_NUMBER_TOO_LARGE, msg);
            valid = false;
        }
    }
    
    if (multipleOf && cJSON_IsNumber(multipleOf) && multipleOf->valuedouble != 0) {
        double quotient = value / multipleOf->valuedouble;
        if (fabs(quotient - round(quotient)) > 1e-10) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %g is not a multiple of %g",
                    value, multipleOf->valuedouble);
            add_error(ctx, JS_INSTANCE_NUMBER_NOT_MULTIPLE, msg);
            valid = false;
        }
    }
    
    return valid;
}

static bool validate_array_constraints(validate_context_t* ctx, const cJSON* instance,
                                        const cJSON* schema) {
    int size = cJSON_GetArraySize(instance);
    bool valid = true;
    
    const cJSON* minItems = cJSON_GetObjectItemCaseSensitive(schema, "minItems");
    const cJSON* maxItems = cJSON_GetObjectItemCaseSensitive(schema, "maxItems");
    const cJSON* uniqueItems = cJSON_GetObjectItemCaseSensitive(schema, "uniqueItems");
    
    if (minItems && cJSON_IsNumber(minItems)) {
        if (size < (int)minItems->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Array too short (min %d, got %d)",
                    (int)minItems->valuedouble, size);
            add_error(ctx, JS_INSTANCE_ARRAY_TOO_SHORT, msg);
            valid = false;
        }
    }
    
    if (maxItems && cJSON_IsNumber(maxItems)) {
        if (size > (int)maxItems->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Array too long (max %d, got %d)",
                    (int)maxItems->valuedouble, size);
            add_error(ctx, JS_INSTANCE_ARRAY_TOO_LONG, msg);
            valid = false;
        }
    }
    
    if (uniqueItems && cJSON_IsTrue(uniqueItems)) {
        /* Check for duplicate items */
        for (int i = 0; i < size; i++) {
            cJSON* item_i = cJSON_GetArrayItem(instance, i);
            for (int j = i + 1; j < size; j++) {
                cJSON* item_j = cJSON_GetArrayItem(instance, j);
                if (cJSON_Compare(item_i, item_j, true)) {
                    char msg[128];
                    snprintf(msg, sizeof(msg), "Array items at indices %d and %d are not unique",
                            i, j);
                    add_error(ctx, JS_INSTANCE_ARRAY_NOT_UNIQUE, msg);
                    valid = false;
                    break;
                }
            }
        }
    }
    
    return valid;
}

static bool validate_object_constraints(validate_context_t* ctx, const cJSON* instance,
                                         const cJSON* schema) {
    int size = cJSON_GetArraySize(instance);
    bool valid = true;
    
    const cJSON* minProperties = cJSON_GetObjectItemCaseSensitive(schema, "minProperties");
    const cJSON* maxProperties = cJSON_GetObjectItemCaseSensitive(schema, "maxProperties");
    
    if (minProperties && cJSON_IsNumber(minProperties)) {
        if (size < (int)minProperties->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Too few properties (min %d, got %d)",
                    (int)minProperties->valuedouble, size);
            add_error(ctx, JS_INSTANCE_TOO_FEW_PROPERTIES, msg);
            valid = false;
        }
    }
    
    if (maxProperties && cJSON_IsNumber(maxProperties)) {
        if (size > (int)maxProperties->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Too many properties (max %d, got %d)",
                    (int)maxProperties->valuedouble, size);
            add_error(ctx, JS_INSTANCE_TOO_MANY_PROPERTIES, msg);
            valid = false;
        }
    }
    
    return valid;
}

/* ============================================================================
 * Enum/Const Validation
 * ============================================================================ */

static bool validate_enum(validate_context_t* ctx, const cJSON* instance, const cJSON* enum_arr) {
    cJSON* item;
    cJSON_ArrayForEach(item, enum_arr) {
        if (cJSON_Compare(instance, item, true)) {
            return true;
        }
    }
    add_error(ctx, JS_INSTANCE_ENUM_MISMATCH, "Value not in enum");
    return false;
}

static bool validate_const(validate_context_t* ctx, const cJSON* instance, const cJSON* const_val) {
    if (cJSON_Compare(instance, const_val, true)) {
        return true;
    }
    add_error(ctx, JS_INSTANCE_CONST_MISMATCH, "Value does not match const");
    return false;
}

/* ============================================================================
 * Type-Specific Validation
 * ============================================================================ */

static bool validate_object_instance(validate_context_t* ctx, const cJSON* instance,
                                      const cJSON* schema) {
    bool valid = true;
    
    const cJSON* properties = cJSON_GetObjectItemCaseSensitive(schema, "properties");
    const cJSON* required = cJSON_GetObjectItemCaseSensitive(schema, "required");
    const cJSON* additionalProperties = cJSON_GetObjectItemCaseSensitive(schema, "additionalProperties");
    
    /* Check required properties */
    if (required && cJSON_IsArray(required)) {
        cJSON* req_item;
        cJSON_ArrayForEach(req_item, required) {
            if (cJSON_IsString(req_item)) {
                const cJSON* prop = cJSON_GetObjectItemCaseSensitive(instance, req_item->valuestring);
                if (!prop) {
                    char msg[256];
                    snprintf(msg, sizeof(msg), "Required property '%s' is missing",
                            req_item->valuestring);
                    add_error(ctx, JS_INSTANCE_REQUIRED_MISSING, msg);
                    valid = false;
                }
            }
        }
    }
    
    /* Validate each property */
    cJSON* prop;
    cJSON_ArrayForEach(prop, instance) {
        const char* prop_name = prop->string;
        const cJSON* prop_schema = NULL;
        
        if (properties && cJSON_IsObject(properties)) {
            prop_schema = cJSON_GetObjectItemCaseSensitive(properties, prop_name);
        }
        
        if (prop_schema) {
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, prop_name);
            if (!validate_instance(ctx, prop, prop_schema)) {
                valid = false;
            }
            pop_path(ctx, prev_len);
        } else if (additionalProperties) {
            /* Schema explicitly controls additional properties */
            if (cJSON_IsFalse(additionalProperties)) {
                /* additionalProperties: false - reject additional properties */
                char msg[256];
                snprintf(msg, sizeof(msg), "Additional property '%s' not allowed", prop_name);
                add_error(ctx, JS_INSTANCE_ADDITIONAL_PROPERTY, msg);
                valid = false;
            } else if (cJSON_IsObject(additionalProperties)) {
                size_t prev_len = strlen(ctx->path);
                push_path(ctx, prop_name);
                if (!validate_instance(ctx, prop, additionalProperties)) {
                    valid = false;
                }
                pop_path(ctx, prev_len);
            }
            /* additionalProperties: true or missing - allow */
        } else if (!ctx->validator->options.allow_additional_properties) {
            /* No additionalProperties in schema, use validator option */
            char msg[256];
            snprintf(msg, sizeof(msg), "Additional property '%s' not allowed", prop_name);
            add_error(ctx, JS_INSTANCE_ADDITIONAL_PROPERTY, msg);
            valid = false;
        }
    }
    
    /* Validate object constraints */
    if (!validate_object_constraints(ctx, instance, schema)) {
        valid = false;
    }
    
    return valid;
}

static bool validate_array_instance(validate_context_t* ctx, const cJSON* instance,
                                     const cJSON* schema) {
    bool valid = true;
    
    const cJSON* items = cJSON_GetObjectItemCaseSensitive(schema, "items");
    
    /* Validate each item */
    if (items) {
        int idx = 0;
        cJSON* item;
        cJSON_ArrayForEach(item, instance) {
            char idx_str[32];
            snprintf(idx_str, sizeof(idx_str), "[%d]", idx);
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, idx_str);
            
            if (!validate_instance(ctx, item, items)) {
                valid = false;
            }
            
            pop_path(ctx, prev_len);
            idx++;
        }
    }
    
    /* Validate array constraints */
    if (!validate_array_constraints(ctx, instance, schema)) {
        valid = false;
    }
    
    return valid;
}

static bool validate_set_instance(validate_context_t* ctx, const cJSON* instance,
                                   const cJSON* schema) {
    bool valid = true;
    
    const cJSON* items = cJSON_GetObjectItemCaseSensitive(schema, "items");
    
    /* Validate each item */
    if (items) {
        int idx = 0;
        cJSON* item;
        cJSON_ArrayForEach(item, instance) {
            char idx_str[32];
            snprintf(idx_str, sizeof(idx_str), "[%d]", idx);
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, idx_str);
            
            if (!validate_instance(ctx, item, items)) {
                valid = false;
            }
            
            pop_path(ctx, prev_len);
            idx++;
        }
    }
    
    /* Sets must have unique items - always check regardless of uniqueItems keyword */
    int size = cJSON_GetArraySize(instance);
    for (int i = 0; i < size; i++) {
        cJSON* item_i = cJSON_GetArrayItem(instance, i);
        for (int j = i + 1; j < size; j++) {
            cJSON* item_j = cJSON_GetArrayItem(instance, j);
            if (cJSON_Compare(item_i, item_j, true)) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Set items at indices %d and %d are not unique",
                        i, j);
                add_error(ctx, JS_INSTANCE_SET_NOT_UNIQUE, msg);
                valid = false;
                break;
            }
        }
    }
    
    /* Validate other array constraints (minItems, maxItems) */
    const cJSON* minItems = cJSON_GetObjectItemCaseSensitive(schema, "minItems");
    const cJSON* maxItems = cJSON_GetObjectItemCaseSensitive(schema, "maxItems");
    
    if (minItems && cJSON_IsNumber(minItems)) {
        if (size < (int)minItems->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Set too small (min %d, got %d)",
                    (int)minItems->valuedouble, size);
            add_error(ctx, JS_INSTANCE_ARRAY_TOO_SHORT, msg);
            valid = false;
        }
    }
    
    if (maxItems && cJSON_IsNumber(maxItems)) {
        if (size > (int)maxItems->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Set too large (max %d, got %d)",
                    (int)maxItems->valuedouble, size);
            add_error(ctx, JS_INSTANCE_ARRAY_TOO_LONG, msg);
            valid = false;
        }
    }
    
    return valid;
}

static bool validate_map_instance(validate_context_t* ctx, const cJSON* instance,
                                   const cJSON* schema) {
    bool valid = true;
    
    const cJSON* values = cJSON_GetObjectItemCaseSensitive(schema, "values");
    const cJSON* keys = cJSON_GetObjectItemCaseSensitive(schema, "keys");
    
    cJSON* entry;
    cJSON_ArrayForEach(entry, instance) {
        const char* key = entry->string;
        
        /* Validate key pattern if specified */
        if (keys && cJSON_IsObject(keys)) {
            const cJSON* key_pattern = cJSON_GetObjectItemCaseSensitive(keys, "pattern");
            if (key_pattern && cJSON_IsString(key_pattern)) {
                /* TODO: Validate key against pattern using PCRE2 */
                (void)key;
            }
        }
        
        /* Validate value */
        if (values) {
            size_t prev_len = strlen(ctx->path);
            char key_path[PATH_BUFFER_SIZE];
            snprintf(key_path, sizeof(key_path), "[%s]", key);
            push_path(ctx, key_path);
            
            if (!validate_instance(ctx, entry, values)) {
                valid = false;
            }
            
            pop_path(ctx, prev_len);
        }
    }
    
    /* Validate map size constraints */
    int size = cJSON_GetArraySize(instance);
    const cJSON* minProperties = cJSON_GetObjectItemCaseSensitive(schema, "minProperties");
    const cJSON* maxProperties = cJSON_GetObjectItemCaseSensitive(schema, "maxProperties");
    
    if (minProperties && cJSON_IsNumber(minProperties)) {
        if (size < (int)minProperties->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Map has too few entries (min %d, got %d)",
                    (int)minProperties->valuedouble, size);
            add_error(ctx, JS_INSTANCE_MAP_TOO_FEW_ENTRIES, msg);
            valid = false;
        }
    }
    
    if (maxProperties && cJSON_IsNumber(maxProperties)) {
        if (size > (int)maxProperties->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Map has too many entries (max %d, got %d)",
                    (int)maxProperties->valuedouble, size);
            add_error(ctx, JS_INSTANCE_MAP_TOO_MANY_ENTRIES, msg);
            valid = false;
        }
    }
    
    return valid;
}

static bool validate_choice_instance(validate_context_t* ctx, const cJSON* instance,
                                      const cJSON* schema) {
    const cJSON* choices = cJSON_GetObjectItemCaseSensitive(schema, "choices");
    const cJSON* selector = cJSON_GetObjectItemCaseSensitive(schema, "selector");
    
    if (!choices || !cJSON_IsObject(choices)) {
        add_error(ctx, JS_INSTANCE_CHOICE_NO_MATCH, "Schema missing choices");
        return false;
    }
    
    /* If selector is specified, use it to determine the choice */
    if (selector && cJSON_IsString(selector)) {
        const cJSON* selector_value = cJSON_GetObjectItemCaseSensitive(instance, selector->valuestring);
        if (!selector_value) {
            add_error(ctx, JS_INSTANCE_CHOICE_SELECTOR_MISSING, "Choice selector property missing");
            return false;
        }
        if (!cJSON_IsString(selector_value)) {
            add_error(ctx, JS_INSTANCE_CHOICE_SELECTOR_INVALID, "Choice selector must be a string");
            return false;
        }
        
        const cJSON* choice_schema = cJSON_GetObjectItemCaseSensitive(choices, selector_value->valuestring);
        if (!choice_schema) {
            char msg[256];
            snprintf(msg, sizeof(msg), "Unknown choice: '%s'", selector_value->valuestring);
            add_error(ctx, JS_INSTANCE_CHOICE_UNKNOWN, msg);
            return false;
        }
        
        return validate_instance(ctx, instance, choice_schema);
    }
    
    /* Without selector, try each choice and find a match */
    int match_count = 0;
    const cJSON* matched_choice = NULL;
    
    cJSON* choice;
    cJSON_ArrayForEach(choice, choices) {
        js_result_t temp_result;
        js_result_init(&temp_result);
        
        validate_context_t temp_ctx = *ctx;
        temp_ctx.result = &temp_result;
        
        if (validate_instance(&temp_ctx, instance, choice)) {
            match_count++;
            matched_choice = choice;
        }
        
        js_result_cleanup(&temp_result);
    }
    
    if (match_count == 0) {
        add_error(ctx, JS_INSTANCE_CHOICE_NO_MATCH, "No matching choice");
        return false;
    }
    
    if (match_count > 1) {
        add_error(ctx, JS_INSTANCE_CHOICE_MULTIPLE_MATCHES, "Multiple choices matched");
        return false;
    }
    
    /* Re-validate against the matched choice to populate errors if any */
    return validate_instance(ctx, instance, matched_choice);
}

/* ============================================================================
 * Composition Validation
 * ============================================================================ */

static bool validate_allOf(validate_context_t* ctx, const cJSON* instance, const cJSON* allOf) {
    bool valid = true;
    int idx = 0;
    cJSON* subschema;
    cJSON_ArrayForEach(subschema, allOf) {
        char idx_str[32];
        snprintf(idx_str, sizeof(idx_str), "allOf[%d]", idx);
        size_t prev_len = strlen(ctx->path);
        push_path(ctx, idx_str);
        
        if (!validate_instance(ctx, instance, subschema)) {
            valid = false;
        }
        
        pop_path(ctx, prev_len);
        idx++;
    }
    return valid;
}

static bool validate_anyOf(validate_context_t* ctx, const cJSON* instance, const cJSON* anyOf) {
    cJSON* subschema;
    cJSON_ArrayForEach(subschema, anyOf) {
        js_result_t temp_result;
        js_result_init(&temp_result);
        
        validate_context_t temp_ctx = *ctx;
        temp_ctx.result = &temp_result;
        
        if (validate_instance(&temp_ctx, instance, subschema)) {
            js_result_cleanup(&temp_result);
            return true;
        }
        
        js_result_cleanup(&temp_result);
    }
    
    add_error(ctx, JS_INSTANCE_ANYOF_FAILED, "No schema in anyOf matched");
    return false;
}

static bool validate_oneOf(validate_context_t* ctx, const cJSON* instance, const cJSON* oneOf) {
    int match_count = 0;
    
    cJSON* subschema;
    cJSON_ArrayForEach(subschema, oneOf) {
        js_result_t temp_result;
        js_result_init(&temp_result);
        
        validate_context_t temp_ctx = *ctx;
        temp_ctx.result = &temp_result;
        
        if (validate_instance(&temp_ctx, instance, subschema)) {
            match_count++;
        }
        
        js_result_cleanup(&temp_result);
    }
    
    if (match_count == 0) {
        add_error(ctx, JS_INSTANCE_ONEOF_FAILED, "No schema in oneOf matched");
        return false;
    }
    
    if (match_count > 1) {
        add_error(ctx, JS_INSTANCE_ONEOF_MULTIPLE, "Multiple schemas in oneOf matched");
        return false;
    }
    
    return true;
}

static bool validate_not(validate_context_t* ctx, const cJSON* instance, const cJSON* not_schema) {
    js_result_t temp_result;
    js_result_init(&temp_result);
    
    validate_context_t temp_ctx = *ctx;
    temp_ctx.result = &temp_result;
    
    bool matches = validate_instance(&temp_ctx, instance, not_schema);
    js_result_cleanup(&temp_result);
    
    if (matches) {
        add_error(ctx, JS_INSTANCE_NOT_FAILED, "Value matches schema in 'not'");
        return false;
    }
    
    return true;
}

static bool validate_if_then_else(validate_context_t* ctx, const cJSON* instance,
                                   const cJSON* if_schema, const cJSON* then_schema,
                                   const cJSON* else_schema) {
    js_result_t temp_result;
    js_result_init(&temp_result);
    
    validate_context_t temp_ctx = *ctx;
    temp_ctx.result = &temp_result;
    
    bool if_matches = validate_instance(&temp_ctx, instance, if_schema);
    js_result_cleanup(&temp_result);
    
    if (if_matches) {
        if (then_schema) {
            return validate_instance(ctx, instance, then_schema);
        }
    } else {
        if (else_schema) {
            return validate_instance(ctx, instance, else_schema);
        }
    }
    
    return true;
}

/* ============================================================================
 * Main Validation Logic
 * ============================================================================ */

static bool validate_instance(validate_context_t* ctx, const cJSON* instance, const cJSON* schema) {
    if (!schema || !cJSON_IsObject(schema)) {
        return true; /* Empty or invalid schema matches anything */
    }
    
    ctx->depth++;
    if (ctx->depth > MAX_DEPTH) {
        add_error(ctx, JS_SCHEMA_MAX_DEPTH_EXCEEDED, "Maximum validation depth exceeded");
        ctx->depth--;
        return false;
    }
    
    bool valid = true;
    
    /* Handle $ref */
    const cJSON* ref = cJSON_GetObjectItemCaseSensitive(schema, "$ref");
    if (ref && cJSON_IsString(ref)) {
        const cJSON* resolved = resolve_ref(ctx, ref->valuestring);
        if (!resolved) {
            char msg[256];
            snprintf(msg, sizeof(msg), "Cannot resolve reference: %s", ref->valuestring);
            add_error(ctx, JS_INSTANCE_REF_NOT_FOUND, msg);
            ctx->depth--;
            return false;
        }
        bool result = validate_instance(ctx, instance, resolved);
        ctx->depth--;
        return result;
    }
    
    /* Check type */
    const cJSON* type_node = cJSON_GetObjectItemCaseSensitive(schema, "type");
    if (type_node) {
        /* Handle type as object with $ref (JSON Structure pattern) */
        if (cJSON_IsObject(type_node)) {
            const cJSON* type_ref = cJSON_GetObjectItemCaseSensitive(type_node, "$ref");
            if (type_ref && cJSON_IsString(type_ref)) {
                const cJSON* resolved = resolve_ref(ctx, type_ref->valuestring);
                if (!resolved) {
                    char msg[256];
                    snprintf(msg, sizeof(msg), "Cannot resolve type reference: %s", type_ref->valuestring);
                    add_error(ctx, JS_INSTANCE_REF_NOT_FOUND, msg);
                    ctx->depth--;
                    return false;
                }
                bool result = validate_instance(ctx, instance, resolved);
                ctx->depth--;
                return result;
            }
        } else if (cJSON_IsString(type_node)) {
            const char* type_str = type_node->valuestring;
            if (!check_type_match(instance, type_str)) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Expected type '%s'", type_str);
                add_error(ctx, JS_INSTANCE_TYPE_MISMATCH, msg);
                valid = false;
            } else {
                /* Type-specific validation and constraints */
                if (strcmp(type_str, "object") == 0) {
                    if (!validate_object_instance(ctx, instance, schema)) valid = false;
                } else if (strcmp(type_str, "array") == 0) {
                    if (!validate_array_instance(ctx, instance, schema)) valid = false;
                } else if (strcmp(type_str, "set") == 0) {
                    if (!validate_set_instance(ctx, instance, schema)) valid = false;
                } else if (strcmp(type_str, "map") == 0) {
                    if (!validate_map_instance(ctx, instance, schema)) valid = false;
                } else if (strcmp(type_str, "choice") == 0) {
                    if (!validate_choice_instance(ctx, instance, schema)) valid = false;
                } else if (strcmp(type_str, "string") == 0 || js_type_is_string(js_type_from_name(type_str))) {
                    if (cJSON_IsString(instance)) {
                        if (!validate_string_constraints(ctx, instance, schema)) valid = false;
                    }
                } else if (js_type_is_numeric(js_type_from_name(type_str))) {
                    if (cJSON_IsNumber(instance)) {
                        if (!validate_numeric_constraints(ctx, instance, schema)) valid = false;
                        /* Check integer range for sized types */
                        if (js_type_is_integer(js_type_from_name(type_str))) {
                            if (!check_integer_range(ctx, instance->valuedouble, type_str)) {
                                valid = false;
                            }
                        }
                    }
                }
            }
        } else if (cJSON_IsArray(type_node)) {
            /* Union types - check if instance matches any type */
            bool type_matched = false;
            cJSON* type_item;
            cJSON_ArrayForEach(type_item, type_node) {
                if (cJSON_IsString(type_item) && check_type_match(instance, type_item->valuestring)) {
                    type_matched = true;
                    break;
                }
            }
            if (!type_matched) {
                add_error(ctx, JS_INSTANCE_UNION_NO_MATCH, "Value does not match any type in union");
                valid = false;
            }
        }
    }
    
    /* Validate enum */
    const cJSON* enum_node = cJSON_GetObjectItemCaseSensitive(schema, "enum");
    if (enum_node && cJSON_IsArray(enum_node)) {
        if (!validate_enum(ctx, instance, enum_node)) valid = false;
    }
    
    /* Validate const */
    const cJSON* const_node = cJSON_GetObjectItemCaseSensitive(schema, "const");
    if (const_node) {
        if (!validate_const(ctx, instance, const_node)) valid = false;
    }
    
    /* Composition keywords */
    const cJSON* allOf = cJSON_GetObjectItemCaseSensitive(schema, "allOf");
    const cJSON* anyOf = cJSON_GetObjectItemCaseSensitive(schema, "anyOf");
    const cJSON* oneOf = cJSON_GetObjectItemCaseSensitive(schema, "oneOf");
    const cJSON* not_schema = cJSON_GetObjectItemCaseSensitive(schema, "not");
    const cJSON* if_schema = cJSON_GetObjectItemCaseSensitive(schema, "if");
    const cJSON* then_schema = cJSON_GetObjectItemCaseSensitive(schema, "then");
    const cJSON* else_schema = cJSON_GetObjectItemCaseSensitive(schema, "else");
    
    if (allOf && cJSON_IsArray(allOf)) {
        if (!validate_allOf(ctx, instance, allOf)) valid = false;
    }
    
    if (anyOf && cJSON_IsArray(anyOf)) {
        if (!validate_anyOf(ctx, instance, anyOf)) valid = false;
    }
    
    if (oneOf && cJSON_IsArray(oneOf)) {
        if (!validate_oneOf(ctx, instance, oneOf)) valid = false;
    }
    
    if (not_schema) {
        if (!validate_not(ctx, instance, not_schema)) valid = false;
    }
    
    if (if_schema) {
        if (!validate_if_then_else(ctx, instance, if_schema, then_schema, else_schema)) valid = false;
    }
    
    ctx->depth--;
    return valid;
}

/* ============================================================================
 * Public API
 * ============================================================================ */

void js_instance_validator_init(js_instance_validator_t* validator) {
    if (validator) {
        validator->options = JS_INSTANCE_OPTIONS_DEFAULT;
    }
}

void js_instance_validator_init_with_options(js_instance_validator_t* validator,
                                              js_instance_options_t options) {
    if (validator) {
        validator->options = options;
    }
}

bool js_instance_validate(const js_instance_validator_t* validator,
                          const cJSON* instance,
                          const cJSON* schema,
                          js_result_t* result) {
    if (!validator || !result) return false;
    
    js_result_init(result);
    
    if (!instance) {
        js_result_add_error(result, JS_INSTANCE_TYPE_MISMATCH, "Instance is null", "");
        return false;
    }
    
    if (!schema) {
        js_result_add_error(result, JS_SCHEMA_NULL, "Schema is null", "");
        return false;
    }
    
    /* Cache definitions for reference resolution */
    const cJSON* defs = cJSON_GetObjectItemCaseSensitive(schema, "$defs");
    if (!defs) {
        defs = cJSON_GetObjectItemCaseSensitive(schema, "$definitions");
    }
    
    validate_context_t ctx = {
        .validator = validator,
        .result = result,
        .root_schema = schema,
        .definitions = defs,
        .path = "",
        .depth = 0
    };
    
    return validate_instance(&ctx, instance, schema);
}

bool js_instance_validate_strings(const js_instance_validator_t* validator,
                                   const char* instance_json,
                                   const char* schema_json,
                                   js_result_t* result) {
    if (!validator || !result) return false;
    
    js_result_init(result);
    
    if (!instance_json) {
        js_result_add_error(result, JS_INSTANCE_TYPE_MISMATCH, "Instance JSON is null", "");
        return false;
    }
    
    if (!schema_json) {
        js_result_add_error(result, JS_SCHEMA_NULL, "Schema JSON is null", "");
        return false;
    }
    
    cJSON* instance = cJSON_Parse(instance_json);
    if (!instance) {
        const char* error_ptr = cJSON_GetErrorPtr();
        char msg[256];
        if (error_ptr) {
            snprintf(msg, sizeof(msg), "Instance JSON parse error near: %.50s", error_ptr);
        } else {
            snprintf(msg, sizeof(msg), "Instance JSON parse error");
        }
        js_result_add_error(result, JS_INSTANCE_TYPE_MISMATCH, msg, "");
        return false;
    }
    
    cJSON* schema = cJSON_Parse(schema_json);
    if (!schema) {
        const char* error_ptr = cJSON_GetErrorPtr();
        char msg[256];
        if (error_ptr) {
            snprintf(msg, sizeof(msg), "Schema JSON parse error near: %.50s", error_ptr);
        } else {
            snprintf(msg, sizeof(msg), "Schema JSON parse error");
        }
        js_result_add_error(result, JS_SCHEMA_INVALID_TYPE, msg, "");
        cJSON_Delete(instance);
        return false;
    }
    
    bool valid = js_instance_validate(validator, instance, schema, result);
    
    cJSON_Delete(instance);
    cJSON_Delete(schema);
    
    return valid;
}
