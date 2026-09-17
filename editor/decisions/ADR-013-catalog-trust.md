# ADR-013: Catalog trust and cache
- Owner: catalogs
- Status: accepted
- Rationale: Provider trust, versions, offline state, and provenance must not close open vocabularies.
- Decision: Hosts retain all I/O. The host-neutral registry validates every result envelope and entry before iteration, isolates provider exceptions as structured issues, scopes cancellation to an opaque invocation token, and canonicalizes duplicate provider/value candidates and provenance before deterministic ranking.
- Consequences: Catalog metadata is sidecar state; malformed providers cannot suppress valid peers; caller request IDs may overlap safely; custom values remain unrestricted. Fixture: `fixtures/extension-units.json`.
