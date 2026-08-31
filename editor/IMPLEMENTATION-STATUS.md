# JSON Structure Editor Implementation Status

Updated: 2026-08-31 (runnable Electron alpha)
Branch: `editor-autopilot`
Worktree: `C:\git\json-structure-sdk-editor`

Blocking findings in this milestone: none. The editor now has a runnable shared browser workbench and a secure Electron host. The alpha exposes Design, Graph, and Source modes; outline, property, inspector, and problems surfaces; Open, Save, and Save As; dirty-document replacement protection; command-line and operating-system file opening; and atomic file writes. The renderer remains host-neutral for later reuse in VS Code.

The Phase 1 coverage inventory contains 742 atomic draft-derived records. Every record has a stable ID, normative source, owning section, requirement, implementation owner, five evidence dimensions, and positive/negative/incomplete/host-parity test facets. All records remain partial: VS Code parity and complete graphical authoring coverage are pending, and no record is allowed to appear complete while any dimension or applicable test facet is incomplete.

The checked-in `coverage/inventory.json` is the authoritative deterministic baseline. `coverage/generated/ledger.json`, `coverage/generated/gaps.json`, and `coverage/generated/COVERAGE.md` are generated from it. The gate compares exact expanded ID sets and rejects omissions, undeclared extras, duplicate or malformed IDs, unknown specifications, malformed statuses or facets, stale evidence paths, missing normative sources, false completion claims, and stale generated artifacts. It does not scrape draft prose at runtime.

The old 87-record ledger was replaced rather than extended. Broad Core records were split into 156 separately testable keyword, value-form, placement, default, prohibition, resolution, and interaction records. Characteristics and Semantic Annotations each have 209 records generated from parallel normative rule families while retaining separate IDs and source ownership. Relations and Import evidence now points to implemented typed commands and direct inverse tests instead of stale editing and round-trip gaps. Those records remain partial because instance behavior, graphical surfaces, and production-host parity are not complete.

Interpretation questions remain visible in generated gaps instead of being silently resolved by editor behavior. They include contradictory Core reference/name/union/extends/uses language, undefined `$addins`, Validation `has` and `contains` questions, Alternate Names vocabulary mismatch, Import collision/depth policy, Relations scope and identity ambiguities, Units applicability and engine selection, and divergence between the Characteristics and Semantic Annotations drafts.

Milestone summary: `altnames`, `altenums`, and `descriptions` now have canonical capability activation, typed add/replace/remove commands, schema-owned placement and value diagnostics, sparse normalized inspection, exact JSON previews, and direct byte-identical inverses. `altnames` ownership is structural: it applies to explicitly named inline roots, reusable declarations in root or nested namespaces, and direct properties, but not anonymous descendants. `altenums` applies independently to any enum-bearing schema, including roots, properties, and anonymous collection items, and requires exact per-purpose coverage of a distinct string enum. `descriptions` remains independent of Core `description`. Custom purpose keys and values are preserved, and no language/locale catalog was added because the companion defines no advisory vocabulary.

Parser traversal is confined to Core-owned schema positions and therefore ignores Alternate Names-shaped content in defaults, descriptions, semantic payloads, relations, and unknown annotations. Inactive keywords receive exact activation diagnostics. Duplicate, stale, incomplete, escaped-key, nested-namespace ownership, anonymous-descendant placement, malformed language-tag, duplicate-variant, duplicate-extension-singleton, wrong-shape, missing-enum, and incomplete/extra enum-map paths are covered by focused parser and command tests.

Milestone summary: Conditional Composition now has typed add/replace/remove commands for `allOf`, `anyOf`, `oneOf`, and `not`, plus atomic `if`/`then`/`else` mutation across every valid branch-key set. Commands enforce capability activation, source uniqueness, stale/incomplete guards, branch shape and dependency rules, schema validity, exact JSON emission, one coordinated minimal edit for conditional replacement, and direct byte-identical inverse edits. The Validation meta-schema activates composition directly; the Extended meta-schema activates it only through exact `JSONStructureConditionalComposition` in `$uses`. The stale `JSONSchemaConditionalComposition` spelling is not accepted.

Parser projections expose sparse authored/effective inspection and exact JSON previews. Recursive validation recognizes untyped constraint objects at structurally owned root, `definitions` namespace, and Core schema-child positions while excluding defaults, examples, semantic annotations, relations, and unknown payloads. Untyped composition targets are inspectable and editable but remain non-reusable; Core type requirements for reusable and property declarations are unchanged. Inactive composition subtrees remain opaque to schema, semantic, structural, and reference traversal, with exact activation diagnostics at authored composition keywords.

Reference discovery accepts direct `{ "$ref": ... }` only in active composition branch positions, inventories each direct or typed branch reference once, resolves local and imported references through the existing host-neutral resolver, and excludes `$ref`-shaped literal defaults and payloads. The focused matrix covers canonical activation and alias rejection, structural ownership boundaries, positive and negative branch shapes, preserved Core direct-ref policy, incomplete/stale/duplicate/escaped paths, all conditional branch-key transitions, direct inverses, nested validation, inspection, imported references, and payload/cycle false-positive controls.

## Current milestone

The runnable Electron alpha is complete for Windows. Shared-model expansion and the VS Code host remain in progress.

Implemented:

- Host-neutral browser workbench with Design, Graph, and Source modes.
- Outline, property editor, inspector, and problems surfaces backed by `DocumentSession` commands.
- Sandboxed Electron 41 host with context isolation, no Node integration, and a narrow preload bridge.
- Open, Save, Save As, dirty-document replacement protection, command-line file opening, and atomic saves.
- Vite renderer build, tsup Electron build, and Electron Builder targets for Windows, macOS, and Linux.
- Strict JSON parser with source ranges, exact object-key ranges, JSON Pointer locations, and recovery sessions.
- Null-prototype JSON object materialization so keys such as `__proto__` remain ordinary data.
- Versioned serializable host contracts and an in-memory host.
- Capability, selection, graph, and coverage contracts.
- `AddPropertyCommand`, `EditPropertyCommand`, `DeletePropertyCommand`, and `RenamePropertyCommand`.
- `AddDefinitionCommand`, `RenameDefinitionCommand`, and `DeleteDefinitionCommand` for root and nested namespaces.
- `SetRootCommand` with namespace-aware preconditions.
- `AddRelationCommand`, `EditRelationCommand`, `RenameRelationCommand`, and `DeleteRelationCommand`.
- `SetRelationCardinalityCommand`, `SetRelationScopeCommand`, and `SetRelationQualifierCommand` typed mutation APIs.
- `SetIdentityCommand` and `RemoveIdentityCommand` with property existence, duplicate-order checks, and conservative source-ambiguous inbound relation protection.
- `SetImportCommand` and `DeleteImportCommand` for `$import` and `$importdefs` at normative namespace placements.
- Minimal source edits and returned inverse edits for byte-identical restoration.
- Property/relation and definition namespace collision checks.
- Rejection of stale versions, invalid documents, ambiguous duplicate-key paths, invalid namespace/definitions containers, missing root targets, and rename/delete operations that would leave root or external `$ref`/`$extends` references dangling, including percent-encoded active `$root` targets; malformed roots remain non-throwing.
- Rejection of dangling locally-decidable relation pointers (targettype, qualifiertype, scope), relation-target identity absences, and dual import-keyword collisions at one namespace.
- Exact source-key editing for escaped JSON key spellings.
- Typed normalized projections for Core declaration forms, `$extends`, relation fields (`targettype`, `cardinality`, `scope`, `qualifiertype`), strict `$import`/`$importdefs` absolute-URI provenance, Units keywords, Validation structures (including type-aware numeric-string handling), conditional composition operators, and all 20 semantic annotation keywords.
- Typed normalized Alternate Names projections for `altnames`, `altenums`, and `descriptions`, including sparse authored/effective inspection and exact emitted JSON previews.
- `SetAlternateNamesKeywordCommand` plus `SetAltNamesCommand`, `SetAltEnumsCommand`, and `SetLocalizedDescriptionsCommand` with canonical activation, schema-owned placement, value/language/enum mapping, duplicate, stale, incomplete, escaped-key, and inverse guarantees.
- `SetCompositionKeywordCommand` plus typed `SetAllOfCommand`, `SetAnyOfCommand`, `SetOneOfCommand`, and `SetNotCommand` wrappers with activation, placement, recursive schema, duplicate, stale, incomplete, and inverse guarantees.
- Atomic `SetConditionalCompositionCommand` authoring, replacement, and removal for every valid `if`/`then`/`else` branch-key set without transient invalid states.
- Conditional Composition inspection preserves sparse authored values, reports identical effective values because the companion defines no defaults, and emits exact JSON previews.
- Capability-aware structural traversal through active composition targets and branches for Core, Validation, Semantic Annotations, structure, and references; literal payload fields remain opaque and inactive branches are preserved as extension data.
- `SetValidationKeywordCommand` with a generic keyword/value map for every Validation keyword, including duplicate/stale/incomplete guards and post-edit cross-key validation.
- `SetUnitsKeywordCommand` plus `SetSymbolCommand`, `SetSymbolsCommand`, `SetUnitCommand`, `SetUcumUnitCommand`, and `SetCurrencyCommand` with capability, placement, value-shape, numeric-type, duplicate, stale, incomplete, and inverse guarantees.
- `SetSemanticAnnotationCommand` plus typed wrappers for all 20 Semantic Annotations keywords, with activation, placement, value-shape, sibling, local binding, concept consistency, rank/symmetry, duplicate, stale, incomplete, and inverse guarantees.
- Semantic inspection includes only successfully projected authored annotations, preserves authored values, exposes specification defaults only in effective values with authored/effective separation, emits exact JSON previews, and reports external semantic resolution as indeterminate and advisory.
- Units inspection preserves authored values and exposes `preferredComputationalUnit` only when `ucumUnit` is authored; the specification defines no default value for the five Units keywords.
- Host-neutral `CatalogRegistry`, provider manifest, request/result, suggestion, provenance, and structured provider-issue contracts for bundled, workspace, HTTPS, and host-contributed catalogs without registry-owned filesystem or network I/O.
- Strict provider envelope/entry validation before iteration, provider-local malformed/mismatched/late/throwing isolation, deterministic exact/prefix/substring ranking, custom-value precedence, canonical duplicate provenance aggregation, exact JSON emission, invocation-scoped cancellation, catalog-version checks, and mandatory exact request-ID/registry-generated-invocation-ID/document-version/kind/protocol-version correlation.
- Advisory bundled catalog data with 113 UCUM entries, 179 ISO 4217 entries, and exactly 73 Semantic Annotations entries across 19 stable semantic family IDs; catalog membership never constrains authored values.
- Validation projections distinguish authored `minContains` from its effective default of 1 when `contains` is present.
- Exact Core numeric value-space checks for integer syntax, signedness, fixed-width ranges, string-backed 64-bit and 128-bit integers, decimal syntax, and normative floating ranges.
- Ordered `identity` inspection and single-pass diagnostics for valid object and tuple schemas across root and nested schema traversal, excluding literal instance and annotation payloads.
- Explicit reference inventory including `$root`, `$ref`, `$extends`, normative `type: {"$ref":"#..."}` declarations, and branch-only direct composition references.
- Host-neutral `resolveReferences` and immutable `resolveDocumentReferences` APIs over explicit normalized-document/snapshot inputs, with no host callbacks or I/O.
- Effective local/imported namespace resolution for Core and Relations references, including explicit reusable-declaration classification, recursive import-chain prefixing, provenance, RFC 6901 escaping, URI-fragment decoding, tri-state outcomes, duplicate/stale input handling, imported collision attribution, and inheritance/import cycle detection.
- Recursive self and mutual type references remain resolved; cyclic `$extends` edges, including array members, are unresolved without rejecting unrelated inheritance edges.
- Resolver integration retains parser-owned local relation target and qualifier diagnostics without duplicating same-pointer errors, still records unresolved reference facts, and preserves external-only failures at their distinct pointers.
- Schema-owned reference traversal excludes `$ref`-shaped literal defaults, examples, and semantic payloads; diagnostics point to the exact reference value.
- Semantic annotation placement projection indexed by schema pointer for every detected placement.
- Relation diagnostics pinpoint unsupported member/value pointers directly.
- Semantic annotation projections validate activation, placement, normative scalar/object/array/union shapes, sibling dependencies and exclusions, direct member bindings, singleton temporal roles, concept consistency, positive Core temporal intervals, and local tensor/frame rank and symmetry constraints; cross-document meaning remains indeterminate.
- Diagnostics projection from parser diagnostics, including duplicate-pointer ambiguity diagnostics used by command precondition checks.
- Core document-root diagnostics for non-object roots, local `$root` pointer form and placement, and `$root` versus inline `type` exclusivity.
- Required root metadata diagnostics for missing or malformed `$schema`, `$id`, and `name` values.
- URI-fragment decoding for `$root` before structural placement and collection-scope checks, with decoded pointers stored in the normalized model.
- Core reusable declaration diagnostics for root-only `definitions`, nested namespace/declaration classification, malformed member/type shapes, and normative reusable type identifiers.
- Direct-reference schema diagnostics and typed-reference-only declaration classification; Relations reference objects remain separate.
- Core object-property diagnostics for required non-empty maps, object/tuple-only placement, property identifier grammar, schema-object values, and required valid `type` forms.
- Exact key-range navigation for declaration/property identifiers and every duplicate occurrence, including equivalent escaped JSON key spellings.
- Typed `SetRequiredCommand` support for simple required names and mutually exclusive alternative required sets.
- Typed collection member editing for array/set `items` and map `values`, including local reusable-type resolution.
- Atomic tuple `properties` and `tuple` order editing with direct byte-identical inverse edits.
- Description and binary annotation commands with Core placement and value-domain checks.
- Binary inspection distinguishes an explicitly authored `contentEncoding` from the effective Core default of `base64`.
- Local `type: {"$ref": ...}` editing, normalized reference inspection, and exact unresolved/invalid-placement diagnostics.
- Parser and property command validation accept normative union `$ref`, inline array, set, and map members while rejecting object, tuple, choice, and malformed inline collection members.
- Normalized inspection for required forms, collection members, tuple order, descriptions, and binary annotations.

## Validation

Last validation on 2026-08-31 (runnable Electron alpha):

- `npm test`: passed (14 files, 181 tests), including 11 coverage-gate regression tests and focused UI/Electron tests.
- `npm run typecheck`: passed.
- `npm run build`: passed (ESM, CJS, DTS).
- `npm run alpha:build`: passed (Vite renderer and Electron main/preload bundles).
- `npm run alpha:package`: passed on Windows (NSIS installer and portable executable).
- Packaged Windows executable launch smoke: remained responsive for 10 seconds.
- `npm run coverage:generate`: passed; regenerated the ledger, gaps, and Markdown from the checked-in inventory.
- `npm run coverage:check`: passed with 742 exact inventory records.
- `git diff --check`: passed.
- Scope check: passed; all changed paths are under `editor/`.

## Specification coverage

The coverage gate verifies exhaustive inventory integrity and completion-sensitive evidence; it does not claim feature completion.

- Partial: 742
- Gap: 0
- Pending: 0
- Unsupported: 0
- Complete: 0

Records by specification:

- Core: 156 partial.
- Alternate Names: 18 partial.
- Characteristics: 209 partial.
- Conditional Composition: 18 partial.
- Import: 23 partial.
- Relations: 35 partial.
- Semantic Annotations: 209 partial.
- Units: 27 partial.
- Validation: 47 partial.

Phase 0 ADRs:

- Accepted: 6
- Pending: 14

## Next work

Next steps for Phase 1:

1. Resolve or formally defer the interpretation questions in `coverage/generated/gaps.json` and link each resolution to an ADR or draft correction.
2. Replace profile-level partial evidence with record-specific complete, partial, gap, unsupported, or pending evidence as implementation and tests prove each dimension.
3. Define runtime instance-evaluation ownership and semantics for composition, relations, defaults, and semantic external checks.
4. Add the VS Code host and production cross-host contract suites before marking any host-parity facet complete.
5. Expand graphical authoring from the current property vertical slice across the remaining typed commands.

## Repository state

These changes are unstaged and uncommitted on `editor-autopilot`. Nothing was pushed.
