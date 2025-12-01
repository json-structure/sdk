/**
 * @file types.h
 * @brief Core types for JSON Structure validation
 * 
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#ifndef JSON_STRUCTURE_TYPES_H
#define JSON_STRUCTURE_TYPES_H

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================================
 * Configuration
 * ============================================================================ */

/** Maximum path length for JSON Pointers */
#ifndef JS_MAX_PATH_LEN
#define JS_MAX_PATH_LEN 1024
#endif

/** Maximum error message length */
#ifndef JS_MAX_MESSAGE_LEN
#define JS_MAX_MESSAGE_LEN 512
#endif

/** Maximum validation depth to prevent stack overflow */
#ifndef JS_MAX_DEPTH
#define JS_MAX_DEPTH 64
#endif

/** Maximum number of errors to collect before stopping */
#ifndef JS_MAX_ERRORS
#define JS_MAX_ERRORS 100
#endif

/** Initial capacity for dynamic arrays */
#ifndef JS_INITIAL_CAPACITY
#define JS_INITIAL_CAPACITY 16
#endif

/* ============================================================================
 * Memory allocation
 * ============================================================================ */

/** Memory allocator function type */
typedef void* (*js_alloc_fn)(size_t size, void* user_data);

/** Memory reallocator function type */
typedef void* (*js_realloc_fn)(void* ptr, size_t size, void* user_data);

/** Memory free function type */
typedef void (*js_free_fn)(void* ptr, void* user_data);

/**
 * @brief Custom allocator configuration
 */
typedef struct js_allocator {
    js_alloc_fn alloc;
    js_realloc_fn realloc;
    js_free_fn free;
    void* user_data;
} js_allocator_t;

/** Get the default allocator (uses malloc/realloc/free) */
const js_allocator_t* js_default_allocator(void);

/* ============================================================================
 * String view (non-owning reference)
 * ============================================================================ */

/**
 * @brief Non-owning string reference
 */
typedef struct js_str {
    const char* data;
    size_t len;
} js_str_t;

/** Create a string view from a C string */
#define JS_STR(s) ((js_str_t){(s), (s) ? strlen(s) : 0})

/** Create a string view from a literal */
#define JS_LIT(s) ((js_str_t){(s), sizeof(s) - 1})

/** Empty string */
#define JS_STR_EMPTY ((js_str_t){NULL, 0})

/** Check if string is empty */
#define JS_STR_IS_EMPTY(s) ((s).len == 0 || (s).data == NULL)

/** Compare two string views for equality */
bool js_str_eq(js_str_t a, js_str_t b);

/** Compare string view to C string */
bool js_str_eq_cstr(js_str_t s, const char* cstr);

/* ============================================================================
 * Source location
 * ============================================================================ */

/**
 * @brief Location in source JSON document
 */
typedef struct js_location {
    uint32_t line;      /**< Line number (1-indexed, 0 = unknown) */
    uint32_t column;    /**< Column number (1-indexed, 0 = unknown) */
} js_location_t;

/** Unknown location constant */
#define JS_LOCATION_UNKNOWN ((js_location_t){0, 0})

/** Check if location is unknown */
#define JS_LOCATION_IS_UNKNOWN(loc) ((loc).line == 0 && (loc).column == 0)

/* ============================================================================
 * Severity
 * ============================================================================ */

/**
 * @brief Severity level for validation messages
 */
typedef enum js_severity {
    JS_SEVERITY_ERROR = 0,
    JS_SEVERITY_WARNING = 1
} js_severity_t;

/* ============================================================================
 * Validation error
 * ============================================================================ */

/**
 * @brief A single validation error or warning
 */
typedef struct js_error {
    int code;                           /**< Error code (js_schema_error_t or js_instance_error_t) */
    js_severity_t severity;             /**< Error or warning */
    js_location_t location;             /**< Source location */
    char path[JS_MAX_PATH_LEN];         /**< JSON Pointer path */
    char message[JS_MAX_MESSAGE_LEN];   /**< Human-readable message */
} js_error_t;

/* ============================================================================
 * Validation result
 * ============================================================================ */

/**
 * @brief Result of validation containing collected errors
 */
typedef struct js_result {
    js_error_t* errors;         /**< Array of errors */
    size_t error_count;         /**< Number of errors in array */
    size_t error_capacity;      /**< Allocated capacity */
    size_t warning_count;       /**< Count of warnings (subset of errors) */
    const js_allocator_t* alloc;/**< Allocator used */
} js_result_t;

/** Initialize a validation result */
void js_result_init(js_result_t* result, const js_allocator_t* alloc);

/** Free resources held by a validation result */
void js_result_cleanup(js_result_t* result);

/** Add an error to the result */
bool js_result_add_error(js_result_t* result, int code, js_severity_t severity,
                         js_location_t location, const char* path, const char* message);

/** Add a formatted error to the result */
bool js_result_add_errorf(js_result_t* result, int code, js_severity_t severity,
                          js_location_t location, const char* path, const char* fmt, ...);

/** Check if validation passed (no errors, warnings OK) */
bool js_result_is_valid(const js_result_t* result);

/** Check if result has no errors or warnings */
bool js_result_is_clean(const js_result_t* result);

/** Get number of errors (not warnings) */
size_t js_result_error_count(const js_result_t* result);

/** Get number of warnings */
size_t js_result_warning_count(const js_result_t* result);

/* ============================================================================
 * JSON Structure types
 * ============================================================================ */

/**
 * @brief Primitive type identifiers
 */
typedef enum js_type {
    JS_TYPE_UNKNOWN = 0,
    
    /* Primitive types */
    JS_TYPE_STRING,
    JS_TYPE_BOOLEAN,
    JS_TYPE_NULL,
    JS_TYPE_NUMBER,
    JS_TYPE_INTEGER,
    JS_TYPE_INT8,
    JS_TYPE_INT16,
    JS_TYPE_INT32,
    JS_TYPE_INT64,
    JS_TYPE_INT128,
    JS_TYPE_UINT8,
    JS_TYPE_UINT16,
    JS_TYPE_UINT32,
    JS_TYPE_UINT64,
    JS_TYPE_UINT128,
    JS_TYPE_FLOAT,
    JS_TYPE_FLOAT8,
    JS_TYPE_DOUBLE,
    JS_TYPE_DECIMAL,
    JS_TYPE_DATE,
    JS_TYPE_TIME,
    JS_TYPE_DATETIME,
    JS_TYPE_DURATION,
    JS_TYPE_UUID,
    JS_TYPE_URI,
    JS_TYPE_BINARY,
    JS_TYPE_JSONPOINTER,
    
    /* Compound types */
    JS_TYPE_OBJECT,
    JS_TYPE_ARRAY,
    JS_TYPE_SET,
    JS_TYPE_MAP,
    JS_TYPE_TUPLE,
    JS_TYPE_CHOICE,
    JS_TYPE_ANY,
    
    JS_TYPE_COUNT
} js_type_t;

/** Check if type is a primitive type */
bool js_type_is_primitive(js_type_t type);

/** Check if type is a compound type */
bool js_type_is_compound(js_type_t type);

/** Check if type is numeric */
bool js_type_is_numeric(js_type_t type);

/** Check if type is an integer type */
bool js_type_is_integer(js_type_t type);

/** Parse type name to type enum */
js_type_t js_type_from_str(js_str_t name);

/** Get type name string */
const char* js_type_to_str(js_type_t type);

/* ============================================================================
 * Extension flags
 * ============================================================================ */

/**
 * @brief Extension flags for enabled features
 */
typedef enum js_extension {
    JS_EXT_NONE = 0,
    JS_EXT_VALIDATION = (1 << 0),
    JS_EXT_CONDITIONAL_COMPOSITION = (1 << 1),
    JS_EXT_IMPORT = (1 << 2),
    JS_EXT_ALTERNATE_NAMES = (1 << 3),
    JS_EXT_UNITS = (1 << 4),
    JS_EXT_ALL = 0x1F
} js_extension_t;

/** Parse extension name to flag */
js_extension_t js_extension_from_str(js_str_t name);

/** Get extension name string */
const char* js_extension_to_str(js_extension_t ext);

#ifdef __cplusplus
}
#endif

#endif /* JSON_STRUCTURE_TYPES_H */
