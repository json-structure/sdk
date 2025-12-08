/**
 * @file types.h
 * @brief Core type definitions for JSON Structure validation library
 *
 * This header provides the fundamental types used throughout the library,
 * including JSON type enumerations, error handling structures, result types,
 * and custom allocator support for embedded systems.
 *
 * @note This library requires cJSON as an external dependency for JSON parsing.
 *
 * SPDX-License-Identifier: MIT
 */

#ifndef JS_TYPES_H
#define JS_TYPES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* cJSON is used as the external JSON parsing library */
#include <cjson/cJSON.h>

/* Export macros for shared library support */
#include "export.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================================
 * Version Information
 * ========================================================================== */

#define JS_VERSION_MAJOR 0
#define JS_VERSION_MINOR 1
#define JS_VERSION_PATCH 0
#define JS_VERSION_STRING "0.1.0"

/* ============================================================================
 * Configuration Macros
 * ========================================================================== */

/**
 * @brief Maximum number of errors that can be stored in a result
 *
 * This can be overridden at compile time with -DJS_MAX_ERRORS=N
 */
#ifndef JS_MAX_ERRORS
#define JS_MAX_ERRORS 100
#endif

/**
 * @brief Initial capacity for error array
 */
#ifndef JS_INITIAL_ERROR_CAPACITY
#define JS_INITIAL_ERROR_CAPACITY 16
#endif

/* ============================================================================
 * JSON Structure Type Enumeration
 * ========================================================================== */

/**
 * @brief JSON Structure type identifiers
 *
 * These types correspond to the JSON Structure specification type names.
 * Use js_type_name() to get the string representation.
 */
typedef enum js_type {
    /* Invalid/unknown type */
    JS_TYPE_UNKNOWN = 0,

    /* Primitive types */
    JS_TYPE_ANY,
    JS_TYPE_NULL,
    JS_TYPE_BOOLEAN,
    JS_TYPE_INTEGER,
    JS_TYPE_NUMBER,
    JS_TYPE_STRING,
    JS_TYPE_BINARY,
    JS_TYPE_OBJECT,
    JS_TYPE_ARRAY,
    JS_TYPE_MAP,
    JS_TYPE_SET,
    JS_TYPE_ABSTRACT,
    JS_TYPE_CHOICE,
    JS_TYPE_TUPLE,

    /* Extended numeric types */
    JS_TYPE_INT8,
    JS_TYPE_INT16,
    JS_TYPE_INT32,
    JS_TYPE_INT64,
    JS_TYPE_UINT8,
    JS_TYPE_UINT16,
    JS_TYPE_UINT32,
    JS_TYPE_UINT64,
    JS_TYPE_FLOAT16,
    JS_TYPE_FLOAT32,
    JS_TYPE_FLOAT64,
    JS_TYPE_FLOAT128,
    JS_TYPE_DECIMAL,
    JS_TYPE_DECIMAL64,
    JS_TYPE_DECIMAL128,

    /* Extended string types */
    JS_TYPE_DATETIME,
    JS_TYPE_DATE,
    JS_TYPE_TIME,
    JS_TYPE_DURATION,
    JS_TYPE_UUID,
    JS_TYPE_URI,
    JS_TYPE_URI_REFERENCE,
    JS_TYPE_URI_TEMPLATE,
    JS_TYPE_REGEX,
    JS_TYPE_CHAR,
    JS_TYPE_IPV4,
    JS_TYPE_IPV6,
    JS_TYPE_EMAIL,
    JS_TYPE_IDN_EMAIL,
    JS_TYPE_HOSTNAME,
    JS_TYPE_IDN_HOSTNAME,
    JS_TYPE_IRI,
    JS_TYPE_IRI_REFERENCE,
    JS_TYPE_JSON_POINTER,
    JS_TYPE_RELATIVE_JSON_POINTER,

    /* Internal use */
    JS_TYPE_COUNT
} js_type_t;

/* ============================================================================
 * Severity and Location Types
 * ========================================================================== */

/**
 * @brief Severity level for validation errors/warnings
 */
typedef enum js_severity {
    JS_SEVERITY_ERROR = 0,  /**< Validation error - schema/instance is invalid */
    JS_SEVERITY_WARNING,    /**< Warning - potential issue but not invalid */
    JS_SEVERITY_INFO        /**< Informational message */
} js_severity_t;

/**
 * @brief Source location information for error reporting
 *
 * Provides line, column, and byte offset for locating errors in source JSON.
 */
typedef struct js_location {
    int line;        /**< 1-based line number, 0 if unknown */
    int column;      /**< 1-based column number, 0 if unknown */
    size_t offset;   /**< 0-based byte offset from start of document */
} js_location_t;

/* ============================================================================
 * Generic Error Codes
 * ========================================================================== */

/**
 * @brief Generic error codes used by the library
 *
 * More specific error codes are defined in error_codes.h.
 */
typedef enum js_error_code {
    JS_ERROR_NONE = 0,              /**< No error */
    JS_ERROR_INVALID_ARGUMENT,      /**< Invalid argument passed */
    JS_ERROR_OUT_OF_MEMORY,         /**< Memory allocation failed */
    JS_ERROR_PARSE_ERROR,           /**< JSON parsing error */
    JS_ERROR_INTERNAL_ERROR,        /**< Internal library error */
    JS_ERROR_MAX_GENERIC = 100      /**< Marker: specific codes start after this */
} js_error_code_enum_t;

/**
 * @brief Combined error code type
 *
 * This is a union of generic, schema, and instance error codes.
 * See error_codes.h for the specific error code enumerations.
 */
typedef int js_error_code_t;

/* ============================================================================
 * Error Structure
 * ========================================================================== */

/**
 * @brief Validation error information
 *
 * Contains all information about a single validation error including
 * the error code, severity, location, JSON path, and human-readable message.
 *
 * @note The path and message fields are dynamically allocated and must be
 *       freed using js_error_cleanup() or managed by js_result_cleanup().
 */
typedef struct js_error {
    js_error_code_t code;       /**< Error code (see error_codes.h) */
    js_severity_t severity;     /**< Severity level */
    js_location_t location;     /**< Source location if available */
    char* path;                 /**< JSON Pointer path to error location (allocated) */
    char* message;              /**< Human-readable error message (allocated) */
} js_error_t;

/* ============================================================================
 * Result Structure
 * ========================================================================== */

/**
 * @brief Validation result container
 *
 * Holds the overall validation result and any accumulated errors.
 * Use js_result_init() before use and js_result_cleanup() when done.
 */
typedef struct js_result {
    bool valid;                 /**< True if validation passed */
    js_error_t* errors;         /**< Array of errors (dynamically allocated) */
    size_t error_count;         /**< Number of errors in the array */
    size_t error_capacity;      /**< Allocated capacity for errors array */
} js_result_t;

/* ============================================================================
 * Custom Allocator Support
 * ========================================================================== */

/**
 * @brief Custom memory allocator interface
 *
 * For embedded systems or custom memory management, provide implementations
 * of these function pointers. Pass to js_set_allocator() before any other
 * library calls. This also configures cJSON to use the same allocator.
 *
 * @note If not set, standard malloc/realloc/free are used.
 */
typedef struct js_allocator {
    void* (*malloc)(size_t size);              /**< Allocation function */
    void* (*realloc)(void* ptr, size_t size);  /**< Reallocation function */
    void  (*free)(void* ptr);                  /**< Deallocation function */
    void* user_data;                           /**< Optional user context */
} js_allocator_t;

/* ============================================================================
 * Allocator Functions
 * ========================================================================== */

/**
 * @brief Set a custom allocator for the library
 *
 * This function must be called before any other library functions if you
 * want to use a custom allocator. It also configures cJSON to use the
 * same allocator functions.
 *
 * @param alloc Custom allocator with malloc, realloc, and free functions
 *
 * @note Pass NULL functions to reset to default allocator
 */
JS_API void js_set_allocator(js_allocator_t alloc);

/**
 * @brief Get the current allocator
 *
 * @return Current allocator configuration
 */
JS_API js_allocator_t js_get_allocator(void);

/**
 * @brief Allocate memory using the configured allocator
 *
 * @param size Number of bytes to allocate
 * @return Pointer to allocated memory, or NULL on failure
 */
JS_API void* js_malloc(size_t size);

/**
 * @brief Reallocate memory using the configured allocator
 *
 * @param ptr Pointer to existing allocation (may be NULL)
 * @param size New size in bytes
 * @return Pointer to reallocated memory, or NULL on failure
 */
JS_API void* js_realloc(void* ptr, size_t size);

/**
 * @brief Free memory using the configured allocator
 *
 * @param ptr Pointer to memory to free (may be NULL)
 */
JS_API void js_free(void* ptr);

/**
 * @brief Duplicate a string using the configured allocator
 *
 * @param s String to duplicate
 * @return Newly allocated copy of the string, or NULL on failure
 */
JS_API char* js_strdup(const char* s);

/* ============================================================================
 * Type Utility Functions
 * ========================================================================== */

/**
 * @brief Check if a type is a primitive (non-composite) type
 *
 * Primitive types are: null, boolean, integer, number, string, binary
 *
 * @param type Type to check
 * @return true if the type is primitive
 */
JS_API bool js_type_is_primitive(js_type_t type);

/**
 * @brief Check if a type is numeric
 *
 * Numeric types include: integer, number, and all int/uint/float/decimal variants
 *
 * @param type Type to check
 * @return true if the type is numeric
 */
JS_API bool js_type_is_numeric(js_type_t type);

/**
 * @brief Check if a type is a string-based type
 *
 * String types include: string and all format-specific string types
 * (datetime, date, time, duration, uuid, uri, etc.)
 *
 * @param type Type to check
 * @return true if the type is string-based
 */
JS_API bool js_type_is_string(js_type_t type);

/**
 * @brief Check if a type is an integer type
 *
 * Integer types include: integer, int8-int64, uint8-uint64
 *
 * @param type Type to check
 * @return true if the type is an integer type
 */
JS_API bool js_type_is_integer(js_type_t type);

/**
 * @brief Get the string name of a type
 *
 * @param type Type to get name for
 * @return String name (e.g., "string", "int32", "datetime"), or "unknown"
 */
JS_API const char* js_type_name(js_type_t type);

/**
 * @brief Parse a type name string to its enum value
 *
 * @param name Type name string (case-sensitive)
 * @return Corresponding js_type_t value, or JS_TYPE_UNKNOWN if not recognized
 */
JS_API js_type_t js_type_from_name(const char* name);

/**
 * @brief Get the type of a cJSON value
 *
 * Maps cJSON types to js_type_t. Note that this only returns basic JSON types
 * (null, boolean, number, string, object, array) - not extended types.
 *
 * @param json cJSON value to check
 * @return Basic JSON type, or JS_TYPE_UNKNOWN if NULL
 */
JS_API js_type_t js_type_of_json(const cJSON* json);

/* ============================================================================
 * Error Functions
 * ========================================================================== */

/**
 * @brief Initialize an error structure
 *
 * @param error Error to initialize
 */
JS_API void js_error_init(js_error_t* error);

/**
 * @brief Clean up an error structure, freeing allocated memory
 *
 * @param error Error to clean up
 */
JS_API void js_error_cleanup(js_error_t* error);

/**
 * @brief Set error details
 *
 * @param error Error to set
 * @param code Error code
 * @param severity Error severity
 * @param path JSON path (will be duplicated)
 * @param message Error message (will be duplicated)
 * @return true on success, false on allocation failure
 */
JS_API bool js_error_set(js_error_t* error, js_error_code_t code, js_severity_t severity,
                  const char* path, const char* message);

/* ============================================================================
 * Result Functions
 * ========================================================================== */

/**
 * @brief Initialize a result structure
 *
 * Must be called before using a js_result_t. Sets valid to true
 * and initializes error array.
 *
 * @param result Result to initialize
 */
JS_API void js_result_init(js_result_t* result);

/**
 * @brief Clean up a result structure, freeing all errors
 *
 * @param result Result to clean up
 */
JS_API void js_result_cleanup(js_result_t* result);

/**
 * @brief Add an error to a result
 *
 * Automatically grows the error array as needed, up to JS_MAX_ERRORS.
 * Sets result->valid to false when adding an error with severity ERROR.
 *
 * @param result Result to add error to
 * @param code Error code
 * @param message Human-readable error message
 * @param path JSON Pointer path to error location (may be NULL)
 * @return true on success, false if max errors reached or allocation failed
 */
JS_API bool js_result_add_error(js_result_t* result, js_error_code_t code,
                         const char* message, const char* path);

/**
 * @brief Add a warning to a result
 *
 * Same as js_result_add_error but with SEVERITY_WARNING.
 * Does not set result->valid to false.
 *
 * @param result Result to add warning to
 * @param code Warning code
 * @param message Human-readable warning message
 * @param path JSON Pointer path to warning location (may be NULL)
 * @return true on success, false if max errors reached or allocation failed
 */
JS_API bool js_result_add_warning(js_result_t* result, js_error_code_t code,
                           const char* message, const char* path);

/**
 * @brief Add an error with location information
 *
 * @param result Result to add error to
 * @param code Error code
 * @param message Human-readable error message
 * @param path JSON Pointer path to error location (may be NULL)
 * @param location Source location information
 * @return true on success, false if max errors reached or allocation failed
 */
JS_API bool js_result_add_error_with_location(js_result_t* result, js_error_code_t code,
                                       const char* message, const char* path,
                                       js_location_t location);

/**
 * @brief Merge errors from one result into another
 *
 * @param dest Destination result
 * @param src Source result (errors are copied, not moved)
 * @return true on success, false if allocation failed
 */
JS_API bool js_result_merge(js_result_t* dest, const js_result_t* src);

/**
 * @brief Get a formatted string with all errors
 *
 * @param result Result to format
 * @return Newly allocated string with all errors, or NULL on failure.
 *         Caller must free with js_free().
 */
JS_API char* js_result_to_string(const js_result_t* result);

/* ============================================================================
 * Location Functions
 * ========================================================================== */

/**
 * @brief Create a location structure
 *
 * @param line Line number (1-based)
 * @param column Column number (1-based)
 * @param offset Byte offset (0-based)
 * @return Initialized location structure
 */
JS_API js_location_t js_location_make(int line, int column, size_t offset);

/**
 * @brief Check if a location is valid (has non-zero line)
 *
 * @param location Location to check
 * @return true if location has valid line/column information
 */
JS_API bool js_location_is_valid(js_location_t location);

#ifdef __cplusplus
}
#endif

#endif /* JS_TYPES_H */
