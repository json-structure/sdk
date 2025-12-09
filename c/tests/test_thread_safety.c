/**
 * @file test_thread_safety.c
 * @brief Thread safety tests for JSON Structure C SDK
 *
 * Tests concurrent validation operations to ensure thread-safe behavior.
 */

#include "json_structure/json_structure.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>

#if defined(_WIN32)
#include <windows.h>
#include <process.h>
typedef HANDLE thread_t;
typedef unsigned (__stdcall *thread_func_t)(void*);
/* _beginthreadex returns handle on success (non-zero), 0 on failure.
 * We want to return 0 on success, non-zero on failure for consistency with pthread. */
static inline int win_thread_create(thread_t* t, thread_func_t f, void* a) {
    *t = (HANDLE)_beginthreadex(NULL, 0, f, a, 0, NULL);
    return (*t == NULL) ? 1 : 0;
}
#define thread_create(t, f, a) win_thread_create(t, (thread_func_t)(f), a)
#define thread_join(t) (WaitForSingleObject(t, INFINITE), CloseHandle(t))
#define thread_return_t unsigned
#define THREAD_RETURN(x) return (x)
#else
#include <pthread.h>
typedef pthread_t thread_t;
typedef void* (*thread_func_t)(void*);
#define thread_create(t, f, a) pthread_create(t, NULL, f, a)
#define thread_join(t) pthread_join(t, NULL)
#define thread_return_t void*
#define THREAD_RETURN(x) return (void*)(intptr_t)(x)
#endif

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
 * Test Data
 * ============================================================================ */

static const char* test_schema = 
    "{"
    "  \"type\": \"object\","
    "  \"properties\": {"
    "    \"name\": {\"type\": \"string\", \"minLength\": 1},"
    "    \"age\": {\"type\": \"integer\", \"minimum\": 0, \"maximum\": 150},"
    "    \"email\": {\"type\": \"string\", \"pattern\": \"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$\"}"
    "  },"
    "  \"required\": [\"name\", \"age\"]"
    "}";

static const char* test_instance_valid = 
    "{"
    "  \"name\": \"John Doe\","
    "  \"age\": 30,"
    "  \"email\": \"john.doe@example.com\""
    "}";

static const char* test_instance_invalid = 
    "{"
    "  \"name\": \"\","
    "  \"age\": -5"
    "}";

/* ============================================================================
 * Thread Test Functions
 * ============================================================================ */

typedef struct {
    int thread_id;
    int iterations;
    int failures;
} thread_data_t;

static thread_return_t validate_schema_thread(void* arg) {
    thread_data_t* data = (thread_data_t*)arg;
    
    for (int i = 0; i < data->iterations; i++) {
        js_result_t result;
        js_result_init(&result);
        
        if (!js_validate_schema(test_schema, &result)) {
            data->failures++;
        }
        
        js_result_cleanup(&result);
    }
    
    THREAD_RETURN(0);
}

static thread_return_t validate_instance_thread(void* arg) {
    thread_data_t* data = (thread_data_t*)arg;
    
    for (int i = 0; i < data->iterations; i++) {
        js_result_t result;
        js_result_init(&result);
        
        /* Alternate between valid and invalid instances */
        const char* instance = (i % 2 == 0) ? test_instance_valid : test_instance_invalid;
        bool expected_valid = (i % 2 == 0);
        
        bool is_valid = js_validate_instance(instance, test_schema, &result);
        
        if (is_valid != expected_valid) {
            data->failures++;
        }
        
        js_result_cleanup(&result);
    }
    
    THREAD_RETURN(0);
}

static thread_return_t mixed_validation_thread(void* arg) {
    thread_data_t* data = (thread_data_t*)arg;
    
    for (int i = 0; i < data->iterations; i++) {
        js_result_t result;
        js_result_init(&result);
        
        /* Alternate between schema and instance validation */
        if (i % 2 == 0) {
            if (!js_validate_schema(test_schema, &result)) {
                data->failures++;
            }
        } else {
            js_validate_instance(test_instance_valid, test_schema, &result);
        }
        
        js_result_cleanup(&result);
    }
    
    THREAD_RETURN(0);
}

/* ============================================================================
 * Tests
 * ============================================================================ */

TEST(concurrent_schema_validation) {
    const int num_threads = 4;
    const int iterations = 100;
    thread_t threads[4];
    thread_data_t thread_data[4];
    
    /* Create threads */
    for (int i = 0; i < num_threads; i++) {
        thread_data[i].thread_id = i;
        thread_data[i].iterations = iterations;
        thread_data[i].failures = 0;
        
        if (thread_create(&threads[i], validate_schema_thread, &thread_data[i]) != 0) {
            printf("Failed to create thread %d\n", i);
            return 1;
        }
    }
    
    /* Wait for all threads */
    for (int i = 0; i < num_threads; i++) {
        thread_join(threads[i]);
    }
    
    /* Check for failures */
    int total_failures = 0;
    for (int i = 0; i < num_threads; i++) {
        total_failures += thread_data[i].failures;
    }
    
    if (total_failures > 0) {
        printf("Total validation failures: %d\n", total_failures);
        return 1;
    }
    
    return 0;
}

TEST(concurrent_instance_validation) {
    const int num_threads = 4;
    const int iterations = 100;
    thread_t threads[4];
    thread_data_t thread_data[4];
    
    /* Create threads */
    for (int i = 0; i < num_threads; i++) {
        thread_data[i].thread_id = i;
        thread_data[i].iterations = iterations;
        thread_data[i].failures = 0;
        
        if (thread_create(&threads[i], validate_instance_thread, &thread_data[i]) != 0) {
            printf("Failed to create thread %d\n", i);
            return 1;
        }
    }
    
    /* Wait for all threads */
    for (int i = 0; i < num_threads; i++) {
        thread_join(threads[i]);
    }
    
    /* Check for failures */
    int total_failures = 0;
    for (int i = 0; i < num_threads; i++) {
        total_failures += thread_data[i].failures;
    }
    
    if (total_failures > 0) {
        printf("Total validation failures: %d\n", total_failures);
        return 1;
    }
    
    return 0;
}

TEST(concurrent_mixed_validation) {
    const int num_threads = 8;
    const int iterations = 50;
    thread_t threads[8];
    thread_data_t thread_data[8];
    
    /* Create threads */
    for (int i = 0; i < num_threads; i++) {
        thread_data[i].thread_id = i;
        thread_data[i].iterations = iterations;
        thread_data[i].failures = 0;
        
        if (thread_create(&threads[i], mixed_validation_thread, &thread_data[i]) != 0) {
            printf("Failed to create thread %d\n", i);
            return 1;
        }
    }
    
    /* Wait for all threads */
    for (int i = 0; i < num_threads; i++) {
        thread_join(threads[i]);
    }
    
    /* Check for failures */
    int total_failures = 0;
    for (int i = 0; i < num_threads; i++) {
        total_failures += thread_data[i].failures;
    }
    
    if (total_failures > 0) {
        printf("Total validation failures: %d\n", total_failures);
        return 1;
    }
    
    return 0;
}

TEST(allocator_concurrent_access) {
    /* Test that memory allocation is thread-safe */
    const int num_threads = 4;
    const int iterations = 1000;
    thread_t threads[4];
    thread_data_t thread_data[4];
    
    /* Create threads that perform lots of allocations */
    for (int i = 0; i < num_threads; i++) {
        thread_data[i].thread_id = i;
        thread_data[i].iterations = iterations;
        thread_data[i].failures = 0;
        
        if (thread_create(&threads[i], validate_instance_thread, &thread_data[i]) != 0) {
            printf("Failed to create thread %d\n", i);
            return 1;
        }
    }
    
    /* Wait for all threads */
    for (int i = 0; i < num_threads; i++) {
        thread_join(threads[i]);
    }
    
    /* Check for failures */
    int total_failures = 0;
    for (int i = 0; i < num_threads; i++) {
        total_failures += thread_data[i].failures;
    }
    
    if (total_failures > 0) {
        printf("Total validation failures: %d\n", total_failures);
        return 1;
    }
    
    return 0;
}

TEST(init_cleanup_lifecycle) {
    /* Test that init/cleanup works correctly */
    
    /* First initialization */
    js_init();
    
    /* Validate something */
    js_result_t result;
    js_result_init(&result);
    
    if (!js_validate_schema(test_schema, &result)) {
        js_result_cleanup(&result);
        return 1;
    }
    
    js_result_cleanup(&result);
    
    /* Cleanup */
    js_cleanup();
    
    /* Re-initialize */
    js_init();
    
    /* Validate again */
    js_result_init(&result);
    
    if (!js_validate_schema(test_schema, &result)) {
        js_result_cleanup(&result);
        return 1;
    }
    
    js_result_cleanup(&result);
    
    /* Final cleanup */
    js_cleanup();
    
    return 0;
}

/* ============================================================================
 * Test Suite Entry Point
 * ============================================================================ */

int test_thread_safety(void) {
    int failed = 0;
    
    /* Initialize library once before all tests */
    js_init();
    
    printf("\n=== Thread Safety Tests ===\n");
    
    RUN_TEST(concurrent_schema_validation);
    RUN_TEST(concurrent_instance_validation);
    RUN_TEST(concurrent_mixed_validation);
    RUN_TEST(allocator_concurrent_access);
    
    /* Cleanup before lifecycle test (which does its own init/cleanup) */
    js_cleanup();
    
    RUN_TEST(init_cleanup_lifecycle);
    
    /* Re-initialize for any subsequent tests */
    js_init();
    
    return failed;
}
