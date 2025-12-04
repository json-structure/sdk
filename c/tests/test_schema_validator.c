/**
 * @file test_schema_validator.c
 * @brief Tests for schema validator functionality
 */

#include "json_structure/json_structure.h"
#include <stdio.h>
#include <string.h>

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
 * Valid Schema Tests
 * ============================================================================ */

TEST(valid_simple_string_schema) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"TestString\","
        "\"type\": \"string\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_object_schema) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Person\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"name\": {\"type\": \"string\"},"
            "\"age\": {\"type\": \"integer\"}"
        "},"
        "\"required\": [\"name\"]"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_array_schema) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"StringList\","
        "\"type\": \"array\","
        "\"items\": {\"type\": \"string\"}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_map_schema) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"StringMap\","
        "\"type\": \"map\","
        "\"values\": {\"type\": \"integer\"}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_choice_schema) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Shape\","
        "\"type\": \"choice\","
        "\"selector\": \"kind\","
        "\"choices\": {"
            "\"circle\": {\"type\": \"object\", \"properties\": {\"radius\": {\"type\": \"number\"}}},"
            "\"rect\": {\"type\": \"object\", \"properties\": {\"width\": {\"type\": \"number\"}}}"
        "}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_with_definitions) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Order\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"items\": {\"type\": \"array\", \"items\": {\"$ref\": \"#/$defs/Item\"}}"
        "},"
        "\"$defs\": {"
            "\"Item\": {"
                "\"type\": \"object\","
                "\"properties\": {"
                    "\"name\": {\"type\": \"string\"},"
                    "\"price\": {\"type\": \"number\"}"
                "}"
            "}"
        "}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_with_constraints) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"ConstrainedValues\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"name\": {\"type\": \"string\", \"minLength\": 1, \"maxLength\": 100},"
            "\"count\": {\"type\": \"integer\", \"minimum\": 0, \"maximum\": 1000},"
            "\"items\": {\"type\": \"array\", \"items\": {\"type\": \"string\"}, \"minItems\": 1}"
        "}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

/* ============================================================================
 * Invalid Schema Tests
 * ============================================================================ */

TEST(invalid_missing_type) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"NoType\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    /* Should have an error about missing type */
    int type_error_found = 0;
    for (size_t i = 0; i < result.error_count; i++) {
        if (result.errors[i].severity == JS_SEVERITY_ERROR) {
            type_error_found = 1;
            break;
        }
    }
    
    js_result_cleanup(&result);
    return (!valid && type_error_found) ? 0 : 1;
}

TEST(invalid_unknown_type) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"UnknownType\","
        "\"type\": \"foobar\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_array_missing_items) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"BadArray\","
        "\"type\": \"array\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_map_missing_values) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"BadMap\","
        "\"type\": \"map\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_minlength_exceeds_maxlength) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"BadConstraints\","
        "\"type\": \"string\","
        "\"minLength\": 100,"
        "\"maxLength\": 10"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_minimum_exceeds_maximum) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"BadConstraints\","
        "\"type\": \"integer\","
        "\"minimum\": 100,"
        "\"maximum\": 10"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_json_syntax) {
    const char* schema = "{invalid json}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_schema(schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

/* ============================================================================
 * Type Checking Tests
 * ============================================================================ */

TEST(is_valid_primitive_type) {
    if (!js_schema_is_valid_primitive_type("string")) return 1;
    if (!js_schema_is_valid_primitive_type("integer")) return 1;
    if (!js_schema_is_valid_primitive_type("number")) return 1;
    if (!js_schema_is_valid_primitive_type("boolean")) return 1;
    if (!js_schema_is_valid_primitive_type("null")) return 1;
    if (!js_schema_is_valid_primitive_type("datetime")) return 1;
    if (!js_schema_is_valid_primitive_type("uuid")) return 1;
    if (js_schema_is_valid_primitive_type("object")) return 1;
    if (js_schema_is_valid_primitive_type("foobar")) return 1;
    return 0;
}

TEST(is_valid_compound_type) {
    if (!js_schema_is_valid_compound_type("object")) return 1;
    if (!js_schema_is_valid_compound_type("array")) return 1;
    if (!js_schema_is_valid_compound_type("map")) return 1;
    if (!js_schema_is_valid_compound_type("set")) return 1;
    if (!js_schema_is_valid_compound_type("choice")) return 1;
    if (js_schema_is_valid_compound_type("string")) return 1;
    if (js_schema_is_valid_compound_type("foobar")) return 1;
    return 0;
}

/* ============================================================================
 * Test Runner
 * ============================================================================ */

int test_schema_validator(void) {
    int failed = 0;
    
    /* Valid schemas */
    RUN_TEST(valid_simple_string_schema);
    RUN_TEST(valid_object_schema);
    RUN_TEST(valid_array_schema);
    RUN_TEST(valid_map_schema);
    RUN_TEST(valid_choice_schema);
    RUN_TEST(valid_with_definitions);
    RUN_TEST(valid_with_constraints);
    
    /* Invalid schemas */
    RUN_TEST(invalid_missing_type);
    RUN_TEST(invalid_unknown_type);
    RUN_TEST(invalid_array_missing_items);
    RUN_TEST(invalid_map_missing_values);
    RUN_TEST(invalid_minlength_exceeds_maxlength);
    RUN_TEST(invalid_minimum_exceeds_maximum);
    RUN_TEST(invalid_json_syntax);
    
    /* Type checking */
    RUN_TEST(is_valid_primitive_type);
    RUN_TEST(is_valid_compound_type);
    
    return failed;
}
