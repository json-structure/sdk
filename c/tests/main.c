/**
 * @file main.c
 * @brief Test runner for JSON Structure C SDK
 *
 * Simple test framework main entry point.
 */

#include <stdio.h>
#include <stdlib.h>

/* Forward declarations of test suites */
extern int test_types(void);
extern int test_schema_validator(void);
extern int test_instance_validator(void);
extern int test_conformance(void);
extern int test_assets(void);

int main(int argc, char* argv[]) {
    (void)argc;
    (void)argv;
    
    int failed = 0;
    int total = 0;
    
    printf("=== JSON Structure C SDK Tests ===\n\n");
    
    printf("Running types tests...\n");
    int types_failed = test_types();
    failed += types_failed;
    total++;
    printf("Types: %s\n\n", types_failed == 0 ? "PASSED" : "FAILED");
    
    printf("Running schema validator tests...\n");
    int schema_failed = test_schema_validator();
    failed += schema_failed;
    total++;
    printf("Schema Validator: %s\n\n", schema_failed == 0 ? "PASSED" : "FAILED");
    
    printf("Running instance validator tests...\n");
    int instance_failed = test_instance_validator();
    failed += instance_failed;
    total++;
    printf("Instance Validator: %s\n\n", instance_failed == 0 ? "PASSED" : "FAILED");
    
    printf("Running conformance tests...\n");
    int conformance_failed = test_conformance();
    failed += conformance_failed;
    total++;
    printf("Conformance: %s\n\n", conformance_failed == 0 ? "PASSED" : "FAILED");
    
    printf("Running test-assets integration tests...\n");
    int assets_failed = test_assets();
    failed += assets_failed;
    total++;
    printf("Test Assets: %s\n\n", assets_failed == 0 ? "PASSED" : "FAILED");
    
    printf("=== Summary ===\n");
    printf("Total: %d, Passed: %d, Failed: %d\n", 
           total, total - failed, failed);
    
    return failed > 0 ? EXIT_FAILURE : EXIT_SUCCESS;
}
