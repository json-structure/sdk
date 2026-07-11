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
