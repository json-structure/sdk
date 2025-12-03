/**
 * @file json_source_locator.c
 * @brief JSON source location tracking
 *
 * Provides utilities for tracking source locations (line, column, offset)
 * within JSON documents for better error reporting.
 *
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#include "json_structure/types.h"
#include <string.h>
#include <stdlib.h>
#include <ctype.h>

/* ============================================================================
 * Source Location Tracking
 * ============================================================================ */

/**
 * @brief State for JSON source location tracking
 */
typedef struct js_source_locator {
    const char* source;
    size_t source_len;
    size_t* line_offsets;
    size_t line_count;
    size_t line_capacity;
} js_source_locator_t;

/**
 * @brief Initialize a source locator
 */
static bool js_source_locator_init(js_source_locator_t* locator, const char* source) {
    if (!locator || !source) return false;
    
    locator->source = source;
    locator->source_len = strlen(source);
    locator->line_count = 0;
    locator->line_capacity = 64;
    locator->line_offsets = (size_t*)js_malloc(locator->line_capacity * sizeof(size_t));
    
    if (!locator->line_offsets) return false;
    
    /* First line starts at offset 0 */
    locator->line_offsets[0] = 0;
    locator->line_count = 1;
    
    /* Find all line starts */
    for (size_t i = 0; i < locator->source_len; ++i) {
        if (source[i] == '\n') {
            /* Next line starts after this newline */
            if (locator->line_count >= locator->line_capacity) {
                size_t new_capacity = locator->line_capacity * 2;
                size_t* new_offsets = (size_t*)js_realloc(
                    locator->line_offsets, new_capacity * sizeof(size_t));
                if (!new_offsets) return false;
                locator->line_offsets = new_offsets;
                locator->line_capacity = new_capacity;
            }
            locator->line_offsets[locator->line_count] = i + 1;
            locator->line_count++;
        }
    }
    
    return true;
}

/**
 * @brief Clean up a source locator
 */
static void js_source_locator_cleanup(js_source_locator_t* locator) {
    if (locator) {
        js_free(locator->line_offsets);
        locator->line_offsets = NULL;
        locator->line_count = 0;
        locator->line_capacity = 0;
    }
}

/**
 * @brief Get location for a given offset
 */
static js_location_t js_source_locator_get_location(const js_source_locator_t* locator, 
                                                     size_t offset) {
    js_location_t loc = {0, 0, offset};
    
    if (!locator || !locator->line_offsets || offset > locator->source_len) {
        return loc;
    }
    
    /* Binary search for the line */
    size_t low = 0;
    size_t high = locator->line_count;
    
    while (low < high) {
        size_t mid = (low + high) / 2;
        if (locator->line_offsets[mid] <= offset) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    
    /* low-1 is now the line index (0-based) */
    size_t line_idx = (low > 0) ? low - 1 : 0;
    
    loc.line = (int)(line_idx + 1);  /* 1-based line number */
    loc.column = (int)(offset - locator->line_offsets[line_idx] + 1);  /* 1-based column */
    
    return loc;
}

/* ============================================================================
 * JSON Path to Offset Mapping
 * ============================================================================ */

/**
 * @brief Skip whitespace in JSON source
 */
static size_t skip_whitespace(const char* s, size_t pos, size_t len) {
    while (pos < len && isspace((unsigned char)s[pos])) {
        pos++;
    }
    return pos;
}

/**
 * @brief Skip a JSON string (including quotes)
 */
static size_t skip_string(const char* s, size_t pos, size_t len) {
    if (pos >= len || s[pos] != '"') return pos;
    pos++;  /* Skip opening quote */
    
    while (pos < len) {
        if (s[pos] == '\\' && pos + 1 < len) {
            pos += 2;  /* Skip escape sequence */
        } else if (s[pos] == '"') {
            return pos + 1;  /* Skip closing quote */
        } else {
            pos++;
        }
    }
    
    return pos;
}

/**
 * @brief Skip a JSON value (object, array, string, number, boolean, null)
 */
static size_t skip_value(const char* s, size_t pos, size_t len) {
    pos = skip_whitespace(s, pos, len);
    if (pos >= len) return pos;
    
    char c = s[pos];
    
    if (c == '"') {
        return skip_string(s, pos, len);
    }
    
    if (c == '{') {
        int depth = 1;
        pos++;
        while (pos < len && depth > 0) {
            c = s[pos];
            if (c == '"') {
                pos = skip_string(s, pos, len);
            } else if (c == '{') {
                depth++;
                pos++;
            } else if (c == '}') {
                depth--;
                pos++;
            } else {
                pos++;
            }
        }
        return pos;
    }
    
    if (c == '[') {
        int depth = 1;
        pos++;
        while (pos < len && depth > 0) {
            c = s[pos];
            if (c == '"') {
                pos = skip_string(s, pos, len);
            } else if (c == '[') {
                depth++;
                pos++;
            } else if (c == ']') {
                depth--;
                pos++;
            } else {
                pos++;
            }
        }
        return pos;
    }
    
    /* Number, boolean, or null */
    while (pos < len && !isspace((unsigned char)s[pos]) && 
           s[pos] != ',' && s[pos] != '}' && s[pos] != ']') {
        pos++;
    }
    
    return pos;
}

/**
 * @brief Find the offset of a JSON path component
 * 
 * @param source The JSON source string
 * @param source_len Length of source
 * @param start_offset Starting offset (should point to '{' or '[')
 * @param component Path component (property name or array index as string)
 * @param is_array Whether we're in an array context
 * @return Offset of the value, or (size_t)-1 if not found
 */
static size_t find_path_component(const char* source, size_t source_len,
                                   size_t start_offset, const char* component,
                                   bool is_array) {
    size_t pos = skip_whitespace(source, start_offset, source_len);
    if (pos >= source_len) return (size_t)-1;
    
    if (is_array) {
        /* Array index - parse component as number */
        char* endptr;
        long index = strtol(component, &endptr, 10);
        if (*endptr != '\0' || index < 0) return (size_t)-1;
        
        if (source[pos] != '[') return (size_t)-1;
        pos++;  /* Skip '[' */
        
        for (long i = 0; i <= index; i++) {
            pos = skip_whitespace(source, pos, source_len);
            if (pos >= source_len) return (size_t)-1;
            
            if (source[pos] == ']') return (size_t)-1;  /* Array ended early */
            
            if (i == index) {
                return pos;  /* Found the target element */
            }
            
            /* Skip this value and the comma */
            pos = skip_value(source, pos, source_len);
            pos = skip_whitespace(source, pos, source_len);
            if (pos < source_len && source[pos] == ',') {
                pos++;
            }
        }
        
        return (size_t)-1;
    } else {
        /* Object property */
        if (source[pos] != '{') return (size_t)-1;
        pos++;  /* Skip '{' */
        
        while (pos < source_len) {
            pos = skip_whitespace(source, pos, source_len);
            if (pos >= source_len || source[pos] == '}') return (size_t)-1;
            
            /* Read property name */
            if (source[pos] != '"') return (size_t)-1;
            size_t name_start = pos + 1;
            pos = skip_string(source, pos, source_len);
            size_t name_end = pos - 1;
            
            /* Compare property name */
            size_t name_len = name_end - name_start;
            bool matches = (strlen(component) == name_len &&
                           strncmp(source + name_start, component, name_len) == 0);
            
            /* Skip colon */
            pos = skip_whitespace(source, pos, source_len);
            if (pos >= source_len || source[pos] != ':') return (size_t)-1;
            pos++;
            
            pos = skip_whitespace(source, pos, source_len);
            
            if (matches) {
                return pos;  /* Found the property value */
            }
            
            /* Skip the value */
            pos = skip_value(source, pos, source_len);
            pos = skip_whitespace(source, pos, source_len);
            if (pos < source_len && source[pos] == ',') {
                pos++;
            }
        }
        
        return (size_t)-1;
    }
}

/**
 * @brief Get the source location for a JSON path
 * 
 * @param source The JSON source string
 * @param path JSON path (e.g., "properties.name" or "[0].value")
 * @return Location of the value at the path, or invalid location if not found
 */
js_location_t js_get_path_location(const char* source, const char* path) {
    js_location_t invalid = {0, 0, 0};
    
    if (!source || !path) return invalid;
    
    size_t source_len = strlen(source);
    if (source_len == 0) return invalid;
    
    /* Initialize source locator */
    js_source_locator_t locator;
    if (!js_source_locator_init(&locator, source)) return invalid;
    
    /* Start at the root */
    size_t pos = skip_whitespace(source, 0, source_len);
    
    /* If path is empty, return root location */
    if (path[0] == '\0') {
        js_location_t loc = js_source_locator_get_location(&locator, pos);
        js_source_locator_cleanup(&locator);
        return loc;
    }
    
    /* Parse path and navigate */
    const char* p = path;
    char component[256];
    
    while (*p) {
        /* Skip leading dot */
        if (*p == '.') p++;
        
        bool is_array = (*p == '[');
        if (is_array) {
            p++;  /* Skip '[' */
            size_t i = 0;
            while (*p && *p != ']' && i < sizeof(component) - 1) {
                component[i++] = *p++;
            }
            component[i] = '\0';
            if (*p == ']') p++;
        } else {
            size_t i = 0;
            while (*p && *p != '.' && *p != '[' && i < sizeof(component) - 1) {
                component[i++] = *p++;
            }
            component[i] = '\0';
        }
        
        if (component[0] == '\0') break;
        
        pos = find_path_component(source, source_len, pos, component, is_array);
        if (pos == (size_t)-1) {
            js_source_locator_cleanup(&locator);
            return invalid;
        }
    }
    
    js_location_t loc = js_source_locator_get_location(&locator, pos);
    js_source_locator_cleanup(&locator);
    return loc;
}

/* ============================================================================
 * Library Initialization
 * ============================================================================ */

void js_init(void) {
    /* No initialization needed for now */
}

void js_init_with_allocator(js_allocator_t alloc) {
    js_set_allocator(alloc);
}

void js_cleanup(void) {
    /* Reset to default allocator */
    js_allocator_t default_alloc = {NULL, NULL, NULL, NULL};
    js_set_allocator(default_alloc);
}

/* ============================================================================
 * Error Message Lookup
 * ============================================================================ */

const char* js_error_message(js_error_code_t code) {
    /* Map generic error codes to messages */
    switch (code) {
        case JS_ERROR_NONE:
            return "No error";
        case JS_ERROR_INVALID_ARGUMENT:
            return "Invalid argument";
        case JS_ERROR_OUT_OF_MEMORY:
            return "Out of memory";
        case JS_ERROR_PARSE_ERROR:
            return "JSON parse error";
        case JS_ERROR_INTERNAL_ERROR:
            return "Internal error";
        default:
            return "Unknown error";
    }
}
