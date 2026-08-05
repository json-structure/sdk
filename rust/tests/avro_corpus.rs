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