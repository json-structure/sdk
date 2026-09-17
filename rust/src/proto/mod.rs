//! JSON Structure → Protocol Buffers (proto3) generation.
//!
//! See `spec/json-structure-to-proto.md` for the normative mapping.
//!
//! Unlike the Avro compiler, this is a build-time facility: it produces `.proto`
//! source files that are meant to be checked in, fed to `protoc`, and imported
//! from gRPC service definitions.
//!
//! ```rust
//! use json_structure::proto;
//! use serde_json::json;
//!
//! let schema = json!({
//!     "$schema": "https://json-structure.org/meta/core/v0/#",
//!     "$id": "https://example.com/person",
//!     "name": "Person",
//!     "type": "object",
//!     "properties": { "name": { "type": "string" }, "age": { "type": "int32" } },
//!     "required": ["name"]
//! });
//!
//! let out = proto::generate(&schema).unwrap();
//! assert_eq!(out.files.len(), 1);
//! assert!(out.files[0].contents.contains("string name = 1;"));
//! assert!(out.files[0].contents.contains("optional int32 age = 2;"));
//! ```

mod generator;
mod ir;

pub use generator::ProtoError;

use serde_json::Value;

/// How to treat open records that protobuf cannot represent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AdditionalProperties {
    /// Emit a closed message and report a warning.
    #[default]
    Ignore,
    /// Fail generation.
    Error,
}

/// Options controlling generation.
///
/// Nothing here can change the *names* in the output. The JSON Structure
/// document is the source of truth: its definition namespaces become protobuf
/// packages and file paths, and there is no way to override or prefix them. A
/// package name is part of the generated API's contract, and a contract that
/// depends on a command-line flag is not a contract.
#[derive(Debug, Clone)]
pub struct ProtoOptions {
    /// Add-in names from `$offers` to apply.
    pub uses: Vec<String>,
    /// How to treat `additionalProperties`.
    pub additional_properties: AdditionalProperties,
    /// Whether to emit `description` as leading comments.
    pub emit_comments: bool,
    /// A previously written field-number lock, if any. See the spec, §6.3.
    pub numbers: Option<Value>,
}

impl Default for ProtoOptions {
    fn default() -> Self {
        Self {
            uses: Vec::new(),
            additional_properties: AdditionalProperties::default(),
            emit_comments: true,
            numbers: None,
        }
    }
}

/// One generated `.proto` file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtoFile {
    /// Path relative to the output root, e.g. `com/example/sales.proto`.
    pub path: String,
    /// The protobuf package this file declares.
    pub package: String,
    /// The rendered file contents, ending in a single newline.
    pub contents: String,
}

/// A non-fatal problem encountered during generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Warning {
    /// JSON Pointer of the schema node the warning is about.
    pub path: String,
    /// Human-readable description.
    pub message: String,
}

/// The result of a successful generation.
#[derive(Debug, Clone)]
pub struct GenerateOutput {
    /// Generated files, ordered lexicographically by path.
    pub files: Vec<ProtoFile>,
    /// The updated field-number lock. Write this back alongside the schema.
    pub numbers: Value,
    /// Non-fatal problems. Callers should surface these; they describe data loss.
    pub warnings: Vec<Warning>,
}

/// Generates `.proto` files from a consolidated JSON Structure document using
/// default options.
pub fn generate(document: &Value) -> Result<GenerateOutput, ProtoError> {
    generate_with(document, &ProtoOptions::default())
}

/// Generates `.proto` files from a consolidated JSON Structure document.
pub fn generate_with(
    document: &Value,
    options: &ProtoOptions,
) -> Result<GenerateOutput, ProtoError> {
    generator::Generator::new(document, options).run()
}
