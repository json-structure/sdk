//! Measures what the Avro compiler costs.
//!
//! The compiler runs on the developer's behalf every time a schema is loaded,
//! so "fast" is a claim the SDK makes and this is where it gets checked. Run:
//!
//! ```text
//! cargo run --release --example avro_bench --features avro
//! ```
//!
//! Three numbers are reported per case, because only the middle one is ours:
//!
//! - **parse** — `serde_json` turning the document text into a `Value`.
//! - **compile** — the JSON Structure to Avro schema conversion itself.
//! - **avro** — `apache_avro::Schema::parse_str` ingesting the result.
//!
//! The third is the useful yardstick. A developer who hand-writes an `.avsc`
//! still pays it, so if compiling costs appreciably less than parsing the
//! output, the conversion is free in any sense that matters.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn main() {
    let root = corpus_root();
    let mut cases: Vec<(String, String)> = std::fs::read_dir(root.join("valid"))
        .expect("the corpus is readable")
        .filter_map(|entry| {
            let dir = entry.ok()?.path();
            let source = std::fs::read_to_string(dir.join("schema.struct.json")).ok()?;
            let name = dir.file_name()?.to_string_lossy().into_owned();
            Some((name, source))
        })
        .collect();
    cases.sort();
    assert!(!cases.is_empty(), "no cases found under {}", root.display());

    println!(
        "{:<32} {:>6} {:>11} {:>11} {:>11}  compile vs avro",
        "case", "bytes", "parse", "compile", "avro"
    );
    println!("{}", "-".repeat(96));

    let mut totals = (Duration::ZERO, Duration::ZERO, Duration::ZERO);
    for (name, source) in &cases {
        let parse = time(|| {
            let _: serde_json::Value = serde_json::from_str(source).expect("document parses");
        });

        let document: serde_json::Value = serde_json::from_str(source).expect("document parses");
        let compile = time(|| {
            json_structure::avro::compile(&document).expect("document compiles");
        });

        let schema = json_structure::avro::compile(&document).expect("document compiles");
        let text = serde_json::to_string(&schema).expect("schema serializes");
        let avro = time(|| {
            apache_avro::Schema::parse_str(&text).expect("schema parses");
        });

        totals.0 += parse;
        totals.1 += compile;
        totals.2 += avro;

        println!(
            "{:<32} {:>6} {:>11} {:>11} {:>11}  {:>6.2}x",
            name,
            source.len(),
            us(parse),
            us(compile),
            us(avro),
            ratio(compile, avro),
        );
    }

    println!("{}", "-".repeat(96));
    println!(
        "{:<32} {:>6} {:>11} {:>11} {:>11}  {:>6.2}x",
        format!("total ({} cases)", cases.len()),
        "",
        us(totals.0),        us(totals.1),
        us(totals.2),
        ratio(totals.1, totals.2),
    );

    end_to_end();
    scaling();
}

/// What a developer actually pays.
///
/// The corpus table isolates the conversion. This compares the whole path a
/// developer takes — text in, usable `Schema` out — against the alternative
/// they would otherwise have: parsing a hand-written `.avsc`.
fn end_to_end() {
    let source = std::fs::read_to_string(
        corpus_root()
            .join("valid")
            .join("collections-of-types")
            .join("schema.struct.json"),
    )
    .expect("the case is readable");
    let avsc = serde_json::to_string(
        &json_structure::avro::compile(
            &serde_json::from_str(&source).expect("document parses"),
        )
        .expect("document compiles"),
    )
    .expect("schema serializes");

    let ours = time(|| {
        json_structure::avro::schema_from_jstruct_str(&source).expect("schema loads");
    });
    let theirs = time(|| {
        apache_avro::Schema::parse_str(&avsc).expect("schema parses");
    });

    // Break our side down, so the answer to "why is it slower" is measured
    // rather than assumed.
    let document: serde_json::Value = serde_json::from_str(&source).expect("document parses");
    let doc_parse = time(|| {
        let _: serde_json::Value = serde_json::from_str(&source).expect("document parses");
    });
    let compile = time(|| {
        json_structure::avro::compile(&document).expect("document compiles");
    });
    let compiled = json_structure::avro::compile(&document).expect("document compiles");
    let ingest = time(|| {
        apache_avro::Schema::parse(&compiled).expect("schema parses");
    });

    println!();
    println!("End to end, text in and `Schema` out (collections-of-types):");
    println!("  schema_from_jstruct_str  {}", us(ours));
    println!(
        "  Schema::parse_str(.avsc) {}          {:.2}x",
        us(theirs),
        ratio(ours, theirs)
    );
    println!("  of which:");
    println!("    parse the document     {}", us(doc_parse));
    println!("    compile to Avro        {}", us(compile));
    println!("    hand to apache-avro    {}", us(ingest));
    println!(
        "    unaccounted            {}",
        us(ours.saturating_sub(doc_parse + compile + ingest))
    );
}

/// Confirms the conversion is linear in the size of the document.
///
/// Single-digit microseconds on a 1 KB schema says nothing about a generated
/// 5,000-property document. A compiler that is quadratic in property count is
/// fast on the corpus and unusable in production, and the corpus would never
/// tell you.
fn scaling() {
    println!();
    println!(
        "{:<12} {:>8} {:>12} {:>14}",
        "properties", "bytes", "compile", "us/property"
    );
    println!("{}", "-".repeat(50));

    for count in [10usize, 100, 1_000, 10_000] {
        let mut properties = serde_json::Map::new();
        for i in 0..count {
            properties.insert(
                format!("field{i}"),
                serde_json::json!({ "type": if i % 2 == 0 { "string" } else { "int32" } }),
            );
        }
        let document = serde_json::json!({
            "$schema": "https://json-structure.org/meta/core/v0/#",
            "$id": "https://example.com/wide",
            "name": "Wide",
            "type": "object",
            "properties": properties,
        });
        let bytes = serde_json::to_string(&document).expect("document serializes").len();

        let compile = time(|| {
            json_structure::avro::compile(&document).expect("document compiles");
        });

        println!(
            "{:<12} {:>8} {:>12} {:>14.3}",
            count,
            bytes,
            us(compile),
            compile.as_secs_f64() * 1e6 / count as f64,
        );
    }
}

/// Runs `f` enough times to outrun the clock, and returns the per-call cost.
///
/// These schemas compile in single-digit microseconds, which is close enough to
/// timer granularity that a single measurement is noise. Each case is warmed
/// and then batched until the batch takes at least 50ms.
fn time(mut f: impl FnMut()) -> Duration {
    for _ in 0..100 {
        f();
    }

    let mut iterations = 1_000u32;
    loop {
        let start = Instant::now();
        for _ in 0..iterations {
            f();
        }
        let elapsed = start.elapsed();
        if elapsed >= Duration::from_millis(50) || iterations >= 1_000_000 {
            return elapsed / iterations;
        }
        iterations *= 10;
    }
}

fn us(d: Duration) -> String {
    format!("{:.2}us", d.as_secs_f64() * 1e6)
}

fn ratio(a: Duration, b: Duration) -> f64 {
    a.as_secs_f64() / b.as_secs_f64()
}

fn corpus_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("the crate has a parent")
        .join("test-assets")
        .join("avro")
}
