/**
 * @file test_instance_validator.c
 * @brief Tests for instance validator functionality
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
 * Valid Instance Tests
 * ============================================================================ */

TEST(valid_string_instance) {
    const char* schema = "{\"type\": \"string\"}";
    const char* instance = "\"hello world\"";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_integer_instance) {
    const char* schema = "{\"type\": \"integer\"}";
    const char* instance = "42";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_number_instance) {
    const char* schema = "{\"type\": \"number\"}";
    const char* instance = "3.14159";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_boolean_instance) {
    const char* schema = "{\"type\": \"boolean\"}";
    
    js_result_t result1, result2;
    js_result_init(&result1);
    js_result_init(&result2);
    
    bool valid1 = js_validate_instance("true", schema, &result1);
    bool valid2 = js_validate_instance("false", schema, &result2);
    
    js_result_cleanup(&result1);
    js_result_cleanup(&result2);
    return (valid1 && valid2) ? 0 : 1;
}

TEST(valid_null_instance) {
    const char* schema = "{\"type\": \"null\"}";
    const char* instance = "null";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_object_instance) {
    const char* schema = "{"
        "\"type\": \"object\","
        "\"properties\": {"
            "\"name\": {\"type\": \"string\"},"
            "\"age\": {\"type\": \"integer\"}"
        "},"
        "\"required\": [\"name\"]"
    "}";
    const char* instance = "{\"name\": \"John\", \"age\": 30}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_array_instance) {
    const char* schema = "{"
        "\"type\": \"array\","
        "\"items\": {\"type\": \"integer\"}"
    "}";
    const char* instance = "[1, 2, 3, 4, 5]";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_nested_object) {
    const char* schema = "{"
        "\"type\": \"object\","
        "\"properties\": {"
            "\"address\": {"
                "\"type\": \"object\","
                "\"properties\": {"
                    "\"city\": {\"type\": \"string\"},"
                    "\"zip\": {\"type\": \"string\"}"
                "}"
            "}"
        "}"
    "}";
    const char* instance = "{\"address\": {\"city\": \"NYC\", \"zip\": \"10001\"}}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

/* ============================================================================
 * Constraint Tests
 * ============================================================================ */

TEST(valid_string_with_length_constraints) {
    const char* schema = "{\"type\": \"string\", \"minLength\": 3, \"maxLength\": 10}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance("\"hello\"", schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(invalid_string_too_short) {
    const char* schema = "{\"type\": \"string\", \"minLength\": 5}";
    const char* instance = "\"hi\"";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_string_too_long) {
    const char* schema = "{\"type\": \"string\", \"maxLength\": 3}";
    const char* instance = "\"hello\"";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(valid_number_in_range) {
    const char* schema = "{\"type\": \"number\", \"minimum\": 0, \"maximum\": 100}";
    const char* instance = "50";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(invalid_number_below_minimum) {
    const char* schema = "{\"type\": \"number\", \"minimum\": 0}";
    const char* instance = "-5";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_number_above_maximum) {
    const char* schema = "{\"type\": \"number\", \"maximum\": 100}";
    const char* instance = "150";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(valid_array_with_size_constraints) {
    const char* schema = "{\"type\": \"array\", \"items\": {\"type\": \"integer\"}, \"minItems\": 2, \"maxItems\": 5}";
    const char* instance = "[1, 2, 3]";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(invalid_array_too_short) {
    const char* schema = "{\"type\": \"array\", \"items\": {\"type\": \"integer\"}, \"minItems\": 5}";
    const char* instance = "[1, 2]";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_array_too_long) {
    const char* schema = "{\"type\": \"array\", \"items\": {\"type\": \"integer\"}, \"maxItems\": 2}";
    const char* instance = "[1, 2, 3, 4, 5]";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

/* ============================================================================
 * Type Mismatch Tests
 * ============================================================================ */

TEST(invalid_type_mismatch_string_for_integer) {
    const char* schema = "{\"type\": \"integer\"}";
    const char* instance = "\"not an integer\"";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_type_mismatch_number_for_string) {
    const char* schema = "{\"type\": \"string\"}";
    const char* instance = "42";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_type_mismatch_float_for_integer) {
    const char* schema = "{\"type\": \"integer\"}";
    const char* instance = "3.14";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

/* ============================================================================
 * Required Property Tests
 * ============================================================================ */

TEST(invalid_missing_required_property) {
    const char* schema = "{"
        "\"type\": \"object\","
        "\"properties\": {"
            "\"name\": {\"type\": \"string\"},"
            "\"email\": {\"type\": \"string\"}"
        "},"
        "\"required\": [\"name\", \"email\"]"
    "}";
    const char* instance = "{\"name\": \"John\"}";  /* Missing email */
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

/* ============================================================================
 * Enum/Const Tests
 * ============================================================================ */

TEST(valid_enum_value) {
    const char* schema = "{\"type\": \"string\", \"enum\": [\"red\", \"green\", \"blue\"]}";
    const char* instance = "\"green\"";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(invalid_enum_value) {
    const char* schema = "{\"type\": \"string\", \"enum\": [\"red\", \"green\", \"blue\"]}";
    const char* instance = "\"yellow\"";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(valid_const_value) {
    const char* schema = "{\"type\": \"string\", \"const\": \"hello\"}";
    const char* instance = "\"hello\"";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(invalid_const_value) {
    const char* schema = "{\"type\": \"string\", \"const\": \"hello\"}";
    const char* instance = "\"world\"";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

/* ============================================================================
 * Map Tests
 * ============================================================================ */

TEST(valid_map_instance) {
    const char* schema = "{"
        "\"type\": \"map\","
        "\"values\": {\"type\": \"integer\"}"
    "}";
    const char* instance = "{\"a\": 1, \"b\": 2, \"c\": 3}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(invalid_map_value_type) {
    const char* schema = "{"
        "\"type\": \"map\","
        "\"values\": {\"type\": \"integer\"}"
    "}";
    const char* instance = "{\"a\": 1, \"b\": \"not integer\"}";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

/* ============================================================================
 * Union Type Tests
 * ============================================================================ */

TEST(valid_union_type_string) {
    const char* schema = "{\"type\": [\"string\", \"null\"]}";
    const char* instance = "\"hello\"";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_union_type_null) {
    const char* schema = "{\"type\": [\"string\", \"null\"]}";
    const char* instance = "null";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(invalid_union_type) {
    const char* schema = "{\"type\": [\"string\", \"null\"]}";
    const char* instance = "42";
    
    js_result_t result;
    js_result_init(&result);
    
    bool valid = js_validate_instance(instance, schema, &result);
    
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

/* ============================================================================
 * Test Runner
 * ============================================================================ */

int test_instance_validator(void) {
    int failed = 0;
    
    /* Basic type validation */
    RUN_TEST(valid_string_instance);
    RUN_TEST(valid_integer_instance);
    RUN_TEST(valid_number_instance);
    RUN_TEST(valid_boolean_instance);
    RUN_TEST(valid_null_instance);
    RUN_TEST(valid_object_instance);
    RUN_TEST(valid_array_instance);
    RUN_TEST(valid_nested_object);
    
    /* Constraint tests */
    RUN_TEST(valid_string_with_length_constraints);
    RUN_TEST(invalid_string_too_short);
    RUN_TEST(invalid_string_too_long);
    RUN_TEST(valid_number_in_range);
    RUN_TEST(invalid_number_below_minimum);
    RUN_TEST(invalid_number_above_maximum);
    RUN_TEST(valid_array_with_size_constraints);
    RUN_TEST(invalid_array_too_short);
    RUN_TEST(invalid_array_too_long);
    
    /* Type mismatch tests */
    RUN_TEST(invalid_type_mismatch_string_for_integer);
    RUN_TEST(invalid_type_mismatch_number_for_string);
    RUN_TEST(invalid_type_mismatch_float_for_integer);
    
    /* Required property tests */
    RUN_TEST(invalid_missing_required_property);
    
    /* Enum/Const tests */
    RUN_TEST(valid_enum_value);
    RUN_TEST(invalid_enum_value);
    RUN_TEST(valid_const_value);
    RUN_TEST(invalid_const_value);
    
    /* Map tests */
    RUN_TEST(valid_map_instance);
    RUN_TEST(invalid_map_value_type);
    
    /* Union type tests */
    RUN_TEST(valid_union_type_string);
    RUN_TEST(valid_union_type_null);
    RUN_TEST(invalid_union_type);
    
    return failed;
}
