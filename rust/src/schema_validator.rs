//! Schema validator for JSON Structure schemas.
//!
//! Validates that JSON Structure schema documents are syntactically and semantically correct.

use std::collections::{HashMap, HashSet};

use regex::Regex;
use serde_json::Value;

use crate::error_codes::SchemaErrorCode;
use crate::json_source_locator::JsonSourceLocator;
use crate::types::{
    is_valid_type, JsonLocation, SchemaValidatorOptions, ValidationError, ValidationResult,
    COMPOSITION_KEYWORDS, KNOWN_EXTENSIONS, SCHEMA_KEYWORDS, VALIDATION_EXTENSION_KEYWORDS,
};

/// Validates JSON Structure schema documents.
pub struct SchemaValidator {
    options: SchemaValidatorOptions,
    external_schemas: HashMap<String, Value>,
}

impl SchemaValidator {
    /// Creates a new schema validator with default options.
    pub fn new() -> Self {
        Self::with_options(SchemaValidatorOptions::default())
    }

    /// Creates a new schema validator with the given options.
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

    /// Validates a JSON Structure schema from a string.
    pub fn validate(&self, schema_json: &str) -> ValidationResult {
        let mut result = ValidationResult::new();
        let locator = JsonSourceLocator::new(schema_json);

        match serde_json::from_str::<Value>(schema_json) {
            Ok(schema) => {
                self.validate_schema(&schema, &locator, &mut result, "", true, &mut HashSet::new(), 0);
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
    pub fn validate_value(&self, schema: &Value, schema_json: &str) -> ValidationResult {
        let mut result = ValidationResult::new();
        let locator = JsonSourceLocator::new(schema_json);
        self.validate_schema(schema, &locator, &mut result, "", true, &mut HashSet::new(), 0);
        result
    }

    /// Validates a schema node.
    fn validate_schema(
        &self,
        schema: &Value,
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
            Value::Object(obj) => {
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

        // Collect enabled extensions
        let mut enabled_extensions = HashSet::new();
        if let Some(uses) = obj.get("$uses") {
            if let Value::Array(arr) = uses {
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
            self.validate_ref(ref_val, schema, locator, result, path, visited_refs, depth);
        }

        // Validate type if present
        if let Some(type_val) = obj.get("type") {
            self.validate_type(type_val, obj, locator, result, path, &enabled_extensions, depth);
        }

        // Validate definitions
        if let Some(defs) = obj.get("definitions") {
            self.validate_definitions(defs, locator, result, path, visited_refs, depth);
        }

        // Validate enum
        if let Some(enum_val) = obj.get("enum") {
            self.validate_enum(enum_val, locator, result, path);
        }

        // Validate composition keywords
        self.validate_composition(obj, locator, result, path, &enabled_extensions, visited_refs, depth);

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
        schema: &Value,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        visited_refs: &mut HashSet<String>,
        depth: usize,
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
                    // Local definition reference
                    let def_name = &ref_str[14..]; // Skip "#/definitions/"
                    
                    // Find root schema to check definitions
                    // For now, just check the current schema's definitions
                    if let Some(defs) = schema.get("definitions") {
                        if let Value::Object(defs_obj) = defs {
                            if !defs_obj.contains_key(def_name) {
                                result.add_error(ValidationError::schema_error(
                                    SchemaErrorCode::SchemaRefNotFound,
                                    format!("Reference not found: {}", ref_str),
                                    &ref_path,
                                    locator.get_location(&ref_path),
                                ));
                            }
                        }
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

    /// Validates the type keyword and type-specific requirements.
    fn validate_type(
        &self,
        type_val: &Value,
        obj: &serde_json::Map<String, Value>,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        enabled_extensions: &HashSet<&str>,
        depth: usize,
    ) {
        let type_path = format!("{}/type", path);

        let type_name = match type_val {
            Value::String(s) => s.as_str(),
            _ => {
                result.add_error(ValidationError::schema_error(
                    SchemaErrorCode::SchemaTypeNotString,
                    "type must be a string",
                    &type_path,
                    locator.get_location(&type_path),
                ));
                return;
            }
        };

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
            "object" => self.validate_object_type(obj, locator, result, path, enabled_extensions, depth),
            "array" | "set" => self.validate_array_type(obj, locator, result, path, type_name),
            "map" => self.validate_map_type(obj, locator, result, path),
            "tuple" => self.validate_tuple_type(obj, locator, result, path),
            "choice" => self.validate_choice_type(obj, locator, result, path),
            _ => {}
        }
    }

    /// Validates object type requirements.
    fn validate_object_type(
        &self,
        obj: &serde_json::Map<String, Value>,
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        enabled_extensions: &HashSet<&str>,
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
            self.validate_schema(items, locator, result, &items_path, false, &mut HashSet::new(), 0);
        }
    }

    /// Validates map type requirements.
    fn validate_map_type(
        &self,
        obj: &serde_json::Map<String, Value>,
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
            self.validate_schema(values, locator, result, &values_path, false, &mut HashSet::new(), 0);
        }
    }

    /// Validates tuple type requirements.
    fn validate_tuple_type(
        &self,
        obj: &serde_json::Map<String, Value>,
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
                    
                    // Definition must have type or $ref
                    if let Value::Object(def_obj) = def_schema {
                        if !def_obj.contains_key("type") && !def_obj.contains_key("$ref") {
                            result.add_error(ValidationError::schema_error(
                                SchemaErrorCode::SchemaDefinitionMissingType,
                                format!("Definition '{}' must have type or $ref", def_name),
                                &def_path,
                                locator.get_location(&def_path),
                            ));
                        }
                    }

                    self.validate_schema(
                        def_schema,
                        locator,
                        result,
                        &def_path,
                        false,
                        visited_refs,
                        depth + 1,
                    );
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
        locator: &JsonSourceLocator,
        result: &mut ValidationResult,
        path: &str,
        enabled_extensions: &HashSet<&str>,
        visited_refs: &mut HashSet<String>,
        depth: usize,
    ) {
        // allOf
        if let Some(all_of) = obj.get("allOf") {
            self.validate_composition_array(all_of, "allOf", locator, result, path, visited_refs, depth);
        }

        // anyOf
        if let Some(any_of) = obj.get("anyOf") {
            self.validate_composition_array(any_of, "anyOf", locator, result, path, visited_refs, depth);
        }

        // oneOf
        if let Some(one_of) = obj.get("oneOf") {
            self.validate_composition_array(one_of, "oneOf", locator, result, path, visited_refs, depth);
        }

        // not
        if let Some(not) = obj.get("not") {
            let not_path = format!("{}/not", path);
            self.validate_schema(not, locator, result, &not_path, false, visited_refs, depth + 1);
        }

        // if/then/else
        if let Some(if_schema) = obj.get("if") {
            let if_path = format!("{}/if", path);
            self.validate_schema(if_schema, locator, result, &if_path, false, visited_refs, depth + 1);
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
            self.validate_schema(then_schema, locator, result, &then_path, false, visited_refs, depth + 1);
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
            self.validate_schema(else_schema, locator, result, &else_path, false, visited_refs, depth + 1);
        }
    }

    /// Validates a composition array (allOf, anyOf, oneOf).
    fn validate_composition_array(
        &self,
        value: &Value,
        keyword: &str,
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
                    self.validate_schema(item, locator, result, &item_path, false, visited_refs, depth + 1);
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

impl Default for SchemaValidator {
    fn default() -> Self {
        Self::new()
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
}
