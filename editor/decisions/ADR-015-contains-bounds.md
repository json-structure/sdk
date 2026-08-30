# ADR-015: Contains bounds
- Owner: language-service
- Status: pending
- Rationale: `minContains` and `maxContains` without `contains` require an explicit diagnostic policy.
- Consequences: The checker records the gap without claiming validity; fixture: `coverage/gaps.json`.
