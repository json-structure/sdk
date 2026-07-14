/**
 * @file export.h
 * @brief DLL export/import macros for JSON Structure SDK
 * 
 * This header provides the JS_API macro for proper symbol visibility
 * when building or using the library as a shared library (DLL).
 * 
 * When building the library as a shared library:
 *   - Define JS_BUILDING_SHARED when compiling the library sources
 *   - JS_API will expand to __declspec(dllexport) on Windows
 * 
 * When using the library as a shared library:
 *   - Define JS_USING_SHARED when compiling your application
 *   - JS_API will expand to __declspec(dllimport) on Windows
 * 
 * For static library builds (default):
 *   - Define neither macro
 *   - JS_API will be empty
 * 
 * On non-Windows platforms, JS_API uses GCC visibility attributes when available.
 * 
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#ifndef JSON_STRUCTURE_EXPORT_H
#define JSON_STRUCTURE_EXPORT_H

/* Determine symbol visibility/export settings */
#if defined(_WIN32) || defined(__CYGWIN__)
    /* Windows platform */
    #ifdef JS_BUILDING_SHARED
        /* Building the DLL */
        #define JS_API __declspec(dllexport)
    #elif defined(JS_USING_SHARED)
        /* Using the DLL */
        #define JS_API __declspec(dllimport)
    #else
        /* Static library */
        #define JS_API
    #endif
#else
    /* Unix-like platforms */
    #if defined(__GNUC__) && __GNUC__ >= 4
        #define JS_API __attribute__((visibility("default")))
    #else
        #define JS_API
    #endif
#endif

#endif /* JSON_STRUCTURE_EXPORT_H */
