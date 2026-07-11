# Shared test helpers.

# Skip a test unless the prebuilt json_structure library can be loaded. This
# keeps the suite green on machines without the binary (e.g. offline dev boxes)
# while running fully in CI where JSONSTRUCTURE_LIB_PATH points at a fresh build.
skip_if_no_binding <- function() {
  ok <- tryCatch({
    jsonstructure:::.js_ensure_loaded()
    jsonstructure:::js_binding_loaded()
  }, error = function(e) FALSE)
  if (!isTRUE(ok)) {
    testthat::skip("json_structure prebuilt library not available")
  }
}

# Construct a base (C-side) result to feed the pure-R augmentation directly,
# without requiring the binary.
valid_base_result <- function() {
  jsonstructure:::new_validation_result(TRUE, list())
}

augment <- function(schema_json) {
  jsonstructure:::.js_augment_schema_result(valid_base_result(), schema_json)
}
