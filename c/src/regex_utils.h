/**
 * @file regex_utils.h
 * @brief Simple regex utilities for pattern matching
 *
 * This module provides basic regex pattern validation and matching.
 * On POSIX systems, it uses the standard regex.h.
 * On Windows, it uses the CRT regex or a simple implementation.
 *
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#ifndef JS_REGEX_UTILS_H
#define JS_REGEX_UTILS_H

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Check if a regex pattern is valid
 * 
 * @param pattern The regex pattern to validate
 * @return true if the pattern compiles successfully, false otherwise
 */
bool js_regex_is_valid(const char* pattern);

/**
 * Match a string against a regex pattern
 * 
 * @param pattern The regex pattern
 * @param text The text to match
 * @return true if text matches the pattern, false otherwise
 */
bool js_regex_match(const char* pattern, const char* text);

/**
 * Clear the regex compilation cache
 * 
 * Frees all cached compiled regex objects. Useful for testing
 * or when memory needs to be reclaimed.
 */
void js_regex_cache_clear(void);

#ifdef __cplusplus
}
#endif

#endif /* JS_REGEX_UTILS_H */
