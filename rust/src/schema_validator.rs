//! Schema validator for JSON Structure schemas.
//!
//! Validates that JSON Structure schema documents are syntactically and semantically correct.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::error_codes::SchemaErrorCode;
use crate::json_source_locator::JsonSourceLocator;
use crate::types::{
    is_valid_type, JsonLocation, SchemaValidatorOptions, ValidationError, ValidationResult,
    COMPOSITION_KEYWORDS, KNOWN_EXTENSIONS, VALIDATION_EXTENSION_KEYWORDS,
};

/// Validates JSON Structure schema documents.
///
/// # Example
///
/// ```
/// use json_structure::SchemaValidator;
///
/// let validator = SchemaValidator::new();
/// let result = validator.validate(r#"{"$id": "test", "name": "Test", "type": "string"}"#);
/// assert!(result.is_valid());
/// ```
pub struct SchemaValidator {
    options: SchemaValidatorOptions,
    #[allow(dead_code)]
    external_schemas: HashMap<String, Value>,
}

impl Default for SchemaValidator {
    fn default() -> Self {
        Self::new()
    }
}

impl SchemaValidator {
    /// Creates a new schema validator with default options.
    #[must_use]
    pub fn new() -> Self {
        Self::with_options(SchemaValidatorOptions::default())
    }

    /// Creates a new schema validator with the given options.
    #[must_use]
    pub fn with_options(options: SchemaValidatorOptions) -> Self {
        let mut external_schemas = HashMap::new();
        for schema in &options.external_schemas {
            if let Some(id) = schema.get("$id").and_then(Value::as_str) {
                external_schemas.insert(id.to_string(), schema.clone());
            }
        }
        Self {
            options,
            external_schemas,
        }
    }

    /// Enables or disables extended validation mode.
    /// Note: Schema validation always validates extended keywords; this is a placeholder for API consistency.
    pub fn set_extended(&mut self, _extended: bool) {
        // Schema validation always includes extended keyword validation
    }

    /// Returns whether extended validation is enabled.
    /// Note: Schema validation always validates extended keywords.
    pub fn is_extended(&self) -> bool {
        true // Schema validation always includes extended keyword validation
    }

    /// Enables or disables warnings for extension keywords without $uses.
    pub fn set_warn_on_extension_keywords(&mut self, warn: bool) {
        self.options.warn_on_unused_extension_keywords = warn;
    }

    /// Returns whether warnings are enabled for extension keywords.
    pub fn is_warn_on_extension_keywords(&self) -> bool {
        self.options.warn_on_unused_extension_keywords
    }

    /// Validates a JSON Structure schema from a string.
    ///
    /// Returns a [`ValidationResult`] that should be checked with [`is_valid()`](ValidationResult::is_valid).
    #[must_use]
    pub fn validate(&self, schema_json: &str) -> ValidationResult {
        let mut result = ValidationResult::new();
        let locator = JsonSourceLocator::new(schema_json);

        match serde_json::from_str::<Value>(schema_json) {
            Ok(schema) => {
                self.validate_schema_internal(&schema, &schema, &locator, &mut result, "", true, &mut HashSet::new(), 0);
            }
            Err(e) => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaInvalidType,
                    format!("Failed to parse JSON: {}", e),
                    "",
                    JsonLocation::unknown(),
                ));
            }
        }

        result
    }

    /// Validates a JSON Structure schema from a parsed Value.
    ///
    /// Returns a [`ValidationResult`] that should be checked with [`is_valid()`](ValidationResult::is_valid).
    #[must_use]
    pub fn validate_value(&self, schema: &Value, schema_json: &str) -> ValidationResult {
        let mut result = ValidationResult::new();
        let locator = JsonSourceLocator::new(schema_json);
        self.validate_schema_internal(schema, schema, &locator, &mut result, "", true, &mut HashSet::new(), 0);
        result
    }

    /// Validates a schema node (internal helper that uses a separate root_schema).
    fn validate_schema(
        &self,
        schema: &Value,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        is_root: bool,
        visited_refs: &mut HashSet<String>,
        depth: usize,
    ) {
        // Pass through to internal method with proper root_schema
        self.validate_schema_internal(schema, root_schema, locator, result, path, is_root, visited_refs, depth);
    }

    /// Internal schema validation with root schema reference.
    fn validate_schema_internal(
        &self,
        schema: &Value,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        is_root: bool,
        visited_refs: &mut HashSet<String>,
        depth: usize,
    ) {
        if depth > self.options.max_validation_depth {
            return;
        }

        // Schema must be an object or boolean
        match schema {
            Value::Null => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaNull,
                    "Schema cannot be null",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
            Value::Bool(_) => {
                // Boolean schemas are valid
                return;
            }
            Value::Object(_obj) => {
                // Continue validation
            }
            _ => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaInvalidType,
                    "Schema must be an object or boolean",
                    path,
                    locator.get_location(path),
                ));
                return;
            }
        }

        let obj = schema.as_object().unwrap();

        // Collect enabled extensions from root schema (extensions are inherited)
        let mut enabled_extensions = HashSet::new();
        if let Some(root_obj) = root_schema.as_object() {
            if let Some(Value::Array(arr)) = root_obj.get("$uses") {
                for ext in arr {
                    if let Value::String(s) = ext {
                        enabled_extensions.insert(s.as_str());
                    }
                }
            }
        }

        // Root schema validation
        if is_root {
            self.validate_root_schema(obj, locator, result, path);
        }

        // Validate $ref if present
        if let Some(ref_val) = obj.get("$ref") {
            self.validate_ref(ref_val, schema, root_schema, locator, result, path, visited_refs, depth);
        }

        // Validate type if present
        if let Some(type_val) = obj.get("type") {
            self.validate_type(type_val, obj, root_schema, locator, result, path, &enabled_extensions, visited_refs, depth);
        }

        // Validate definitions
        if let Some(defs) = obj.get("definitions") {
            self.validate_definitions(defs, root_schema, locator, result, path, visited_refs, depth);
        }

        // Validate enum
        if let Some(enum_val) = obj.get("enum") {
            self.validate_enum(enum_val, locator, result, path);
        }

        // Validate composition keywords
        self.validate_composition(obj, root_schema, locator, result, path, &enabled_extensions, visited_refs, depth);

        // Validate extension keywords without $uses
        if self.options.warn_on_unused_extension_keywords {
            self.check_extension_keywords(obj, locator, result, path, &enabled_extensions);
        }
    }

    /// Validates root schema requirements.
    fn validate_root_schema(
        &self,
        obj: &serde_json::Map<String, Value>,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        // Root must have $id
        if !obj.contains_key("$id") {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaRootMissingId,
                "Root schema must have $id",
                path,
                locator.get_location(path),
            ));
        } else if let Some(id) = obj.get("$id") {
            if !id.is_string() {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaRootMissingId,
                    "$id must be a string",
                    &format!("{}/$id", path),
                    locator.get_location(&format!("{}/$id", path)),
                ));
            }
        }

        // If type is present, name is required
        if obj.contains_key("type") && !obj.contains_key("name") {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaRootMissingName,
                "Root schema with type must have name",
                path,
                locator.get_location(path),
            ));
        }

        // Root must have type OR $root OR definitions OR composition keyword
        let has_type = obj.contains_key("type");
        let has_root = obj.contains_key("$root");
        let has_definitions = obj.contains_key("definitions");
        let has_composition = obj.keys().any(|k| 
            ["allOf", "anyOf", "oneOf", "not", "if"].contains(&k.as_str())
        );
        
        if !has_type && !has_root && !has_composition {
            // Check if it has only meta keywords + definitions
            let has_only_meta = obj.keys().all(|k| {
                k.starts_with('$') || k == "definitions" || k == "name" || k == "description"
            });
            
            if !has_only_meta || !has_definitions {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaRootMissingType,
                    "Schema must have a 'type' property or '$root' reference",
                    path,
                    locator.get_location(path),
                ));
            }
        }

        // Validate $uses
        if let Some(uses) = obj.get("$uses") {
            self.validate_uses(uses, locator, result, path);
        }

        // Validate $offers
        if let Some(offers) = obj.get("$offers") {
            self.validate_offers(offers, locator, result, path);
        }
    }

    /// Validates $uses keyword.
    fn validate_uses(
        &self,
        uses: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        let uses_path = format!("{}/$uses", path);
        match uses {
            Value::Array(arr) => {
                for (i, ext) in arr.iter().enumerate() {
                    if let Value::String(s) = ext {
                        if !KNOWN_EXTENSIONS.contains(&s.as_str()) {
                            result.add_error(ValidationError::schema_warning(
                                SchemaErrorCode::SchemaUsesInvalidExtension,
                                format!("Unknown extension: {}", s),
                                &format!("{}/{}", uses_path, i),
                                locator.get_location(&format!("{}/{}", uses_path, i)),
                            ));
                        }
                    } else {
                        result.add_error(ValidationError::schema_error(
                            SchemaErrorCode::SchemaUsesInvalidExtension,
                            "Extension name must be a string",
                            &format!("{}/{}", uses_path, i),
                            locator.get_location(&format!("{}/{}", uses_path, i)),
                        ));
                    }
                }
            }
            _ => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaUsesNotArray,
                    "$uses must be an array",
                    &uses_path,
                    locator.get_location(&uses_path),
                ));
            }
        }
    }

    /// Validates $offers keyword.
    fn validate_offers(
        &self,
        offers: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        let offers_path = format!("{}/$offers", path);
        match offers {
            Value::Array(arr) => {
                for (i, ext) in arr.iter().enumerate() {
                    if !ext.is_string() {
                        result.add_error(ValidationError::schema_error(
                            SchemaErrorCode::SchemaOffersInvalidExtension,
                            "Extension name must be a string",
                            &format!("{}/{}", offers_path, i),
                            locator.get_location(&format!("{}/{}", offers_path, i)),
                        ));
                    }
                }
            }
            _ => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaOffersNotArray,
                    "$offers must be an array",
                    &offers_path,
                    locator.get_location(&offers_path),
                ));
            }
        }
    }

    /// Validates a $ref reference.
    fn validate_ref(
        &self,
        ref_val: &Value,
        _schema: &Value,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        visited_refs: &mut HashSet<String>,
        _depth: usize,
    ) {
        let ref_path = format!("{}/$ref", path);

        match ref_val {
            Value::String(ref_str) => {
                // Check for circular reference
                if visited_refs.contains(ref_str) {
                    result.add_error(ValidationError::schema_error(
                        SchemaErrorCode::SchemaRefCircular,
                        format!("Circular reference detected: {}", ref_str),
                        &ref_path,
                        locator.get_location(&ref_path),
                    ));
                    return;
                }

                // Validate reference format
                if ref_str.starts_with("#/definitions/") {
                    // Local definition reference - resolve from root schema
                    if let Some(resolved) = self.resolve_ref(ref_str, root_schema) {
                        // Check for direct circular reference (definition is only a $ref to itself)
                        if let Value::Object(def_obj) = resolved {
                            let keys: Vec<&String> = def_obj.keys().collect();
                            let is_bare_ref = keys.len() == 1 && keys[0] == "$ref";
                            let is_type_ref_only = keys.len() == 1 && keys[0] == "type" && {
                                if let Some(Value::Object(type_obj)) = def_obj.get("type") {
                                    type_obj.len() == 1 && type_obj.contains_key("$ref")
                                } else {
                                    false
                                }
                            };
                            
                            if is_bare_ref || is_type_ref_only {
                                // Check if it references itself
                                let inner_ref = if is_bare_ref {
                                    def_obj.get("$ref").and_then(|v| v.as_str())
                                } else if is_type_ref_only {
                                    def_obj.get("type")
                                        .and_then(|t| t.as_object())
                                        .and_then(|o| o.get("$ref"))
                                        .and_then(|v| v.as_str())
                                } else {
                                    None
                                };
                                
                                if inner_ref == Some(ref_str) {
                                    result.add_error(ValidationError::schema_error(
                                        SchemaErrorCode::SchemaRefCircular,
                                        format!("Direct circular reference: {}", ref_str),
                                        &ref_path,
                                        locator.get_location(&ref_path),
                                    ));
                                }
                            }
                        }
                    } else {
                        result.add_error(ValidationError::schema_error(
                            SchemaErrorCode::SchemaRefNotFound,
                            format!("Reference not found: {}", ref_str),
                            &ref_path,
                            locator.get_location(&ref_path),
                        ));
                    }
                }
                // External references would be validated here if import is enabled
            }
            _ => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaRefNotString,
                    "$ref must be a string",
                    &ref_path,
                    locator.get_location(&ref_path),
                ));
            }
        }
    }

    /// Resolves a $ref reference to its target definition.
    fn resolve_ref<'a>(&self, ref_str: &str, root_schema: &'a Value) -> Option<&'a Value> {
        if !ref_str.starts_with("#/") {
            return None;
        }
        
        let path_parts: Vec<&str> = ref_str[2..].split('/').collect();
        let mut current = root_schema;
        
        for part in path_parts {
            // Handle JSON Pointer escaping
            let unescaped = part.replace("~1", "/").replace("~0", "~");
            current = current.get(&unescaped)?;
        }
        
        Some(current)
    }

    /// Validates the type keyword and type-specific requirements.
    fn validate_type(
        &self,
        type_val: &Value,
        obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        enabled_extensions: &HashSet<&str>,
        visited_refs: &mut HashSet<String>,
        depth: usize,
    ) {
        let type_path = format!("{}/type", path);

        match type_val {
            Value::String(type_name) => {
                self.validate_single_type(type_name, obj, root_schema, locator, result, path, enabled_extensions, depth);
            }
            Value::Array(types) => {
                // Union type: ["string", "null"] or [{"$ref": "..."}, "null"]
                if types.is_empty() {
                    result.add_error(ValidationError::schema_error(
                        SchemaErrorCode::SchemaTypeArrayEmpty,
                        "Union type array cannot be empty",
                        &type_path,
                        locator.get_location(&type_path),
                    ));
                    return;
                }
                for (i, t) in types.iter().enumerate() {
                    let elem_path = format!("{}/{}", type_path, i);
                    match t {
                        Value::String(s) => {
                            if !is_valid_type(s) {
                                result.add_error(ValidationError::schema_error(
                                    SchemaErrorCode::SchemaTypeInvalid,
                                    format!("Unknown type in union: '{}'", s),
                                    &elem_path,
                                    locator.get_location(&elem_path),
                                ));
                            }
                        }
                        Value::Object(ref_obj) => {
                            if let Some(ref_val) = ref_obj.get("$ref") {
                                if let Value::String(ref_str) = ref_val {
                                    // Validate the ref exists
                                    self.validate_type_ref(ref_str, root_schema, locator, result, &elem_path, visited_refs);
                                } else {
                                    result.add_error(ValidationError::schema_error(
                                        SchemaErrorCode::SchemaRefNotString,
                                        "$ref must be a string",
                                        &format!("{}/$ref", elem_path),
                                        locator.get_location(&format!("{}/$ref", elem_path)),
                                    ));
                                }
                            } else {
                                result.add_error(ValidationError::schema_error(
                                    SchemaErrorCode::SchemaTypeObjectMissingRef,
                                    "Union type object must have $ref",
                                    &elem_path,
                                    locator.get_location(&elem_path),
                                ));
                            }
                        }
                        _ => {
                            result.add_error(ValidationError::schema_error(
                                SchemaErrorCode::SchemaKeywordInvalidType,
                                "Union type elements must be strings or $ref objects",
                                &elem_path,
                                locator.get_location(&elem_path),
                            ));
                        }
                    }
                }
            }
            Value::Object(ref_obj) => {
                // Type can be an object with $ref
                if let Some(ref_val) = ref_obj.get("$ref") {
                    if let Value::String(ref_str) = ref_val {
                        // Validate the ref exists
                        self.validate_type_ref(ref_str, root_schema, locator, result, path, visited_refs);
                    } else {
                        result.add_error(ValidationError::schema_error(
                            SchemaErrorCode::SchemaRefNotString,
                            "$ref must be a string",
                            &format!("{}/$ref", type_path),
                            locator.get_location(&format!("{}/$ref", type_path)),
                        ));
                    }
                } else {
                    result.add_error(ValidationError::schema_error(
                        SchemaErrorCode::SchemaTypeObjectMissingRef,
                        "type object must have $ref",
                        &type_path,
                        locator.get_location(&type_path),
                    ));
                }
            }
            _ => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaKeywordInvalidType,
                    "type must be a string, array, or object with $ref",
                    &type_path,
                    locator.get_location(&type_path),
                ));
            }
        }
    }

    /// Validates a $ref inside a type attribute.
    fn validate_type_ref(
        &self,
        ref_str: &str,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        visited_refs: &mut HashSet<String>,
    ) {
        let ref_path = format!("{}/type/$ref", path);
        
        if ref_str.starts_with("#/definitions/") {
            // Check for circular reference
            if visited_refs.contains(ref_str) {
                // Check if it's a direct circular reference
                if let Some(resolved) = self.resolve_ref(ref_str, root_schema) {
                    if let Value::Object(def_obj) = resolved {
                        let keys: Vec<&String> = def_obj.keys().collect();
                        let is_type_ref_only = keys.len() == 1 && keys[0] == "type" && {
                            if let Some(Value::Object(type_obj)) = def_obj.get("type") {
                                type_obj.len() == 1 && type_obj.contains_key("$ref")
                            } else {
                                false
                            }
                        };
                        
                        if is_type_ref_only {
                            result.add_error(ValidationError::schema_error(
                                SchemaErrorCode::SchemaRefCircular,
                                format!("Direct circular reference: {}", ref_str),
                                &ref_path,
                                locator.get_location(&ref_path),
                            ));
                        }
                    }
                }
                return;
            }

            // Track this ref
            visited_refs.insert(ref_str.to_string());
            
            // Resolve and validate
            if let Some(resolved) = self.resolve_ref(ref_str, root_schema) {
                // Check if the resolved schema itself has a type with $ref (for circular detection)
                if let Value::Object(def_obj) = resolved {
                    if let Some(type_val) = def_obj.get("type") {
                        if let Value::Object(type_obj) = type_val {
                            if let Some(Value::String(inner_ref)) = type_obj.get("$ref") {
                                self.validate_type_ref(inner_ref, root_schema, locator, result, path, visited_refs);
                            }
                        }
                    }
                }
            } else {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaRefNotFound,
                    format!("Reference not found: {}", ref_str),
                    &ref_path,
                    locator.get_location(&ref_path),
                ));
            }
            
            visited_refs.remove(ref_str);
        }
    }

    /// Validates a single type name.
    fn validate_single_type(
        &self,
        type_name: &str,
        obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        enabled_extensions: &HashSet<&str>,
        depth: usize,
    ) {
        let type_path = format!("{}/type", path);
        
        // Validate type name
        if !is_valid_type(type_name) {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaTypeInvalid,
                format!("Invalid type: {}", type_name),
                &type_path,
                locator.get_location(&type_path),
            ));
            return;
        }

        // Type-specific validation
        match type_name {
            "object" => self.validate_object_type(obj, root_schema, locator, result, path, enabled_extensions, depth),
            "array" | "set" => self.validate_array_type(obj, root_schema, locator, result, path, type_name),
            "map" => self.validate_map_type(obj, root_schema, locator, result, path),
            "tuple" => self.validate_tuple_type(obj, root_schema, locator, result, path),
            "choice" => self.validate_choice_type(obj, root_schema, locator, result, path),
            _ => {
                // Validate extended constraints for primitive types
                self.validate_primitive_constraints(type_name, obj, locator, result, path);
            }
        }
    }

    /// Validates primitive type constraints.
    fn validate_primitive_constraints(
        &self,
        type_name: &str,
        obj: &serde_json::Map<String, Value>,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        use crate::types::is_numeric_type;

        // Check for type-constraint mismatches
        let is_numeric = is_numeric_type(type_name);
        let is_string = type_name == "string";

        // minimum/maximum only apply to numeric types
        if obj.contains_key("minimum") && !is_numeric {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaConstraintTypeMismatch,
                format!("minimum constraint cannot be used with type '{}'", type_name),
                &format!("{}/minimum", path),
                locator.get_location(&format!("{}/minimum", path)),
            ));
        }
        if obj.contains_key("maximum") && !is_numeric {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaConstraintTypeMismatch,
                format!("maximum constraint cannot be used with type '{}'", type_name),
                &format!("{}/maximum", path),
                locator.get_location(&format!("{}/maximum", path)),
            ));
        }

        // minLength/maxLength only apply to string
        if obj.contains_key("minLength") && !is_string {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaConstraintTypeMismatch,
                format!("minLength constraint cannot be used with type '{}'", type_name),
                &format!("{}/minLength", path),
                locator.get_location(&format!("{}/minLength", path)),
            ));
        }
        if obj.contains_key("maxLength") && !is_string {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaConstraintTypeMismatch,
                format!("maxLength constraint cannot be used with type '{}'", type_name),
                &format!("{}/maxLength", path),
                locator.get_location(&format!("{}/maxLength", path)),
            ));
        }

        // Validate numeric constraint values
        if is_numeric {
            self.validate_numeric_constraints(obj, locator, result, path);
        }

        // Validate string constraint values
        if is_string {
            self.validate_string_constraints(obj, locator, result, path);
        }

        // multipleOf only applies to numeric types
        if let Some(multiple_of) = obj.get("multipleOf") {
            if !is_numeric {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaConstraintTypeMismatch,
                    format!("multipleOf constraint cannot be used with type '{}'", type_name),
                    &format!("{}/multipleOf", path),
                    locator.get_location(&format!("{}/multipleOf", path)),
                ));
            } else if let Some(n) = multiple_of.as_f64() {
                if n <= 0.0 {
                    result.add_error(ValidationError::schema_error(
                        SchemaErrorCode::SchemaMultipleOfInvalid,
                        "multipleOf must be greater than 0",
                        &format!("{}/multipleOf", path),
                        locator.get_location(&format!("{}/multipleOf", path)),
                    ));
                }
            }
        }

        // Validate pattern regex
        if let Some(Value::String(pattern)) = obj.get("pattern") {
            if regex::Regex::new(pattern).is_err() {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaPatternInvalid,
                    format!("Invalid regular expression pattern: {}", pattern),
                    &format!("{}/pattern", path),
                    locator.get_location(&format!("{}/pattern", path)),
                ));
            }
        }
    }

    /// Validates numeric constraints (minimum/maximum relationships).
    fn validate_numeric_constraints(
        &self,
        obj: &serde_json::Map<String, Value>,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        let minimum = obj.get("minimum").and_then(Value::as_f64);
        let maximum = obj.get("maximum").and_then(Value::as_f64);
        
        if let (Some(min), Some(max)) = (minimum, maximum) {
            if min > max {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaMinimumExceedsMaximum,
                    format!("minimum ({}) exceeds maximum ({})", min, max),
                    &format!("{}/minimum", path),
                    locator.get_location(&format!("{}/minimum", path)),
                ));
            }
        }
    }

    /// Validates string constraints (minLength/maxLength relationships).
    fn validate_string_constraints(
        &self,
        obj: &serde_json::Map<String, Value>,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        let min_length = obj.get("minLength").and_then(Value::as_i64);
        let max_length = obj.get("maxLength").and_then(Value::as_i64);

        if let Some(min) = min_length {
            if min < 0 {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaMinLengthNegative,
                    "minLength cannot be negative",
                    &format!("{}/minLength", path),
                    locator.get_location(&format!("{}/minLength", path)),
                ));
            }
        }

        if let Some(max) = max_length {
            if max < 0 {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaMaxLengthNegative,
                    "maxLength cannot be negative",
                    &format!("{}/maxLength", path),
                    locator.get_location(&format!("{}/maxLength", path)),
                ));
            }
        }

        if let (Some(min), Some(max)) = (min_length, max_length) {
            if min > max {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaMinLengthExceedsMaxLength,
                    format!("minLength ({}) exceeds maxLength ({})", min, max),
                    &format!("{}/minLength", path),
                    locator.get_location(&format!("{}/minLength", path)),
                ));
            }
        }
    }

    /// Validates object type requirements.
    fn validate_object_type(
        &self,
        obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        _enabled_extensions: &HashSet<&str>,
        depth: usize,
    ) {
        // Validate properties
        if let Some(props) = obj.get("properties") {
            let props_path = format!("{}/properties", path);
            match props {
                Value::Object(props_obj) => {
                    for (prop_name, prop_schema) in props_obj {
                        let prop_path = format!("{}/{}", props_path, prop_name);
                        self.validate_schema(
                            prop_schema,
                            root_schema,
                            locator,
                            result,
                            &prop_path,
                            false,
                            &mut HashSet::new(),
                            depth + 1,
                        );
                    }
                }
                _ => {
                    result.add_error(ValidationError::schema_error(
                        SchemaErrorCode::SchemaPropertiesMustBeObject,
                        "properties must be an object",
                        &props_path,
                        locator.get_location(&props_path),
                    ));
                }
            }
        }

        // Validate required
        if let Some(required) = obj.get("required") {
            self.validate_required(required, obj.get("properties"), locator, result, path);
        }

        // Validate additionalProperties
        if let Some(additional) = obj.get("additionalProperties") {
            let add_path = format!("{}/additionalProperties", path);
            match additional {
                Value::Bool(_) => {}
                Value::Object(_) => {
                    self.validate_schema(
                        additional,
                        root_schema,
                        locator,
                        result,
                        &add_path,
                        false,
                        &mut HashSet::new(),
                        depth + 1,
                    );
                }
                _ => {
                    result.add_error(ValidationError::schema_error(
                        SchemaErrorCode::SchemaAdditionalPropertiesInvalid,
                        "additionalProperties must be a boolean or schema object",
                        &add_path,
                        locator.get_location(&add_path),
                    ));
                }
            }
        }
    }

    /// Validates required keyword.
    fn validate_required(
        &self,
        required: &Value,
        properties: Option<&Value>,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        let required_path = format!("{}/required", path);

        match required {
            Value::Array(arr) => {
                let mut seen = HashSet::new();
                for (i, item) in arr.iter().enumerate() {
                    match item {
                        Value::String(s) => {
                            // Check for duplicates
                            if !seen.insert(s.clone()) {
                                result.add_error(ValidationError::schema_warning(
                                    SchemaErrorCode::SchemaRequiredPropertyNotDefined,
                                    format!("Duplicate required property: {}", s),
                                    &format!("{}/{}", required_path, i),
                                    locator.get_location(&format!("{}/{}", required_path, i)),
                                ));
                            }

                            // Check if property exists
                            if let Some(Value::Object(props)) = properties {
                                if !props.contains_key(s) {
                                    result.add_error(ValidationError::schema_error(
                                        SchemaErrorCode::SchemaRequiredPropertyNotDefined,
                                        format!("Required property not defined: {}", s),
                                        &format!("{}/{}", required_path, i),
                                        locator.get_location(&format!("{}/{}", required_path, i)),
                                    ));
                                }
                            }
                        }
                        _ => {
                            result.add_error(ValidationError::schema_error(
                                SchemaErrorCode::SchemaRequiredItemMustBeString,
                                "Required item must be a string",
                                &format!("{}/{}", required_path, i),
                                locator.get_location(&format!("{}/{}", required_path, i)),
                            ));
                        }
                    }
                }
            }
            _ => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaRequiredMustBeArray,
                    "required must be an array",
                    &required_path,
                    locator.get_location(&required_path),
                ));
            }
        }
    }

    /// Validates array/set type requirements.
    fn validate_array_type(
        &self,
        obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        type_name: &str,
    ) {
        // array and set require items
        if !obj.contains_key("items") {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaArrayMissingItems,
                format!("{} type requires items keyword", type_name),
                path,
                locator.get_location(path),
            ));
        } else if let Some(items) = obj.get("items") {
            let items_path = format!("{}/items", path);
            self.validate_schema(items, root_schema, locator, result, &items_path, false, &mut HashSet::new(), 0);
        }

        // Validate minItems/maxItems constraints
        let min_items = obj.get("minItems").and_then(Value::as_i64);
        let max_items = obj.get("maxItems").and_then(Value::as_i64);

        if let Some(min) = min_items {
            if min < 0 {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaMinItemsNegative,
                    "minItems cannot be negative",
                    &format!("{}/minItems", path),
                    locator.get_location(&format!("{}/minItems", path)),
                ));
            }
        }

        if let (Some(min), Some(max)) = (min_items, max_items) {
            if min > max {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaMinItemsExceedsMaxItems,
                    format!("minItems ({}) exceeds maxItems ({})", min, max),
                    &format!("{}/minItems", path),
                    locator.get_location(&format!("{}/minItems", path)),
                ));
            }
        }
    }

    /// Validates map type requirements.
    fn validate_map_type(
        &self,
        obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        // map requires values
        if !obj.contains_key("values") {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaMapMissingValues,
                "map type requires values keyword",
                path,
                locator.get_location(path),
            ));
        } else if let Some(values) = obj.get("values") {
            let values_path = format!("{}/values", path);
            self.validate_schema(values, root_schema, locator, result, &values_path, false, &mut HashSet::new(), 0);
        }
    }

    /// Validates tuple type requirements.
    fn validate_tuple_type(
        &self,
        obj: &serde_json::Map<String, Value>,
        _root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        // tuple requires properties and tuple keywords
        let has_properties = obj.contains_key("properties");
        let has_tuple = obj.contains_key("tuple");

        if !has_properties || !has_tuple {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaTupleMissingDefinition,
                "tuple type requires both properties and tuple keywords",
                path,
                locator.get_location(path),
            ));
            return;
        }

        // Validate tuple is an array of strings
        if let Some(tuple) = obj.get("tuple") {
            let tuple_path = format!("{}/tuple", path);
            match tuple {
                Value::Array(arr) => {
                    let properties = obj.get("properties").and_then(Value::as_object);
                    
                    for (i, item) in arr.iter().enumerate() {
                        match item {
                            Value::String(s) => {
                                // Check property exists
                                if let Some(props) = properties {
                                    if !props.contains_key(s) {
                                        result.add_error(ValidationError::schema_error(
                                            SchemaErrorCode::SchemaTuplePropertyNotDefined,
                                            format!("Tuple element references undefined property: {}", s),
                                            &format!("{}/{}", tuple_path, i),
                                            locator.get_location(&format!("{}/{}", tuple_path, i)),
                                        ));
                                    }
                                }
                            }
                            _ => {
                                result.add_error(ValidationError::schema_error(
                                    SchemaErrorCode::SchemaTupleInvalidFormat,
                                    "Tuple element must be a string (property name)",
                                    &format!("{}/{}", tuple_path, i),
                                    locator.get_location(&format!("{}/{}", tuple_path, i)),
                                ));
                            }
                        }
                    }
                }
                _ => {
                    result.add_error(ValidationError::schema_error(
                        SchemaErrorCode::SchemaTupleInvalidFormat,
                        "tuple must be an array",
                        &tuple_path,
                        locator.get_location(&tuple_path),
                    ));
                }
            }
        }
    }

    /// Validates choice type requirements.
    fn validate_choice_type(
        &self,
        obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        // choice requires choices keyword
        if !obj.contains_key("choices") {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaChoiceMissingChoices,
                "choice type requires choices keyword",
                path,
                locator.get_location(path),
            ));
            return;
        }

        // Validate choices is an object
        if let Some(choices) = obj.get("choices") {
            let choices_path = format!("{}/choices", path);
            match choices {
                Value::Object(choices_obj) => {
                    for (choice_name, choice_schema) in choices_obj {
                        let choice_path = format!("{}/{}", choices_path, choice_name);
                        self.validate_schema(
                            choice_schema,
                            root_schema,
                            locator,
                            result,
                            &choice_path,
                            false,
                            &mut HashSet::new(),
                            0,
                        );
                    }
                }
                _ => {
                    result.add_error(ValidationError::schema_error(
                        SchemaErrorCode::SchemaChoicesNotObject,
                        "choices must be an object",
                        &choices_path,
                        locator.get_location(&choices_path),
                    ));
                }
            }
        }

        // Validate selector if present
        if let Some(selector) = obj.get("selector") {
            let selector_path = format!("{}/selector", path);
            if !selector.is_string() {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaSelectorNotString,
                    "selector must be a string",
                    &selector_path,
                    locator.get_location(&selector_path),
                ));
            }
        }
    }

    /// Validates definitions.
    fn validate_definitions(
        &self,
        defs: &Value,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        visited_refs: &mut HashSet<String>,
        depth: usize,
    ) {
        let defs_path = format!("{}/definitions", path);

        match defs {
            Value::Object(defs_obj) => {
                for (def_name, def_schema) in defs_obj {
                    let def_path = format!("{}/{}", defs_path, def_name);
                    self.validate_definition_or_namespace(def_schema, root_schema, locator, result, &def_path, visited_refs, depth);
                }
            }
            _ => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaDefinitionsMustBeObject,
                    "definitions must be an object",
                    &defs_path,
                    locator.get_location(&defs_path),
                ));
            }
        }
    }

    /// Validates a definition or namespace (recursive for namespaces).
    fn validate_definition_or_namespace(
        &self,
        def_schema: &Value,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        visited_refs: &mut HashSet<String>,
        depth: usize,
    ) {
        if let Value::Object(def_obj) = def_schema {
            // Empty definitions are invalid
            if def_obj.is_empty() {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaDefinitionMissingType,
                    "Definition must have type, $ref, definitions, or composition",
                    path,
                    locator.get_location(path),
                ));
                return;
            }

            let has_type = def_obj.contains_key("type");
            let has_ref = def_obj.contains_key("$ref");
            let has_definitions = def_obj.contains_key("definitions");
            let has_composition = def_obj.keys().any(|k| 
                ["allOf", "anyOf", "oneOf", "not", "if"].contains(&k.as_str())
            );
            
            if has_type || has_ref || has_definitions || has_composition {
                // This is a type definition - validate it
                self.validate_schema_internal(
                    def_schema,
                    root_schema,
                    locator,
                    result,
                    path,
                    false,
                    visited_refs,
                    depth + 1,
                );
            } else {
                // This might be a namespace - check if all children look like schemas
                // (objects with type, $ref, etc.)
                let is_namespace = def_obj.values().all(|v| {
                    if let Value::Object(child) = v {
                        child.contains_key("type") 
                            || child.contains_key("$ref") 
                            || child.contains_key("definitions")
                            || child.keys().any(|k| ["allOf", "anyOf", "oneOf"].contains(&k.as_str()))
                            || child.values().all(|cv| cv.is_object())  // nested namespace
                    } else {
                        false
                    }
                });
                
                if is_namespace {
                    // Recursively validate as namespace
                    for (child_name, child_schema) in def_obj {
                        let child_path = format!("{}/{}", path, child_name);
                        self.validate_definition_or_namespace(child_schema, root_schema, locator, result, &child_path, visited_refs, depth + 1);
                    }
                } else {
                    // Not a namespace and no type - error
                    result.add_error(ValidationError::schema_error(
                        SchemaErrorCode::SchemaDefinitionMissingType,
                        "Definition must have type, $ref, definitions, or composition",
                        path,
                        locator.get_location(path),
                    ));
                }
            }
        } else {
            result.add_error(ValidationError::schema_error(
                SchemaErrorCode::SchemaDefinitionInvalid,
                "Definition must be an object",
                path,
                locator.get_location(path),
            ));
        }
    }

    /// Validates enum keyword.
    fn validate_enum(
        &self,
        enum_val: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
    ) {
        let enum_path = format!("{}/enum", path);

        match enum_val {
            Value::Array(arr) => {
                if arr.is_empty() {
                    result.add_error(ValidationError::schema_error(
                        SchemaErrorCode::SchemaEnumEmpty,
                        "enum cannot be empty",
                        &enum_path,
                        locator.get_location(&enum_path),
                    ));
                    return;
                }

                // Check for duplicates
                let mut seen = Vec::new();
                for (i, item) in arr.iter().enumerate() {
                    let item_str = item.to_string();
                    if seen.contains(&item_str) {
                        result.add_error(ValidationError::schema_error(
                            SchemaErrorCode::SchemaEnumDuplicates,
                            "enum contains duplicate values",
                            &format!("{}/{}", enum_path, i),
                            locator.get_location(&format!("{}/{}", enum_path, i)),
                        ));
                    } else {
                        seen.push(item_str);
                    }
                }
            }
            _ => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaEnumNotArray,
                    "enum must be an array",
                    &enum_path,
                    locator.get_location(&enum_path),
                ));
            }
        }
    }

    /// Validates composition keywords.
    fn validate_composition(
        &self,
        obj: &serde_json::Map<String, Value>,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        _enabled_extensions: &HashSet<&str>,
        visited_refs: &mut HashSet<String>,
        depth: usize,
    ) {
        // allOf
        if let Some(all_of) = obj.get("allOf") {
            self.validate_composition_array(all_of, "allOf", root_schema, locator, result, path, visited_refs, depth);
        }

        // anyOf
        if let Some(any_of) = obj.get("anyOf") {
            self.validate_composition_array(any_of, "anyOf", root_schema, locator, result, path, visited_refs, depth);
        }

        // oneOf
        if let Some(one_of) = obj.get("oneOf") {
            self.validate_composition_array(one_of, "oneOf", root_schema, locator, result, path, visited_refs, depth);
        }

        // not
        if let Some(not) = obj.get("not") {
            let not_path = format!("{}/not", path);
            self.validate_schema_internal(not, root_schema, locator, result, &not_path, false, visited_refs, depth + 1);
        }

        // if/then/else
        if let Some(if_schema) = obj.get("if") {
            let if_path = format!("{}/if", path);
            self.validate_schema_internal(if_schema, root_schema, locator, result, &if_path, false, visited_refs, depth + 1);
        }

        if let Some(then_schema) = obj.get("then") {
            if !obj.contains_key("if") {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaThenWithoutIf,
                    "then requires if",
                    &format!("{}/then", path),
                    locator.get_location(&format!("{}/then", path)),
                ));
            }
            let then_path = format!("{}/then", path);
            self.validate_schema_internal(then_schema, root_schema, locator, result, &then_path, false, visited_refs, depth + 1);
        }

        if let Some(else_schema) = obj.get("else") {
            if !obj.contains_key("if") {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaElseWithoutIf,
                    "else requires if",
                    &format!("{}/else", path),
                    locator.get_location(&format!("{}/else", path)),
                ));
            }
            let else_path = format!("{}/else", path);
            self.validate_schema_internal(else_schema, root_schema, locator, result, &else_path, false, visited_refs, depth + 1);
        }
    }

    /// Validates a composition array (allOf, anyOf, oneOf).
    fn validate_composition_array(
        &self,
        value: &Value,
        keyword: &str,
        root_schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        visited_refs: &mut HashSet<String>,
        depth: usize,
    ) {
        let keyword_path = format!("{}/{}", path, keyword);

        match value {
            Value::Array(arr) => {
                for (i, item) in arr.iter().enumerate() {
                    let item_path = format!("{}/{}", keyword_path, i);
                    self.validate_schema_internal(item, root_schema, locator, result, &item_path, false, visited_refs, depth + 1);
                }
            }
            _ => {
                let code = match keyword {
                    "allOf" => SchemaErrorCode::SchemaAllOfNotArray,
                    "anyOf" => SchemaErrorCode::SchemaAnyOfNotArray,
                    "oneOf" => SchemaErrorCode::SchemaOneOfNotArray,
                    _ => SchemaErrorCode::SchemaAllOfNotArray,
                };
                result.add_error(ValidationError::schema_error(
                    code,
                    format!("{} must be an array", keyword),
                    &keyword_path,
                    locator.get_location(&keyword_path),
                ));
            }
        }
    }

    /// Checks for extension keywords used without enabling the extension.
    fn check_extension_keywords(
        &self,
        obj: &serde_json::Map<String, Value>,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        enabled_extensions: &HashSet<&str>,
    ) {
        let validation_enabled = enabled_extensions.contains("JSONStructureValidation");
        let composition_enabled = enabled_extensions.contains("JSONStructureConditionalComposition");

        for (key, _) in obj {
            // Check validation keywords
            if VALIDATION_EXTENSION_KEYWORDS.contains(&key.as_str()) && !validation_enabled {
                result.add_error(ValidationError::schema_warning(
                    SchemaErrorCode::SchemaExtensionKeywordWithoutUses,
                    format!(
                        "Validation extension keyword '{}' is used but validation extensions are not enabled. \
                        Add '\"$uses\": [\"JSONStructureValidation\"]' to enable validation, or this keyword will be ignored.",
                        key
                    ),
                    &format!("{}/{}", path, key),
                    locator.get_location(&format!("{}/{}", path, key)),
                ));
            }

            // Check composition keywords
            if COMPOSITION_KEYWORDS.contains(&key.as_str()) && !composition_enabled {
                result.add_error(ValidationError::schema_warning(
                    SchemaErrorCode::SchemaExtensionKeywordWithoutUses,
                    format!(
                        "Conditional composition keyword '{}' is used but extensions are not enabled. \
                        Add '\"$uses\": [\"JSONStructureConditionalComposition\"]' to enable.",
                        key
                    ),
                    &format!("{}/{}", path, key),
                    locator.get_location(&format!("{}/{}", path, key)),
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_simple_schema() {
        let schema = r#"{
            "$id": "https://example.com/schema",
            "name": "TestSchema",
            "type": "string"
        }"#;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        assert!(result.is_valid());
    }

    #[test]
    fn test_missing_id() {
        let schema = r#"{
            "name": "TestSchema",
            "type": "string"
        }"#;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_missing_name_with_type() {
        let schema = r#"{
            "$id": "https://example.com/schema",
            "type": "string"
        }"#;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_invalid_type() {
        let schema = r#"{
            "$id": "https://example.com/schema",
            "name": "TestSchema",
            "type": "invalid_type"
        }"#;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_array_missing_items() {
        let schema = r#"{
            "$id": "https://example.com/schema",
            "name": "TestSchema",
            "type": "array"
        }"#;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_map_missing_values() {
        let schema = r#"{
            "$id": "https://example.com/schema",
            "name": "TestSchema",
            "type": "map"
        }"#;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_tuple_valid() {
        let schema = r#"{
            "$id": "https://example.com/schema",
            "name": "TestSchema",
            "type": "tuple",
            "properties": {
                "first": { "type": "string" },
                "second": { "type": "int32" }
            },
            "tuple": ["first", "second"]
        }"#;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        assert!(result.is_valid());
    }

    #[test]
    fn test_choice_valid() {
        let schema = r#"{
            "$id": "https://example.com/schema",
            "name": "TestSchema",
            "type": "choice",
            "selector": "kind",
            "choices": {
                "text": { "type": "string" },
                "number": { "type": "int32" }
            }
        }"#;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        assert!(result.is_valid());
    }

    #[test]
    fn test_enum_empty() {
        let schema = r#"{
            "$id": "https://example.com/schema",
            "name": "TestSchema",
            "type": "string",
            "enum": []
        }"#;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        assert!(!result.is_valid());
    }

    #[test]
    fn test_ref_to_definition() {
        let schema = r##"{
            "$id": "https://example.com/schema",
            "name": "TestSchema",
            "type": "object",
            "definitions": {
                "Inner": {
                    "type": "string"
                }
            },
            "properties": {
                "value": { "type": { "$ref": "#/definitions/Inner" } }
            }
        }"##;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        for err in result.all_errors() {
            println!("Error: {:?}", err);
        }
        assert!(result.is_valid(), "Schema with valid ref should pass");
    }

    #[test]
    fn test_ref_undefined() {
        let schema = r##"{
            "$id": "https://example.com/schema",
            "name": "TestSchema",
            "type": "object",
            "properties": {
                "value": { "type": { "$ref": "#/definitions/Undefined" } }
            }
        }"##;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        assert!(!result.is_valid(), "Schema with undefined ref should fail");
    }

    #[test]
    fn test_union_type() {
        let schema = r##"{
            "$id": "https://example.com/schema",
            "name": "TestSchema",
            "type": "object",
            "properties": {
                "value": { "type": ["string", "null"] }
            }
        }"##;
        
        let validator = SchemaValidator::new();
        let result = validator.validate(schema);
        for err in result.all_errors() {
            println!("Error: {:?}", err);
        }
        assert!(result.is_valid(), "Schema with union type should pass");
    }
}
