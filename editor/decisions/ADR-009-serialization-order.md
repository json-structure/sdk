# ADR-009: Serialization ordering
- Owner: editor-model
- Status: accepted
- Rationale: Local edits must preserve unrelated keys and unknown content.
- Consequences: Minimal edit serialization and byte-stable undo are contract guarantees; fixture: `fixtures/core-valid.json`.
