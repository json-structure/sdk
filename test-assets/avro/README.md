# Avro Conformance Corpus

Conformance fixtures for the JSON Structure → Apache Avro compiler defined by
[`spec/json-structure-to-avro.md`](../../spec/json-structure-to-avro.md).

Every SDK that ships an Avro compiler is measured against this corpus. The
outputs are **byte-exact**, not merely semantically equivalent — determinism is a
normative requirement of the mapping, so two conforming implementations must
produce identical bytes for identical input.

## Layout

```
avro/
├── valid/<case>/
│   ├── schema.struct.json    the input JSON Structure document
│   ├── options.json          compile options (optional)
│   ├── expected.avsc         the expected output, byte-exact
│   ├── expected-warnings.txt `<pointer>: <message>` per line (absent = none)
│   ├── instance.avro.json    a sample datum in the Plain JSON encoding
│   └── expected.avro.b64     that datum's Avro binary encoding, base64
│
└── invalid/<case>/
    ├── schema.struct.json    the input JSON Structure document
    ├── options.json          compile options (optional)
    └── expected-error.txt    the expected error variant, JSON Pointer, and message
```

## `options.json`

| Key                    | Type              | Meaning                                             |
| ---------------------- | ----------------- | --------------------------------------------------- |
| `uses`                 | array of strings  | Add-ins from `$offers` to apply                      |
| `additionalProperties` | `"ignore"`/`"error"` | How to treat open records (default `"ignore"`)    |
| `emitDoc`              | boolean           | Emit `doc` from `description` (default `true`)       |
| `mode`                 | `"compact"`/`"full"` | How much the schema describes (default `"compact"`) |

A missing `options.json` means "all defaults". Note that no option affects a
generated name or namespace — those derive from the document alone.

## Serialization

`expected.avsc` is the schema rendered as pretty-printed JSON with two-space
indentation and a trailing newline — the output of Rust's
`serde_json::to_string_pretty` plus `\n`. Attribute order inside each object is
fixed by §7 of the spec and is part of what is being tested. A harness that
compares parsed JSON rather than bytes is not testing the thing that matters.

Line endings in these files are LF. A harness on Windows should normalize
`\r\n` to `\n` before comparing.

## Harness contract

Each SDK's harness must implement seven checks:

1. **Expected-output match.** Compile every `valid/` case with its options and
   compare bytes against `expected.avsc`.
2. **Determinism.** Compile every `valid/` case at least ten times and confirm
   every run is byte-identical.
3. **Validity.** Feed every generated schema to a real Avro parser for the host
   language and confirm it is accepted.
4. **Round trip.** Decode `instance.avro.json`, write it with a real Avro
   writer using the compiled schema, read the bytes back, and confirm the datum
   survives. See below.
5. **Pinned bytes.** Compare the encoded bytes against `expected.avro.b64`,
   where the case has one. A round trip only proves an SDK agrees with itself;
   the pinned bytes prove every SDK reads the same instance the same way and
   hands Avro the same datum.
6. **Warnings.** Compare the emitted warnings against `expected-warnings.txt`,
   one `<pointer>: <message>` per line in emission order. A warning is a promise
   that something was lost; unasserted, it is free to stop being made.
7. **Negative.** Compile every `invalid/` case and confirm it fails with the
   error variant, JSON Pointer, and message text recorded in
   `expected-error.txt` (see below).

Checks 4 and 5 are conditional — check 4 on the instance existing, check 5 on
the expected file existing — and a conditional check that skips everything still
passes. Both harnesses therefore count how often each branch fired and assert
the counts are non-zero. This trap has fired twice for real in this corpus.

## `instance.avro.json`

Every valid case carries one, and the harness MUST assert that it does — a case
without an instance is a case whose schema is never asked to carry data.

The file holds a single datum in the **Plain JSON encoding** specified in
[avrojson.md](https://github.com/clemensv/avrotize/blob/master/avrojson.md),
*not* the Avro JSON encoding from the Avro specification. The seven features
that specification defines, and how the corpus uses them:

| # | Rule | Used here |
| - | ---- | --------- |
| 1 | `altnames`/`altsymbols` rename fields and symbols on the wire | no |
| 2 | `bytes` and `fixed` are **base64** (RFC 4648 §4) | yes |
| 3 | `long` and `decimal` are **JSON strings in number syntax** | yes |
| 4 | Temporal logical types are RFC 3339 strings | yes |
| 5 | A union of primitives or enums is written **untagged**, and a null-valued field MAY be omitted entirely | yes |
| 6 | A union of records or maps is resolved by **structural matching**; more than one match MUST fail | yes |
| 7 | A `root` flag permits a top-level array or map | no |

Why not Avro JSON: it writes binary as Latin-1 code points, temporals as bare
epoch numbers, and every union value wrapped in a single-key object naming the
branch. No ordinary JSON producer emits that and no ordinary JSON consumer
understands it, which makes it a poor description of the data a JSON Structure
document is about. Feature 3 exists for the same reason in reverse: JSON numbers
are only guaranteed to survive to 2^53 and IEEE 754 cannot represent a decimal
exactly, so an unquoted `long` is a silent truncation waiting to happen.

The price is that no shipping Avro library will read these instances, so each
harness writes its own schema-driven decoder — a hundred lines or so. That is
cheaper than the class of bug it catches, but it does mean the decoder has no
second opinion within its own SDK. `expected.avro.b64` supplies it from outside:
the same instance must encode to the same bytes in every SDK.

### What the pinned bytes cannot cover

**Maps.** Avro writes map entries in iteration order, and no two
implementations need agree on it — Rust's `apache-avro` uses a `HashMap`, whose
order is randomized per process, so `collections` produces different bytes on
two consecutive runs of the *same* binary. Cases containing a map anywhere are
exempt from check 5, and each harness asserts that at least one case is exempt
so the exemption cannot rot into dead code. Three cases are: `choice-variants`,
`collections`, `collections-of-types`.

### What Plain JSON costs a tagged choice

Feature 6 resolves a union by structure, and every wrapper record a tagged
choice compiles to has a single field named `value`. Two choice keys whose
payload types are structurally identical therefore produce two wrapper records
that no decoder can tell apart, and decoding fails rather than guessing.
`choice-variants` survives only because each of its branches carries a different
payload type. The escape hatch Feature 6 defines is a `const` discriminator
field, which the compiler does not emit today.

This is a property of the *instance encoding*, not of the compiled schema: Avro
binary tags every union value with its branch index and is unaffected.

Two of the cases below exist because mutation testing found the corpus silent
about them. Both were holes a port could fall into and still go green:
`union-namespaced-branches` is the only case whose union branches are named
types in different namespaces, and `union-default-placement` is the only one
where a declared default names a branch that is not already first. Anything the
corpus does not exercise, it endorses.

The corpus is a happy-path corpus: every instance in it is meant to decode, so
it exercises none of a decoder's guards. Mutation testing confirmed this —
relaxing the ambiguous-union rule, the omitted-field rule, and the decimal scale
check all left the corpus green. Each SDK therefore carries a small set of
direct negative tests for its decoder alongside the corpus harness.

## `expected-error.txt`

```
kind: Invalid
path: #/definitions/Order/properties/id
message: <the full error message>
```

- `kind` — the compiler's error variant. An implementation names its own
  variants; the corpus uses the reference names (`NoRootType`,
  `UnresolvedRef`, `Invalid`, `IllegalName`, `UnknownAddIn`). A port that
  cannot match them exactly MUST map them.
- `path` — the JSON Pointer the error carries. Absent when the variant carries
  none. A harness MUST also check that the pointer *resolves* in the input
  document; a pointer nobody can follow is worse than no pointer at all.
- `message` — asserted as a substring, so a port may add context around it.

Asserting only the message is too weak: the right words can come out of the
wrong code path, and nothing then notices that the error stopped pointing
anywhere useful.

The reference harness is
[`rust/tests/avro_corpus.rs`](../../rust/tests/avro_corpus.rs). It supports
`JSTRUCT_BLESS=1` to rewrite the expected files from the current implementation.
Blessing is how a deliberate behavioral change gets recorded — review the diff
before committing. It is not how a failing test gets silenced.

## Cases

### Valid

| Case                   | Covers                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| `primitives`           | §2 — every primitive with a direct Avro counterpart                 |
| `lossless-strings`     | §2 — the types that travel as `string` rather than lose fidelity    |
| `optional-and-defaults`| §3.2 — nullable unions, branch order, `default` placement           |
| `required-alternatives`| §3.2 — Core's alternative `required` sets, reduced to their intersection |
| `collections`          | §3.3, §3.4 — `array`, `set`, `map`, nesting                         |
| `tuple`                | §3.5 — positional records                                           |
| `enums`                | §4 — `enum` with legal symbols, and enum defaults                   |
| `any`                  | §3.6 — the empty-record schema hole, named per position             |
| `union`                | §3.8 — type unions                                                  |
| `recursion`            | §5.3 — self-referential types referenced by name                    |
| `namespaces`           | §5.2 — nested definition paths become dotted namespaces            |
| `extends`              | §5.4 — `$extends` flattening, base properties first                 |
| `extends-deep`         | §5.4 — a four-level chain, and an inherited inline object's name    |
| `extends-diamond`      | §5.4 — a shared grandparent emitted once; first base wins a clash   |
| `extends-addin-base`   | §5.4, §5.5 — an add-in on a mid-chain base lands at the base's slot |
| `extends-cross-namespace` | §5.2, §5.4 — a chain crossing namespaces                         |
| `choice-tagged`        | §3.7 — tagged unions with wrapper records                           |
| `choice-inline`        | §3.7 — inline unions with a materialized selector field             |
| `altnames`             | §6.2 — the `avro` key in `altnames` and `altenums`                  |
| `addins`               | §5.5 — `$offers` add-ins applied in document order                  |
| `name-collision`       | §6.3 — a generated name pre-empted by a declared type of that name  |
| `choice-key-collision` | §3.7.1 — two choices in one namespace sharing a key; the second wrapper is suffixed |
| `choice-variants`      | §3.7.1 — five branches, a nested choice, a recursive one, and choices as array item and map value |
| `collections-of-types` | §3.3, §3.4 — arrays, sets, and maps of named records, named enums, inline objects, and inline enums |
| `ref-chain`            | §5.3 — a four-hop `$ref` chain                                      |
| `mutual-recursion`     | §5.3 — two types referencing each other                             |
| `same-name-two-namespaces` | §5.2 — one type name declared in two namespaces                 |
| `additional-properties-schema` | §3.1 — `additionalProperties` as a schema, not a boolean    |
| `root-primitive`       | §5.1 — the root type is a bare `string`                             |
| `root-array`           | §5.1 — the root type is an `array`                                  |
| `root-enum`            | §5.1 — the root type is an `enum`                                   |
| `root-choice`          | §5.1, §3.7.1 — the root type is a tagged `choice`, so the schema is a union |
| `union-namespaced-branches` | §3.8 — a union branch whose tag is a *fullname*, not a bare name |
| `union-default-placement` | §3.8 — a default naming a branch that is not first, so the union is rotated |
| `full-logical-types`   | §2.5 — the `rfc3339-*` annotations, which no Avro parser has to understand |
| `full-reserved-logicals` | §2.5 — `uuid`, and the `decimal` that both modes emit             |
| `full-constraint-annotations` | §6.4.1 — all ten constraints in an `annotations` attribute, reordered from the source |
| `full-constraints-no-doc` | §6.4.1 — `emitDoc` off still emits constraints; the two options are orthogonal |
| `full-decimal-constraints` | §6.4.1 — `precision`/`scale` carried by the `decimal` logical type are not repeated |

### Invalid

| Case                  | Expected failure                                       |
| --------------------- | ------------------------------------------------------ |
| `no-root-type`        | Document declares neither `type` nor `$root`           |
| `abstract-root`       | An abstract type cannot be the root                    |
| `abstract-referenced` | An abstract type cannot be used as a value type        |
| `extends-cycle`       | A cycle in the `$extends` graph                        |
| `extends-redefine`    | An extending type redefines an inherited property      |
| `dangling-ref`        | `$ref` points at nothing                               |
| `illegal-altname`     | An `altnames.avro` value that is not a legal Avro name |
| `duplicate-altname`   | Two declared types whose `altnames.avro` values collide |
| `unknown-addin`       | `uses` names an add-in the schema does not offer       |
| `open-record`         | `additionalProperties` with `additionalProperties: "error"` |
