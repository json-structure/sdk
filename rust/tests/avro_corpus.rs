//! Golden-corpus harness for the JSON Structure → Avro compiler.
//!
//! The corpus lives in `test-assets/avro/` and is the contract every SDK port is
//! measured against. Each case is a directory:
//!
//! ```text
//! valid/<case>/schema.struct.json   the input document
//! valid/<case>/options.json         optional compile options
//! valid/<case>/expected.avsc        the byte-exact expected output
//!
//! invalid/<case>/schema.struct.json the input document
//! invalid/<case>/options.json       optional compile options
//! invalid/<case>/expected-error.txt a substring the error message must contain
//! ```
//!
//! `options.json` accepts `namespace` (string), `uses` (array of strings),
//! `additionalProperties` (`"ignore"` | `"error"`), and `emitDoc` (boolean).
//!
//! Set `JSTRUCT_BLESS=1` to (re)write the expected files from the current
//! implementation. Review the diff before committing; blessing is how a
//! behavioral change gets recorded, not how a failing test gets silenced.

use json_structure::avro::{compile_with, AdditionalProperties, AvroOptions};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

fn corpus_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate has a parent directory")
        .join("test-assets")
        .join("avro")
}

fn blessing() -> bool {
    std::env::var("JSTRUCT_BLESS").map(|v| v == "1").unwrap_or(false)
}

fn cases(kind: &str) -> Vec<(String, PathBuf)> {
    let dir = corpus_root().join(kind);
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display())) {
        let entry = entry.expect("readable directory entry");
        if entry.path().is_dir() {
            out.push((entry.file_name().to_string_lossy().into_owned(), entry.path()));
        }
    }
    // Directory iteration order is not guaranteed; the corpus is.
    out.sort_by(|a, b| a.0.cmp(&b.0));
    assert!(!out.is_empty(), "no cases found in {}", dir.display());
    out
}

fn read_document(dir: &Path) -> Value {
    let path = dir.join("schema.struct.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("invalid JSON in {}: {e}", path.display()))
}

/// A sample datum in Avro JSON encoding, if the case ships one.
fn read_instance(dir: &Path) -> Option<Value> {
    let path = dir.join("instance.avro.json");
    let text = std::fs::read_to_string(&path).ok()?;
    Some(
        serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("invalid JSON in {}: {e}", path.display())),
    )
}

fn read_options(dir: &Path) -> AvroOptions {
    let path = dir.join("options.json");
    let mut options = AvroOptions::default();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return options;
    };
    let value: Value =
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("invalid JSON in {}: {e}", path.display()));

    if let Some(uses) = value.get("uses").and_then(Value::as_array) {
        options.uses = uses
            .iter()
            .map(|v| v.as_str().expect("uses entries are strings").to_string())
            .collect();
    }
    match value.get("additionalProperties").and_then(Value::as_str) {
        Some("error") => options.additional_properties = AdditionalProperties::Error,
        Some("ignore") | None => {}
        Some(other) => panic!("unknown additionalProperties value {other:?} in {}", path.display()),
    }
    if let Some(emit) = value.get("emitDoc").and_then(Value::as_bool) {
        options.emit_doc = emit;
    }
    options
}

/// The canonical serialization. Every implementation must produce these bytes.
fn render(schema: &Value) -> String {
    let mut text = serde_json::to_string_pretty(schema).expect("schema serializes");
    text.push('\n');
    text
}

#[test]
fn every_valid_case_matches_its_golden_output() {
    let mut blessed = Vec::new();

    for (name, dir) in cases("valid") {
        let document = read_document(&dir);
        let options = read_options(&dir);

        let output = compile_with(&document, &options)
            .unwrap_or_else(|e| panic!("case '{name}' failed to compile: {e}"));
        let actual = render(&output.schema);

        let expected_path = dir.join("expected.avsc");
        let warnings_path = dir.join("expected-warnings.txt");
        let warnings: String = output
            .warnings
            .iter()
            .map(|w| format!("{}: {}\n", w.path, w.message))
            .collect();
        if blessing() {
            std::fs::write(&expected_path, &actual).expect("golden file is writable");
            if warnings.is_empty() {
                let _ = std::fs::remove_file(&warnings_path);
            } else {
                std::fs::write(&warnings_path, &warnings).expect("warnings file is writable");
            }
            blessed.push(name);
            continue;
        }

        let expected = std::fs::read_to_string(&expected_path).unwrap_or_else(|e| {
            panic!(
                "case '{name}': cannot read {} ({e}). Run with JSTRUCT_BLESS=1 to create it.",
                expected_path.display()
            )
        });
        let expected = expected.replace("\r\n", "\n");

        assert_eq!(
            actual, expected,
            "case '{name}' does not match its golden output"
        );

        // A warning is a promise to the developer that something was lost.
        // Unasserted, it is free to stop being emitted.
        let expected_warnings = std::fs::read_to_string(&warnings_path)
            .unwrap_or_default()
            .replace("\r\n", "\n");
        assert_eq!(
            warnings, expected_warnings,
            "case '{name}': warnings do not match expected-warnings.txt"
        );
    }

    assert!(
        blessed.is_empty(),
        "golden files were rewritten for {blessed:?}; unset JSTRUCT_BLESS and re-run"
    );
}

#[test]
fn every_valid_case_is_byte_deterministic() {
    for (name, dir) in cases("valid") {
        let document = read_document(&dir);
        let options = read_options(&dir);

        let first = render(&compile_with(&document, &options).expect("compiles").schema);
        for _ in 0..10 {
            let again = render(&compile_with(&document, &options).expect("compiles").schema);
            assert_eq!(first, again, "case '{name}' is not deterministic");
        }
    }
}

#[test]
fn every_valid_case_parses_as_avro() {
    for (name, dir) in cases("valid") {
        let document = read_document(&dir);
        let options = read_options(&dir);
        let output = compile_with(&document, &options).expect("compiles");
        let text = serde_json::to_string(&output.schema).expect("serializes");
        apache_avro::Schema::parse_str(&text)
            .unwrap_or_else(|e| panic!("case '{name}' produced invalid Avro: {e}\n{text}"));
    }
}

/// Moves real bytes through the compiled schema for every case that ships an
/// `instance.avro.json`.
///
/// Parsing proves a schema is well-formed, which is not the same as proving it
/// can carry the data the JSON Structure document describes. A schema can parse
/// and still be wrong — a union whose default sits on the wrong branch, a
/// record whose field order moved, a name that resolves to the wrong type.
/// Those defects only show up when something is written and read back.
///
/// The instance is in **Avro JSON encoding**, not JSON Structure instance
/// encoding: this test is about the Avro schema, and the two encodings differ
/// exactly where Avro needs a union tag. A port in another language decodes it
/// with whatever its Avro library offers; this harness carries its own decoder
/// because `apache-avro` does not ship one.
#[test]
fn every_case_with_an_instance_round_trips() {
    let mut exercised = 0;

    for (name, dir) in cases("valid") {
        let Some(instance) = read_instance(&dir) else {
            continue;
        };
        exercised += 1;

        let document = read_document(&dir);
        let options = read_options(&dir);
        let output = compile_with(&document, &options).expect("compiles");
        let text = serde_json::to_string(&output.schema).expect("serializes");
        let schema = apache_avro::Schema::parse_str(&text)
            .unwrap_or_else(|e| panic!("case '{name}' produced invalid Avro: {e}"));

        let named = named_types(&schema);
        let datum = decode(&instance, &schema, &named, &name, "#");

        let mut writer = apache_avro::Writer::new(&schema, Vec::new());
        writer
            .append(datum.clone())
            .unwrap_or_else(|e| panic!("case '{name}': writing the instance failed: {e}"));
        let bytes = writer
            .into_inner()
            .unwrap_or_else(|e| panic!("case '{name}': flushing the writer failed: {e}"));

        let read: Vec<_> = apache_avro::Reader::with_schema(&schema, &bytes[..])
            .unwrap_or_else(|e| panic!("case '{name}': the written bytes are not readable: {e}"))
            .collect::<Result<_, _>>()
            .unwrap_or_else(|e| panic!("case '{name}': decoding failed: {e}"));

        assert_eq!(read.len(), 1, "case '{name}': expected exactly one datum");
        assert_eq!(
            read[0], datum,
            "case '{name}': the value did not survive the round trip"
        );
    }

    assert_eq!(
        exercised,
        cases("valid").len(),
        "every valid case must ship an instance.avro.json"
    );
}

/// Every case ships an instance, so this is also the assertion that the corpus
/// has not grown a case without one.
fn named_types(schema: &apache_avro::Schema) -> HashMap<String, apache_avro::Schema> {
    fn walk(schema: &apache_avro::Schema, out: &mut HashMap<String, apache_avro::Schema>) {
        use apache_avro::Schema as S;
        match schema {
            S::Record(record) => {
                out.insert(record.name.fullname(None), schema.clone());
                for field in &record.fields {
                    walk(&field.schema, out);
                }
            }
            S::Enum(inner) => {
                out.insert(inner.name.fullname(None), schema.clone());
            }
            S::Fixed(inner) => {
                out.insert(inner.name.fullname(None), schema.clone());
            }
            S::Array(inner) => walk(&inner.items, out),
            S::Map(inner) => walk(&inner.types, out),
            S::Union(union) => {
                for branch in union.variants() {
                    walk(branch, out);
                }
            }
            _ => {}
        }
    }
    let mut out = HashMap::new();
    walk(schema, &mut out);
    out
}

/// Decodes Avro JSON into an `apache_avro::types::Value` against a schema.
///
/// Schema-driven rather than heuristic: the shape of the datum is decided by
/// the schema, never guessed from the JSON. That is what makes the corpus
/// portable — a port does the same walk with its own library's value type, and
/// gets the same bytes.
fn decode(
    json: &Value,
    schema: &apache_avro::Schema,
    named: &HashMap<String, apache_avro::Schema>,
    case: &str,
    at: &str,
) -> apache_avro::types::Value {
    use apache_avro::types::Value as A;
    use apache_avro::Schema as S;
    use base64::Engine;

    let bad = |what: &str| -> ! {
        panic!("case '{case}' at {at}: expected {what}, found {json}");
    };

    match schema {
        S::Null => match json {
            Value::Null => A::Null,
            _ => bad("null"),
        },
        S::Boolean => A::Boolean(json.as_bool().unwrap_or_else(|| bad("a boolean"))),
        S::Int => A::Int(json.as_i64().unwrap_or_else(|| bad("an int")) as i32),
        S::Long => A::Long(json.as_i64().unwrap_or_else(|| bad("a long"))),
        S::Float => A::Float(json.as_f64().unwrap_or_else(|| bad("a float")) as f32),
        S::Double => A::Double(json.as_f64().unwrap_or_else(|| bad("a double"))),
        S::String => A::String(json.as_str().unwrap_or_else(|| bad("a string")).to_string()),
        S::Bytes => A::Bytes(
            base64::engine::general_purpose::STANDARD
                .decode(json.as_str().unwrap_or_else(|| bad("base64 bytes")))
                .unwrap_or_else(|e| panic!("case '{case}' at {at}: bad base64: {e}")),
        ),
        S::Enum(inner) => {
            let symbol = json.as_str().unwrap_or_else(|| bad("an enum symbol"));
            let index = inner
                .symbols
                .iter()
                .position(|s| s == symbol)
                .unwrap_or_else(|| panic!("case '{case}' at {at}: '{symbol}' is not a symbol"));
            A::Enum(index as u32, symbol.to_string())
        }
        S::Array(inner) => {
            let items = json.as_array().unwrap_or_else(|| bad("an array"));
            A::Array(
                items
                    .iter()
                    .enumerate()
                    .map(|(index, item)| {
                        decode(item, &inner.items, named, case, &format!("{at}/{index}"))
                    })
                    .collect(),
            )
        }
        S::Map(inner) => {
            let entries = json.as_object().unwrap_or_else(|| bad("an object"));
            A::Map(
                entries
                    .iter()
                    .map(|(key, value)| {
                        (
                            key.clone(),
                            decode(value, &inner.types, named, case, &format!("{at}/{key}")),
                        )
                    })
                    .collect(),
            )
        }
        S::Record(record) => {
            let entries = json.as_object().unwrap_or_else(|| bad("an object"));
            let mut fields = Vec::new();
            for field in &record.fields {
                let value = entries.get(&field.name).unwrap_or_else(|| {
                    panic!("case '{case}' at {at}: missing field '{}'", field.name)
                });
                fields.push((
                    field.name.clone(),
                    decode(
                        value,
                        &field.schema,
                        named,
                        case,
                        &format!("{at}/{}", field.name),
                    ),
                ));
            }
            for key in entries.keys() {
                assert!(
                    record.fields.iter().any(|f| f.name == *key),
                    "case '{case}' at {at}: '{key}' is not a field of {}",
                    record.name.fullname(None)
                );
            }
            A::Record(fields)
        }
        // Avro JSON tags a union value with its branch name, except for `null`
        // which is written bare. That tag is the whole point of the encoding:
        // without it `{"int": 1}` and a record with an `int` field are the
        // same document.
        S::Union(union) => {
            let branches = union.variants();
            if json.is_null() {
                let index = branches
                    .iter()
                    .position(|b| matches!(b, S::Null))
                    .unwrap_or_else(|| panic!("case '{case}' at {at}: union has no null branch"));
                return A::Union(index as u32, Box::new(A::Null));
            }
            let entries = json.as_object().unwrap_or_else(|| bad("a tagged union"));
            assert_eq!(
                entries.len(),
                1,
                "case '{case}' at {at}: a union value is a single-key object"
            );
            let (tag, inner) = entries.iter().next().expect("checked above");
            let index = branches
                .iter()
                .position(|b| branch_tag(b) == *tag)
                .unwrap_or_else(|| {
                    panic!(
                        "case '{case}' at {at}: '{tag}' names no branch; branches are [{}]",
                        branches.iter().map(branch_tag).collect::<Vec<_>>().join(", ")
                    )
                });
            A::Union(
                index as u32,
                Box::new(decode(
                    inner,
                    &branches[index],
                    named,
                    case,
                    &format!("{at}/{tag}"),
                )),
            )
        }
        S::Ref { name } => {
            let target = named
                .get(&name.fullname(None))
                .unwrap_or_else(|| panic!("case '{case}' at {at}: unresolved ref {name:?}"));
            decode(json, target, named, case, at)
        }
        other => panic!("case '{case}' at {at}: unsupported schema {other:?}"),
    }
}

/// The name a union branch carries in Avro JSON: the fullname for named types,
/// the type name for everything else.
fn branch_tag(schema: &apache_avro::Schema) -> String {
    use apache_avro::Schema as S;
    match schema {
        S::Null => "null".to_string(),
        S::Boolean => "boolean".to_string(),
        S::Int => "int".to_string(),
        S::Long => "long".to_string(),
        S::Float => "float".to_string(),
        S::Double => "double".to_string(),
        S::Bytes => "bytes".to_string(),
        S::String => "string".to_string(),
        S::Array(_) => "array".to_string(),
        S::Map(_) => "map".to_string(),
        S::Record(record) => record.name.fullname(None),
        S::Enum(inner) => inner.name.fullname(None),
        S::Fixed(inner) => inner.name.fullname(None),
        S::Ref { name } => name.fullname(None),
        other => format!("{other:?}"),
    }
}

#[test]
fn every_invalid_case_fails_with_the_expected_error() {
    let mut blessed = Vec::new();

    for (name, dir) in cases("invalid") {
        let document = read_document(&dir);
        let options = read_options(&dir);

        let error = match compile_with(&document, &options) {
            Ok(output) => panic!(
                "case '{name}' was expected to fail but produced:\n{}",
                render(&output.schema)
            ),
            Err(e) => e,
        };

        let expected_path = dir.join("expected-error.txt");
        if blessing() {
            std::fs::write(&expected_path, bless_error(error.kind(), error.path(), &error.to_string()))
                .expect("golden file is writable");
            blessed.push(name);
            continue;
        }

        let expected = std::fs::read_to_string(&expected_path).unwrap_or_else(|e| {
            panic!(
                "case '{name}': cannot read {} ({e}). Run with JSTRUCT_BLESS=1 to create it.",
                expected_path.display()
            )
        });
        let expected = ExpectedError::parse(&name, &expected);

        assert_eq!(
            error.kind(),
            expected.kind,
            "case '{name}': wrong error variant for\n  {error}"
        );
        assert_eq!(
            error.path(),
            expected.path.as_deref(),
            "case '{name}': wrong JSON Pointer for\n  {error}"
        );
        assert!(
            error.to_string().contains(&expected.message),
            "case '{name}': error\n  {error}\ndoes not contain\n  {}",
            expected.message
        );

        // A pointer nobody can follow is worse than no pointer at all, so every
        // one an error carries must actually land on a node in the document.
        if let Some(path) = error.path() {
            let resolvable = path == "#"
                || document
                    .pointer(path.trim_start_matches('#'))
                    .is_some();
            assert!(
                resolvable,
                "case '{name}': error carries JSON Pointer '{path}', which does not \
                 resolve in the schema document"
            );
        }
    }

    assert!(
        blessed.is_empty(),
        "golden files were rewritten for {blessed:?}; unset JSTRUCT_BLESS and re-run"
    );
}

/// The parsed form of an `expected-error.txt` golden.
///
/// A substring of the message alone is a weak assertion: it passes when the
/// right words come out of the wrong code path, and says nothing about whether
/// the error points anywhere useful. The golden therefore pins the error
/// variant and the JSON Pointer as well.
struct ExpectedError {
    kind: String,
    path: Option<String>,
    message: String,
}

impl ExpectedError {
    fn parse(case: &str, text: &str) -> Self {
        let mut kind = None;
        let mut path = None;
        let mut message = None;
        for line in text.lines() {
            let Some((key, value)) = line.split_once(": ") else {
                continue;
            };
            match key {
                "kind" => kind = Some(value.trim().to_string()),
                "path" => path = Some(value.trim().to_string()),
                "message" => message = Some(value.trim().to_string()),
                _ => {}
            }
        }
        Self {
            kind: kind.unwrap_or_else(|| {
                panic!("case '{case}': expected-error.txt has no `kind:` line. Run with JSTRUCT_BLESS=1 to rewrite it.")
            }),
            path,
            message: message.unwrap_or_else(|| {
                panic!("case '{case}': expected-error.txt has no `message:` line. Run with JSTRUCT_BLESS=1 to rewrite it.")
            }),
        }
    }
}

fn bless_error(kind: &str, path: Option<&str>, message: &str) -> String {
    let mut out = format!("kind: {kind}\n");
    if let Some(path) = path {
        out.push_str(&format!("path: {path}\n"));
    }
    out.push_str(&format!("message: {message}\n"));
    out
}