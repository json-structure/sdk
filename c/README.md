# JSON Structure C/C++ SDK

A portable, C99-compatible JSON Structure schema validator with modern C++11 bindings.
Designed for embedded systems and cross-platform development.

## Features

- **Pure C99 implementation** - No C++ dependencies in the core library
- **Modern C++ bindings** - Header-only C++11 wrappers with optional C++17 features
- **Custom allocator support** - Plug in your own memory management for embedded systems
- **Schema validation** - Validate JSON Structure schema documents
- **Instance validation** - Validate JSON data against JSON Structure schemas
- **Portable** - Minimal dependencies, works on Windows, Linux, macOS, and embedded platforms
- **Well-documented** - Comprehensive API documentation and examples

## Dependencies

- **cJSON** - Lightweight JSON parser (automatically fetched via CMake)
- **PCRE2** (optional) - For regex pattern validation

## Building

### Prerequisites

- CMake 3.14 or later
- C99-compatible compiler (GCC, Clang, MSVC)
- C++11-compatible compiler for C++ bindings

### Build Steps

```bash
# Create build directory
mkdir build && cd build

# Configure (downloads cJSON automatically)
cmake .. -DCMAKE_BUILD_TYPE=Release

# Build
cmake --build .

# Run tests
ctest
```

### CMake Options

| Option | Default | Description |
|--------|---------|-------------|
| `JS_BUILD_TESTS` | ON | Build test suite |
| `JS_BUILD_EXAMPLES` | ON | Build example programs |
| `JS_ENABLE_REGEX` | OFF | Enable regex validation (requires PCRE2) |
| `JS_FETCH_DEPENDENCIES` | ON | Auto-fetch cJSON via FetchContent |

## Usage

### C API

```c
#include <json_structure/json_structure.h>

int main(void) {
    const char* schema = "{\"type\": \"string\", \"minLength\": 1}";
    const char* instance = "\"hello\"";
    
    js_result_t result;
    
    // Validate schema
    if (js_validate_schema(schema, &result)) {
        printf("Schema is valid\n");
    }
    js_result_cleanup(&result);
    
    // Validate instance
    if (js_validate_instance(instance, schema, &result)) {
        printf("Instance is valid\n");
    } else {
        for (size_t i = 0; i < result.error_count; i++) {
            printf("Error: %s\n", result.errors[i].message);
        }
    }
    js_result_cleanup(&result);
    
    return 0;
}
```

### C++ API

```cpp
#include <json_structure/json_structure.hpp>

int main() {
    using namespace json_structure;
    
    std::string schema = R"({"type": "string", "minLength": 1})";
    std::string instance = R"("hello")";
    
    // Validate schema
    auto schemaResult = validate_schema(schema);
    if (schemaResult) {
        std::cout << "Schema is valid" << std::endl;
    }
    
    // Validate instance
    auto instanceResult = validate_instance(instance, schema);
    if (instanceResult) {
        std::cout << "Instance is valid" << std::endl;
    } else {
        std::cout << "Errors: " << instanceResult.error_summary() << std::endl;
    }
    
    // Or use exceptions
    try {
        InstanceValidator validator;
        validator.validate_or_throw(instance, schema);
    } catch (const InstanceValidationException& e) {
        std::cerr << "Validation failed: " << e.what() << std::endl;
    }
    
    return 0;
}
```

### Custom Allocator (Embedded Systems)

```c
#include <json_structure/json_structure.h>

// Your custom allocator functions
static void* my_malloc(size_t size) { /* ... */ }
static void* my_realloc(void* ptr, size_t size) { /* ... */ }
static void my_free(void* ptr) { /* ... */ }

int main(void) {
    // Set custom allocator before any other calls
    js_allocator_t alloc = {
        .malloc_fn = my_malloc,
        .realloc_fn = my_realloc,
        .free_fn = my_free,
        .user_data = NULL
    };
    js_set_allocator(alloc);
    
    // Now all allocations use your functions
    // ...
    
    return 0;
}
```

## API Reference

### Core Types

- `js_type_t` - Enumeration of all JSON Structure types
- `js_error_t` - Single validation error
- `js_result_t` - Collection of validation results
- `js_allocator_t` - Custom allocator interface

### Schema Validation

- `js_schema_validator_init()` - Initialize validator with defaults
- `js_schema_validate_string()` - Validate schema from JSON string
- `js_schema_validate()` - Validate pre-parsed cJSON schema

### Instance Validation

- `js_instance_validator_init()` - Initialize validator with defaults
- `js_instance_validate_strings()` - Validate instance and schema from strings
- `js_instance_validate()` - Validate pre-parsed cJSON objects

### Convenience Functions

- `js_validate_schema()` - Quick schema validation
- `js_validate_instance()` - Quick instance validation

## Project Structure

```
c/
├── CMakeLists.txt          # Main build configuration
├── include/
│   └── json_structure/
│       ├── json_structure.h     # Main umbrella header (C)
│       ├── json_structure.hpp   # C++ bindings
│       ├── types.h              # Core type definitions
│       ├── error_codes.h        # Error enumerations
│       ├── schema_validator.h   # Schema validator API
│       └── instance_validator.h # Instance validator API
├── src/
│   ├── types.c                 # Type implementations
│   ├── error_codes.c           # Error string functions
│   ├── schema_validator.c      # Schema validation logic
│   ├── instance_validator.c    # Instance validation logic
│   └── json_source_locator.c   # Source location tracking
├── tests/
│   ├── main.c                  # Test runner
│   ├── test_types.c
│   ├── test_schema_validator.c
│   └── test_instance_validator.c
└── examples/
    ├── validate_schema.c       # C example
    └── validate_schema.cpp     # C++ example
```

## License

MIT License. See [LICENSE](LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.
