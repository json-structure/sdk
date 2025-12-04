//! # JSON Structure
//!
//! A Rust implementation of the JSON Structure schema validation library.

#![allow(clippy::too_many_arguments)]
#![allow(clippy::needless_borrows_for_generic_args)]
#![allow(clippy::collapsible_match)]
//!
//! JSON Structure is a type-oriented schema language for JSON, designed for defining
//! data structures that can be validated and mapped to programming language types.
//!
//! ## Features
//!
//! - **Schema Validation**: Validate JSON Structure schema documents for correctness
//! - **Instance Validation**: Validate JSON instances against JSON Structure schemas
//! - **Source Location Tracking**: Line/column tracking for error messages
//! - **Extension Support**: Support for validation, composition, and other extensions
//!
//! ## Quick Start
//!
//! ```rust
//! use json_structure::{SchemaValidator, InstanceValidator};
//!
//! // Validate a schema
//! let schema_json = r#"{
//!     "$id": "https://example.com/person",
//!     "name": "Person",
//!     "type": "object",
//!     "properties": {
//!         "name": { "type": "string" },
//!         "age": { "type": "int32" }
//!     },
//!     "required": ["name"]
//! }"#;
//!
//! let schema_validator = SchemaValidator::new();
//! let schema_result = schema_validator.validate(schema_json);
//! assert!(schema_result.is_valid());
//!
//! // Validate an instance
//! let schema: serde_json::Value = serde_json::from_str(schema_json).unwrap();
//! let instance_json = r#"{"name": "Alice", "age": 30}"#;
//!
//! let instance_validator = InstanceValidator::new();
//! let instance_result = instance_validator.validate(instance_json, &schema);
//! assert!(instance_result.is_valid());
//! ```
//!
//! ## Supported Types
//!
//! ### Primitive Types
//! - `string`, `boolean`, `null`
//! - `number`, `integer` (alias for `int32`)
//! - `int8`, `int16`, `int32`, `int64`, `int128`
//! - `uint8`, `uint16`, `uint32`, `uint64`, `uint128`
//! - `float`, `float8`, `double`, `decimal`
//! - `date`, `time`, `datetime`, `duration`
//! - `uuid`, `uri`, `binary`, `jsonpointer`
//!
//! ### Compound Types
//! - `object` - JSON object with typed properties
//! - `array` - Homogeneous list
//! - `set` - Unique homogeneous list
//! - `map` - Dictionary with string keys
//! - `tuple` - Fixed-length typed array
//! - `choice` - Discriminated union
//! - `any` - Any JSON value
//!
//! ## Extensions
//!
//! Extensions can be enabled via the `$uses` keyword in schemas:
//!
//! - `JSONStructureValidation` - Validation constraints (minLength, pattern, etc.)
//! - `JSONStructureConditionalComposition` - Conditional composition (allOf, oneOf, etc.)
//! - `JSONStructureImport` - Schema imports
//! - `JSONStructureAlternateNames` - Alternate property names
//! - `JSONStructureUnits` - Unit annotations

mod error_codes;
mod instance_validator;
mod json_source_locator;
mod schema_validator;
mod types;

pub use error_codes::{InstanceErrorCode, SchemaErrorCode};
pub use instance_validator::InstanceValidator;
pub use json_source_locator::JsonSourceLocator;
pub use schema_validator::SchemaValidator;
pub use types::{
    InstanceValidatorOptions, JsonLocation, SchemaValidatorOptions, Severity, ValidationError,
    ValidationResult,
};

// Re-export type constants
pub use types::{
    is_compound_type, is_integer_type, is_numeric_type, is_primitive_type, is_valid_type,
    COMPOSITION_KEYWORDS, COMPOUND_TYPES, INTEGER_TYPES, KNOWN_EXTENSIONS, NUMERIC_TYPES,
    PRIMITIVE_TYPES, SCHEMA_KEYWORDS, VALIDATION_EXTENSION_KEYWORDS,
};
