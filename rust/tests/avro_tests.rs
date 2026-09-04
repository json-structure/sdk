//! Conformance tests for the JSON Structure to Avro compiler.
//!
//! Every generated schema is fed to a real Avro parser, so a test that passes
//! here has produced Avro that Avro itself accepts.

use apache_avro::Schema as AvroSchema;
use json_structure::avro::{self, AdditionalProperties, AvroOptions, Mode};
use serde_json::{json, Value};

/// Compiles and asserts the output parses as real Avro.
fn compile(schema: &Value) -> Value {
    let out = avro::compile(schema).expect("compilation should succeed");
    let text = serde_json::to_string(&out).unwrap();
    AvroSchema::parse_str(&text)
        .unwrap_or_else(|e| panic!("generated schema is not valid Avro: {e}\n{text}"));
    out
}

fn doc(body: Value) -> Value {
    let mut root = json!({
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "$id": "https://example.com/test"
    });
    for (key, value) in body.as_object().unwrap() {
        root[key] = value.clone();
    }
    root
}

// -- primitives (§2) -------------------------------------------------------

#[test]
fn primitives_map_without_logical_types() {
    let cases = [
        ("boolean", json!("boolean")),
        ("string", json!("string")),
        ("number", json!("double")),
        ("integer", json!("int")),
        ("int8", json!("int")),
        ("int16", json!("int")),
        ("int32", json!("int")),
        ("int64", json!("long")),
        ("uint8", json!("int")),
        ("uint16", json!("int")),
        ("uint32", json!("long")),
        ("float8", json!("float")),
        ("float", json!("float")),
        ("double", json!("double")),
        ("binary", json!("bytes")),
    ];
    for (js_type, expected) in cases {
        let schema = doc(json!({
            "name": "T", "type": "object",
            "properties": { "v": { "type": js_type } },
            "required": ["v"]
        }));
        let out = compile(&schema);
        assert_eq!(out["fields"][0]["type"], expected, "for {js_type}");
        assert!(
            out["fields"][0]["type"].get("logicalType").is_none(),
            "no logical types, ever"
        );
    }
}

#[test]
fn lossless_types_travel_as_strings() {
    // Avro has no offset-carrying temporal type and no unsigned 64-bit integer,
    // so these keep their lexical form rather than being silently truncated.
    for js_type in [
        "time",
        "datetime",
        "duration",
        "uuid",
        "uri",
        "jsonpointer",
        "decimal",
        "int128",
        "uint64",
        "uint128",
    ] {
        let schema = doc(json!({
            "name": "T", "type": "object",
            "properties": { "v": { "type": js_type } },
            "required": ["v"]
        }));
        assert_eq!(compile(&schema)["fields"][0]["type"], json!("string"), "for {js_type}");
    }
}

#[test]
fn date_uses_the_standard_avro_logical_type_in_both_modes() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": { "v": { "type": "date" } },
        "required": ["v"]
    }));

    for mode in [Mode::Compact, Mode::Full] {
        let options = AvroOptions {
            mode,
            ..AvroOptions::default()
        };
        let out = avro::compile_with(&schema, &options).unwrap();
        assert_eq!(
            out.schema["fields"][0]["type"],
            json!({"type": "int", "logicalType": "date"})
        );
    }
}

// -- fields, required, defaults (§3.2) -------------------------------------

#[test]
fn optional_fields_are_nullable_with_a_null_default() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": { "a": { "type": "string" }, "b": { "type": "int32" } },
        "required": ["a"]
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["type"], json!("string"));
    assert!(out["fields"][0].get("default").is_none());
    assert_eq!(out["fields"][1]["type"], json!(["null", "int"]));
    assert_eq!(out["fields"][1]["default"], Value::Null);
}

#[test]
fn a_non_null_default_puts_the_declared_type_first() {
    // Avro validates a default against the first union branch.
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": { "a": { "type": "string", "default": "x" } }
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["type"], json!(["string", "null"]));
    assert_eq!(out["fields"][0]["default"], json!("x"));
}

#[test]
fn field_order_follows_document_order_not_alphabetical() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": {
            "zebra": { "type": "string" },
            "apple": { "type": "string" },
            "mango": { "type": "string" }
        },
        "required": ["zebra", "apple", "mango"]
    }));
    let out = compile(&schema);
    let names: Vec<&str> = out["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["zebra", "apple", "mango"]);
}

// -- collections (§3.3, §3.4, §3.5) ----------------------------------------

#[test]
fn arrays_and_sets_produce_identical_avro() {
    let make = |t: &str| {
        doc(json!({
            "name": "T", "type": "object",
            "properties": { "v": { "type": t, "items": { "type": "string" } } },
            "required": ["v"]
        }))
    };
    let as_array = compile(&make("array"));
    let as_set = compile(&make("set"));
    assert_eq!(as_array, as_set);
    assert_eq!(as_array["fields"][0]["type"], json!({"type": "array", "items": "string"}));
}

#[test]
fn maps_carry_their_value_type() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": { "v": { "type": "map", "values": { "type": "int64" } } },
        "required": ["v"]
    }));
    assert_eq!(
        compile(&schema)["fields"][0]["type"],
        json!({"type": "map", "values": "long"})
    );
}

#[test]
fn tuples_follow_the_tuple_order_and_are_all_required() {
    let schema = doc(json!({
        "name": "Pair", "type": "tuple",
        "properties": { "age": { "type": "int32" }, "name": { "type": "string" } },
        "tuple": ["name", "age"]
    }));
    let out = compile(&schema);
    assert_eq!(out["type"], "record");
    assert_eq!(out["fields"][0]["name"], "name");
    assert_eq!(out["fields"][0]["type"], json!("string"));
    assert_eq!(out["fields"][1]["name"], "age");
    // Not nullable: tuple members are implicitly required.
    assert_eq!(out["fields"][1]["type"], json!("int"));
}

// -- any (§3.6) ------------------------------------------------------------

#[test]
fn any_is_an_empty_record_that_a_writer_can_fill() {
    let schema = doc(json!({
        "name": "Envelope", "type": "object",
        "properties": { "payload": { "type": "any" } },
        "required": ["payload"]
    }));
    let out = compile(&schema);
    let payload = &out["fields"][0]["type"];
    assert_eq!(payload["type"], "record");
    assert_eq!(payload["fields"], json!([]));
    assert_eq!(payload["name"], "Envelope_payload");
}

#[test]
fn any_warns_that_the_hole_is_read_only() {
    let schema = doc(json!({
        "name": "Envelope", "type": "object",
        "properties": { "payload": { "type": "any" } },
        "required": ["payload"]
    }));
    let out = avro::compile_with(&schema, &AvroOptions::default()).unwrap();
    assert!(
        out.warnings.iter().any(|w| w.message.contains("not writable")),
        "`any` must tell the caller it cannot be written through: {:?}",
        out.warnings
    );
}

/// The `any` contract, exercised over real bytes rather than asserted about.
///
/// A writer fills the hole with a concrete record; a reader holding the
/// compiled schema resolves against it, steps over the payload it does not
/// know, and still gets every field it *does* know. That round trip is the
/// entire justification for mapping `any` to an empty record, and until this
/// test existed nothing proved it.
#[test]
fn a_reader_steps_over_an_any_payload_a_writer_filled() {
    use apache_avro::{types::Record, types::Value as AvroValue, Reader, Writer};

    let reader_schema = {
        let text = serde_json::to_string(&compile(&doc(json!({
            "name": "Envelope", "type": "object",
            "properties": { "id": { "type": "string" }, "payload": { "type": "any" } },
            "required": ["id", "payload"]
        }))))
        .unwrap();
        AvroSchema::parse_str(&text).unwrap()
    };

    // The writer schema is the same document with the hole filled in. It is a
    // separate compilation, which is precisely how a producer is meant to work.
    let writer_schema = {
        let text = serde_json::to_string(&compile(&doc(json!({
            "name": "Envelope", "type": "object",
            "properties": {
                "id": { "type": "string" },
                "payload": {
                    "type": "object",
                    "properties": { "lat": { "type": "double" }, "lon": { "type": "double" } },
                    "required": ["lat", "lon"]
                }
            },
            "required": ["id", "payload"]
        }))))
        .unwrap();
        AvroSchema::parse_str(&text).unwrap()
    };

    let mut record = Record::new(&writer_schema).unwrap();
    record.put("id", "a1");
    record.put(
        "payload",
        AvroValue::Record(vec![
            ("lat".to_string(), AvroValue::Double(51.2)),
            ("lon".to_string(), AvroValue::Double(4.4)),
        ]),
    );
    let mut writer = Writer::new(&writer_schema, Vec::new());
    writer.append(record).unwrap();
    let bytes = writer.into_inner().unwrap();

    let values: Vec<_> = Reader::with_schema(&reader_schema, &bytes[..])
        .expect("the compiled schema must resolve against a writer that filled the hole")
        .map(Result::unwrap)
        .collect();

    let AvroValue::Record(fields) = &values[0] else {
        panic!("expected a record, got {:?}", values[0])
    };
    assert_eq!(fields[0].1, AvroValue::String("a1".to_string()));
    assert_eq!(
        fields[1].1,
        AvroValue::Record(vec![]),
        "the reader must step over the payload it does not know"
    );
}

/// The other half of the contract: the hole is a hole. Writing a payload
/// through the compiled schema is not merely unsupported, it is rejected, and
/// the warning on `any` exists to say so before anyone discovers it at runtime.
#[test]
fn writing_a_payload_through_the_any_hole_is_rejected() {
    use apache_avro::{types::Record, types::Value as AvroValue, Writer};

    let text = serde_json::to_string(&compile(&doc(json!({
        "name": "Envelope", "type": "object",
        "properties": { "payload": { "type": "any" } },
        "required": ["payload"]
    }))))
    .unwrap();
    let schema = AvroSchema::parse_str(&text).unwrap();

    let mut record = Record::new(&schema).unwrap();
    record.put(
        "payload",
        AvroValue::Record(vec![("x".to_string(), AvroValue::Int(1))]),
    );
    let mut writer = Writer::new(&schema, Vec::new());
    assert!(
        writer.append(record).is_err(),
        "a non-empty payload must not be writable against a zero-field record"
    );
}

#[test]
fn two_any_positions_get_distinct_names() {
    // Avro forbids two definitions of one name, so the holes cannot share one.
    let schema = doc(json!({
        "name": "E", "type": "object",
        "properties": { "a": { "type": "any" }, "b": { "type": "any" } },
        "required": ["a", "b"]
    }));
    let out = compile(&schema);
    assert_ne!(out["fields"][0]["type"]["name"], out["fields"][1]["type"]["name"]);
}

// -- alternative `required` sets (§3.2) ------------------------------------

/// Core lets `required` be a list of alternative sets. Neither target can
/// express the disjunction, and the previous behavior — dropping the keyword
/// entirely — retyped every field in the record.
#[test]
fn alternative_required_sets_collapse_to_their_intersection() {
    let schema = doc(json!({
        "name": "Animal", "type": "object",
        "properties": {
            "name": { "type": "string" },
            "fins": { "type": "int32" },
            "legs": { "type": "int32" }
        },
        "required": [["name", "fins"], ["name", "legs"]]
    }));
    let out = compile(&schema);
    let fields = out["fields"].as_array().unwrap();
    assert_eq!(fields[0]["type"], json!("string"), "`name` holds in every alternative");
    assert_eq!(fields[1]["type"], json!(["null", "int"]));
    assert_eq!(fields[2]["type"], json!(["null", "int"]));
}

#[test]
fn alternative_required_sets_warn_that_the_choice_is_unenforced() {
    let schema = doc(json!({
        "name": "Animal", "type": "object",
        "properties": { "name": { "type": "string" }, "fins": { "type": "int32" } },
        "required": [["name", "fins"], ["name"]]
    }));
    let out = avro::compile_with(&schema, &AvroOptions::default()).unwrap();
    assert!(
        out.warnings.iter().any(|w| w.message.contains("alternative sets")),
        "{:?}",
        out.warnings
    );
}

#[test]
fn a_flat_required_list_is_unaffected() {
    let schema = doc(json!({
        "name": "Animal", "type": "object",
        "properties": { "name": { "type": "string" }, "legs": { "type": "int32" } },
        "required": ["name", "legs"]
    }));
    let out = avro::compile_with(&schema, &AvroOptions::default()).unwrap();
    assert_eq!(out.schema["fields"][0]["type"], json!("string"));
    assert_eq!(out.schema["fields"][1]["type"], json!("int"));
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
}

// -- defaults on unions (§3.2) ---------------------------------------------
/// Avro validates a field default against the first union branch and nothing
/// else, so a default naming a later branch has to move the branch.
#[test]
fn a_tagged_default_rotates_its_branch_to_the_front_and_loses_the_tag() {
    let schema = doc(json!({
        "name": "V", "type": "object",
        "properties": {
            "v": {
                "type": "choice",
                "choices": { "text": { "type": "string" }, "count": { "type": "int32" } },
                "default": { "count": 7 }
            }
        },
        "required": ["v"]
    }));
    let out = compile(&schema);
    let branches = out["fields"][0]["type"].as_array().unwrap();
    assert_eq!(branches[0]["name"], "count", "the defaulted branch must lead");
    assert_eq!(branches[1]["name"], "text");
    assert_eq!(
        out["fields"][0]["default"],
        json!({ "value": 7 }),
        "the union tag is consumed; the branch record's own value remains"
    );
}

#[test]
fn an_untagged_default_still_finds_its_branch() {
    let schema = doc(json!({
        "name": "V", "type": "object",
        "properties": {
            "v": {
                "type": "choice",
                "choices": { "string": { "type": "string" }, "int": { "type": "int32" } },
                "default": 7
            }
        },
        "required": ["v"]
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["type"], json!(["int", "string"]));
    assert_eq!(out["fields"][0]["default"], json!(7));
}

/// The failure this whole mechanism exists to prevent: `parse_str` accepts a
/// default that matches no branch, and the error only surfaces later, against
/// real data, as a resolution failure.
#[test]
fn a_default_that_matches_no_branch_is_an_error() {
    let schema = doc(json!({
        "name": "V", "type": "object",
        "properties": {
            "v": {
                "type": "choice",
                "choices": { "string": { "type": "string" }, "int": { "type": "int32" } },
                "default": true
            }
        },
        "required": ["v"]
    }));
    let error = avro::compile(&schema).expect_err("a boolean fits neither branch");
    let text = error.to_string();
    assert!(text.contains("matches no branch"), "{text}");
    assert!(text.contains("/properties/v"), "{text}");
}

#[test]
fn an_optional_field_with_a_default_keeps_the_default_branch_first() {
    let schema = doc(json!({
        "name": "V", "type": "object",
        "properties": { "n": { "type": "int32", "default": 3 } }
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["type"], json!(["int", "null"]));
    assert_eq!(out["fields"][0]["default"], json!(3));
}

/// A default is only worth emitting if a reader can actually use it, so read a
/// record written *without* the field and check the value comes back.
#[test]
fn a_reader_resolves_a_union_default_for_a_field_the_writer_omitted() {
    use apache_avro::{types::Record, types::Value as AvroValue, Reader, Writer};

    let writer_schema = AvroSchema::parse_str(
        r#"{"type":"record","name":"V","fields":[{"name":"id","type":"string"}]}"#,
    )
    .unwrap();

    let reader_schema = {
        let text = serde_json::to_string(&compile(&doc(json!({
            "name": "V", "type": "object",
            "properties": {
                "id": { "type": "string" },
                "v": {
                    "type": "choice",
                    "choices": { "string": { "type": "string" }, "int": { "type": "int32" } },
                    "default": 7
                }
            },
            "required": ["id", "v"]
        }))))
        .unwrap();
        AvroSchema::parse_str(&text).unwrap()
    };

    let mut record = Record::new(&writer_schema).unwrap();
    record.put("id", "a1");
    let mut writer = Writer::new(&writer_schema, Vec::new());
    writer.append(record).unwrap();
    let bytes = writer.into_inner().unwrap();

    let values: Vec<_> = Reader::with_schema(&reader_schema, &bytes[..])
        .unwrap()
        .map(|v| v.expect("the default must resolve against the first branch"))
        .collect();
    let AvroValue::Record(fields) = &values[0] else {
        panic!("expected a record")
    };
    assert_eq!(fields[1].1, AvroValue::Union(0, Box::new(AvroValue::Int(7))));
}

// -- choice (§3.7) ---------------------------------------------------------

#[test]
fn a_tagged_union_keyed_by_avro_type_names_needs_no_wrappers() {
    let schema = doc(json!({
        "name": "V", "type": "object",
        "properties": {
            "v": {
                "type": "choice",
                "choices": { "string": { "type": "string" }, "int": { "type": "int32" } }
            }
        },
        "required": ["v"]
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["type"], json!(["string", "int"]));
}

#[test]
fn a_tagged_union_with_other_keys_wraps_each_branch() {
    let schema = doc(json!({
        "name": "V", "type": "object",
        "properties": {
            "v": {
                "type": "choice",
                "choices": { "text": { "type": "string" }, "count": { "type": "int32" } }
            }
        },
        "required": ["v"]
    }));
    let out = compile(&schema);
    let branches = out["fields"][0]["type"].as_array().unwrap();
    assert_eq!(branches[0]["name"], "text");
    assert_eq!(branches[0]["fields"][0]["type"], json!("string"));
    assert_eq!(branches[1]["name"], "count");
}

#[test]
fn an_inline_union_injects_the_selector_into_every_branch() {
    let schema = doc(json!({
        "$root": "#/definitions/Address",
        "definitions": {
            "Address": {
                "type": "choice",
                "$extends": "#/definitions/AddressBase",
                "selector": "addressType",
                "choices": {
                    "StreetAddress": { "type": { "$ref": "#/definitions/StreetAddress" } },
                    "PoBoxAddress": { "type": { "$ref": "#/definitions/PoBoxAddress" } }
                }
            },
            "AddressBase": {
                "abstract": true,
                "type": "object",
                "properties": { "city": { "type": "string" } },
                "required": ["city"]
            },
            "StreetAddress": {
                "type": "object",
                "$extends": "#/definitions/AddressBase",
                "properties": { "street": { "type": "string" } },
                "required": ["street"]
            },
            "PoBoxAddress": {
                "type": "object",
                "$extends": "#/definitions/AddressBase",
                "properties": { "poBox": { "type": "string" } },
                "required": ["poBox"]
            }
        }
    }));
    let out = compile(&schema);
    let branches = out.as_array().unwrap();
    assert_eq!(branches.len(), 2);
    for branch in branches {
        assert_eq!(branch["fields"][0]["name"], "addressType");
        assert_eq!(branch["fields"][0]["type"], json!("string"));
        // Base properties are flattened in ahead of the branch's own.
        assert_eq!(branch["fields"][1]["name"], "city");
    }
    assert_eq!(branches[0]["fields"][2]["name"], "street");
    assert_eq!(branches[1]["fields"][2]["name"], "poBox");
}

// -- unions (§3.8) ---------------------------------------------------------

#[test]
fn union_branches_collapsing_to_one_avro_type_are_deduplicated() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": { "v": { "type": ["int8", "int16"] } },
        "required": ["v"]
    }));
    // Both are `int`, so the one-branch union collapses to the bare type.
    assert_eq!(compile(&schema)["fields"][0]["type"], json!("int"));
}

#[test]
fn distinct_union_branches_are_preserved_in_order() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": { "v": { "type": ["string", "int64"] } },
        "required": ["v"]
    }));
    assert_eq!(compile(&schema)["fields"][0]["type"], json!(["string", "long"]));
}

// -- enums (§4) ------------------------------------------------------------

#[test]
fn a_string_enum_with_legal_symbols_becomes_an_avro_enum() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": { "s": { "type": "string", "enum": ["RED", "GREEN"], "default": "RED" } },
        "required": ["s"]
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["type"]["type"], "enum");
    assert_eq!(out["fields"][0]["type"]["symbols"], json!(["RED", "GREEN"]));
    assert_eq!(out["fields"][0]["type"]["default"], "RED");
}

#[test]
fn an_enum_with_illegal_symbols_falls_back_to_string() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": { "s": { "type": "string", "enum": ["in-progress", "done"] } },
        "required": ["s"]
    }));
    assert_eq!(compile(&schema)["fields"][0]["type"], json!("string"));
}

#[test]
fn altenums_avro_rescues_an_otherwise_illegal_enum() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": {
            "s": {
                "type": "string",
                "enum": ["in-progress", "done"],
                "altenums": { "avro": { "in-progress": "IN_PROGRESS", "done": "DONE" } }
            }
        },
        "required": ["s"]
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["type"]["symbols"], json!(["IN_PROGRESS", "DONE"]));
}

// -- names (§6) ------------------------------------------------------------

#[test]
fn altnames_avro_overrides_type_and_field_names() {
    let schema = doc(json!({
        "name": "Person", "type": "object",
        "altnames": { "avro": "PersonRecord" },
        "properties": {
            "firstName": { "type": "string", "altnames": { "json": "first_name", "avro": "first_name" } }
        },
        "required": ["firstName"]
    }));
    let out = compile(&schema);
    assert_eq!(out["name"], "PersonRecord");
    assert_eq!(out["fields"][0]["name"], "first_name");
}

#[test]
fn an_illegal_altname_is_an_error_rather_than_invalid_avro() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "altnames": { "avro": "not-a-legal-name" },
        "properties": { "a": { "type": "string" } }
    }));
    assert!(avro::compile(&schema).is_err());
}

#[test]
fn inline_objects_get_composed_generated_names() {
    let schema = doc(json!({
        "name": "R", "type": "object",
        "properties": {
            "a": {
                "type": "object",
                "properties": { "b": { "type": "object", "properties": { "c": { "type": "string" } }, "required": ["c"] } },
                "required": ["b"]
            }
        },
        "required": ["a"]
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["type"]["name"], "R_a");
    assert_eq!(out["fields"][0]["type"]["fields"][0]["type"]["name"], "R_a_b");
}

#[test]
fn namespaces_come_from_the_definition_path() {
    let schema = doc(json!({
        "$root": "#/definitions/Sales/Order",
        "definitions": {
            "Sales": {
                "Order": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }
            }
        }
    }));
    let out = compile(&schema);
    assert_eq!(out["name"], "Order");
    assert_eq!(out["namespace"], "Sales");
}

#[test]
fn nested_definition_paths_become_dotted_namespaces() {
    let schema = doc(json!({
        "$root": "#/definitions/com/example/Sales/Order",
        "definitions": {
            "com": {
                "example": {
                    "Sales": {
                        "Order": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }
                    }
                }
            }
        }
    }));
    let out = compile(&schema);
    assert_eq!(out["name"], "Order");
    assert_eq!(out["namespace"], "com.example.Sales");
}

#[test]
fn no_option_can_change_a_generated_name_or_namespace() {
    // The document is the source of truth. A schema name is part of the wire
    // contract, so no caller-supplied option may alter it.
    let schema = doc(json!({
        "$root": "#/definitions/Sales/Order",
        "definitions": {
            "Sales": { "Order": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] } }
        }
    }));
    let baseline = avro::compile(&schema).unwrap();
    for opts in [
        AvroOptions { emit_doc: false, ..Default::default() },
        AvroOptions { additional_properties: AdditionalProperties::Error, ..Default::default() },
    ] {
        let out = avro::compile_with(&schema, &opts).unwrap().schema;
        assert_eq!(out["name"], baseline["name"]);
        assert_eq!(out["namespace"], baseline["namespace"]);
    }
}

// -- structure (§5) --------------------------------------------------------

#[test]
fn recursive_types_reference_themselves_by_name() {
    let schema = doc(json!({
        "$root": "#/definitions/Node",
        "definitions": {
            "Node": {
                "type": "object",
                "properties": {
                    "value": { "type": "string" },
                    "children": { "type": "array", "items": { "type": { "$ref": "#/definitions/Node" } } }
                },
                "required": ["value", "children"]
            }
        }
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][1]["type"]["items"], json!("Node"));
}

#[test]
fn a_shared_type_is_defined_once_and_referenced_after() {
    let schema = doc(json!({
        "$root": "#/definitions/Pair",
        "definitions": {
            "Pair": {
                "type": "object",
                "properties": {
                    "left": { "type": { "$ref": "#/definitions/Point" } },
                    "right": { "type": { "$ref": "#/definitions/Point" } }
                },
                "required": ["left", "right"]
            },
            "Point": { "type": "object", "properties": { "x": { "type": "int32" } }, "required": ["x"] }
        }
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["type"]["type"], "record");
    assert_eq!(out["fields"][1]["type"], json!("Point"));
}

#[test]
fn extends_flattens_base_properties_first() {
    let schema = doc(json!({
        "$root": "#/definitions/Employee",
        "definitions": {
            "Person": {
                "abstract": true, "type": "object",
                "properties": { "name": { "type": "string" } }, "required": ["name"]
            },
            "Employee": {
                "type": "object", "$extends": "#/definitions/Person",
                "properties": { "employeeId": { "type": "string" } }, "required": ["employeeId"]
            }
        }
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["name"], "name");
    assert_eq!(out["fields"][1]["name"], "employeeId");
}

#[test]
fn an_abstract_type_used_as_a_value_is_rejected() {
    let schema = doc(json!({
        "$root": "#/definitions/Holder",
        "definitions": {
            "Base": { "abstract": true, "type": "object", "properties": { "a": { "type": "string" } } },
            "Holder": {
                "type": "object",
                "properties": { "b": { "type": { "$ref": "#/definitions/Base" } } },
                "required": ["b"]
            }
        }
    }));
    assert!(avro::compile(&schema).is_err());
}

#[test]
fn addins_are_applied_only_when_requested() {
    let schema = doc(json!({
        "$root": "#/definitions/StreetAddress",
        "$offers": { "DeliveryInstructions": "#/definitions/DeliveryInstructions" },
        "definitions": {
            "StreetAddress": {
                "type": "object",
                "properties": { "street": { "type": "string" } }, "required": ["street"]
            },
            "DeliveryInstructions": {
                "abstract": true, "type": "object",
                "$extends": "#/definitions/StreetAddress",
                "properties": { "instructions": { "type": "string" } }
            }
        }
    }));

    let without = compile(&schema);
    assert_eq!(without["fields"].as_array().unwrap().len(), 1);

    let opts = AvroOptions {
        uses: vec!["DeliveryInstructions".into()],
        ..AvroOptions::default()
    };
    let with = avro::compile_with(&schema, &opts).unwrap().schema;
    assert_eq!(with["fields"].as_array().unwrap().len(), 2);
    assert_eq!(with["fields"][1]["name"], "instructions");
    assert_eq!(with["fields"][1]["type"], json!(["null", "string"]));
}

#[test]
fn an_unknown_addin_is_an_error() {
    let schema = doc(json!({ "name": "T", "type": "object", "properties": { "a": { "type": "string" } } }));
    let opts = AvroOptions {
        uses: vec!["Nope".into()],
        ..AvroOptions::default()
    };
    assert!(avro::compile_with(&schema, &opts).is_err());
}

#[test]
fn open_records_warn_by_default_and_error_on_request() {
    let schema = doc(json!({
        "name": "T", "type": "object",
        "properties": { "a": { "type": "string" } },
        "additionalProperties": true
    }));
    let out = avro::compile_with(&schema, &AvroOptions::default()).unwrap();
    assert_eq!(out.warnings.len(), 1, "data loss must be reported");

    let strict = AvroOptions {
        additional_properties: AdditionalProperties::Error,
        ..AvroOptions::default()
    };
    assert!(avro::compile_with(&schema, &strict).is_err());
}

#[test]
fn a_document_without_a_root_type_is_an_error() {
    let schema = doc(json!({
        "definitions": { "T": { "type": "object", "properties": { "a": { "type": "string" } } } }
    }));
    assert!(avro::compile(&schema).is_err());
}

// -- determinism (§7) ------------------------------------------------------

#[test]
fn compilation_is_byte_deterministic() {
    let schema = doc(json!({
        "$root": "#/definitions/Order",
        "definitions": {
            "Order": {
                "type": "object",
                "properties": {
                    "id": { "type": "uuid" },
                    "lines": { "type": "array", "items": { "type": { "$ref": "#/definitions/Line" } } },
                    "meta": { "type": "map", "values": { "type": "any" } },
                    "status": { "type": "string", "enum": ["NEW", "SHIPPED"] }
                },
                "required": ["id", "lines"]
            },
            "Line": {
                "type": "object",
                "properties": { "sku": { "type": "string" }, "qty": { "type": "uint32" } },
                "required": ["sku", "qty"]
            }
        }
    }));
    let first = serde_json::to_string(&compile(&schema)).unwrap();
    for _ in 0..25 {
        let again = serde_json::to_string(&avro::compile(&schema).unwrap()).unwrap();
        assert_eq!(first, again);
    }
}

#[test]
fn attribute_order_is_fixed() {
    let schema = doc(json!({
        "$root": "#/definitions/Ns/T",
        "definitions": {
            "Ns": {
                "T": {
                    "type": "object",
                    "description": "A thing.",
                    "properties": { "a": { "type": "string" } },
                    "required": ["a"]
                }
            }
        }
    }));
    let text = serde_json::to_string(&compile(&schema)).unwrap();
    let type_at = text.find("\"type\"").unwrap();
    let name_at = text.find("\"name\"").unwrap();
    let ns_at = text.find("\"namespace\"").unwrap();
    let doc_at = text.find("\"doc\"").unwrap();
    let fields_at = text.find("\"fields\"").unwrap();
    assert!(type_at < name_at && name_at < ns_at && ns_at < doc_at && doc_at < fields_at);
}

#[test]
fn addin_order_does_not_depend_on_the_callers_argument_order() {
    let schema = doc(json!({
        "$root": "#/definitions/T",
        "$offers": { "A": "#/definitions/AddA", "B": "#/definitions/AddB" },
        "definitions": {
            "T": { "type": "object", "properties": { "base": { "type": "string" } }, "required": ["base"] },
            "AddA": { "abstract": true, "type": "object", "$extends": "#/definitions/T", "properties": { "a": { "type": "string" } } },
            "AddB": { "abstract": true, "type": "object", "$extends": "#/definitions/T", "properties": { "b": { "type": "string" } } }
        }
    }));
    let forward = AvroOptions { uses: vec!["A".into(), "B".into()], ..Default::default() };
    let reverse = AvroOptions { uses: vec!["B".into(), "A".into()], ..Default::default() };
    let a = avro::compile_with(&schema, &forward).unwrap().schema;
    let b = avro::compile_with(&schema, &reverse).unwrap().schema;
    assert_eq!(a, b);
    assert_eq!(a["fields"][1]["name"], "a");
    assert_eq!(a["fields"][2]["name"], "b");
}

// -- documentation ---------------------------------------------------------

#[test]
fn description_becomes_doc_and_can_be_suppressed() {
    let schema = doc(json!({
        "name": "T", "type": "object", "description": "The type.",
        "properties": { "a": { "type": "string", "description": "The field." } },
        "required": ["a"]
    }));
    let out = compile(&schema);
    assert_eq!(out["doc"], "The type.");
    assert_eq!(out["fields"][0]["doc"], "The field.");

    let quiet = AvroOptions { emit_doc: false, ..AvroOptions::default() };
    let out = avro::compile_with(&schema, &quiet).unwrap().schema;
    assert!(out.get("doc").is_none());
}

// -- $extends edge cases (§5.4) --------------------------------------------

#[test]
fn extends_flattens_a_multi_level_chain_in_base_first_order() {
    let schema = doc(json!({
        "$root": "#/definitions/D",
        "definitions": {
            "A": { "abstract": true, "type": "object", "properties": { "a": { "type": "string" } }, "required": ["a"] },
            "B": { "abstract": true, "type": "object", "$extends": "#/definitions/A", "properties": { "b": { "type": "string" } }, "required": ["b"] },
            "C": { "abstract": true, "type": "object", "$extends": "#/definitions/B", "properties": { "c": { "type": "string" } }, "required": ["c"] },
            "D": { "type": "object", "$extends": "#/definitions/C", "properties": { "d": { "type": "string" } }, "required": ["d"] }
        }
    }));
    let out = compile(&schema);
    let names: Vec<&str> = out["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["a", "b", "c", "d"]);
}

#[test]
fn a_diamond_contributes_the_shared_grandparent_once() {
    let schema = doc(json!({
        "$root": "#/definitions/Joint",
        "definitions": {
            "Base": { "abstract": true, "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] },
            "Left": { "abstract": true, "type": "object", "$extends": "#/definitions/Base", "properties": { "l": { "type": "string" } }, "required": ["l"] },
            "Right": { "abstract": true, "type": "object", "$extends": "#/definitions/Base", "properties": { "r": { "type": "string" } }, "required": ["r"] },
            "Joint": { "type": "object", "$extends": ["#/definitions/Left", "#/definitions/Right"], "properties": { "j": { "type": "string" } }, "required": ["j"] }
        }
    }));
    let out = compile(&schema);
    let names: Vec<&str> = out["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["id", "l", "r", "j"]);
}

#[test]
fn the_first_base_in_the_array_wins_a_name_collision() {
    let schema = doc(json!({
        "$root": "#/definitions/Joint",
        "definitions": {
            "Left": { "abstract": true, "type": "object", "properties": { "shared": { "type": "string" } }, "required": ["shared"] },
            "Right": { "abstract": true, "type": "object", "properties": { "shared": { "type": "int32" } }, "required": ["shared"] },
            "Joint": { "type": "object", "$extends": ["#/definitions/Left", "#/definitions/Right"] }
        }
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"].as_array().unwrap().len(), 1);
    assert_eq!(out["fields"][0]["type"], "string");
}

#[test]
fn an_extends_cycle_is_an_error_rather_than_a_stack_overflow() {
    let schema = doc(json!({
        "$root": "#/definitions/C",
        "definitions": {
            "A": { "abstract": true, "type": "object", "$extends": "#/definitions/B", "properties": { "a": { "type": "string" } } },
            "B": { "abstract": true, "type": "object", "$extends": "#/definitions/A", "properties": { "b": { "type": "string" } } },
            "C": { "type": "object", "$extends": "#/definitions/A" }
        }
    }));
    let err = avro::compile(&schema).unwrap_err().to_string();
    assert!(err.contains("`$extends` cycle"), "{err}");
}

#[test]
fn a_type_that_extends_itself_is_an_error() {
    let schema = doc(json!({
        "$root": "#/definitions/A",
        "definitions": {
            "A": { "type": "object", "$extends": "#/definitions/A", "properties": { "a": { "type": "string" } } }
        }
    }));
    let err = avro::compile(&schema).unwrap_err().to_string();
    assert!(err.contains("`$extends` cycle"), "{err}");
}

#[test]
fn redefining_an_inherited_property_is_an_error() {
    let schema = doc(json!({
        "$root": "#/definitions/Dog",
        "definitions": {
            "Animal": { "abstract": true, "type": "object", "properties": { "age": { "type": "int32" } }, "required": ["age"] },
            "Dog": { "type": "object", "$extends": "#/definitions/Animal", "properties": { "age": { "type": "string" } }, "required": ["age"] }
        }
    }));
    let err = avro::compile(&schema).unwrap_err().to_string();
    assert!(err.contains("MUST NOT be redefined"), "{err}");
}

#[test]
fn an_inline_unions_selector_may_shadow_a_base_property() {
    let schema = doc(json!({
        "$root": "#/definitions/Shape",
        "definitions": {
            "Base": {
                "abstract": true, "type": "object",
                "properties": { "kind": { "type": "string" }, "area": { "type": "double" } },
                "required": ["kind", "area"]
            },
            "Circle": {
                "abstract": false, "type": "object", "$extends": "#/definitions/Base",
                "properties": { "kind": { "type": "string" }, "radius": { "type": "double" } },
                "required": ["kind", "radius"]
            },
            "Shape": {
                "type": "choice", "$extends": "#/definitions/Base", "selector": "kind",
                "choices": { "circle": { "type": { "$ref": "#/definitions/Circle" } } }
            }
        }
    }));
    let out = compile(&schema);
    assert!(out.to_string().contains("radius"));
}

#[test]
fn an_addin_lands_at_its_targets_position_in_the_chain() {
    let schema = doc(json!({
        "$root": "#/definitions/C",
        "$offers": { "Audited": "#/definitions/Audited" },
        "definitions": {
            "A": { "abstract": true, "type": "object", "properties": { "a": { "type": "string" } }, "required": ["a"] },
            "B": { "abstract": true, "type": "object", "$extends": "#/definitions/A", "properties": { "b": { "type": "string" } }, "required": ["b"] },
            "C": { "type": "object", "$extends": "#/definitions/B", "properties": { "c": { "type": "string" } }, "required": ["c"] },
            "Audited": { "abstract": true, "type": "object", "$extends": "#/definitions/B", "properties": { "by": { "type": "string" } }, "required": ["by"] }
        }
    }));
    let opts = AvroOptions { uses: vec!["Audited".into()], ..Default::default() };
    let out = avro::compile_with(&schema, &opts).unwrap().schema;
    let names: Vec<&str> = out["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    // The add-in targets B, so it appends after B's own properties, not at the end.
    assert_eq!(names, ["a", "b", "by", "c"]);
}

#[test]
fn an_inherited_inline_object_is_named_after_the_concrete_type() {
    let schema = doc(json!({
        "$root": "#/definitions/Derived",
        "definitions": {
            "Base": {
                "abstract": true, "type": "object",
                "properties": { "at": { "type": "object", "properties": { "x": { "type": "double" } }, "required": ["x"] } },
                "required": ["at"]
            },
            "Derived": { "type": "object", "$extends": "#/definitions/Base", "properties": { "d": { "type": "string" } }, "required": ["d"] }
        }
    }));
    let out = compile(&schema);
    assert_eq!(out["fields"][0]["type"]["name"], "Derived_at");
}

#[test]
fn a_name_binding_annotation_is_dropped_with_a_warning_in_both_modes() {
    // A corpus case pins this in `full` mode. The claim is that the warning
    // does not depend on the mode, and a corpus case cannot say that: it
    // carries one options file.
    let schema = doc(json!({
        "name": "Track", "type": "object",
        "coordinateReferenceSystem": {
            "reference": "http://www.opengis.net/def/crs/EPSG/0/4326",
            "kind": "epsg",
            "coordinates": ["lat", "lon"]
        },
        "properties": { "lat": { "type": "double" }, "lon": { "type": "double" } },
        "required": ["lat", "lon"]
    }));

    for mode in [Mode::Compact, Mode::Full] {
        let opts = AvroOptions { mode, ..AvroOptions::default() };
        let out = avro::compile_with(&schema, &opts).unwrap();
        assert!(
            out.warnings
                .iter()
                .any(|w| w.message.contains("coordinateReferenceSystem")),
            "{mode:?} must report the dropped annotation: {:?}",
            out.warnings
        );
        assert!(
            out.schema.get("annotations").is_none(),
            "{mode:?} must not carry an annotation that names properties: {}",
            out.schema
        );
    }
}

#[test]
fn a_carryable_annotation_is_not_warned_about() {
    // The warning list and the emission list must not overlap, or every
    // annotated schema would produce noise.
    let schema = doc(json!({
        "name": "Reading", "type": "object",
        "properties": { "distance": { "type": "double", "unit": "m" } },
        "required": ["distance"]
    }));
    let opts = AvroOptions { mode: Mode::Full, ..AvroOptions::default() };
    let out = avro::compile_with(&schema, &opts).unwrap();
    assert!(out.warnings.is_empty(), "unexpected warnings: {:?}", out.warnings);
    assert_eq!(out.schema["fields"][0]["annotations"]["unit"], "m");
}
