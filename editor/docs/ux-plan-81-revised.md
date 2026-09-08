# Revised 81-item editor UX plan

Status: pending item-by-item user approval. No item in this document is approved merely because it is listed.

## Non-negotiable interaction contract

- Inactive values are compact and optimized for reading.
- Clicking or tabbing into a displayed value transforms that same value into its editor in place.
- Name, type, description, presence, qualifiers, annotations, and other facets use the same spatial model.
- The right pane provides context, navigation, provenance, and help. It is not the primary property editor.
- There is no generic Edit facets action.
- Expanded qualifiers and annotations remain directly below their property.
- Existing keyboard and direct-manipulation workflows remain available.
- Each approved item starts from a clean commit and ends in a verified commit before another item begins.

## Approval states

Use `Pending`, `Approved`, `Revise`, or `Rejected`. The initial state of every item is `Pending`.

## Correctness and state

1. **Pending — Narrow layouts:** retain usable workspace width at 320, 390, 500, and 620 px.
2. **Pending — Document reset:** reset mode, scroll, expansion, selection, and graph state when another document opens.
3. **Pending — Root selection:** select and feature the declared `$root` when a document opens.
4. **Pending — Graph counts:** separate relations, references, inheritance, and imports.
5. **Pending — Semantic source:** establish one versioned semantic descriptor for parser, commands, UI, validation, and tests.
6. **Pending — Preset accuracy:** correct inaccurate presets and label invented examples as examples.
7. **Pending — Open value spaces:** treat catalogs as suggestions, not legal-value boundaries.
8. **Pending — Applicability:** use one semantic applicability matrix across all layers.
9. **Pending — Effective metadata:** expose member type, origin, requiredness, unit, aliases, and inheritance.

## Property presentation

10. **Pending — Property placement:** place Properties directly below the definition header unless authored metadata requires precedence.
11. **Pending — Compact rows:** reduce inactive row height without hiding authored information.
12. **Pending — In-place activation:** clicking or tabbing into a displayed property value activates its editor in that location.
13. **Pending — Empty detail rows:** remove empty qualifier and annotation messages from collapsed properties.
14. **Pending — Authored summaries:** show restrained authored qualifier and annotation summaries below the main row.
15. **Pending — Origin distinction:** distinguish authored, inherited, and default values.
16. **Pending — Add control:** place a subtle add control inside the property detail area, not in a remote form.
17. **Pending — Facet grouping:** group expanded controls by Value, Range, Format, Presence, Semantics, Composition, and Advanced.
18. **Pending — Delete placement:** move Delete into an accessible overflow menu.
19. **Pending — Row selection:** allow row selection without automatically entering edit mode.
20. **Pending — Field activation:** remove Edit facets; activate the specific name, type, description, or value that receives focus.
21. **Pending — Context preservation:** retain surrounding property context while one field is edited.
22. **Pending — Central editing:** keep primary property editing in the central canvas; keep the right pane informational.
23. **Pending — Disclosure persistence:** persist deliberate disclosure state without carrying it into another document.
24. **Pending — Nested summaries:** summarize nested schemas while retaining direct navigation.
25. **Pending — Tuple ordering:** integrate tuple ordering into tuple rows.
26. **Pending — Touch affordances:** keep editable values discoverable without hover.

## Inline editing behavior

27. **Pending — Name editor:** transform the displayed property name into an input on click, Enter, or keyboard focus.
28. **Pending — Type editor:** transform the displayed type into the existing type selector in place.
29. **Pending — Description editor:** transform the displayed description into an inline or locally expanding text editor.
30. **Pending — Required sets:** edit requiredness and alternative-required membership beside the property.
31. **Pending — Presence:** keep nullable and presence controls directly associated with the property.
32. **Pending — Scalar constraints:** edit scalar constraints inside the expanded property detail row.
33. **Pending — Semantic controls:** edit semantic annotations inside that same detail row.
34. **Pending — Composition:** attach composition controls to the property or nested schema they affect.
35. **Pending — Commit and cancel:** Enter commits appropriate single-line edits; Escape restores the previous value.
36. **Pending — Tab order:** Tab commits and advances in reading order.
37. **Pending — Vertical movement:** ArrowDown retains same-column movement between property rows.
38. **Pending — Last-field creation:** Tab from the last description retains collision-free property creation.
39. **Pending — Focus locality:** keyboard editing never transfers focus to the right pane.
40. **Pending — Local errors:** show validation errors adjacent to their field.

## Document and definition comprehension

41. **Pending — Optional overview:** add an optional Document Overview for populated documents without displacing Design editing.
42. **Pending — Empty documents:** retain the existing first-type creator for new and empty documents.
43. **Pending — Document identity:** show purpose, `$id`, profile, validity, and root.
44. **Pending — Definition counts:** show local, imported, and effective counts.
45. **Pending — Root-first list:** list primary definitions with the root first.
46. **Pending — Relationship kinds:** separate relation, reference, inheritance, and import summaries.
47. **Pending — Document summary:** summarize imports, provenance, semantics, defaults, and unresolved issues.
48. **Pending — Definition synopsis:** add a concise read-first definition synopsis.
49. **Pending — Effective members:** show effective members while marking the locally editable subset.
50. **Pending — Meaning first:** place descriptions and semantic meaning before secondary controls.
51. **Pending — Long descriptions:** clamp long descriptions with explicit local expansion.
52. **Pending — Identity notation:** show ordered identities such as `tenantId -> employeeNumber`.
53. **Pending — Required clauses:** render alternative required sets as readable clauses.
54. **Pending — Composition summaries:** generate concise natural-language summaries.
55. **Pending — Relationship summary:** summarize declared relationships near the definition header.
56. **Pending — Inheritance explanation:** explain contributed members, precedence, conflicts, and source.
57. **Pending — Origin vocabulary:** use authored, inherited, profile default, normative default, and runtime default consistently.
58. **Pending — Imported definitions:** make imported definitions readable in place while keeping them read-only.
59. **Pending — Definition tree:** add kind, root/imported/abstract state, purpose, and member count.
60. **Pending — Definition search:** search names, descriptions, properties, concepts, relations, and units.

## Semantic annotations and catalogs

61. **Pending — Structured annotations:** provide structured inline editors for every supported semantic family.
62. **Pending — Annotation locality:** keep each semantic editor attached to its property or definition.
63. **Pending — Identity and bindings:** separate external catalog identity from local member bindings.
64. **Pending — Reload resolution:** resolve saved values back to matching catalog entries.
65. **Pending — Semantic summaries:** replace generic configured-value labels with meaningful summaries.
66. **Pending — Friendly terminology:** show friendly labels and definitions with exact identifiers as secondary text.
67. **Pending — Prerequisites:** explain requirements and effects beside the relevant control.
68. **Pending — Specification links:** link semantic help to the exact specification section.
69. **Pending — Unit terminology:** replace Display unit with language covering interpretation and conversion.
70. **Pending — Catalog metadata:** support identifiers, definitions, revisions, domain/range, deprecation, replacements, structure, licensing, and review status.
71. **Pending — Provider provenance:** preserve competing labels, aliases, descriptions, and provenance.
72. **Pending — Catalog search:** index descriptions, aliases, humanized tokens, authority, kind, and domain.
73. **Pending — Catalog paging:** expose counts, pages, and continuation state.
74. **Pending — Local providers:** add document-local and imported-definition sources.
75. **Pending — Authority providers:** add only sources with verified mapping, license, and version.
76. **Pending — Host providers:** complete workspace, HTTPS, and host workflows before exposing controls.
77. **Pending — Trust model:** represent trust as separate verifiable dimensions.

## Remaining workspaces and chrome

78. **Pending — Shell density:** reduce chrome without removing command, navigation, or document-identity access.
79. **Pending — Responsive workspaces:** adapt Graph, Source, Validate, Convert, and Libraries through progressive disclosure.
80. **Pending — Action hierarchy:** simplify actions and empty states without moving core editing out of context.
81. **Pending — UX proof:** add comprehension, keyboard, responsive, accessibility, visual, and packaged-host tests, including explicit proof that property editing remains in place.
