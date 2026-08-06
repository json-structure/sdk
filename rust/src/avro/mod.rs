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
//!
//! # Modes
//!
//! [`Mode::Compact`], the default, emits the smallest schema that carries the
//! data — right when the schema is parsed at process start and nothing else
//! reads it. [`Mode::Full`] additionally annotates the temporal types and
//! `uuid` with a `logicalType`, and carries the constraints Avro's type system
//! cannot express — `maxLength`, `pattern`, `minimum` and the rest — in a
//! `annotations` attribute beside `doc`. Avro parsers ignore attributes they
//! do not recognize, so the constraint survives in the form it was written
//! without costing an unaware reader anything.
//!
//! The two are **wire-compatible**. `Full` changes no base type and therefore
//! no byte, so a schema compiled either way can read data written by the other.
//! The conformance corpus asserts this directly rather than taking it on faith.
//!
//! ```rust
//! use json_structure::avro::{self, AvroOptions, Mode};
//! # use serde_json::json;
//! # let schema = json!({
//! #     "$schema": "https://json-structure.org/meta/core/v0/#",
//! #     "$id": "https://example.com/event",
//! #     "name": "Event",
//! #     "type": "object",
//! #     "properties": { "at": { "type": "datetime" } },
//! #     "required": ["at"]
//! # });
//! let options = AvroOptions { mode: Mode::Full, ..Default::default() };
//! let avsc = avro::compile_with(&schema, &options).unwrap().schema;
//! assert_eq!(avsc["fields"][0]["type"]["logicalType"], "rfc3339-timestamp-micros");
//! ```
//!
//! The `rfc3339-*` names are not in the Avro specification. Avro requires a
//! parser to ignore a logical type it does not recognize, and `apache-avro`
//! does — but not every implementation obeys that, so a port shipping `Full`
//! may have to register the names with its runtime first. See spec §2.5.1.

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

/// How much descriptive metadata to emit (spec §2.5).
///
/// The two modes are **wire-compatible**: every value occupies the same Avro
/// base type in both, so data written under one reads correctly under the
/// other. `Full` adds information *about* the bytes, never different bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    /// Only what serialization requires.
    #[default]
    Compact,
    /// Everything `Compact` emits, plus Avrotize's `rfc3339-*` logical type
    /// annotations on temporals and the constraints Avro cannot express in an
    /// `annotations` attribute.
    ///
    /// The `rfc3339-*` names are not reserved Avro logical types, so a reader
    /// that does not know them sees the `string` base and is correct. Some Avro
    /// libraries are nonetheless strict about unknown logical names and refuse
    /// to parse; see the spec's §2.5.1.
    Full,
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
    /// Representation mode for primitives.
    pub mode: Mode,
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
            mode: Mode::default(),
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
