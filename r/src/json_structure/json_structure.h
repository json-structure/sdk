/**
 * @file json_structure.h
 * @brief JSON Structure SDK main header
 * 
 * This is the main umbrella header for the JSON Structure SDK.
 * Include this header to get access to all SDK functionality.
 * 
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#ifndef JSON_STRUCTURE_H
#define JSON_STRUCTURE_H

/* Version information */
#define JSON_STRUCTURE_VERSION_MAJOR 0
#define JSON_STRUCTURE_VERSION_MINOR 1
#define JSON_STRUCTURE_VERSION_PATCH 0
#define JSON_STRUCTURE_VERSION_STRING "0.1.0"

/* Core headers */
#include "export.h"
#include "types.h"
#include "error_codes.h"
#include "schema_validator.h"
#include "instance_validator.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================================
 * Library Initialization
 * ============================================================================ */

/**
 * @brief Initialize the JSON Structure library
 * 
 * Call this once at program startup. This function is optional if you
 * don't need custom memory allocation, but it's recommended for explicit
 * initialization of internal resources.
 * 
 * @note Thread-safety: This function should be called once before any
 *       validation operations. It initializes internal synchronization
 *       primitives used for thread-safe operation.
 */
JS_API void js_init(void);

/**
 * @brief Initialize the JSON Structure library with custom allocator
 * @param alloc Custom allocator functions
 * 
 * Call this once at program startup if you need custom memory allocation.
 * This function initializes the library and sets the custom allocator.
 * 
 * @note Thread-safety: This function should be called once before any
 *       validation operations. Do not call this concurrently from multiple
 *       threads or while validation is in progress.
 */
JS_API void js_init_with_allocator(js_allocator_t alloc);

/**
 * @brief Clean up the JSON Structure library
 * 
 * Call this at program shutdown to release any internal resources,
 * including the regex compilation cache and synchronization primitives.
 * 
 * After calling js_cleanup(), you can call js_init() or
 * js_init_with_allocator() again to reinitialize the library if needed.
 * 
 * @note Thread-safety: This function must only be called when no
 *       validation operations are in progress. Calling this while
 *       validations are running leads to undefined behavior.
 * 
 * @note The internal mutex is initialized once using pthread_once (Unix)
 *       or InitOnceExecuteOnce (Windows) for thread safety. While the
 *       library can be reinitialized after cleanup, the one-time
 *       initialization mechanism persists for the process lifetime.
 */
JS_API void js_cleanup(void);

/* ============================================================================
 * Convenience Functions
 * ============================================================================ */

/**
 * @brief Validate a schema string (convenience function)
 * @param schema_json JSON string containing the schema
 * @param result Output validation result
 * @return true if schema is valid, false otherwise
 */
static inline bool js_validate_schema(const char* schema_json, js_result_t* result) {
    js_schema_validator_t validator;
    js_schema_validator_init(&validator);
    return js_schema_validate_string(&validator, schema_json, result);
}

/**
 * @brief Validate an instance against a schema (convenience function)
 * @param instance_json JSON string containing the instance
 * @param schema_json JSON string containing the schema
 * @param result Output validation result
 * @return true if instance is valid, false otherwise
 */
static inline bool js_validate_instance(const char* instance_json,
                                        const char* schema_json,
                                        js_result_t* result) {
    js_instance_validator_t validator;
    js_instance_validator_init(&validator);
    return js_instance_validate_strings(&validator, instance_json, schema_json, result);
}

/**
 * @brief Get the JSON Structure error message for an error code
 * @param code Error code
 * @return Human-readable error message
 */
JS_API const char* js_error_message(js_error_code_t code);

#ifdef __cplusplus
}
#endif

#endif /* JSON_STRUCTURE_H */
