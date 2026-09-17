# Release security

Report suspected vulnerabilities privately to the repository maintainers. Do not include credentials, private schemas, customer data, or exploit data in a public issue.

Every release must publish deterministic SHA-256/SHA-512 checksums, a CycloneDX SBOM derived from locked package metadata, and provenance identifying source digest, builder, platform, architecture, Node runtime, build tools, and artifact hashes. Published metadata must not contain absolute build paths.

The artifact scanner blocks credential-like material, absolute build paths, and executable files absent from the release allowlist. Update metadata requires a signature verified by an injected platform verifier before artifact hashes are trusted. Signing keys remain outside the repository and build artifacts.