/**
 * @file validate_schema.cpp
 * @brief Example: Validate a JSON Structure schema (C++ API)
 *
 * This example demonstrates how to use the JSON Structure C++ SDK
 * to validate schema documents using the modern C++ bindings.
 */

#include <iostream>
#include <json_structure/json_structure.hpp>

int main() {
    using namespace json_structure;
    
    // Define a simple schema
    const std::string schema = R"({
        "$id": "https://example.com/person",
        "$schema": "https://json-structure.org/meta/core/v0/schema",
        "name": "Person",
        "type": "object",
        "properties": {
            "firstName": {"type": "string", "minLength": 1},
            "lastName": {"type": "string", "minLength": 1},
            "age": {"type": "integer", "minimum": 0, "maximum": 150},
            "email": {"type": "email"}
        },
        "required": ["firstName", "lastName"]
    })";
    
    std::cout << "=== JSON Structure C++ SDK Example ===" << std::endl << std::endl;
    std::cout << "Schema:" << std::endl << schema << std::endl << std::endl;
    
    // Create a schema validator
    SchemaValidator validator;
    
    // Validate the schema
    auto result = validator.validate(schema);
    
    if (result) {
        std::cout << "Schema is valid!" << std::endl;
    } else {
        std::cout << "Schema validation failed:" << std::endl;
        for (const auto& error : result.errors()) {
            std::cout << "  [" << (error.code >= 0 ? "ERROR" : "WARNING") << "] "
                      << (error.path.empty() ? "(root)" : error.path) << ": "
                      << error.message << std::endl;
        }
    }
    
    // Instance validation
    std::cout << std::endl << "=== Instance Validation ===" << std::endl << std::endl;
    
    const std::string validInstance = R"({
        "firstName": "John",
        "lastName": "Doe",
        "age": 30,
        "email": "john.doe@example.com"
    })";
    
    const std::string invalidInstance = R"({
        "firstName": "Jane",
        "age": -5
    })";
    
    // Create an instance validator
    InstanceValidator instanceValidator;
    
    // Validate the valid instance
    std::cout << "Valid instance: " << validInstance << std::endl;
    auto validResult = instanceValidator.validate(validInstance, schema);
    std::cout << "Result: " << (validResult ? "VALID" : "INVALID") << std::endl << std::endl;
    
    // Validate the invalid instance
    std::cout << "Invalid instance: " << invalidInstance << std::endl;
    auto invalidResult = instanceValidator.validate(invalidInstance, schema);
    std::cout << "Result: " << (invalidResult ? "VALID" : "INVALID") << std::endl;
    
    if (!invalidResult) {
        std::cout << "Errors:" << std::endl;
        for (const auto& error : invalidResult.errors()) {
            std::cout << "  - " << (error.path.empty() ? "(root)" : error.path) 
                      << ": " << error.message << std::endl;
        }
    }
    
    // Alternative: Using validate_or_throw
    std::cout << std::endl << "=== Using validate_or_throw ===" << std::endl << std::endl;
    try {
        instanceValidator.validate_or_throw(invalidInstance, schema);
    } catch (const InstanceValidationException& e) {
        std::cout << "Caught validation exception: " << e.what() << std::endl;
    }
    
    return 0;
}
