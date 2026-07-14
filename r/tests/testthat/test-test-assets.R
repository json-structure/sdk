# Mirrors ruby/spec/test_assets_spec.rb. Runs the shared test-assets corpus so
# the R SDK stays consistent with the other SDKs. Requires the binary and the
# test-assets directory (present when tests run inside the repo, absent from the
# built package tarball -> tests skip gracefully).

find_test_assets <- function() {
  env <- Sys.getenv("JSONSTRUCTURE_TEST_ASSETS", unset = "")
  if (nzchar(env) && dir.exists(env)) {
    return(env)
  }
  starts <- unique(Filter(nzchar, c(
    tryCatch(testthat::test_path(), error = function(e) ""),
    getwd()
  )))
  for (start in starts) {
    dir <- normalizePath(start, winslash = "/", mustWork = FALSE)
    for (i in seq_len(7)) {
      cand <- file.path(dir, "test-assets")
      if (dir.exists(file.path(cand, "schemas"))) {
        return(cand)
      }
      parent <- dirname(dir)
      if (identical(parent, dir)) break
      dir <- parent
    }
  }
  NULL
}

# Strip test metadata / unwrap the "value" field, mirroring the Ruby helper.
extract_instance_value <- function(instance_json) {
  instance <- jsonlite::fromJSON(instance_json, simplifyVector = FALSE)
  if (is.list(instance) && "value" %in% names(instance)) {
    value <- instance[["value"]]
    if (is.null(value)) return("null")
    return(as.character(jsonlite::toJSON(value, auto_unbox = TRUE,
                                         null = "null", na = "null", digits = NA)))
  }
  for (key in c("_description", "_expectedError", "_comment")) {
    instance[[key]] <- NULL
  }
  as.character(jsonlite::toJSON(instance, auto_unbox = TRUE,
                                null = "null", na = "null", digits = NA))
}

test_that("all invalid schemas are rejected", {
  skip_if_no_binding()
  assets <- find_test_assets()
  skip_if(is.null(assets), "test-assets directory not found")
  dir <- file.path(assets, "schemas", "invalid")
  skip_if_not(dir.exists(dir), "invalid schemas directory not found")

  files <- Sys.glob(file.path(dir, "*.struct.json"))
  skip_if(length(files) == 0, "no invalid schema files found")

  failed <- character(0)
  for (file in files) {
    content <- paste(readLines(file, warn = FALSE), collapse = "\n")
    if (is_valid(js_validate_schema(content))) {
      failed <- c(failed, basename(file))
    }
  }
  expect_true(
    length(failed) == 0,
    info = paste("Expected these schemas to be invalid but they were valid:",
                 paste(failed, collapse = ", "))
  )
})

test_that("all validation-extension schemas are accepted", {
  skip_if_no_binding()
  assets <- find_test_assets()
  skip_if(is.null(assets), "test-assets directory not found")
  dir <- file.path(assets, "schemas", "validation")
  skip_if_not(dir.exists(dir), "validation schemas directory not found")

  files <- Sys.glob(file.path(dir, "*.struct.json"))
  skip_if(length(files) == 0, "no validation schema files found")

  failed <- character(0)
  for (file in files) {
    content <- paste(readLines(file, warn = FALSE), collapse = "\n")
    msgs <- js_error_messages(js_validate_schema(content))
    if (length(msgs) > 0) {
      failed <- c(failed, sprintf("%s: %s", basename(file),
                                  paste(msgs, collapse = ", ")))
    }
  }
  expect_true(
    length(failed) == 0,
    info = paste("Expected these schemas to be valid but got errors:\n",
                 paste(failed, collapse = "\n  "))
  )
})

test_that("invalid instances are rejected against their schemas", {
  skip_if_no_binding()
  assets <- find_test_assets()
  skip_if(is.null(assets), "test-assets directory not found")
  instances_dir <- file.path(assets, "instances", "validation")
  schemas_dir <- file.path(assets, "schemas", "validation")
  skip_if_not(dir.exists(instances_dir), "validation instances directory not found")

  dirs <- Sys.glob(file.path(instances_dir, "*"))
  dirs <- dirs[dir.exists(dirs)]
  skip_if(length(dirs) == 0, "no instance directories found")

  failed <- character(0)
  for (instance_dir in dirs) {
    schema_name <- basename(instance_dir)
    schema_file <- file.path(schemas_dir, paste0(schema_name, ".struct.json"))
    if (!file.exists(schema_file)) next
    schema_content <- paste(readLines(schema_file, warn = FALSE), collapse = "\n")

    for (instance_file in Sys.glob(file.path(instance_dir, "*.json"))) {
      instance_content <- paste(readLines(instance_file, warn = FALSE),
                                collapse = "\n")
      value <- extract_instance_value(instance_content)
      if (is_valid(js_validate_instance(value, schema_content))) {
        failed <- c(failed, sprintf("%s/%s", schema_name,
                                    basename(instance_file)))
      }
    }
  }
  expect_true(
    length(failed) == 0,
    info = paste("Expected these instances to be invalid but they were valid:\n",
                 paste(failed, collapse = "\n  "))
  )
})

test_that("primer sample schemas are accepted", {
  skip_if_no_binding()
  assets <- find_test_assets()
  skip_if(is.null(assets), "test-assets directory not found")
  primer <- file.path(dirname(assets), "primer-and-samples", "samples", "core")
  skip_if_not(dir.exists(primer), "primer samples directory not found")

  files <- list.files(primer, pattern = "\\.struct\\.json$", recursive = TRUE,
                      full.names = TRUE)
  skip_if(length(files) == 0, "no primer schema files found")

  failed <- character(0)
  for (file in files) {
    content <- paste(readLines(file, warn = FALSE), collapse = "\n")
    msgs <- js_error_messages(js_validate_schema(content))
    if (length(msgs) > 0) {
      failed <- c(failed, sprintf("%s: %s",
                                  sub(primer, "", file, fixed = TRUE),
                                  paste(msgs, collapse = ", ")))
    }
  }
  expect_true(
    length(failed) == 0,
    info = paste("Expected these primer schemas to be valid but got errors:\n",
                 paste(failed, collapse = "\n  "))
  )
})

# ---------------------------------------------------------------------------
# Adversarial corpus (mirrors python/tests/test_assets.py). These stress the
# validator for crashes, hangs and mis-verdicts. Robustness first: most
# adversarial schemas need only be handled without crashing, while a known
# subset must be rejected outright. Termination on ReDoS/pathological input is
# guaranteed by the engine's bounded-backtracking regex matcher, which is
# additionally exercised under ASAN/UBSAN by the `regex-sanitizers` CI job.
# ---------------------------------------------------------------------------

# Adversarial schemas that MUST fail schema validation.
INVALID_ADVERSARIAL_SCHEMAS <- c(
  "ref-to-nowhere.struct.json",
  "malformed-json-pointer.struct.json",
  "self-referencing-extends.struct.json",
  "extends-circular-chain.struct.json"
)

# Adversarial instance file -> the adversarial schema it is validated against.
ADVERSARIAL_INSTANCE_SCHEMA_MAP <- c(
  "deep-nesting.json"                  = "deep-nesting-100.struct.json",
  "recursive-tree.json"                = "recursive-array-items.struct.json",
  "property-name-edge-cases.json"      = "property-name-edge-cases.struct.json",
  "unicode-edge-cases.json"            = "unicode-edge-cases.struct.json",
  "string-length-surrogate.json"       = "string-length-surrogate.struct.json",
  "int64-precision.json"               = "int64-precision-loss.struct.json",
  "floating-point.json"                = "floating-point-precision.struct.json",
  "null-edge-cases.json"               = "null-edge-cases.struct.json",
  "empty-collections-invalid.json"     = "empty-arrays-objects.struct.json",
  "redos-attack.json"                  = "redos-pattern.struct.json",
  "allof-conflict.json"                = "allof-conflicting-types.struct.json",
  "oneof-all-match.json"               = "oneof-all-match.struct.json",
  "type-union-int.json"                = "type-union-ambiguous.struct.json",
  "type-union-number.json"             = "type-union-ambiguous.struct.json",
  "conflicting-constraints.json"       = "conflicting-constraints.struct.json",
  "format-invalid.json"                = "format-edge-cases.struct.json",
  "format-valid.json"                  = "format-edge-cases.struct.json",
  "pattern-flags.json"                 = "pattern-with-flags.struct.json",
  "additionalProperties-combined.json" = "additionalProperties-combined.struct.json",
  "extends-override.json"              = "extends-with-overrides.struct.json",
  "quadratic-blowup.json"              = "quadratic-blowup.struct.json",
  "anyof-none-match.json"              = "anyof-none-match.struct.json"
)

# Drop the "$schema" association from an adversarial instance (mirrors the
# Python harness `instance.pop("$schema")`) and return JSON text to validate.
strip_schema_association <- function(instance_json) {
  instance <- jsonlite::fromJSON(instance_json, simplifyVector = FALSE)
  if (is.list(instance)) {
    instance[["$schema"]] <- NULL
  }
  as.character(jsonlite::toJSON(instance, auto_unbox = TRUE,
                                null = "null", na = "null", digits = NA))
}

test_that("adversarial schemas are handled without crashing", {
  skip_if_no_binding()
  assets <- find_test_assets()
  skip_if(is.null(assets), "test-assets directory not found")
  dir <- file.path(assets, "schemas", "adversarial")
  skip_if_not(dir.exists(dir), "adversarial schemas directory not found")

  files <- Sys.glob(file.path(dir, "*.struct.json"))
  skip_if(length(files) == 0, "no adversarial schema files found")

  wrong <- character(0)
  for (file in files) {
    content <- paste(readLines(file, warn = FALSE), collapse = "\n")
    res <- js_validate_schema(content)
    expect_s3_class(res, "js_validation_result")
    must_reject <- basename(file) %in% INVALID_ADVERSARIAL_SCHEMAS
    if (must_reject && is_valid(res)) {
      wrong <- c(wrong, basename(file))
    }
  }
  expect_true(
    length(wrong) == 0,
    info = paste("Expected these adversarial schemas to be rejected but they",
                 "were accepted:", paste(wrong, collapse = ", "))
  )
})

test_that("adversarial instances do not crash the validator", {
  skip_if_no_binding()
  assets <- find_test_assets()
  skip_if(is.null(assets), "test-assets directory not found")
  schemas_dir <- file.path(assets, "schemas", "adversarial")
  instances_dir <- file.path(assets, "instances", "adversarial")
  skip_if_not(dir.exists(instances_dir),
              "adversarial instances directory not found")

  files <- Sys.glob(file.path(instances_dir, "*.json"))
  skip_if(length(files) == 0, "no adversarial instance files found")

  checked <- 0L
  for (instance_file in files) {
    schema_name <- ADVERSARIAL_INSTANCE_SCHEMA_MAP[[basename(instance_file)]]
    if (is.null(schema_name)) next
    schema_file <- file.path(schemas_dir, schema_name)
    if (!file.exists(schema_file)) next

    schema_content <- paste(readLines(schema_file, warn = FALSE),
                            collapse = "\n")
    instance_json <- paste(readLines(instance_file, warn = FALSE),
                           collapse = "\n")
    instance_value <- strip_schema_association(instance_json)

    # Must return a result object without raising or hanging.
    res <- js_validate_instance(instance_value, schema_content)
    expect_s3_class(res, "js_validation_result")
    checked <- checked + 1L
  }
  expect_gt(checked, 0)
})

# ---------------------------------------------------------------------------
# Warnings corpus: schemas that use validation-extension keywords without a
# `$uses` declaration must be VALID but must emit a "not enabled" warning; the
# same keywords with `$uses` present must not emit that warning. Mirrors
# python/tests/test_assets.py.
# ---------------------------------------------------------------------------

EXT_KEYWORD_WARNING <- "validation extensions are not enabled"

test_that("extension keywords without $uses produce warnings", {
  skip_if_no_binding()
  assets <- find_test_assets()
  skip_if(is.null(assets), "test-assets directory not found")
  dir <- file.path(assets, "schemas", "warnings")
  skip_if_not(dir.exists(dir), "warnings schemas directory not found")

  files <- Sys.glob(file.path(dir, "*-without-uses.struct.json"))
  skip_if(length(files) == 0, "no warning schema files found")

  failed <- character(0)
  for (file in files) {
    content <- paste(readLines(file, warn = FALSE), collapse = "\n")
    res <- js_validate_schema(content)
    warns <- js_warning_messages(res)
    if (!is_valid(res)) {
      failed <- c(failed, sprintf("%s (unexpectedly invalid)", basename(file)))
    } else if (!any(grepl(EXT_KEYWORD_WARNING, warns, fixed = TRUE))) {
      failed <- c(failed,
                  sprintf("%s (no extension-keyword warning)", basename(file)))
    }
  }
  expect_true(
    length(failed) == 0,
    info = paste("Warning-schema expectations not met:\n",
                 paste(failed, collapse = "\n  "))
  )
})

test_that("extension keywords with $uses produce no 'not enabled' warning", {
  skip_if_no_binding()
  assets <- find_test_assets()
  skip_if(is.null(assets), "test-assets directory not found")
  file <- file.path(assets, "schemas", "warnings",
                    "all-extension-keywords-with-uses.struct.json")
  skip_if_not(file.exists(file), "with-uses warning schema not found")

  content <- paste(readLines(file, warn = FALSE), collapse = "\n")
  res <- js_validate_schema(content)
  expect_true(is_valid(res))
  warns <- js_warning_messages(res)
  expect_false(any(grepl(EXT_KEYWORD_WARNING, warns, fixed = TRUE)))
})
