/**
 * @file test_assets.c
 * @brief Test-assets integration tests for JSON Structure C SDK
 * 
 * This file tests the SDK against all test-assets from the shared test suite.
 * These tests ensure conformance with the other SDK implementations.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <sys/stat.h>
#include "json_structure/json_structure.h"

#ifdef _WIN32
#include <windows.h>
#include <direct.h>
#define PATH_SEP '\\'
#define getcwd _getcwd

/* Windows directory iteration */
typedef struct {
    HANDLE handle;
    WIN32_FIND_DATAA data;
    bool first;
} DIR_HANDLE;

static DIR_HANDLE* open_dir(const char* path) {
    char pattern[1024];
    snprintf(pattern, sizeof(pattern), "%s\\*", path);
    
    DIR_HANDLE* dir = (DIR_HANDLE*)malloc(sizeof(DIR_HANDLE));
    if (!dir) return NULL;
    
    dir->handle = FindFirstFileA(pattern, &dir->data);
    if (dir->handle == INVALID_HANDLE_VALUE) {
        free(dir);
        return NULL;
    }
    dir->first = true;
    return dir;
}

static const char* read_dir(DIR_HANDLE* dir) {
    if (dir->first) {
        dir->first = false;
        return dir->data.cFileName;
    }
    if (FindNextFileA(dir->handle, &dir->data)) {
        return dir->data.cFileName;
    }
    return NULL;
}

static void close_dir(DIR_HANDLE* dir) {
    if (dir) {
        FindClose(dir->handle);
        free(dir);
    }
}

#else
#include <unistd.h>
#include <dirent.h>
#define PATH_SEP '/'

typedef DIR DIR_HANDLE;

static DIR_HANDLE* open_dir(const char* path) {
    return opendir(path);
}

static const char* read_dir(DIR_HANDLE* dir) {
    struct dirent* entry = readdir(dir);
    return entry ? entry->d_name : NULL;
}

static void close_dir(DIR_HANDLE* dir) {
    if (dir) closedir(dir);
}
#endif

/* Test counters */
static int passed = 0;
static int failed = 0;
static int skipped = 0;
static int total = 0;

/* Maximum path length */
#define MAX_PATH_LEN 1024

/* Test assets path - will be discovered at runtime */
static char test_assets_path[MAX_PATH_LEN] = {0};

/* ============================================================================
 * File I/O Helpers
 * ============================================================================ */

static char* read_file_contents(const char* path) {
    FILE* file = fopen(path, "rb");
    if (!file) return NULL;
    
    fseek(file, 0, SEEK_END);
    long size = ftell(file);
    fseek(file, 0, SEEK_SET);
    
    char* buffer = (char*)malloc(size + 1);
    if (!buffer) {
        fclose(file);
        return NULL;
    }
    
    size_t read = fread(buffer, 1, size, file);
    buffer[read] = '\0';
    fclose(file);
    
    return buffer;
}

static bool file_exists(const char* path) {
    struct stat st;
    return stat(path, &st) == 0;
}

static bool is_directory(const char* path) {
    struct stat st;
    if (stat(path, &st) != 0) return false;
    return (st.st_mode & S_IFDIR) != 0;
}

/* Find test-assets directory by walking up from current directory */
static bool find_test_assets_path(void) {
    char cwd[MAX_PATH_LEN];
    if (!getcwd(cwd, sizeof(cwd))) return false;
    
    char search_dir[MAX_PATH_LEN];
    strncpy(search_dir, cwd, sizeof(search_dir) - 1);
    
    /* Walk up looking for test-assets */
    for (int i = 0; i < 10; i++) {
        char candidate[MAX_PATH_LEN];
        
        /* Check for test-assets at this level */
        snprintf(candidate, sizeof(candidate), "%s%ctest-assets", search_dir, PATH_SEP);
        if (is_directory(candidate)) {
            strncpy(test_assets_path, candidate, sizeof(test_assets_path) - 1);
            return true;
        }
        
        /* Check for test-assets in sdk subdirectory */
        snprintf(candidate, sizeof(candidate), "%s%csdk%ctest-assets", search_dir, PATH_SEP, PATH_SEP);
        if (is_directory(candidate)) {
            strncpy(test_assets_path, candidate, sizeof(test_assets_path) - 1);
            return true;
        }
        
        /* Move up one directory */
        char* last_sep = strrchr(search_dir, PATH_SEP);
        if (!last_sep || last_sep == search_dir) break;
        *last_sep = '\0';
    }
    
    return false;
}

/* ============================================================================
 * Invalid Schema Tests
 * ============================================================================ */

typedef struct {
    const char* filename;
    const char* expected_error;  /* NULL means any error is acceptable */
} invalid_schema_test_t;

/* Map test filenames to expected error codes */
static const invalid_schema_test_t invalid_schema_tests[] = {
    {"allof-not-array.struct.json", "SCHEMA_ALLOF_NOT_ARRAY"},
    {"array-missing-items.struct.json", "SCHEMA_ARRAY_MISSING_ITEMS"},
    {"circular-ref-direct.struct.json", "SCHEMA_REF_CIRCULAR"},
    {"constraint-type-mismatch-minimum.struct.json", "SCHEMA_CONSTRAINT_INVALID_FOR_TYPE"},
    {"constraint-type-mismatch-minlength.struct.json", "SCHEMA_CONSTRAINT_INVALID_FOR_TYPE"},
    {"defs-not-object.struct.json", "SCHEMA_DEFS_NOT_OBJECT"},
    {"enum-duplicates.struct.json", "SCHEMA_ENUM_DUPLICATES"},
    {"enum-empty.struct.json", "SCHEMA_ENUM_EMPTY"},
    {"enum-not-array.struct.json", "SCHEMA_ENUM_NOT_ARRAY"},
    {"invalid-regex-pattern.struct.json", NULL},  /* Regex validation may not be implemented */
    {"map-missing-values.struct.json", "SCHEMA_MAP_MISSING_VALUES"},
    {"minimum-exceeds-maximum.struct.json", "SCHEMA_MIN_GREATER_THAN_MAX"},
    {"minitems-exceeds-maxitems.struct.json", "SCHEMA_MIN_GREATER_THAN_MAX"},
    {"minitems-negative.struct.json", "SCHEMA_INTEGER_CONSTRAINT_INVALID"},
    {"minlength-exceeds-maxlength.struct.json", "SCHEMA_MIN_GREATER_THAN_MAX"},
    {"minlength-negative.struct.json", "SCHEMA_INTEGER_CONSTRAINT_INVALID"},
    {"missing-type.struct.json", "SCHEMA_ROOT_MISSING_TYPE"},
    {"multipleof-negative.struct.json", "SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID"},
    {"multipleof-zero.struct.json", "SCHEMA_POSITIVE_NUMBER_CONSTRAINT_INVALID"},
    {"properties-not-object.struct.json", "SCHEMA_PROPERTIES_NOT_OBJECT"},
    {"ref-undefined.struct.json", "SCHEMA_REF_NOT_FOUND"},
    {"required-missing-property.struct.json", "SCHEMA_REQUIRED_PROPERTY_NOT_DEFINED"},
    {"required-not-array.struct.json", "SCHEMA_REQUIRED_NOT_ARRAY"},
    {"tuple-missing-definition.struct.json", "SCHEMA_TUPLE_MISSING_DEFINITION"},
    {"tuple-missing-prefixitems.struct.json", NULL},  /* May need different handling */
    {"unknown-type.struct.json", "SCHEMA_TYPE_INVALID"},
    {NULL, NULL}
};

static int test_invalid_schemas(void) {
    char dir_path[MAX_PATH_LEN];
    snprintf(dir_path, sizeof(dir_path), "%s%cschemas%cinvalid", 
             test_assets_path, PATH_SEP, PATH_SEP);
    
    printf("\n  --- Invalid Schemas (test-assets/schemas/invalid) ---\n");
    
    int local_passed = 0;
    int local_failed = 0;
    
    for (int i = 0; invalid_schema_tests[i].filename != NULL; i++) {
        char file_path[MAX_PATH_LEN];
        snprintf(file_path, sizeof(file_path), "%s%c%s", 
                 dir_path, PATH_SEP, invalid_schema_tests[i].filename);
        
        total++;
        
        if (!file_exists(file_path)) {
            printf("  %s... SKIPPED (file not found)\n", invalid_schema_tests[i].filename);
            skipped++;
            continue;
        }
        
        char* schema_json = read_file_contents(file_path);
        if (!schema_json) {
            printf("  %s... FAILED (could not read file)\n", invalid_schema_tests[i].filename);
            local_failed++;
            failed++;
            continue;
        }
        
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_schema(schema_json, &result);
        
        if (!valid) {
            printf("  %s... OK (rejected as expected)\n", invalid_schema_tests[i].filename);
            local_passed++;
            passed++;
        } else {
            printf("  %s... FAILED (should have been rejected)\n", invalid_schema_tests[i].filename);
            local_failed++;
            failed++;
        }
        
        js_result_cleanup(&result);
        free(schema_json);
    }
    
    printf("  Invalid schemas: %d passed, %d failed\n", local_passed, local_failed);
    return local_failed;
}

/* ============================================================================
 * Valid Schema Tests (schemas used for instance validation)
 * ============================================================================ */

static int test_valid_schemas(void) {
    char dir_path[MAX_PATH_LEN];
    snprintf(dir_path, sizeof(dir_path), "%s%cschemas%cvalidation", 
             test_assets_path, PATH_SEP, PATH_SEP);
    
    printf("\n  --- Valid Schemas (test-assets/schemas/validation) ---\n");
    
    int local_passed = 0;
    int local_failed = 0;
    
    DIR_HANDLE* dir = open_dir(dir_path);
    if (!dir) {
        printf("  Could not open validation schemas directory\n");
        return 0;
    }
    
    const char* entry_name;
    while ((entry_name = read_dir(dir)) != NULL) {
        if (entry_name[0] == '.') continue;
        
        /* Only process .json files */
        const char* ext = strrchr(entry_name, '.');
        if (!ext || strcmp(ext, ".json") != 0) continue;
        
        char file_path[MAX_PATH_LEN];
        snprintf(file_path, sizeof(file_path), "%s%c%s", 
                 dir_path, PATH_SEP, entry_name);
        
        total++;
        
        char* schema_json = read_file_contents(file_path);
        if (!schema_json) {
            printf("  %s... SKIPPED\n", entry_name);
            skipped++;
            continue;
        }
        
        js_result_t result;
        js_result_init(&result);
        bool valid = js_validate_schema(schema_json, &result);
        
        if (valid) {
            printf("  %s... OK\n", entry_name);
            local_passed++;
            passed++;
        } else {
            printf("  %s... FAILED (valid schema rejected)\n", entry_name);
            local_failed++;
            failed++;
        }
        
        js_result_cleanup(&result);
        free(schema_json);
    }
    
    close_dir(dir);
    printf("  Validation schemas: %d passed, %d failed\n", local_passed, local_failed);
    return local_failed;
}

/* ============================================================================
 * Invalid Instance Tests
 * ============================================================================ */

/* Instance test categories */
static const char* instance_categories[] = {
    "01-basic-person",
    "02-address",
    "04-datetime-examples",
    "05-collections",
    "06-tuples",
    "11-sets-and-maps",
    NULL
};

/* Find schema file for an instance test category */
static char* find_schema_for_category(const char* category) {
    /* Schema files are typically in primer-and-samples/samples/core */
    char schema_path[MAX_PATH_LEN];
    
    /* Try the direct path first */
    snprintf(schema_path, sizeof(schema_path), 
             "%s%c..%cprimer-and-samples%csamples%ccore%c%s%c%s.struct.json",
             test_assets_path, PATH_SEP, PATH_SEP, PATH_SEP, PATH_SEP, PATH_SEP, 
             category, PATH_SEP, category);
    
    if (file_exists(schema_path)) {
        return read_file_contents(schema_path);
    }
    
    /* Try without category subdirectory */
    snprintf(schema_path, sizeof(schema_path), 
             "%s%c..%cprimer-and-samples%csamples%ccore%c%s.struct.json",
             test_assets_path, PATH_SEP, PATH_SEP, PATH_SEP, PATH_SEP, PATH_SEP, 
             category);
    
    if (file_exists(schema_path)) {
        return read_file_contents(schema_path);
    }
    
    return NULL;
}

static int test_invalid_instances(void) {
    char base_path[MAX_PATH_LEN];
    snprintf(base_path, sizeof(base_path), "%s%cinstances%cinvalid", 
             test_assets_path, PATH_SEP, PATH_SEP);
    
    printf("\n  --- Invalid Instances (test-assets/instances/invalid) ---\n");
    
    int local_passed = 0;
    int local_failed = 0;
    int local_skipped = 0;
    
    for (int c = 0; instance_categories[c] != NULL; c++) {
        char cat_path[MAX_PATH_LEN];
        snprintf(cat_path, sizeof(cat_path), "%s%c%s", 
                 base_path, PATH_SEP, instance_categories[c]);
        
        if (!is_directory(cat_path)) continue;
        
        /* Find schema for this category */
        char* schema_json = find_schema_for_category(instance_categories[c]);
        if (!schema_json) {
            printf("  [%s] Skipping - schema not found\n", instance_categories[c]);
            local_skipped++;
            continue;
        }
        
        DIR_HANDLE* dir = open_dir(cat_path);
        if (!dir) {
            free(schema_json);
            continue;
        }
        
        const char* entry_name;
        while ((entry_name = read_dir(dir)) != NULL) {
            if (entry_name[0] == '.') continue;
            
            const char* ext = strrchr(entry_name, '.');
            if (!ext || strcmp(ext, ".json") != 0) continue;
            
            char file_path[MAX_PATH_LEN];
            snprintf(file_path, sizeof(file_path), "%s%c%s", 
                     cat_path, PATH_SEP, entry_name);
            
            total++;
            
            char* instance_json = read_file_contents(file_path);
            if (!instance_json) {
                printf("  %s/%s... SKIPPED\n", instance_categories[c], entry_name);
                skipped++;
                continue;
            }
            
            js_result_t result;
            js_result_init(&result);
            bool valid = js_validate_instance(instance_json, schema_json, &result);
            
            if (!valid) {
                printf("  %s/%s... OK (rejected as expected)\n", 
                       instance_categories[c], entry_name);
                local_passed++;
                passed++;
            } else {
                printf("  %s/%s... FAILED (should have been rejected)\n", 
                       instance_categories[c], entry_name);
                local_failed++;
                failed++;
            }
            
            js_result_cleanup(&result);
            free(instance_json);
        }
        
        close_dir(dir);
        free(schema_json);
    }
    
    printf("  Invalid instances: %d passed, %d failed, %d skipped\n", 
           local_passed, local_failed, local_skipped);
    return local_failed;
}

/* ============================================================================
 * Validation Instance Tests (test specific validation constraints)
 * ============================================================================ */

static int test_validation_instances(void) {
    char base_path[MAX_PATH_LEN];
    snprintf(base_path, sizeof(base_path), "%s%cinstances%cvalidation", 
             test_assets_path, PATH_SEP, PATH_SEP);
    
    char schemas_path[MAX_PATH_LEN];
    snprintf(schemas_path, sizeof(schemas_path), "%s%cschemas%cvalidation", 
             test_assets_path, PATH_SEP, PATH_SEP);
    
    printf("\n  --- Validation Instances (test-assets/instances/validation) ---\n");
    
    int local_passed = 0;
    int local_failed = 0;
    int local_skipped = 0;
    
    DIR_HANDLE* dir = open_dir(base_path);
    if (!dir) {
        printf("  Could not open validation instances directory\n");
        return 0;
    }
    
    const char* entry_name;
    while ((entry_name = read_dir(dir)) != NULL) {
        if (entry_name[0] == '.') continue;
        
        /* Need to copy entry_name since it may be invalidated by nested open_dir */
        char cat_name[256];
        strncpy(cat_name, entry_name, sizeof(cat_name) - 1);
        cat_name[sizeof(cat_name) - 1] = '\0';
        
        char cat_path[MAX_PATH_LEN];
        snprintf(cat_path, sizeof(cat_path), "%s%c%s", 
                 base_path, PATH_SEP, cat_name);
        
        if (!is_directory(cat_path)) continue;
        
        /* Find corresponding schema */
        char schema_path[MAX_PATH_LEN];
        snprintf(schema_path, sizeof(schema_path), "%s%c%s.struct.json", 
                 schemas_path, PATH_SEP, cat_name);
        
        char* schema_json = read_file_contents(schema_path);
        if (!schema_json) {
            printf("  [%s] Skipping - schema not found\n", cat_name);
            local_skipped++;
            continue;
        }
        
        /* Read instance files in this category */
        DIR_HANDLE* inst_dir = open_dir(cat_path);
        if (!inst_dir) {
            free(schema_json);
            continue;
        }
        
        const char* inst_name;
        while ((inst_name = read_dir(inst_dir)) != NULL) {
            if (inst_name[0] == '.') continue;
            
            /* Copy name to avoid invalidation */
            char inst_fname[256];
            strncpy(inst_fname, inst_name, sizeof(inst_fname) - 1);
            inst_fname[sizeof(inst_fname) - 1] = '\0';
            
            const char* ext = strrchr(inst_fname, '.');
            if (!ext || strcmp(ext, ".json") != 0) continue;
            
            char inst_path[MAX_PATH_LEN];
            snprintf(inst_path, sizeof(inst_path), "%s%c%s", 
                     cat_path, PATH_SEP, inst_fname);
            
            total++;
            
            char* instance_json = read_file_contents(inst_path);
            if (!instance_json) {
                printf("  %s/%s... SKIPPED\n", cat_name, inst_fname);
                skipped++;
                continue;
            }
            
            /* Parse instance to check for _expectedError */
            cJSON* inst = cJSON_Parse(instance_json);
            if (!inst) {
                printf("  %s/%s... SKIPPED (parse error)\n", cat_name, inst_fname);
                free(instance_json);
                skipped++;
                continue;
            }
            
            /* Check if this is expected to fail */
            cJSON* expected_error = cJSON_GetObjectItemCaseSensitive(inst, "_expectedError");
            bool should_fail = (expected_error != NULL);
            
            /* For validation test instances, we need to extract the actual value.
             * If there's a "value" field, use that.
             * Otherwise, remove _description and _expectedError and use the rest. */
            cJSON* value = cJSON_GetObjectItemCaseSensitive(inst, "value");
            char* value_json = NULL;
            if (value) {
                value_json = cJSON_PrintUnformatted(value);
            } else {
                /* Remove metadata fields and use remaining object */
                cJSON_DeleteItemFromObjectCaseSensitive(inst, "_description");
                cJSON_DeleteItemFromObjectCaseSensitive(inst, "_expectedError");
                cJSON_DeleteItemFromObjectCaseSensitive(inst, "_comment");
                value_json = cJSON_PrintUnformatted(inst);
            }
            
            js_result_t result;
            js_result_init(&result);
            bool valid = js_validate_instance(value_json ? value_json : instance_json, 
                                              schema_json, &result);
            
            if (should_fail) {
                if (!valid) {
                    printf("  %s/%s... OK (rejected as expected)\n", 
                           cat_name, inst_fname);
                    local_passed++;
                    passed++;
                } else {
                    printf("  %s/%s... FAILED (should have been rejected)\n", 
                           cat_name, inst_fname);
                    local_failed++;
                    failed++;
                }
            } else {
                if (valid) {
                    printf("  %s/%s... OK\n", cat_name, inst_fname);
                    local_passed++;
                    passed++;
                } else {
                    printf("  %s/%s... FAILED (valid instance rejected)\n", 
                           cat_name, inst_fname);
                    local_failed++;
                    failed++;
                }
            }
            
            js_result_cleanup(&result);
            if (value_json) free(value_json);
            cJSON_Delete(inst);
            free(instance_json);
        }
        
        close_dir(inst_dir);
        free(schema_json);
    }
    
    close_dir(dir);
    printf("  Validation instances: %d passed, %d failed, %d skipped\n", 
           local_passed, local_failed, local_skipped);
    return local_failed;
}

/* ============================================================================
 * Test Runner
 * ============================================================================ */

int test_assets(void) {
    printf("\nRunning test-assets integration tests...\n");
    
    /* Find test-assets directory */
    if (!find_test_assets_path()) {
        printf("  WARNING: Could not find test-assets directory. Skipping integration tests.\n");
        printf("  Looked for: test-assets or sdk/test-assets relative to current directory\n");
        return 0;  /* Don't fail the build if test-assets not found */
    }
    
    printf("  Using test-assets from: %s\n", test_assets_path);
    
    passed = 0;
    failed = 0;
    skipped = 0;
    total = 0;
    
    int failures = 0;
    failures += test_invalid_schemas();
    failures += test_valid_schemas();
    failures += test_invalid_instances();
    failures += test_validation_instances();
    
    printf("\n  Test Assets Summary: %d passed, %d failed, %d skipped, %d total\n", 
           passed, failed, skipped, total);
    
    return failures;
}
