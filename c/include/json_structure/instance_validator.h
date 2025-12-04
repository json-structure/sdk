/**
 * @file instance_validator.h
 * @brief JSON Structure instance validator
 * 
 * Validates JSON instances against JSON Structure schemas.
 * 
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#ifndef JSON_STRUCTURE_INSTANCE_VALIDATOR_H
#define JSON_STRUCTURE_INSTANCE_VALIDATOR_H

#include "types.h"
#include "error_codes.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================================
 * Import Support Types
 * ============================================================================ */

/**
 * @brief Entry for mapping URIs to file paths or schemas
 * 
 * Used for resolving $import and $importdefs keywords.
 */
typedef struct js_import_entry {
    const char* uri;            /**< The URI to match (e.g., "http://example.com/schema.json") */
    const char* file_path;      /**< File path to load schema from (NULL if schema provided) */
    const cJSON* schema;        /**< Pre-parsed schema (NULL if file_path provided) */
} js_import_entry_t;

/**
 * @brief Registry for external schemas used during import resolution
 */
typedef struct js_import_registry {
    const js_import_entry_t* entries;  /**< Array of import entries */
    size_t count;                       /**< Number of entries */
} js_import_registry_t;

/* ============================================================================
 * Instance Validator Options
 * ============================================================================ */

/**
 * @brief Options for instance validation
 */
typedef struct js_instance_options {
    bool allow_additional_properties;   /**< Allow properties not in schema (default true) */
    bool validate_formats;              /**< Validate format constraints (default true) */
    bool allow_import;                  /**< Allow $import and $importdefs keywords (default false) */
    const js_import_registry_t* import_registry;  /**< External schemas for import resolution (optional) */
} js_instance_options_t;

/** Default options */
#define JS_INSTANCE_OPTIONS_DEFAULT ((js_instance_options_t){true, true, false, NULL})

/* ============================================================================
 * Instance Validator
 * ============================================================================ */

/**
 * @brief Instance validator 
 */
typedef struct js_instance_validator {
    js_instance_options_t options;
} js_instance_validator_t;

/**
 * @brief Initialize an instance validator with default options
 * @param validator Validator to initialize
 */
void js_instance_validator_init(js_instance_validator_t* validator);

/**
 * @brief Initialize an instance validator with custom options
 * @param validator Validator to initialize
 * @param options Validation options
 */
void js_instance_validator_init_with_options(js_instance_validator_t* validator,
                                             js_instance_options_t options);

/**
 * @brief Validate an instance against a schema (both as strings)
 * @param validator Validator instance
 * @param instance_json JSON string containing the instance
 * @param schema_json JSON string containing the schema
 * @param result Output validation result
 * @return true if instance is valid, false otherwise
 */
bool js_instance_validate_strings(const js_instance_validator_t* validator,
                                  const char* instance_json,
                                  const char* schema_json,
                                  js_result_t* result);

/**
 * @brief Validate a pre-parsed instance against a pre-parsed schema
 * @param validator Validator instance
 * @param instance Parsed cJSON object representing the instance
 * @param schema Parsed cJSON object representing the schema
 * @param result Output validation result
 * @return true if instance is valid, false otherwise
 */
bool js_instance_validate(const js_instance_validator_t* validator,
                          const cJSON* instance,
                          const cJSON* schema,
                          js_result_t* result);

#ifdef __cplusplus
}
#endif

#endif /* JSON_STRUCTURE_INSTANCE_VALIDATOR_H */
