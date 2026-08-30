# ADR-002: Root document forms
- Owner: language-service
- Status: accepted
- Decision: Follow Core normative language. Schema documents require absolute-URI `$schema` and `$id` metadata. `$root` is an optional local JSON Pointer URI fragment into `definitions`; implementations decode its URI fragment before structural placement checks, and the resolver owns target existence and ambiguity.
- Rationale: Core marks `$schema` and `$id` REQUIRED and constrains `$root` to a local reusable declaration. Equivalent percent-encoded fragment spellings identify the same JSON Pointer.
- Spec issue: Core examples near the `$schema` and reusable-root sections omit one or more required metadata members. Those examples contradict the normative REQUIRED language and must not weaken the editor grammar.
- Consequences: Definitions-only and type-only schema documents missing required metadata receive diagnostics. `NormalizedDocument.rootPointer` stores the decoded JSON Pointer while source text preserves the authored fragment spelling.
