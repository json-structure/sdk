# JSON Structure Editor release guide

Install only packages published by the JSON Structure Editor release process. Before installation, compare the package SHA-256 or SHA-512 digest with `checksums.json` from the same release. A mismatch means the package must not be opened.

Core editing works offline after installation. Telemetry and crash reporting are disabled until a user explicitly enables them. Enabling telemetry sends only product version, host, platform, command category, coarse duration, outcome, and stable error codes. Documents, schema names, property names, paths, URIs, conversion input, and generated output are excluded.

Updates are accepted only when update metadata has a valid signature from a trusted release key and every downloaded artifact matches its declared size and hashes. Signature trust is supplied by the platform release integration; the editor does not create or self-approve signatures.
## Import and export conversions

Import chooses only a source file or external service and its options. Successful conversion opens a new unsaved JSON Structure document. No output destination is requested during import; Save uses Save As (or the normal VS Code untitled-document save flow) to choose the real destination. If replacing an Electron document with unsaved edits, the editor still asks for confirmation. A cancelled replacement leaves the previous document and save location unchanged.

Generated import content is staged in memory behind a host-issued output identity. Internal converter workspaces are temporary, use the shared cancellation-safe worker launcher in both hosts, are removed after their output is read, and never become the editor save path or the base directory for resolving imports. Stale or cancelled results cannot silently replace a newer document.

Export converts the current editor state, including unsaved edits, without asking for an input schema file. The current document URI is used only to resolve its import closure. Export still asks for an approved output destination and publishes generated files atomically. Conversion review distinguishes an unsaved import result from a durably published export.
