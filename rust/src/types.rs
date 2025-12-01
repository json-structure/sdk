//! Core types for JSON Structure validation.

use std::collections::HashSet;
use std::fmt;

use crate::error_codes::{InstanceErrorCode, SchemaErrorCode};

/// Severity level for validation messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Severity {
    /// An error that causes validation to fail.
    Error,
    /// A warning that does not cause validation to fail.
    Warning,
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Severity::Error => write!(f, "error"),
            Severity::Warning => write!(f, "warning"),
        }
    }
}

/// Location in the source JSON document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct JsonLocation {
    /// Line number (1-indexed).
    pub line: usize,
    /// Column number (1-indexed).
    pub column: usize,
}

impl JsonLocation {
    /// Creates a new location.
    pub fn new(line: usize, column: usize) -> Self {
        Self { line, column }
    }

    /// Returns an unknown location (0, 0).
    pub fn unknown() -> Self {
        Self { line: 0, column: 0 }
    }

    /// Returns true if this is an unknown location.
    pub fn is_unknown(&self) -> bool {
        self.line == 0 && self.column == 0
    }
}

impl fmt::Display for JsonLocation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_unknown() {
            write!(f, "(unknown)")
        } else {
            write!(f, "{}:{}", self.line, self.column)
        }
    }
}

/// A validation error with code, message, path, and location.
#[derive(Debug, Clone)]
pub struct ValidationError {
    /// The error code.
    pub code: String,
    /// The error message.
    pub message: String,
    /// The JSON Pointer path to the error location.
    pub path: String,
    /// The severity of the error.
    pub severity: Severity,
    /// The source location in the JSON document.
    pub location: JsonLocation,
}

impl ValidationError {
    /// Creates a new validation error.
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        path: impl Into<String>,
        severity: Severity,
        location: JsonLocation,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            path: path.into(),
            severity,
            location,
        }
    }

    /// Creates a new schema error.
    pub fn schema_error(
        code: SchemaErrorCode,
        message: impl Into<String>,
        path: impl Into<String>,
        location: JsonLocation,
    ) -> Self {
        Self::new(code.as_str(), message, path, Severity::Error, location)
    }

    /// Creates a new schema warning.
    pub fn schema_warning(
        code: SchemaErrorCode,
        message: impl Into<String>,
        path: impl Into<String>,
        location: JsonLocation,
    ) -> Self {
        Self::new(code.as_str(), message, path, Severity::Warning, location)
    }

    /// Creates a new instance error.
    pub fn instance_error(
        code: InstanceErrorCode,
        message: impl Into<String>,
        path: impl Into<String>,
        location: JsonLocation,
    ) -> Self {
        Self::new(code.as_str(), message, path, Severity::Error, location)
    }

    /// Creates a new instance warning.
    pub fn instance_warning(
        code: InstanceErrorCode,
        message: impl Into<String>,
        path: impl Into<String>,
        location: JsonLocation,
    ) -> Self {
        Self::new(code.as_str(), message, path, Severity::Warning, location)
    }

    /// Returns true if this is an error (not a warning).
    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
    }

    /// Returns true if this is a warning (not an error).
    pub fn is_warning(&self) -> bool {
        self.severity == Severity::Warning
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.location.is_unknown() {
            write!(f, "[{}] {}: {} at {}", self.severity, self.code, self.message, self.path)
        } else {
            write!(
                f,
                "[{}] {}: {} at {} ({})",
                self.severity, self.code, self.message, self.path, self.location
            )
        }
    }
}

/// Result of validation containing errors and warnings.
#[derive(Debug, Clone, Default)]
pub struct ValidationResult {
    errors: Vec<ValidationError>,
}

impl ValidationResult {
    /// Creates a new empty validation result.
    pub fn new() -> Self {
        Self { errors: Vec::new() }
    }

    /// Adds an error to the result.
    pub fn add_error(&mut self, error: ValidationError) {
        self.errors.push(error);
    }

    /// Adds multiple errors to the result.
    pub fn add_errors(&mut self, errors: impl IntoIterator<Item = ValidationError>) {
        self.errors.extend(errors);
    }

    /// Returns true if validation passed (no errors, warnings are OK).
    pub fn is_valid(&self) -> bool {
        !self.errors.iter().any(|e| e.is_error())
    }

    /// Returns true if there are no errors or warnings.
    pub fn is_clean(&self) -> bool {
        self.errors.is_empty()
    }

    /// Returns all errors and warnings.
    pub fn all_errors(&self) -> &[ValidationError] {
        &self.errors
    }

    /// Returns only errors (not warnings).
    pub fn errors(&self) -> impl Iterator<Item = &ValidationError> {
        self.errors.iter().filter(|e| e.is_error())
    }

    /// Returns only warnings (not errors).
    pub fn warnings(&self) -> impl Iterator<Item = &ValidationError> {
        self.errors.iter().filter(|e| e.is_warning())
    }

    /// Returns the count of errors (not warnings).
    pub fn error_count(&self) -> usize {
        self.errors.iter().filter(|e| e.is_error()).count()
    }

    /// Returns the count of warnings (not errors).
    pub fn warning_count(&self) -> usize {
        self.errors.iter().filter(|e| e.is_warning()).count()
    }

    /// Merges another result into this one.
    pub fn merge(&mut self, other: ValidationResult) {
        self.errors.extend(other.errors);
    }
}

/// Primitive types in JSON Structure.
pub const PRIMITIVE_TYPES: &[&str] = &[
    "string", "boolean", "null", "number",
    "int8", "int16", "int32", "int64", "int128",
    "uint8", "uint16", "uint32", "uint64", "uint128",
    "float", "float8", "double", "decimal",
    "date", "time", "datetime", "duration",
    "uuid", "uri", "binary", "jsonpointer",
    "integer", // alias for int32
];

/// Compound types in JSON Structure.
pub const COMPOUND_TYPES: &[&str] = &[
    "object", "array", "set", "map", "tuple", "choice", "any",
];

/// Numeric types in JSON Structure.
pub const NUMERIC_TYPES: &[&str] = &[
    "number", "integer",
    "int8", "int16", "int32", "int64", "int128",
    "uint8", "uint16", "uint32", "uint64", "uint128",
    "float", "float8", "double", "decimal",
];

/// Integer types in JSON Structure.
pub const INTEGER_TYPES: &[&str] = &[
    "integer",
    "int8", "int16", "int32", "int64", "int128",
    "uint8", "uint16", "uint32", "uint64", "uint128",
];

/// Core schema keywords.
pub const SCHEMA_KEYWORDS: &[&str] = &[
    "$schema", "$id", "$ref", "definitions", "$import", "$importdefs",
    "$comment", "$extends", "$abstract", "$root", "$uses", "$offers",
    "name", "abstract",
    "type", "enum", "const", "default",
    "title", "description", "examples",
    // Object keywords
    "properties", "additionalProperties", "required", "propertyNames",
    "minProperties", "maxProperties", "dependentRequired",
    // Array/Set/Tuple keywords
    "items", "minItems", "maxItems", "uniqueItems", "contains",
    "minContains", "maxContains",
    // String keywords
    "minLength", "maxLength", "pattern", "format", "contentEncoding", "contentMediaType",
    "contentCompression",
    // Number keywords
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "precision", "scale",
    // Map keywords
    "values",
    // Choice keywords
    "choices", "selector",
    // Tuple keywords
    "tuple",
    // Conditional composition
    "allOf", "anyOf", "oneOf", "not", "if", "then", "else",
    // Alternate names
    "altnames",
    // Units
    "unit",
];

/// Validation extension keywords that require JSONStructureValidation.
pub const VALIDATION_EXTENSION_KEYWORDS: &[&str] = &[
    // Numeric validation
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    // String validation
    "minLength", "maxLength", "pattern", "format",
    // Array/Set validation
    "minItems", "maxItems", "uniqueItems", "contains", "minContains", "maxContains",
    // Object/Map validation
    "minProperties", "maxProperties", "dependentRequired", "propertyNames",
    // Content validation
    "contentEncoding", "contentMediaType", "contentCompression",
];

/// Conditional composition keywords that require JSONStructureConditionalComposition.
pub const COMPOSITION_KEYWORDS: &[&str] = &[
    "allOf", "anyOf", "oneOf", "not", "if", "then", "else",
];

/// Known extension names.
pub const KNOWN_EXTENSIONS: &[&str] = &[
    "JSONStructureImport",
    "JSONStructureAlternateNames",
    "JSONStructureUnits",
    "JSONStructureConditionalComposition",
    "JSONStructureValidation",
];

/// Valid format values for the "format" keyword.
pub const VALID_FORMATS: &[&str] = &[
    "ipv4", "ipv6", "email", "idn-email", "hostname", "idn-hostname",
    "iri", "iri-reference", "uri-template", "relative-json-pointer", "regex",
];

/// Returns true if the given type name is a valid JSON Structure type.
pub fn is_valid_type(type_name: &str) -> bool {
    PRIMITIVE_TYPES.contains(&type_name) || COMPOUND_TYPES.contains(&type_name)
}

/// Returns true if the given type name is a primitive type.
pub fn is_primitive_type(type_name: &str) -> bool {
    PRIMITIVE_TYPES.contains(&type_name)
}

/// Returns true if the given type name is a compound type.
pub fn is_compound_type(type_name: &str) -> bool {
    COMPOUND_TYPES.contains(&type_name)
}

/// Returns true if the given type name is a numeric type.
pub fn is_numeric_type(type_name: &str) -> bool {
    NUMERIC_TYPES.contains(&type_name)
}

/// Returns true if the given type name is an integer type.
pub fn is_integer_type(type_name: &str) -> bool {
    INTEGER_TYPES.contains(&type_name)
}

/// Options for schema validation.
#[derive(Debug, Clone)]
pub struct SchemaValidatorOptions {
    /// Whether to allow $import/$importdefs keywords.
    pub allow_import: bool,
    /// Maximum depth for recursive validation.
    pub max_validation_depth: usize,
    /// Whether to warn on unused extension keywords.
    pub warn_on_unused_extension_keywords: bool,
    /// External schemas for resolving imports.
    pub external_schemas: Vec<serde_json::Value>,
}

impl Default for SchemaValidatorOptions {
    fn default() -> Self {
        Self {
            allow_import: false,
            max_validation_depth: 64,
            warn_on_unused_extension_keywords: true,
            external_schemas: Vec::new(),
        }
    }
}

/// Options for instance validation.
#[derive(Debug, Clone)]
pub struct InstanceValidatorOptions {
    /// Whether to enable extended validation features.
    pub extended: bool,
    /// Whether to allow $import/$importdefs keywords.
    pub allow_import: bool,
}

impl Default for InstanceValidatorOptions {
    fn default() -> Self {
        Self {
            extended: false,
            allow_import: false,
        }
    }
}
