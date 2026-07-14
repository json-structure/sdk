# jsonstructure 0.1.0

## Native engine compiled from bundled source (CRAN-conformant)

The JSON Structure C validation engine and its `cJSON` dependency are now
**bundled in the package and compiled from source at install time**. Nothing is
downloaded at install or run time, so the package installs from source on any
platform with a C toolchain and is conformant with CRAN policy. The package is
pure C, with no C++ runtime dependency.

This replaces the earlier prototype, which loaded a prebuilt `json_structure`
shared library downloaded from GitHub Releases on first use.

### Breaking changes

* Removed `install_jsonstructure_binary()` and `jsonstructure_binary_path()` —
  there is no longer a separate native library to download or locate.
* Removed the `JSONSTRUCTURE_LIB_PATH` environment-variable override.
* Renamed `jsonstructure_binary_version()` to `jsonstructure_engine_version()`,
  which reports the version of the bundled engine.

### Features

* Schema validation via `js_validate_schema()` / `js_validate_schema_strict()`.
* Instance validation via `js_validate_instance()` /
  `js_validate_instance_strict()`.
* Tidy S3 results with `is_valid()`, `js_error_messages()`,
  `js_warning_messages()` and `as.data.frame()`.
* Additional extension-keyword checks (units, relations, alternate identifier
  rules, `$extends`, enum value typing) performed in R, matching the Ruby SDK.

### Notes

* `pattern` constraints are matched by a small embedded ECMAScript-subset
  regular-expression engine (pure C), giving identical behaviour on every
  platform with no C++/`std::regex` dependency. Constructs outside the subset
  (lookbehind, named groups, inline flags, Unicode property escapes) are treated
  as invalid patterns, and backtracking is bounded against pathological inputs.
