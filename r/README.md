# JSON Structure R SDK

R package for [JSON Structure](https://json-structure.org) schema and instance
validation. It bundles the JSON Structure **C engine** and compiles it from
source directly into the package: the heavy validation work runs in native code,
while the R layer provides an idiomatic API and a few extra extension-keyword
checks. Nothing is downloaded at install or run time.

## Features

- **Schema validation** — validate JSON Structure schema documents.
- **Instance validation** — validate JSON instances against schemas.
- **Fast** — the validation engine is the native C library.
- **Idiomatic R** — accepts JSON strings *or* R lists; returns tidy S3 result
  objects with `is_valid()`, `js_error_messages()` and `as.data.frame()`.
- **Cross-platform** — Linux, macOS and Windows.

## How the native engine is provided

The JSON Structure validation engine (portable C99) and its `cJSON` dependency
are **bundled in the package** and compiled from source when the package is
installed. Nothing is fetched from the network at install or run time, so
installs are reproducible and offline-friendly.

Building from source requires a C toolchain:

- **Linux / macOS** — the system C compiler (as for any package with
  compiled code).
- **Windows** — [Rtools](https://cran.r-project.org/bin/windows/Rtools/)
  matching your R version.

The package is pure C (no C++ runtime dependency). `pattern` constraints are
handled by a small embedded regular-expression matcher, so behaviour is
identical on every platform.
Supported platforms: Linux, macOS and Windows (x86_64 and arm64).

## Installation

Because the engine is compiled from bundled source, the package is
CRAN-policy-conformant. Install from GitHub:

```r
# install.packages("remotes")
remotes::install_github("json-structure/sdk", subdir = "r")
```

## Usage

### Schema validation

```r
library(jsonstructure)

result <- js_validate_schema('{"type": "string", "minLength": 1}')

if (is_valid(result)) {
  message("Schema is valid!")
} else {
  print(js_error_messages(result))
}

# R lists are serialised automatically:
js_validate_schema(list(type = "object",
                        properties = list(name = list(type = "string"))))
```

### Instance validation

```r
result <- js_validate_instance('"hello"', '{"type": "string"}')
is_valid(result)                      # TRUE

result <- js_validate_instance('123', '{"type": "string"}')
is_valid(result)                      # FALSE
as.data.frame(result)                 # code / severity / message / path / line ...
```

### Erroring variants

`js_validate_schema_strict()` and `js_validate_instance_strict()` raise a
condition of class `js_validation_error_condition` (whose `result` field carries
the full result) instead of returning an invalid result:

```r
tryCatch(
  js_validate_instance_strict('123', '{"type": "string"}'),
  js_validation_error_condition = function(e) {
    message(conditionMessage(e))
    is_valid(e$result)               # FALSE
  }
)
```

## API

| Function | Purpose |
|---|---|
| `js_validate_schema(schema)` | Validate a schema, returns `js_validation_result` |
| `js_validate_schema_strict(schema)` | As above, errors on failure |
| `js_validate_instance(instance, schema)` | Validate an instance |
| `js_validate_instance_strict(instance, schema)` | As above, errors on failure |
| `is_valid(result)` | `TRUE`/`FALSE` |
| `js_error_messages(result)` / `js_warning_messages(result)` | Messages by severity |
| `as.data.frame(result)` | Errors as a data frame |
| `jsonstructure_version()` | Installed package version |
| `jsonstructure_engine_version()` | Version of the bundled native engine |

## Development

The native engine sources are vendored under `src/` and compiled together with
the R bindings, so a normal `devtools` workflow builds everything. From the `r/`
directory:

```r
devtools::load_all()      # compiles the bundled engine + shim
devtools::test()          # runs testthat, including the shared test-assets corpus
```

`R CMD check`:

```bash
R CMD build r
R CMD check --as-cran jsonstructure_*.tar.gz
```

The shared `test-assets` conformance tests skip automatically when the corpus is
not present (e.g. when checking the built tarball outside the repo).

The vendored engine sources are kept in sync with `c/` by
`tools/vendor-engine.R` (see that script's header for how to refresh them).

## Limitations

- No schema **exporter** in v1 (the C engine has none), matching the Ruby SDK.
- `pattern` constraints are matched by an embedded ECMAScript-subset regular
  expression engine. It covers the constructs used by JSON Structure schemas
  (literals, `.`, anchors, character classes and shorthands, `\b`, greedy/lazy
  quantifiers, groups and alternation). Constructs outside that subset —
  lookbehind, named groups, inline flags such as `(?i)`, and Unicode property
  escapes `\p{...}` — are treated as invalid patterns, and backtracking is
  bounded to avoid pathological "ReDoS" inputs.

## License

MIT — see [LICENSE](LICENSE).
