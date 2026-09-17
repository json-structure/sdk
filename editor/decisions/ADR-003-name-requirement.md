# ADR-003: Declaration names
- Owner: editor-model
- Status: accepted
- Decision: Follow the declaration milestone policy and require a root `name` matching the Core type-name identifier grammar.
- Rationale: The schema document represents a named root declaration, and the implementation must follow normative requirements rather than examples that omit the member.
- Spec issue: Core wording and examples are contradictory about root `name`: several schema-document and `$root` examples omit it, while named compound declarations require it. This requires clarification in the specification.
- Consequences: The editor diagnoses a missing or malformed root `name`; it preserves authored absence and never infers a name.
