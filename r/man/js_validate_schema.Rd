\name{js_validate_schema}
\alias{js_validate_schema}
\alias{js_validate_schema_strict}
\title{Validate a JSON Structure schema}
\usage{
js_validate_schema(schema)

js_validate_schema_strict(schema)
}
\arguments{
  \item{schema}{A JSON string, or an R object (list) serialisable to a JSON
    schema document.}
}
\value{
  \code{js_validate_schema} returns a \code{js_validation_result} object; use
  \code{\link{is_valid}} to test the outcome and
  \code{\link{js_error_messages}} / \code{\link{js_warning_messages}} to inspect
  diagnostics. \code{js_validate_schema_strict} returns the result invisibly
  when valid and otherwise raises a condition of class
  \code{js_validation_error_condition} (whose \code{result} field carries the
  full result).
}
\description{
  Validates that \code{schema} is a well-formed JSON Structure schema document.
  The core check runs in the C engine; additional extension-keyword diagnostics
  (identifier rules, units, relations, \code{$extends} targets, tuple
  \code{$ref} resolution and enum value typing) are added in R.
}
\examples{
\dontrun{
res <- js_validate_schema('{"type":"string"}')
is_valid(res)

js_validate_schema_strict('{"type":"object"}')
}
}
\seealso{\code{\link{js_validate_instance}}}
