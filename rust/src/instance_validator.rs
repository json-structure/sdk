//! Instance validator for JSON Structure instances.
//!
//! Validates JSON data instances against JSON Structure schemas.

use base64::Engine;
use chrono::{NaiveDate, NaiveTime, DateTime};
use regex::Regex;
use serde_json::Value;
use uuid::Uuid;

use crate::error_codes::InstanceErrorCode;
use crate::json_source_locator::JsonSourceLocator;
use crate::types::{
    InstanceValidatorOptions, JsonLocation, ValidationError, ValidationResult,
};

/// Validates JSON instances against JSON Structure schemas.
///
/// # Example
///
/// ```
/// use json_structure::InstanceValidator;
/// use serde_json::json;
///
/// let validator = InstanceValidator::new();
/// let schema = json!({
///     "$id": "test",
///     "name": "Test",
///     "type": "string"
/// });
/// let result = validator.validate("\"hello\"", &schema);
/// assert!(result.is_valid());
/// ```
pub struct InstanceValidator {
    options: InstanceValidatorOptions,
}

impl Default for InstanceValidator {
    fn default() -> Self {
        Self::new()
    }
}

impl InstanceValidator {
    /// Creates a new instance validator with default options.
    #[must_use]
    pub fn new() -> Self {
        Self::with_options(InstanceValidatorOptions::default())
    }

    /// Creates a new instance validator with the given options.
    #[must_use]
    pub fn with_options(options: InstanceValidatorOptions) -> Self {
        Self { options }
    }

    /// Enables or disables extended validation mode.
    pub fn set_extended(&mut self, extended: bool) {
        self.options.extended = extended;
    }

    /// Returns whether extended validation is enabled.
    #[must_use]
    pub fn is_extended(&self) -> bool {
        self.options.extended
    }

    /// Validates a JSON instance against a schema.
    ///
    /// Returns a [`ValidationResult`] that should be checked with [`is_valid()`](ValidationResult::is_valid).
    #[must_use]
    pub fn validate(&self, instance_json: &str, schema: &Value) -> ValidationResult {
        let mut result = ValidationResult::new();
        let locator = JsonSourceLocator::new(instance_json);

        match serde_json::from_str::<Value>(instance_json) {
            Ok(instance) => {
                // Check for $root and use it as the starting point for validation
                let effective_schema = if let Some(schema_obj) = schema.as_object() {
                    if let Some(Value::String(root_ref)) = schema_obj.get("$root") {
                        // Resolve the $root reference
                        if let Some(resolved) = self.resolve_ref(root_ref, schema) {
                            resolved
                        } else {
                            // If $root can't be resolved, use the schema itself
                            schema
                        }
                    } else {
                        schema
                    }
                } else {
                    schema
                };
                
                self.validate_instance(&instance, effective_schema, schema, &mut result, "", &locator, 0);
            }
            Err(e) => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceTypeMismatch,
                    format!("Failed to parse JSON: {}", e),
                    "",
                    JsonLocation::unknown(),
                ));
            }
        }

        result
    }

    /// Validates an instance value against a schema.
    fn validate_instance(
        &self,
        instance: &Value,
        schema: &Value,
        root_schema: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        depth: usize,
    ) {
        if depth > 64 {
            return;
        }

        // Handle boolean schemas
        match schema {
            Value::Bool(true) => return, // Accepts everything
            Value::Bool(false) => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceTypeMismatch,
                    "Schema rejects all values",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
            Value::Object(_) => {}
            _ => return,
        }

        let schema_obj = schema.as_object().unwrap();

        // Handle $ref
        if let Some(ref_val) = schema_obj.get("$ref") {
            if let Value::String(ref_str) = ref_val {
                if let Some(resolved) = self.resolve_ref(ref_str, root_schema) {
                    self.validate_instance(instance, resolved, root_schema, result, path, locator, depth + 1);
                    return;
                } else {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceRefNotFound,
                        format!("Reference not found: {}", ref_str),
                        path,
                        locator.get_location(path),
                    ));
                    return;
                }
            }
        }

        // Validate enum
        if let Some(enum_val) = schema_obj.get("enum") {
            if !self.validate_enum(instance, enum_val) {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceEnumMismatch,
                    "Value does not match any enum value",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        }

        // Validate const
        if let Some(const_val) = schema_obj.get("const") {
            if instance != const_val {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceConstMismatch,
                    "Value does not match const",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        }

        // Get type and validate
        if let Some(type_val) = schema_obj.get("type") {
            match type_val {
                Value::String(type_name) => {
                    self.validate_type(instance, type_name, schema_obj, root_schema, result, path, locator, depth);
                }
                Value::Array(types) => {
                    // Union type: try each type until one validates
                    let mut union_valid = false;
                    for t in types {
                        match t {
                            Value::String(type_name) => {
                                let mut temp_result = ValidationResult::new();
                                self.validate_type(instance, type_name, schema_obj, root_schema, &mut temp_result, path, locator, depth);
                                if temp_result.is_valid() {
                                    union_valid = true;
                                    break;
                                }
                            }
                            Value::Object(ref_obj) => {
                                if let Some(Value::String(ref_str)) = ref_obj.get("$ref") {
                                    if let Some(resolved) = self.resolve_ref(ref_str, root_schema) {
                                        let mut temp_result = ValidationResult::new();
                                        self.validate_instance(instance, resolved, root_schema, &mut temp_result, path, locator, depth + 1);
                                        if temp_result.is_valid() {
                                            union_valid = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    if !union_valid {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceUnionNoMatch,
                            "Value does not match any type in union",
                            path,
                            locator.get_location(path),
                        ));
                    }
                    return;
                }
                Value::Object(ref_obj) => {
                    // Type is a $ref object
                    if let Some(Value::String(ref_str)) = ref_obj.get("$ref") {
                        if let Some(resolved) = self.resolve_ref(ref_str, root_schema) {
                            self.validate_instance(instance, resolved, root_schema, result, path, locator, depth + 1);
                        } else {
                            result.add_error(ValidationError::instance_error(
                                InstanceErrorCode::InstanceRefNotFound,
                                format!("Reference not found: {}", ref_str),
                                path,
                                locator.get_location(path),
                            ));
                        }
                    }
                    return;
                }
                _ => {}
            }
        }

        // Validate composition (if extended)
        if self.options.extended {
            self.validate_composition(instance, schema_obj, root_schema, result, path, locator, depth);
        }
    }

    /// Resolves a $ref reference.
    fn resolve_ref<'a>(&self, ref_str: &str, root_schema: &'a Value) -> Option<&'a Value> {
        if let Some(def_name) = ref_str.strip_prefix("#/definitions/") {
            root_schema
                .get("definitions")
                .and_then(|defs| defs.get(def_name))
        } else {
            None
        }
    }

    /// Validates enum constraint.
    fn validate_enum(&self, instance: &Value, enum_val: &Value) -> bool {
        if let Value::Array(arr) = enum_val {
            arr.iter().any(|v| v == instance)
        } else {
            false
        }
    }

    /// Validates instance against a specific type.
    fn validate_type(
        &self,
        instance: &Value,
        type_name: &str,
        schema_obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        depth: usize,
    ) {
        match type_name {
            "string" => self.validate_string(instance, schema_obj, result, path, locator),
            "boolean" => self.validate_boolean(instance, result, path, locator),
            "null" => self.validate_null(instance, result, path, locator),
            "number" => self.validate_number(instance, schema_obj, result, path, locator),
            "integer" | "int32" => self.validate_int32(instance, schema_obj, result, path, locator),
            "int8" => self.validate_int_range(instance, schema_obj, result, path, locator, -128, 127, "int8"),
            "int16" => self.validate_int_range(instance, schema_obj, result, path, locator, -32768, 32767, "int16"),
            "int64" => self.validate_int64(instance, schema_obj, result, path, locator),
            "int128" => self.validate_int128(instance, schema_obj, result, path, locator),
            "uint8" => self.validate_uint_range(instance, schema_obj, result, path, locator, 0, 255, "uint8"),
            "uint16" => self.validate_uint_range(instance, schema_obj, result, path, locator, 0, 65535, "uint16"),
            "uint32" => self.validate_uint32(instance, schema_obj, result, path, locator),
            "uint64" => self.validate_uint64(instance, schema_obj, result, path, locator),
            "uint128" => self.validate_uint128(instance, schema_obj, result, path, locator),
            "float" | "float8" | "double" => {
                self.validate_number(instance, schema_obj, result, path, locator)
            }
            "decimal" => self.validate_decimal(instance, schema_obj, result, path, locator),
            "date" => self.validate_date(instance, result, path, locator),
            "time" => self.validate_time(instance, result, path, locator),
            "datetime" => self.validate_datetime(instance, result, path, locator),
            "duration" => self.validate_duration(instance, result, path, locator),
            "uuid" => self.validate_uuid(instance, result, path, locator),
            "uri" => self.validate_uri(instance, result, path, locator),
            "binary" => self.validate_binary(instance, result, path, locator),
            "jsonpointer" => self.validate_jsonpointer(instance, result, path, locator),
            "object" => self.validate_object(instance, schema_obj, root_schema, result, path, locator, depth),
            "array" => self.validate_array(instance, schema_obj, root_schema, result, path, locator, depth),
            "set" => self.validate_set(instance, schema_obj, root_schema, result, path, locator, depth),
            "map" => self.validate_map(instance, schema_obj, root_schema, result, path, locator, depth),
            "tuple" => self.validate_tuple(instance, schema_obj, root_schema, result, path, locator, depth),
            "choice" => self.validate_choice(instance, schema_obj, root_schema, result, path, locator, depth),
            "any" => {} // Any value is valid
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceTypeUnknown,
                    format!("Unknown type: {}", type_name),
                    path,
                    locator.get_location(path),
                ));
            }
        }
    }

    // ===== Primitive type validators =====

    fn validate_string(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let s = match instance {
            Value::String(s) => s,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceStringExpected,
                    "Expected string",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        if self.options.extended {
            // minLength
            if let Some(Value::Number(n)) = schema_obj.get("minLength") {
                if let Some(min) = n.as_u64() {
                    if s.chars().count() < min as usize {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceStringTooShort,
                            format!("String length {} is less than minimum {}", s.chars().count(), min),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // maxLength
            if let Some(Value::Number(n)) = schema_obj.get("maxLength") {
                if let Some(max) = n.as_u64() {
                    if s.chars().count() > max as usize {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceStringTooLong,
                            format!("String length {} is greater than maximum {}", s.chars().count(), max),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // pattern
            if let Some(Value::String(pattern)) = schema_obj.get("pattern") {
                if let Ok(re) = Regex::new(pattern) {
                    if !re.is_match(s) {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceStringPatternMismatch,
                            format!("String does not match pattern: {}", pattern),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }
        }
    }

    fn validate_boolean(
        &self,
        instance: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        if !instance.is_boolean() {
            result.add_error(ValidationError::instance_error(
                InstanceErrorCode::InstanceBooleanExpected,
                "Expected boolean",
                path,
                locator.get_location(path),
            ));
        }
    }

    fn validate_null(
        &self,
        instance: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        if !instance.is_null() {
            result.add_error(ValidationError::instance_error(
                InstanceErrorCode::InstanceNullExpected,
                "Expected null",
                path,
                locator.get_location(path),
            ));
        }
    }

    fn validate_number(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let num = match instance {
            Value::Number(n) => n,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceNumberExpected,
                    "Expected number",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        if self.options.extended {
            let value = num.as_f64().unwrap_or(0.0);

            // minimum
            if let Some(Value::Number(n)) = schema_obj.get("minimum") {
                if let Some(min) = n.as_f64() {
                    if value < min {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooSmall,
                            format!("Value {} is less than minimum {}", value, min),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // maximum
            if let Some(Value::Number(n)) = schema_obj.get("maximum") {
                if let Some(max) = n.as_f64() {
                    if value > max {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooLarge,
                            format!("Value {} is greater than maximum {}", value, max),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // exclusiveMinimum
            if let Some(Value::Number(n)) = schema_obj.get("exclusiveMinimum") {
                if let Some(min) = n.as_f64() {
                    if value <= min {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooSmall,
                            format!("Value {} is not greater than exclusive minimum {}", value, min),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // exclusiveMaximum
            if let Some(Value::Number(n)) = schema_obj.get("exclusiveMaximum") {
                if let Some(max) = n.as_f64() {
                    if value >= max {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooLarge,
                            format!("Value {} is not less than exclusive maximum {}", value, max),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }
        }
    }

    /// Validates a decimal value.
    /// Per the JSON Structure spec, decimal values are represented as strings
    /// to preserve arbitrary precision. Numbers are also accepted for convenience.
    fn validate_decimal(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let value: f64 = match instance {
            Value::String(s) => {
                // Decimal values should be strings per spec
                match s.parse::<f64>() {
                    Ok(v) => v,
                    Err(_) => {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceDecimalExpected,
                            format!("Invalid decimal format: {}", s),
                            path,
                            locator.get_location(path),
                        ));
                        return;
                    }
                }
            }
            Value::Number(n) => {
                // Also accept numbers for convenience (though strings preferred)
                n.as_f64().unwrap_or(0.0)
            }
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceDecimalExpected,
                    "Expected decimal (as string or number)",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        // Apply numeric constraints if extended validation is enabled
        if self.options.extended {
            // minimum
            if let Some(min_val) = schema_obj.get("minimum") {
                let min = match min_val {
                    Value::Number(n) => n.as_f64(),
                    Value::String(s) => s.parse::<f64>().ok(),
                    _ => None,
                };
                if let Some(min) = min {
                    if value < min {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooSmall,
                            format!("Value {} is less than minimum {}", value, min),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // maximum
            if let Some(max_val) = schema_obj.get("maximum") {
                let max = match max_val {
                    Value::Number(n) => n.as_f64(),
                    Value::String(s) => s.parse::<f64>().ok(),
                    _ => None,
                };
                if let Some(max) = max {
                    if value > max {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooLarge,
                            format!("Value {} is greater than maximum {}", value, max),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // exclusiveMinimum
            if let Some(min_val) = schema_obj.get("exclusiveMinimum") {
                let min = match min_val {
                    Value::Number(n) => n.as_f64(),
                    Value::String(s) => s.parse::<f64>().ok(),
                    _ => None,
                };
                if let Some(min) = min {
                    if value <= min {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooSmall,
                            format!("Value {} is not greater than exclusive minimum {}", value, min),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // exclusiveMaximum
            if let Some(max_val) = schema_obj.get("exclusiveMaximum") {
                let max = match max_val {
                    Value::Number(n) => n.as_f64(),
                    Value::String(s) => s.parse::<f64>().ok(),
                    _ => None,
                };
                if let Some(max) = max {
                    if value >= max {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooLarge,
                            format!("Value {} is not less than exclusive maximum {}", value, max),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }
        }
    }

    fn validate_int32(
        &self,
        instance: &Value,
        _schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        self.validate_int_range(instance, _schema_obj, result, path, locator, i32::MIN as i64, i32::MAX as i64, "int32")
    }

    fn validate_int_range(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        min: i64,
        max: i64,
        type_name: &str,
    ) {
        let num = match instance {
            Value::Number(n) => n,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerExpected,
                    format!("Expected {}", type_name),
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        let val = if let Some(v) = num.as_i64() {
            if v < min || v > max {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerOutOfRange,
                    format!("Value {} is out of range for {} ({} to {})", v, type_name, min, max),
                    path,
                    locator.get_location(path),
                ));
            }
            v as f64
        } else if let Some(v) = num.as_f64() {
            if v.fract() != 0.0 {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerExpected,
                    format!("Expected integer, got {}", v),
                    path,
                    locator.get_location(path),
                ));
                return;
            }
            if v < min as f64 || v > max as f64 {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerOutOfRange,
                    format!("Value {} is out of range for {}", v, type_name),
                    path,
                    locator.get_location(path),
                ));
            }
            v
        } else {
            return;
        };

        // Extended validation
        if self.options.extended {
            // minimum
            if let Some(Value::Number(n)) = schema_obj.get("minimum") {
                if let Some(min_val) = n.as_f64() {
                    if val < min_val {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooSmall,
                            format!("Value {} is less than minimum {}", val, min_val),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // maximum
            if let Some(Value::Number(n)) = schema_obj.get("maximum") {
                if let Some(max_val) = n.as_f64() {
                    if val > max_val {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooLarge,
                            format!("Value {} is greater than maximum {}", val, max_val),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // exclusiveMinimum
            if let Some(Value::Number(n)) = schema_obj.get("exclusiveMinimum") {
                if let Some(min_val) = n.as_f64() {
                    if val <= min_val {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooSmall,
                            format!("Value {} is not greater than exclusive minimum {}", val, min_val),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // exclusiveMaximum
            if let Some(Value::Number(n)) = schema_obj.get("exclusiveMaximum") {
                if let Some(max_val) = n.as_f64() {
                    if val >= max_val {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooLarge,
                            format!("Value {} is not less than exclusive maximum {}", val, max_val),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // multipleOf
            if let Some(Value::Number(n)) = schema_obj.get("multipleOf") {
                if let Some(mul) = n.as_f64() {
                    if mul > 0.0 && (val % mul).abs() > f64::EPSILON {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberNotMultiple,
                            format!("Value {} is not a multiple of {}", val, mul),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }
        }
    }

    fn validate_uint_range(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        min: u64,
        max: u64,
        type_name: &str,
    ) {
        let num = match instance {
            Value::Number(n) => n,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerExpected,
                    format!("Expected {}", type_name),
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        if let Some(val) = num.as_u64() {
            if val < min || val > max {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerOutOfRange,
                    format!("Value {} is out of range for {} ({} to {})", val, type_name, min, max),
                    path,
                    locator.get_location(path),
                ));
            }
        } else if let Some(v) = num.as_i64() {
            if v < 0 {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerOutOfRange,
                    format!("Value {} is negative, expected unsigned {}", v, type_name),
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        } else {
            return;
        }

        // Get value for extended validation
        let val = num.as_f64().unwrap_or(0.0);

        // Extended validation
        if self.options.extended {
            // minimum
            if let Some(Value::Number(n)) = schema_obj.get("minimum") {
                if let Some(min_val) = n.as_f64() {
                    if val < min_val {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooSmall,
                            format!("Value {} is less than minimum {}", val, min_val),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // maximum
            if let Some(Value::Number(n)) = schema_obj.get("maximum") {
                if let Some(max_val) = n.as_f64() {
                    if val > max_val {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooLarge,
                            format!("Value {} is greater than maximum {}", val, max_val),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // exclusiveMinimum
            if let Some(Value::Number(n)) = schema_obj.get("exclusiveMinimum") {
                if let Some(min_val) = n.as_f64() {
                    if val <= min_val {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooSmall,
                            format!("Value {} is not greater than exclusive minimum {}", val, min_val),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // exclusiveMaximum
            if let Some(Value::Number(n)) = schema_obj.get("exclusiveMaximum") {
                if let Some(max_val) = n.as_f64() {
                    if val >= max_val {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberTooLarge,
                            format!("Value {} is not less than exclusive maximum {}", val, max_val),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // multipleOf
            if let Some(Value::Number(n)) = schema_obj.get("multipleOf") {
                if let Some(mul) = n.as_f64() {
                    if mul > 0.0 && (val % mul).abs() > f64::EPSILON {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceNumberNotMultiple,
                            format!("Value {} is not a multiple of {}", val, mul),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }
        }
    }

    fn validate_int64(
        &self,
        instance: &Value,
        _schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        match instance {
            Value::Number(n) => {
                if n.as_i64().is_none() && n.as_f64().is_none_or(|f| f.fract() != 0.0) {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceIntegerExpected,
                        "Expected int64",
                        path,
                        locator.get_location(path),
                    ));
                }
            }
            Value::String(s) => {
                // int64 can be represented as string for large values
                if s.parse::<i64>().is_err() {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceIntegerExpected,
                        "Expected int64 (as number or string)",
                        path,
                        locator.get_location(path),
                    ));
                }
            }
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerExpected,
                    "Expected int64",
                    path,
                    locator.get_location(path),
                ));
            }
        }
    }

    fn validate_int128(
        &self,
        instance: &Value,
        _schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        match instance {
            Value::Number(_) => {} // Any number is valid for int128
            Value::String(s) => {
                if s.parse::<i128>().is_err() {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceIntegerExpected,
                        "Expected int128 (as number or string)",
                        path,
                        locator.get_location(path),
                    ));
                }
            }
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerExpected,
                    "Expected int128",
                    path,
                    locator.get_location(path),
                ));
            }
        }
    }

    fn validate_uint32(
        &self,
        instance: &Value,
        _schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        self.validate_uint_range(instance, _schema_obj, result, path, locator, 0, u32::MAX as u64, "uint32")
    }

    fn validate_uint64(
        &self,
        instance: &Value,
        _schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        match instance {
            Value::Number(n) => {
                if n.as_u64().is_none() {
                    if let Some(i) = n.as_i64() {
                        if i < 0 {
                            result.add_error(ValidationError::instance_error(
                                InstanceErrorCode::InstanceIntegerOutOfRange,
                                "Expected unsigned uint64",
                                path,
                                locator.get_location(path),
                            ));
                        }
                    }
                }
            }
            Value::String(s) => {
                if s.parse::<u64>().is_err() {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceIntegerExpected,
                        "Expected uint64 (as number or string)",
                        path,
                        locator.get_location(path),
                    ));
                }
            }
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerExpected,
                    "Expected uint64",
                    path,
                    locator.get_location(path),
                ));
            }
        }
    }

    fn validate_uint128(
        &self,
        instance: &Value,
        _schema_obj: &serde_json::Map<String, Value>,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        match instance {
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    if i < 0 {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceIntegerOutOfRange,
                            "Expected unsigned uint128",
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }
            Value::String(s) => {
                if s.parse::<u128>().is_err() {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceIntegerExpected,
                        "Expected uint128 (as number or string)",
                        path,
                        locator.get_location(path),
                    ));
                }
            }
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceIntegerExpected,
                    "Expected uint128",
                    path,
                    locator.get_location(path),
                ));
            }
        }
    }

    // ===== Date/Time validators =====

    fn validate_date(
        &self,
        instance: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let s = match instance {
            Value::String(s) => s,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceDateExpected,
                    "Expected date string",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        if NaiveDate::parse_from_str(s, "%Y-%m-%d").is_err() {
            result.add_error(ValidationError::instance_error(
                InstanceErrorCode::InstanceDateInvalid,
                format!("Invalid date format: {}", s),
                path,
                locator.get_location(path),
            ));
        }
    }

    fn validate_time(
        &self,
        instance: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let s = match instance {
            Value::String(s) => s,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceTimeExpected,
                    "Expected time string",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        // Try multiple formats
        let valid = NaiveTime::parse_from_str(s, "%H:%M:%S").is_ok()
            || NaiveTime::parse_from_str(s, "%H:%M:%S%.f").is_ok()
            || NaiveTime::parse_from_str(s, "%H:%M").is_ok();

        if !valid {
            result.add_error(ValidationError::instance_error(
                InstanceErrorCode::InstanceTimeInvalid,
                format!("Invalid time format: {}", s),
                path,
                locator.get_location(path),
            ));
        }
    }

    fn validate_datetime(
        &self,
        instance: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let s = match instance {
            Value::String(s) => s,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceDateTimeExpected,
                    "Expected datetime string",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        // Try RFC 3339 format
        if DateTime::parse_from_rfc3339(s).is_err() {
            result.add_error(ValidationError::instance_error(
                InstanceErrorCode::InstanceDateTimeInvalid,
                format!("Invalid datetime format (expected RFC 3339): {}", s),
                path,
                locator.get_location(path),
            ));
        }
    }

    fn validate_duration(
        &self,
        instance: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let s = match instance {
            Value::String(s) => s,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceDurationExpected,
                    "Expected duration string",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        // Simple ISO 8601 duration pattern check
        let duration_pattern = Regex::new(r"^P(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$").unwrap();
        if !duration_pattern.is_match(s) {
            result.add_error(ValidationError::instance_error(
                InstanceErrorCode::InstanceDurationInvalid,
                format!("Invalid duration format (expected ISO 8601): {}", s),
                path,
                locator.get_location(path),
            ));
        }
    }

    // ===== Other primitive validators =====

    fn validate_uuid(
        &self,
        instance: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let s = match instance {
            Value::String(s) => s,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceUuidExpected,
                    "Expected UUID string",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        if Uuid::parse_str(s).is_err() {
            result.add_error(ValidationError::instance_error(
                InstanceErrorCode::InstanceUuidInvalid,
                format!("Invalid UUID format: {}", s),
                path,
                locator.get_location(path),
            ));
        }
    }

    fn validate_uri(
        &self,
        instance: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let s = match instance {
            Value::String(s) => s,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceUriExpected,
                    "Expected URI string",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        if url::Url::parse(s).is_err() {
            result.add_error(ValidationError::instance_error(
                InstanceErrorCode::InstanceUriInvalid,
                format!("Invalid URI format: {}", s),
                path,
                locator.get_location(path),
            ));
        }
    }

    fn validate_binary(
        &self,
        instance: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let s = match instance {
            Value::String(s) => s,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceBinaryExpected,
                    "Expected base64 string",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        if base64::engine::general_purpose::STANDARD.decode(s).is_err() {
            result.add_error(ValidationError::instance_error(
                InstanceErrorCode::InstanceBinaryInvalid,
                format!("Invalid base64 encoding: {}", s),
                path,
                locator.get_location(path),
            ));
        }
    }

    fn validate_jsonpointer(
        &self,
        instance: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
    ) {
        let s = match instance {
            Value::String(s) => s,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceJsonPointerExpected,
                    "Expected JSON Pointer string",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        // JSON Pointer must be empty or start with /
        if !s.is_empty() && !s.starts_with('/') {
            result.add_error(ValidationError::instance_error(
                InstanceErrorCode::InstanceJsonPointerInvalid,
                format!("Invalid JSON Pointer format: {}", s),
                path,
                locator.get_location(path),
            ));
        }
    }

    // ===== Compound type validators =====

    fn validate_object(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        depth: usize,
    ) {
        let obj = match instance {
            Value::Object(o) => o,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceObjectExpected,
                    "Expected object",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        let properties = schema_obj.get("properties").and_then(Value::as_object);
        let required = schema_obj.get("required").and_then(Value::as_array);
        let additional_properties = schema_obj.get("additionalProperties");

        // Validate required properties
        if let Some(req) = required {
            for item in req {
                if let Value::String(prop_name) = item {
                    if !obj.contains_key(prop_name) {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceRequiredMissing,
                            format!("Required property missing: {}", prop_name),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }
        }

        // Validate each property
        for (prop_name, prop_value) in obj {
            let prop_path = format!("{}/{}", path, prop_name);

            if let Some(props) = properties {
                if let Some(prop_schema) = props.get(prop_name) {
                    self.validate_instance(prop_value, prop_schema, root_schema, result, &prop_path, locator, depth + 1);
                } else {
                    // Check additionalProperties
                    match additional_properties {
                        Some(Value::Bool(false)) => {
                            result.add_error(ValidationError::instance_error(
                                InstanceErrorCode::InstanceAdditionalProperty,
                                format!("Additional property not allowed: {}", prop_name),
                                &prop_path,
                                locator.get_location(&prop_path),
                            ));
                        }
                        Some(Value::Object(_)) => {
                            self.validate_instance(prop_value, additional_properties.unwrap(), root_schema, result, &prop_path, locator, depth + 1);
                        }
                        _ => {}
                    }
                }
            }
        }

        // Extended validation
        if self.options.extended {
            // minProperties
            if let Some(Value::Number(n)) = schema_obj.get("minProperties") {
                if let Some(min) = n.as_u64() {
                    if obj.len() < min as usize {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceTooFewProperties,
                            format!("Object has {} properties, minimum is {}", obj.len(), min),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // maxProperties
            if let Some(Value::Number(n)) = schema_obj.get("maxProperties") {
                if let Some(max) = n.as_u64() {
                    if obj.len() > max as usize {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceTooManyProperties,
                            format!("Object has {} properties, maximum is {}", obj.len(), max),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // dependentRequired
            if let Some(Value::Object(deps)) = schema_obj.get("dependentRequired") {
                for (prop, required_props) in deps {
                    if obj.contains_key(prop) {
                        if let Value::Array(req) = required_props {
                            for req_prop in req {
                                if let Value::String(req_name) = req_prop {
                                    if !obj.contains_key(req_name) {
                                        result.add_error(ValidationError::instance_error(
                                            InstanceErrorCode::InstanceDependentRequiredMissing,
                                            format!("Property '{}' requires '{}' to be present", prop, req_name),
                                            path,
                                            locator.get_location(path),
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fn validate_array(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        depth: usize,
    ) {
        let arr = match instance {
            Value::Array(a) => a,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceArrayExpected,
                    "Expected array",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        // Validate items
        if let Some(items_schema) = schema_obj.get("items") {
            for (i, item) in arr.iter().enumerate() {
                let item_path = format!("{}/{}", path, i);
                self.validate_instance(item, items_schema, root_schema, result, &item_path, locator, depth + 1);
            }
        }

        if self.options.extended {
            // minItems
            if let Some(Value::Number(n)) = schema_obj.get("minItems") {
                if let Some(min) = n.as_u64() {
                    if arr.len() < min as usize {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceArrayTooShort,
                            format!("Array length {} is less than minimum {}", arr.len(), min),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // maxItems
            if let Some(Value::Number(n)) = schema_obj.get("maxItems") {
                if let Some(max) = n.as_u64() {
                    if arr.len() > max as usize {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceArrayTooLong,
                            format!("Array length {} is greater than maximum {}", arr.len(), max),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // contains / minContains / maxContains
            if let Some(contains_schema) = schema_obj.get("contains") {
                let mut match_count = 0;
                for item in arr.iter() {
                    let mut temp_result = ValidationResult::new();
                    self.validate_instance(item, contains_schema, root_schema, &mut temp_result, path, locator, depth + 1);
                    if temp_result.is_valid() {
                        match_count += 1;
                    }
                }

                let min_contains = schema_obj.get("minContains")
                    .and_then(Value::as_u64)
                    .unwrap_or(1);
                let max_contains = schema_obj.get("maxContains")
                    .and_then(Value::as_u64);

                if match_count < min_contains as usize {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceArrayContainsTooFew,
                        format!("Array contains {} matching items, minimum is {}", match_count, min_contains),
                        path,
                        locator.get_location(path),
                    ));
                }

                if let Some(max) = max_contains {
                    if match_count > max as usize {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceArrayContainsTooMany,
                            format!("Array contains {} matching items, maximum is {}", match_count, max),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }
        }
    }

    fn validate_set(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        depth: usize,
    ) {
        let arr = match instance {
            Value::Array(a) => a,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceSetExpected,
                    "Expected array (set)",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        // Check for uniqueness
        let mut seen = Vec::new();
        for (i, item) in arr.iter().enumerate() {
            let item_str = item.to_string();
            if seen.contains(&item_str) {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceSetNotUnique,
                    "Set contains duplicate values",
                    &format!("{}/{}", path, i),
                    locator.get_location(&format!("{}/{}", path, i)),
                ));
            } else {
                seen.push(item_str);
            }
        }

        // Validate items
        if let Some(items_schema) = schema_obj.get("items") {
            for (i, item) in arr.iter().enumerate() {
                let item_path = format!("{}/{}", path, i);
                self.validate_instance(item, items_schema, root_schema, result, &item_path, locator, depth + 1);
            }
        }
    }

    fn validate_map(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        depth: usize,
    ) {
        let obj = match instance {
            Value::Object(o) => o,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceMapExpected,
                    "Expected object (map)",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        // Validate values
        if let Some(values_schema) = schema_obj.get("values") {
            for (key, value) in obj.iter() {
                let value_path = format!("{}/{}", path, key);
                self.validate_instance(value, values_schema, root_schema, result, &value_path, locator, depth + 1);
            }
        }

        // Extended validation
        if self.options.extended {
            // minEntries
            if let Some(Value::Number(n)) = schema_obj.get("minEntries") {
                if let Some(min) = n.as_u64() {
                    if obj.len() < min as usize {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceMapTooFewEntries,
                            format!("Map has {} entries, minimum is {}", obj.len(), min),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // maxEntries
            if let Some(Value::Number(n)) = schema_obj.get("maxEntries") {
                if let Some(max) = n.as_u64() {
                    if obj.len() > max as usize {
                        result.add_error(ValidationError::instance_error(
                            InstanceErrorCode::InstanceMapTooManyEntries,
                            format!("Map has {} entries, maximum is {}", obj.len(), max),
                            path,
                            locator.get_location(path),
                        ));
                    }
                }
            }

            // keyNames - validate key patterns
            if let Some(keynames_schema) = schema_obj.get("keyNames") {
                if let Some(keynames_obj) = keynames_schema.as_object() {
                    if let Some(Value::String(pattern)) = keynames_obj.get("pattern") {
                        if let Ok(re) = Regex::new(pattern) {
                            for key in obj.keys() {
                                if !re.is_match(key) {
                                    result.add_error(ValidationError::instance_error(
                                        InstanceErrorCode::InstanceMapKeyPatternMismatch,
                                        format!("Map key '{}' does not match pattern '{}'", key, pattern),
                                        path,
                                        locator.get_location(path),
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fn validate_tuple(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        depth: usize,
    ) {
        let arr = match instance {
            Value::Array(a) => a,
            _ => {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceTupleExpected,
                    "Expected array (tuple)",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        };

        let properties = schema_obj.get("properties").and_then(Value::as_object);
        let tuple_order = schema_obj.get("tuple").and_then(Value::as_array);

        if let (Some(props), Some(order)) = (properties, tuple_order) {
            // Check length
            if arr.len() != order.len() {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceTupleLengthMismatch,
                    format!("Tuple length {} does not match expected {}", arr.len(), order.len()),
                    path,
                    locator.get_location(path),
                ));
                return;
            }

            // Validate each element
            for (i, prop_name_val) in order.iter().enumerate() {
                if let Value::String(prop_name) = prop_name_val {
                    if let Some(prop_schema) = props.get(prop_name) {
                        let elem_path = format!("{}/{}", path, i);
                        self.validate_instance(&arr[i], prop_schema, root_schema, result, &elem_path, locator, depth + 1);
                    }
                }
            }
        }
    }

    fn validate_choice(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        depth: usize,
    ) {
        let choices = match schema_obj.get("choices").and_then(Value::as_object) {
            Some(c) => c,
            None => return,
        };

        let selector = schema_obj.get("selector").and_then(Value::as_str);

        if let Some(selector_prop) = selector {
            // Discriminated choice
            let obj = match instance {
                Value::Object(o) => o,
                _ => {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceObjectExpected,
                        "Choice with selector expects object",
                        path,
                        locator.get_location(path),
                    ));
                    return;
                }
            };

            let selector_value = match obj.get(selector_prop) {
                Some(Value::String(s)) => s.as_str(),
                Some(_) => {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceChoiceSelectorInvalid,
                        format!("Selector property '{}' must be a string", selector_prop),
                        &format!("{}/{}", path, selector_prop),
                        locator.get_location(&format!("{}/{}", path, selector_prop)),
                    ));
                    return;
                }
                None => {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceChoiceSelectorMissing,
                        format!("Missing selector property: {}", selector_prop),
                        path,
                        locator.get_location(path),
                    ));
                    return;
                }
            };

            if let Some(choice_schema) = choices.get(selector_value) {
                self.validate_instance(instance, choice_schema, root_schema, result, path, locator, depth + 1);
            } else {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceChoiceUnknown,
                    format!("Unknown choice: {}", selector_value),
                    path,
                    locator.get_location(path),
                ));
            }
        } else {
            // Tagged choice (no selector) - instance should be an object with one property
            // matching a choice name, e.g., {"creditCard": {...}}
            let obj = match instance {
                Value::Object(o) => o,
                _ => {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceChoiceNoMatch,
                        "Value does not match any choice option",
                        path,
                        locator.get_location(path),
                    ));
                    return;
                }
            };

            // Check if it's a tagged union (object with exactly one property matching a choice)
            if obj.len() == 1 {
                let (tag, value) = obj.iter().next().unwrap();
                if let Some(choice_schema) = choices.get(tag) {
                    // Validate the wrapped value against the choice schema
                    let value_path = format!("{}/{}", path, tag);
                    self.validate_instance(value, choice_schema, root_schema, result, &value_path, locator, depth + 1);
                    return;
                }
            }

            // If not a tagged union, try untagged choice - try to match one
            let mut match_count = 0;

            for (_choice_name, choice_schema) in choices {
                let mut choice_result = ValidationResult::new();
                self.validate_instance(instance, choice_schema, root_schema, &mut choice_result, path, locator, depth + 1);
                if choice_result.is_valid() {
                    match_count += 1;
                }
            }

            if match_count == 0 {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceChoiceNoMatch,
                    "Value does not match any choice option",
                    path,
                    locator.get_location(path),
                ));
            } else if match_count > 1 {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceChoiceMultipleMatches,
                    format!("Value matches {} choice options (should match exactly one)", match_count),
                    path,
                    locator.get_location(path),
                ));
            }
        }
    }

    // ===== Composition validators =====

    fn validate_composition(
        &self,
        instance: &Value,
        schema_obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        result: &mut ValidationResult,
        path: &str,
        locator: &JsonSourceLocator,
        depth: usize,
    ) {
        // allOf
        if let Some(Value::Array(schemas)) = schema_obj.get("allOf") {
            for schema in schemas {
                let mut sub_result = ValidationResult::new();
                self.validate_instance(instance, schema, root_schema, &mut sub_result, path, locator, depth + 1);
                if !sub_result.is_valid() {
                    result.add_error(ValidationError::instance_error(
                        InstanceErrorCode::InstanceAllOfFailed,
                        "Value does not match all schemas in allOf",
                        path,
                        locator.get_location(path),
                    ));
                    result.add_errors(sub_result.all_errors().iter().cloned());
                    return;
                }
            }
        }

        // anyOf
        if let Some(Value::Array(schemas)) = schema_obj.get("anyOf") {
            let mut any_valid = false;
            for schema in schemas {
                let mut sub_result = ValidationResult::new();
                self.validate_instance(instance, schema, root_schema, &mut sub_result, path, locator, depth + 1);
                if sub_result.is_valid() {
                    any_valid = true;
                    break;
                }
            }
            if !any_valid {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceAnyOfFailed,
                    "Value does not match any schema in anyOf",
                    path,
                    locator.get_location(path),
                ));
            }
        }

        // oneOf
        if let Some(Value::Array(schemas)) = schema_obj.get("oneOf") {
            let mut match_count = 0;
            for schema in schemas {
                let mut sub_result = ValidationResult::new();
                self.validate_instance(instance, schema, root_schema, &mut sub_result, path, locator, depth + 1);
                if sub_result.is_valid() {
                    match_count += 1;
                }
            }
            if match_count == 0 {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceOneOfFailed,
                    "Value does not match any schema in oneOf",
                    path,
                    locator.get_location(path),
                ));
            } else if match_count > 1 {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceOneOfMultiple,
                    format!("Value matches {} schemas in oneOf (should match exactly one)", match_count),
                    path,
                    locator.get_location(path),
                ));
            }
        }

        // not
        if let Some(not_schema) = schema_obj.get("not") {
            let mut sub_result = ValidationResult::new();
            self.validate_instance(instance, not_schema, root_schema, &mut sub_result, path, locator, depth + 1);
            if sub_result.is_valid() {
                result.add_error(ValidationError::instance_error(
                    InstanceErrorCode::InstanceNotFailed,
                    "Value should not match the schema in 'not'",
                    path,
                    locator.get_location(path),
                ));
            }
        }

        // if/then/else
        if let Some(if_schema) = schema_obj.get("if") {
            let mut if_result = ValidationResult::new();
            self.validate_instance(instance, if_schema, root_schema, &mut if_result, path, locator, depth + 1);
            
            if if_result.is_valid() {
                if let Some(then_schema) = schema_obj.get("then") {
                    self.validate_instance(instance, then_schema, root_schema, result, path, locator, depth + 1);
                }
            } else if let Some(else_schema) = schema_obj.get("else") {
                self.validate_instance(instance, else_schema, root_schema, result, path, locator, depth + 1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_schema(type_name: &str) -> Value {
        serde_json::json!({
            "$id": "https://example.com/test",
            "name": "Test",
            "type": type_name
        })
    }

    #[test]
    fn test_string_valid() {
        let validator = InstanceValidator::new();
        let schema = make_schema("string");
        let result = validator.validate(r#""hello""#, &schema);
        assert!(result.is_valid());
    }

    #[test]
    fn test_string_invalid() {
        let validator = InstanceValidator::new();
        let schema = make_schema("string");
        let result = validator.validate("123", &schema);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_boolean_valid() {
        let validator = InstanceValidator::new();
        let schema = make_schema("boolean");
        let result = validator.validate("true", &schema);
        assert!(result.is_valid());
    }

    #[test]
    fn test_int32_valid() {
        let validator = InstanceValidator::new();
        let schema = make_schema("int32");
        let result = validator.validate("42", &schema);
        assert!(result.is_valid());
    }

    #[test]
    fn test_object_valid() {
        let validator = InstanceValidator::new();
        let schema = serde_json::json!({
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "object",
            "properties": {
                "name": { "type": "string" }
            },
            "required": ["name"]
        });
        let result = validator.validate(r#"{"name": "test"}"#, &schema);
        assert!(result.is_valid());
    }

    #[test]
    fn test_object_missing_required() {
        let validator = InstanceValidator::new();
        let schema = serde_json::json!({
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "object",
            "properties": {
                "name": { "type": "string" }
            },
            "required": ["name"]
        });
        let result = validator.validate(r#"{}"#, &schema);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_array_valid() {
        let validator = InstanceValidator::new();
        let schema = serde_json::json!({
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "array",
            "items": { "type": "int32" }
        });
        let result = validator.validate("[1, 2, 3]", &schema);
        assert!(result.is_valid());
    }

    #[test]
    fn test_enum_valid() {
        let validator = InstanceValidator::new();
        let schema = serde_json::json!({
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "string",
            "enum": ["a", "b", "c"]
        });
        let result = validator.validate(r#""b""#, &schema);
        assert!(result.is_valid());
    }

    #[test]
    fn test_enum_invalid() {
        let validator = InstanceValidator::new();
        let schema = serde_json::json!({
            "$id": "https://example.com/test",
            "name": "Test",
            "type": "string",
            "enum": ["a", "b", "c"]
        });
        let result = validator.validate(r#""d""#, &schema);
        assert!(!result.is_valid());
    }
}
