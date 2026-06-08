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

static int result_has_message(const js_result_t* result, const char* needle) {
    size_t i;
    if (!result || !needle) return 0;

    for (i = 0; i < result->error_count; i++) {
        if (result->errors[i].message && strstr(result->errors[i].message, needle)) {
            return 1;
        }
    }

    return 0;
}

/* ============================================================================
 * Valid Schema Tests
 * ============================================================================ */

TEST(valid_simple_string_schema) {
    const char* schema = "{"
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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
        "\"$id\": \"https://example.com/test\","
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

TEST(invalid_empty_root_id) {
    const char* schema = "{"
        "\"$id\": \"   \","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"EmptyId\","
        "\"type\": \"string\""
    "}";

    js_result_t result;
    js_result_init(&result);

    bool valid = js_validate_schema(schema, &result);
    int ok = !valid && result_has_message(&result, "$id must not be empty");

    js_result_cleanup(&result);
    return ok ? 0 : 1;
}

TEST(invalid_root_id_without_scheme) {
    const char* schema = "{"
        "\"$id\": \"example.com/test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"NoScheme\","
        "\"type\": \"string\""
    "}";

    js_result_t result;
    js_result_init(&result);

    bool valid = js_validate_schema(schema, &result);
    int ok = !valid && result_has_message(&result, "$id must be a URI with a scheme");

    js_result_cleanup(&result);
    return ok ? 0 : 1;
}

TEST(invalid_name_identifier) {
    const char* schema = "{"
        "\"$id\": \"https://example.com/test\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"bad-name\","
        "\"type\": \"string\""
    "}";

    js_result_t result;
    js_result_init(&result);

    bool valid = js_validate_schema(schema, &result);
    int ok = !valid && result_has_message(&result, "name must be a valid identifier");

    js_result_cleanup(&result);
    return ok ? 0 : 1;
}

TEST(invalid_extends_target_type) {
    const char* schema = "{"
        "\"$id\": \"https://example.com/bad-extends\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Derived\","
        "\"type\": \"object\","
        "\"$extends\": \"#/definitions/Base\","
        "\"definitions\": {"
            "\"Base\": {"
                "\"name\": \"Base\","
                "\"type\": \"string\""
            "}"
        "}"
    "}";

    js_result_t result;
    js_result_init(&result);

    bool valid = js_validate_schema(schema, &result);
    int ok = !valid && result_has_message(&result, "$extends target '#/definitions/Base' must not resolve to a primitive type");

    js_result_cleanup(&result);
    return ok ? 0 : 1;
}

TEST(invalid_tuple_ref_target_not_found) {
    const char* schema = "{"
        "\"$id\": \"https://example.com/tuple-ref\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"TupleRef\","
        "\"type\": \"tuple\","
        "\"properties\": {"
            "\"name\": {\"type\": \"string\"}"
        "},"
        "\"tuple\": [{\"$ref\": \"#/definitions/Missing\"}]"
    "}";

    js_result_t result;
    js_result_init(&result);

    bool valid = js_validate_schema(schema, &result);
    int ok = !valid && result_has_message(&result, "$ref '#/definitions/Missing' not found");

    js_result_cleanup(&result);
    return ok ? 0 : 1;
}

TEST(invalid_enum_type_mismatch) {
    const char* schema = "{"
        "\"$id\": \"https://example.com/enum-type-mismatch\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"EnumTypeMismatch\","
        "\"type\": \"boolean\","
        "\"enum\": [true, \"false\"]"
    "}";

    js_result_t result;
    js_result_init(&result);

    bool valid = js_validate_schema(schema, &result);
    int ok = !valid && result_has_message(&result, "enum value is not valid for type 'boolean'");

    js_result_cleanup(&result);
    return ok ? 0 : 1;
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
 * Extension Coverage Placeholders
 * ============================================================================ */

TEST(placeholder_ucum_unit_keyword_coverage) {
    const char* valid_schema = "{"
        "\"$id\": \"https://example.com/test\"," 
        "\"$schema\": \"https://json-structure.org/meta/extended/v0/#\"," 
        "\"name\": \"Length\"," 
        "\"$uses\": [\"JSONStructureUnits\"],"
        "\"type\": \"number\"," 
        "\"ucumUnit\": \"m\""
    "}";
    const char* invalid_type_schema = "{"
        "\"$id\": \"https://example.com/test\"," 
        "\"$schema\": \"https://json-structure.org/meta/extended/v0/#\"," 
        "\"name\": \"BadUcumType\"," 
        "\"type\": \"string\"," 
        "\"ucumUnit\": \"m\""
    "}";
    const char* invalid_value_schema = "{"
        "\"$id\": \"https://example.com/test\"," 
        "\"$schema\": \"https://json-structure.org/meta/extended/v0/#\"," 
        "\"name\": \"BadUcumValue\"," 
        "\"$uses\": [\"JSONStructureUnits\"],"
        "\"type\": \"number\"," 
        "\"ucumUnit\": 5"
    "}";

    js_result_t result;
    bool valid;

    js_result_init(&result);
    valid = js_validate_schema(valid_schema, &result);
    if (!valid || result.error_count != 0) {
        js_result_cleanup(&result);
        return 1;
    }
    js_result_cleanup(&result);

    js_result_init(&result);
    valid = js_validate_schema(invalid_type_schema, &result);
    if (valid || !result_has_message(&result, "JSONStructureUnits extension") ||
        !result_has_message(&result, "numeric schemas")) {
        js_result_cleanup(&result);
        return 1;
    }
    js_result_cleanup(&result);

    js_result_init(&result);
    valid = js_validate_schema(invalid_value_schema, &result);
    if (valid || !result_has_message(&result, "must be a string")) {
        js_result_cleanup(&result);
        return 1;
    }
    js_result_cleanup(&result);

    return 0;
}

TEST(placeholder_relations_extension_coverage) {
    const char* valid_schema = "{"
        "\"$id\": \"https://example.com/test\"," 
        "\"$schema\": \"https://json-structure.org/meta/extended/v0/#\"," 
        "\"name\": \"Order\"," 
        "\"$uses\": [\"JSONStructureRelations\"],"
        "\"type\": \"object\"," 
        "\"properties\": {"
            "\"id\": {\"type\": \"string\"},"
            "\"customerId\": {\"type\": \"string\"}"
        "},"
        "\"identity\": [\"id\"],"
        "\"relations\": {"
            "\"customer\": {"
                "\"cardinality\": \"single\","
                "\"targettype\": {\"$ref\": \"#/definitions/Customer\"},"
                "\"scope\": [\"tenant\", \"region\"],"
                "\"qualifiertype\": {\"$ref\": \"#/definitions/RelationQualifier\"}"
            "}"
        "},"
        "\"definitions\": {"
            "\"Customer\": {"
                "\"name\": \"Customer\","
                "\"type\": \"object\","
                "\"properties\": {\"id\": {\"type\": \"string\"}}"
            "},"
            "\"RelationQualifier\": {"
                "\"name\": \"RelationQualifier\","
                "\"type\": \"string\""
            "}"
        "}"
    "}";
    const char* invalid_schema = "{"
        "\"$id\": \"https://example.com/test\"," 
        "\"$schema\": \"https://json-structure.org/meta/extended/v0/#\"," 
        "\"name\": \"BadRelations\"," 
        "\"type\": \"string\"," 
        "\"identity\": [\"id\"],"
        "\"relations\": {"
            "\"customer\": {"
                "\"cardinality\": \"many\","
                "\"targettype\": {\"type\": \"object\"},"
                "\"scope\": [\"tenant\", 3],"
                "\"qualifiertype\": {\"type\": \"string\"}"
            "}"
        "}"
    "}";

    js_result_t result;
    bool valid;

    js_result_init(&result);
    valid = js_validate_schema(valid_schema, &result);
    if (!valid || result.error_count != 0) {
        js_result_cleanup(&result);
        return 1;
    }
    js_result_cleanup(&result);

    js_result_init(&result);
    valid = js_validate_schema(invalid_schema, &result);
    if (valid ||
        !result_has_message(&result, "JSONStructureRelations extension") ||
        !result_has_message(&result, "'identity' can only appear in object or tuple schemas") ||
        !result_has_message(&result, "property 'id' that is not in 'properties'") ||
        !result_has_message(&result, "'relations' can only appear in object or tuple schemas") ||
        !result_has_message(&result, "'targettype' must be an object with '$ref'") ||
        !result_has_message(&result, "'cardinality' must be 'single' or 'multiple'") ||
        !result_has_message(&result, "'scope' array items must be strings") ||
        !result_has_message(&result, "'qualifiertype' must be an object with '$ref'")) {
        js_result_cleanup(&result);
        return 1;
    }
    js_result_cleanup(&result);

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
    RUN_TEST(invalid_empty_root_id);
    RUN_TEST(invalid_root_id_without_scheme);
    RUN_TEST(invalid_name_identifier);
    RUN_TEST(invalid_extends_target_type);
    RUN_TEST(invalid_tuple_ref_target_not_found);
    RUN_TEST(invalid_enum_type_mismatch);
    RUN_TEST(placeholder_ucum_unit_keyword_coverage);
    RUN_TEST(placeholder_relations_extension_coverage);
    
    /* Type checking */
    RUN_TEST(is_valid_primitive_type);
    RUN_TEST(is_valid_compound_type);
    
    return failed;
}
