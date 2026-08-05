//! JSON Structure to Apache Avro schema compilation.
//!
//! Implements [`spec/json-structure-to-avro.md`][spec]: a total, deterministic
//! mapping from a consolidated JSON Structure Core document to an Avro schema.
//!
//! [spec]: https://github.com/json-structure/sdk/blob/main/spec/json-structure-to-avro.md
//!
//! The point of this module is that an application declares its contract once,
//! in JSON Structure, and never has to author or read an `.avsc`. Avro is the
//! assembly language; JSON Structure is the source.
//!
//! # Example
//!
//! ```rust
//! use json_structure::avro;
//! use serde_json::json;
//!
//! let schema = json!({
//!     "$schema": "https://json-structure.org/meta/core/v0/#",
//!     "$id": "https://example.com/person",
//!     "name": "Person",
//!     "type": "object",
//!     "properties": {
//!         "name": { "type": "string" },
//!         "age": { "type": "int32" }
//!     },
//!     "required": ["name"]
//! });
//!
//! let avsc = avro::compile(&schema).unwrap();
//! assert_eq!(avsc["type"], "record");
//! assert_eq!(avsc["fields"][0]["type"], "string");
//! // `age` is optional, so it is nullable with a null default.
//! assert_eq!(avsc["fields"][1]["type"], json!(["null", "int"]));
//! ```

mod compiler;

// The `avro` feature adds the apache-avro seam. It is deliberately re-exported
// flat rather than behind a `runtime` module: a module name should say what
// something *is*, not when it runs, and `avro::schema_from_jstruct_str` already
// reads unambiguously without a second qualifier stuttering "avro" back at the
// caller.
#[cfg(feature = "avro")]
mod load;

#[cfg(feature = "avro")]
pub use load::{
    schema_from_jstruct_file, schema_from_jstruct_file_with, schema_from_jstruct_str,
    schema_from_jstruct_str_with, schema_from_jstruct_value, schema_from_jstruct_value_with,
    LoadError,
};

use serde_json::Value;

pub use compiler::AvroError;

/// What to do when a schema declares open records that Avro cannot represent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AdditionalProperties {
    /// Drop the openness, emit a closed record, and report a warning.
    #[default]
    Ignore,
    /// Fail compilation.
    Error,
}

/// Options controlling compilation.
///
/// Nothing here can change the *names* in the output. The JSON Structure
/// document is the source of truth: its definition namespaces become Avro
/// namespaces, dotted, and there is no way to override or prefix them. A schema
/// name is part of the wire contract, and a wire contract that depends on a
/// command-line flag is not a contract.
#[derive(Debug, Clone)]
pub struct AvroOptions {
    /// Add-in names from `$offers` to apply.
    ///
    /// JSON Structure puts `$uses` in the *instance* document, so the compiler
    /// cannot read it from the schema; the caller supplies it here.
    pub uses: Vec<String>,
    /// How to treat `additionalProperties`.
    pub additional_properties: AdditionalProperties,
    /// Whether to emit Avro `doc` from `description`.
    pub emit_doc: bool,
}

impl Default for AvroOptions {
    fn default() -> Self {
        Self {
            uses: Vec::new(),
            additional_properties: AdditionalProperties::default(),
            emit_doc: true,
        }
    }
}

/// A non-fatal problem encountered during compilation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Warning {
    /// JSON Pointer of the schema node the warning is about.
    pub path: String,
    /// Human-readable description.
    pub message: String,
}

/// The result of a successful compilation.
#[derive(Debug, Clone)]
pub struct CompileOutput {
    /// The generated Avro schema.
    pub schema: Value,
    /// Non-fatal problems. Callers should surface these; they describe data loss.
    pub warnings: Vec<Warning>,
}

/// Compiles a consolidated JSON Structure document to an Avro schema using
/// default options, discarding warnings.
pub fn compile(document: &Value) -> Result<Value, AvroError> {
    compile_with(document, &AvroOptions::default()).map(|o| o.schema)
}

/// Compiles a consolidated JSON Structure document to an Avro schema.
pub fn compile_with(document: &Value, options: &AvroOptions) -> Result<CompileOutput, AvroError> {
    compiler::Compiler::new(document, options).run()
}
