# Shared test helpers.

# Skip a test unless the prebuilt json_structure library is *already* available
# locally (via JSONSTRUCTURE_LIB_PATH or a previously installed cache copy).
# This never triggers a download, so the suite stays fully offline/network-free
# and CRAN-safe: it runs where JSONSTRUCTURE_LIB_PATH points at a fresh build
# (e.g. CI) and skips cleanly everywhere else.
skip_if_no_binding <- function() {
  testthat::skip_on_cran()

  if (isTRUE(tryCatch(jsonstructure:::js_binding_loaded(),
                      error = function(e) FALSE))) {
    return(invisible())
  }

  path <- tryCatch(jsonstructure::jsonstructure_binary_path(),
                   error = function(e) NULL)
  if (is.null(path)) {
    testthat::skip("json_structure prebuilt library not available")
  }

  ok <- tryCatch({
    jsonstructure:::.js_load_binding(path)
    jsonstructure:::js_binding_loaded()
  }, error = function(e) FALSE)
  if (!isTRUE(ok)) {
    testthat::skip("json_structure prebuilt library could not be loaded")
  }
  invisible()
}

# Construct a base (C-side) result to feed the pure-R augmentation directly,
# without requiring the binary.
valid_base_result <- function() {
  jsonstructure:::new_validation_result(TRUE, list())
}

augment <- function(schema_json) {
  jsonstructure:::.js_augment_schema_result(valid_base_result(), schema_json)
}
