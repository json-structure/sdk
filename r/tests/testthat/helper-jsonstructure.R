# Shared test helpers.

# The JSON Structure C engine is compiled directly into the package, so
# validation is always available: there is no optional binary to load and
# nothing to skip. This shim is retained as a no-op so the existing test files
# read unchanged; the tests now run in every environment, including on CRAN.
skip_if_no_binding <- function() {
  invisible()
}

# Construct a base (C-side) result to feed the pure-R augmentation directly,
# without invoking the engine.
valid_base_result <- function() {
  jsonstructure:::new_validation_result(TRUE, list())
}

augment <- function(schema_json) {
  jsonstructure:::.js_augment_schema_result(valid_base_result(), schema_json)
}
