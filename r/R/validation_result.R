# S3 result and error objects returned by the validators.
#
# Mirrors ruby/lib/jsonstructure/validation_result.rb (ValidationResult /
# ValidationError) using idiomatic R S3 classes.

# Severity codes returned by the C engine (js_severity_t): 0=error, 1=warning,
# 2=info.
.js_severity_labels <- c("error", "warning", "info")

.js_severity_label <- function(code) {
  code <- as.integer(code)
  if (!is.na(code) && code >= 0L && code < length(.js_severity_labels)) {
    .js_severity_labels[code + 1L]
  } else {
    "error"
  }
}

# Construct a single validation error. `severity` is the integer severity code
# (0/1/2). `code` may be an integer (from the C engine) or a string label (from
# the R-side augmentation checks).
new_validation_error <- function(code, severity, message, path = NULL,
                                 line = 0L, column = 0L, offset = 0) {
  structure(
    list(
      code = code,
      severity = .js_severity_label(severity),
      severity_code = as.integer(severity),
      message = if (is.null(message)) "" else as.character(message),
      path = if (is.null(path) || is.na(path)) NULL else as.character(path),
      location = list(
        line = as.integer(line),
        column = as.integer(column),
        offset = as.numeric(offset)
      )
    ),
    class = "js_validation_error"
  )
}

new_validation_result <- function(valid, errors = list()) {
  structure(
    list(valid = isTRUE(valid), errors = errors),
    class = "js_validation_result"
  )
}

.js_error_is_error <- function(e) identical(e$severity, "error")
.js_error_is_warning <- function(e) identical(e$severity, "warning")

# Build a js_validation_result from the columnar list returned by the shim.
.js_result_from_call <- function(res) {
  n <- length(res$code)
  errors <- vector("list", n)
  if (n > 0) {
    for (i in seq_len(n)) {
      errors[[i]] <- new_validation_error(
        code = res$code[[i]],
        severity = res$severity[[i]],
        message = res$message[[i]],
        path = res$path[[i]],
        line = res$line[[i]],
        column = res$column[[i]],
        offset = res$offset[[i]]
      )
    }
  }
  new_validation_result(isTRUE(res$valid), errors)
}

#' Is the validation result valid?
#'
#' @param x A `js_validation_result`.
#' @param ... Unused.
#' @return `TRUE` when validation succeeded (no error-severity problems).
#' @export
is_valid <- function(x, ...) UseMethod("is_valid")

#' @export
is_valid.js_validation_result <- function(x, ...) isTRUE(x$valid)

#' @export
is_valid.default <- function(x, ...) {
  stop("is_valid() requires a js_validation_result object", call. = FALSE)
}

#' Error messages from a validation result
#'
#' @param x A `js_validation_result`.
#' @return A character vector of messages whose severity is `error`.
#' @export
js_error_messages <- function(x) {
  if (!inherits(x, "js_validation_result")) {
    stop("`x` must be a js_validation_result object.", call. = FALSE)
  }
  vapply(Filter(.js_error_is_error, x$errors),
         function(e) e$message, character(1))
}

#' Warning messages from a validation result
#'
#' @param x A `js_validation_result`.
#' @return A character vector of messages whose severity is `warning`.
#' @export
js_warning_messages <- function(x) {
  if (!inherits(x, "js_validation_result")) {
    stop("`x` must be a js_validation_result object.", call. = FALSE)
  }
  vapply(Filter(.js_error_is_warning, x$errors),
         function(e) e$message, character(1))
}

#' @export
as.data.frame.js_validation_result <- function(x, ...) {
  errs <- x$errors
  n <- length(errs)
  data.frame(
    code = vapply(errs, function(e) as.character(e$code), character(1)),
    severity = vapply(errs, function(e) e$severity, character(1)),
    message = vapply(errs, function(e) e$message, character(1)),
    path = vapply(errs, function(e) if (is.null(e$path)) NA_character_ else e$path,
                  character(1)),
    line = vapply(errs, function(e) e$location$line, integer(1)),
    column = vapply(errs, function(e) e$location$column, integer(1)),
    offset = vapply(errs, function(e) e$location$offset, numeric(1)),
    stringsAsFactors = FALSE
  )
}

#' @export
format.js_validation_error <- function(x, ...) {
  loc <- ""
  if (!is.null(x$location) && !is.na(x$location$line) && x$location$line > 0L) {
    loc <- sprintf(" (line %d, column %d)", x$location$line, x$location$column)
  }
  where <- if (is.null(x$path)) "" else sprintf(" [%s]", x$path)
  sprintf("[%s] %s%s%s", x$severity, x$message, where, loc)
}

#' @export
print.js_validation_error <- function(x, ...) {
  cat(format(x, ...), "\n", sep = "")
  invisible(x)
}

#' @export
print.js_validation_result <- function(x, ...) {
  if (isTRUE(x$valid)) {
    cat("<js_validation_result: valid>\n")
  } else {
    cat("<js_validation_result: INVALID>\n")
  }
  if (length(x$errors) > 0) {
    for (e in x$errors) {
      cat("  ", format(e), "\n", sep = "")
    }
  }
  invisible(x)
}
