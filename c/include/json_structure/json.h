/**
 * @file json.h
 * @brief Compact JSON parser for JSON Structure validation
 * 
 * This is a minimal, zero-copy JSON parser optimized for validation.
 * It uses string views and does not allocate memory for parsed values.
 * 
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#ifndef JSON_STRUCTURE_JSON_H
#define JSON_STRUCTURE_JSON_H

#include "types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================================
 * JSON Value Types
 * ============================================================================ */

/**
 * @brief JSON value type
 */
typedef enum js_json_type {
    JS_JSON_NULL = 0,
    JS_JSON_BOOL,
    JS_JSON_NUMBER,
    JS_JSON_STRING,
    JS_JSON_ARRAY,
    JS_JSON_OBJECT
} js_json_type_t;

/* ============================================================================
 * JSON Value (non-owning view into parsed JSON)
 * ============================================================================ */

/**
 * @brief JSON value - a view into parsed JSON data
 * 
 * This is a 32-byte structure that provides a view into the original
 * JSON string. No memory is allocated for values.
 */
typedef struct js_json {
    js_json_type_t type;        /**< Value type */
    js_str_t raw;               /**< Raw JSON text for this value */
    union {
        bool boolean;           /**< Boolean value */
        double number;          /**< Numeric value (also stores integers) */
        js_str_t string;        /**< String value (unescaped view) */
        struct {
            uint32_t count;     /**< Number of elements/properties */
            uint32_t _reserved;
        } container;
    } data;
} js_json_t;

/* ============================================================================
 * JSON Parser
 * ============================================================================ */

/**
 * @brief JSON parser state
 */
typedef struct js_parser {
    const char* json;           /**< Original JSON string */
    size_t len;                 /**< Length of JSON string */
    size_t pos;                 /**< Current position */
    uint32_t line;              /**< Current line (1-indexed) */
    uint32_t column;            /**< Current column (1-indexed) */
    const js_allocator_t* alloc;/**< Allocator for internal structures */
    char error[128];            /**< Error message if parsing fails */
} js_parser_t;

/**
 * @brief Initialize parser with JSON string
 * @param parser Parser to initialize
 * @param json JSON string (must remain valid during parsing)
 * @param len Length of JSON string
 * @param alloc Allocator (NULL for default)
 */
void js_parser_init(js_parser_t* parser, const char* json, size_t len,
                    const js_allocator_t* alloc);

/**
 * @brief Parse a JSON value
 * @param parser Parser state
 * @param out Output value
 * @return true on success, false on parse error
 */
bool js_parser_parse(js_parser_t* parser, js_json_t* out);

/**
 * @brief Get current source location
 * @param parser Parser state
 * @return Current location
 */
js_location_t js_parser_location(const js_parser_t* parser);

/* ============================================================================
 * JSON Value Access
 * ============================================================================ */

/**
 * @brief Check if value is null
 */
static inline bool js_json_is_null(const js_json_t* v) {
    return v && v->type == JS_JSON_NULL;
}

/**
 * @brief Check if value is boolean
 */
static inline bool js_json_is_bool(const js_json_t* v) {
    return v && v->type == JS_JSON_BOOL;
}

/**
 * @brief Check if value is number
 */
static inline bool js_json_is_number(const js_json_t* v) {
    return v && v->type == JS_JSON_NUMBER;
}

/**
 * @brief Check if value is string
 */
static inline bool js_json_is_string(const js_json_t* v) {
    return v && v->type == JS_JSON_STRING;
}

/**
 * @brief Check if value is array
 */
static inline bool js_json_is_array(const js_json_t* v) {
    return v && v->type == JS_JSON_ARRAY;
}

/**
 * @brief Check if value is object
 */
static inline bool js_json_is_object(const js_json_t* v) {
    return v && v->type == JS_JSON_OBJECT;
}

/**
 * @brief Get boolean value
 * @param v JSON value
 * @param def Default if not boolean
 * @return Boolean value or default
 */
static inline bool js_json_get_bool(const js_json_t* v, bool def) {
    return (v && v->type == JS_JSON_BOOL) ? v->data.boolean : def;
}

/**
 * @brief Get number value
 * @param v JSON value
 * @param def Default if not number
 * @return Number value or default
 */
static inline double js_json_get_number(const js_json_t* v, double def) {
    return (v && v->type == JS_JSON_NUMBER) ? v->data.number : def;
}

/**
 * @brief Get string value
 * @param v JSON value
 * @return String view or empty
 */
static inline js_str_t js_json_get_string(const js_json_t* v) {
    return (v && v->type == JS_JSON_STRING) ? v->data.string : JS_STR_EMPTY;
}

/**
 * @brief Get array/object element count
 * @param v JSON value
 * @return Element count or 0
 */
static inline uint32_t js_json_get_count(const js_json_t* v) {
    return (v && (v->type == JS_JSON_ARRAY || v->type == JS_JSON_OBJECT)) 
        ? v->data.container.count : 0;
}

/* ============================================================================
 * JSON Object/Array Iteration
 * ============================================================================ */

/**
 * @brief Iterator for JSON objects and arrays
 */
typedef struct js_json_iter {
    js_parser_t parser;         /**< Internal parser state */
    uint32_t index;             /**< Current index */
    uint32_t count;             /**< Total count */
    bool is_object;             /**< True if iterating object */
} js_json_iter_t;

/**
 * @brief Initialize iterator for array or object
 * @param iter Iterator to initialize
 * @param value JSON array or object value
 * @return true if iteration can begin
 */
bool js_json_iter_init(js_json_iter_t* iter, const js_json_t* value);

/**
 * @brief Get next value from iterator
 * @param iter Iterator
 * @param key Output key (only for objects, NULL for arrays)
 * @param value Output value
 * @return true if value available, false if end
 */
bool js_json_iter_next(js_json_iter_t* iter, js_str_t* key, js_json_t* value);

/* ============================================================================
 * JSON Object Property Access
 * ============================================================================ */

/**
 * @brief Get property from JSON object by name
 * @param obj JSON object value
 * @param key Property name
 * @param out Output value
 * @return true if property found
 */
bool js_json_get(const js_json_t* obj, js_str_t key, js_json_t* out);

/**
 * @brief Get property from JSON object by C string
 * @param obj JSON object value  
 * @param key Property name (null-terminated)
 * @param out Output value
 * @return true if property found
 */
bool js_json_get_cstr(const js_json_t* obj, const char* key, js_json_t* out);

/**
 * @brief Check if object has property
 * @param obj JSON object value
 * @param key Property name
 * @return true if property exists
 */
bool js_json_has(const js_json_t* obj, js_str_t key);

/**
 * @brief Check if object has property (C string)
 * @param obj JSON object value
 * @param key Property name (null-terminated)
 * @return true if property exists
 */
bool js_json_has_cstr(const js_json_t* obj, const char* key);

/* ============================================================================
 * JSON Array Element Access
 * ============================================================================ */

/**
 * @brief Get array element by index
 * @param arr JSON array value
 * @param index Element index
 * @param out Output value
 * @return true if element found
 */
bool js_json_get_index(const js_json_t* arr, uint32_t index, js_json_t* out);

/* ============================================================================
 * JSON String Utilities
 * ============================================================================ */

/**
 * @brief Compare JSON string to C string
 * @param v JSON string value
 * @param cstr C string to compare
 * @return true if equal
 */
bool js_json_str_eq(const js_json_t* v, const char* cstr);

/**
 * @brief Unescape JSON string into buffer
 * @param str JSON string view (with escapes)
 * @param buf Output buffer
 * @param buf_size Buffer size
 * @return Length written, or required size if buf_size is 0
 */
size_t js_json_unescape(js_str_t str, char* buf, size_t buf_size);

/* ============================================================================
 * JSON Source Location
 * ============================================================================ */

/**
 * @brief Location map for tracking JSON paths to source locations
 */
typedef struct js_locator {
    const char* json;
    size_t len;
    /* Internal location cache - lazily built */
    void* _cache;
    const js_allocator_t* alloc;
} js_locator_t;

/**
 * @brief Initialize source locator
 * @param loc Locator to initialize
 * @param json JSON string
 * @param len JSON string length
 * @param alloc Allocator (NULL for default)
 */
void js_locator_init(js_locator_t* loc, const char* json, size_t len,
                     const js_allocator_t* alloc);

/**
 * @brief Free locator resources
 */
void js_locator_cleanup(js_locator_t* loc);

/**
 * @brief Get source location for a JSON path
 * @param loc Locator
 * @param path JSON Pointer path
 * @return Source location
 */
js_location_t js_locator_find(js_locator_t* loc, const char* path);

#ifdef __cplusplus
}
#endif

#endif /* JSON_STRUCTURE_JSON_H */
