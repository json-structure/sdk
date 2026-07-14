# Instance validation API. Mirrors ruby/lib/jsonstructure/instance_validator.rb.
# Instance validation has no R-side augmentation; the C engine performs the full
# check.

#' Validate a JSON instance against a JSON Structure schema
#'
#' @param instance A JSON string, or an R object (list/vector) serialisable to
#'   the JSON instance.
#' @param schema A JSON string, or an R object serialisable to the JSON
#'   Structure schema to validate against.
#' @return A `js_validation_result` object.
#' @seealso [js_validate_schema()], [js_validate_instance_strict()]
#' @examples
#' res <- js_validate_instance('"hello"', '{"type":"string"}')
#' is_valid(res)
#' @export
js_validate_instance <- function(instance, schema) {
  instance_json <- .js_as_json_text(instance, "instance")
  schema_json <- .js_as_json_text(schema, "schema")
  res <- .js_call_validate_instance(instance_json, schema_json)
  .js_result_from_call(res)
}

#' Validate a JSON instance, erroring on failure
#'
#' Like [js_validate_instance()] but raises a condition (of class
#' `js_validation_error_condition`) when the instance is invalid.
#'
#' @inheritParams js_validate_instance
#' @return (Invisibly) the `js_validation_result` when valid.
#' @export
js_validate_instance_strict <- function(instance, schema) {
  result <- js_validate_instance(instance, schema)
  if (!is_valid(result)) {
    stop(.js_validation_condition(result, "Instance validation failed"))
  }
  invisible(result)
}
