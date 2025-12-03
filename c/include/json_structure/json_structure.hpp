/**
 * @file json_structure.hpp
 * @brief JSON Structure SDK C++ bindings
 * 
 * Modern C++ wrapper for the JSON Structure C SDK.
 * Requires C++11 or later. C++17 provides additional features.
 * 
 * Copyright (c) 2024 JSON Structure Contributors
 * SPDX-License-Identifier: MIT
 */

#ifndef JSON_STRUCTURE_HPP
#define JSON_STRUCTURE_HPP

#include "json_structure.h"

#include <string>
#include <vector>
#include <stdexcept>
#include <memory>

#if __cplusplus >= 201703L
#include <string_view>
#include <optional>
#endif

namespace json_structure {

/* ============================================================================
 * Exceptions
 * ============================================================================ */

/**
 * @brief Base exception for JSON Structure errors
 */
class Exception : public std::runtime_error {
public:
    explicit Exception(const std::string& message)
        : std::runtime_error(message) {}
    
    explicit Exception(js_error_code_t code, const std::string& message)
        : std::runtime_error(message), code_(code) {}
    
    js_error_code_t code() const noexcept { return code_; }

private:
    js_error_code_t code_ = JS_ERROR_INTERNAL_ERROR;
};

/**
 * @brief Exception for schema validation errors
 */
class SchemaValidationException : public Exception {
public:
    explicit SchemaValidationException(const std::string& message)
        : Exception(message) {}
};

/**
 * @brief Exception for instance validation errors
 */
class InstanceValidationException : public Exception {
public:
    explicit InstanceValidationException(const std::string& message)
        : Exception(message) {}
};

/* ============================================================================
 * Result Types
 * ============================================================================ */

/**
 * @brief Single validation error
 */
struct Error {
    js_error_code_t code;
    std::string message;
    std::string path;
    
    Error() : code(JS_ERROR_NONE) {}
    
    Error(const js_error_t& e) 
        : code(e.code)
        , message(e.message ? e.message : "")
        , path(e.path ? e.path : "") {}
};

/**
 * @brief Validation result containing success status and errors
 */
class Result {
public:
    Result() : valid_(true) {}
    
    explicit Result(const js_result_t& r)
        : valid_(r.valid) {
        for (size_t i = 0; i < r.error_count; ++i) {
            errors_.emplace_back(r.errors[i]);
        }
    }
    
    bool valid() const noexcept { return valid_; }
    bool operator!() const noexcept { return !valid_; }
    explicit operator bool() const noexcept { return valid_; }
    
    const std::vector<Error>& errors() const noexcept { return errors_; }
    
    std::string error_summary() const {
        if (valid_) return "Valid";
        std::string summary;
        for (const auto& e : errors_) {
            if (!summary.empty()) summary += "; ";
            summary += e.message;
            if (!e.path.empty()) {
                summary += " at " + e.path;
            }
        }
        return summary;
    }

private:
    bool valid_;
    std::vector<Error> errors_;
};

/* ============================================================================
 * Schema Validator
 * ============================================================================ */

/**
 * @brief Options for schema validation
 */
struct SchemaValidatorOptions {
    bool allow_import = false;
    bool warnings_enabled = true;
    
    operator js_schema_options_t() const {
        return {allow_import, warnings_enabled};
    }
};

/**
 * @brief Schema validator
 */
class SchemaValidator {
public:
    SchemaValidator() {
        js_schema_validator_init(&validator_);
    }
    
    explicit SchemaValidator(const SchemaValidatorOptions& options) {
        js_schema_validator_init_with_options(&validator_, options);
    }
    
    ~SchemaValidator() = default;
    
    // Non-copyable
    SchemaValidator(const SchemaValidator&) = delete;
    SchemaValidator& operator=(const SchemaValidator&) = delete;
    
    // Moveable
    SchemaValidator(SchemaValidator&&) = default;
    SchemaValidator& operator=(SchemaValidator&&) = default;
    
    /**
     * @brief Validate a schema from a JSON string
     * @param schema_json JSON string containing the schema
     * @return Validation result
     */
    Result validate(const std::string& schema_json) {
        js_result_t result;
        js_result_init(&result);
        js_schema_validator_validate_string(&validator_, schema_json.c_str(), &result);
        Result r(result);
        js_result_cleanup(&result);
        return r;
    }
    
#if __cplusplus >= 201703L
    Result validate(std::string_view schema_json) {
        return validate(std::string(schema_json));
    }
#endif
    
    /**
     * @brief Validate and throw on error
     * @param schema_json JSON string containing the schema
     * @throws SchemaValidationException if schema is invalid
     */
    void validate_or_throw(const std::string& schema_json) {
        auto result = validate(schema_json);
        if (!result) {
            throw SchemaValidationException(result.error_summary());
        }
    }

private:
    js_schema_validator_t validator_;
};

/* ============================================================================
 * Instance Validator
 * ============================================================================ */

/**
 * @brief Options for instance validation
 */
struct InstanceValidatorOptions {
    bool allow_additional_properties = true;
    bool validate_formats = true;
    
    operator js_instance_options_t() const {
        return {allow_additional_properties, validate_formats};
    }
};

/**
 * @brief Instance validator
 */
class InstanceValidator {
public:
    InstanceValidator() {
        js_instance_validator_init(&validator_);
    }
    
    explicit InstanceValidator(const InstanceValidatorOptions& options) {
        js_instance_validator_init_with_options(&validator_, options);
    }
    
    ~InstanceValidator() = default;
    
    // Non-copyable
    InstanceValidator(const InstanceValidator&) = delete;
    InstanceValidator& operator=(const InstanceValidator&) = delete;
    
    // Moveable
    InstanceValidator(InstanceValidator&&) = default;
    InstanceValidator& operator=(InstanceValidator&&) = default;
    
    /**
     * @brief Validate an instance against a schema
     * @param instance_json JSON string containing the instance
     * @param schema_json JSON string containing the schema
     * @return Validation result
     */
    Result validate(const std::string& instance_json, const std::string& schema_json) {
        js_result_t result;
        js_result_init(&result);
        js_instance_validate_strings(&validator_, instance_json.c_str(),
                                     schema_json.c_str(), &result);
        Result r(result);
        js_result_cleanup(&result);
        return r;
    }
    
#if __cplusplus >= 201703L
    Result validate(std::string_view instance_json, std::string_view schema_json) {
        return validate(std::string(instance_json), std::string(schema_json));
    }
#endif
    
    /**
     * @brief Validate and throw on error
     * @param instance_json JSON string containing the instance
     * @param schema_json JSON string containing the schema
     * @throws InstanceValidationException if instance is invalid
     */
    void validate_or_throw(const std::string& instance_json,
                           const std::string& schema_json) {
        auto result = validate(instance_json, schema_json);
        if (!result) {
            throw InstanceValidationException(result.error_summary());
        }
    }

private:
    js_instance_validator_t validator_;
};

/* ============================================================================
 * Convenience Functions
 * ============================================================================ */

/**
 * @brief Validate a schema (convenience function)
 * @param schema_json JSON string containing the schema
 * @return Validation result
 */
inline Result validate_schema(const std::string& schema_json) {
    SchemaValidator validator;
    return validator.validate(schema_json);
}

/**
 * @brief Validate an instance against a schema (convenience function)
 * @param instance_json JSON string containing the instance
 * @param schema_json JSON string containing the schema
 * @return Validation result
 */
inline Result validate_instance(const std::string& instance_json,
                                const std::string& schema_json) {
    InstanceValidator validator;
    return validator.validate(instance_json, schema_json);
}

/**
 * @brief Get the library version
 * @return Version string
 */
inline std::string version() {
    return JSON_STRUCTURE_VERSION_STRING;
}

} // namespace json_structure

#endif /* JSON_STRUCTURE_HPP */
