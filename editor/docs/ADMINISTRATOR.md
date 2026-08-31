# Administrator deployment guide

Distribute the signed installer and its matching `checksums.json`, CycloneDX SBOM, and provenance statement together. Validate signatures with the operating-system trust tooling, then compare both SHA-256 and SHA-512 hashes before software distribution.

Telemetry and crash reporting are opt-in settings. Managed deployments should leave both disabled unless organizational policy explicitly permits content-free operational events. Network controls can block telemetry and crash endpoints without affecting offline editing.

Release policy requires target-OS builds on Windows, macOS, and Linux. Signing and notarization jobs run only when the corresponding CI secrets are present. An unsigned CI package is a test artifact, not a production release.