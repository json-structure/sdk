\name{js_validate_instance}
\alias{js_validate_instance}
\alias{js_validate_instance_strict}
\title{Validate a JSON instance against a JSON Structure schema}
\usage{
js_validate_instance(instance, schema)

js_validate_instance_strict(instance, schema)
}
\arguments{
  \item{instance}{A JSON string, or an R object (list/vector) serialisable to
    the JSON instance.}
  \item{schema}{A JSON string, or an R object serialisable to the JSON
    Structure schema to validate against.}
}
\value{
  \code{js_validate_instance} returns a \code{js_validation_result} object.
  \code{js_validate_instance_strict} returns the result invisibly when valid and
  otherwise raises a condition of class \code{js_validation_error_condition}.
}
\description{
  Validates a JSON instance against a JSON Structure schema using the C engine.
}
\examples{
\dontrun{
res <- js_validate_instance('"hello"', '{"type":"string"}')
is_valid(res)
}
}
\seealso{\code{\link{js_validate_schema}}}
