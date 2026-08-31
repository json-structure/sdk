# JSON Structure Editor release guide

Install only packages published by the JSON Structure Editor release process. Before installation, compare the package SHA-256 or SHA-512 digest with `checksums.json` from the same release. A mismatch means the package must not be opened.

Core editing works offline after installation. Telemetry and crash reporting are disabled until a user explicitly enables them. Enabling telemetry sends only product version, host, platform, command category, coarse duration, outcome, and stable error codes. Documents, schema names, property names, paths, URIs, conversion input, and generated output are excluded.

Updates are accepted only when update metadata has a valid signature from a trusted release key and every downloaded artifact matches its declared size and hashes. Signature trust is supplied by the platform release integration; the editor does not create or self-approve signatures.