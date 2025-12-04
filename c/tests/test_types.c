/**
 * @file test_types.c
 * @brief Tests for types.h functionality
 */

#include "json_structure/types.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>

#define TEST(name) static int test_##name(void)
#define RUN_TEST(name) do { \
    printf("  " #name "... "); \
    if (test_##name() == 0) { \
        printf("OK\n"); \
    } else { \
        printf("FAILED\n"); \
        failed++; \
    } \
} while(0)

/* ============================================================================
 * Type Tests
 * ============================================================================ */

TEST(type_names) {
    if (strcmp(js_type_name(JS_TYPE_STRING), "string") != 0) return 1;
    if (strcmp(js_type_name(JS_TYPE_INTEGER), "integer") != 0) return 1;
    if (strcmp(js_type_name(JS_TYPE_OBJECT), "object") != 0) return 1;
    if (strcmp(js_type_name(JS_TYPE_ARRAY), "array") != 0) return 1;
    if (strcmp(js_type_name(JS_TYPE_BOOLEAN), "boolean") != 0) return 1;
    if (strcmp(js_type_name(JS_TYPE_NULL), "null") != 0) return 1;
    if (strcmp(js_type_name(JS_TYPE_DATETIME), "datetime") != 0) return 1;
    if (strcmp(js_type_name(JS_TYPE_UUID), "uuid") != 0) return 1;
    return 0;
}

TEST(type_from_name) {
    if (js_type_from_name("string") != JS_TYPE_STRING) return 1;
    if (js_type_from_name("integer") != JS_TYPE_INTEGER) return 1;
    if (js_type_from_name("object") != JS_TYPE_OBJECT) return 1;
    if (js_type_from_name("array") != JS_TYPE_ARRAY) return 1;
    if (js_type_from_name("boolean") != JS_TYPE_BOOLEAN) return 1;
    if (js_type_from_name("null") != JS_TYPE_NULL) return 1;
    if (js_type_from_name("unknown_type") != JS_TYPE_UNKNOWN) return 1;
    if (js_type_from_name(NULL) != JS_TYPE_UNKNOWN) return 1;
    return 0;
}

TEST(type_is_primitive) {
    if (!js_type_is_primitive(JS_TYPE_STRING)) return 1;
    if (!js_type_is_primitive(JS_TYPE_INTEGER)) return 1;
    if (!js_type_is_primitive(JS_TYPE_NUMBER)) return 1;
    if (!js_type_is_primitive(JS_TYPE_BOOLEAN)) return 1;
    if (!js_type_is_primitive(JS_TYPE_NULL)) return 1;
    if (js_type_is_primitive(JS_TYPE_OBJECT)) return 1;
    if (js_type_is_primitive(JS_TYPE_ARRAY)) return 1;
    return 0;
}

TEST(type_is_numeric) {
    if (!js_type_is_numeric(JS_TYPE_INTEGER)) return 1;
    if (!js_type_is_numeric(JS_TYPE_NUMBER)) return 1;
    if (!js_type_is_numeric(JS_TYPE_INT32)) return 1;
    if (!js_type_is_numeric(JS_TYPE_FLOAT64)) return 1;
    if (!js_type_is_numeric(JS_TYPE_DECIMAL)) return 1;
    if (js_type_is_numeric(JS_TYPE_STRING)) return 1;
    if (js_type_is_numeric(JS_TYPE_OBJECT)) return 1;
    return 0;
}

TEST(type_is_string) {
    if (!js_type_is_string(JS_TYPE_STRING)) return 1;
    if (!js_type_is_string(JS_TYPE_DATETIME)) return 1;
    if (!js_type_is_string(JS_TYPE_UUID)) return 1;
    if (!js_type_is_string(JS_TYPE_URI)) return 1;
    if (!js_type_is_string(JS_TYPE_EMAIL)) return 1;
    if (js_type_is_string(JS_TYPE_INTEGER)) return 1;
    if (js_type_is_string(JS_TYPE_OBJECT)) return 1;
    return 0;
}

TEST(type_is_integer) {
    if (!js_type_is_integer(JS_TYPE_INTEGER)) return 1;
    if (!js_type_is_integer(JS_TYPE_INT8)) return 1;
    if (!js_type_is_integer(JS_TYPE_INT64)) return 1;
    if (!js_type_is_integer(JS_TYPE_UINT32)) return 1;
    if (js_type_is_integer(JS_TYPE_FLOAT32)) return 1;
    if (js_type_is_integer(JS_TYPE_NUMBER)) return 1;
    if (js_type_is_integer(JS_TYPE_STRING)) return 1;
    return 0;
}

/* ============================================================================
 * Allocator Tests
 * ============================================================================ */

static int custom_alloc_count = 0;
static int custom_free_count = 0;

static void* custom_malloc(size_t size) {
    custom_alloc_count++;
    return malloc(size);
}

static void* custom_realloc(void* ptr, size_t size) {
    return realloc(ptr, size);
}

static void custom_free(void* ptr) {
    if (ptr) custom_free_count++;
    free(ptr);
}

TEST(custom_allocator) {
    custom_alloc_count = 0;
    custom_free_count = 0;
    
    js_allocator_t alloc = {
        custom_malloc,
        custom_realloc,
        custom_free,
        NULL
    };
    
    js_set_allocator(alloc);
    
    char* str = js_strdup("test");
    if (!str) return 1;
    if (custom_alloc_count != 1) return 1;
    
    js_free(str);
    if (custom_free_count != 1) return 1;
    
    /* Reset to default */
    js_allocator_t default_alloc = {NULL, NULL, NULL, NULL};
    js_set_allocator(default_alloc);
    
    return 0;
}

/* ============================================================================
 * Error Tests
 * ============================================================================ */

TEST(error_init_cleanup) {
    js_error_t error;
    js_error_init(&error);
    
    if (error.code != 0) return 1;
    if (error.severity != JS_SEVERITY_ERROR) return 1;
    if (error.path != NULL) return 1;
    if (error.message != NULL) return 1;
    
    js_error_cleanup(&error);
    return 0;
}

TEST(error_set) {
    js_error_t error;
    js_error_init(&error);
    
    if (!js_error_set(&error, 42, JS_SEVERITY_WARNING, "/foo/bar", "Test error")) return 1;
    
    if (error.code != 42) return 1;
    if (error.severity != JS_SEVERITY_WARNING) return 1;
    if (strcmp(error.path, "/foo/bar") != 0) return 1;
    if (strcmp(error.message, "Test error") != 0) return 1;
    
    js_error_cleanup(&error);
    
    if (error.path != NULL) return 1;
    if (error.message != NULL) return 1;
    
    return 0;
}

/* ============================================================================
 * Result Tests
 * ============================================================================ */

TEST(result_init_cleanup) {
    js_result_t result;
    js_result_init(&result);
    
    if (!result.valid) return 1;
    if (result.errors != NULL) return 1;
    if (result.error_count != 0) return 1;
    
    js_result_cleanup(&result);
    return 0;
}

TEST(result_add_error) {
    js_result_t result;
    js_result_init(&result);
    
    if (!js_result_add_error(&result, 1, "First error", "/path1")) return 1;
    if (result.valid) return 1;  /* Should be invalid now */
    if (result.error_count != 1) return 1;
    
    if (!js_result_add_error(&result, 2, "Second error", "/path2")) return 1;
    if (result.error_count != 2) return 1;
    
    if (result.errors[0].code != 1) return 1;
    if (result.errors[1].code != 2) return 1;
    
    js_result_cleanup(&result);
    return 0;
}

TEST(result_add_warning) {
    js_result_t result;
    js_result_init(&result);
    
    if (!js_result_add_warning(&result, 1, "Warning message", "/path")) return 1;
    if (!result.valid) return 1;  /* Warnings shouldn't invalidate */
    if (result.error_count != 1) return 1;
    if (result.errors[0].severity != JS_SEVERITY_WARNING) return 1;
    
    js_result_cleanup(&result);
    return 0;
}

TEST(result_to_string) {
    js_result_t result;
    js_result_init(&result);
    
    char* str = js_result_to_string(&result);
    if (!str) return 1;
    if (strcmp(str, "Valid") != 0) return 1;
    js_free(str);
    
    js_result_add_error(&result, 1, "Test error", "/path");
    str = js_result_to_string(&result);
    if (!str) return 1;
    if (strstr(str, "Test error") == NULL) return 1;
    js_free(str);
    
    js_result_cleanup(&result);
    return 0;
}

/* ============================================================================
 * Location Tests
 * ============================================================================ */

TEST(location_make) {
    js_location_t loc = js_location_make(10, 5, 100);
    if (loc.line != 10) return 1;
    if (loc.column != 5) return 1;
    if (loc.offset != 100) return 1;
    return 0;
}

TEST(location_is_valid) {
    js_location_t valid_loc = js_location_make(1, 1, 0);
    js_location_t invalid_loc = js_location_make(0, 0, 0);
    
    if (!js_location_is_valid(valid_loc)) return 1;
    if (js_location_is_valid(invalid_loc)) return 1;
    
    return 0;
}

/* ============================================================================
 * Test Runner
 * ============================================================================ */

int test_types(void) {
    int failed = 0;
    
    RUN_TEST(type_names);
    RUN_TEST(type_from_name);
    RUN_TEST(type_is_primitive);
    RUN_TEST(type_is_numeric);
    RUN_TEST(type_is_string);
    RUN_TEST(type_is_integer);
    RUN_TEST(custom_allocator);
    RUN_TEST(error_init_cleanup);
    RUN_TEST(error_set);
    RUN_TEST(result_init_cleanup);
    RUN_TEST(result_add_error);
    RUN_TEST(result_add_warning);
    RUN_TEST(result_to_string);
    RUN_TEST(location_make);
    RUN_TEST(location_is_valid);
    
    return failed;
}
