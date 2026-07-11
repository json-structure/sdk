\name{js_error_messages}
\alias{js_error_messages}
\alias{js_warning_messages}
\title{Extract messages from a validation result}
\usage{
js_error_messages(x)

js_warning_messages(x)
}
\arguments{
  \item{x}{A \code{js_validation_result}.}
}
\value{
  A character vector of messages: \code{js_error_messages} returns
  \code{error}-severity messages, \code{js_warning_messages} returns
  \code{warning}-severity messages.
}
\description{
  Convenience accessors for the human-readable messages carried by a
  \code{js_validation_result}, filtered by severity.
}
\examples{
\dontrun{
res <- js_validate_schema('{"type":"not_a_type"}')
js_error_messages(res)
}
}
\seealso{\code{\link{is_valid}}}
