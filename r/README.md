# JSON Structure R SDK

R package for [JSON Structure](https://json-structure.org) schema and instance
validation. It binds to the JSON Structure **C engine** through a small compiled
shim: the heavy validation work runs in native code, while the R layer provides
an idiomatic API and a few extra extension-keyword checks.

## Features

- **Schema validation** — validate JSON Structure schema documents.
- **Instance validation** — validate JSON instances against schemas.
- **Fast** — the validation engine is the native C library.
- **Idiomatic R** — accepts JSON strings *or* R lists; returns tidy S3 result
  objects with `is_valid()`, `js_error_messages()` and `as.data.frame()`.
- **Cross-platform** — Linux, macOS and Windows.

## How the native library is provided

The package ships only a thin compiled shim. On first use it downloads a
prebuilt `json_structure` shared library for your platform from the project's
GitHub Releases and caches it under `tools::R_user_dir("jsonstructure", "cache")`
— mirroring the Ruby SDK. No C toolchain is needed at *runtime* (a C compiler is
needed once to build the shim when the package is installed).

Supported platforms: Linux (x86_64, arm64), macOS (x86_64, arm64),
Windows (x86_64).

To use a locally built library and skip the download, set the
`JSONSTRUCTURE_LIB_PATH` environment variable to the full path of the shared
library (e.g. `c/build/libjson_structure.so`).

## Installation

The package is not on CRAN (the download-at-first-use model is incompatible with
CRAN policy). Install from GitHub:

```r
# install.packages("remotes")
remotes::install_github("json-structure/sdk", subdir = "r")
```

You can also pre-fetch the native library:

```r
jsonstructure::install_jsonstructure_binary()
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
| `install_jsonstructure_binary()` | Pre-fetch the native library |
| `jsonstructure_binary_path()` | Path to the resolved native library |
| `jsonstructure_version()` | Installed package version |

## Development

Build the C library once and point the package at it:

```bash
# from the repo root
cmake -S c -B c/build -DJS_BUILD_SHARED=ON
cmake --build c/build
export JSONSTRUCTURE_LIB_PATH="$PWD/c/build/libjson_structure.so"   # .dylib / .dll
```

Then, from the `r/` directory:

```r
devtools::load_all()
devtools::test()          # runs testthat, including the shared test-assets corpus
```

`R CMD check`:

```bash
R CMD build r
R CMD check jsonstructure_*.tar.gz
```

Tests that need the native library skip automatically when it is not available,
and the shared `test-assets` conformance tests skip when the corpus is not
present (e.g. when checking the built tarball outside the repo).

## Limitations

- No schema **exporter** in v1 (the C engine has none), matching the Ruby SDK.
- Regex/pattern constraints are only enforced if the prebuilt C library was
  built with regex support; the default build ships with it disabled, the same
  behaviour as the C and Ruby SDKs.

## License

MIT — see [LICENSE](LICENSE).
