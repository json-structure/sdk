/**
 * @file types.c
 * @brief Core types implementation for JSON Structure validation
 * 
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#include "json_structure/types.h"
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <stdio.h>

/* ============================================================================
 * Default allocator
 * ============================================================================ */

static void* default_alloc(size_t size, void* user_data) {
    (void)user_data;
    return malloc(size);
}

static void* default_realloc(void* ptr, size_t size, void* user_data) {
    (void)user_data;
    return realloc(ptr, size);
}

static void default_free(void* ptr, void* user_data) {
    (void)user_data;
    free(ptr);
}

static const js_allocator_t s_default_allocator = {
    .alloc = default_alloc,
    .realloc = default_realloc,
    .free = default_free,
    .user_data = NULL
};

const js_allocator_t* js_default_allocator(void) {
    return &s_default_allocator;
}

/* ============================================================================
 * String utilities
 * ============================================================================ */

bool js_str_eq(js_str_t a, js_str_t b) {
    if (a.len != b.len) return false;
    if (a.len == 0) return true;
    if (a.data == NULL || b.data == NULL) return a.data == b.data;
    return memcmp(a.data, b.data, a.len) == 0;
}

bool js_str_eq_cstr(js_str_t s, const char* cstr) {
    if (cstr == NULL) return s.data == NULL || s.len == 0;
    size_t clen = strlen(cstr);
    if (s.len != clen) return false;
    if (s.data == NULL) return false;
    return memcmp(s.data, cstr, clen) == 0;
}

/* ============================================================================
 * Validation result
 * ============================================================================ */

void js_result_init(js_result_t* result, const js_allocator_t* alloc) {
    if (!result) return;
    memset(result, 0, sizeof(*result));
    result->alloc = alloc ? alloc : js_default_allocator();
}

void js_result_cleanup(js_result_t* result) {
    if (!result) return;
    if (result->errors && result->alloc) {
        result->alloc->free(result->errors, result->alloc->user_data);
    }
    memset(result, 0, sizeof(*result));
}

static bool js_result_grow(js_result_t* result) {
    size_t new_cap = result->error_capacity == 0 
        ? JS_INITIAL_CAPACITY 
        : result->error_capacity * 2;
    
    if (new_cap > JS_MAX_ERRORS) {
        new_cap = JS_MAX_ERRORS;
        if (result->error_count >= new_cap) {
            return false;
        }
    }
    
    js_error_t* new_errors = (js_error_t*)result->alloc->realloc(
        result->errors,
        new_cap * sizeof(js_error_t),
        result->alloc->user_data
    );
    
    if (!new_errors) return false;
    
    result->errors = new_errors;
    result->error_capacity = new_cap;
    return true;
}

bool js_result_add_error(js_result_t* result, int code, js_severity_t severity,
                         js_location_t location, const char* path, const char* message) {
    if (!result) return false;
    
    if (result->error_count >= result->error_capacity) {
        if (!js_result_grow(result)) {
            return false;
        }
    }
    
    js_error_t* err = &result->errors[result->error_count];
    err->code = code;
    err->severity = severity;
    err->location = location;
    
    if (path) {
        strncpy(err->path, path, JS_MAX_PATH_LEN - 1);
        err->path[JS_MAX_PATH_LEN - 1] = '\0';
    } else {
        err->path[0] = '\0';
    }
    
    if (message) {
        strncpy(err->message, message, JS_MAX_MESSAGE_LEN - 1);
        err->message[JS_MAX_MESSAGE_LEN - 1] = '\0';
    } else {
        err->message[0] = '\0';
    }
    
    result->error_count++;
    if (severity == JS_SEVERITY_WARNING) {
        result->warning_count++;
    }
    
    return true;
}

bool js_result_add_errorf(js_result_t* result, int code, js_severity_t severity,
                          js_location_t location, const char* path, const char* fmt, ...) {
    char message[JS_MAX_MESSAGE_LEN];
    va_list args;
    va_start(args, fmt);
    vsnprintf(message, sizeof(message), fmt, args);
    va_end(args);
    return js_result_add_error(result, code, severity, location, path, message);
}

bool js_result_is_valid(const js_result_t* result) {
    if (!result) return true;
    /* Valid if no errors (warnings are OK) */
    return (result->error_count - result->warning_count) == 0;
}

bool js_result_is_clean(const js_result_t* result) {
    if (!result) return true;
    return result->error_count == 0;
}

size_t js_result_error_count(const js_result_t* result) {
    if (!result) return 0;
    return result->error_count - result->warning_count;
}

size_t js_result_warning_count(const js_result_t* result) {
    if (!result) return 0;
    return result->warning_count;
}

/* ============================================================================
 * Type utilities
 * ============================================================================ */

/* Type name lookup table */
static const struct {
    const char* name;
    js_type_t type;
} s_type_names[] = {
    {"string", JS_TYPE_STRING},
    {"boolean", JS_TYPE_BOOLEAN},
    {"null", JS_TYPE_NULL},
    {"number", JS_TYPE_NUMBER},
    {"integer", JS_TYPE_INTEGER},
    {"int8", JS_TYPE_INT8},
    {"int16", JS_TYPE_INT16},
    {"int32", JS_TYPE_INT32},
    {"int64", JS_TYPE_INT64},
    {"int128", JS_TYPE_INT128},
    {"uint8", JS_TYPE_UINT8},
    {"uint16", JS_TYPE_UINT16},
    {"uint32", JS_TYPE_UINT32},
    {"uint64", JS_TYPE_UINT64},
    {"uint128", JS_TYPE_UINT128},
    {"float", JS_TYPE_FLOAT},
    {"float8", JS_TYPE_FLOAT8},
    {"double", JS_TYPE_DOUBLE},
    {"decimal", JS_TYPE_DECIMAL},
    {"date", JS_TYPE_DATE},
    {"time", JS_TYPE_TIME},
    {"datetime", JS_TYPE_DATETIME},
    {"duration", JS_TYPE_DURATION},
    {"uuid", JS_TYPE_UUID},
    {"uri", JS_TYPE_URI},
    {"binary", JS_TYPE_BINARY},
    {"jsonpointer", JS_TYPE_JSONPOINTER},
    {"object", JS_TYPE_OBJECT},
    {"array", JS_TYPE_ARRAY},
    {"set", JS_TYPE_SET},
    {"map", JS_TYPE_MAP},
    {"tuple", JS_TYPE_TUPLE},
    {"choice", JS_TYPE_CHOICE},
    {"any", JS_TYPE_ANY},
    {NULL, JS_TYPE_UNKNOWN}
};

bool js_type_is_primitive(js_type_t type) {
    return type >= JS_TYPE_STRING && type <= JS_TYPE_JSONPOINTER;
}

bool js_type_is_compound(js_type_t type) {
    return type >= JS_TYPE_OBJECT && type <= JS_TYPE_ANY;
}

bool js_type_is_numeric(js_type_t type) {
    return type == JS_TYPE_NUMBER ||
           type == JS_TYPE_INTEGER ||
           (type >= JS_TYPE_INT8 && type <= JS_TYPE_DECIMAL);
}

bool js_type_is_integer(js_type_t type) {
    return type == JS_TYPE_INTEGER ||
           (type >= JS_TYPE_INT8 && type <= JS_TYPE_UINT128);
}

js_type_t js_type_from_str(js_str_t name) {
    if (JS_STR_IS_EMPTY(name)) return JS_TYPE_UNKNOWN;
    
    for (size_t i = 0; s_type_names[i].name != NULL; i++) {
        if (js_str_eq_cstr(name, s_type_names[i].name)) {
            return s_type_names[i].type;
        }
    }
    return JS_TYPE_UNKNOWN;
}

const char* js_type_to_str(js_type_t type) {
    for (size_t i = 0; s_type_names[i].name != NULL; i++) {
        if (s_type_names[i].type == type) {
            return s_type_names[i].name;
        }
    }
    return "unknown";
}

/* ============================================================================
 * Extension utilities
 * ============================================================================ */

static const struct {
    const char* name;
    js_extension_t ext;
} s_extension_names[] = {
    {"JSONStructureValidation", JS_EXT_VALIDATION},
    {"JSONStructureConditionalComposition", JS_EXT_CONDITIONAL_COMPOSITION},
    {"JSONStructureImport", JS_EXT_IMPORT},
    {"JSONStructureAlternateNames", JS_EXT_ALTERNATE_NAMES},
    {"JSONStructureUnits", JS_EXT_UNITS},
    {NULL, JS_EXT_NONE}
};

js_extension_t js_extension_from_str(js_str_t name) {
    if (JS_STR_IS_EMPTY(name)) return JS_EXT_NONE;
    
    for (size_t i = 0; s_extension_names[i].name != NULL; i++) {
        if (js_str_eq_cstr(name, s_extension_names[i].name)) {
            return s_extension_names[i].ext;
        }
    }
    return JS_EXT_NONE;
}

const char* js_extension_to_str(js_extension_t ext) {
    for (size_t i = 0; s_extension_names[i].name != NULL; i++) {
        if (s_extension_names[i].ext == ext) {
            return s_extension_names[i].name;
        }
    }
    return NULL;
}
