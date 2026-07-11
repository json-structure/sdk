\name{is_valid}
\alias{is_valid}
\alias{is_valid.js_validation_result}
\alias{is_valid.default}
\title{Is a validation result valid?}
\usage{
is_valid(x, ...)
}
\arguments{
  \item{x}{A \code{js_validation_result}.}
  \item{...}{Unused.}
}
\value{
  \code{TRUE} when validation succeeded (no error-severity problems), otherwise
  \code{FALSE}.
}
\description{
  S3 generic testing whether a \code{js_validation_result} represents a
  successful validation.
}
\examples{
\dontrun{
is_valid(js_validate_schema('{"type":"string"}'))
}
}
\seealso{\code{\link{js_error_messages}}, \code{\link{js_warning_messages}}}
