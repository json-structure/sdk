# JSON Structure to Protocol Buffers Mapping

**Status:** Normative for the JSON Structure SDKs.
**Version:** v0

## 1. Introduction

This document specifies a total, deterministic mapping from a JSON Structure
Core schema document to one or more Protocol Buffers version 3 (`proto3`)
source files.

Protobuf is a build-time concern in a way Avro is not. An `.avsc` can be
compiled in-process on every startup and thrown away; a `.proto` file is a
checked-in artifact that `protoc` turns into generated code, and that a gRPC
service definition `import`s. So this mapping is realized by the `jstruct` CLI
rather than by a runtime library, and its output is expected to live in version
control next to the schemas it came from.

### 1.1 Design principles

**Field numbers are a wire contract, not a rendering detail.** In Avro, fields
resolve by name and reordering a record is harmless. In protobuf, field numbers
*are* the encoding. A generator that assigns numbers by enumeration order will
silently repoint every field after an insertion, and the corruption will not
surface until a new writer meets an old reader in production. {{numbering}}
therefore specifies a numbering scheme designed to survive editing, and a
pinning mechanism for schemas that must match a pre-existing `.proto`.

**Generated files are importable modules.** Each namespace becomes one file with
a predictable path and `package`, so a hand-written service definition can
`import "acme/orders/v1/order.proto";` and refer to `acme.orders.v1.Order`.
Nothing in the generated output depends on being concatenated with anything
else.

**Losslessness beats compactness.** Where a narrower protobuf type would
truncate or wrap a legal JSON Structure value, the mapping chooses the wider or
lexical representation. See {{primitives}}.

**Determinism is normative.** Two conforming implementations MUST produce
byte-identical output for the same input document and options, including the
order of `import` statements and the assignment of field numbers.

### 1.2 Conventions

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, and MAY are to be
interpreted as described in BCP 14.

"Protobuf identifier" means an identifier matching `[A-Za-z_][A-Za-z0-9_]*`.
JSON Structure Core restricts type and property names to the same production, so
this mapping performs **no name mangling** for type or property names. Mangling
is only needed for `altnames`/`altenums` overrides and `enum` symbol values.

Protobuf identifiers are case-sensitive but `protoc` rejects a message and a
field in the same scope whose names collide after case folding in some
languages' generated code. This mapping does not attempt to prevent that; see
{{errors}}.

### 1.3 Inputs

The generator operates on a **consolidated** JSON Structure document, one in
which all `$import` and `$importdefs` references have been resolved and inlined.
Use `jstruct consolidate` first, or the `--consolidate` pipeline step.

Options:

| Option | Default | Effect |
|---|---|---|
| `uses` | empty | Add-in names from `$offers` to apply (see {{offers-uses}}) |
| `additional_properties` | `ignore` | `ignore` or `error`; see {{additional-properties}} |
| `emit_comments` | `true` | Emit `description` as leading comments |
| `numbers` | none | Path to a field-number lock file (see {{numbering}}) |

No option affects a generated name, package, or file path. The JSON Structure
document is the sole source of truth for the identity of every generated type
and file: a package and message name are part of the wire and API contract, and
a contract that changes with a caller-supplied argument is not a contract.
Implementations MUST NOT offer a way to prefix, rewrite, or otherwise override a
derived name or package.

## 2. Primitive types {#primitives}

| JSON Structure | proto3 | Notes |
|---|---|---|
| `string` | `string` | UTF-8 |
| `boolean` | `bool` | |
| `null` | `google.protobuf.NullValue` | See {{null}} |
| `int8`, `int16`, `int32` | `int32` | proto3 has no narrower integer |
| `int64` | `int64` | |
| `uint8`, `uint16`, `uint32` | `uint32` | |
| `uint64` | `uint64` | Exact; unlike Avro, protobuf has an unsigned 64-bit type |
| `int128`, `uint128` | `string` | No protobuf counterpart; decimal lexical form |
| `float8` | `float` | |
| `float` | `float` | |
| `double`, `number` | `double` | |
| `decimal` | `string` | Exactness matters more than compactness |
| `date`, `time`, `datetime`, `duration` | `string` | RFC 3339 lexical form; see {{temporal}} |
| `uuid` | `string` | |
| `uri`, `jsonpointer` | `string` | |
| `binary` | `bytes` | |

### 2.1 Temporal types {#temporal}

`google.protobuf.Timestamp` and `google.protobuf.Duration` are deliberately not
used. `Timestamp` is a UTC instant with no offset; RFC 3339 values carry one,
and a JSON Structure `datetime` of `2024-03-01T09:00:00+01:00` is not the same
contract as the instant it denotes. `time` has no protobuf counterpart at all,
and `date` would have to become `google.type.Date`, which lives outside the
well-known types and drags an extra dependency into every generated file.

All four therefore travel as `string` in their JSON Structure lexical form. This
matches the Avro mapping, so a schema serialized through both targets carries
identical temporal values.

### 2.2 `null` {#null}

A bare `null` type is rare and nearly always a modelling accident. It maps to
`google.protobuf.NullValue`, an enum with the single value `NULL_VALUE`, from
`google/protobuf/struct.proto`.

Nullability of *fields* is a separate matter; see {{fields}}.

### 2.3 Constraint keywords

`precision`, `scale`, `maxLength`, `minimum`, `pattern`, and the rest of the
JSON Structure Validation extension have no protobuf counterpart. They MUST NOT
affect the emitted type. Implementations MAY emit them as comments when
`emit_comments` is enabled, and MUST NOT emit them in any form that `protoc`
interprets.

## 3. Compound types

### 3.1 `object` {#object}

An `object` becomes a `message`. Properties become fields in document order,
numbered per {{numbering}}.

```json
{ "name": "Person", "type": "object",
  "properties": { "name": { "type": "string" }, "age": { "type": "int32" } },
  "required": ["name"] }
```

```protobuf
message Person {
  string name = 1;
  optional int32 age = 2;
}
```

Inline (unnamed) objects become sibling top-level messages in the same file,
named per {{generated-names}}. They are not emitted as nested messages: a
generated name like `Person_address` already carries the nesting, and keeping
every message top-level means a reference from another file needs no knowledge
of where the type happens to sit.

### 3.2 Fields, `required`, and `default` {#fields}

proto3 has no required fields and no user-specified defaults. Every scalar field
has an implicit zero default, and — since proto3 optional was reinstated — a
field may be marked `optional` to gain explicit presence tracking.

The mapping is:

- A property listed in `required` emits a plain field.
- A property not listed in `required` emits an `optional` field. Explicit
  presence is what lets a reader distinguish "absent" from "zero", which is the
  whole point of the distinction JSON Structure is drawing.
- `repeated` and `map` fields MUST NOT be marked `optional`; protobuf forbids
  it. An optional array or map is represented by its own emptiness.
- A field inside a `oneof` MUST NOT be marked `optional`; the `oneof` already
  provides presence.

Core also permits `required` to be a list of **alternative sets** — an array of
arrays, any one of which satisfies the type. Protobuf has no way to express that
disjunction, so it is reduced to the **intersection** of the alternatives: a
property named in every alternative is present whichever alternative holds and
emits a plain field; a property named in only some of them may legitimately be
absent and emits `optional`. The disjunction itself is not enforced on the wire,
which MUST be reported as a warning ({{warnings}}).

Taking the union of the alternatives instead would emit plain fields for data
that is allowed to omit them, and ignoring the keyword — the tempting shortcut,
since the value is not the flat list the simple case produces — silently makes
every field in the message optional.

`default` has no representation. When a property declares a `default`,
implementations MUST emit it as a comment when `emit_comments` is enabled, so
that the value survives in the artifact a human reads, and MUST NOT attempt to
encode it in the field declaration.

> This is a real and unavoidable fidelity loss relative to the Avro mapping,
> where defaults are part of the schema and participate in schema resolution.
> Application code consuming generated protobuf types is responsible for
> applying JSON Structure defaults itself.

### 3.3 `array` and `set`

Both become `repeated`. Protobuf has no set type and no uniqueness constraint;
`set` semantics are the application's responsibility, and implementations SHOULD
note this in a comment.

```protobuf
repeated string tags = 1;
```

Protobuf cannot express a `repeated repeated`. A nested array MUST be wrapped in
a generated single-field message:

```json
{ "type": "array", "items": { "type": "array", "items": { "type": "double" } } }
```

```protobuf
message Matrix_itemsItem {
  repeated double items = 1;
}
repeated Matrix_itemsItem matrix = 1;
```

The wrapper message is named per {{generated-names}} and its single field is
always named `items` with number `1`.

### 3.4 `map`

A `map` with a `string` key becomes `map<string, V>`.

Protobuf restricts map values to non-repeated, non-map types. A map whose values
are arrays or maps MUST be wrapped in a generated single-field message, exactly
as in {{3.3}}, with the field named `values`.

### 3.5 `tuple`

A `tuple` becomes a message whose fields follow the `tuple` array order. Every
field is emitted without `optional`, because a tuple's arity is fixed. Field
numbers follow {{numbering}} using the `tuple` array as the ordering, not the
`properties` map.

### 3.6 `any`

`any` becomes `google.protobuf.Any`, from `google/protobuf/any.proto`.

This differs from the Avro mapping, which uses an empty record as a schema hole
because Avro has no equivalent of `Any`. Protobuf's `Any` carries a type URL
alongside the payload, which is strictly more informative, so there is no reason
to invent something.

Implementations MUST emit the `google/protobuf/any.proto` import in any file
that uses it.

### 3.7 `choice` {#choice}

#### 3.7.1 Tagged unions

A tagged `choice` becomes a message containing a single `oneof` named after the
property, with one field per choice key.

```json
{ "type": "choice",
  "choices": {
    "created": { "type": "object", "properties": { "at": { "type": "string" } } },
    "deleted": { "type": "object", "properties": { "reason": { "type": "string" } } }
  } }
```

```protobuf
message Event_body {
  oneof body {
    Event_body_created created = 1;
    Event_body_deleted deleted = 2;
  }
}
```

`oneof` field names are the choice keys, which JSON Structure already guarantees
to be unique and to be legal identifiers.

A `oneof` cannot directly contain a `repeated` or `map` field. Such a branch MUST
be wrapped in a generated single-field message as in {{3.3}}.

#### 3.7.2 Inline unions

An inline union — a `choice` with `$extends` and `selector` — becomes a message
containing the base type's fields followed by a `oneof` over the branches. The
selector property is *not* materialized as a separate field: protobuf's `oneof`
already carries the discriminator on the wire, and emitting both would create
two sources of truth that can disagree.

```protobuf
message Shape {
  string id = 1;
  oneof kind {
    Circle circle = 2;
    Square square = 3;
  }
}
```

> This differs from the Avro mapping, which *does* materialize the selector,
> because Avro unions have no field-level tag once decoded.

### 3.8 Non-discriminated type unions

A `type` array becomes a message containing a `oneof` whose field names are
derived from the branch types (`string_value`, `int32_value`, and so on), in
document order.

Two branches are the same branch only when they map to the **same fully
qualified protobuf type**. Deduplicating on the derived field name instead
would silently drop a branch whenever two distinct types share a short name —
`a.Foo` and `b.Foo` both derive `foo_value`. When distinct types collide that
way, the field name is qualified with the full type path, lowercased with `.`
replaced by `_`, which is unique by construction.

## 4. Enumerations {#enums}

### 4.1 `enum`

A `string` type with `enum` becomes a protobuf `enum` when every symbol is a
legal protobuf identifier; otherwise it becomes `string` and implementations
MUST emit a warning.

proto3 requires the first enum value to be zero. Since JSON Structure enums have
no natural zero, the mapping prepends a synthetic zero value named
`<ENUM_NAME>_UNSPECIFIED`, per the protobuf style guide, and numbers the
declared symbols from 1 in document order.

```json
{ "type": "string", "enum": ["pending", "shipped", "delivered"] }
```

```protobuf
enum Order_status {
  ORDER_STATUS_UNSPECIFIED = 0;
  pending = 1;
  shipped = 2;
  delivered = 3;
}
```

Enum value numbers are subject to {{numbering}} and its lock file, for the same
reason field numbers are.

Protobuf enum values share the enclosing scope's namespace rather than being
scoped to their enum, so two enums in one scope may not declare the same symbol.
Because generated enums are emitted at file top level ({{files}}), that scope is
the package. When the collision occurs, implementations MUST report an error
rather than silently rename. A declared symbol equal to the synthesized
`<ENUM_NAME>_UNSPECIFIED` is the same collision and is likewise an error.

### 4.2 `const`

`const` has no protobuf counterpart: proto3 cannot constrain a field to a single
value. The declared type is emitted, the constant value is emitted as a comment
when `emit_comments` is enabled, and implementations MUST emit a warning
regardless of the comment setting — the warning is about lost semantics, not
about comment rendering. The same holds for `default` ({{fields}}).

## 5. Document structure

### 5.1 Root type

The document's root type — the type declared inline, or the type at `$root` —
becomes a top-level message in the file derived from its namespace. It is not
otherwise distinguished; protobuf has no notion of a document root.

A document with no root type at all is **valid** here, and is in fact the
expected shape for the case this mapping exists to serve: a library of shared
types that a `.proto` service definition imports. Every type in `definitions` is
emitted and the generator produces no root message. This is the one place the
Protobuf mapping deliberately diverges from the Avro mapping, where a compiler
must yield exactly one schema and a rootless document therefore has no answer.

An implementation MUST NOT reject a document solely because it declares neither
`type` nor `$root`. A document that declares neither *and* has no `definitions`
has nothing to generate and MUST be rejected ({{errors}}).

Protobuf's top-level declarations are messages, enums, and services; there is no
way to declare a bare `string` or a bare `repeated`. A root type that is not an
`object`, `tuple`, `choice`, or `enum` is therefore wrapped in a message of the
root type's name — `Root` when the document names none — carrying a single field
named `value` of the mapped type. A root `enum` needs no wrapper: it is emitted
as a top-level `enum`.

### 5.2 Namespaces and files {#files}

Each namespace in `definitions` maps to a protobuf `package` and to exactly one
file:

- Package: the namespace path segments joined with `.`, lowercased. A path
  segment that is not a legal protobuf package component after lowercasing is an
  error.
- File path: the package components joined with `/`, followed by `.proto`.
  Namespace `com/example/sales` yields package `com.example.sales` and file
  `com/example/sales.proto`.
- Types at the document root (not under a namespace) have no package and go in
  `<stem>.proto`, where `<stem>` is derived from the document's `$id` or file
  name.

An author who wants package `com.example.sales` nests the definition at
`#/definitions/com/example/sales`. There is no option to supply or prefix a root
package.

Because package segments are lowercased and Core namespace names are
case-sensitive, two distinct namespaces can arrive at one package — `Sales` and
`sales` both become `sales`. That merges their contents into one file and
changes the fully-qualified name of every type in at least one of them. An
implementation MUST detect this after normalization and reject it
({{errors}}); it MUST NOT resolve the merge by suffixing, because the resulting
package name would depend on which namespace happened to be visited first.

Each file emits `syntax = "proto3";`, then `package`, then `import` statements,
then its types.

`import` statements are sorted lexicographically by path, with well-known
imports (`google/protobuf/*`) first. This is the ordering rule that makes output
deterministic; an implementation MUST NOT let hash-set iteration reach the
output.

### 5.3 References and recursion

A `$ref` to a named type emits a reference to that type's fully qualified
protobuf name. If the target lives in another file, that file is imported.

Protobuf handles recursion natively; no special treatment is required. A message
may reference itself directly or through a cycle.

`protoc` forbids circular *file* imports, however, so two namespaces that
reference each other cannot both be emitted. Implementations MUST detect
namespace reference cycles and report an error naming the participating
packages. The fix belongs to the schema author: put mutually-referencing types
in one namespace. Silently merging the files would produce output whose layout
does not match the schema, and a stale import in a hand-written service
definition would then fail confusingly at `protoc` time rather than here.

### 5.4 `abstract` and `$extends`

Protobuf has no inheritance. `$extends` is flattened: the base type's fields are
emitted first, in the base's document order, followed by the derived type's own
fields. Flattening is transitive — a chain `A ← B ← C` emits A's fields, then
B's, then C's — and has no depth limit.

With multiple bases, bases are flattened in `$extends` array order. A name
contributed by more than one base — the diamond case, where two bases share a
grandparent, or where two bases independently declare the same property — is
emitted **once**, at the position of its first contribution, with the
declaration from the first base in the array. This follows Core: "the property
from the first base type in the array takes precedence."

An extending type MUST NOT redefine a property it inherits through its own
`$extends` chain. The generator MUST reject this rather than silently pick a
winner. The single exception is an inline union's `selector`, which Core
explicitly permits to shadow a base property.

A cycle in the `$extends` graph MUST be reported as an error, not left to
exhaust the stack. Cycle detection tracks the *ancestor path*, not the set of
visited types, so that a diamond still resolves.

An `abstract` type is never emitted as a message. Referencing an abstract type
as a value type is an error. Because bases are flattened away, a derived type in
one namespace extending a base in another produces **no file import** — nothing
of the base survives as a distinct type.

A generated helper name for an inherited inline type is derived from the
**concrete** message being emitted, not from the base that declared the
property: a `location` object declared on abstract `Placemark` and inherited by
`Landmark` becomes `Landmark_location`.

Field numbering of a flattened message treats the flattened field sequence as
the document order. Adding a field to a base type therefore shifts the numbers
of every derived type's own fields — which is exactly why {{numbering}} exists.

### 5.5 `$offers` and `$uses` {#offers-uses}

`$uses` appears in the *instance* document, not the schema, so the generator
cannot read it. Add-in selection comes from the `uses` option.

A selected add-in's properties are appended to its `$extends` target's fields,
after the target's own properties — at the target's **position in the flattened
chain**, not at the end. An add-in on a mid-chain base therefore appears before
the derived type's own fields. When several add-ins target the same type,
they are applied in `$offers` **document order**, not in the order the caller
listed them. Naming an add-in the schema does not offer is an error.

### 5.6 `additionalProperties` {#additional-properties}

Protobuf messages are closed. A schema with `additionalProperties` MUST either
be rejected (`additional_properties: error`) or emitted as a closed message with
a warning (`additional_properties: ignore`, the default).

Implementations MUST NOT synthesize a `map<string, google.protobuf.Any>` catch-
all field. That would change the wire contract in a way the schema author did
not ask for, and it would consume a field number.

## 6. Field and enum value numbering {#numbering}

This is the part of the mapping that can corrupt data if it is wrong, so it is
specified tightly.

### 6.1 The default rule

Within a message, fields are numbered sequentially from 1 in emission order:
flattened base fields first, then own properties in document order, then add-in
properties in `$offers` order.

Numbers 19000–19999 are reserved by protobuf and MUST be skipped.

This rule is **positional**, and positional numbering is only safe for a schema
that is append-only. Inserting a property in the middle of `properties`
renumbers every field after it, and a reader compiled against the previous
`.proto` will decode the new bytes into the wrong fields without erroring.

### 6.2 Explicit pinning

A property MAY pin its number with the `protoNumber` annotation:

```json
{ "name": { "type": "string", "protoNumber": 1 },
  "age":  { "type": "int32",  "protoNumber": 3 } }
```

Pinned numbers are honored exactly. Unpinned fields fill the lowest unused
numbers in emission order, skipping pinned numbers and the reserved range.

A `protoNumber` MUST be an integer in 1..=536870911 and MUST NOT fall in the
reserved range 19000..=19999. A pinned number that collides with another pinned
number in the same message is an error.

The same annotation applies to enum values through `protoNumbers`, a map from
symbol to number:

```json
{ "type": "string", "enum": ["pending", "shipped"],
  "protoNumbers": { "pending": 1, "shipped": 2 } }
```

Enum values are `int32` on the wire, so a `protoNumbers` value MUST be an
integer in 0..=2147483647; 0 is additionally forbidden because it belongs to the
synthesized `_UNSPECIFIED` value ({{enums}}).

### 6.3 The lock file

Pinning every property by hand does not scale, so the generator supports a lock
file: a JSON document recording the number assigned to every field and enum
value the last time the generator ran.

```json
{
  "version": 2,
  "messages": {
    "com.example.Person": {
      "fields": { "name": 1, "age": 2 },
      "reserved": [3]
    }
  },
  "enums": {
    "com.example.Order_status": {
      "values": { "pending": 1, "shipped": 2 },
      "reserved": [4]
    }
  }
}
```

With `--numbers path/to/proto-numbers.json`:

1. Every field present in the lock file keeps its recorded number, regardless of
   where it now appears in the document.
2. Every new field is assigned the lowest unused number, in emission order.
3. Every field in the lock file that is no longer in the schema is emitted as a
   `reserved` declaration in the message and recorded in `reserved`, so its
   number can never be reused for a different meaning.
4. **Enum values follow the same retirement rule.** A symbol that has left the
   schema keeps its number reserved, emitted as `reserved N;` inside the `enum`.
   Letting a new symbol inherit a retired number is silent corruption: an old
   reader decodes the new symbol as the one that was removed.
5. The lock file is rewritten with the new state.

Explicit `protoNumber` annotations take precedence over the lock file. A
disagreement between the two is an error, not a silent override — it means
someone edited one of them without the other.

**Lock format version.** `version` MUST be `2`. A generator that is handed a
lock of any other version MUST fail rather than ignore it: an ignored lock
renumbers every field, which is exactly the corruption the lock exists to
prevent.

**Recommendation.** Check the lock file into version control next to the schema.
A generator run that changes an existing entry should be treated as a breaking
change and show up in review. Without a lock file, the only safe editing
discipline is to append properties and never remove or reorder them.

## 7. Names and annotations

### 7.1 The `proto` altnames key {#altnames}

This mapping defines `proto` as a purpose indicator for the `altnames` and
`altenums` keywords of the JSON Structure Alternate Names extension, symmetric
with the `avro` key.

- On a named type, `altnames.proto` supplies the message or enum name.
- On a property, `altnames.proto` supplies the field name.
- On an enum, `altenums.proto` maps each declared value to a protobuf enum value
  name.

A value supplied through `altnames.proto` or `altenums.proto` that is not a
legal protobuf identifier is an error. This is the escape hatch for names that
JSON Structure accepts but protobuf does not, and for matching a pre-existing
`.proto`.

Note that `altnames.proto` changes the *name* only. It does not change a field's
number; use `protoNumber` for that.

### 7.2 Generated names {#generated-names}

Anonymous inline types need names. The rule is positional and mechanical:

- A nested message for an inline `object` is named
  `<EnclosingMessage>_<propertyName>`.
- A wrapper message for a nested array or map value is named
  `<EnclosingMessage>_<propertyName>Item` or `...Value`.
- An enum from an inline `enum` is named `<EnclosingMessage>_<propertyName>`.
- A message for a `choice` property is named `<EnclosingMessage>_<propertyName>`.
- A branch message inside a tagged union is named
  `<ChoiceMessage>_<choiceKey>`.

Nesting composes: a name is built by joining the enclosing generated name with
the next segment. If a generated name collides with a declared type name in the
same scope, the implementation appends `_1`, `_2`, and so on, and MUST report a
warning naming both the generated and the declared type.

### 7.3 `description`

When `emit_comments` is enabled, `description` becomes a leading `//` comment on
the message, enum, field, or enum value. Comment text is emitted verbatim except
that newlines are re-prefixed with `// `.

## 8. Determinism {#determinism}

Two conforming implementations MUST produce byte-identical files for the same
input document, options, and lock file.

Requirements:

1. Traversal order is document order. Implementations MUST preserve JSON object
   member order when parsing.
2. No hash-set or hash-map *iteration* may influence output. Membership lookups
   are fine; iteration is not. Import collection, `required` merging, and
   namespace collection all MUST use insertion-ordered structures.
3. File output order is lexicographic by path.
4. Within a file: `syntax`, `package`, imports (well-known first, then
   lexicographic), then types in document order.
5. Within a message: nested types in generation order, then fields in emission
   order, then `reserved` declarations sorted ascending.
6. Indentation is two spaces. Files end with a single newline.

## 9. Errors {#errors}

The following MUST be errors, each reported with the JSON Pointer of the
offending node:

| Condition | Reason |
|---|---|
| Document declares neither `type` nor `$root` *and* has no `definitions` | Nothing to generate ({{files}}) |
| `$ref` cannot be resolved | Dangling reference |
| Abstract type used as a value type | Not representable |
| Cycle in the `$extends` graph | Flattening cannot terminate |
| An extending type redefines an inherited property | Core forbids it; picking a winner silently would be lossy |
| `uses` names an add-in not in `$offers` | Caller error |
| `altnames.proto` / `altenums.proto` value is not a legal identifier | Would produce a file `protoc` rejects |
| Two pinned numbers collide in one message | Ambiguous wire contract |
| A pinned number contradicts the lock file | Someone edited one without the other |
| A `protoNumber` is outside 1..=536870911, or falls in 19000..=19999 | `protoc` rejects it |
| A `protoNumbers` value is outside 0..=2147483647, or is 0 | Enum values are `int32`; 0 belongs to `_UNSPECIFIED` |
| The lock file's `version` is not 2 | An ignored lock renumbers every field |
| Two properties map to the same protobuf field name | Ambiguous wire contract |
| Two declared types map to the same protobuf name | `protoc` forbids redefinition; renaming either would be an arbitrary choice ({{generated-names}}) |
| A namespace path segment is not a legal package component | Would produce a file `protoc` rejects |
| Two namespaces lowercase to the same package | Their contents would merge and be renamed ({{files}}) |
| Any cycle in the file import graph, of any length | `protoc` forbids circular file imports |
| Two enums in one scope declare the same symbol | `protoc` rejects it |
| An enum declares `<ENUM_NAME>_UNSPECIFIED` | Collides with the synthesized zero value |
| `additionalProperties` with `additional_properties: error` | Explicit caller choice |

The following MUST be warnings {#warnings}:

| Condition | Consequence |
|---|---|
| `additionalProperties` with `additional_properties: ignore` | Undeclared properties are not transmitted |
| `enum` symbols are not legal identifiers | Falls back to `string` |
| `default` or `const` present | Not representable; the value is not enforced |
| `set` used | Uniqueness is not enforced on the wire |
| A generated name collides with a declared name | Suffixed |
| `required` declares alternative sets | Only the intersection emits plain fields; the choice is not enforced |

## 10. Compatibility notes

**What protobuf gives you.** Unknown fields are preserved by most runtimes and
round-trip through an intermediary. Adding an `optional` field is safe. Removing
a field is safe *if* its number is reserved. Renaming a field is safe on the wire
and breaking in generated code.

**What it does not.** Changing a field's type, changing its number, or reusing a
retired number is silent corruption. Nothing in the encoding will tell you.

**The discipline this mapping asks for:**

1. Use a lock file. Check it in. Review changes to it.
2. Add properties at the end. Even with a lock file, this keeps the generated
   diff readable.
3. Never remove a property without letting the generator record its number as
   `reserved`.
4. Never change a property's type in place. Add a new property.
5. Treat `$extends` base types as frozen once published. A field added to a base
   type is a field added to the middle of every derived message.

**Relative to the Avro mapping**, protobuf is stricter about evolution and looser
about fidelity: it has real `uint64` and a proper `Any`, but no defaults, no
required fields, and no reader/writer schema resolution. A schema that is
serialized through both targets should be authored to the intersection —
append-only, with defaults treated as application-level policy rather than as
part of the contract.
