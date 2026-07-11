# Schema validation API. Mirrors ruby/lib/jsonstructure/schema_validator.rb.

# Coerce a user-supplied schema/instance argument to JSON text: a length-one
# character vector is treated as JSON text; anything else is serialised with
# jsonlite.
.js_as_json_text <- function(x, what) {
  if (is.null(x)) {
    return("null")
  }
  if (is.character(x) && length(x) == 1 && !is.na(x)) {
    return(x)
  }
  if (inherits(x, "json")) {
    return(as.character(x))
  }
  tryCatch(
    as.character(jsonlite::toJSON(x, auto_unbox = TRUE, null = "null",
                                  na = "null", digits = NA)),
    error = function(e) {
      stop(sprintf(
        "%s must be a JSON string or an R object serialisable to JSON: %s",
        what, conditionMessage(e)), call. = FALSE)
    }
  )
}

.js_validation_condition <- function(result, headline) {
  msgs <- js_error_messages(result)
  message <- if (length(msgs) > 0) {
    paste0(headline, ":\n  - ", paste(msgs, collapse = "\n  - "))
  } else {
    headline
  }
  structure(
    class = c("js_validation_error_condition", "error", "condition"),
    list(message = message, call = NULL, result = result)
  )
}

#' Validate a JSON Structure schema
#'
#' Validates that `schema` is a well-formed JSON Structure schema document.
#'
#' @param schema A JSON string, or an R object (list) serialisable to a JSON
#'   schema document.
#' @return A `js_validation_result` object. Use [is_valid()] to test the
#'   outcome and [js_error_messages()] / [js_warning_messages()] to inspect
#'   diagnostics.
#' @seealso [js_validate_instance()], [js_validate_schema_strict()]
#' @examples
#' \dontrun{
#' res <- js_validate_schema('{"type":"string"}')
#' is_valid(res)
#' }
#' @export
js_validate_schema <- function(schema) {
  schema_json <- .js_as_json_text(schema, "schema")
  .js_ensure_loaded()
  res <- .js_call_validate_schema(schema_json)
  base <- .js_result_from_call(res)
  .js_augment_schema_result(base, schema_json)
}

#' Validate a JSON Structure schema, erroring on failure
#'
#' Like [js_validate_schema()] but raises a condition (of class
#' `js_validation_error_condition`) when the schema is invalid. The condition
#' carries the full result in its `result` field.
#'
#' @inheritParams js_validate_schema
#' @return (Invisibly) the `js_validation_result` when valid.
#' @export
js_validate_schema_strict <- function(schema) {
  result <- js_validate_schema(schema)
  if (!is_valid(result)) {
    stop(.js_validation_condition(result, "Schema validation failed"))
  }
  invisible(result)
}
