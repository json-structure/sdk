/**
 * @file test_conformance.c
 * @brief Conformance tests validating C SDK against test-assets
 * 
 * These tests ensure the C SDK produces the same results as the Python SDK
 * when validating the test-assets schemas and instances.
 */

#include "json_structure/json_structure.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <dirent.h>
#endif

#define TEST(name) static int test_##name(void)
#define RUN_TEST(name) do { \
    printf("  " #name "... "); \
    if (test_##name() == 0) { \
        printf("OK\n"); \
        passed++; \
    } else { \
        printf("FAILED\n"); \
        failed++; \
    } \
    total++; \
} while(0)

static int passed = 0;
static int failed = 0;
static int total = 0;

/* ============================================================================
 * Helper Functions
 * ============================================================================ */

static char* read_file_content(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) return NULL;
    
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    
    char* content = (char*)malloc(size + 1);
    if (!content) {
        fclose(f);
        return NULL;
    }
    
    size_t read = fread(content, 1, size, f);
    content[read] = '\0';
    fclose(f);
    
    return content;
}

/* ============================================================================
 * Invalid Schema Tests
 * These schemas should fail validation
 * ============================================================================ */

TEST(invalid_allof_not_array) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"allOf\": {}"
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
        "\"name\": \"TestArray\","
        "\"type\": \"array\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_circular_ref_direct) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Circular\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"self\": {\"type\": {\"$ref\": \"#/$defs/Circular\"}}"
        "},"
        "\"$defs\": {"
            "\"Circular\": {"
                "\"type\": {\"$ref\": \"#/$defs/Circular\"}"
            "}"
        "}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    bool has_circular_error = false;
    for (size_t i = 0; i < result.error_count; i++) {
        if (result.errors[i].code == JS_SCHEMA_REF_CIRCULAR) {
            has_circular_error = true;
            break;
        }
    }
    js_result_cleanup(&result);
    /* Circular refs should be detected */
    return !valid ? 0 : 1;
}

TEST(invalid_defs_not_object) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"string\","
        "\"$defs\": []"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_enum_duplicates) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"string\","
        "\"enum\": [\"a\", \"b\", \"a\"]"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_enum_empty) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"string\","
        "\"enum\": []"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_enum_not_array) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"string\","
        "\"enum\": \"not an array\""
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
        "\"name\": \"TestMap\","
        "\"type\": \"map\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_missing_type) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"NoType\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_properties_not_object) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"object\","
        "\"properties\": []"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_ref_undefined) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"item\": {\"type\": {\"$ref\": \"#/$defs/DoesNotExist\"}}"
        "}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_required_missing_property) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"name\": {\"type\": \"string\"}"
        "},"
        "\"required\": [\"age\"]"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    /* Should produce an error - required property not in properties */
    bool has_error = !valid && result.error_count > 0;
    js_result_cleanup(&result);
    return has_error ? 0 : 1;
}

TEST(invalid_required_not_array) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"name\": {\"type\": \"string\"}"
        "},"
        "\"required\": \"name\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_tuple_missing_definition) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"TestTuple\","
        "\"type\": \"tuple\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(invalid_unknown_type) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"notavalidtype\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

/* ============================================================================
 * Valid Schema Tests (with extensions)
 * These schemas should pass validation
 * ============================================================================ */

TEST(valid_with_uses_string_pattern) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"$uses\": [\"JSONStructureValidation\"],"
        "\"name\": \"PatternString\","
        "\"type\": \"string\","
        "\"pattern\": \"^[a-z]+$\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_with_uses_numeric_minimum) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"$uses\": [\"JSONStructureValidation\"],"
        "\"name\": \"PositiveNumber\","
        "\"type\": \"number\","
        "\"minimum\": 0"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_with_uses_array_contains) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"$uses\": [\"JSONStructureValidation\"],"
        "\"name\": \"ArrayWithContains\","
        "\"type\": \"array\","
        "\"items\": {\"type\": \"string\"},"
        "\"contains\": {\"type\": \"string\", \"const\": \"required\"}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_with_uses_dependent_required) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"$uses\": [\"JSONStructureValidation\"],"
        "\"name\": \"WithDependentRequired\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"creditCard\": {\"type\": \"string\"},"
            "\"billingAddress\": {\"type\": \"string\"}"
        "},"
        "\"dependentRequired\": {"
            "\"creditCard\": [\"billingAddress\"]"
        "}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(valid_all_primitive_types) {
    const char* types[] = {
        "null", "boolean", "integer", "number", "string", "binary",
        "int8", "int16", "int32", "int64",
        "uint8", "uint16", "uint32", "uint64",
        "float", "double", "decimal",
        "datetime", "date", "time", "duration",
        "uuid", "uri",
        NULL
    };
    
    for (const char** t = types; *t != NULL; t++) {
        char schema[512];
        snprintf(schema, sizeof(schema),
            "{"
                "\"$id\": \"test\","
                "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
                "\"name\": \"Test%s\","
                "\"type\": \"%s\""
            "}", *t, *t);
        
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_schema(schema, &result);
        js_result_cleanup(&result);
        
        if (!valid) {
            printf("(failed on type '%s') ", *t);
            return 1;
        }
    }
    return 0;
}

TEST(valid_all_compound_types) {
    /* object */
    {
        const char* schema = "{"
            "\"$id\": \"test\","
            "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
            "\"name\": \"TestObject\","
            "\"type\": \"object\","
            "\"properties\": {\"foo\": {\"type\": \"string\"}}"
        "}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_schema(schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* array */
    {
        const char* schema = "{"
            "\"$id\": \"test\","
            "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
            "\"name\": \"TestArray\","
            "\"type\": \"array\","
            "\"items\": {\"type\": \"string\"}"
        "}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_schema(schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* set */
    {
        const char* schema = "{"
            "\"$id\": \"test\","
            "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
            "\"name\": \"TestSet\","
            "\"type\": \"set\","
            "\"items\": {\"type\": \"integer\"}"
        "}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_schema(schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* map */
    {
        const char* schema = "{"
            "\"$id\": \"test\","
            "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
            "\"name\": \"TestMap\","
            "\"type\": \"map\","
            "\"values\": {\"type\": \"number\"}"
        "}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_schema(schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* tuple */
    {
        const char* schema = "{"
            "\"$id\": \"test\","
            "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
            "\"name\": \"TestTuple\","
            "\"type\": \"tuple\","
            "\"tuple\": [\"name\", \"age\"],"
            "\"properties\": {"
                "\"name\": {\"type\": \"string\"},"
                "\"age\": {\"type\": \"integer\"}"
            "}"
        "}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_schema(schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* choice */
    {
        const char* schema = "{"
            "\"$id\": \"test\","
            "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
            "\"name\": \"TestChoice\","
            "\"type\": \"choice\","
            "\"selector\": \"kind\","
            "\"choices\": {"
                "\"a\": {\"type\": \"object\", \"properties\": {\"x\": {\"type\": \"string\"}}},"
                "\"b\": {\"type\": \"object\", \"properties\": {\"y\": {\"type\": \"integer\"}}}"
            "}"
        "}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_schema(schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* any */
    {
        const char* schema = "{"
            "\"$id\": \"test\","
            "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
            "\"name\": \"TestAny\","
            "\"type\": \"any\""
        "}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_schema(schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

/* ============================================================================
 * Instance Validation Tests - Type Checking
 * ============================================================================ */

TEST(instance_valid_datetime) {
    const char* schema = "{\"type\": \"datetime\"}";
    const char* valid_instances[] = {
        "\"2024-01-15T14:30:00Z\"",
        "\"2024-12-31T23:59:59.999Z\"",
        "\"2024-01-01T00:00:00+00:00\"",
        NULL
    };
    
    for (const char** inst = valid_instances; *inst != NULL; inst++) {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance(*inst, schema, &result);
        js_result_cleanup(&result);
        if (!valid) {
            printf("(failed on %s) ", *inst);
            return 1;
        }
    }
    return 0;
}

TEST(instance_invalid_datetime) {
    const char* schema = "{\"type\": \"datetime\"}";
    const char* invalid_instances[] = {
        "\"not a date\"",
        "\"2024-13-01T00:00:00Z\"",  /* Invalid month */
        "\"2024-01-32T00:00:00Z\"",  /* Invalid day */
        "42",  /* Not a string */
        NULL
    };
    
    for (const char** inst = invalid_instances; *inst != NULL; inst++) {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance(*inst, schema, &result);
        js_result_cleanup(&result);
        if (valid) {
            printf("(should have failed on %s) ", *inst);
            return 1;
        }
    }
    return 0;
}

TEST(instance_valid_uuid) {
    const char* schema = "{\"type\": \"uuid\"}";
    const char* valid_instances[] = {
        "\"550e8400-e29b-41d4-a716-446655440000\"",
        "\"00000000-0000-0000-0000-000000000000\"",
        "\"ffffffff-ffff-ffff-ffff-ffffffffffff\"",
        NULL
    };
    
    for (const char** inst = valid_instances; *inst != NULL; inst++) {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance(*inst, schema, &result);
        js_result_cleanup(&result);
        if (!valid) {
            printf("(failed on %s) ", *inst);
            return 1;
        }
    }
    return 0;
}

TEST(instance_invalid_uuid) {
    const char* schema = "{\"type\": \"uuid\"}";
    const char* invalid_instances[] = {
        "\"not-a-uuid\"",
        "\"550e8400-e29b-41d4-a716-446655440000-extra\"",
        "\"550e8400e29b41d4a716446655440000\"",  /* Missing dashes */
        "42",  /* Not a string */
        NULL
    };
    
    for (const char** inst = invalid_instances; *inst != NULL; inst++) {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance(*inst, schema, &result);
        js_result_cleanup(&result);
        if (valid) {
            printf("(should have failed on %s) ", *inst);
            return 1;
        }
    }
    return 0;
}

TEST(instance_valid_uri) {
    const char* schema = "{\"type\": \"uri\"}";
    const char* valid_instances[] = {
        "\"https://example.com\"",
        "\"http://example.com/path?query=1\"",
        "\"ftp://ftp.example.com/file.txt\"",
        NULL
    };
    
    for (const char** inst = valid_instances; *inst != NULL; inst++) {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance(*inst, schema, &result);
        js_result_cleanup(&result);
        if (!valid) {
            printf("(failed on %s) ", *inst);
            return 1;
        }
    }
    return 0;
}

TEST(instance_valid_set_uniqueness) {
    const char* schema = "{\"type\": \"set\", \"items\": {\"type\": \"integer\"}}";
    
    /* Valid set - all unique */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("[1, 2, 3, 4, 5]", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid set - duplicates */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("[1, 2, 2, 3]", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;  /* Should fail due to duplicates */
    }
    
    return 0;
}

TEST(instance_valid_map) {
    const char* schema = "{\"type\": \"map\", \"values\": {\"type\": \"integer\"}}";
    
    /* Valid map */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{\"a\": 1, \"b\": 2, \"c\": 3}", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid - value is wrong type */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{\"a\": 1, \"b\": \"not a number\"}", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    return 0;
}

TEST(instance_valid_nested_object) {
    const char* schema = "{"
        "\"type\": \"object\","
        "\"properties\": {"
            "\"person\": {"
                "\"type\": \"object\","
                "\"properties\": {"
                    "\"name\": {\"type\": \"string\"},"
                    "\"age\": {\"type\": \"integer\"}"
                "},"
                "\"required\": [\"name\"]"
            "}"
        "},"
        "\"required\": [\"person\"]"
    "}";
    
    /* Valid nested object */
    {
        const char* instance = "{\"person\": {\"name\": \"John\", \"age\": 30}}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance(instance, schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Missing required nested property */
    {
        const char* instance = "{\"person\": {\"age\": 30}}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance(instance, schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    return 0;
}

TEST(instance_valid_with_definitions) {
    const char* schema = "{"
        "\"type\": \"object\","
        "\"properties\": {"
            "\"items\": {"
                "\"type\": \"array\","
                "\"items\": {\"type\": {\"$ref\": \"#/$defs/Item\"}}"
            "}"
        "},"
        "\"$defs\": {"
            "\"Item\": {"
                "\"type\": \"object\","
                "\"properties\": {"
                    "\"name\": {\"type\": \"string\"},"
                    "\"quantity\": {\"type\": \"integer\"}"
                "},"
                "\"required\": [\"name\", \"quantity\"]"
            "}"
        "}"
    "}";
    
    /* Valid instance with ref */
    {
        const char* instance = "{\"items\": ["
            "{\"name\": \"Apple\", \"quantity\": 5},"
            "{\"name\": \"Banana\", \"quantity\": 3}"
        "]}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance(instance, schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid - missing required property in referenced schema */
    {
        const char* instance = "{\"items\": [{\"name\": \"Apple\"}]}";
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance(instance, schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    return 0;
}

TEST(instance_additional_properties_false) {
    const char* schema = "{"
        "\"type\": \"object\","
        "\"properties\": {"
            "\"name\": {\"type\": \"string\"}"
        "},"
        "\"additionalProperties\": false"
    "}";
    
    /* Valid - only defined properties */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{\"name\": \"John\"}", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid - additional property */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{\"name\": \"John\", \"extra\": 123}", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    return 0;
}

/* ============================================================================
 * Integer Range Tests
 * ============================================================================ */

TEST(instance_int8_range) {
    const char* schema = "{\"type\": \"int8\"}";
    
    /* Valid int8 values */
    const char* valid[] = {"0", "127", "-128", "1", "-1", NULL};
    for (const char** v = valid; *v != NULL; v++) {
        js_result_t result;
        js_result_init(&result);
        bool is_valid = js_validate_instance(*v, schema, &result);
        js_result_cleanup(&result);
        if (!is_valid) {
            printf("(failed valid %s) ", *v);
            return 1;
        }
    }
    
    /* Invalid int8 values */
    const char* invalid[] = {"128", "-129", "256", "-256", NULL};
    for (const char** v = invalid; *v != NULL; v++) {
        js_result_t result;
        js_result_init(&result);
        bool is_valid = js_validate_instance(*v, schema, &result);
        js_result_cleanup(&result);
        if (is_valid) {
            printf("(should fail %s) ", *v);
            return 1;
        }
    }
    
    return 0;
}

TEST(instance_uint8_range) {
    const char* schema = "{\"type\": \"uint8\"}";
    
    /* Valid uint8 values */
    const char* valid[] = {"0", "255", "128", "1", NULL};
    for (const char** v = valid; *v != NULL; v++) {
        js_result_t result;
        js_result_init(&result);
        bool is_valid = js_validate_instance(*v, schema, &result);
        js_result_cleanup(&result);
        if (!is_valid) {
            printf("(failed valid %s) ", *v);
            return 1;
        }
    }
    
    /* Invalid uint8 values */
    const char* invalid[] = {"-1", "256", "-128", NULL};
    for (const char** v = invalid; *v != NULL; v++) {
        js_result_t result;
        js_result_init(&result);
        bool is_valid = js_validate_instance(*v, schema, &result);
        js_result_cleanup(&result);
        if (is_valid) {
            printf("(should fail %s) ", *v);
            return 1;
        }
    }
    
    return 0;
}

/* ============================================================================
 * Test Runner
 * ============================================================================ */

/* ============================================================================
 * Additional Schema Validation Tests
 * ============================================================================ */

TEST(schema_anyof_not_array) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"anyOf\": \"not an array\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(schema_oneof_not_array) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"oneOf\": {}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(schema_valid_with_composition) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"allOf\": [{\"type\": \"string\"}]"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(schema_valid_if_then_else) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"object\","
        "\"if\": {\"type\": \"object\"},"
        "\"then\": {\"type\": \"object\"},"
        "\"else\": {\"type\": \"object\"}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

TEST(schema_then_without_if) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"string\","
        "\"then\": {\"type\": \"string\"}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(schema_else_without_if) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"string\","
        "\"else\": {\"type\": \"string\"}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

TEST(schema_valid_not) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"not\": {\"type\": \"null\"}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_schema(schema, &result);
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

/* ============================================================================
 * Additional Instance Validation Tests
 * ============================================================================ */

TEST(instance_allof_validation) {
    const char* schema = "{"
        "\"allOf\": ["
            "{\"type\": \"object\", \"properties\": {\"name\": {\"type\": \"string\"}}},"
            "{\"type\": \"object\", \"properties\": {\"age\": {\"type\": \"integer\"}}}"
        "]"
    "}";
    
    /* Valid - satisfies both schemas */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{\"name\": \"John\", \"age\": 30}", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

TEST(instance_anyof_validation) {
    const char* schema = "{"
        "\"anyOf\": ["
            "{\"type\": \"string\"},"
            "{\"type\": \"integer\"}"
        "]"
    "}";
    
    /* Valid - matches string */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("\"hello\"", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Valid - matches integer */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("42", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid - matches neither */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("3.14", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;  /* Should fail */
    }
    
    return 0;
}

TEST(instance_oneof_validation) {
    const char* schema = "{"
        "\"oneOf\": ["
            "{\"type\": \"string\", \"minLength\": 5},"
            "{\"type\": \"string\", \"maxLength\": 3}"
        "]"
    "}";
    
    /* Valid - matches first only (length > 5) */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("\"hello world\"", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Valid - matches second only (length <= 3) */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("\"hi\"", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

TEST(instance_not_validation) {
    const char* schema = "{"
        "\"not\": {\"type\": \"null\"}"
    "}";
    
    /* Valid - not null */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("\"hello\"", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid - is null */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("null", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    return 0;
}

TEST(instance_int16_range) {
    const char* schema = "{\"type\": \"int16\"}";
    
    /* Valid values */
    const char* valid[] = {"0", "32767", "-32768", NULL};
    for (const char** v = valid; *v != NULL; v++) {
        js_result_t result;
        js_result_init(&result);
        bool is_valid = js_validate_instance(*v, schema, &result);
        js_result_cleanup(&result);
        if (!is_valid) return 1;
    }
    
    /* Invalid values */
    const char* invalid[] = {"32768", "-32769", NULL};
    for (const char** v = invalid; *v != NULL; v++) {
        js_result_t result;
        js_result_init(&result);
        bool is_valid = js_validate_instance(*v, schema, &result);
        js_result_cleanup(&result);
        if (is_valid) return 1;
    }
    
    return 0;
}

TEST(instance_int32_range) {
    const char* schema = "{\"type\": \"int32\"}";
    
    /* Valid values */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("2147483647", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("-2147483648", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

TEST(instance_uint16_range) {
    const char* schema = "{\"type\": \"uint16\"}";
    
    /* Valid values */
    const char* valid[] = {"0", "65535", "32768", NULL};
    for (const char** v = valid; *v != NULL; v++) {
        js_result_t result;
        js_result_init(&result);
        bool is_valid = js_validate_instance(*v, schema, &result);
        js_result_cleanup(&result);
        if (!is_valid) return 1;
    }
    
    /* Invalid values */
    const char* invalid[] = {"-1", "65536", NULL};
    for (const char** v = invalid; *v != NULL; v++) {
        js_result_t result;
        js_result_init(&result);
        bool is_valid = js_validate_instance(*v, schema, &result);
        js_result_cleanup(&result);
        if (is_valid) return 1;
    }
    
    return 0;
}

TEST(instance_uint32_range) {
    const char* schema = "{\"type\": \"uint32\"}";
    
    /* Valid values */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("0", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("4294967295", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid values */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("-1", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    return 0;
}

TEST(instance_float_types) {
    /* Test float type */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("3.14", "{\"type\": \"float\"}", &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Test double type */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("3.14159265358979", "{\"type\": \"double\"}", &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Test decimal type */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("123.456", "{\"type\": \"decimal\"}", &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

TEST(instance_exclusive_bounds) {
    /* Test exclusiveMinimum */
    {
        const char* schema = "{\"type\": \"number\", \"exclusiveMinimum\": 0}";
        
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("0.1", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
        
        js_result_init(&result);
        valid = js_validate_instance("0", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;  /* Should fail */
    }
    
    /* Test exclusiveMaximum */
    {
        const char* schema = "{\"type\": \"number\", \"exclusiveMaximum\": 10}";
        
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("9.9", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
        
        js_result_init(&result);
        valid = js_validate_instance("10", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;  /* Should fail */
    }
    
    return 0;
}

TEST(instance_multiple_of) {
    const char* schema = "{\"type\": \"number\", \"multipleOf\": 5}";
    
    /* Valid multiples */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("15", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid - not a multiple */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("7", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    return 0;
}

TEST(instance_date_type) {
    const char* schema = "{\"type\": \"date\"}";
    
    /* Valid date */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("\"2024-01-15\"", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

TEST(instance_binary_type) {
    const char* schema = "{\"type\": \"binary\"}";
    
    /* Valid base64 string */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("\"SGVsbG8gV29ybGQ=\"", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

TEST(instance_choice_validation) {
    const char* schema = "{"
        "\"type\": \"choice\","
        "\"selector\": \"kind\","
        "\"choices\": {"
            "\"circle\": {"
                "\"type\": \"object\","
                "\"properties\": {"
                    "\"kind\": {\"type\": \"string\"},"
                    "\"radius\": {\"type\": \"number\"}"
                "},"
                "\"required\": [\"kind\", \"radius\"]"
            "},"
            "\"rectangle\": {"
                "\"type\": \"object\","
                "\"properties\": {"
                    "\"kind\": {\"type\": \"string\"},"
                    "\"width\": {\"type\": \"number\"},"
                    "\"height\": {\"type\": \"number\"}"
                "},"
                "\"required\": [\"kind\", \"width\", \"height\"]"
            "}"
        "}"
    "}";
    
    /* Valid circle */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{\"kind\": \"circle\", \"radius\": 5}", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Valid rectangle */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{\"kind\": \"rectangle\", \"width\": 10, \"height\": 20}", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

/* Test tuple instance validation */
TEST(instance_tuple_validation) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Point\","
        "\"type\": \"tuple\","
        "\"tuple\": [\"x\", \"y\"],"
        "\"properties\": {"
            "\"x\": {\"type\": \"number\"},"
            "\"y\": {\"type\": \"number\"}"
        "}"
    "}";
    
    /* Valid tuple as array */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("[10, 20]", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid: not an array */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{\"x\": 10, \"y\": 20}", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    return 0;
}

/* Test pattern constraint validation */
TEST(instance_pattern_validation) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Email\","
        "\"type\": \"string\","
        "\"pattern\": \"^[a-z]+@[a-z]+\\\\.[a-z]+$\""
    "}";
    
    /* Valid pattern match */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("\"test@example.com\"", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

/* Test contains constraint validation */
TEST(instance_contains_validation) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Numbers\","
        "\"type\": \"array\","
        "\"items\": {\"type\": \"number\"},"
        "\"contains\": {\"type\": \"number\", \"minimum\": 10}"
    "}";
    
    /* Valid: contains a number >= 10 */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("[1, 2, 15, 3]", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

/* Test prefixItems constraint */
TEST(instance_prefix_items) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Mixed\","
        "\"type\": \"array\","
        "\"prefixItems\": ["
            "{\"type\": \"string\"},"
            "{\"type\": \"number\"}"
        "]"
    "}";
    
    /* Valid prefix items */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("[\"hello\", 42]", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

/* Test nested union type validation */
TEST(instance_nested_union) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Value\","
        "\"type\": [\"string\", \"number\", \"boolean\", \"null\"]"
    "}";
    
    /* Test each type in union */
    const char* values[] = {"\"hello\"", "42", "true", "null"};
    for (int i = 0; i < 4; i++) {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance(values[i], schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    return 0;
}

/* Test deep nesting validation */
TEST(instance_deep_nesting) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Nested\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"level1\": {"
                "\"type\": \"object\","
                "\"properties\": {"
                    "\"level2\": {"
                        "\"type\": \"object\","
                        "\"properties\": {"
                            "\"level3\": {\"type\": \"string\"}"
                        "}"
                    "}"
                "}"
            "}"
        "}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_instance(
        "{\"level1\": {\"level2\": {\"level3\": \"deep\"}}}", 
        schema, &result);
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

/* Test empty object validation */
TEST(instance_empty_object) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Empty\","
        "\"type\": \"object\""
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_instance("{}", schema, &result);
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

/* Test empty array validation */
TEST(instance_empty_array) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Empty\","
        "\"type\": \"array\","
        "\"items\": {\"type\": \"string\"}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    bool valid = js_validate_instance("[]", schema, &result);
    js_result_cleanup(&result);
    return valid ? 0 : 1;
}

/* Test minProperties/maxProperties validation */
TEST(instance_object_property_count) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Limited\","
        "\"type\": \"object\","
        "\"minProperties\": 1,"
        "\"maxProperties\": 3"
    "}";
    
    /* Valid: 2 properties */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{\"a\": 1, \"b\": 2}", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid: 0 properties */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{}", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    /* Invalid: 4 properties */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("{\"a\": 1, \"b\": 2, \"c\": 3, \"d\": 4}", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    return 0;
}

/* Test uniqueItems constraint */
TEST(instance_unique_items) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"UniqueList\","
        "\"type\": \"array\","
        "\"items\": {\"type\": \"number\"},"
        "\"uniqueItems\": true"
    "}";
    
    /* Valid: unique items */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("[1, 2, 3, 4]", schema, &result);
        js_result_cleanup(&result);
        if (!valid) return 1;
    }
    
    /* Invalid: duplicates */
    {
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_instance("[1, 2, 2, 3]", schema, &result);
        js_result_cleanup(&result);
        if (valid) return 1;
    }
    
    return 0;
}

/* ============================================================================
 * Import Tests
 * ============================================================================ */

/* Test $import not allowed when allow_import is false */
TEST(import_not_allowed) {
    const char* schema = "{"
        "\"$id\": \"test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Test\","
        "\"type\": \"object\","
        "\"$import\": \"http://example.com/types.json\""
    "}";
    
    js_schema_validator_t validator;
    js_schema_validator_init(&validator);  /* allow_import defaults to false */
    
    js_result_t result;
    js_result_init(&result);
    
    cJSON* schema_json = cJSON_Parse(schema);
    bool valid = js_schema_validate(&validator, schema_json, &result);
    cJSON_Delete(schema_json);
    
    /* Should fail because allow_import is false */
    js_result_cleanup(&result);
    return !valid ? 0 : 1;
}

/* Test $import with external schema registry */
TEST(import_basic) {
    /* External schema to import */
    const char* external_schema = "{"
        "\"$id\": \"http://example.com/address.json\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Address\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"street\": {\"type\": \"string\"},"
            "\"city\": {\"type\": \"string\"}"
        "}"
    "}";
    
    /* Main schema that imports the external one */
    const char* main_schema = "{"
        "\"$id\": \"http://example.com/person.json\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Person\","
        "\"type\": \"object\","
        "\"$import\": \"http://example.com/address.json\","
        "\"properties\": {"
            "\"name\": {\"type\": \"string\"},"
            "\"address\": {\"$ref\": \"#/definitions/Address\"}"
        "}"
    "}";
    
    /* Parse external schema */
    cJSON* ext_json = cJSON_Parse(external_schema);
    if (!ext_json) return 1;
    
    /* Set up import registry */
    js_import_entry_t entry = {
        .uri = "http://example.com/address.json",
        .file_path = NULL,
        .schema = ext_json
    };
    
    js_import_registry_t registry = {
        .entries = &entry,
        .count = 1
    };
    
    /* Configure validator with import enabled */
    js_instance_options_t options = {
        .allow_additional_properties = true,
        .validate_formats = true,
        .allow_import = true,
        .import_registry = &registry
    };
    
    js_instance_validator_t validator;
    js_instance_validator_init_with_options(&validator, options);
    
    /* Test instance */
    const char* instance = "{"
        "\"name\": \"John\","
        "\"address\": {"
            "\"street\": \"123 Main St\","
            "\"city\": \"New York\""
        "}"
    "}";
    
    js_result_t result;
    js_result_init(&result);
    
    cJSON* main_json = cJSON_Parse(main_schema);
    cJSON* instance_json = cJSON_Parse(instance);
    
    bool valid = js_instance_validate(&validator, instance_json, main_json, &result);
    
    cJSON_Delete(main_json);
    cJSON_Delete(instance_json);
    cJSON_Delete(ext_json);
    js_result_cleanup(&result);
    
    return valid ? 0 : 1;
}

/* Test $importdefs imports only definitions */
TEST(importdefs_basic) {
    /* External schema with definitions */
    const char* external_schema = "{"
        "\"$id\": \"http://example.com/types.json\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Types\","
        "\"type\": \"object\","
        "\"definitions\": {"
            "\"PhoneNumber\": {\"type\": \"string\", \"pattern\": \"^\\\\d{10}$\"},"
            "\"Email\": {\"type\": \"email\"}"
        "}"
    "}";
    
    /* Main schema that uses $importdefs */
    const char* main_schema = "{"
        "\"$id\": \"http://example.com/contact.json\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Contact\","
        "\"type\": \"object\","
        "\"$importdefs\": \"http://example.com/types.json\","
        "\"properties\": {"
            "\"phone\": {\"$ref\": \"#/definitions/PhoneNumber\"}"
        "}"
    "}";
    
    cJSON* ext_json = cJSON_Parse(external_schema);
    if (!ext_json) return 1;
    
    js_import_entry_t entry = {
        .uri = "http://example.com/types.json",
        .file_path = NULL,
        .schema = ext_json
    };
    
    js_import_registry_t registry = {
        .entries = &entry,
        .count = 1
    };
    
    js_instance_options_t options = {
        .allow_additional_properties = true,
        .validate_formats = true,
        .allow_import = true,
        .import_registry = &registry
    };
    
    js_instance_validator_t validator;
    js_instance_validator_init_with_options(&validator, options);
    
    /* Valid phone number */
    const char* valid_instance = "{\"phone\": \"1234567890\"}";
    /* Invalid phone number */
    const char* invalid_instance = "{\"phone\": \"123\"}";
    
    js_result_t result;
    cJSON* main_json = cJSON_Parse(main_schema);
    
    /* Test valid instance */
    js_result_init(&result);
    cJSON* valid_json = cJSON_Parse(valid_instance);
    bool valid = js_instance_validate(&validator, valid_json, main_json, &result);
    cJSON_Delete(valid_json);
    js_result_cleanup(&result);
    if (!valid) {
        cJSON_Delete(main_json);
        cJSON_Delete(ext_json);
        return 1;
    }
    
    /* Test invalid instance */
    js_result_init(&result);
    cJSON* invalid_json = cJSON_Parse(invalid_instance);
    valid = js_instance_validate(&validator, invalid_json, main_json, &result);
    cJSON_Delete(invalid_json);
    js_result_cleanup(&result);
    
    cJSON_Delete(main_json);
    cJSON_Delete(ext_json);
    
    /* Invalid instance should fail */
    return !valid ? 0 : 1;
}

/* ============================================================================
 * Test Runner
 * ============================================================================ */

int test_conformance(void) {
    passed = 0;
    failed = 0;
    total = 0;
    
    printf("\n  --- Invalid Schemas (should fail) ---\n");
    RUN_TEST(invalid_allof_not_array);
    RUN_TEST(invalid_array_missing_items);
    RUN_TEST(invalid_circular_ref_direct);
    RUN_TEST(invalid_defs_not_object);
    RUN_TEST(invalid_enum_duplicates);
    RUN_TEST(invalid_enum_empty);
    RUN_TEST(invalid_enum_not_array);
    RUN_TEST(invalid_map_missing_values);
    RUN_TEST(invalid_missing_type);
    RUN_TEST(invalid_properties_not_object);
    RUN_TEST(invalid_ref_undefined);
    RUN_TEST(invalid_required_missing_property);
    RUN_TEST(invalid_required_not_array);
    RUN_TEST(invalid_tuple_missing_definition);
    RUN_TEST(invalid_unknown_type);
    RUN_TEST(schema_anyof_not_array);
    RUN_TEST(schema_oneof_not_array);
    RUN_TEST(schema_then_without_if);
    RUN_TEST(schema_else_without_if);
    
    printf("\n  --- Valid Schemas (should pass) ---\n");
    RUN_TEST(valid_with_uses_string_pattern);
    RUN_TEST(valid_with_uses_numeric_minimum);
    RUN_TEST(valid_with_uses_array_contains);
    RUN_TEST(valid_with_uses_dependent_required);
    RUN_TEST(valid_all_primitive_types);
    RUN_TEST(valid_all_compound_types);
    RUN_TEST(schema_valid_with_composition);
    RUN_TEST(schema_valid_if_then_else);
    RUN_TEST(schema_valid_not);
    
    printf("\n  --- Instance Validation ---\n");
    RUN_TEST(instance_valid_datetime);
    RUN_TEST(instance_invalid_datetime);
    RUN_TEST(instance_valid_uuid);
    RUN_TEST(instance_invalid_uuid);
    RUN_TEST(instance_valid_uri);
    RUN_TEST(instance_valid_set_uniqueness);
    RUN_TEST(instance_valid_map);
    RUN_TEST(instance_valid_nested_object);
    RUN_TEST(instance_valid_with_definitions);
    RUN_TEST(instance_additional_properties_false);
    RUN_TEST(instance_int8_range);
    RUN_TEST(instance_uint8_range);
    RUN_TEST(instance_int16_range);
    RUN_TEST(instance_int32_range);
    RUN_TEST(instance_uint16_range);
    RUN_TEST(instance_uint32_range);
    RUN_TEST(instance_float_types);
    RUN_TEST(instance_allof_validation);
    RUN_TEST(instance_anyof_validation);
    RUN_TEST(instance_oneof_validation);
    RUN_TEST(instance_not_validation);
    RUN_TEST(instance_exclusive_bounds);
    RUN_TEST(instance_multiple_of);
    RUN_TEST(instance_date_type);
    RUN_TEST(instance_binary_type);
    RUN_TEST(instance_choice_validation);
    RUN_TEST(instance_tuple_validation);
    RUN_TEST(instance_pattern_validation);
    RUN_TEST(instance_contains_validation);
    RUN_TEST(instance_prefix_items);
    RUN_TEST(instance_nested_union);
    RUN_TEST(instance_deep_nesting);
    RUN_TEST(instance_empty_object);
    RUN_TEST(instance_empty_array);
    RUN_TEST(instance_object_property_count);
    RUN_TEST(instance_unique_items);
    
    printf("\n  --- Import Tests ---\n");
    RUN_TEST(import_not_allowed);
    RUN_TEST(import_basic);
    RUN_TEST(importdefs_basic);
    
    printf("\n  Conformance: %d passed, %d failed, %d total\n", passed, failed, total);
    
    return failed;
}
