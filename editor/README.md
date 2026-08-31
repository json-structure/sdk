# JSON Structure editor foundation

This package contains the Phase 1 shared model vertical slice on the Phase 0
contract foundation. It includes strict JSON parsing with source mapping,
recovery sessions, capability resolution, minimal `AddProperty` edits, and an
in-memory host with byte-identical undo.
The prototype HTML files at the package root are behavioral evidence only and
are not production dependencies.

## Commands

```text
npm test                 # contract and coverage unit tests
npm run typecheck        # strict TypeScript check
npm run build            # ESM/CJS package and declarations
npm run coverage:check   # validate ledger and generated documentation
npm run coverage:generate
```

The coverage gate permits explicit `partial`, `gap`, `unsupported`, and
`pending` statuses during the initial milestone. It rejects duplicate or
unowned records, malformed evidence, completed claims without five complete
evidence dimensions, aggregate family substitutes, fewer than five Core
records, and stale generated output. Every ledger record has individual
evidence for editing, inspection, diagnostics, roundtrip, and tests.

`src/contracts.ts` is the versioned serializable host boundary. `NodeId` is a
stable-in-session, non-serialized identity; JSON Pointers and source ranges are
the source-map identity. Serialization guarantees preserve unknown keys and
unrelated key ordering while applying minimal edits. `src/selection.ts` and
`src/graph.ts` define shared selection, projection, camera, hit precedence, and
gesture contracts.

## Units and catalogs

`SetSymbolCommand`, `SetSymbolsCommand`, `SetUnitCommand`,
`SetUcumUnitCommand`, and `SetCurrencyCommand` provide typed add, replace, and
remove operations with minimal edits and direct byte-identical inverses.
`SetUnitsKeywordCommand` is the generic typed form. Parser inspection exposes
the exact authored values and prefers an authored `ucumUnit` for computation;
the Units specification defines no implicit keyword values.

`CatalogRegistry` is a host-neutral merge and ranking layer. Hosts perform all
workspace and HTTPS I/O, then submit versioned `CatalogProviderResult` values.
Provider manifests describe bundled, workspace, HTTPS, or host-contributed
sources. Suggestions are advisory, accept custom open-vocabulary values,
preserve exact JSON emission, expose provenance, and are invalidated by
cancellation, request mismatch, document-version drift, or catalog changes.
Every provider result is validated before entries are read. Malformed envelopes,
malformed entries, and provider exceptions become structured `providerIssues`
without suppressing valid results from other providers. Cancellation is bound to
the opaque invocation in a `CatalogSearchRequest`, so overlapping reuse of a
caller request ID cannot cancel the wrong search. Duplicate provider/value pairs
and provenance are canonicalized before deterministic ranking.
The bundled advisory seeds contain 113 common UCUM entries and 179 ISO 4217
currency, fund, and special-purpose entries.

Under the Extended meta-schema, Units capabilities activate only through the
normative `JSONStructureUnits` value in `$uses`. `JSONSchemaUnits` is not treated
as an alias. The Validation meta-schema activates Units directly.
