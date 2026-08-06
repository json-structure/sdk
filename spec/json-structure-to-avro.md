# JSON Structure to Avro Schema Mapping

**Status:** Normative for the JSON Structure SDKs.
**Version:** v0

## 1. Introduction

This document specifies a total, deterministic mapping from a JSON Structure
Core schema document to an Apache Avro schema.

The mapping exists so that an application can declare its data contract once, in
JSON Structure, and get Avro serialization without ever authoring or reading an
`.avsc` file. Avro is the assembly language here; JSON Structure is the source
language, and this document is the compiler specification.

### 1.1 Design principles

**Avro is a wire format, not a type system of record.** The mapping does not try
to make Avro express everything JSON Structure can say. It tries to make Avro
carry every *value* a JSON Structure schema admits, losslessly, and to make the
resulting schema evolve well under Avro's reader/writer schema resolution.

**Two modes, and `compact` is the default.** The mapping has one wire format
and two *annotation* levels, selected by the `mode` option ({{full-mode}}).

`compact` emits only what serialization requires. `full` emits the same schema
plus descriptive metadata: logical type annotations on the values that have a
narrower meaning than their Avro base type, and an `annotations` attribute
carrying the constraints Avro's type system cannot express.

**The two modes are wire-compatible.** This is the load-bearing property.
Every value occupies the same Avro base type in both modes, so data written
under one mode reads correctly under the other, and a reader that has never
heard of the annotations sees exactly the `compact` schema. `full` adds
information *about* the bytes; it never changes them.

That is why the temporal annotations use Avrotize's `rfc3339-*` family over a
`string` base rather than Avro's own `date` and `timestamp-micros`. Avro's
temporal logical types are UTC instants on integer bases: adopting them would
change the wire format *and* silently discard the offset that RFC 3339 requires
the value to carry. Keeping RFC 3339 text and naming what it holds loses
neither.

**Losslessness beats compactness.** Where a narrower Avro type would truncate or
wrap a legal JSON Structure value, the mapping chooses the wider or lexical
representation. `uint64` becomes `string`, not `long`, because Avro's `long` is
signed and the upper half of the `uint64` range would wrap silently.

**Determinism is normative.** Two conforming implementations MUST produce
byte-identical output for the same input document and options. This is not a
quality-of-implementation matter; the golden corpus in `test-assets/avro/` is
the conformance contract, and it cannot exist without it. See {{determinism}}.

### 1.2 Conventions

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, and MAY are to be
interpreted as described in BCP 14.

"Avro name" means an identifier matching `[A-Za-z_][A-Za-z0-9_]*`, as required
by the Avro specification for record, enum, fixed, field, and enum symbol names.

JSON Structure Core restricts type and property names to
`[A-Za-z_][A-Za-z0-9_]*`, which is the *same* production. A conforming JSON
Structure name is therefore always a legal Avro name, and this mapping performs
**no name mangling**. Mangling is only ever needed for values that escape that
production: `altnames`/`altenums` overrides, and `enum` symbol values. Both are
handled explicitly below.

### 1.3 Inputs

The compiler operates on a **consolidated** JSON Structure document: one in
which all `$import` and `$importdefs` references have already been resolved and
inlined. Import resolution is out of scope for this document.

The compiler accepts the following options:

| Option | Default | Effect |
|---|---|---|
| `mode` | `compact` | `compact` or `full`; see {{full-mode}} |
| `uses` | empty | Add-in names from `$offers` to apply (see {{offers-uses}}) |
| `additional_properties` | `ignore` | `ignore` or `error`; see {{additional-properties}} |
| `emit_doc` | `true` | Emit `doc` from `description` |

No option affects a generated name or namespace. The JSON Structure document is
the sole source of truth for the identity of every generated type: a schema name
is part of the wire contract, and a contract that changes with a caller-supplied
argument is not a contract. Implementations MUST NOT offer a way to prefix,
rewrite, or otherwise override a derived name or namespace.

## 2. Primitive types {#primitives}

The `Avro` column is the wire type, and it is the same in both modes. The
`full` column is the annotation `full` mode adds on top of it; an empty cell
means `full` emits the bare type, exactly as `compact` does.

| JSON Structure | Avro (both modes) | `full` adds | Notes |
|---|---|---|---|
| `null` | `null` | | |
| `boolean` | `boolean` | | |
| `string` | `string` | | |
| `number` | `double` | | See {{number}} |
| `integer` | `int` | | `integer` is an alias for `int32` |
| `int8` | `int` | | |
| `int16` | `int` | | |
| `int32` | `int` | | |
| `int64` | `long` | | |
| `int128` | `string` | | Decimal literal; exceeds `long` |
| `uint8` | `int` | | |
| `uint16` | `int` | | |
| `uint32` | `long` | | Exceeds signed `int` |
| `uint64` | `string` | | Decimal literal; exceeds signed `long`. See {{uint64}} |
| `uint128` | `string` | | Decimal literal |
| `float8` | `float` | | |
| `float` | `float` | | |
| `double` | `double` | | |
| `decimal` | `bytes` | | `decimal` logical type in **both** modes; see {{decimal}} |
| `date` | `string` | `rfc3339-date` | RFC 3339 `full-date` |
| `time` | `string` | `rfc3339-time-micros` | RFC 3339 `full-time`, offset preserved |
| `datetime` | `string` | `rfc3339-timestamp-micros` | RFC 3339 `date-time`, offset preserved |
| `duration` | `string` | `rfc3339-duration` | ISO 8601 duration |
| `uuid` | `string` | `uuid` | RFC 9562 textual form |
| `uri` | `string` | | RFC 3986 |
| `jsonpointer` | `string` | | RFC 6901 |
| `binary` | `bytes` | | |
| `any` | see {{any}} | | Empty record; a schema hole |

In `compact` mode, implementations MUST NOT emit a `logicalType` attribute for
any of these except `decimal`, which carries one in both modes ({{decimal}}).
In `full` mode, implementations MUST emit exactly the annotations in the `full`
column and no others.

### 2.1 `number` {#number}

JSON Structure `number` is any JSON number and is therefore not bounded in
precision. Avro has no arbitrary-precision numeric primitive, so `number` maps
to `double`. Schema authors who need exact arbitrary-precision values MUST
declare `decimal` rather than `number`; `decimal` is exact ({{decimal}}).

This is the one place the mapping knowingly narrows, and it does so because
`number` is already a loosely specified type whose values are, in practice,
produced and consumed as IEEE 754 doubles by every mainstream JSON parser.

### 2.2 `uint64` {#uint64}

Avro's `long` is a signed 64-bit integer. JSON Structure `uint64` admits values
up to 2^64-1, and every value above 2^63-1 would be written as a negative
`long` and read back wrong. The mapping therefore carries `uint64` as a decimal
string.

`uint32` has no such problem against `long` and is mapped numerically.

### 2.3 `decimal` {#decimal}

`decimal` maps to Avro's `decimal` logical type on a `bytes` base, in **both**
modes:

```json
{ "type": "bytes", "logicalType": "decimal", "precision": 20, "scale": 2 }
```

This is the one logical type `compact` mode emits, because here Avro's own
model is exactly right. `decimal` is a reserved Avro logical type with a
defined binary encoding — the unscaled value as a two's-complement big-endian
integer — that is lossless for any precision and scale a JSON Structure author
can declare. There is nothing to lose by using it and a real interchange
benefit to gain, so the choice does not belong to a mode.

`precision` comes from the declaration and `scale` defaults to `0` when absent,
as in Avro.

Avro requires `precision` to be present and `scale` to be no greater than it.
A `decimal` that declares no `precision`, or a `scale` exceeding its
`precision`, cannot be expressed: the compiler emits a `string` carrying the
decimal literal and MUST warn ({{warnings}}). Inventing a precision would
silently impose a range the author never wrote.

Avrotize instead writes `{"type": "string", "logicalType": "decimal"}`. That
schema is not loadable: `decimal` is a reserved name, and Apache Avro 1.12 for
.NET rejects it with `'decimal' can only be used with an underlying bytes or
fixed type`. This specification does not follow it.

### 2.4 `precision`, `scale`, `maxLength`, and content keywords

`maxLength`, `contentEncoding`, `contentCompression`, and `contentMediaType`
are constraints, not representations. They do not affect the emitted Avro type
and MUST be ignored by the compiler. Constraint enforcement remains the job of
the JSON Structure instance validator.

`precision` and `scale` are the exception: on `decimal` they are part of the
value's representation, and {{decimal}} governs them.

In particular, `binary` MUST map to `bytes` and MUST NOT map to Avro `fixed`,
even when a length constraint is present. `fixed` couples the wire format to a
length that JSON Structure treats as a validation rule, and changing that rule
would be a breaking schema change rather than a validation change.

### 2.5 `full` mode {#full-mode}

`full` mode emits the schema `compact` would emit, plus two kinds of
annotation. It changes no base type, no field, no name, and no byte on the
wire.

**Logical type annotations.** Values whose `string` base understates what they
carry are annotated with Avrotize's `rfc3339-*` family:

| JSON Structure | Emitted in `full` mode |
|---|---|
| `date` | `{"type": "string", "logicalType": "rfc3339-date"}` |
| `time` | `{"type": "string", "logicalType": "rfc3339-time-micros"}` |
| `datetime` | `{"type": "string", "logicalType": "rfc3339-timestamp-micros"}` |
| `duration` | `{"type": "string", "logicalType": "rfc3339-duration"}` |
| `uuid` | `{"type": "string", "logicalType": "uuid"}` |

`uuid` is a reserved Avro logical type and `string` is its required base, so it
needs nothing special. The `rfc3339-*` names are an Avrotize extension.

`int128`, `uint64`, `uint128`, `uri`, and `jsonpointer` get no annotation.
There is no established logical name for them, and inventing one would put a
private vocabulary on the wire for no reader's benefit.

**Constraint annotations** in an `annotations` attribute, per
{{constraint-annotations}}.

#### 2.5.1 Reading a `full` schema {#full-mode-readers}

An `rfc3339-*` annotation is descriptive. A reader that does not recognize the
name sees a `string` and is correct; that is the whole design.

Some Avro libraries are nonetheless strict about *unknown* logical type names
and refuse to parse rather than ignore. Apache Avro 1.12 for .NET is one:

```
AvroTypeException: Logical type 'rfc3339-date' is not supported.
```

A conforming SDK that offers `full` mode MUST therefore ensure its own runtime
can load what it emits — by registering the `rfc3339-*` names with the Avro
library where the library allows it, as the .NET SDK does. Implementations
SHOULD document this for callers who hand a `full` schema to a third-party
consumer, because that consumer may need the same registration.

This is the practical cost of `full` mode, and it is the reason `compact` is
the default. `compact` is loadable everywhere with no arrangements at all.

## 3. Compound types

### 3.1 `object` {#object}

An `object` maps to an Avro `record`.

- The record `name` is the type's Avro name (see {{naming}}).
- The record `namespace` is derived from the type's definition path (see
  {{namespaces}}).
- Fields are emitted in `properties` document order. Implementations MUST
  preserve document order and MUST NOT sort.
- `$extends` and add-in bases are flattened first; see {{extends}}.
- Each property becomes one field, per {{fields}}.

### 3.2 Fields, `required`, and `default` {#fields}

For each property `p` with schema `S`:

- Let `T` be the Avro type for `S`.
- If `p` is listed in `required`, the field type is `T`.
- If `p` is not required and has no `default`, the field type is
  `["null", T]` and the field `default` is `null`.
- If `p` is not required and has a `default` value `d`, the field type is
  `[T, "null"]` and the field `default` is `d`.

Avro requires a field's default to be valid against the *first* branch of a
union, which is why the branch order flips with the presence of a default.

Core also permits `required` to be a list of **alternative sets** — an array of
arrays, any one of which satisfies the type. Avro has no way to express that
disjunction, so it is reduced to the **intersection** of the alternatives: a
property named in every alternative is present whichever alternative holds and
is emitted non-null; a property named in only some of them may legitimately be
absent and is emitted optional. The disjunction itself is not enforced on the
wire, which MUST be reported as a warning ({{warnings}}).

Taking the union of the alternatives instead would emit non-null fields for data
that is allowed to omit them, and ignoring the keyword — the tempting shortcut,
since the value is not the flat list the simple case produces — silently retypes
every field in the record. Both are wire-visible errors.

Optional-with-null-default is what makes this mapping evolve well: a readerusing an older schema resolves a newly added optional field to its default
instead of failing. Schema authors who care about compatibility SHOULD add new
properties as optional and SHOULD NOT remove or retype existing ones.

If `T` is itself a union (from a JSON Structure type union), the branches are
flattened into the enclosing union rather than nested; Avro does not permit
unions directly inside unions. Duplicate branches are removed per
{{type-unions}}.

If `T` already contains a `null` branch, no second `null` is added; the existing
branch is moved to the front (no default) or left in place (with a default).

#### 3.2.1 Placing a default in a union {#default-placement}

Avro checks a field default against exactly one schema — the **first branch** of
a union, or the type itself when there is no union. This is a placement rule,
not a value rule, and treating it as anything else produces the worst class of
bug this mapping can produce: `Schema.parse` accepts the schema, and the failure
surfaces much later, in production, as a resolution error against real data.

An implementation therefore MUST resolve the default's branch at compile time:

1. If `default` is a single-key object whose key names a branch of the union, it
   is a **tagged** default ({{tagged-unions}}). The named branch is selected and
   the tag is consumed — Avro writes a union default as the bare value of its
   first branch, with no tag. If the named branch is a wrapper record
   ({{tagged-unions}}), the value is re-wrapped in that record's single field.
2. Otherwise the first branch the default could be a value of is selected,
   compared structurally: `null` to null, `boolean` to boolean, `int`/`long` to
   an integer, `float`/`double` to any number, `string`/`bytes`/`fixed`/`enum` to
   a string, `array` to an array, `record`/`map` to an object.
3. The selected branch is **rotated to the front** of the union, preserving the
   relative order of the branches ahead of it. Union branch order is otherwise
   document order, and this is the only rule permitted to disturb it.
4. If no branch is selected, the schema is **invalid** ({{errors}}). An
   implementation MUST NOT emit the default anyway and MUST NOT silently drop it.

Branch order is part of the wire format — it determines the union index — so
this rotation MUST be derived from the document alone, exactly as specified, or
two implementations will disagree on the bytes.

### 3.3 `array` and `set`

Both map to `{"type": "array", "items": <item type>}`.

Avro has no set type. Uniqueness is a validation constraint that the JSON
Structure instance validator enforces; it is not expressible on the wire and
MUST NOT change the emitted type. A `set` and an `array` of the same item type
produce identical Avro, which is intentional: they are the same wire shape.

### 3.4 `map`

Maps to `{"type": "map", "values": <value type>}`.

Avro map keys are always `string`, which matches JSON Structure's rule that map
keys are JSON strings. Avro imposes no identifier restriction on map keys, so
arbitrary keys pass through unchanged.

### 3.5 `tuple`

Maps to an Avro `record` whose fields are the tuple's properties **in the order
given by the `tuple` keyword**, not in `properties` document order.

All tuple properties are implicitly required by JSON Structure Core, so every
field is emitted non-nullable, and `required` is ignored on tuples.

### 3.6 `any` {#any}

`any` maps to an **empty Avro record** — a record with a name and no fields.

```json
{ "type": "record", "name": "Envelope_payload", "fields": [] }
```

The name and namespace follow the ordinary naming rules ({{naming}},
{{generated-names}}): a named `any` type uses its own name, and an anonymous
`any` in a property, item, or value position gets the generated name for that
position. The name must be per-position rather than a single global intrinsic,
because Avro does not permit two different definitions of the same named type in
one schema, and two `any` positions in the same document may well be filled with
different concrete types.

This is a **schema hole**, not a value type. It works because of two rules in
Avro's schema resolution, both of which the reader gets for free from the fact
that Avro data always travels with its writer's schema:

- Two records match if their **unqualified names** match — the field lists need
  not agree at all.
- *"If the writer's record contains a field with a name not present in the
  reader's record, the writer's value for that field is ignored."*

So an empty reader record consumes anything a writer put at that position.

**Writing.** A writer MAY substitute a concrete record schema at an `any`
position. The substituted record MUST carry the same unqualified name as the
placeholder, or resolution will fail. A writer that has nothing to put there
writes the empty record, which occupies **zero bytes** on the wire.

**Reading.** The payload is ordinary Avro data described by an ordinary writer
schema. The hole exists only in one reader's view of it, so three readers can
stand at the same position and each get what it needs:

- A reader carrying the **placeholder** decodes the position and discards its
  content, per the field-ignoring rule above. It needs to know nothing about the
  payload and pays nothing to skip it.
- A reader carrying a schema in which the **hole is filled** — same unqualified
  name, but with the concrete fields declared — resolves against the writer's
  schema by the ordinary rules and gets fully typed data. Such a schema comes
  from compiling a document in which that position is the concrete type rather
  than `any`. Nothing special happens at read time: to this reader the position
  was never a hole. The usual resolution rules still apply, so any field the
  reader declares that the writer did not write needs a default.
- A **generic reader** decodes the subtree against the *writer's* schema instead
  of its own, reading the data as if it did not know the reader schema at all.
  Every mainstream Avro implementation exposes this. This is the route for a
  party that has no schema for the payload and wants the content anyway — a log
  indexer, a router, a debugging tool.

So `any` does not make data unreadable, it makes it unread. A writer that fills
the hole emits exactly the bytes it would have emitted had the position been
declared concretely from the start, which means the decision to look inside
belongs to each reader independently, and a reader that starts out ignoring a
position can begin interpreting it later without any change on the writing side.

This costs nothing on the wire and needs no union tags, no recursive intrinsic
type, and no agreement between writer and reader about the shape of the payload.
The price is that the writer's substituted type must be a *record*: Avro cannot
resolve a writer's bare `string` against a reader's record. A writer carrying a
primitive at an `any` position therefore wraps it in a record with a single
field. That wrapping is a writer-side convention; the compiler emits only the
placeholder.

#### 3.6.1 The compiled schema is a reader schema here {#any-asymmetry}

Everything above is asymmetric, and implementations MUST NOT paper over it. At
an `any` position the compiler's output is a **reader** schema. It is not usable
as a writer schema for any payload other than the empty one, and Avro
implementations enforce that: a non-empty record value offered against a
zero-field record schema is rejected, not truncated.

A producer therefore needs two schemas — the placeholder one it publishes for
readers, and a concrete one in which the hole is filled — and gets them from two
compilations of two documents, or from one document plus a hand-written writer
schema. Nothing in this specification lets a single compiled artifact serve both
roles at an `any` position.

Two further limits follow from the same asymmetry:

- **Collections of `any` are homogeneous.** `array` and `map` carry one item
  schema, so every element of an `array` of `any` must be filled with the *same*
  concrete type in the writer schema. A genuinely heterogeneous collection is
  not expressible; use a `choice` and enumerate the branches.
- **The substituted type must be a record**, as noted above.

Because none of this is visible in the emitted schema, an implementation MUST
emit a warning ({{warnings}}) at every `any` position, naming the position and
stating that it is readable but not writable.

### 3.7 `choice` {#choice}

A `choice` maps to an Avro **union**.

This is a closer fit than it looks. Avro's JSON encoding writes a union value as
a single-key object `{"<branch name>": <value>}`, which is exactly the JSON
Structure tagged-union encoding. Where the branch names line up, a JSON
Structure tagged union and its Avro JSON encoding are the same document.

#### 3.7.1 Tagged unions {#tagged-unions}

For each entry `(key, branch)` in `choices`, in document order:

1. Compute the Avro type `B` for `branch`.
2. If `B` is a primitive whose Avro type name equals `key`, use `B` directly.
3. Otherwise, if `B` is a named type (record, enum, fixed) whose unqualified
   name equals `key`, use `B` directly.
4. Otherwise, wrap: emit a record named `key`, in the choice's namespace, with a
   single required field named `value` of type `B`, and use that record. The
   wrapper's name is a generated name and is subject to {{generated-names}}, so
   a `key` already taken in that namespace yields `key_2` and a warning.

The union is the resulting branch list in document order.

Because `choices` keys are unique and each wrapper record takes its name from
its key, the branches are guaranteed to be distinct Avro types, satisfying
Avro's requirement that a union not contain two branches of the same type.

Rules 2 and 3 are what preserve the encoding correspondence for the common
cases — `{"string": {"type": "string"}}` yields the plain Avro `string` branch,
and a choice keyed by the referenced type's own name yields that type directly.

The correspondence is best-effort, not a guarantee: Avro type names are global
within a namespace while `choices` keys are local to their choice, so two
choices in one namespace that share a key cannot both name their wrapper after
it. The second one is suffixed, its JSON encoding no longer matches the JSON
Structure tagged form, and the warning says so. Authors who depend on the
correspondence should keep choice keys unique within a namespace, or give the
branch a named type per rule 3.

#### 3.7.2 Inline unions

When a `choice` carries `$extends` and `selector`, each branch is a record
extending the abstract base type.

- The base type is abstract and MUST NOT itself be emitted as a named Avro type.
- Each branch record is emitted with the base type's fields flattened in, per
  {{extends}}.
- The `selector` property is materialized as the **first** field of every branch
  record, of type `string`, unless the branch already declares a property of
  that name (in which case that property MUST be of type `string` and is used
  as-is, in its declared position).
- The choice maps to the union of the branch records.

The selector field is retained even though Avro's union tag already carries the
discriminator. Dropping it would lose a value that the JSON Structure instance
carries, and a generic Avro reader would not be able to reconstruct it.

### 3.8 Non-discriminated type unions {#type-unions}

A `type` whose value is an array maps to an Avro union.

- Branches are computed in document order.
- Branches that resolve to the same Avro type are deduplicated, keeping the
  first occurrence. `["int8", "int16"]` both resolve to `int` and therefore
  collapse to the single branch `int`.
- If deduplication leaves exactly one branch, the bare type is emitted rather
  than a one-branch union.
- Nested unions are flattened.

JSON Structure prohibits inline compound types inside non-discriminated unions,
so every branch is a primitive or a `$ref`, and no anonymous named types are
generated here.

## 4. Enumerations

### 4.1 `enum` {#enum}

A schema with `enum` maps to an Avro `enum` **if and only if** all of the
following hold:

- the declared `type` is `string`, and
- every symbol, after applying `altenums` (see {{altnames}}), is a legal Avro
  name.

Otherwise the schema maps to the plain Avro type of its declared `type`, and the
enumeration is left to the instance validator. A non-string enum, or a string
enum with symbols like `"in-progress"` or `"2xx"`, cannot be an Avro enum, and
inventing mangled symbols for them would produce a wire contract that does not
survive a rename.

When an Avro `enum` is emitted:

- `name` and `namespace` follow {{naming}}.
- `symbols` are emitted in `enum` document order.
- A `default` symbol is emitted only if the schema declares a `default` that is
  one of the symbols. This matters: an Avro reader encountering a symbol it does
  not know fails unless the enum has a default.

Anonymous enums — an `enum` on an inline property schema rather than a named
type — get a generated name per {{generated-names}}.

### 4.2 `const`

`const` maps to the plain Avro type of the declared `type`. Avro has no constant
type, so nothing on the wire prevents a writer from putting something else
there; the constraint is enforced only by the instance validator.
Implementations MUST emit a warning.

## 5. Document structure

### 5.1 Root type

- If the document declares `type` at the root, that type is the Avro schema's
  top-level type.
- If the document declares `$root`, the type it points at is the top-level type.
- A document with neither is a definitions library and has no top-level type.
  Compiling it MUST be an error unless the caller names a type explicitly.

### 5.2 Namespaces {#namespaces}

A type declared at `#/definitions/A/B/C` has Avro name `C` and namespace `A.B`.
A type declared at `#/definitions/C` has Avro name `C` and no namespace.

The namespace is therefore a function of the document alone. An author who wants
`com.example.sales.Order` nests the definition at
`#/definitions/com/example/sales/Order`. There is no option to supply or prefix a
root namespace.

Namespace segments are emitted verbatim, preserving case. JSON Structure
identifiers are already legal Avro namespace segments.

### 5.3 References and recursion

`$ref` resolves to a type declaration in the same consolidated document.

Avro requires a named type to be defined at its first textual occurrence and
referenced by name thereafter. The compiler therefore performs a single
depth-first traversal from the top-level type, emitting the full definition the
first time a named type is reached and its fully-qualified name every subsequent
time.

Recursive and mutually recursive types work naturally: by the time a cycle
closes, the name is already in scope.

Traversal order is fixed by {{determinism}} and is the sole determinant of which
occurrence gets the full definition.

### 5.4 `abstract` and `$extends` {#extends}

`abstract` types MUST NOT be emitted as Avro named types. Avro has no abstract
record, and JSON Structure explicitly forbids subtype polymorphism, so an
abstract type never appears as the type of a value.

`$extends` is resolved by flattening:

- Base type fields are emitted first, then the extending type's own fields.
- Flattening is transitive. A chain `A ← B ← C` emits A's fields, then B's,
  then C's. The chain has no depth limit.
- With multiple bases, bases are flattened in `$extends` array order.
- A name contributed by more than one base — the diamond case, where two bases
  share a grandparent, or where two bases independently declare the same
  property — is emitted **once**, at the position of its first contribution,
  with the declaration from the first base in the array. This follows Core:
  "the property from the first base type in the array takes precedence."
- An extending type MUST NOT redefine a property it inherits through its own
  `$extends` chain. A compiler MUST reject this rather than silently pick a
  winner (§8). The single exception is an inline union's `selector`, which Core
  explicitly permits to shadow a base property.
- A cycle in the `$extends` graph MUST be reported as an error (§8), not left to
  exhaust the stack. Cycle detection tracks the *ancestor path*, not the set of
  visited types, so that a diamond still resolves.
- An add-in (§5.5) contributes its fields at the position of the type it
  targets, not at the end of the flattened list. An add-in on a mid-chain base
  therefore appears before the derived type's own fields.
- A generated name for an inherited inline type is derived from the **concrete**
  type being emitted, not from the base that declared the property. A `location`
  object declared on abstract `Placemark` and inherited by `Landmark` becomes
  `Landmark_location`.

Flattening rather than composing is the only option Avro offers, and it is
sound here precisely because JSON Structure's inheritance is
properties-only and non-polymorphic.

### 5.5 `$offers` and `$uses` {#offers-uses}

`$offers` advertises add-in types. `$uses` selects them, and in JSON Structure
`$uses` lives in the *instance* document, not the schema — so the compiler
cannot read it from the schema. It is supplied as the `uses` compile option.

For each name in `uses`, in the order the names appear in the document's
`$offers` map (not the order given by the caller — this is a determinism
requirement):

- Resolve the name to one or more add-in type definitions.
- Each add-in is an abstract type carrying `$extends` pointing at its target.
- The add-in's properties are appended to the target type's fields, after the
  target's own fields, in the add-in's `properties` document order.
- Multiple add-ins targeting the same type are applied in `$offers` order.

An add-in name in `uses` that is not present in `$offers` MUST be an error.

Add-in types themselves are abstract and are never emitted as named types.

### 5.6 `additionalProperties` {#additional-properties}

Avro records are closed. There is no way to carry properties that the schema
does not declare.

- `additionalProperties: false` — no effect; the record is closed either way.
- `additionalProperties: true` or a schema — under the default `ignore` option
  the keyword has no effect on the emitted type, and the compiler MUST surface a
  warning naming the affected type. Under the `error` option, compilation fails.

The warning is not decorative. A schema that relies on open records will lose
data through this mapping, and the developer needs to be told once, loudly,
rather than discovering it in production.

## 6. Names and annotations

### 6.1 Naming {#naming}

The Avro name of a type or field is, in order of precedence:

1. `altnames["avro"]`, if present.
2. The `name` keyword, for a named type.
3. The property key, for a field.
4. A generated name, for anonymous types ({{generated-names}}).

An `altnames["avro"]` value that is not a legal Avro name MUST be an error. The
whole point of the key is to let an author reach a name that JSON Structure's
own identifier rule would reject; letting it produce illegal Avro would defeat
that.

### 6.2 The `avro` altnames key {#altnames}

This document defines `"avro"` as a reserved purpose indicator for the
`altnames` and `altenums` keywords of the JSON Structure Alternate Names
extension, alongside the existing reserved `"json"` key and `"lang:"` prefix.

- On a **named type**, `altnames["avro"]` supplies the Avro record, enum, or
  fixed name.
- On a **property**, `altnames["avro"]` supplies the Avro field name.
- On an **enum**, `altenums["avro"]` supplies a map from JSON Structure enum
  value to Avro enum symbol.

Values MUST be legal Avro names.

```json
{
  "name": "Person",
  "type": "object",
  "altnames": { "avro": "PersonRecord" },
  "properties": {
    "firstName": {
      "type": "string",
      "altnames": { "json": "first_name", "avro": "first_name" }
    },
    "status": {
      "type": "string",
      "enum": ["in-progress", "done"],
      "altenums": { "avro": { "in-progress": "IN_PROGRESS", "done": "DONE" } }
    }
  },
  "required": ["firstName"]
}
```

The `status` property above becomes an Avro `enum` precisely because
`altenums["avro"]` rewrites `in-progress` into a legal symbol. Without it, the
property would fall back to plain `string` per {{enum}}.

The key exists for two jobs: reaching names Avro allows but JSON Structure does
not, and matching a pre-existing `.avsc` that an organization already has in
production.

### 6.3 Generated names {#generated-names}

Anonymous compound types — an inline `object`, `tuple`, `choice`, or `any` in a
property, item, or value position, or an anonymous `enum` — need a name.

The generated name is `<enclosing type name>_<member name>`, where the member
name is the property key, or `item` for an `items` position, or `value` for a
`values` position.

If that name is already taken in the target namespace, `_2` is appended, then
`_3`, and so on, in traversal order.

The names of **all declared types MUST be reserved before any generated name is
minted**, not as each type is reached. Otherwise a helper minted early takes a
name a declaration further down the document later emits verbatim, and the
schema carries two definitions of one Avro fullname — which parsers reject, and
which would conflate the two types if one did not. Reserving up front also makes
generated names independent of traversal order, as {{determinism}} requires: a
declared name always wins, and the generated one always yields.

An implementation MUST emit a warning ({{warnings}}) whenever it suffixes.

Nesting composes: an inline object under property `b` of an inline object under
property `a` of record `R` is `R_a_b`.

Schema authors who care what their Avro types are called SHOULD declare named
types in `definitions` rather than relying on generated names. Generated names
are stable under this specification but they are a function of property names,
so renaming a property renames a type.

### 6.4 `description`

When `emit_doc` is true, `description` maps to Avro `doc` on records, enums,
fixed types, and fields, verbatim.

`descriptions` (the multi-variant form), `examples`, `title`, and `unit` are not
emitted. Avro `doc` is a single string with no language tag, and picking one
language silently would be worse than emitting nothing.

#### 6.4.1 Constraint annotations in `full` mode {#constraint-annotations}

JSON Structure constrains values in ways Avro's type system cannot: a
`maxLength` on a string, a `minimum` on a number, a `pattern`. Avro has no
place for them, so `compact` mode drops them and warns where it matters.

`full` mode carries them instead, in a single `annotations` attribute
alongside `doc`:

```json
{
  "name": "total",
  "type": { "type": "bytes", "logicalType": "decimal", "precision": 9, "scale": 2 },
  "doc": "Order total",
  "annotations": { "minimum": 0 }
}
```

Avro schemas are extensible: a parser MUST ignore an attribute it does not
recognize, and a well-behaved one preserves it. So an attribute costs a reader
that has never heard of JSON Structure nothing, and gives one that has the
constraint in the form it was written — a number is a number, a pattern is a
string that a regex engine can compile.

This is a deliberate departure from Avrotize, which appends the same
information to `doc` as `[minimum: 0, scale: 2]`. That form is a display string:
it cannot round-trip, it collides with prose, and nothing parses it back. An
attribute has none of those problems, and the two can coexist in one schema
because they occupy different keys.

**The attribute.** `annotations` is a JSON object. Its keys are JSON
Structure keywords and its values are those keywords' values, verbatim and with
their original JSON types. The attribute is emitted on the same object that
carries `doc` — a field object for a property, the type object for a named
record or enum — and only when at least one key applies. It is never emitted in
`compact` mode.

Keys are emitted in this fixed order, omitting absent ones:

`maxLength`, `minLength`, `precision`, `scale`, `pattern`, `minimum`,
`maximum`, `contentEncoding`, `contentMediaType`, `contentCompression`.

**Not a contract.** The attribute records what the source document said. It
does not make Avro enforce anything, and an implementation MUST NOT treat a
value that violates a constraint as a serialization error. The warnings of
{{warnings}} still apply: `full` mode makes the loss visible, not absent.

**No duplication with `decimal`.** When a `decimal` declaration's `precision`
and `scale` were carried by Avro's own `decimal` logical type ({{decimal}}),
they MUST NOT also appear in `annotations`. They are already on the wire, in
Avro's own vocabulary, and repeating them invites the two copies to disagree.
When the declaration fell back to a lexical `string` — no `precision`, or a
`scale` above it — whichever of the two is present is annotated, because
nothing else is carrying it.

**Independent of `emit_doc`.** `emit_doc` governs `doc`, which is prose for a
human. Constraints are metadata for a program. An implementation that suppresses
`doc` MUST still emit `annotations`, and one that emits `doc` in `compact`
mode MUST NOT emit `annotations`. The two options are orthogonal, and
`emit_doc` means what it says.

**Extending it.** The key set above is closed for this version. A future version
MAY add keys; because the attribute is an object, doing so is additive and an
existing reader is unaffected. An implementation MUST NOT add keys of its own —
determinism ({{determinism}}) requires that two conforming implementations emit
the same bytes.

## 7. Determinism {#determinism}

A conforming implementation MUST produce byte-identical output for identical
input and options.

1. **Traversal order.** Single depth-first walk from the top-level type. Within
   a record, fields in `properties` document order, or `tuple` order for tuples.
   Within a union, branches in document order. Within `choices`, entries in
   document order.
2. **No unordered collections.** Implementations MUST NOT iterate a hash set or
   hash map at any point that influences output. `required` membership is a
   lookup, never an iteration source.
3. **Key order in emitted JSON objects.** Attributes are emitted in this order,
   omitting absent ones: `type`, `name`, `namespace`, `doc`, `annotations`,
   `aliases`, `fields`, `symbols`, `items`, `values`, `size`, `logicalType`,
   `precision`, `scale`, `default`. Within a field object: `name`, `type`,
   `doc`, `annotations`, `default`, `order`, `aliases`. Within
   `annotations`, keys follow the fixed order of {{constraint-annotations}},
   not the source document's order.
4. **Generated-name suffixing** follows traversal order, per
   {{generated-names}}.
5. **Add-in application** follows `$offers` document order, per {{offers-uses}}.
6. **No environment dependence.** No clock, no randomness, no locale-sensitive
   casing or collation, no filesystem enumeration order.

## 8. Errors {#errors}

The compiler MUST reject, rather than silently degrade, in these cases:

| Condition | Reason |
|---|---|
| No root type and no explicit type named | Nothing to compile |
| `altnames["avro"]` is not a legal Avro name | Would emit invalid Avro |
| `altenums["avro"]` symbol is not a legal Avro name | Would emit invalid Avro |
| `$uses` name not found in `$offers` | Caller asked for something that is not there |
| Abstract type reached as a value type | Schema error; validator should have caught it |
| Cycle in the `$extends` graph | Flattening cannot terminate |
| An extending type redefines an inherited property | Core forbids it; picking a winner silently would be lossy |
| Unresolvable `$ref` | Document is not consolidated, or is broken |
| `additionalProperties` open, under the `error` option | Caller asked to be strict |
| `default` matches no branch of the generated type | Would parse and then fail at read time ({{default-placement}}) |
| Two declared types map to the same Avro fullname | Avro forbids redefinition; renaming either would be an arbitrary choice ({{generated-names}}) |

Errors MUST carry the JSON Pointer path of the offending schema node, matching
the error style of the JSON Structure validators.

The following MUST be warnings {#warnings}, each carrying the same JSON Pointer:

| Condition | Consequence |
|---|---|
| `additionalProperties` open, under the `ignore` option | Undeclared properties are not transmitted |
| `const` present | Avro cannot express it; the value is not enforced |
| `set` used | Avro has no set type; uniqueness is not enforced on the wire |
| `required` declares alternative sets | Only the intersection is emitted non-null; the choice is not enforced |
| `any` used | The position is readable but not writable; see {{any-asymmetry}} |
| A generated name is suffixed to avoid a declared type | The anonymous type's Avro name is not the one the naming rules would predict |
| `decimal` with no `precision` | Avro requires one; the value is carried as a lexical string instead ({{decimal}}) |
| `decimal` with `scale` greater than `precision` | Avro forbids it; the value is carried as a lexical string instead ({{decimal}}) |

## 9. Compatibility notes

Avro resolves a reader schema against a writer schema by field *name*, which
gives this mapping useful evolution properties for free:

- **Adding an optional property** is backward compatible. Old readers ignore
  the new field; new readers resolve it to `null` in old data.
- **Adding a required property** is not. Old data has no value and no default.
- **Removing a property** is forward compatible only if the reader treats it as
  optional.
- **Reordering properties** is safe. Avro matches on name, not position. This is
  the one respect in which Avro is materially kinder than Protobuf, where field
  numbers are positional identity.
- **Renaming a property** is a breaking change unless the old name is carried as
  an Avro alias. This specification does not emit aliases in v0.
- **Adding an enum symbol** breaks old readers unless the enum has a `default`
  symbol; see {{enum}}.
- **Widening a numeric type** is safe in Avro's promotion rules for
  `int` → `long` → `float` → `double`. Narrowing is not.
- **Filling an `any` hole** is always compatible in both directions. A writer
  may start populating a previously empty `any` position without breaking any
  reader, and may change what it puts there at will, because the reader's
  placeholder ignores whatever it finds. The one constraint is the unqualified
  record name, which both sides derive from the same JSON Structure document.

The practical discipline for a JSON Structure author targeting Avro is short:
add properties as optional, never retype in place, give enums a default, and
prefer named types over inline ones so that generated names do not move under
you.
