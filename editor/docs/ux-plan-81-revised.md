# Evidence-based editor UX plan

Status: planning only. No implementation item is approved unless the user explicitly approves that numbered item.

This document replaces the undifferentiated 81-item proposal list with the evidence classifications in `ux-plan-81-evidence-audit.html`. The original numbering remains stable for traceability to `ux-adversarial-review-81-original.md`.

## Non-negotiable interaction contract

- Inactive property values are compact and optimized for reading.
- Clicking, pressing Enter on, or tabbing into a displayed value transforms that same value into its editor in place.
- Name, type, description, presence, qualifiers, annotations, and other facets remain in the central property canvas.
- The right Inspector provides context, provenance, navigation, and help. It is not the primary property editor.
- There is no generic Edit facets action.
- Expanded qualifiers, annotations, validation, composition, and semantic controls remain directly below their property.
- Existing keyboard and direct-manipulation workflows remain available.
- Approval is item-specific. Approval of a batch presentation does not approve every item in the batch.
- Each approved implementation item or explicitly approved cohesive batch starts from a clean commit and ends in a verified commit.

## Evidence result

| Classification | Count | Disposition |
|---|---:|---|
| Reproduced visual change | 41 | Requires a real Before capture, a clean standalone proposed After, and explicit approval before implementation. |
| Already satisfied | 23 | Removed from implementation scope. Existing behavior is retained and protected by tests where practical. |
| Nonvisual requirement | 15 | Requires test or architecture evidence, not a visual mockup. |
| Not reproduced | 2 | No change proposed until a failing fixture or reproduction exists. |

The counts cover all 81 original items: 41 + 23 + 15 + 2.

## Approval queue: reproduced visual changes

Every item below is `Pending`.

### Batch 1 — Property-row read and edit states

| Item | Proposal | Smallest change under review | Evidence |
|---:|---|---|---|
| 11 | Compact rows | Render inactive values as compact text in the existing property grid while retaining a restrained description summary. | `before-design-invoice-root-1440x1000.png` |
| 12 | In-place activation | Replace only the activated displayed value with its existing editor in the same cell. | `before-property-name-focus-1440x1000.png` |
| 14 | Authored summaries | Show a restrained collapsed summary such as `unit m · symbol d` directly below the property row. | `before-units-expanded-1440x1000.png` |
| 18 | Delete placement | Replace the prominent row delete button with an accessible overflow menu containing Delete property. | `before-design-invoice-root-1440x1000.png` |
| 19 | Row selection | Add a neutral selected-row state that does not enter field edit mode. | `before-property-name-focus-1440x1000.png` |

Review artifact: `ux-plan-81-approval-batch-01.html`.

### Remaining property presentation and inline editing

| Item | Proposal | Smallest change under review |
|---:|---|---|
| 9 | Effective metadata | Add unit, alias, and default-origin metadata to Effective rows or adjacent read-only details. |
| 15 | Origin distinction | Extend origin badges to authored, inherited, profile default, normative default, and runtime default. |
| 17 | Facet grouping | Reorganize inline detail blocks into Value, Range, Format, Presence, Semantics, Composition, and Advanced. |
| 24 | Nested summaries | Show a nested schema summary such as `tuple · 3 members` with direct navigation. |
| 25 | Tuple ordering | Put the tuple index and reorder affordance on each nested tuple row. |
| 27 | Name editor | Define and prove the displayed-name-to-input activation behavior for click, Enter, and keyboard focus. |
| 30 | Required sets | Replace ambiguous Presence cells with readable alternative-clause controls beside affected properties. |

### Document and definition comprehension

| Item | Proposal | Smallest change under review |
|---:|---|---|
| 41 | Optional overview | Add an optional Overview mode while leaving Design selected by default. |
| 43 | Document identity | Add one compact read-only summary of purpose, `$id`, profile, validity, and root. |
| 44 | Definition counts | Show separate local, imported, and effective definition counts. |
| 47 | Document summary | Add one read-only summary of imports, provenance, semantics, defaults, and unresolved issues. |
| 50 | Meaning first | Put the authored description and concise semantic meaning immediately below definition identity. |
| 53 | Required clauses | Render nested required sets as readable clauses beside affected properties. |
| 54 | Composition summaries | Add a concise generated composition summary next to tuple or composed properties. |
| 55 | Relationship summary | Show outgoing and incoming relation/reference summaries beneath definition identity. |
| 56 | Inheritance explanation | Explain contributed members, precedence, conflicts, and source beside Effective or Extends. |
| 57 | Origin vocabulary | Use authored, inherited, profile default, normative default, and runtime default consistently. |
| 58 | Imported definitions | Add a read-only imported group to the existing tree and canvas with provenance. |
| 59 | Definition tree | Add compact kind, root/imported/abstract state, purpose, and member count metadata to tree rows. |
| 60 | Definition search | Extend the existing filter index to names, descriptions, properties, concepts, relations, and units. |

### Graph and relationship comprehension

| Item | Proposal | Smallest change under review |
|---:|---|---|
| 4 | Graph counts | Replace the aggregate link total with relations, references, inheritance, and imports counts. |
| 46 | Relationship kinds | Add the same four-kind breakdown to the existing graph summary. |

Items 4 and 46 overlap visually but remain separate approval decisions: item 4 concerns the count control; item 46 concerns the explanatory summary.

### Semantic annotations and catalogs

| Item | Proposal | Smallest change under review |
|---:|---|---|
| 61 | Structured annotations | Replace generic complex-family controls with labeled subfields inside the existing Annotations block. |
| 63 | Identity and bindings | Label external catalog identity separately from local member bindings. |
| 65 | Semantic summaries | Generate a concise property summary from existing semantic values. |
| 67 | Prerequisites | Put prerequisite and downstream-effect help under only the controls that require it. |
| 68 | Specification links | Add an exact specification-section link to the existing result or detail area. |
| 69 | Unit terminology | Replace Display unit with terminology covering interpretation and preferred presentation/conversion. |
| 70 | Catalog metadata | Extend the existing detail pane with identifiers, definitions, revisions, domain/range, deprecation, replacements, structure, licensing, and review status. |
| 71 | Provider provenance | Attribute alternate labels, aliases, and descriptions to their providers. |
| 73 | Catalog paging | Add result range, page controls, and continuation status to the existing toolbar. |
| 74 | Local providers | Add Document local and Imported definitions to the existing provider list. |
| 77 | Trust model | Replace the single trusted label with separate mapping, license, version, connectivity, and review dimensions. |

### Remaining workspaces and chrome

| Item | Proposal | Smallest change under review |
|---:|---|---|
| 78 | Shell density | Consolidate duplicate title/status affordances and reduce fixed chrome height without removing entry points. |
| 79 | Responsive workspaces | Give each mobile workspace the full content width and move secondary controls into on-demand sheets or drawers. |
| 80 | Action hierarchy | Keep the selected conversion outcome and primary action prominent; collapse secondary formats and actions. |

## Test and architecture backlog: nonvisual requirements

These items do not receive visual After proposals. They remain `Pending` until their evidence and implementation contracts are reviewed.

| Item | Requirement | Required proof before implementation |
|---:|---|---|
| 2 | Document reset | Automated two-document lifecycle test covering mode, scroll, disclosure, selection, graph camera, and lens state. |
| 5 | Semantic source | Named versioned descriptor plus contract tests proving parser, commands, UI, validation, and tests load it. |
| 6 | Preset accuracy | Preset inventory mapped to normative sources, with examples labeled as examples. |
| 8 | Applicability | One versioned applicability matrix plus cross-layer conformance tests. |
| 23 | Disclosure persistence | Lifecycle tests proving deliberate disclosure persists only within the correct document. |
| 35 | Commit and cancel | Keyboard tests for Enter commit and Escape restoration by field type. |
| 36 | Tab order | Keyboard tests proving commit-and-advance follows reading order. |
| 37 | Vertical movement | Keyboard tests proving ArrowDown retains the same property column. |
| 38 | Last-field creation | Keyboard test proving final-description Tab creates exactly one collision-free property. |
| 39 | Focus locality | Focus trace proving central editing never moves focus to the Inspector. |
| 64 | Reload resolution | Save/reload tests proving exact values resolve back to matching catalog entries. |
| 72 | Catalog search | Search-index contract tests covering descriptions, aliases, humanized tokens, authority, kind, and domain. |
| 75 | Authority providers | Mapping, licensing, and version evidence for every proposed authority source. |
| 76 | Host providers | Completed workspace, HTTPS, and host lifecycle tests before controls are exposed. |
| 81 | UX proof | Comprehension, keyboard, responsive, accessibility, visual, and packaged-host gates, including direct proof of in-place property editing. |

## Removed from implementation scope: already satisfied

The current editor already satisfies these 23 items. A future proposal must first provide new contradictory evidence.

`1 Narrow layouts` · `3 Root selection` · `7 Open value spaces` · `10 Property placement` · `13 Empty detail rows` · `16 Add control` · `20 Field activation` · `21 Context preservation` · `22 Central editing` · `26 Touch affordances` · `28 Type editor` · `29 Description editor` · `31 Presence` · `32 Scalar constraints` · `33 Semantic controls` · `34 Composition` · `40 Local errors` · `42 Empty documents` · `45 Root-first list` · `48 Definition synopsis` · `49 Effective members` · `62 Annotation locality` · `66 Friendly terminology`

## Investigation queue: no reproduced failure

| Item | Requirement | Missing evidence |
|---:|---|---|
| 51 | Long descriptions | A fixture whose authored description demonstrably harms scanning or layout in the current editor. |
| 52 | Identity notation | A fixture with a multi-field ordered identity and a capture showing the current notation. |

No visual or implementation proposal will be produced for items 51 or 52 until that evidence exists.

## Approval record

Record decisions here only after explicit user responses.

| Item | Decision | Date | Notes |
|---:|---|---|---|
| — | No decisions yet | — | All 41 reproduced visual items and all 15 nonvisual items remain Pending. |
