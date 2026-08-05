//! Golden-corpus harness for the JSON Structure → Protobuf generator.
//!
//! The corpus lives in `test-assets/proto/`. Each case is a directory:
//!
//! ```text
//! valid/<case>/schema.struct.json   the input document
//! valid/<case>/options.json         optional generation options
//! valid/<case>/expected/<path>      the byte-exact expected .proto files
//! valid/<case>/expected-numbers.json the field-number lock the run produces
//!
//! invalid/<case>/schema.struct.json the input document
//! invalid/<case>/options.json       optional generation options
//! invalid/<case>/expected-error.txt a substring the error message must contain
//! ```
//!
//! Set `JSTRUCT_BLESS=1` to (re)write the expected files. Review the diff.

use json_structure::proto::{generate_with, AdditionalProperties, ProtoOptions};
use serde_json::Value;
use std::path::{Path, PathBuf};

fn corpus_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate has a parent directory")
        .join("test-assets")
        .join("proto")
}

fn blessing() -> bool {
    std::env::var("JSTRUCT_BLESS").map(|v| v == "1").unwrap_or(false)
}

fn cases(kind: &str) -> Vec<(String, PathBuf)> {
    let dir = corpus_root().join(kind);
    let mut out = Vec::new();
    for entry in
        std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
    {
        let entry = entry.expect("readable directory entry");
        if entry.path().is_dir() {
            out.push((entry.file_name().to_string_lossy().into_owned(), entry.path()));
        }
    }
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

fn read_options(dir: &Path) -> ProtoOptions {
    let path = dir.join("options.json");
    let mut options = ProtoOptions::default();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return options;
    };
    let value: Value = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("invalid JSON in {}: {e}", path.display()));

    if let Some(uses) = value.get("uses").and_then(Value::as_array) {
        options.uses = uses
            .iter()
            .map(|v| v.as_str().expect("uses entries are strings").to_string())
            .collect();
    }
    match value.get("additionalProperties").and_then(Value::as_str) {
        Some("error") => options.additional_properties = AdditionalProperties::Error,
        Some("ignore") | None => {}
        Some(other) => panic!("unknown additionalProperties value {other:?}"),
    }
    if let Some(emit) = value.get("emitComments").and_then(Value::as_bool) {
        options.emit_comments = emit;
    }
    if let Some(numbers) = value.get("numbers") {
        options.numbers = Some(numbers.clone());
    }
    options
}

fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n")
}

#[test]
fn every_valid_case_matches_its_golden_output() {
    let mut blessed = Vec::new();

    for (name, dir) in cases("valid") {
        let document = read_document(&dir);
        let options = read_options(&dir);
        let output = generate_with(&document, &options)
            .unwrap_or_else(|e| panic!("case '{name}' failed to generate: {e}"));

        let expected_dir = dir.join("expected");
        let lock_path = dir.join("expected-numbers.json");
        let warnings_path = dir.join("expected-warnings.txt");
        let warnings: String = output
            .warnings
            .iter()
            .map(|w| format!("{}: {}\n", w.path, w.message))
            .collect();
        let mut lock = serde_json::to_string_pretty(&output.numbers).expect("lock serializes");
        lock.push('\n');

        if blessing() {
            let _ = std::fs::remove_dir_all(&expected_dir);
            for file in &output.files {
                let path = expected_dir.join(&file.path);
                std::fs::create_dir_all(path.parent().expect("file has a parent"))
                    .expect("output directory is creatable");
                std::fs::write(&path, &file.contents).expect("golden file is writable");
            }
            std::fs::write(&lock_path, &lock).expect("lock file is writable");
            if warnings.is_empty() {
                let _ = std::fs::remove_file(&warnings_path);
            } else {
                std::fs::write(&warnings_path, &warnings).expect("warnings file is writable");
            }
            blessed.push(name);
            continue;
        }

        assert!(
            !output.files.is_empty(),
            "case '{name}' generated no files at all"
        );

        for file in &output.files {
            let path = expected_dir.join(&file.path);
            let expected = std::fs::read_to_string(&path).unwrap_or_else(|e| {
                panic!(
                    "case '{name}': cannot read {} ({e}). Run with JSTRUCT_BLESS=1 to create it.",
                    path.display()
                )
            });
            assert_eq!(
                normalize(&file.contents),
                normalize(&expected),
                "case '{name}': {} does not match its golden output",
                file.path
            );
        }

        let expected_lock = std::fs::read_to_string(&lock_path)
            .unwrap_or_else(|e| panic!("case '{name}': cannot read the lock file ({e})"));
        assert_eq!(
            normalize(&lock),
            normalize(&expected_lock),
            "case '{name}': the field-number lock does not match"
        );

        // Comparing only the files we produced would never notice one we
        // stopped producing. Walk the goldens too.
        let mut goldens: Vec<String> = Vec::new();
        collect_protos(&expected_dir, &expected_dir, &mut goldens);
        goldens.sort();
        let mut produced: Vec<String> = output
            .files
            .iter()
            .map(|f| f.path.replace('\\', "/"))
            .collect();
        produced.sort();
        assert_eq!(
            produced, goldens,
            "case '{name}': the set of generated files does not match the goldens"
        );

        // A warning is a promise to the developer that something was lost.
        // Unasserted, it is free to stop being emitted.
        let expected_warnings = std::fs::read_to_string(&warnings_path).unwrap_or_default();
        assert_eq!(
            normalize(&warnings),
            normalize(&expected_warnings),
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

        let first = generate_with(&document, &options).expect("generates");
        for _ in 0..10 {
            let again = generate_with(&document, &options).expect("generates");
            assert_eq!(
                first.files, again.files,
                "case '{name}' is not deterministic"
            );
            // `Value`'s PartialEq ignores object key order, so compare the
            // serialization — key order is part of the golden.
            assert_eq!(
                serde_json::to_string(&first.numbers).unwrap(),
                serde_json::to_string(&again.numbers).unwrap(),
                "case '{name}' produces an unstable number lock"
            );
        }
    }
}

/// Feeding the output back in as the lock must not move a single number. If it
/// does, every regeneration is a wire-breaking change.
#[test]
fn regenerating_with_the_produced_lock_changes_nothing() {
    for (name, dir) in cases("valid") {
        let document = read_document(&dir);
        let mut options = read_options(&dir);

        let first = generate_with(&document, &options).expect("generates");
        options.numbers = Some(first.numbers.clone());
        let second = generate_with(&document, &options).expect("generates");

        assert_eq!(
            first.files, second.files,
            "case '{name}': regenerating with the produced lock changed the output"
        );
        assert_eq!(
            serde_json::to_string(&first.numbers).unwrap(),
            serde_json::to_string(&second.numbers).unwrap(),
            "case '{name}': regenerating with the produced lock changed the lock"
        );
    }
}

/// Compiles the *actual generated output* with `protoc` when it is on PATH.
/// Skipped otherwise — the corpus must be checkable without a protobuf
/// toolchain installed, but where one exists there is no excuse for not using
/// it. Compiling the goldens rather than the output would only prove that a
/// blessed file is still valid, not that today's generator produces valid
/// protobuf.
///
/// A test that can silently skip is a test that might not be running, so CI
/// sets `JSTRUCT_REQUIRE_PROTOC=1` and a missing `protoc` becomes a failure
/// rather than a shrug.
#[test]
fn every_valid_case_compiles_with_protoc() {
    let Some(protoc) = which_protoc() else {
        assert!(
            std::env::var_os("JSTRUCT_REQUIRE_PROTOC").is_none(),
            "JSTRUCT_REQUIRE_PROTOC is set but `protoc` is not on PATH"
        );
        eprintln!("protoc not found on PATH; skipping");
        return;
    };

    let scratch = std::env::temp_dir().join(format!("jstruct-protoc-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&scratch);

    for (name, dir) in cases("valid") {
        let document = read_document(&dir);
        let options = read_options(&dir);
        let output = generate_with(&document, &options)
            .unwrap_or_else(|e| panic!("case '{name}' failed to generate: {e}"));

        let root = scratch.join(&name);
        std::fs::create_dir_all(&root).expect("scratch directory is creatable");
        let mut sources: Vec<String> = Vec::new();
        for file in &output.files {
            let path = root.join(&file.path);
            std::fs::create_dir_all(path.parent().expect("file has a parent"))
                .expect("scratch subdirectory is creatable");
            std::fs::write(&path, &file.contents).expect("scratch file is writable");
            // protoc rejects backslash-separated source arguments.
            sources.push(file.path.replace('\\', "/"));
        }
        sources.sort();
        assert!(!sources.is_empty(), "case '{name}' generated no files");

        // Write the descriptor set to a real path. `--descriptor_set_out=-`
        // does not mean stdout to protoc; it creates a file literally named `-`
        // in the working directory.
        let descriptor = root.join("descriptor.pb");
        let result = std::process::Command::new(&protoc)
            .arg(format!("--proto_path={}", root.display()))
            .arg(format!("--descriptor_set_out={}", descriptor.display()))
            .args(&sources)
            .output()
            .expect("protoc runs");

        assert!(
            result.status.success(),
            "case '{name}': protoc rejected the generated files:\n{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    let _ = std::fs::remove_dir_all(&scratch);
}

/// Moves real protobuf bytes.
///
/// Compiling with `protoc` proves the generated `.proto` is syntactically
/// valid; it says nothing about whether the message can actually carry the
/// data the JSON Structure document describes. This test encodes a
/// hand-written text-format instance to the wire with `protoc --encode`,
/// decodes it back with `protoc --decode`, and re-encodes the result. The two
/// binaries must match byte for byte.
///
/// The instance is written by hand against what the *source* document means,
/// so a compiler that emits a self-consistent but wrong message — the one
/// failure mode a blessed golden can never catch — fails here.
#[test]
fn every_case_with_an_instance_round_trips_on_the_wire() {
    let Some(protoc) = which_protoc() else {
        assert!(
            std::env::var_os("JSTRUCT_REQUIRE_PROTOC").is_none(),
            "JSTRUCT_REQUIRE_PROTOC is set but `protoc` is not on PATH"
        );
        eprintln!("protoc not found on PATH; skipping");
        return;
    };

    let scratch = std::env::temp_dir().join(format!("jstruct-wire-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&scratch);

    let mut exercised = 0usize;
    for (name, dir) in cases("valid") {
        let Some((message, instance)) = read_instance(&dir) else {
            assert!(
                dir.join("no-instance.md").is_file(),
                "case '{name}' has no instance.txtpb, so nothing about it is ever put on the \
                 wire. Add one, or add a no-instance.md saying why the case cannot have one."
            );
            continue;
        };
        exercised += 1;

        let document = read_document(&dir);
        let options = read_options(&dir);
        let output = generate_with(&document, &options)
            .unwrap_or_else(|e| panic!("case '{name}' failed to generate: {e}"));

        let root = scratch.join(&name);
        std::fs::create_dir_all(&root).expect("scratch directory is creatable");
        let mut sources: Vec<String> = Vec::new();
        for file in &output.files {
            let path = root.join(&file.path);
            std::fs::create_dir_all(path.parent().expect("file has a parent"))
                .expect("scratch subdirectory is creatable");
            std::fs::write(&path, &file.contents).expect("scratch file is writable");
            sources.push(file.path.replace('\\', "/"));
        }
        sources.sort();

        let bytes = run_protoc(&protoc, &root, &sources, &format!("--encode={message}"), &instance)
            .unwrap_or_else(|e| panic!("case '{name}': protoc could not encode the instance:\n{e}"));

        let text = run_protoc(&protoc, &root, &sources, &format!("--decode={message}"), &bytes)
            .unwrap_or_else(|e| panic!("case '{name}': protoc could not decode the bytes:\n{e}"));

        let again = run_protoc(&protoc, &root, &sources, &format!("--encode={message}"), &text)
            .unwrap_or_else(|e| panic!("case '{name}': protoc could not re-encode:\n{e}"));

        assert_eq!(
            bytes,
            again,
            "case '{name}': the wire form is not stable across a decode/encode cycle.\n\
             decoded text format was:\n{}",
            String::from_utf8_lossy(&text)
        );

        // An instance that encodes to nothing proves nothing. Messages whose
        // every field is genuinely empty are excluded by writing a non-empty
        // instance; a case that cannot have one does not get an instance file.
        assert!(
            !bytes.is_empty(),
            "case '{name}': the instance encoded to zero bytes, so it exercises nothing"
        );
    }

    let total = cases("valid").len();
    assert!(
        exercised > 0 && exercised + 4 >= total,
        "the wire round trip covers only {exercised} of {total} valid cases; \
         the corpus has drifted away from exercising serialization"
    );

    let _ = std::fs::remove_dir_all(&scratch);
}

/// Reads `instance.txtpb`, returning the message to encode and the text.
///
/// The first line names the entry point, because a generated file set holds
/// many messages and only the case author knows which one is the root:
///
/// ```text
/// # message: com.example.Order
/// id: "A-1"
/// ```
fn read_instance(dir: &Path) -> Option<(String, Vec<u8>)> {
    let path = dir.join("instance.txtpb");
    let text = std::fs::read_to_string(&path).ok()?;
    let message = text
        .lines()
        .find_map(|line| line.trim().strip_prefix("# message:").map(str::trim))
        .unwrap_or_else(|| {
            panic!(
                "{} must start with a `# message: <fullname>` line",
                path.display()
            )
        })
        .to_string();
    Some((message, text.into_bytes()))
}

fn run_protoc(
    protoc: &Path,
    root: &Path,
    sources: &[String],
    mode: &str,
    stdin: &[u8],
) -> Result<Vec<u8>, String> {
    use std::io::Write;

    let mut child = std::process::Command::new(protoc)
        .arg(format!("--proto_path={}", root.display()))
        .arg(mode)
        .args(sources)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("protoc runs");
    child
        .stdin
        .take()
        .expect("stdin is piped")
        .write_all(stdin)
        .expect("protoc accepts stdin");
    let out = child.wait_with_output().expect("protoc completes");
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

fn which_protoc() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "protoc.exe" } else { "protoc" };
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|p| p.join(exe))
            .find(|p| p.is_file())
    })
}

fn collect_protos(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_protos(root, &path, out);
        } else if path.extension().is_some_and(|e| e == "proto") {
            let relative = path.strip_prefix(root).expect("under the root");
            out.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
}

#[test]
fn every_invalid_case_fails_with_the_expected_error() {
    let mut blessed = Vec::new();

    for (name, dir) in cases("invalid") {
        let document = read_document(&dir);
        let options = read_options(&dir);

        let error = match generate_with(&document, &options) {
            Ok(_) => panic!("case '{name}' was expected to fail but succeeded"),
            Err(e) => e,
        };

        let expected_path = dir.join("expected-error.txt");
        if blessing() {
            std::fs::write(
                &expected_path,
                bless_error(error.kind(), error.path(), &error.to_string()),
            )
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
            let resolvable = path == "#" || document.pointer(path.trim_start_matches('#')).is_some();
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