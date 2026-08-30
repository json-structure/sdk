# ADR-017: Pattern evaluation
- Owner: language-service
- Status: pending
- Rationale: Full-value ECMA-262 behavior needs bounded, cancellable evaluation.
- Consequences: Timeouts produce indeterminate diagnostics; fixture: `coverage/gaps.json`.
