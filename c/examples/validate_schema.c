/**
 * @file validate_schema.c
 * @brief Example: Validate a JSON Structure schema (C API)
 *
 * This example demonstrates how to use the JSON Structure C SDK
 * to validate schema documents.
 */

#include <stdio.h>
#include <json_structure/json_structure.h>

int main(void) {
    /* Define a simple schema */
    const char* schema = "{"
        "\"$id\": \"https://example.com/person\","
        "\"$schema\": \"https://json-structure.org/meta/core/v0/schema\","
        "\"name\": \"Person\","
        "\"type\": \"object\","
        "\"properties\": {"
            "\"firstName\": {\"type\": \"string\", \"minLength\": 1},"
            "\"lastName\": {\"type\": \"string\", \"minLength\": 1},"
            "\"age\": {\"type\": \"integer\", \"minimum\": 0, \"maximum\": 150},"
            "\"email\": {\"type\": \"email\"}"
        "},"
        "\"required\": [\"firstName\", \"lastName\"]"
    "}";
    
    printf("=== JSON Structure C SDK Example ===\n\n");
    printf("Schema:\n%s\n\n", schema);
    
    /* Validate the schema */
    js_result_t result;
    bool valid = js_validate_schema(schema, &result);
    
    if (valid) {
        printf("Schema is valid!\n");
    } else {
        printf("Schema validation failed:\n");
        for (size_t i = 0; i < result.error_count; i++) {
            printf("  [%s] %s: %s\n",
                   result.errors[i].severity == JS_SEVERITY_ERROR ? "ERROR" : "WARNING",
                   result.errors[i].path ? result.errors[i].path : "(root)",
                   result.errors[i].message);
        }
    }
    
    /* Also show any warnings */
    bool has_warnings = false;
    for (size_t i = 0; i < result.error_count; i++) {
        if (result.errors[i].severity == JS_SEVERITY_WARNING) {
            if (!has_warnings) {
                printf("\nWarnings:\n");
                has_warnings = true;
            }
            printf("  [WARNING] %s: %s\n",
                   result.errors[i].path ? result.errors[i].path : "(root)",
                   result.errors[i].message);
        }
    }
    
    js_result_cleanup(&result);
    
    /* Now validate an instance against the schema */
    printf("\n=== Instance Validation ===\n\n");
    
    const char* valid_instance = "{"
        "\"firstName\": \"John\","
        "\"lastName\": \"Doe\","
        "\"age\": 30,"
        "\"email\": \"john.doe@example.com\""
    "}";
    
    const char* invalid_instance = "{"
        "\"firstName\": \"Jane\","
        "\"age\": -5"
    "}";
    
    /* Validate the valid instance */
    printf("Valid instance: %s\n", valid_instance);
    valid = js_validate_instance(valid_instance, schema, &result);
    printf("Result: %s\n\n", valid ? "VALID" : "INVALID");
    js_result_cleanup(&result);
    
    /* Validate the invalid instance */
    printf("Invalid instance: %s\n", invalid_instance);
    valid = js_validate_instance(invalid_instance, schema, &result);
    printf("Result: %s\n", valid ? "VALID" : "INVALID");
    
    if (!valid) {
        printf("Errors:\n");
        for (size_t i = 0; i < result.error_count; i++) {
            printf("  - %s: %s\n",
                   result.errors[i].path ? result.errors[i].path : "(root)",
                   result.errors[i].message);
        }
    }
    
    js_result_cleanup(&result);
    
    return 0;
}
