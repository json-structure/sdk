# jsonstructure 0.1.0

* Initial release of the JSON Structure R SDK.
* Schema validation via `js_validate_schema()`.
* Instance validation via `js_validate_instance()`.
* Bindings to the JSON Structure C library through a small compiled shim that
  loads a prebuilt `json_structure` shared library. The library is never
  downloaded implicitly: point `JSONSTRUCTURE_LIB_PATH` at a local build, or run
  `install_jsonstructure_binary()` (or consent to the one-time interactive
  prompt) to fetch it from GitHub Releases. Downloads are checksum-verified when
  an expected SHA-256 is supplied via `sha256=`, `JSONSTRUCTURE_BINARY_SHA256`,
  or a shipped `checksums.dcf` manifest.
* Additional extension-keyword checks (units, relations, alternate identifier
  rules, `$extends`, enum value typing) performed in R, matching the Ruby SDK.
