//! Loading a JSON Structure document as a ready-to-use Avro schema.
//!
//! Available with the `avro` cargo feature. This is the seam that makes the
//! `.avsc` disappear: wherever an application would have called
//! [`apache_avro::Schema::parse_str`] on a hand-maintained `.avsc`, it calls
//! [`schema_from_jstruct_str`] on its JSON Structure document instead, and
//! everything downstream is unchanged.
//!
//! Every entry point says `jstruct` because that is the one thing a caller
//! cannot infer from the signature. `&str`, `&Value` and a path can each carry
//! either language, and the Avro one is exactly what these functions replace,
//! so a bare `schema_from_str` would read as a synonym for
//! [`apache_avro::Schema::parse_str`] rather than its opposite.
//!
//! ```rust
//! # #[cfg(feature = "avro")] {
//! use json_structure::avro;
//!
//! static PERSON: &str = r#"{
//!     "$schema": "https://json-structure.org/meta/core/v0/#",
//!     "$id": "https://example.com/person",
//!     "name": "Person",
//!     "type": "object",
//!     "properties": { "name": { "type": "string" }, "age": { "type": "int32" } },
//!     "required": ["name"]
//! }"#;
//!
//! let schema = avro::schema_from_jstruct_str(PERSON).unwrap();
//!
//! let mut record = apache_avro::types::Record::new(&schema).unwrap();
//! record.put("name", "Alice");
//! record.put("age", Some(30));
//!
//! let mut writer = apache_avro::Writer::new(&schema, Vec::new());
//! writer.append(record).unwrap();
//! let encoded = writer.into_inner().unwrap();
//! assert!(!encoded.is_empty());
//! # }
//! ```
//!
//! Compilation is cheap but not free, and a schema embedded in the binary is
//! compiled from the same bytes every time. On the corpus it costs roughly
//! 2.5 microseconds per declared property, so a typical schema lands in the
//! tens of microseconds and even a 10,000-property monster stays under 40ms —
//! the cost is linear in document size, not quadratic. That is nothing once,
//! and a great deal per message. Pay for it once:
//!
//! ```rust
//! # #[cfg(feature = "avro")] {
//! use json_structure::avro;
//! use std::sync::OnceLock;
//!
//! static SOURCE: &str = include_str!("../../tests/fixtures/person.struct.json");
//!
//! fn person_schema() -> &'static apache_avro::Schema {
//!     static CACHED: OnceLock<apache_avro::Schema> = OnceLock::new();
//!     CACHED.get_or_init(|| avro::schema_from_jstruct_str(SOURCE).expect("valid schema"))
//! }
//!
//! assert_eq!(person_schema().name().unwrap().name, "Person");
//! # }
//! ```
//!
//! `cargo run --release --example avro_bench --features avro` reproduces those
//! numbers against the conformance corpus.

use super::{compile_with, AvroOptions};
use crate::consolidate::{self, SchemaResolver};
use apache_avro::Schema;
use serde_json::Value;
use std::borrow::Cow;
use std::path::Path;

/// Errors from loading a JSON Structure document as an Avro schema.
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    /// The JSON Structure document could not be read or parsed.
    #[error("cannot read schema: {0}")]
    Source(String),

    /// Imports could not be resolved.
    #[error(transparent)]
    Consolidate(#[from] consolidate::ConsolidateError),

    /// The document could not be compiled to Avro.
    #[error(transparent)]
    Compile(#[from] super::AvroError),

    /// The generated Avro schema was rejected by the Avro parser. This is a bug
    /// in the compiler, not in the caller's schema.
    #[error("generated Avro schema was rejected: {0}")]
    Avro(String),
}

/// Compiles a JSON Structure document from a string into an Avro schema.
///
/// The direct replacement for [`apache_avro::Schema::parse_str`].
///
/// A string has no directory to resolve `$import` against, so a document with
/// imports needs [`schema_from_jstruct_file`] or an explicit resolver via
/// [`schema_from_jstruct_str_with`].
pub fn schema_from_jstruct_str(source: &str) -> Result<Schema, LoadError> {
    schema_from_jstruct_str_with(source, &AvroOptions::default(), &consolidate::NoResolver)
}

/// Compiles a JSON Structure document from a string, with explicit options and
/// import resolution.
pub fn schema_from_jstruct_str_with(
    source: &str,
    options: &AvroOptions,
    resolver: &dyn SchemaResolver,
) -> Result<Schema, LoadError> {
    let document: Value =
        serde_json::from_str(source).map_err(|e| LoadError::Source(e.to_string()))?;
    schema_from_jstruct_value_with(&document, options, resolver)
}

/// Compiles an already-parsed JSON Structure document into an Avro schema.
pub fn schema_from_jstruct_value(document: &Value) -> Result<Schema, LoadError> {
    schema_from_jstruct_value_with(document, &AvroOptions::default(), &consolidate::NoResolver)
}

/// Compiles an already-parsed JSON Structure document, with explicit options
/// and import resolution.
pub fn schema_from_jstruct_value_with(
    document: &Value,
    options: &AvroOptions,
    resolver: &dyn SchemaResolver,
) -> Result<Schema, LoadError> {
    // Borrow unless there is genuinely something to consolidate. Cloning the
    // document unconditionally costs a full deep copy on the overwhelmingly
    // common path where it has no imports at all.
    let consolidated = if consolidate::has_imports(document) {
        Cow::Owned(consolidate::consolidate(document, resolver)?)
    } else {
        Cow::Borrowed(document)
    };
    let output = compile_with(&consolidated, options)?;
    // `Schema::parse` takes the JSON tree directly. Serializing to text and
    // handing that to `parse_str` only to have it parsed straight back is a
    // round trip through a string that nobody ever reads.
    Schema::parse(&output.schema).map_err(|e| LoadError::Avro(e.to_string()))
}

/// Compiles a JSON Structure document from disk, resolving `$import` references
/// relative to the file's own directory.
pub fn schema_from_jstruct_file(path: impl AsRef<Path>) -> Result<Schema, LoadError> {
    schema_from_jstruct_file_with(path, &AvroOptions::default())
}

/// Compiles a JSON Structure document from disk with explicit options.
///
/// There is no resolver parameter because a file already knows where it lives;
/// imports resolve relative to its directory.
pub fn schema_from_jstruct_file_with(
    path: impl AsRef<Path>,
    options: &AvroOptions,
) -> Result<Schema, LoadError> {
    let path = path.as_ref();
    let text = std::fs::read_to_string(path).map_err(|e| LoadError::Source(e.to_string()))?;
    let document: Value =
        serde_json::from_str(&text).map_err(|e| LoadError::Source(e.to_string()))?;
    let base = path.parent().unwrap_or_else(|| Path::new("."));
    let resolver = consolidate::FileResolver::new(base);
    schema_from_jstruct_value_with(&document, options, &resolver)
}
#[cfg(test)]
mod tests {
    use super::*;
    use apache_avro::types::Record;
    use apache_avro::{Reader, Writer};

    const PERSON: &str = r#"{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/person",
        "name": "Person",
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "age": { "type": "int32" },
            "email": { "type": "string" }
        },
        "required": ["name"]
    }"#;

    #[test]
    fn round_trips_a_record_end_to_end() {
        let schema = schema_from_jstruct_str(PERSON).unwrap();

        let mut record = Record::new(&schema).unwrap();
        record.put("name", "Alice");
        record.put("age", Some(30));
        record.put("email", None::<String>);

        let mut writer = Writer::new(&schema, Vec::new());
        writer.append(record).unwrap();
        let encoded = writer.into_inner().unwrap();

        let reader = Reader::new(&encoded[..]).unwrap();
        let values: Vec<_> = reader.map(Result::unwrap).collect();
        assert_eq!(values.len(), 1);

        let apache_avro::types::Value::Record(fields) = &values[0] else {
            panic!("expected a record");
        };
        assert_eq!(fields[0].0, "name");
        assert_eq!(fields[0].1, apache_avro::types::Value::String("Alice".into()));
    }

    #[test]
    fn an_added_optional_field_is_readable_by_an_older_reader() {
        // The whole point of nullable-with-default optional fields.
        let v1 = schema_from_jstruct_str(PERSON).unwrap();
        let v2 = schema_from_jstruct_str(
            &PERSON.replace(
                r#""email": { "type": "string" }"#,
                r#""email": { "type": "string" }, "nickname": { "type": "string" }"#,
            ),
        )
        .unwrap();

        let mut record = Record::new(&v2).unwrap();
        record.put("name", "Bob");
        record.put("age", None::<i32>);
        record.put("email", None::<String>);
        record.put("nickname", Some("Bobby"));

        let mut writer = Writer::new(&v2, Vec::new());
        writer.append(record).unwrap();
        let encoded = writer.into_inner().unwrap();

        // Read with the older schema: the unknown field is simply ignored.
        let reader = Reader::with_schema(&v1, &encoded[..]).unwrap();
        let values: Vec<_> = reader.map(Result::unwrap).collect();
        assert_eq!(values.len(), 1);
    }

    #[test]
    fn a_bad_document_reports_a_source_error() {
        assert!(matches!(
            schema_from_jstruct_str("{ not json"),
            Err(LoadError::Source(_))
        ));
    }
}
