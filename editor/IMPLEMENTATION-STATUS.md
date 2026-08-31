# JSON Structure Editor Implementation Status

Updated: 2026-08-31 (Phase 1 milestone: Units companion authoring and host-neutral catalogs)
Branch: `editor-autopilot`
Worktree: `C:\git\json-structure-sdk-editor`

Blocking findings in this milestone: none. The Units/catalog review findings are repaired. Full RFC 5646 validation, full UCUM grammar/dimensional equivalence, and the draft's broad `currency` placement wording remain explicit follow-up items. ADR-014 (`has` schema shape) remains unresolved from the prior milestone.

Milestone summary: `symbol`, `symbols`, `unit`, `ucumUnit`, and `currency` now have typed add/replace/remove commands, schema-owned diagnostics, normalized authored inspection, capability activation, duplicate/stale/incomplete guards, and direct byte-identical inverse edits. Units activates directly through the Validation meta-schema or through normative `JSONStructureUnits` in `$uses` only under the Extended meta-schema; `JSONSchemaUnits` is not an alias. `unit` and `ucumUnit` require one resolved numeric underlying type; unresolved external types remain indeterminate. Known incompatible `unit`/`ucumUnit` pairs produce warnings without deleting either value. The host-neutral catalog registry validates result envelopes and entries before iteration, requires exact request-ID, registry-generated invocation-ID, document-version, kind, and protocol-version correlation, isolates malformed, mismatched, late, and throwing providers as structured issues, binds cancellation to invocation tokens, and canonicalizes duplicates and provenance before deterministic ranking independent of provider order or timing. Suggestions remain advisory and open-vocabulary and preserve exact emitted JSON. Bundled seeds contain 113 common UCUM entries and 179 ISO 4217 currency/fund/special-purpose entries.

Review root cause and repair: capability activation used a non-normative Units token; catalog results were trusted before entry iteration; provider correlation fields were optional and a mismatch discarded every provider result; cancellation state was keyed only by caller request ID; duplicate selection depended on provider entry arrival order; and provider results did not carry or validate the registry-generated invocation ID, allowing a late result to cross into a newer invocation that reused every caller-controlled correlation value. The repair uses the normative token, validates complete provider result and custom-entry shapes, passes and requires exact invocation correlation on every provider request/result, reports provider-local issues without suppressing valid peer results, scopes cancellation to generated invocation IDs, and canonicalizes same-provider candidates before ranking and provenance aggregation. The crossover regression uses identical request ID, document version, catalog version, kind, and protocol version and verifies that the older invocation is rejected. Request and result envelopes remain JSON-round-trip serializable; no host I/O dependency or closed-vocabulary constraint was introduced.

## Current milestone

Phase 1 shared-model foundation is in progress. The bounded Core typed-member command and inspection milestone remains partial pending broader Core placement and editing coverage.

Implemented:

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
- `SetValidationKeywordCommand` with a generic keyword/value map for every Validation keyword, including duplicate/stale/incomplete guards and post-edit cross-key validation.
- `SetUnitsKeywordCommand` plus `SetSymbolCommand`, `SetSymbolsCommand`, `SetUnitCommand`, `SetUcumUnitCommand`, and `SetCurrencyCommand` with capability, placement, value-shape, numeric-type, duplicate, stale, incomplete, and inverse guarantees.
- Units inspection preserves authored values and exposes `preferredComputationalUnit` only when `ucumUnit` is authored; the specification defines no default value for the five Units keywords.
- Host-neutral `CatalogRegistry`, provider manifest, request/result, suggestion, provenance, and structured provider-issue contracts for bundled, workspace, HTTPS, and host-contributed catalogs without registry-owned filesystem or network I/O.
- Strict provider envelope/entry validation before iteration, provider-local malformed/mismatched/late/throwing isolation, deterministic exact/prefix/substring ranking, custom-value precedence, canonical duplicate provenance aggregation, exact JSON emission, invocation-scoped cancellation, catalog-version checks, and mandatory exact request-ID/registry-generated-invocation-ID/document-version/kind/protocol-version correlation.
- Advisory bundled catalog data with 113 UCUM entries and 179 ISO 4217 entries; catalog membership never constrains authored values.
- Validation projections distinguish authored `minContains` from its effective default of 1 when `contains` is present.
- Exact Core numeric value-space checks for integer syntax, signedness, fixed-width ranges, string-backed 64-bit and 128-bit integers, decimal syntax, and normative floating ranges.
- Ordered `identity` inspection and single-pass diagnostics for valid object and tuple schemas across root and nested schema traversal, excluding literal instance and annotation payloads.
- Explicit reference inventory including `$root`, `$ref`, `$extends`, and normative `type: {"$ref":"#..."}` declarations.
- Host-neutral `resolveReferences` and immutable `resolveDocumentReferences` APIs over explicit normalized-document/snapshot inputs, with no host callbacks or I/O.
- Effective local/imported namespace resolution for Core and Relations references, including explicit reusable-declaration classification, recursive import-chain prefixing, provenance, RFC 6901 escaping, URI-fragment decoding, tri-state outcomes, duplicate/stale input handling, imported collision attribution, and inheritance/import cycle detection.
- Recursive self and mutual type references remain resolved; cyclic `$extends` edges, including array members, are unresolved without rejecting unrelated inheritance edges.
- Resolver integration retains parser-owned local relation target and qualifier diagnostics without duplicating same-pointer errors, still records unresolved reference facts, and preserves external-only failures at their distinct pointers.
- Schema-owned reference traversal excludes `$ref`-shaped literal defaults, examples, and semantic payloads; diagnostics point to the exact reference value.
- Semantic annotation placement projection indexed by schema pointer for every detected placement.
- Relation diagnostics pinpoint unsupported member/value pointers directly.
- Semantic annotation projections validate normative scalar, object, array, and union shapes, plus local tensor/frame rank and symmetry constraints; cross-document and deep semantic consistency checks remain partial.
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

Last validation on 2026-08-31 (Units companion authoring and host-neutral catalogs):

- `npm test`: passed (7 files, 125 tests).
- `npm run typecheck`: passed.
- `npm run build`: passed (ESM, CJS, DTS).
- `npm run coverage:generate`: passed; coverage statuses remain partial where editing or round-trip coverage is incomplete.
- `npm run coverage:check`: passed with 87 feature records.
- `git diff --check`: passed.

## Specification coverage

The coverage gate verifies ledger integrity and explicit ownership; it does not claim feature completion.

- Partial: 83
- Gap: 0
- Pending: 0
- Unsupported: 3
- Complete: 1

Phase 0 ADRs:

- Accepted: 6
- Pending: 14

## Next work

Next steps for Phase 1:

1. Replace the bounded common-form RFC 5646 and UCUM validators with dedicated complete engines before claiming full diagnostics coverage.
2. Resolve whether `currency` is intentionally permitted on non-numeric schemas: the normative bullet says any schema element, while the section introduction describes numeric schemas.
3. Decide whether arbitrary `unit` and `ucumUnit` compatibility is editor-owned or delegated to a selected catalog/provider; the current implementation only warns for known built-in pairs.
4. Decide whether imported declarations that reference `#` through `$importdefs` are invalid by specification or require a distinct root binding; the resolver currently reports them unresolved because `$importdefs` imports definitions only.
5. Keep Phase 2 UI work blocked until the remaining Phase 1 command slices pass review.

## Repository state

These repairs are unstaged and uncommitted on `editor-autopilot`. Nothing was pushed.
