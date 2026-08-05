# Protobuf Conformance Corpus

Golden fixtures for the JSON Structure → Protocol Buffers generator defined by
[`spec/json-structure-to-proto.md`](../../spec/json-structure-to-proto.md).

Every SDK that ships a `.proto` generator is measured against this corpus. The
outputs are **byte-exact**. Protobuf field numbers are a wire contract, so
"semantically equivalent" is not a useful standard here — two implementations
that disagree about a number disagree about the data.

## Layout

```
proto/
├── valid/<case>/
│   ├── schema.struct.json       the input JSON Structure document
│   ├── options.json             generation options (optional)
│   ├── expected/<path>.proto    the expected files, byte-exact
│   ├── expected-numbers.json    the field-number lock the run produces
│   └── expected-warnings.txt    `<pointer>: <message>` per line (absent = none)
│
└── invalid/<case>/
    ├── schema.struct.json       the input JSON Structure document
    ├── options.json             generation options (optional)
    └── expected-error.txt       the expected error variant, JSON Pointer, and message
```

The `expected/` tree mirrors the generated file layout exactly, including
nested package directories, so it can be handed to `protoc --proto_path` as-is.

## `options.json`

| Key                    | Type                 | Meaning                                          |
| ---------------------- | -------------------- | ------------------------------------------------ |
| `uses`                 | array of strings     | Add-ins from `$offers` to apply                  |
| `additionalProperties` | `"ignore"`/`"error"` | How to treat open records (default `"ignore"`)   |
| `emitComments`         | boolean              | Emit comments from `description` (default `true`)|
| `numbers`              | object               | A pre-existing field-number lock (spec §6.3)     |

No option affects a generated name, package, or file path — those derive from
the document alone.

## Harness contract

Each SDK's harness must implement six checks:

1. **Golden match.** Generate every `valid/` case and compare each file's bytes
   against its counterpart under `expected/`, and the produced lock against
   `expected-numbers.json`. Compare the *sets* of files in both directions — a
   check that only walks the generated files will never notice one that stopped
   being generated.
2. **Determinism.** Generate every `valid/` case at least ten times and confirm
   every run is byte-identical, files and lock alike.
3. **Idempotence under the lock.** Feed the produced lock back in as the
   `numbers` option and confirm nothing moves. A generator that renumbers on
   regeneration breaks the wire contract every time it runs.
4. **`protoc` validity.** Where `protoc` is available, compile the *actual
   generated output* — not the goldens — and confirm it is accepted. Compiling
   the goldens only proves a blessed file is still valid. Skip when `protoc` is
   not installed — but a test that can silently skip is a test that might not be
   running, so honour `JSTRUCT_REQUIRE_PROTOC`: when that variable is set, a
   missing `protoc` is a failure. CI sets it.
5. **Warnings.** Compare the emitted warnings against `expected-warnings.txt`,
   one `<pointer>: <message>` per line in emission order. A warning is a promise
   that something was lost; unasserted, it is free to stop being made.
6. **Negative.** Generate every `invalid/` case and confirm it fails with the
   error variant, JSON Pointer, and message text recorded in
   `expected-error.txt` (see below).

## `expected-error.txt`

```
kind: Invalid
path: #/definitions/Order/properties/id
message: <the full error message>
```

- `kind` — the generator's error variant. An implementation names its own
  variants; the corpus uses the reference names (`NoRootType`,
  `UnresolvedRef`, `Invalid`, `IllegalName`, `UnknownAddIn`, `Numbering`,
  `ImportCycle`). A port that cannot match them exactly MUST map them.
- `path` — the JSON Pointer the error carries. Absent when the variant carries
  none. A harness MUST also check that the pointer *resolves* in the input
  document; a pointer nobody can follow is worse than no pointer at all.
- `message` — asserted as a substring, so a port may add context around it.

Asserting only the message is too weak: the right words can come out of the
wrong code path, and nothing then notices that the error stopped pointing
anywhere useful.

The reference harness is
[`rust/tests/proto_corpus.rs`](../../rust/tests/proto_corpus.rs). It supports
`JSTRUCT_BLESS=1` to rewrite the golden files. Review the diff before
committing — a change to a field number in `expected-numbers.json` is a
breaking change to anyone already on the wire.

## Cases

### Valid

| Case                   | Covers                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| `primitives`           | §2 — every primitive with a direct protobuf counterpart            |
| `lossless-strings`     | §2 — the types that travel as `string`                             |
| `optional-and-defaults`| §3.2 — explicit presence, and `default` demoted to a comment       |
| `required-alternatives`| §3.2 — Core's alternative `required` sets, reduced to their intersection |
| `collections`          | §3.3, §3.4 — `repeated`, `map`, and the nested-array wrapper       |
| `tuple`                | §3.5 — positional messages                                         |
| `enums`                | §4.1 — the synthesized `_UNSPECIFIED` zero value                   |
| `any`                  | §3.6 — `google.protobuf.Any` and its import                        |
| `union`                | §3.8 — a non-discriminated union as a `oneof`                      |
| `recursion`            | §5.3 — self-referential messages                                   |
| `namespaces`           | §5.2 — one file per namespace, cross-file imports                  |
| `extends`              | §5.4 — `$extends` flattening, base fields first                    |
| `extends-deep`         | §5.4 — a four-level chain, and an inherited inline object's name    |
| `extends-diamond`      | §5.4 — a shared grandparent emitted once; first base wins a clash   |
| `extends-addin-base`   | §5.4, §5.5 — an add-in on a mid-chain base lands at the base's slot |
| `extends-cross-namespace` | §5.2, §5.4 — a chain crossing namespaces, producing no import    |
| `choice-tagged`        | §3.7.1 — a `oneof` with generated branch messages                  |
| `choice-inline`        | §3.7.2 — base fields plus a `oneof`, selector not materialized     |
| `altnames`             | §7.1 — the `proto` key in `altnames` and `altenums`                |
| `addins`               | §5.5 — `$offers` add-ins applied in document order                 |
| `numbering`            | §6 — `protoNumber` pins, lock reuse, retired field and enum numbers |
| `definitions-only`     | §5.1 — a document with no root: a module of importable types       |
| `name-collision`       | §7.2 — a generated name pre-empted by a declared type of that name |
| `choice-variants`      | §3.7.1 — five branches, a nested choice, a recursive one, and choices as array item and map value |
| `collections-of-types` | §3.3, §3.4 — `repeated` and `map` of named messages, named enums, inline messages, and inline enums |
| `ref-chain`            | §5.3 — a four-hop `$ref` chain                                     |
| `mutual-recursion`     | §5.3 — two messages referencing each other in one package          |
| `same-name-two-namespaces` | §5.2 — one type name declared in two namespaces, three files   |
| `additional-properties-schema` | §3.1 — `additionalProperties` as a schema, not a boolean   |
| `root-primitive`       | §5.1 — a bare `string` root, wrapped in a `Root` message           |
| `root-array`           | §5.1 — an `array` root, wrapped in a message with a `value` field  |
| `root-enum`            | §5.1 — an `enum` root, emitted top level without a wrapper         |
| `root-choice`          | §5.1, §3.7.1 — a tagged `choice` root                              |

### Invalid

| Case                  | Expected failure                                            |
| --------------------- | ----------------------------------------------------------- |
| `nothing-to-generate` | Document declares no types at all                           |
| `abstract-root`       | `$root` points at an abstract type                          |
| `abstract-referenced` | An abstract type used as a value type                       |
| `extends-cycle`       | A cycle in the `$extends` graph                             |
| `extends-redefine`    | An extending type redefines an inherited property           |
| `dangling-ref`        | `$ref` points at nothing                                    |
| `illegal-altname`     | An `altnames.proto` value that is not a legal identifier    |
| `duplicate-altname`   | Two declared types whose `altnames.proto` values collide    |
| `unknown-addin`       | `uses` names an add-in the schema does not offer            |
| `open-record`         | `additionalProperties` with `additionalProperties: "error"` |
| `namespace-case-collision` | Two namespaces that lowercase to one package (§5.2)    |
| `pin-conflicts-lock`  | `protoNumbers` disagrees with the lock file                 |
| `pin-collision`       | Two `protoNumber` pins claim the same number                |
| `pin-out-of-range`    | A `protoNumber` in protobuf's reserved 19000–19999 range    |
| `enum-pin-out-of-range` | A `protoNumbers` value beyond `int32`                     |
| `enum-unspecified-collision` | A symbol equal to the synthesized `_UNSPECIFIED`     |
| `enum-symbol-collision` | Two enums in one package declaring the same symbol         |
| `stale-lock-version`  | A lock file whose `version` is not the current one          |
| `import-cycle`        | Two namespaces reference each other                         |
