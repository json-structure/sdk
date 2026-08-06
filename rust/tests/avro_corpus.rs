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
//! `options.json` accepts `mode` (`"compact"` | `"full"`), `uses` (array of
//! strings), `additionalProperties` (`"ignore"` | `"error"`), and `emitDoc`
//! (boolean).
//!
//! Set `JSTRUCT_BLESS=1` to (re)write the expected files from the current
//! implementation. Review the diff before committing; blessing is how a
//! behavioral change gets recorded, not how a failing test gets silenced.

use json_structure::avro::{compile_with, AdditionalProperties, AvroOptions, Mode};
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
    match value.get("mode").and_then(Value::as_str) {
        Some("full") => options.mode = Mode::Full,
        Some("compact") | None => {}
        Some(other) => panic!("unknown mode value {other:?} in {}", path.display()),
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

/// The claim that makes `full` mode safe to turn on: it adds metadata and
/// nothing else. Strip the annotations back off and the two modes must be
/// byte-identical.
///
/// This is worth testing mechanically rather than trusting, because every
/// future primitive mapping is one careless base-type change away from
/// breaking it silently — the schemas would still compile and still validate,
/// and only data written under one mode and read under the other would notice.
#[test]
fn full_mode_only_adds_metadata() {
    /// Removes everything `full` mode is allowed to add: `logicalType` on a
    /// non-`decimal` type, and `doc`. `decimal` is not a `full`-mode
    /// annotation — it is emitted in both modes (§2.3) — so its `logicalType`,
    /// `precision`, and `scale` stay.
    fn strip(value: &mut Value) {
        match value {
            Value::Object(map) => {
                if map.get("logicalType").and_then(Value::as_str) != Some("decimal") {
                    map.remove("logicalType");
                }
                map.remove("doc");
                // An annotation-only object collapses back to its base type,
                // which is how `compact` would have written it.
                if map.len() == 1 {
                    if let Some(base @ Value::String(_)) = map.get("type") {
                        *value = base.clone();
                        return;
                    }
                }
                for child in map.values_mut() {
                    strip(child);
                }
            }
            Value::Array(items) => items.iter_mut().for_each(strip),
            _ => {}
        }
    }

    for (name, dir) in cases("valid") {
        let document = read_document(&dir);
        let mut options = read_options(&dir);

        options.mode = Mode::Compact;
        let compact = compile_with(&document, &options)
            .unwrap_or_else(|e| panic!("case '{name}' failed to compile compact: {e}"));

        options.mode = Mode::Full;
        let full = compile_with(&document, &options)
            .unwrap_or_else(|e| panic!("case '{name}' failed to compile full: {e}"));

        let mut compact_schema = compact.schema.clone();
        let mut full_schema = full.schema.clone();
        strip(&mut compact_schema);
        strip(&mut full_schema);

        assert_eq!(
            render(&full_schema),
            render(&compact_schema),
            "case '{name}': full mode changed the wire format, not just the metadata"
        );

        // The warnings describe lost information, which is a property of the
        // document, not of how much metadata was asked for.
        assert_eq!(
            full.warnings, compact.warnings,
            "case '{name}': the modes disagree about what was lost"
        );
    }
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
    let mut blessed = Vec::new();
    let mut pinned = 0;
    let mut unordered = 0;

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

        // The blessed binary encoding. This is what the Avro JSON cross-check
        // used to buy: an independent opinion about what the instance *says*,
        // rather than merely that this harness agrees with itself. Since the
        // corpus instance encoding is Plain JSON, no shipping Avro library will
        // read it, so the check moves across SDKs instead — every port must
        // decode the same instance to the same bytes, or one of them is
        // misreading the file.
        //
        // A `map` defeats it. Avro writes map entries in iteration order and
        // `apache-avro` models a map value as a `HashMap`, whose order is
        // randomized per process — so the bytes are not stable even between two
        // runs of this test, let alone between two SDKs. That is a property of
        // the Avro encoding and the library, not of anything this project could
        // fix, so those cases are excluded rather than papered over.
        let encoded = apache_avro::to_avro_datum(&schema, datum.clone())
            .unwrap_or_else(|e| panic!("case '{name}': encoding the instance failed: {e}"));
        if contains_map(&schema) {
            unordered += 1;
        } else {
            pinned += 1;
            bless_or_compare(
                &dir.join("expected.avro.b64"),
                &format!("{}\n", b64(&encoded)),
                &name,
                "the instance did not encode to its blessed bytes",
                &mut blessed,
            );
        }

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

    assert!(
        blessed.is_empty(),
        "golden files were rewritten for {blessed:?}; unset JSTRUCT_BLESS and re-run"
    );

    // A conditional check that skips everything still passes, so both sides of
    // the condition are counted and asserted.
    assert!(pinned > 0, "no case pinned its encoded bytes");
    assert!(
        unordered > 0,
        "no case contains a map any more, so the exclusion above is dead code"
    );
}

/// Whether a schema contains a `map` anywhere, and so has no stable byte
/// encoding. Walking the serialized JSON is simpler and more obviously
/// exhaustive than walking `Schema`'s variants.
fn contains_map(schema: &apache_avro::Schema) -> bool {
    fn walk(value: &Value) -> bool {
        match value {
            Value::Object(map) => {
                map.get("type").and_then(Value::as_str) == Some("map") || map.values().any(walk)
            }
            Value::Array(items) => items.iter().any(walk),
            _ => false,
        }
    }
    walk(&serde_json::to_value(schema).expect("a schema serializes"))
}

/// Compares against a golden file, or rewrites it when blessing.
fn bless_or_compare(path: &Path, actual: &str, case: &str, what: &str, blessed: &mut Vec<String>) {
    if blessing() {
        std::fs::write(path, actual)
            .unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
        blessed.push(case.to_string());
        return;
    }
    let expected = std::fs::read_to_string(path)
        .unwrap_or_else(|e| {
            panic!(
                "case '{case}': cannot read {} ({e}). Run with JSTRUCT_BLESS=1 to create it.",
                path.display()
            )
        })
        .replace("\r\n", "\n");
    assert_eq!(actual, expected, "case '{case}': {what}");
}

fn b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// The wire-compatibility claim, proved on bytes rather than on schema shape.
///
/// `full_mode_only_adds_metadata` checks that the two schemas *look* the same
/// once annotations are stripped. This checks what actually matters: that the
/// same value encodes to the same bytes under both modes. If that holds,
/// turning `full` on for a deployed schema is safe, which is the whole promise.
///
/// A `full` annotation lands in one of two places, and both are asserted:
///
///   * **Transparent.** `apache-avro` discards an unrecognized `logicalType`
///     while parsing, so the `rfc3339-*` family produces a `Schema` that is
///     *equal* to the compact one. Nothing can differ downstream because
///     nothing differs at all — the strongest form the claim can take.
///   * **Modelled.** `uuid` and `decimal` are reserved names the library turns
///     into their own `Schema` and `Value` variants. Here the schemas do
///     differ, so the bytes have to be compared directly.
#[test]
fn the_two_modes_encode_identical_bytes() {
    fn schema_for(document: &Value, options: &AvroOptions, name: &str) -> apache_avro::Schema {
        let output = compile_with(document, options).expect("compiles");
        let text = serde_json::to_string(&output.schema).expect("serializes");
        apache_avro::Schema::parse_str(&text)
            .unwrap_or_else(|e| panic!("case '{name}' produced invalid Avro: {e}"))
    }

    let mut transparent = 0;
    let mut compared = 0;

    for (name, dir) in cases("valid") {
        let Some(instance) = read_instance(&dir) else {
            continue;
        };
        let document = read_document(&dir);
        let mut options = read_options(&dir);

        options.mode = Mode::Compact;
        let compact = schema_for(&document, &options, &name);
        options.mode = Mode::Full;
        let full = schema_for(&document, &options, &name);

        if compact == full {
            // Only count the cases that actually carried an annotation; a case
            // with no annotatable type at all proves nothing either way.
            if compiles_differently(&document, &options, &name) {
                transparent += 1;
            }
            continue;
        }
        compared += 1;

        let compact_named = named_types(&compact);
        let full_named = named_types(&full);
        let compact_datum = decode(&instance, &compact, &compact_named, &name, "#");
        let full_datum = decode(&instance, &full, &full_named, &name, "#");

        // Compare the encoded datum only: a container file embeds its schema in
        // the header, which of course differs.
        let compact_bytes = apache_avro::to_avro_datum(&compact, compact_datum)
            .unwrap_or_else(|e| panic!("case '{name}': compact encoding failed: {e}"));
        let full_bytes = apache_avro::to_avro_datum(&full, full_datum)
            .unwrap_or_else(|e| panic!("case '{name}': full encoding failed: {e}"));
        assert_eq!(
            compact_bytes, full_bytes,
            "case '{name}': the two modes encoded the same value to different bytes"
        );
    }

    // Both counters are asserted because either branch could silently stop
    // running — a corpus edit is all it would take — and a test that skips
    // every case still passes.
    assert!(
        transparent > 0,
        "no case exercises an annotation the Avro parser ignores"
    );
    assert!(
        compared > 0,
        "no case exercises an annotation the Avro parser models"
    );
}

/// Whether the two modes emit different JSON for a document, independent of
/// what the Avro parser then makes of it.
fn compiles_differently(document: &Value, options: &AvroOptions, name: &str) -> bool {
    let mut options = options.clone();
    options.mode = Mode::Compact;
    let compact = compile_with(document, &options)
        .unwrap_or_else(|e| panic!("case '{name}' failed to compile compact: {e}"));
    options.mode = Mode::Full;
    let full = compile_with(document, &options)
        .unwrap_or_else(|e| panic!("case '{name}' failed to compile full: {e}"));
    compact.schema != full.schema
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

/// Decodes the corpus instance encoding — "Plain JSON" — into an
/// `apache_avro::types::Value` against a schema.
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
    try_decode(json, schema, named)
        .unwrap_or_else(|why| panic!("case '{case}' at {at}: {why}"))
}

/// The fallible core of `decode`. It returns a `Result` rather than
/// panicking because union resolution needs failure to be an ordinary answer:
/// Plain JSON drops the branch tag, so the only way to find the branch is to
/// try them all and see which one fits.
fn try_decode(
    json: &Value,
    schema: &apache_avro::Schema,
    named: &HashMap<String, apache_avro::Schema>,
) -> Result<apache_avro::types::Value, String> {
    use apache_avro::types::Value as A;
    use apache_avro::Schema as S;

    let wrong = |what: &str| -> String { format!("expected {what}, found {json}") };

    Ok(match schema {
        S::Null => match json {
            Value::Null => A::Null,
            _ => return Err(wrong("null")),
        },
        S::Boolean => A::Boolean(json.as_bool().ok_or_else(|| wrong("a boolean"))?),
        S::Int => {
            let value = json.as_i64().ok_or_else(|| wrong("an int"))?;
            A::Int(i32::try_from(value).map_err(|_| format!("{value} does not fit in an int"))?)
        }
        // Feature 3: a `long` travels as a *string* in JSON number syntax,
        // because JSON numbers are only guaranteed to survive to 2^53 and an
        // Avro long runs to 2^63.
        S::Long => A::Long(
            json.as_str()
                .ok_or_else(|| wrong("a long as a quoted number"))?
                .parse()
                .map_err(|e| format!("bad long: {e}"))?,
        ),
        S::Float => A::Float(json.as_f64().ok_or_else(|| wrong("a float"))? as f32),
        S::Double => A::Double(json.as_f64().ok_or_else(|| wrong("a double"))?),
        S::String => A::String(json.as_str().ok_or_else(|| wrong("a string"))?.to_string()),
        // Feature 2: bytes are base64, not Avro JSON's Latin-1 code points.
        S::Bytes => A::Bytes(base64(json.as_str().ok_or_else(|| wrong("base64 bytes"))?)?),
        S::Fixed(inner) => {
            let bytes = base64(json.as_str().ok_or_else(|| wrong("base64 bytes"))?)?;
            if bytes.len() != inner.size {
                return Err(format!(
                    "fixed({}) needs {} bytes, found {}",
                    inner.name.fullname(None),
                    inner.size,
                    bytes.len()
                ));
            }
            A::Fixed(inner.size, bytes)
        }
        // Feature 3 again: a decimal is its *numeric* value as a string, not the
        // unscaled bytes. That is the whole interoperability point — a plain
        // JSON consumer can read `"1.25"` and cannot read `"fQ=="`.
        S::Decimal(inner) => A::Decimal(
            unscaled(
                json.as_str()
                    .ok_or_else(|| wrong("a decimal as a quoted number"))?,
                inner.scale,
            )?
            .into(),
        ),
        S::Uuid => A::Uuid(
            json.as_str()
                .ok_or_else(|| wrong("a uuid string"))?
                .parse()
                .map_err(|e| format!("bad uuid: {e}"))?,
        ),
        S::Enum(inner) => {
            let symbol = json.as_str().ok_or_else(|| wrong("an enum symbol"))?;
            let index = inner
                .symbols
                .iter()
                .position(|s| s == symbol)
                .ok_or_else(|| format!("'{symbol}' is not a symbol of this enum"))?;
            A::Enum(index as u32, symbol.to_string())
        }
        S::Array(inner) => {
            let items = json.as_array().ok_or_else(|| wrong("an array"))?;
            A::Array(
                items
                    .iter()
                    .map(|item| try_decode(item, &inner.items, named))
                    .collect::<Result<_, _>>()?,
            )
        }
        S::Map(inner) => {
            let entries = json.as_object().ok_or_else(|| wrong("an object"))?;
            let mut out = HashMap::new();
            for (key, value) in entries {
                out.insert(key.clone(), try_decode(value, &inner.types, named)?);
            }
            A::Map(out)
        }
        S::Record(record) => {
            let entries = json.as_object().ok_or_else(|| wrong("an object"))?;
            let mut fields = Vec::new();
            for field in &record.fields {
                let value = match entries.get(&field.name) {
                    Some(value) => try_decode(value, &field.schema, named)
                        .map_err(|why| format!("field '{}': {why}", field.name))?,
                    // Feature 5 lets a null-valued field be left out entirely,
                    // which is what a JSON producer that omits empty properties
                    // will hand us.
                    None => null_of(&field.schema)
                        .ok_or_else(|| format!("missing field '{}'", field.name))?,
                };
                fields.push((field.name.clone(), value));
            }
            for key in entries.keys() {
                if !record.fields.iter().any(|f| f.name == *key) {
                    return Err(format!(
                        "'{key}' is not a field of {}",
                        record.name.fullname(None)
                    ));
                }
            }
            A::Record(fields)
        }
        // Feature 5 and 6: Plain JSON carries no branch tag, so the branch is
        // whichever one the value fits. The spec makes ambiguity an error
        // rather than a first-match race, and so does this: exactly one branch
        // must accept the value.
        S::Union(union) => {
            let branches = union.variants();
            let mut matched: Option<(usize, apache_avro::types::Value)> = None;
            let mut why: Vec<String> = Vec::new();
            for (index, branch) in branches.iter().enumerate() {
                match try_decode(json, branch, named) {
                    Ok(value) => {
                        if let Some((first, _)) = matched {
                            return Err(format!(
                                "ambiguous union: the value fits both branch {first} and \
                                 branch {index}, so no decoder can choose"
                            ));
                        }
                        matched = Some((index, value));
                    }
                    Err(reason) => why.push(format!("  branch {index}: {reason}")),
                }
            }
            let (index, value) =
                matched.ok_or_else(|| format!("no union branch fits:\n{}", why.join("\n")))?;
            A::Union(index as u32, Box::new(value))
        }
        S::Ref { name } => {
            let target = named
                .get(&name.fullname(None))
                .ok_or_else(|| format!("unresolved ref {name:?}"))?;
            return try_decode(json, target, named);
        }
        other => return Err(format!("unsupported schema {other:?}")),
    })
}

/// The null value of a schema that can hold one, for the omitted-field rule.
fn null_of(schema: &apache_avro::Schema) -> Option<apache_avro::types::Value> {
    use apache_avro::types::Value as A;
    use apache_avro::Schema as S;
    match schema {
        S::Null => Some(A::Null),
        S::Union(union) => union
            .variants()
            .iter()
            .position(|b| matches!(b, S::Null))
            .map(|index| A::Union(index as u32, Box::new(A::Null))),
        _ => None,
    }
}

fn base64(text: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .map_err(|e| format!("bad base64: {e}"))
}

/// Reads a decimal in JSON number syntax into the unscaled two's-complement
/// big-endian bytes Avro puts on the wire.
///
/// `i128` caps this at 38 significant digits. Avro's `decimal` is unbounded, so
/// a corpus case beyond that range would need a big-integer type — but a
/// fixture that large tests the harness's arithmetic rather than the mapping,
/// and the limit is worth the absence of a dependency.
fn unscaled(text: &str, scale: usize) -> Result<Vec<u8>, String> {
    let (sign, digits) = match text.strip_prefix('-') {
        Some(rest) => (-1i128, rest),
        None => (1i128, text.strip_prefix('+').unwrap_or(text)),
    };
    let (whole, fraction) = match digits.split_once('.') {
        Some((whole, fraction)) => (whole, fraction),
        None => (digits, ""),
    };
    if fraction.len() > scale {
        return Err(format!(
            "'{text}' has {} fraction digits, more than the schema's scale of {scale}",
            fraction.len()
        ));
    }
    let padded = format!("{whole}{fraction}{}", "0".repeat(scale - fraction.len()));
    let magnitude: i128 = padded
        .parse()
        .map_err(|e| format!("'{text}' is not a decimal: {e}"))?;
    Ok(twos_complement(sign * magnitude))
}

/// The shortest big-endian two's-complement encoding of a value, which is what
/// Avro's `decimal` expects and what a longer encoding would not compare equal
/// to.
fn twos_complement(value: i128) -> Vec<u8> {
    let bytes = value.to_be_bytes();
    let fill = if value < 0 { 0xFF } else { 0x00 };
    let mut start = 0;
    // Drop a leading fill byte only while the next byte still carries the sign,
    // so that the sign bit survives.
    while start + 1 < bytes.len() && bytes[start] == fill && (bytes[start + 1] ^ fill) & 0x80 == 0 {
        start += 1;
    }
    bytes[start..].to_vec()
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
/// The error paths of the Plain JSON decoder.
///
/// The corpus only carries instances that are meant to decode, so it exercises
/// none of the decoder's guards: mutating any of them away leaves the corpus
/// green. These tests hold those guards, and each corresponds to a mutation the
/// corpus was measured against and failed to catch.
mod plain_json_errors {
    use super::try_decode;
    use std::collections::HashMap;

    fn attempt(schema: &str, json: &str) -> Result<apache_avro::types::Value, String> {
        let schema = apache_avro::Schema::parse_str(schema).expect("a valid schema");
        let json: serde_json::Value = serde_json::from_str(json).expect("valid json");
        try_decode(&json, &schema, &HashMap::new())
    }

    fn rejects(schema: &str, json: &str) -> String {
        attempt(schema, json).expect_err("this instance must not decode")
    }

    /// Two branches of the same shape are a decoding failure, not a race.
    ///
    /// Plain JSON resolves a union by structure, so a union whose branches are
    /// not structurally distinguishable cannot be decoded by anybody. Taking the
    /// first match would hand back a plausible wrong answer instead of saying so.
    #[test]
    fn refuses_a_union_whose_branches_are_indistinguishable() {
        let why = rejects(
            r#"["null",
                {"type": "record", "name": "A", "fields": [{"name": "x", "type": "int"}]},
                {"type": "record", "name": "B", "fields": [{"name": "x", "type": "int"}]}]"#,
            r#"{"x": 1}"#,
        );
        assert!(why.contains("ambiguous union"), "{why}");
    }

    /// An unambiguous union still resolves. Without this, the test above is
    /// satisfied by a decoder that rejects every union.
    #[test]
    fn resolves_a_union_whose_branches_differ() {
        let schema = r#"["null",
            {"type": "record", "name": "A", "fields": [{"name": "x", "type": "int"}]},
            {"type": "record", "name": "B", "fields": [{"name": "y", "type": "int"}]}]"#;
        attempt(schema, r#"{"y": 1}"#).expect("the second branch fits");
        attempt(schema, "null").expect("null fits the first branch");
    }

    /// Only a field that can hold null may be left out.
    ///
    /// Feature 5 lets a producer drop a null-valued property. Read too loosely,
    /// that turns every absent required field into a silent null and Avro then
    /// writes a record the schema does not describe.
    #[test]
    fn refuses_an_omitted_field_that_cannot_hold_null() {
        let why = rejects(
            r#"{"type": "record", "name": "R", "fields": [{"name": "x", "type": "int"}]}"#,
            "{}",
        );
        assert!(why.contains("missing field 'x'"), "{why}");
    }

    #[test]
    fn accepts_an_omitted_field_that_can_hold_null() {
        attempt(
            r#"{"type": "record", "name": "R",
                "fields": [{"name": "x", "type": ["null", "int"]}]}"#,
            "{}",
        )
        .expect("an absent nullable field is null");
    }

    /// A decimal carrying more precision than the schema declares is rejected.
    ///
    /// Avro stores a decimal as an unscaled integer at a fixed scale, so an
    /// extra fraction digit has nowhere to go. Rounding it away would lose money
    /// quietly, which is the one thing a decimal type exists to prevent.
    #[test]
    fn refuses_a_decimal_finer_than_its_scale() {
        let why = rejects(
            r#"{"type": "bytes", "logicalType": "decimal", "precision": 9, "scale": 2}"#,
            "\"1.234\"",
        );
        assert!(why.contains("more than the schema's scale"), "{why}");
    }

    #[test]
    fn accepts_a_decimal_within_its_scale() {
        attempt(
            r#"{"type": "bytes", "logicalType": "decimal", "precision": 9, "scale": 2}"#,
            "\"-1.2\"",
        )
        .expect("two fraction digits fit a scale of two");
    }

    /// A long must be quoted, and bytes must be base64.
    ///
    /// Both are places where Plain JSON deliberately departs from what a reader
    /// might assume, so both are places a lenient decoder would paper over a
    /// producer that got it wrong.
    #[test]
    fn refuses_an_unquoted_long_and_unencoded_bytes() {
        let why = rejects("\"long\"", "5000000000");
        assert!(why.contains("a long as a quoted number"), "{why}");
        let why = rejects("\"bytes\"", "\"not base64!\"");
        assert!(why.contains("base64"), "{why}");
    }
}
