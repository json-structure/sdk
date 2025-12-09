/**
 * @file types.c
 * @brief JSON Structure core types implementation
 *
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#include "json_structure/types.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

/* Thread synchronization for allocator */
#if defined(_WIN32)
#include <windows.h>
typedef CRITICAL_SECTION js_mutex_t;
#define JS_MUTEX_INIT(m) InitializeCriticalSection(m)
#define JS_MUTEX_LOCK(m) EnterCriticalSection(m)
#define JS_MUTEX_UNLOCK(m) LeaveCriticalSection(m)
#define JS_MUTEX_DESTROY(m) DeleteCriticalSection(m)
#else
#include <pthread.h>
typedef pthread_mutex_t js_mutex_t;
#define JS_MUTEX_INIT(m) pthread_mutex_init(m, NULL)
#define JS_MUTEX_LOCK(m) pthread_mutex_lock(m)
#define JS_MUTEX_UNLOCK(m) pthread_mutex_unlock(m)
#define JS_MUTEX_DESTROY(m) pthread_mutex_destroy(m)
#endif

/* ============================================================================
 * Default Allocator
 * ============================================================================ */

static void* default_malloc(size_t size) {
    return malloc(size);
}

static void* default_realloc(void* ptr, size_t size) {
    return realloc(ptr, size);
}

static void default_free(void* ptr) {
    free(ptr);
}

/* Global allocator - initialized to default */
static js_allocator_t g_allocator = {
    default_malloc,
    default_realloc,
    default_free,
    NULL
};

/* Mutex to protect allocator access */
static js_mutex_t g_allocator_mutex;
static bool g_allocator_mutex_initialized = false;

/* Initialize allocator mutex if needed */
static void ensure_allocator_mutex_init(void) {
    /* Note: This is not thread-safe itself, but it's called from
     * js_init() which should be called once before any other library usage.
     * For concurrent first-time initialization, use js_init() explicitly. */
    if (!g_allocator_mutex_initialized) {
        JS_MUTEX_INIT(&g_allocator_mutex);
        g_allocator_mutex_initialized = true;
    }
}

/* Public functions for mutex lifecycle management */
void js_init_allocator_mutex(void) {
    ensure_allocator_mutex_init();
}

void js_destroy_allocator_mutex(void) {
    if (g_allocator_mutex_initialized) {
        JS_MUTEX_DESTROY(&g_allocator_mutex);
        g_allocator_mutex_initialized = false;
    }
}

/* ============================================================================
 * Allocator Functions
 * ============================================================================ */

void js_set_allocator(js_allocator_t alloc) {
    ensure_allocator_mutex_init();
    
    JS_MUTEX_LOCK(&g_allocator_mutex);
    
    if (alloc.malloc && alloc.free) {
        g_allocator = alloc;
        /* Configure cJSON to use our allocator */
        cJSON_Hooks hooks = {
            .malloc_fn = alloc.malloc,
            .free_fn = alloc.free
        };
        cJSON_InitHooks(&hooks);
    } else {
        /* Reset to defaults */
        g_allocator.malloc = default_malloc;
        g_allocator.realloc = default_realloc;
        g_allocator.free = default_free;
        g_allocator.user_data = NULL;
        cJSON_InitHooks(NULL);
    }
    
    JS_MUTEX_UNLOCK(&g_allocator_mutex);
}

js_allocator_t js_get_allocator(void) {
    ensure_allocator_mutex_init();
    
    JS_MUTEX_LOCK(&g_allocator_mutex);
    js_allocator_t alloc = g_allocator;
    JS_MUTEX_UNLOCK(&g_allocator_mutex);
    
    return alloc;
}

void* js_malloc(size_t size) {
    ensure_allocator_mutex_init();
    
    JS_MUTEX_LOCK(&g_allocator_mutex);
    void* ptr = g_allocator.malloc(size);
    JS_MUTEX_UNLOCK(&g_allocator_mutex);
    
    return ptr;
}

void* js_realloc(void* ptr, size_t size) {
    ensure_allocator_mutex_init();
    
    JS_MUTEX_LOCK(&g_allocator_mutex);
    void* result;
    if (g_allocator.realloc) {
        result = g_allocator.realloc(ptr, size);
    } else {
        /* No realloc provided - cannot safely reallocate without knowing original size.
         * Return NULL to signal failure. Callers should ensure realloc is provided
         * in custom allocators, or this path should not be reached with default allocator. */
        if (ptr) {
            result = NULL;  /* Cannot safely reallocate existing memory */
        } else {
            /* For NULL ptr, realloc acts like malloc */
            result = g_allocator.malloc(size);
        }
    }
    JS_MUTEX_UNLOCK(&g_allocator_mutex);
    
    return result;
}

void js_free(void* ptr) {
    if (ptr) {
        ensure_allocator_mutex_init();
        
        JS_MUTEX_LOCK(&g_allocator_mutex);
        g_allocator.free(ptr);
        JS_MUTEX_UNLOCK(&g_allocator_mutex);
    }
}

char* js_strdup(const char* s) {
    if (!s) return NULL;
    size_t len = strlen(s) + 1;
    char* copy = (char*)js_malloc(len);
    if (copy) {
        memcpy(copy, s, len);
    }
    return copy;
}

/* ============================================================================
 * Type Utilities
 * ============================================================================ */

bool js_type_is_primitive(js_type_t type) {
    switch (type) {
        case JS_TYPE_NULL:
        case JS_TYPE_BOOLEAN:
        case JS_TYPE_INTEGER:
        case JS_TYPE_NUMBER:
        case JS_TYPE_STRING:
        case JS_TYPE_BINARY:
        case JS_TYPE_INT8:
        case JS_TYPE_INT16:
        case JS_TYPE_INT32:
        case JS_TYPE_INT64:
        case JS_TYPE_UINT8:
        case JS_TYPE_UINT16:
        case JS_TYPE_UINT32:
        case JS_TYPE_UINT64:
        case JS_TYPE_FLOAT16:
        case JS_TYPE_FLOAT32:
        case JS_TYPE_FLOAT64:
        case JS_TYPE_FLOAT128:
        case JS_TYPE_DECIMAL:
        case JS_TYPE_DECIMAL64:
        case JS_TYPE_DECIMAL128:
        case JS_TYPE_DATETIME:
        case JS_TYPE_DATE:
        case JS_TYPE_TIME:
        case JS_TYPE_DURATION:
        case JS_TYPE_UUID:
        case JS_TYPE_URI:
        case JS_TYPE_URI_REFERENCE:
        case JS_TYPE_URI_TEMPLATE:
        case JS_TYPE_REGEX:
        case JS_TYPE_CHAR:
        case JS_TYPE_IPV4:
        case JS_TYPE_IPV6:
        case JS_TYPE_EMAIL:
        case JS_TYPE_IDN_EMAIL:
        case JS_TYPE_HOSTNAME:
        case JS_TYPE_IDN_HOSTNAME:
        case JS_TYPE_IRI:
        case JS_TYPE_IRI_REFERENCE:
        case JS_TYPE_JSON_POINTER:
        case JS_TYPE_RELATIVE_JSON_POINTER:
            return true;
        default:
            return false;
    }
}

bool js_type_is_numeric(js_type_t type) {
    switch (type) {
        case JS_TYPE_INTEGER:
        case JS_TYPE_NUMBER:
        case JS_TYPE_INT8:
        case JS_TYPE_INT16:
        case JS_TYPE_INT32:
        case JS_TYPE_INT64:
        case JS_TYPE_UINT8:
        case JS_TYPE_UINT16:
        case JS_TYPE_UINT32:
        case JS_TYPE_UINT64:
        case JS_TYPE_FLOAT16:
        case JS_TYPE_FLOAT32:
        case JS_TYPE_FLOAT64:
        case JS_TYPE_FLOAT128:
        case JS_TYPE_DECIMAL:
        case JS_TYPE_DECIMAL64:
        case JS_TYPE_DECIMAL128:
            return true;
        default:
            return false;
    }
}

bool js_type_is_string(js_type_t type) {
    switch (type) {
        case JS_TYPE_STRING:
        case JS_TYPE_BINARY:
        case JS_TYPE_DATETIME:
        case JS_TYPE_DATE:
        case JS_TYPE_TIME:
        case JS_TYPE_DURATION:
        case JS_TYPE_UUID:
        case JS_TYPE_URI:
        case JS_TYPE_URI_REFERENCE:
        case JS_TYPE_URI_TEMPLATE:
        case JS_TYPE_REGEX:
        case JS_TYPE_CHAR:
        case JS_TYPE_IPV4:
        case JS_TYPE_IPV6:
        case JS_TYPE_EMAIL:
        case JS_TYPE_IDN_EMAIL:
        case JS_TYPE_HOSTNAME:
        case JS_TYPE_IDN_HOSTNAME:
        case JS_TYPE_IRI:
        case JS_TYPE_IRI_REFERENCE:
        case JS_TYPE_JSON_POINTER:
        case JS_TYPE_RELATIVE_JSON_POINTER:
            return true;
        default:
            return false;
    }
}

bool js_type_is_integer(js_type_t type) {
    switch (type) {
        case JS_TYPE_INTEGER:
        case JS_TYPE_INT8:
        case JS_TYPE_INT16:
        case JS_TYPE_INT32:
        case JS_TYPE_INT64:
        case JS_TYPE_UINT8:
        case JS_TYPE_UINT16:
        case JS_TYPE_UINT32:
        case JS_TYPE_UINT64:
            return true;
        default:
            return false;
    }
}

/* Type name lookup table */
static const struct {
    const char* name;
    js_type_t type;
} g_type_names[] = {
    {"any", JS_TYPE_ANY},
    {"null", JS_TYPE_NULL},
    {"boolean", JS_TYPE_BOOLEAN},
    {"integer", JS_TYPE_INTEGER},
    {"number", JS_TYPE_NUMBER},
    {"string", JS_TYPE_STRING},
    {"binary", JS_TYPE_BINARY},
    {"object", JS_TYPE_OBJECT},
    {"array", JS_TYPE_ARRAY},
    {"map", JS_TYPE_MAP},
    {"set", JS_TYPE_SET},
    {"abstract", JS_TYPE_ABSTRACT},
    {"choice", JS_TYPE_CHOICE},
    {"tuple", JS_TYPE_TUPLE},
    {"int8", JS_TYPE_INT8},
    {"int16", JS_TYPE_INT16},
    {"int32", JS_TYPE_INT32},
    {"int64", JS_TYPE_INT64},
    {"uint8", JS_TYPE_UINT8},
    {"uint16", JS_TYPE_UINT16},
    {"uint32", JS_TYPE_UINT32},
    {"uint64", JS_TYPE_UINT64},
    {"float16", JS_TYPE_FLOAT16},
    {"float32", JS_TYPE_FLOAT32},
    {"float64", JS_TYPE_FLOAT64},
    {"float128", JS_TYPE_FLOAT128},
    {"float", JS_TYPE_FLOAT32},
    {"double", JS_TYPE_FLOAT64},
    {"decimal", JS_TYPE_DECIMAL},
    {"decimal64", JS_TYPE_DECIMAL64},
    {"decimal128", JS_TYPE_DECIMAL128},
    {"datetime", JS_TYPE_DATETIME},
    {"date", JS_TYPE_DATE},
    {"time", JS_TYPE_TIME},
    {"duration", JS_TYPE_DURATION},
    {"uuid", JS_TYPE_UUID},
    {"uri", JS_TYPE_URI},
    {"uri-reference", JS_TYPE_URI_REFERENCE},
    {"uri-template", JS_TYPE_URI_TEMPLATE},
    {"regex", JS_TYPE_REGEX},
    {"char", JS_TYPE_CHAR},
    {"ipv4", JS_TYPE_IPV4},
    {"ipv6", JS_TYPE_IPV6},
    {"email", JS_TYPE_EMAIL},
    {"idn-email", JS_TYPE_IDN_EMAIL},
    {"hostname", JS_TYPE_HOSTNAME},
    {"idn-hostname", JS_TYPE_IDN_HOSTNAME},
    {"iri", JS_TYPE_IRI},
    {"iri-reference", JS_TYPE_IRI_REFERENCE},
    {"json-pointer", JS_TYPE_JSON_POINTER},
    {"relative-json-pointer", JS_TYPE_RELATIVE_JSON_POINTER},
};

static const size_t g_type_names_count = sizeof(g_type_names) / sizeof(g_type_names[0]);

const char* js_type_name(js_type_t type) {
    for (size_t i = 0; i < g_type_names_count; ++i) {
        if (g_type_names[i].type == type) {
            return g_type_names[i].name;
        }
    }
    return "unknown";
}

js_type_t js_type_from_name(const char* name) {
    if (!name) return JS_TYPE_UNKNOWN;

    for (size_t i = 0; i < g_type_names_count; ++i) {
        if (strcmp(name, g_type_names[i].name) == 0) {
            return g_type_names[i].type;
        }
    }
    return JS_TYPE_UNKNOWN;
}

js_type_t js_type_of_json(const cJSON* json) {
    if (!json) return JS_TYPE_UNKNOWN;

    if (cJSON_IsNull(json)) return JS_TYPE_NULL;
    if (cJSON_IsBool(json)) return JS_TYPE_BOOLEAN;
    if (cJSON_IsNumber(json)) return JS_TYPE_NUMBER;
    if (cJSON_IsString(json)) return JS_TYPE_STRING;
    if (cJSON_IsObject(json)) return JS_TYPE_OBJECT;
    if (cJSON_IsArray(json)) return JS_TYPE_ARRAY;

    return JS_TYPE_UNKNOWN;
}

/* ============================================================================
 * Error Functions
 * ============================================================================ */

void js_error_init(js_error_t* error) {
    if (error) {
        error->code = 0;
        error->severity = JS_SEVERITY_ERROR;
        error->location.line = 0;
        error->location.column = 0;
        error->location.offset = 0;
        error->path = NULL;
        error->message = NULL;
    }
}

void js_error_cleanup(js_error_t* error) {
    if (error) {
        js_free(error->path);
        js_free(error->message);
        error->path = NULL;
        error->message = NULL;
    }
}

bool js_error_set(js_error_t* error, js_error_code_t code, js_severity_t severity,
                  const char* path, const char* message) {
    if (!error) return false;

    js_error_cleanup(error);

    error->code = code;
    error->severity = severity;
    error->path = path ? js_strdup(path) : NULL;
    error->message = message ? js_strdup(message) : NULL;

    /* Check allocation success */
    if ((path && !error->path) || (message && !error->message)) {
        js_error_cleanup(error);
        return false;
    }

    return true;
}

/* ============================================================================
 * Result Functions
 * ============================================================================ */

void js_result_init(js_result_t* result) {
    if (result) {
        result->valid = true;
        result->errors = NULL;
        result->error_count = 0;
        result->error_capacity = 0;
    }
}

void js_result_cleanup(js_result_t* result) {
    if (result && result->errors) {
        for (size_t i = 0; i < result->error_count; ++i) {
            js_error_cleanup(&result->errors[i]);
        }
        js_free(result->errors);
        result->errors = NULL;
        result->error_count = 0;
        result->error_capacity = 0;
    }
}

static bool js_result_grow(js_result_t* result) {
    if (result->error_count >= JS_MAX_ERRORS) {
        return false;
    }

    size_t new_capacity = result->error_capacity == 0
        ? JS_INITIAL_ERROR_CAPACITY
        : result->error_capacity * 2;

    if (new_capacity > JS_MAX_ERRORS) {
        new_capacity = JS_MAX_ERRORS;
    }

    js_error_t* new_errors = (js_error_t*)js_realloc(
        result->errors, new_capacity * sizeof(js_error_t));
    if (!new_errors) return false;

    result->errors = new_errors;
    result->error_capacity = new_capacity;
    return true;
}

bool js_result_add_error(js_result_t* result, js_error_code_t code,
                         const char* message, const char* path) {
    if (!result) return false;

    result->valid = false;

    if (result->error_count >= result->error_capacity) {
        if (!js_result_grow(result)) return false;
    }

    js_error_t* error = &result->errors[result->error_count];
    js_error_init(error);
    error->code = code;
    error->severity = JS_SEVERITY_ERROR;
    error->path = path ? js_strdup(path) : NULL;
    error->message = message ? js_strdup(message) : NULL;

    if ((path && !error->path) || (message && !error->message)) {
        js_error_cleanup(error);
        return false;
    }

    result->error_count++;
    return true;
}

bool js_result_add_warning(js_result_t* result, js_error_code_t code,
                           const char* message, const char* path) {
    if (!result) return false;

    if (result->error_count >= result->error_capacity) {
        if (!js_result_grow(result)) return false;
    }

    js_error_t* error = &result->errors[result->error_count];
    js_error_init(error);
    error->code = code;
    error->severity = JS_SEVERITY_WARNING;
    error->path = path ? js_strdup(path) : NULL;
    error->message = message ? js_strdup(message) : NULL;

    if ((path && !error->path) || (message && !error->message)) {
        js_error_cleanup(error);
        return false;
    }

    result->error_count++;
    return true;
}

bool js_result_add_error_with_location(js_result_t* result, js_error_code_t code,
                                       const char* message, const char* path,
                                       js_location_t location) {
    if (!result) return false;

    result->valid = false;

    if (result->error_count >= result->error_capacity) {
        if (!js_result_grow(result)) return false;
    }

    js_error_t* error = &result->errors[result->error_count];
    js_error_init(error);
    error->code = code;
    error->severity = JS_SEVERITY_ERROR;
    error->location = location;
    error->path = path ? js_strdup(path) : NULL;
    error->message = message ? js_strdup(message) : NULL;

    if ((path && !error->path) || (message && !error->message)) {
        js_error_cleanup(error);
        return false;
    }

    result->error_count++;
    return true;
}

bool js_result_merge(js_result_t* dest, const js_result_t* src) {
    if (!dest || !src) return false;

    for (size_t i = 0; i < src->error_count; ++i) {
        const js_error_t* e = &src->errors[i];
        if (e->severity == JS_SEVERITY_ERROR) {
            if (!js_result_add_error_with_location(dest, e->code, e->message,
                                                   e->path, e->location)) {
                return false;
            }
        } else {
            if (!js_result_add_warning(dest, e->code, e->message, e->path)) {
                return false;
            }
        }
    }

    return true;
}

char* js_result_to_string(const js_result_t* result) {
    if (!result) return NULL;

    /* Calculate required buffer size with overflow checking */
    size_t total_len = 0;
    for (size_t i = 0; i < result->error_count; ++i) {
        const js_error_t* e = &result->errors[i];
        /* Format: "[SEVERITY] path: message\n" */
        size_t entry_len = 20; /* Severity + brackets + colon + spaces + newline */
        if (e->path) entry_len += strlen(e->path);
        if (e->message) entry_len += strlen(e->message);
        
        /* Check for overflow */
        if (total_len > SIZE_MAX - entry_len) {
            return NULL;  /* Would overflow */
        }
        total_len += entry_len;
    }

    if (total_len == 0) {
        return js_strdup(result->valid ? "Valid" : "Invalid (no errors recorded)");
    }

    /* Check for final overflow when adding null terminator */
    if (total_len > SIZE_MAX - 1) {
        return NULL;
    }
    
    char* buffer = (char*)js_malloc(total_len + 1);
    if (!buffer) return NULL;

    char* ptr = buffer;
    size_t remaining = total_len + 1;
    for (size_t i = 0; i < result->error_count; ++i) {
        const js_error_t* e = &result->errors[i];
        const char* sev = e->severity == JS_SEVERITY_ERROR ? "ERROR"
                        : e->severity == JS_SEVERITY_WARNING ? "WARNING"
                        : "INFO";
        int written = snprintf(ptr, remaining, "[%s] %s: %s\n",
                               sev,
                               e->path ? e->path : "",
                               e->message ? e->message : "");
        if (written < 0 || (size_t)written >= remaining) {
            break;  /* Truncated or error - stop */
        }
        ptr += written;
        remaining -= (size_t)written;
    }

    return buffer;
}

/* ============================================================================
 * Location Functions
 * ============================================================================ */

js_location_t js_location_make(int line, int column, size_t offset) {
    js_location_t loc = { line, column, offset };
    return loc;
}

bool js_location_is_valid(js_location_t location) {
    return location.line > 0;
}
