# Original 81-item adversarial UX review

Status: archived for reference. This is the proposal set reviewed on 2026-09-07 before implementation. It is not approval to implement any item.

The implementation derived from this review was rolled back after live evaluation exposed severe usability regressions. In particular, proposals 12, 20, and 22 led to moving property editing into a focused inspector. That interaction model is rejected.

## Correctness and usability

1. Fix the critical narrow-layout width collapse at 320, 390, 500, and 620 px.
2. Reset stale mode, scroll, expansion, member, and graph context on document activation.
3. Resolve and feature `$root` as the primary definition.
4. Separate relation, reference, inheritance, and import graph totals.
5. Establish one versioned semantic descriptor for parser, UI, validation, and tests.
6. Correct misleading bundled presets and move invented templates to an untrusted examples source.
7. Treat semantic catalogs as suggestions rather than closed legal-value lists.
8. Generate one semantic applicability matrix for parsing, commands, Design, Analysis, and tests.
9. Add effective-member metadata for type, requiredness, unit, origin, aliases, and inheritance.

## Property, qualifier, and annotation presentation

10. Move Properties directly below the definition header.
11. Target compact desktop property rows.
12. Use compact, summary, and focused-editor layers.
13. Remove empty qualifier and annotation rows.
14. Show only authored qualifiers inline and cap long chip lists.
15. Separate defaults from authored values.
16. Replace blank qualifier forms with one add control.
17. Group facets by user intent.
18. Move Delete into an overflow menu.
19. Make property rows independently selectable.
20. Add a labelled Edit facets action.
21. Preserve authored summaries during editing.
22. Move expanded property editing into the right inspector or a mobile sheet.
23. Persist disclosure state by document URI, pointer, and section.
24. Collapse nested schemas into navigable summaries.
25. Merge tuple ordering into tuple rows.
26. Keep editable fields discoverable on touch.

## Document and definition comprehension

27. Add a Document Overview as the default landing view.
28. Show identity, root, counts, definitions, relationships, imports, semantics, rules, defaults, and issues.
29. Add a read-first definition overview.
30. Show effective members by default for comprehension.
31. Put descriptions and semantic meaning before authoring controls.
32. Move definition semantics directly below the header.
33. Render ordered identities in natural notation.
34. Render alternative required sets as readable clauses.
35. Generate natural-language composition summaries.
36. Summarize relationships near the header.
37. Explain inheritance contributions and conflicts.
38. Use one normalized origin model.
39. Make imported definitions readable in place.
40. Enrich and broaden search in the type tree.

## Semantic annotations and catalogs

41. Complete structured editing for all 20 top-level semantic keywords.
42. Add structured cards for every object and list annotation.
43. Generalize external-definition selection followed by local member binding.
44. Separate catalog identity from local bindings.
45. Resolve saved annotations back to catalog entries.
46. Replace generic configured-value labels with semantic summaries.
47. Give keywords and enum options friendly labels and definitions.
48. Explain semantic prerequisites and effects inline.
49. Link semantic fields to specification sections.
50. Correct the misleading Display unit label.
51. Enrich catalog metadata.
52. Preserve competing provider metadata.
53. Improve catalog search.
54. Expose paging and counts.
55. Add document and imported-type providers.
56. Expand authoritative providers where licensing permits.
57. Complete workspace, HTTPS, and host-provider workflows.
58. Distinguish separate trust dimensions.

## Remaining surfaces

59. Add a compact application menu.
60. Hide inactive pane splitters.
61. Remove duplicate filename chrome.
62. Hide an empty Problems strip and correct its label.
63. Make desktop side panes collapsible and reduce independent scrolling.
64. Add Analysis to navigation or merge it into Overview.
65. Simplify the mobile Graph toolbar.
66. Use a narrow-screen Graph selection sheet.
67. Add semantic meaning to graph nodes and details.
68. Simplify Graph empty states and cap automatic zoom.
69. Fix light-theme graph overlay contrast.
70. Add forced-colors styling.
71. Simplify Source chrome and enable narrow-screen wrapping.
72. Use a desktop split view for Validate.
73. Correct Validate action hierarchy.
74. Collapse successful validation traces.
75. Split import onboarding into Create new and Import existing.
76. Add search, categories, and recommendations to importer selection.
77. Add Back or Change format and content-sized import dialogs.
78. Make converter selection searchable and keep progress with configuration.
79. Group external conversion options by purpose.
80. Simplify Libraries hierarchy and separate provider management from imports.
81. Use stepped narrow-screen Libraries navigation with sticky actions.

## Rejected implementation interpretation

The following interpretation is explicitly rejected:

- A property is compact only because its real editor has moved elsewhere.
- A generic Edit facets button opens the primary editing experience.
- The right pane becomes a long property-editing form.
- Clicking a property name selects a remote editor instead of editing the name in place.

The replacement interaction contract is defined in the revised plan.
