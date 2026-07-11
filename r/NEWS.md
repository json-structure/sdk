# jsonstructure 0.1.0

* Initial release of the JSON Structure R SDK.
* Schema validation via `js_validate_schema()`.
* Instance validation via `js_validate_instance()`.
* Bindings to the JSON Structure C library through a small compiled shim that
  loads a prebuilt `json_structure` shared library downloaded from GitHub
  Releases on first use (mirroring the Ruby SDK). Set `JSONSTRUCTURE_LIB_PATH`
  to use a locally built library instead.
* Additional extension-keyword checks (units, relations, alternate identifier
  rules, `$extends`, enum value typing) performed in R, matching the Ruby SDK.
