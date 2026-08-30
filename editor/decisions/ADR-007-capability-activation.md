# ADR-007: Capability activation
- Owner: language-service
- Status: accepted
- Decision: Validation activates directly for `https://json-structure.org/meta/validation/v0/#`, or for `https://json-structure.org/meta/extended/v0/#` when `$uses` contains `JSONSchemaValidation`.
- Rationale: Companion use declarations are meaningful only under the Extended meta-schema. Core, arbitrary, or missing `$schema` values do not activate Validation through `$uses`.
- Consequences: The parser and editing commands consume the same capability resolution. URI aliases are not accepted unless they are documented by a future specification decision.
