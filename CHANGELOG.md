# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.2] - 2026-11-09

### Security

- Java: Update Jackson from 2.16.1 to 2.18.11 to address seven
  high-severity denial-of-service and polymorphic type validation advisories.
- TypeScript and VS Code: Refresh npm dependencies and override vulnerable
  transitive minimatch versions. Update the TypeScript build's esbuild dependency.
- .NET: Update System.Text.Json to 10.0.13.
- Perl CI: Require HTTPS-only CPAN mirrors to mitigate
  CVE-2024-45321 in cpanminus, and update Pod::Text to at least 6.1.1
  for CVE-2026-82560.
- R: Require jsonlite 1.8.8 or later for CVE-2023-33460.

### Changed

- Update .NET test tooling, Rust dependencies, Maven build and publishing
  plugins, the Maven wrapper, and GitHub Actions.
- Update VS Code extension build, test, packaging, and coverage tools. Use
  Node 22 for extension publishing. Raise the minimum VS Code version from
  1.110 to 1.140 and align API typings with that version.
- Upgrade TypeScript tooling to Vitest 5 and tsup 9 on Node 22/24. Preserve
  Node 20 SDK support with separate built-package CommonJS and ESM checks.
- Enforce TypeScript and extension lint checks, Rust formatting and
  all-target clippy, and a Go vulnerability audit using the latest Go 1.27 patch.
- Restrict automatic extension publishing to successful release-tag workflows.

### Fixed

- Go: Address staticcheck diagnostics for the golangci-lint action update.
- VS Code: Pin API typings to the declared minimum supported editor version.
- CLI: Install prebuilt binaries through the RPM spec's build root so packaging
  works with newer RPM versions, including cross-architecture packages.
- Rust: Reject circular chains of reference-only schema definitions.

### Known limitations

- CPAN::Audit reports CVE-2026-15534 in Perl 5.44.0, including the official
  current Perl container. The advisory lists no fixed release; dependency
  updates cannot repair the interpreter's regex engine.
- CPAN::Audit also reports CVE-2011-4116 in the container's File::Temp
  0.2312 and lists no fixed version.

## [0.6.2] - 2026-06-04

### Fixed

- Python, PHP: Union type validation success path no longer wipes previously
  accumulated sibling property errors ([#160](https://github.com/json-structure/sdk/issues/160)).

## [0.6.1] - 2026-04-02

### Fixed

- Rust CLI: Fix ellipsis in tag-release.ps1 string literal.

## [0.6.0] - 2026-03-28

- Initial tracked release.

[0.8.2]: https://github.com/json-structure/sdk/compare/v0.8.0...v0.8.2
[0.6.2]: https://github.com/json-structure/sdk/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/json-structure/sdk/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/json-structure/sdk/releases/tag/v0.6.0
