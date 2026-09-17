# JSON Structure Editor Beta

This package contains the shared model and runnable Electron beta for the JSON
Structure editor. The host-neutral browser workbench provides Design, Graph,
and Source modes with an outline, contextual inline authoring, inspector,
problems view, semantic graph navigation, and source recovery. The Electron
host adds native Open, Save, Save As, command-line file opening, shortcuts, and
atomic writes through a narrow sandboxed preload bridge.

The same browser workbench is bundled into the VS Code custom editor. VS Code
owns document versions, workspace edits, undo/redo, dirty state, and saving;
the webview uses a versioned message boundary and imports no Electron APIs.
The prototype HTML files are behavioral evidence only.

The shared Libraries view uses the host-owned library runtime in Electron and
VS Code. It manages trusted HTTPS xRegistry providers with out-of-band
credentials, supports online and offline version resolution with trust and
provenance details, preserves the legacy static list/read fallback, and offers
previewed import, copy, materialize, and optimistic-epoch publish workflows.
Credential secrets are write-only and cleared from the rendered form after
submission; bundled providers cannot be removed or used as publish targets.

Import resolution is recursive and bounded to 16 levels, 128 documents, and
8 MiB aggregate content. Electron reads local files only beneath the opened
document directory; VS Code reads `file:` and `vscode-remote:` resources only
within the trusted workspace or opened document directory. Both hosts cap each
resource at 4 MiB and reject traversal and symlink escape. HTTP(S) imports are
shown as external but are not fetched by the beta hosts.

## Commands

```text
npm test                 # contract and coverage unit tests
npm run test:conversion-integration # live PostgreSQL, MySQL, SQL Server, and Kusto integration
npm run test:ux:coverage # mounted UX tests plus V8 statement/branch/function/line gates
npm run test:ux:real-host # packaged Electron UI, axe, responsive, RTL, and visual checks
npm run test:ux          # complete UX quality gate (requires the prepared runtime)
npm run test:ux:update-visuals # intentionally update Windows visual baselines
npm run typecheck        # strict TypeScript check
npm run build            # ESM/CJS package and declarations
npm run alpha:build      # renderer and Electron main/preload bundles
npm run alpha:run        # build and launch the Electron alpha
npm run alpha:dev        # Vite and Electron development mode
npm run alpha:package    # platform packages under release/
npm run beta:build       # Electron/browser and VS Code webview bundles
npm run beta:run         # build and launch the Electron beta
npm run beta:dev         # Vite and Electron development mode
npm run beta:package     # beta platform packages under release/
npm run coverage:check   # validate ledger and generated documentation
npm run coverage:generate
```

The live conversion integration suite uses Testcontainers and the prepared,
pinned Structurize runtime. Start Docker, run
`npm run prepare:structurize-runtime` with the required pinned runtime source
environment, then run `npm run test:conversion-integration`. The suite creates
temporary PostgreSQL, MySQL, SQL Server, and Kustainer instances; verifies
connection and selection parameters against real servers; checks worker
progress and terminal failure behavior; and removes all containers afterward.
The regular `npm test` run loads this suite in skipped mode and does not require
Docker.

## UX quality gate

`npm run test:ux:coverage` executes the mounted workbench, conversion, graph,
responsive, Electron bridge, and VS Code webview suites with V8 source
coverage. The enforced floor is 68% statements, 61% branches, 71% functions,
and 73% lines. Reports are written to `coverage/ux/`; these percentages are
source execution coverage and are separate from the specification evidence
ledger under `coverage/generated/`.

The same suite maintains an exhaustive contract for all 245 interactive
`data-*` control families emitted by the workbench. Each family receives its
own test case for stable identity, native keyboard operability, accessible
naming, and a wiring path. The expected count is fixed, so adding or removing
an interactive control requires an explicit test update instead of silently
changing the UX surface.

`npm run test:ux:real-host` packages and launches the actual Electron
application. It drives File > Import through the visible conversion UI, checks
that the generated Monaco editor is both visible and non-empty, runs WCAG A/AA
axe scans, verifies pane scrolling and graph pointer behavior, exercises
500x600 touch and right-to-left/text-expansion layouts, and compares six
Windows screenshot states against `tests/visual-baselines/win32-x64/`.
Linux and macOS runners execute the same structural, accessibility, responsive,
and internationalization assertions; pixel comparison is Windows-specific
because native font and window rendering differ by platform.

The shipped Electron application and VS Code webview both use Chromium.
Firefox, WebKit, iOS Safari, and Android browsers are not product runtime
targets, so the gate tests the supported Chromium hosts across Windows, Linux,
Intel macOS, and Apple Silicon macOS instead of presenting unsupported engines
as product coverage.

Automated accessibility checks do not reproduce screen-reader speech output.
Before a release candidate, complete this short manual pass:

1. In NVDA on Windows or VoiceOver on macOS, traverse the title bar, activity
   rail, type tree, Design controls, Problems panel, and status bar.
2. Open and close the import chooser, conversion dialog, command palette, and
   library dialog using only the keyboard; confirm focus remains trapped and
   returns to the invoking control.
3. Run one successful and one failing conversion; confirm progress, failure,
   and success announcements are spoken once and include useful context.
4. Switch among Design, Graph, Source, Validate, and Convert; confirm the
   selected mode and editor content are announced.

On Windows, `npm run beta:package` produces an NSIS installer and a portable
executable. macOS and Linux package targets are configured but must be built and
smoke-tested on their respective platforms.

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
The renderer bundles ten distinct offline providers: JSON Structure Units
recommendations (22 entries), UCUM (113), ISO 4217 (179), QUDT quantity kinds
(13), CF Standard Names (6), SOSA (7), Schema.org (9), Dublin Core Terms (8),
SKOS + PROV-O (7), and JSON Structure Semantic Presets (67). The semantic
providers emit complete reference objects. Concepts are additive, observed
properties remain singular, and closed JSON Structure value families do not
offer arbitrary custom values.

Under the Extended meta-schema, Units capabilities activate only through the
normative `JSONStructureUnits` value in `$uses`. `JSONSchemaUnits` is not treated
as an alias. The Validation meta-schema activates Units directly.
