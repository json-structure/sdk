/**
 * @file schema_validator.h
 * @brief JSON Structure schema validator
 * 
 * Validates JSON Structure schema documents for correctness.
 * 
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#ifndef JSON_STRUCTURE_SCHEMA_VALIDATOR_H
#define JSON_STRUCTURE_SCHEMA_VALIDATOR_H

#include "types.h"
#include "error_codes.h"
#include "instance_validator.h"  /* For js_import_registry_t */

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================================
 * Schema Validator Options
 * ============================================================================ */

/**
 * @brief Options for schema validation
 */
typedef struct js_schema_options {
    bool allow_import;          /**< Allow $import and $importdefs keywords */
    bool warnings_enabled;      /**< Report warnings (e.g., unused validation keywords) */
    const js_import_registry_t* import_registry;  /**< External schemas for import resolution (optional) */
} js_schema_options_t;

/** Default options */
#define JS_SCHEMA_OPTIONS_DEFAULT ((js_schema_options_t){false, true, NULL})

/* ============================================================================
 * Schema Validator
 * ============================================================================ */

/**
 * @brief Schema validator instance
 */
typedef struct js_schema_validator {
    js_schema_options_t options;
} js_schema_validator_t;

/**
 * @brief Initialize a schema validator with default options
 * @param validator Validator to initialize
 */
void js_schema_validator_init(js_schema_validator_t* validator);

/**
 * @brief Initialize a schema validator with custom options
 * @param validator Validator to initialize
 * @param options Validation options
 */
void js_schema_validator_init_with_options(js_schema_validator_t* validator,
                                           js_schema_options_t options);

/**
 * @brief Validate a schema from a JSON string
 * @param validator Validator instance
 * @param json_str JSON string containing the schema
 * @param result Output validation result
 * @return true if schema is valid (no errors), false otherwise
 */
bool js_schema_validate_string(const js_schema_validator_t* validator,
                               const char* json_str,
                               js_result_t* result);

/**
 * @brief Validate a pre-parsed schema
 * @param validator Validator instance
 * @param schema Parsed cJSON object representing the schema
 * @param result Output validation result
 * @return true if schema is valid (no errors), false otherwise
 */
bool js_schema_validate(const js_schema_validator_t* validator,
                        const cJSON* schema,
                        js_result_t* result);

/**
 * @brief Check if a type name is a valid primitive type
 * @param type_name Type name string
 * @return true if valid primitive type
 */
bool js_schema_is_valid_primitive_type(const char* type_name);

/**
 * @brief Check if a type name is a valid compound type
 * @param type_name Type name string
 * @return true if valid compound type
 */
bool js_schema_is_valid_compound_type(const char* type_name);

/**
 * @brief Alias for js_schema_validate_string (for C++ bindings compatibility)
 * @param validator Validator instance
 * @param json_str JSON string containing the schema
 * @param result Output validation result
 * @return true if schema is valid (no errors), false otherwise
 */
bool js_schema_validator_validate_string(const js_schema_validator_t* validator,
                                         const char* json_str,
                                         js_result_t* result);

#ifdef __cplusplus
}
#endif

#endif /* JSON_STRUCTURE_SCHEMA_VALIDATOR_H */
