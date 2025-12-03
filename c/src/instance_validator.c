/**
 * @file instance_validator.c
 * @brief JSON Structure instance validator implementation
 *
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#include "json_structure/instance_validator.h"
#include "regex_utils.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <ctype.h>
#include <stdint.h>

/* ============================================================================
 * Internal Constants
 * ============================================================================ */

#define MAX_DEPTH 100
#define PATH_BUFFER_SIZE 1024
#define MAX_IMPORT_DEPTH 16

/* ============================================================================
 * Internal Types
 * ============================================================================ */

typedef struct validate_context {
    const js_instance_validator_t* validator;
    js_result_t* result;
    const cJSON* root_schema;
    const cJSON* definitions;
    char path[PATH_BUFFER_SIZE];
    int depth;
} validate_context_t;

typedef struct import_context {
    const js_instance_validator_t* validator;
    js_result_t* result;
    int import_depth;
} import_context_t;

/* ============================================================================
 * Forward Declarations
 * ============================================================================ */

static bool validate_instance(validate_context_t* ctx, const cJSON* instance, const cJSON* schema);
static bool validate_set_instance(validate_context_t* ctx, const cJSON* instance, const cJSON* schema);
static bool check_integer_range(validate_context_t* ctx, double value, const char* type_name);
static bool process_imports(import_context_t* ctx, cJSON* obj, const char* path);

/* ============================================================================
 * Helper Functions
 * ============================================================================ */

static void push_path(validate_context_t* ctx, const char* segment) {
    size_t len = strlen(ctx->path);
    size_t seg_len = strlen(segment);
    size_t needed = seg_len + (len > 0 && segment[0] != '[' ? 1 : 0);  /* +1 for dot separator */
    
    /* Check for buffer overflow - silently truncate if path too long */
    if (len + needed >= PATH_BUFFER_SIZE) {
        return;  /* Path too long, skip appending */
    }
    
    if (len == 0) {
        snprintf(ctx->path, PATH_BUFFER_SIZE, "%s", segment);
    } else if (segment[0] == '[') {
        snprintf(ctx->path + len, PATH_BUFFER_SIZE - len, "%s", segment);
    } else {
        snprintf(ctx->path + len, PATH_BUFFER_SIZE - len, ".%s", segment);
    }
}

static void pop_path(validate_context_t* ctx, size_t prev_len) {
    ctx->path[prev_len] = '\0';
}

static void add_error(validate_context_t* ctx, js_error_code_t code, const char* message) {
    js_result_add_error(ctx->result, code, message, ctx->path);
}

/* ============================================================================
 * Reference Resolution
 * ============================================================================ */

static const cJSON* resolve_ref(validate_context_t* ctx, const char* ref) {
    if (!ref) return NULL;

    /* Handle internal references */
    if (ref[0] == '#') {
        /* Primary format: #/definitions/Name */
        if (strncmp(ref, "#/definitions/", 14) == 0) {
            const char* def_name = ref + 14;
            if (ctx->definitions) {
                return cJSON_GetObjectItemCaseSensitive(ctx->definitions, def_name);
            }
        }
        /* Also support: #/$defs/Name (JSON Schema compatibility) */
        if (strncmp(ref, "#/$defs/", 8) == 0) {
            const char* def_name = ref + 8;
            if (ctx->definitions) {
                return cJSON_GetObjectItemCaseSensitive(ctx->definitions, def_name);
            }
        }
        if (strncmp(ref, "#/$definitions/", 15) == 0) {
            const char* def_name = ref + 15;
            if (ctx->definitions) {
                return cJSON_GetObjectItemCaseSensitive(ctx->definitions, def_name);
            }
        }
    }

    return NULL;
}

/* ============================================================================
 * Import Processing ($import and $importdefs)
 * ============================================================================ */

/**
 * @brief Fetch an external schema by URI from the import registry
 * @param validator Validator with import registry
 * @param uri URI to look up
 * @return Parsed schema or NULL if not found
 */
static cJSON* fetch_external_schema(const js_instance_validator_t* validator, const char* uri) {
    if (!validator || !uri) return NULL;
    
    const js_import_registry_t* registry = validator->options.import_registry;
    if (!registry || !registry->entries) return NULL;
    
    for (size_t i = 0; i < registry->count; i++) {
        const js_import_entry_t* entry = &registry->entries[i];
        if (!entry->uri) continue;
        
        /* Check if URI matches */
        if (strcmp(entry->uri, uri) == 0) {
            /* If schema is provided directly, duplicate it */
            if (entry->schema) {
                return cJSON_Duplicate(entry->schema, true);
            }
            
            /* If file path is provided, load from file */
            if (entry->file_path) {
                FILE* f = fopen(entry->file_path, "rb");
                if (!f) return NULL;
                
                fseek(f, 0, SEEK_END);
                long size = ftell(f);
                fseek(f, 0, SEEK_SET);
                
                if (size <= 0 || size > 10 * 1024 * 1024) {  /* 10MB limit */
                    fclose(f);
                    return NULL;
                }
                
                char* content = (char*)malloc((size_t)size + 1);
                if (!content) {
                    fclose(f);
                    return NULL;
                }
                
                size_t read_size = fread(content, 1, (size_t)size, f);
                fclose(f);
                content[read_size] = '\0';
                
                cJSON* schema = cJSON_Parse(content);
                free(content);
                return schema;
            }
        }
        
        /* Also check if schema's $id matches the requested URI */
        if (entry->schema) {
            const cJSON* id = cJSON_GetObjectItemCaseSensitive(entry->schema, "$id");
            if (id && cJSON_IsString(id) && strcmp(id->valuestring, uri) == 0) {
                return cJSON_Duplicate(entry->schema, true);
            }
        }
    }
    
    return NULL;
}

/**
 * @brief Rewrite $ref pointers in imported content to point to new location
 * @param obj Object to rewrite
 * @param target_path Path where content is being merged (e.g., "#/definitions")
 */
static void rewrite_refs(cJSON* obj, const char* target_path) {
    if (!obj || !target_path) return;
    
    if (cJSON_IsObject(obj)) {
        cJSON* item = NULL;
        cJSON_ArrayForEach(item, obj) {
            if (strcmp(item->string, "$ref") == 0 && cJSON_IsString(item)) {
                const char* ref = item->valuestring;
                if (ref && ref[0] == '#') {
                    /* Extract the referenced name (last component) */
                    const char* last_slash = strrchr(ref, '/');
                    const char* ref_name = last_slash ? last_slash + 1 : ref + 1;
                    
                    if (ref_name && *ref_name) {
                        /* Build new ref: target_path/ref_name */
                        size_t new_len = strlen(target_path) + 1 + strlen(ref_name) + 1;
                        char* new_ref = (char*)malloc(new_len);
                        if (new_ref) {
                            snprintf(new_ref, new_len, "%s/%s", target_path, ref_name);
                            cJSON_SetValuestring(item, new_ref);
                            free(new_ref);
                        }
                    }
                }
            } else if (strcmp(item->string, "$extends") == 0) {
                /* $extends can be a string or array */
                if (cJSON_IsString(item)) {
                    const char* ref = item->valuestring;
                    if (ref && ref[0] == '#') {
                        const char* last_slash = strrchr(ref, '/');
                        const char* ref_name = last_slash ? last_slash + 1 : ref + 1;
                        if (ref_name && *ref_name) {
                            size_t new_len = strlen(target_path) + 1 + strlen(ref_name) + 1;
                            char* new_ref = (char*)malloc(new_len);
                            if (new_ref) {
                                snprintf(new_ref, new_len, "%s/%s", target_path, ref_name);
                                cJSON_SetValuestring(item, new_ref);
                                free(new_ref);
                            }
                        }
                    }
                } else if (cJSON_IsArray(item)) {
                    cJSON* arr_item = NULL;
                    cJSON_ArrayForEach(arr_item, item) {
                        if (cJSON_IsString(arr_item)) {
                            const char* ref = arr_item->valuestring;
                            if (ref && ref[0] == '#') {
                                const char* last_slash = strrchr(ref, '/');
                                const char* ref_name = last_slash ? last_slash + 1 : ref + 1;
                                if (ref_name && *ref_name) {
                                    size_t new_len = strlen(target_path) + 1 + strlen(ref_name) + 1;
                                    char* new_ref = (char*)malloc(new_len);
                                    if (new_ref) {
                                        snprintf(new_ref, new_len, "%s/%s", target_path, ref_name);
                                        cJSON_SetValuestring(arr_item, new_ref);
                                        free(new_ref);
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                rewrite_refs(item, target_path);
            }
        }
    } else if (cJSON_IsArray(obj)) {
        cJSON* item = NULL;
        cJSON_ArrayForEach(item, obj) {
            rewrite_refs(item, target_path);
        }
    }
}

/**
 * @brief Process $import and $importdefs keywords in schema
 * @param ctx Import context
 * @param obj Schema object to process (modified in place)
 * @param path Current JSON pointer path
 * @return true if processing succeeded, false on error
 */
static bool process_imports(import_context_t* ctx, cJSON* obj, const char* path) {
    if (!obj || !cJSON_IsObject(obj)) return true;
    
    /* Prevent infinite recursion */
    if (ctx->import_depth >= MAX_IMPORT_DEPTH) {
        js_result_add_error(ctx->result, JS_SCHEMA_IMPORT_NOT_ALLOWED, 
                           "Maximum import depth exceeded", path);
        return false;
    }
    
    /* Collect keys to process (we modify the object during iteration) */
    const char* import_key = NULL;
    cJSON* import_value = NULL;
    
    cJSON* import_item = cJSON_GetObjectItemCaseSensitive(obj, "$import");
    if (import_item) {
        import_key = "$import";
        import_value = import_item;
    } else {
        import_item = cJSON_GetObjectItemCaseSensitive(obj, "$importdefs");
        if (import_item) {
            import_key = "$importdefs";
            import_value = import_item;
        }
    }
    
    if (import_key && import_value) {
        /* Check if imports are allowed */
        if (!ctx->validator->options.allow_import) {
            char msg[256];
            snprintf(msg, sizeof(msg), "Import keyword '%s' encountered but allow_import not enabled", import_key);
            js_result_add_error(ctx->result, JS_SCHEMA_IMPORT_NOT_ALLOWED, msg, path);
            return false;
        }
        
        /* Validate URI */
        if (!cJSON_IsString(import_value)) {
            char msg[256];
            snprintf(msg, sizeof(msg), "Import keyword '%s' value must be a string URI", import_key);
            js_result_add_error(ctx->result, JS_SCHEMA_IMPORT_NOT_ALLOWED, msg, path);
            return false;
        }
        
        const char* uri = import_value->valuestring;
        
        /* Fetch external schema */
        cJSON* external = fetch_external_schema(ctx->validator, uri);
        if (!external) {
            char msg[256];
            snprintf(msg, sizeof(msg), "Unable to fetch external schema from URI: %s", uri);
            js_result_add_error(ctx->result, JS_SCHEMA_IMPORT_NOT_ALLOWED, msg, path);
            return false;
        }
        
        /* Recursively process imports in the fetched schema */
        ctx->import_depth++;
        bool import_result = process_imports(ctx, external, "#");
        ctx->import_depth--;
        
        if (!import_result) {
            cJSON_Delete(external);
            return false;
        }
        
        /* Determine what to import */
        cJSON* imported_defs = cJSON_CreateObject();
        if (!imported_defs) {
            cJSON_Delete(external);
            return false;
        }
        
        if (strcmp(import_key, "$import") == 0) {
            /* $import: Import root type (if has type+name) and definitions */
            const cJSON* type_field = cJSON_GetObjectItemCaseSensitive(external, "type");
            const cJSON* name_field = cJSON_GetObjectItemCaseSensitive(external, "name");
            
            if (type_field && name_field && cJSON_IsString(name_field)) {
                /* Deep copy the external schema as a type definition */
                cJSON* ext_copy = cJSON_Duplicate(external, true);
                if (ext_copy) {
                    cJSON_AddItemToObject(imported_defs, name_field->valuestring, ext_copy);
                }
            }
            
            /* Also import definitions */
            const cJSON* ext_defs = cJSON_GetObjectItemCaseSensitive(external, "definitions");
            if (!ext_defs) {
                ext_defs = cJSON_GetObjectItemCaseSensitive(external, "$defs");
            }
            if (ext_defs && cJSON_IsObject(ext_defs)) {
                cJSON* def = NULL;
                cJSON_ArrayForEach(def, ext_defs) {
                    if (def->string && !cJSON_GetObjectItemCaseSensitive(imported_defs, def->string)) {
                        cJSON* def_copy = cJSON_Duplicate(def, true);
                        if (def_copy) {
                            cJSON_AddItemToObject(imported_defs, def->string, def_copy);
                        }
                    }
                }
            }
        } else {
            /* $importdefs: Import only definitions */
            const cJSON* ext_defs = cJSON_GetObjectItemCaseSensitive(external, "definitions");
            if (!ext_defs) {
                ext_defs = cJSON_GetObjectItemCaseSensitive(external, "$defs");
            }
            if (ext_defs && cJSON_IsObject(ext_defs)) {
                cJSON* def = NULL;
                cJSON_ArrayForEach(def, ext_defs) {
                    if (def->string) {
                        cJSON* def_copy = cJSON_Duplicate(def, true);
                        if (def_copy) {
                            cJSON_AddItemToObject(imported_defs, def->string, def_copy);
                        }
                    }
                }
            }
        }
        
        /* Determine merge target and ref rewrite path */
        const char* target_path;
        cJSON* merge_target;
        bool is_root = (strcmp(path, "#") == 0);
        
        if (is_root) {
            target_path = "#/definitions";
            /* Ensure definitions object exists */
            cJSON* defs = cJSON_GetObjectItemCaseSensitive(obj, "definitions");
            if (!defs) {
                defs = cJSON_CreateObject();
                if (defs) {
                    cJSON_AddItemToObject(obj, "definitions", defs);
                }
            }
            merge_target = defs;
        } else {
            target_path = path;
            merge_target = obj;
        }
        
        /* Rewrite $ref pointers in imported content */
        cJSON* def = NULL;
        cJSON_ArrayForEach(def, imported_defs) {
            rewrite_refs(def, target_path);
        }
        
        /* Merge imported definitions (don't overwrite existing) 
           First collect keys to merge, then merge them to avoid modifying during iteration */
        if (merge_target) {
            /* Count and collect keys */
            int count = cJSON_GetArraySize(imported_defs);
            if (count > 0) {
                char** keys_to_merge = (char**)malloc(sizeof(char*) * (size_t)count);
                if (keys_to_merge) {
                    int merge_count = 0;
                    cJSON* item = NULL;
                    cJSON_ArrayForEach(item, imported_defs) {
                        if (item->string && !cJSON_GetObjectItemCaseSensitive(merge_target, item->string)) {
                            keys_to_merge[merge_count++] = item->string;
                        }
                    }
                    
                    /* Now detach and merge */
                    for (int i = 0; i < merge_count; i++) {
                        cJSON* detached = cJSON_DetachItemFromObject(imported_defs, keys_to_merge[i]);
                        if (detached) {
                            cJSON_AddItemToObject(merge_target, keys_to_merge[i], detached);
                        }
                    }
                    
                    free(keys_to_merge);
                }
            }
        }
        
        /* Remove the import keyword from the schema */
        cJSON_DeleteItemFromObject(obj, import_key);
        
        /* Clean up */
        cJSON_Delete(imported_defs);
        cJSON_Delete(external);
    }
    
    /* Recursively process nested objects (but skip 'properties' values) */
    cJSON* child = NULL;
    cJSON_ArrayForEach(child, obj) {
        if (child->string && strcmp(child->string, "properties") == 0) {
            continue;  /* Don't process inside properties - those are property names */
        }
        
        if (cJSON_IsObject(child)) {
            char child_path[PATH_BUFFER_SIZE];
            snprintf(child_path, sizeof(child_path), "%s/%s", path, child->string ? child->string : "");
            if (!process_imports(ctx, child, child_path)) {
                return false;
            }
        } else if (cJSON_IsArray(child)) {
            int idx = 0;
            cJSON* arr_item = NULL;
            cJSON_ArrayForEach(arr_item, child) {
                if (cJSON_IsObject(arr_item)) {
                    char arr_path[PATH_BUFFER_SIZE];
                    snprintf(arr_path, sizeof(arr_path), "%s/%s[%d]", path, child->string ? child->string : "", idx);
                    if (!process_imports(ctx, arr_item, arr_path)) {
                        return false;
                    }
                }
                idx++;
            }
        }
    }
    
    return true;
}

/* ============================================================================
 * Efficient uniqueItems Check with Hash-Based Optimization
 * 
 * For primitive arrays (numbers, strings, bools), we use a simple hash set
 * to achieve O(n) average case instead of O(n²) pairwise comparison.
 * For mixed/complex arrays, we fall back to O(n²) cJSON_Compare.
 * ============================================================================ */

/* Simple hash for primitive JSON values */
static uint64_t hash_primitive(const cJSON* item) {
    if (cJSON_IsNull(item)) return 0;
    if (cJSON_IsBool(item)) return cJSON_IsTrue(item) ? 1 : 2;
    if (cJSON_IsNumber(item)) {
        /* Hash the double bits directly */
        union { double d; uint64_t u; } val;
        val.d = item->valuedouble;
        return val.u ^ 0x9e3779b97f4a7c15ULL;
    }
    if (cJSON_IsString(item) && item->valuestring) {
        /* djb2 hash for strings */
        uint64_t hash = 5381;
        const char* s = item->valuestring;
        while (*s) {
            hash = ((hash << 5) + hash) ^ (unsigned char)*s++;
        }
        return hash;
    }
    return 0xFFFFFFFFFFFFFFFFULL; /* Marker for complex types */
}

/* Check if array contains only hashable primitives */
static bool is_primitive_array(const cJSON* arr) {
    cJSON* item = NULL;
    cJSON_ArrayForEach(item, arr) {
        if (cJSON_IsObject(item) || cJSON_IsArray(item)) {
            return false;
        }
    }
    return true;
}

/* Hash-based uniqueness check for primitive arrays - O(n) average */
static bool check_unique_primitive(const cJSON* arr, int* dup_i, int* dup_j) {
    int size = cJSON_GetArraySize(arr);
    if (size <= 1) return true;
    
    /* Use a simple open-addressing hash table */
    size_t table_size = (size_t)size * 2; /* Load factor ~0.5 */
    if (table_size < 16) table_size = 16;
    
    /* Each slot: hash, index, occupied flag */
    typedef struct { uint64_t hash; int index; } slot_t;
    slot_t* table = (slot_t*)calloc(table_size, sizeof(slot_t));
    if (!table) {
        /* Fall back by signaling we couldn't check */
        *dup_i = -1;
        return true;
    }
    
    bool unique = true;
    int i = 0;
    cJSON* item = NULL;
    cJSON_ArrayForEach(item, arr) {
        uint64_t h = hash_primitive(item);
        size_t pos = h % table_size;
        
        /* Linear probe for open slot or hash collision */
        for (size_t probe = 0; probe < table_size; probe++) {
            size_t idx = (pos + probe) % table_size;
            
            if (table[idx].hash == 0 && table[idx].index == 0) {
                /* Empty slot - insert */
                table[idx].hash = h ? h : 1; /* Avoid 0 as it marks empty */
                table[idx].index = i + 1;    /* 1-indexed to distinguish from empty */
                break;
            }
            
            if (table[idx].hash == (h ? h : 1)) {
                /* Hash collision - check actual equality */
                cJSON* other = cJSON_GetArrayItem(arr, table[idx].index - 1);
                if (cJSON_Compare(item, other, true)) {
                    *dup_i = table[idx].index - 1;
                    *dup_j = i;
                    unique = false;
                    break;
                }
            }
        }
        
        if (!unique) break;
        i++;
    }
    
    free(table);
    return unique;
}

/* ============================================================================
 * Format Validation Helpers
 * ============================================================================ */

/* Validate ISO 8601 datetime format: YYYY-MM-DDTHH:MM:SSZ or similar */
static bool is_valid_datetime(const char* str) {
    size_t len = strlen(str);
    if (len < 20) return false; /* Minimum: 2024-01-01T00:00:00Z */
    
    /* Check date part */
    if (str[4] != '-' || str[7] != '-') return false;
    if (str[10] != 'T' && str[10] != 't') return false;
    
    /* Check year */
    for (int i = 0; i < 4; i++) {
        if (!isdigit((unsigned char)str[i])) return false;
    }
    
    /* Check month */
    if (!isdigit((unsigned char)str[5]) || !isdigit((unsigned char)str[6])) return false;
    int month = (str[5] - '0') * 10 + (str[6] - '0');
    if (month < 1 || month > 12) return false;
    
    /* Check day */
    if (!isdigit((unsigned char)str[8]) || !isdigit((unsigned char)str[9])) return false;
    int day = (str[8] - '0') * 10 + (str[9] - '0');
    if (day < 1 || day > 31) return false;
    
    /* Check time separator and time format */
    if (str[13] != ':' || str[16] != ':') return false;
    
    /* Check hours */
    if (!isdigit((unsigned char)str[11]) || !isdigit((unsigned char)str[12])) return false;
    int hour = (str[11] - '0') * 10 + (str[12] - '0');
    if (hour > 23) return false;
    
    /* Check minutes */
    if (!isdigit((unsigned char)str[14]) || !isdigit((unsigned char)str[15])) return false;
    int minute = (str[14] - '0') * 10 + (str[15] - '0');
    if (minute > 59) return false;
    
    /* Check seconds */
    if (!isdigit((unsigned char)str[17]) || !isdigit((unsigned char)str[18])) return false;
    int second = (str[17] - '0') * 10 + (str[18] - '0');
    if (second > 59) return false;
    
    /* Check timezone - either Z or +/-HH:MM */
    size_t tz_start = 19;
    if (str[tz_start] == '.') {
        /* Skip fractional seconds */
        tz_start++;
        while (tz_start < len && isdigit((unsigned char)str[tz_start])) {
            tz_start++;
        }
    }
    
    if (tz_start >= len) return false;
    
    if (str[tz_start] == 'Z' || str[tz_start] == 'z') {
        return tz_start + 1 == len;
    }
    
    if (str[tz_start] == '+' || str[tz_start] == '-') {
        /* Check offset format: +HH:MM or +HHMM */
        if (len - tz_start >= 6 && str[tz_start + 3] == ':') {
            return isdigit((unsigned char)str[tz_start + 1]) &&
                   isdigit((unsigned char)str[tz_start + 2]) &&
                   isdigit((unsigned char)str[tz_start + 4]) &&
                   isdigit((unsigned char)str[tz_start + 5]);
        }
    }
    
    return false;
}

/* Validate UUID format: 8-4-4-4-12 hex digits */
static bool is_valid_uuid(const char* str) {
    size_t len = strlen(str);
    if (len != 36) return false;
    
    const int segments[] = {8, 4, 4, 4, 12};
    int pos = 0;
    
    for (int seg = 0; seg < 5; seg++) {
        for (int i = 0; i < segments[seg]; i++) {
            char c = str[pos++];
            if (!isxdigit((unsigned char)c)) return false;
        }
        if (seg < 4) {
            if (str[pos++] != '-') return false;
        }
    }
    
    return pos == 36;
}

/* ============================================================================
 * Type Validation
 * ============================================================================ */

/**
 * @brief Check if instance matches the expected JSON Structure type
 * 
 * Uses js_type_from_name for O(n) type string lookup once, then O(1) switch.
 * This is more efficient than the previous chain of strcmp calls.
 */
static bool check_type_match(const cJSON* instance, const char* type_name) {
    js_type_t type = js_type_from_name(type_name);
    
    switch (type) {
        case JS_TYPE_ANY:
            return true;
            
        case JS_TYPE_NULL:
            return cJSON_IsNull(instance);
            
        case JS_TYPE_BOOLEAN:
            return cJSON_IsBool(instance);
            
        case JS_TYPE_NUMBER:
            return cJSON_IsNumber(instance);
            
        case JS_TYPE_INTEGER:
            if (!cJSON_IsNumber(instance)) return false;
            return instance->valuedouble == floor(instance->valuedouble);
            
        case JS_TYPE_STRING:
            return cJSON_IsString(instance);
            
        case JS_TYPE_OBJECT:
            return cJSON_IsObject(instance);
            
        case JS_TYPE_ARRAY:
            return cJSON_IsArray(instance);
            
        case JS_TYPE_MAP:
            return cJSON_IsObject(instance);
            
        case JS_TYPE_SET:
            return cJSON_IsArray(instance);
            
        /* Integer numeric types - require integer value */
        case JS_TYPE_INT8:
        case JS_TYPE_INT16:
        case JS_TYPE_INT32:
        case JS_TYPE_INT64:
        case JS_TYPE_UINT8:
        case JS_TYPE_UINT16:
        case JS_TYPE_UINT32:
        case JS_TYPE_UINT64:
            if (!cJSON_IsNumber(instance)) return false;
            return instance->valuedouble == floor(instance->valuedouble);
            
        /* Floating point numeric types */
        case JS_TYPE_FLOAT16:
        case JS_TYPE_FLOAT32:
        case JS_TYPE_FLOAT64:
        case JS_TYPE_FLOAT128:
        case JS_TYPE_DECIMAL:
        case JS_TYPE_DECIMAL64:
        case JS_TYPE_DECIMAL128:
            return cJSON_IsNumber(instance);
            
        /* Datetime with format validation */
        case JS_TYPE_DATETIME:
            if (!cJSON_IsString(instance)) return false;
            return is_valid_datetime(instance->valuestring);
            
        /* UUID with format validation */
        case JS_TYPE_UUID:
            if (!cJSON_IsString(instance)) return false;
            return is_valid_uuid(instance->valuestring);
            
        /* String-based types without strict format validation */
        case JS_TYPE_BINARY:
        case JS_TYPE_DATE:
        case JS_TYPE_TIME:
        case JS_TYPE_DURATION:
        case JS_TYPE_URI:
        case JS_TYPE_URI_REFERENCE:
        case JS_TYPE_URI_TEMPLATE:
        case JS_TYPE_REGEX:
        case JS_TYPE_CHAR:
        case JS_TYPE_IPV4:
        case JS_TYPE_IPV6:
        case JS_TYPE_EMAIL:
        case JS_TYPE_IDN_EMAIL:
        case JS_TYPE_HOSTNAME:
        case JS_TYPE_IDN_HOSTNAME:
        case JS_TYPE_IRI:
        case JS_TYPE_IRI_REFERENCE:
        case JS_TYPE_JSON_POINTER:
        case JS_TYPE_RELATIVE_JSON_POINTER:
            return cJSON_IsString(instance);
            
        /* Abstract, choice, and tuple types */
        case JS_TYPE_ABSTRACT:
        case JS_TYPE_CHOICE:
            return cJSON_IsObject(instance);
            
        case JS_TYPE_TUPLE:
            return cJSON_IsArray(instance);
            
        case JS_TYPE_UNKNOWN:
        default:
            return false;
    }
}

/* Check if integer value is within the range for the given integer type */
static bool check_integer_range(validate_context_t* ctx, double value, const char* type_name) {
    /* Ensure it's an integer first */
    if (value != floor(value)) {
        return false;
    }
    
    int64_t int_val = (int64_t)value;
    js_type_t type = js_type_from_name(type_name);
    
    switch (type) {
        case JS_TYPE_INT8:
            if (int_val < -128 || int_val > 127) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Value %lld is out of int8 range [-128, 127]", (long long)int_val);
                add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
                return false;
            }
            break;
            
        case JS_TYPE_INT16:
            if (int_val < -32768 || int_val > 32767) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Value %lld is out of int16 range [-32768, 32767]", (long long)int_val);
                add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
                return false;
            }
            break;
            
        case JS_TYPE_INT32:
        case JS_TYPE_INTEGER:
            if (int_val < INT32_MIN || int_val > INT32_MAX) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Value %lld is out of int32 range", (long long)int_val);
                add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
                return false;
            }
            break;
            
        case JS_TYPE_UINT8:
            if (int_val < 0 || int_val > 255) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Value %lld is out of uint8 range [0, 255]", (long long)int_val);
                add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
                return false;
            }
            break;
            
        case JS_TYPE_UINT16:
            if (int_val < 0 || int_val > 65535) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Value %lld is out of uint16 range [0, 65535]", (long long)int_val);
                add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
                return false;
            }
            break;
            
        case JS_TYPE_UINT32:
            if (int_val < 0 || (uint64_t)int_val > UINT32_MAX) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Value %lld is out of uint32 range [0, 4294967295]", (long long)int_val);
                add_error(ctx, JS_INSTANCE_INTEGER_OUT_OF_RANGE, msg);
                return false;
            }
            break;
            
        default:
            /* int64, uint64 - no range check needed as they match the native type */
            break;
    }
    
    return true;
}

/* ============================================================================
 * UTF-8 Support
 * 
 * JSON strings are UTF-8 encoded. The minLength/maxLength constraints should
 * count Unicode code points, not bytes. This matches JSON Schema behavior.
 * ============================================================================ */

/**
 * @brief Count Unicode code points in a UTF-8 string
 * 
 * This counts code points (not grapheme clusters), which matches JSON Schema
 * and most programming languages' string length semantics.
 * 
 * @param str UTF-8 encoded string
 * @return Number of Unicode code points
 */
static size_t utf8_codepoint_count(const char* str) {
    size_t count = 0;
    const unsigned char* s = (const unsigned char*)str;
    
    while (*s) {
        /* Count only start bytes, skip continuation bytes (10xxxxxx) */
        if ((*s & 0xC0) != 0x80) {
            count++;
        }
        s++;
    }
    
    return count;
}

/* ============================================================================
 * Constraint Validation
 * ============================================================================ */

static bool validate_string_constraints(validate_context_t* ctx, const cJSON* instance, 
                                         const cJSON* schema) {
    const char* str = instance->valuestring;
    bool valid = true;
    
    const cJSON* minLength = cJSON_GetObjectItemCaseSensitive(schema, "minLength");
    const cJSON* maxLength = cJSON_GetObjectItemCaseSensitive(schema, "maxLength");
    const cJSON* pattern = cJSON_GetObjectItemCaseSensitive(schema, "pattern");
    
    /* Use UTF-8 code point count for length constraints (matches JSON Schema) */
    size_t codepoint_len = 0;
    if (minLength || maxLength) {
        codepoint_len = utf8_codepoint_count(str);
    }
    
    if (minLength && cJSON_IsNumber(minLength)) {
        if (codepoint_len < (size_t)minLength->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "String too short (min %d, got %zu)",
                    (int)minLength->valuedouble, codepoint_len);
            add_error(ctx, JS_INSTANCE_STRING_TOO_SHORT, msg);
            valid = false;
        }
    }
    
    if (maxLength && cJSON_IsNumber(maxLength)) {
        if (codepoint_len > (size_t)maxLength->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "String too long (max %d, got %zu)",
                    (int)maxLength->valuedouble, codepoint_len);
            add_error(ctx, JS_INSTANCE_STRING_TOO_LONG, msg);
            valid = false;
        }
    }
    
    if (pattern && cJSON_IsString(pattern)) {
        if (!js_regex_match(pattern->valuestring, str)) {
            char msg[256];
            snprintf(msg, sizeof(msg), "String '%s' does not match pattern '%s'",
                    str, pattern->valuestring);
            add_error(ctx, JS_INSTANCE_STRING_PATTERN_MISMATCH, msg);
            valid = false;
        }
    }
    
    return valid;
}

static bool validate_numeric_constraints(validate_context_t* ctx, const cJSON* instance,
                                          const cJSON* schema) {
    double value = instance->valuedouble;
    bool valid = true;
    
    const cJSON* minimum = cJSON_GetObjectItemCaseSensitive(schema, "minimum");
    const cJSON* maximum = cJSON_GetObjectItemCaseSensitive(schema, "maximum");
    const cJSON* exclusiveMinimum = cJSON_GetObjectItemCaseSensitive(schema, "exclusiveMinimum");
    const cJSON* exclusiveMaximum = cJSON_GetObjectItemCaseSensitive(schema, "exclusiveMaximum");
    const cJSON* multipleOf = cJSON_GetObjectItemCaseSensitive(schema, "multipleOf");
    
    if (minimum && cJSON_IsNumber(minimum)) {
        if (value < minimum->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %g is less than minimum %g",
                    value, minimum->valuedouble);
            add_error(ctx, JS_INSTANCE_NUMBER_TOO_SMALL, msg);
            valid = false;
        }
    }
    
    if (maximum && cJSON_IsNumber(maximum)) {
        if (value > maximum->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %g is greater than maximum %g",
                    value, maximum->valuedouble);
            add_error(ctx, JS_INSTANCE_NUMBER_TOO_LARGE, msg);
            valid = false;
        }
    }
    
    if (exclusiveMinimum && cJSON_IsNumber(exclusiveMinimum)) {
        if (value <= exclusiveMinimum->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %g must be greater than %g",
                    value, exclusiveMinimum->valuedouble);
            add_error(ctx, JS_INSTANCE_NUMBER_TOO_SMALL, msg);
            valid = false;
        }
    }
    
    if (exclusiveMaximum && cJSON_IsNumber(exclusiveMaximum)) {
        if (value >= exclusiveMaximum->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %g must be less than %g",
                    value, exclusiveMaximum->valuedouble);
            add_error(ctx, JS_INSTANCE_NUMBER_TOO_LARGE, msg);
            valid = false;
        }
    }
    
    if (multipleOf && cJSON_IsNumber(multipleOf) && multipleOf->valuedouble != 0) {
        double quotient = value / multipleOf->valuedouble;
        if (fabs(quotient - round(quotient)) > 1e-10) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Value %g is not a multiple of %g",
                    value, multipleOf->valuedouble);
            add_error(ctx, JS_INSTANCE_NUMBER_NOT_MULTIPLE, msg);
            valid = false;
        }
    }
    
    return valid;
}

static bool validate_array_constraints(validate_context_t* ctx, const cJSON* instance,
                                        const cJSON* schema) {
    int size = cJSON_GetArraySize(instance);
    bool valid = true;
    
    const cJSON* minItems = cJSON_GetObjectItemCaseSensitive(schema, "minItems");
    const cJSON* maxItems = cJSON_GetObjectItemCaseSensitive(schema, "maxItems");
    const cJSON* uniqueItems = cJSON_GetObjectItemCaseSensitive(schema, "uniqueItems");
    const cJSON* contains = cJSON_GetObjectItemCaseSensitive(schema, "contains");
    const cJSON* minContains = cJSON_GetObjectItemCaseSensitive(schema, "minContains");
    const cJSON* maxContains = cJSON_GetObjectItemCaseSensitive(schema, "maxContains");
    
    if (minItems && cJSON_IsNumber(minItems)) {
        if (size < (int)minItems->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Array too short (min %d, got %d)",
                    (int)minItems->valuedouble, size);
            add_error(ctx, JS_INSTANCE_ARRAY_TOO_SHORT, msg);
            valid = false;
        }
    }
    
    if (maxItems && cJSON_IsNumber(maxItems)) {
        if (size > (int)maxItems->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Array too long (max %d, got %d)",
                    (int)maxItems->valuedouble, size);
            add_error(ctx, JS_INSTANCE_ARRAY_TOO_LONG, msg);
            valid = false;
        }
    }
    
    if (uniqueItems && cJSON_IsTrue(uniqueItems)) {
        /* Use optimized O(n) hash-based check for primitive arrays */
        if (is_primitive_array(instance)) {
            int dup_i = -1, dup_j = -1;
            if (!check_unique_primitive(instance, &dup_i, &dup_j)) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Array items at indices %d and %d are not unique",
                        dup_i, dup_j);
                add_error(ctx, JS_INSTANCE_ARRAY_NOT_UNIQUE, msg);
                valid = false;
            }
        } else {
            /* Fall back to O(n²) for arrays with objects/arrays */
            for (int i = 0; i < size && valid; i++) {
                cJSON* item_i = cJSON_GetArrayItem(instance, i);
                for (int j = i + 1; j < size; j++) {
                    cJSON* item_j = cJSON_GetArrayItem(instance, j);
                    if (cJSON_Compare(item_i, item_j, true)) {
                        char msg[128];
                        snprintf(msg, sizeof(msg), "Array items at indices %d and %d are not unique",
                                i, j);
                        add_error(ctx, JS_INSTANCE_ARRAY_NOT_UNIQUE, msg);
                        valid = false;
                        break;
                    }
                }
            }
        }
    }
    
    /* Validate contains constraint */
    if (contains && cJSON_IsObject(contains)) {
        int contains_count = 0;
        int min_contains_val = minContains && cJSON_IsNumber(minContains) ? 
                               (int)minContains->valuedouble : 1;
        int max_contains_val = maxContains && cJSON_IsNumber(maxContains) ? 
                               (int)maxContains->valuedouble : size + 1;
        
        /* Count items matching the contains schema */
        for (int i = 0; i < size; i++) {
            cJSON* item = cJSON_GetArrayItem(instance, i);
            size_t prev_errors = ctx->result->error_count;
            
            /* Try to validate item against contains schema */
            size_t prev_path_len = strlen(ctx->path);
            char index_str[32];
            snprintf(index_str, sizeof(index_str), "[%d]", i);
            push_path(ctx, index_str);
            
            if (validate_instance(ctx, item, contains)) {
                contains_count++;
            } else {
                /* Remove errors from failed contains check - these are expected */
                ctx->result->error_count = prev_errors;
            }
            
            pop_path(ctx, prev_path_len);
        }
        
        if (contains_count < min_contains_val) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Array does not contain enough matching items (min %d, got %d)",
                    min_contains_val, contains_count);
            add_error(ctx, JS_INSTANCE_ARRAY_CONTAINS_TOO_FEW, msg);
            valid = false;
        }
        
        if (contains_count > max_contains_val) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Array contains too many matching items (max %d, got %d)",
                    max_contains_val, contains_count);
            add_error(ctx, JS_INSTANCE_ARRAY_CONTAINS_TOO_MANY, msg);
            valid = false;
        }
    }
    
    return valid;
}

static bool validate_object_constraints(validate_context_t* ctx, const cJSON* instance,
                                         const cJSON* schema) {
    int size = cJSON_GetArraySize(instance);
    bool valid = true;
    
    const cJSON* minProperties = cJSON_GetObjectItemCaseSensitive(schema, "minProperties");
    const cJSON* maxProperties = cJSON_GetObjectItemCaseSensitive(schema, "maxProperties");
    
    if (minProperties && cJSON_IsNumber(minProperties)) {
        if (size < (int)minProperties->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Too few properties (min %d, got %d)",
                    (int)minProperties->valuedouble, size);
            add_error(ctx, JS_INSTANCE_TOO_FEW_PROPERTIES, msg);
            valid = false;
        }
    }
    
    if (maxProperties && cJSON_IsNumber(maxProperties)) {
        if (size > (int)maxProperties->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Too many properties (max %d, got %d)",
                    (int)maxProperties->valuedouble, size);
            add_error(ctx, JS_INSTANCE_TOO_MANY_PROPERTIES, msg);
            valid = false;
        }
    }
    
    return valid;
}

/* ============================================================================
 * Enum/Const Validation
 * ============================================================================ */

static bool validate_enum(validate_context_t* ctx, const cJSON* instance, const cJSON* enum_arr) {
    cJSON* item;
    cJSON_ArrayForEach(item, enum_arr) {
        if (cJSON_Compare(instance, item, true)) {
            return true;
        }
    }
    add_error(ctx, JS_INSTANCE_ENUM_MISMATCH, "Value not in enum");
    return false;
}

static bool validate_const(validate_context_t* ctx, const cJSON* instance, const cJSON* const_val) {
    if (cJSON_Compare(instance, const_val, true)) {
        return true;
    }
    add_error(ctx, JS_INSTANCE_CONST_MISMATCH, "Value does not match const");
    return false;
}

/* ============================================================================
 * Type-Specific Validation
 * ============================================================================ */

static bool validate_object_instance(validate_context_t* ctx, const cJSON* instance,
                                      const cJSON* schema) {
    bool valid = true;
    
    const cJSON* properties = cJSON_GetObjectItemCaseSensitive(schema, "properties");
    const cJSON* required = cJSON_GetObjectItemCaseSensitive(schema, "required");
    const cJSON* additionalProperties = cJSON_GetObjectItemCaseSensitive(schema, "additionalProperties");
    const cJSON* dependentRequired = cJSON_GetObjectItemCaseSensitive(schema, "dependentRequired");
    
    /* Check required properties */
    if (required && cJSON_IsArray(required)) {
        cJSON* req_item;
        cJSON_ArrayForEach(req_item, required) {
            if (cJSON_IsString(req_item)) {
                const cJSON* prop = cJSON_GetObjectItemCaseSensitive(instance, req_item->valuestring);
                if (!prop) {
                    char msg[256];
                    snprintf(msg, sizeof(msg), "Required property '%s' is missing",
                            req_item->valuestring);
                    add_error(ctx, JS_INSTANCE_REQUIRED_MISSING, msg);
                    valid = false;
                }
            }
        }
    }
    
    /* Check dependentRequired - if property X is present, properties Y, Z, ... must also be present */
    if (dependentRequired && cJSON_IsObject(dependentRequired)) {
        cJSON* dep;
        cJSON_ArrayForEach(dep, dependentRequired) {
            const char* trigger_prop = dep->string;
            /* Only check if the trigger property is present in the instance */
            const cJSON* trigger = cJSON_GetObjectItemCaseSensitive(instance, trigger_prop);
            if (trigger && cJSON_IsArray(dep)) {
                /* Check that all required dependent properties are present */
                cJSON* req_prop;
                cJSON_ArrayForEach(req_prop, dep) {
                    if (cJSON_IsString(req_prop)) {
                        const cJSON* prop = cJSON_GetObjectItemCaseSensitive(instance, req_prop->valuestring);
                        if (!prop) {
                            char msg[256];
                            snprintf(msg, sizeof(msg), 
                                    "Property '%s' requires property '%s' to also be present",
                                    trigger_prop, req_prop->valuestring);
                            add_error(ctx, JS_INSTANCE_DEPENDENT_REQUIRED_MISSING, msg);
                            valid = false;
                        }
                    }
                }
            }
        }
    }
    
    /* Validate each property */
    cJSON* prop;
    cJSON_ArrayForEach(prop, instance) {
        const char* prop_name = prop->string;
        const cJSON* prop_schema = NULL;
        
        if (properties && cJSON_IsObject(properties)) {
            prop_schema = cJSON_GetObjectItemCaseSensitive(properties, prop_name);
        }
        
        if (prop_schema) {
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, prop_name);
            if (!validate_instance(ctx, prop, prop_schema)) {
                valid = false;
            }
            pop_path(ctx, prev_len);
        } else if (additionalProperties) {
            /* Schema explicitly controls additional properties */
            if (cJSON_IsFalse(additionalProperties)) {
                /* additionalProperties: false - reject additional properties */
                char msg[256];
                snprintf(msg, sizeof(msg), "Additional property '%s' not allowed", prop_name);
                add_error(ctx, JS_INSTANCE_ADDITIONAL_PROPERTY, msg);
                valid = false;
            } else if (cJSON_IsObject(additionalProperties)) {
                size_t prev_len = strlen(ctx->path);
                push_path(ctx, prop_name);
                if (!validate_instance(ctx, prop, additionalProperties)) {
                    valid = false;
                }
                pop_path(ctx, prev_len);
            }
            /* additionalProperties: true or missing - allow */
        } else if (!ctx->validator->options.allow_additional_properties) {
            /* No additionalProperties in schema, use validator option */
            char msg[256];
            snprintf(msg, sizeof(msg), "Additional property '%s' not allowed", prop_name);
            add_error(ctx, JS_INSTANCE_ADDITIONAL_PROPERTY, msg);
            valid = false;
        }
    }
    
    /* Validate object constraints */
    if (!validate_object_constraints(ctx, instance, schema)) {
        valid = false;
    }
    
    return valid;
}

static bool validate_array_instance(validate_context_t* ctx, const cJSON* instance,
                                     const cJSON* schema) {
    bool valid = true;
    
    const cJSON* items = cJSON_GetObjectItemCaseSensitive(schema, "items");
    
    /* Validate each item */
    if (items) {
        int idx = 0;
        cJSON* item;
        cJSON_ArrayForEach(item, instance) {
            char idx_str[32];
            snprintf(idx_str, sizeof(idx_str), "[%d]", idx);
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, idx_str);
            
            if (!validate_instance(ctx, item, items)) {
                valid = false;
            }
            
            pop_path(ctx, prev_len);
            idx++;
        }
    }
    
    /* Validate array constraints */
    if (!validate_array_constraints(ctx, instance, schema)) {
        valid = false;
    }
    
    return valid;
}

static bool validate_set_instance(validate_context_t* ctx, const cJSON* instance,
                                   const cJSON* schema) {
    bool valid = true;
    
    const cJSON* items = cJSON_GetObjectItemCaseSensitive(schema, "items");
    
    /* Validate each item */
    if (items) {
        int idx = 0;
        cJSON* item;
        cJSON_ArrayForEach(item, instance) {
            char idx_str[32];
            snprintf(idx_str, sizeof(idx_str), "[%d]", idx);
            size_t prev_len = strlen(ctx->path);
            push_path(ctx, idx_str);
            
            if (!validate_instance(ctx, item, items)) {
                valid = false;
            }
            
            pop_path(ctx, prev_len);
            idx++;
        }
    }
    
    /* Sets must have unique items - always check regardless of uniqueItems keyword */
    int size = cJSON_GetArraySize(instance);
    for (int i = 0; i < size; i++) {
        cJSON* item_i = cJSON_GetArrayItem(instance, i);
        for (int j = i + 1; j < size; j++) {
            cJSON* item_j = cJSON_GetArrayItem(instance, j);
            if (cJSON_Compare(item_i, item_j, true)) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Set items at indices %d and %d are not unique",
                        i, j);
                add_error(ctx, JS_INSTANCE_SET_NOT_UNIQUE, msg);
                valid = false;
                break;
            }
        }
    }
    
    /* Validate other array constraints (minItems, maxItems) */
    const cJSON* minItems = cJSON_GetObjectItemCaseSensitive(schema, "minItems");
    const cJSON* maxItems = cJSON_GetObjectItemCaseSensitive(schema, "maxItems");
    
    if (minItems && cJSON_IsNumber(minItems)) {
        if (size < (int)minItems->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Set too small (min %d, got %d)",
                    (int)minItems->valuedouble, size);
            add_error(ctx, JS_INSTANCE_ARRAY_TOO_SHORT, msg);
            valid = false;
        }
    }
    
    if (maxItems && cJSON_IsNumber(maxItems)) {
        if (size > (int)maxItems->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Set too large (max %d, got %d)",
                    (int)maxItems->valuedouble, size);
            add_error(ctx, JS_INSTANCE_ARRAY_TOO_LONG, msg);
            valid = false;
        }
    }
    
    return valid;
}

static bool validate_map_instance(validate_context_t* ctx, const cJSON* instance,
                                   const cJSON* schema) {
    bool valid = true;
    
    const cJSON* values = cJSON_GetObjectItemCaseSensitive(schema, "values");
    const cJSON* keys = cJSON_GetObjectItemCaseSensitive(schema, "keys");
    
    cJSON* entry;
    cJSON_ArrayForEach(entry, instance) {
        const char* key = entry->string;
        
        /* Validate key pattern if specified */
        if (keys && cJSON_IsObject(keys)) {
            const cJSON* key_pattern = cJSON_GetObjectItemCaseSensitive(keys, "pattern");
            if (key_pattern && cJSON_IsString(key_pattern)) {
                if (!js_regex_match(key_pattern->valuestring, key)) {
                    char msg[256];
                    snprintf(msg, sizeof(msg), "Map key '%s' does not match pattern '%s'",
                            key, key_pattern->valuestring);
                    add_error(ctx, JS_INSTANCE_MAP_KEY_PATTERN_MISMATCH, msg);
                    valid = false;
                }
            }
        }
        
        /* Validate value */
        if (values) {
            size_t prev_len = strlen(ctx->path);
            char key_path[PATH_BUFFER_SIZE];
            snprintf(key_path, sizeof(key_path), "[%s]", key);
            push_path(ctx, key_path);
            
            if (!validate_instance(ctx, entry, values)) {
                valid = false;
            }
            
            pop_path(ctx, prev_len);
        }
    }
    
    /* Validate map size constraints */
    int size = cJSON_GetArraySize(instance);
    const cJSON* minEntries = cJSON_GetObjectItemCaseSensitive(schema, "minEntries");
    const cJSON* maxEntries = cJSON_GetObjectItemCaseSensitive(schema, "maxEntries");
    
    /* Fall back to minProperties/maxProperties for compatibility */
    if (!minEntries) minEntries = cJSON_GetObjectItemCaseSensitive(schema, "minProperties");
    if (!maxEntries) maxEntries = cJSON_GetObjectItemCaseSensitive(schema, "maxProperties");
    
    if (minEntries && cJSON_IsNumber(minEntries)) {
        if (size < (int)minEntries->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Map has too few entries (min %d, got %d)",
                    (int)minEntries->valuedouble, size);
            add_error(ctx, JS_INSTANCE_MAP_TOO_FEW_ENTRIES, msg);
            valid = false;
        }
    }
    
    if (maxEntries && cJSON_IsNumber(maxEntries)) {
        if (size > (int)maxEntries->valuedouble) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Map has too many entries (max %d, got %d)",
                    (int)maxEntries->valuedouble, size);
            add_error(ctx, JS_INSTANCE_MAP_TOO_MANY_ENTRIES, msg);
            valid = false;
        }
    }
    
    /* Validate keyNames if specified */
    const cJSON* keyNames = cJSON_GetObjectItemCaseSensitive(schema, "keyNames");
    if (keyNames && cJSON_IsObject(keyNames)) {
        const cJSON* key_pattern = cJSON_GetObjectItemCaseSensitive(keyNames, "pattern");
        const cJSON* minLength = cJSON_GetObjectItemCaseSensitive(keyNames, "minLength");
        const cJSON* maxLength = cJSON_GetObjectItemCaseSensitive(keyNames, "maxLength");
        
        cJSON* entry2;
        cJSON_ArrayForEach(entry2, instance) {
            const char* key = entry2->string;
            size_t key_len = strlen(key);
            
            if (minLength && cJSON_IsNumber(minLength)) {
                if (key_len < (size_t)minLength->valuedouble) {
                    char msg[256];
                    snprintf(msg, sizeof(msg), "Map key '%s' too short (min %d)", 
                            key, (int)minLength->valuedouble);
                    add_error(ctx, JS_INSTANCE_MAP_KEY_PATTERN_MISMATCH, msg);
                    valid = false;
                }
            }
            
            if (maxLength && cJSON_IsNumber(maxLength)) {
                if (key_len > (size_t)maxLength->valuedouble) {
                    char msg[256];
                    snprintf(msg, sizeof(msg), "Map key '%s' too long (max %d)", 
                            key, (int)maxLength->valuedouble);
                    add_error(ctx, JS_INSTANCE_MAP_KEY_PATTERN_MISMATCH, msg);
                    valid = false;
                }
            }
            
            if (key_pattern && cJSON_IsString(key_pattern)) {
                if (!js_regex_match(key_pattern->valuestring, key)) {
                    char msg[256];
                    snprintf(msg, sizeof(msg), "Map key '%s' does not match pattern '%s'",
                            key, key_pattern->valuestring);
                    add_error(ctx, JS_INSTANCE_MAP_KEY_PATTERN_MISMATCH, msg);
                    valid = false;
                }
            }
        }
    }
    
    return valid;
}

static bool validate_choice_instance(validate_context_t* ctx, const cJSON* instance,
                                      const cJSON* schema) {
    const cJSON* choices = cJSON_GetObjectItemCaseSensitive(schema, "choices");
    const cJSON* selector = cJSON_GetObjectItemCaseSensitive(schema, "selector");
    
    if (!choices || !cJSON_IsObject(choices)) {
        add_error(ctx, JS_INSTANCE_CHOICE_NO_MATCH, "Schema missing choices");
        return false;
    }
    
    /* If selector is specified, use it to determine the choice */
    if (selector && cJSON_IsString(selector)) {
        const cJSON* selector_value = cJSON_GetObjectItemCaseSensitive(instance, selector->valuestring);
        if (!selector_value) {
            add_error(ctx, JS_INSTANCE_CHOICE_SELECTOR_MISSING, "Choice selector property missing");
            return false;
        }
        if (!cJSON_IsString(selector_value)) {
            add_error(ctx, JS_INSTANCE_CHOICE_SELECTOR_INVALID, "Choice selector must be a string");
            return false;
        }
        
        const cJSON* choice_schema = cJSON_GetObjectItemCaseSensitive(choices, selector_value->valuestring);
        if (!choice_schema) {
            char msg[256];
            snprintf(msg, sizeof(msg), "Unknown choice: '%s'", selector_value->valuestring);
            add_error(ctx, JS_INSTANCE_CHOICE_UNKNOWN, msg);
            return false;
        }
        
        return validate_instance(ctx, instance, choice_schema);
    }
    
    /* Without selector, try each choice and find a match */
    int match_count = 0;
    const cJSON* matched_choice = NULL;
    
    cJSON* choice;
    cJSON_ArrayForEach(choice, choices) {
        js_result_t temp_result;
        js_result_init(&temp_result);
        
        validate_context_t temp_ctx = *ctx;
        temp_ctx.result = &temp_result;
        
        if (validate_instance(&temp_ctx, instance, choice)) {
            match_count++;
            matched_choice = choice;
        }
        
        js_result_cleanup(&temp_result);
    }
    
    if (match_count == 0) {
        add_error(ctx, JS_INSTANCE_CHOICE_NO_MATCH, "No matching choice");
        return false;
    }
    
    if (match_count > 1) {
        add_error(ctx, JS_INSTANCE_CHOICE_MULTIPLE_MATCHES, "Multiple choices matched");
        return false;
    }
    
    /* Re-validate against the matched choice to populate errors if any */
    return validate_instance(ctx, instance, matched_choice);
}

/* ============================================================================
 * Composition Validation
 * ============================================================================ */

static bool validate_allOf(validate_context_t* ctx, const cJSON* instance, const cJSON* allOf) {
    bool valid = true;
    int idx = 0;
    cJSON* subschema;
    cJSON_ArrayForEach(subschema, allOf) {
        char idx_str[32];
        snprintf(idx_str, sizeof(idx_str), "allOf[%d]", idx);
        size_t prev_len = strlen(ctx->path);
        push_path(ctx, idx_str);
        
        if (!validate_instance(ctx, instance, subschema)) {
            valid = false;
        }
        
        pop_path(ctx, prev_len);
        idx++;
    }
    return valid;
}

static bool validate_anyOf(validate_context_t* ctx, const cJSON* instance, const cJSON* anyOf) {
    cJSON* subschema;
    cJSON_ArrayForEach(subschema, anyOf) {
        js_result_t temp_result;
        js_result_init(&temp_result);
        
        validate_context_t temp_ctx = *ctx;
        temp_ctx.result = &temp_result;
        
        if (validate_instance(&temp_ctx, instance, subschema)) {
            js_result_cleanup(&temp_result);
            return true;
        }
        
        js_result_cleanup(&temp_result);
    }
    
    add_error(ctx, JS_INSTANCE_ANYOF_FAILED, "No schema in anyOf matched");
    return false;
}

static bool validate_oneOf(validate_context_t* ctx, const cJSON* instance, const cJSON* oneOf) {
    int match_count = 0;
    
    cJSON* subschema;
    cJSON_ArrayForEach(subschema, oneOf) {
        js_result_t temp_result;
        js_result_init(&temp_result);
        
        validate_context_t temp_ctx = *ctx;
        temp_ctx.result = &temp_result;
        
        if (validate_instance(&temp_ctx, instance, subschema)) {
            match_count++;
        }
        
        js_result_cleanup(&temp_result);
    }
    
    if (match_count == 0) {
        add_error(ctx, JS_INSTANCE_ONEOF_FAILED, "No schema in oneOf matched");
        return false;
    }
    
    if (match_count > 1) {
        add_error(ctx, JS_INSTANCE_ONEOF_MULTIPLE, "Multiple schemas in oneOf matched");
        return false;
    }
    
    return true;
}

static bool validate_not(validate_context_t* ctx, const cJSON* instance, const cJSON* not_schema) {
    js_result_t temp_result;
    js_result_init(&temp_result);
    
    validate_context_t temp_ctx = *ctx;
    temp_ctx.result = &temp_result;
    
    bool matches = validate_instance(&temp_ctx, instance, not_schema);
    js_result_cleanup(&temp_result);
    
    if (matches) {
        add_error(ctx, JS_INSTANCE_NOT_FAILED, "Value matches schema in 'not'");
        return false;
    }
    
    return true;
}

static bool validate_if_then_else(validate_context_t* ctx, const cJSON* instance,
                                   const cJSON* if_schema, const cJSON* then_schema,
                                   const cJSON* else_schema) {
    js_result_t temp_result;
    js_result_init(&temp_result);
    
    validate_context_t temp_ctx = *ctx;
    temp_ctx.result = &temp_result;
    
    bool if_matches = validate_instance(&temp_ctx, instance, if_schema);
    js_result_cleanup(&temp_result);
    
    if (if_matches) {
        if (then_schema) {
            return validate_instance(ctx, instance, then_schema);
        }
    } else {
        if (else_schema) {
            return validate_instance(ctx, instance, else_schema);
        }
    }
    
    return true;
}

/* ============================================================================
 * Main Validation Logic
 * ============================================================================ */

static bool validate_instance(validate_context_t* ctx, const cJSON* instance, const cJSON* schema) {
    if (!schema || !cJSON_IsObject(schema)) {
        return true; /* Empty or invalid schema matches anything */
    }
    
    ctx->depth++;
    if (ctx->depth > MAX_DEPTH) {
        add_error(ctx, JS_SCHEMA_MAX_DEPTH_EXCEEDED, "Maximum validation depth exceeded");
        ctx->depth--;
        return false;
    }
    
    bool valid = true;
    
    /* Handle $ref */
    const cJSON* ref = cJSON_GetObjectItemCaseSensitive(schema, "$ref");
    if (ref && cJSON_IsString(ref)) {
        const cJSON* resolved = resolve_ref(ctx, ref->valuestring);
        if (!resolved) {
            char msg[256];
            snprintf(msg, sizeof(msg), "Cannot resolve reference: %s", ref->valuestring);
            add_error(ctx, JS_INSTANCE_REF_NOT_FOUND, msg);
            ctx->depth--;
            return false;
        }
        bool result = validate_instance(ctx, instance, resolved);
        ctx->depth--;
        return result;
    }
    
    /* Check type */
    const cJSON* type_node = cJSON_GetObjectItemCaseSensitive(schema, "type");
    if (type_node) {
        /* Handle type as object with $ref (JSON Structure pattern) */
        if (cJSON_IsObject(type_node)) {
            const cJSON* type_ref = cJSON_GetObjectItemCaseSensitive(type_node, "$ref");
            if (type_ref && cJSON_IsString(type_ref)) {
                const cJSON* resolved = resolve_ref(ctx, type_ref->valuestring);
                if (!resolved) {
                    char msg[256];
                    snprintf(msg, sizeof(msg), "Cannot resolve type reference: %s", type_ref->valuestring);
                    add_error(ctx, JS_INSTANCE_REF_NOT_FOUND, msg);
                    ctx->depth--;
                    return false;
                }
                bool result = validate_instance(ctx, instance, resolved);
                ctx->depth--;
                return result;
            }
        } else if (cJSON_IsString(type_node)) {
            const char* type_str = type_node->valuestring;
            if (!check_type_match(instance, type_str)) {
                char msg[128];
                snprintf(msg, sizeof(msg), "Expected type '%s'", type_str);
                add_error(ctx, JS_INSTANCE_TYPE_MISMATCH, msg);
                valid = false;
            } else {
                /* Type-specific validation and constraints */
                if (strcmp(type_str, "object") == 0) {
                    if (!validate_object_instance(ctx, instance, schema)) valid = false;
                } else if (strcmp(type_str, "array") == 0) {
                    if (!validate_array_instance(ctx, instance, schema)) valid = false;
                } else if (strcmp(type_str, "set") == 0) {
                    if (!validate_set_instance(ctx, instance, schema)) valid = false;
                } else if (strcmp(type_str, "map") == 0) {
                    if (!validate_map_instance(ctx, instance, schema)) valid = false;
                } else if (strcmp(type_str, "choice") == 0) {
                    if (!validate_choice_instance(ctx, instance, schema)) valid = false;
                } else if (strcmp(type_str, "string") == 0 || js_type_is_string(js_type_from_name(type_str))) {
                    if (cJSON_IsString(instance)) {
                        if (!validate_string_constraints(ctx, instance, schema)) valid = false;
                    }
                } else if (js_type_is_numeric(js_type_from_name(type_str))) {
                    if (cJSON_IsNumber(instance)) {
                        if (!validate_numeric_constraints(ctx, instance, schema)) valid = false;
                        /* Check integer range for sized types */
                        if (js_type_is_integer(js_type_from_name(type_str))) {
                            if (!check_integer_range(ctx, instance->valuedouble, type_str)) {
                                valid = false;
                            }
                        }
                    }
                }
            }
        } else if (cJSON_IsArray(type_node)) {
            /* Union types - check if instance matches any type */
            bool type_matched = false;
            cJSON* type_item;
            cJSON_ArrayForEach(type_item, type_node) {
                if (cJSON_IsString(type_item) && check_type_match(instance, type_item->valuestring)) {
                    type_matched = true;
                    break;
                }
            }
            if (!type_matched) {
                add_error(ctx, JS_INSTANCE_UNION_NO_MATCH, "Value does not match any type in union");
                valid = false;
            }
        }
    }
    
    /* Validate enum */
    const cJSON* enum_node = cJSON_GetObjectItemCaseSensitive(schema, "enum");
    if (enum_node && cJSON_IsArray(enum_node)) {
        if (!validate_enum(ctx, instance, enum_node)) valid = false;
    }
    
    /* Validate const */
    const cJSON* const_node = cJSON_GetObjectItemCaseSensitive(schema, "const");
    if (const_node) {
        if (!validate_const(ctx, instance, const_node)) valid = false;
    }
    
    /* Composition keywords */
    const cJSON* allOf = cJSON_GetObjectItemCaseSensitive(schema, "allOf");
    const cJSON* anyOf = cJSON_GetObjectItemCaseSensitive(schema, "anyOf");
    const cJSON* oneOf = cJSON_GetObjectItemCaseSensitive(schema, "oneOf");
    const cJSON* not_schema = cJSON_GetObjectItemCaseSensitive(schema, "not");
    const cJSON* if_schema = cJSON_GetObjectItemCaseSensitive(schema, "if");
    const cJSON* then_schema = cJSON_GetObjectItemCaseSensitive(schema, "then");
    const cJSON* else_schema = cJSON_GetObjectItemCaseSensitive(schema, "else");
    
    if (allOf && cJSON_IsArray(allOf)) {
        if (!validate_allOf(ctx, instance, allOf)) valid = false;
    }
    
    if (anyOf && cJSON_IsArray(anyOf)) {
        if (!validate_anyOf(ctx, instance, anyOf)) valid = false;
    }
    
    if (oneOf && cJSON_IsArray(oneOf)) {
        if (!validate_oneOf(ctx, instance, oneOf)) valid = false;
    }
    
    if (not_schema) {
        if (!validate_not(ctx, instance, not_schema)) valid = false;
    }
    
    if (if_schema) {
        if (!validate_if_then_else(ctx, instance, if_schema, then_schema, else_schema)) valid = false;
    }
    
    ctx->depth--;
    return valid;
}

/* ============================================================================
 * Public API
 * ============================================================================ */

void js_instance_validator_init(js_instance_validator_t* validator) {
    if (validator) {
        validator->options = JS_INSTANCE_OPTIONS_DEFAULT;
    }
}

void js_instance_validator_init_with_options(js_instance_validator_t* validator,
                                              js_instance_options_t options) {
    if (validator) {
        validator->options = options;
    }
}

bool js_instance_validate(const js_instance_validator_t* validator,
                          const cJSON* instance,
                          const cJSON* schema,
                          js_result_t* result) {
    if (!validator || !result) return false;
    
    js_result_init(result);
    
    if (!instance) {
        js_result_add_error(result, JS_INSTANCE_TYPE_MISMATCH, "Instance is null", "");
        return false;
    }
    
    if (!schema) {
        js_result_add_error(result, JS_SCHEMA_NULL, "Schema is null", "");
        return false;
    }
    
    /* Always process imports - either to resolve them (if allowed) or to detect errors */
    cJSON* schema_copy = NULL;
    const cJSON* working_schema = schema;
    
    /* Create a mutable copy of the schema for import processing */
    schema_copy = cJSON_Duplicate(schema, true);
    if (!schema_copy) {
        js_result_add_error(result, JS_SCHEMA_NULL, "Failed to copy schema", "");
        return false;
    }
    
    /* Process imports - will report error if found but not allowed */
    import_context_t import_ctx = {
        .validator = validator,
        .result = result,
        .import_depth = 0
    };
    
    if (!process_imports(&import_ctx, schema_copy, "#")) {
        cJSON_Delete(schema_copy);
        return false;
    }
    
    working_schema = schema_copy;
    
    /* Cache definitions for reference resolution - primary keyword is "definitions" */
    const cJSON* defs = cJSON_GetObjectItemCaseSensitive(working_schema, "definitions");
    if (!defs) {
        defs = cJSON_GetObjectItemCaseSensitive(working_schema, "$defs");
    }
    if (!defs) {
        defs = cJSON_GetObjectItemCaseSensitive(working_schema, "$definitions");
    }
    
    validate_context_t ctx = {
        .validator = validator,
        .result = result,
        .root_schema = working_schema,
        .definitions = defs,
        .path = "",
        .depth = 0
    };
    
    bool valid = validate_instance(&ctx, instance, working_schema);
    
    if (schema_copy) {
        cJSON_Delete(schema_copy);
    }
    
    return valid;
}

bool js_instance_validate_strings(const js_instance_validator_t* validator,
                                   const char* instance_json,
                                   const char* schema_json,
                                   js_result_t* result) {
    if (!validator || !result) return false;
    
    js_result_init(result);
    
    if (!instance_json) {
        js_result_add_error(result, JS_INSTANCE_TYPE_MISMATCH, "Instance JSON is null", "");
        return false;
    }
    
    if (!schema_json) {
        js_result_add_error(result, JS_SCHEMA_NULL, "Schema JSON is null", "");
        return false;
    }
    
    cJSON* instance = cJSON_Parse(instance_json);
    if (!instance) {
        const char* error_ptr = cJSON_GetErrorPtr();
        char msg[256];
        if (error_ptr) {
            snprintf(msg, sizeof(msg), "Instance JSON parse error near: %.50s", error_ptr);
        } else {
            snprintf(msg, sizeof(msg), "Instance JSON parse error");
        }
        js_result_add_error(result, JS_INSTANCE_TYPE_MISMATCH, msg, "");
        return false;
    }
    
    cJSON* schema = cJSON_Parse(schema_json);
    if (!schema) {
        const char* error_ptr = cJSON_GetErrorPtr();
        char msg[256];
        if (error_ptr) {
            snprintf(msg, sizeof(msg), "Schema JSON parse error near: %.50s", error_ptr);
        } else {
            snprintf(msg, sizeof(msg), "Schema JSON parse error");
        }
        js_result_add_error(result, JS_SCHEMA_INVALID_TYPE, msg, "");
        cJSON_Delete(instance);
        return false;
    }
    
    bool valid = js_instance_validate(validator, instance, schema, result);
    
    cJSON_Delete(instance);
    cJSON_Delete(schema);
    
    return valid;
}
