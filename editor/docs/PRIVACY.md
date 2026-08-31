# Privacy

The editor is private by default. It does not send telemetry or crash reports without explicit opt-in.

Allowed telemetry is limited to application version, Electron or VS Code host, operating-system family, event category, command category, coarse duration bucket, outcome, and stable error code. The telemetry contract rejects extra fields and values that resemble document content, JSON payloads, URIs, or local paths.

Crash reports contain product/runtime identity, a stable error code, process category, and sanitized module/function stack frames. They exclude document text, schema identifiers, names, URIs, paths, conversion data, registry data, environment variables, and credentials. Users can disable reporting at any time; disabling it does not reduce editor functionality.