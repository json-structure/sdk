cmake_minimum_required(VERSION 3.14)
project(json_structure 
    VERSION 0.1.0 
    LANGUAGES C CXX
    DESCRIPTION "JSON Structure Schema Validator for C/C++"
)

# C99 standard for C code
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

# C++11 for C++ bindings
set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Options
option(JS_BUILD_TESTS "Build tests" ON)
option(JS_BUILD_EXAMPLES "Build examples" ON)
option(JS_ENABLE_REGEX "Enable regex validation (requires PCRE2)" OFF)
option(JS_FETCH_DEPENDENCIES "Fetch dependencies automatically" ON)

# Compiler warnings
if(MSVC)
    add_compile_options(/W4)
else()
    add_compile_options(-Wall -Wextra -pedantic)
endif()

# Fetch cJSON if requested
if(JS_FETCH_DEPENDENCIES)
    include(FetchContent)
    
    FetchContent_Declare(
        cjson
        GIT_REPOSITORY https://github.com/DaveGamble/cJSON.git
        GIT_TAG v1.7.18
    )
    
    # Configure cJSON options
    set(ENABLE_CJSON_TEST OFF CACHE BOOL "" FORCE)
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    set(BUILD_SHARED_AND_STATIC_LIBS OFF CACHE BOOL "" FORCE)
    set(CJSON_OVERRIDE_BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
    set(CJSON_BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    
    FetchContent_MakeAvailable(cjson)
    
    # Create wrapper include directory for <cjson/cJSON.h> compatibility
    file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/include/cjson")
    if(NOT EXISTS "${CMAKE_BINARY_DIR}/include/cjson/cJSON.h")
        file(WRITE "${CMAKE_BINARY_DIR}/include/cjson/cJSON.h" "#include \"${cjson_SOURCE_DIR}/cJSON.h\"\n")
    endif()
    set(CJSON_INCLUDE_DIR "${CMAKE_BINARY_DIR}/include")
else()
    find_package(cJSON REQUIRED)
    set(CJSON_INCLUDE_DIR "")
endif()

# Main library
add_library(json_structure
    src/types.c
    src/error_codes.c
    src/schema_validator.c
    src/instance_validator.c
    src/json_source_locator.c
)

target_include_directories(json_structure
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<BUILD_INTERFACE:${CJSON_INCLUDE_DIR}>
        $<INSTALL_INTERFACE:include>
)

target_link_libraries(json_structure
    PUBLIC cjson
)

# Optional PCRE2 for regex
if(JS_ENABLE_REGEX)
    find_package(PkgConfig)
    if(PkgConfig_FOUND)
        pkg_check_modules(PCRE2 IMPORTED_TARGET libpcre2-8)
        if(PCRE2_FOUND)
            target_link_libraries(json_structure PUBLIC PkgConfig::PCRE2)
            target_compile_definitions(json_structure PUBLIC JS_HAVE_PCRE2=1)
        endif()
    endif()
endif()

# C++ bindings header-only interface
add_library(json_structure_cpp INTERFACE)
target_include_directories(json_structure_cpp
    INTERFACE
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
)
target_link_libraries(json_structure_cpp INTERFACE json_structure)

# Tests
if(JS_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

# Examples
if(JS_BUILD_EXAMPLES)
    add_subdirectory(examples)
endif()

# Installation
include(GNUInstallDirs)

install(TARGETS json_structure json_structure_cpp
    EXPORT json_structure-targets
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)

install(DIRECTORY include/
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)

install(EXPORT json_structure-targets
    FILE json_structure-config.cmake
    NAMESPACE json_structure::
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/json_structure
)
