\name{jsonstructure-package}
\alias{jsonstructure}
\alias{jsonstructure-package}
\docType{package}
\title{jsonstructure: JSON Structure validation for R}
\description{
  Validate JSON Structure schemas and JSON instances against them. The package
  is a thin binding over the JSON Structure C engine: a small compiled shim
  loads a prebuilt \code{json_structure} shared library (downloaded from GitHub
  Releases on first use, or supplied via the \code{JSONSTRUCTURE_LIB_PATH}
  environment variable) and marshals results back into idiomatic R objects.
}
\section{Main functions}{
  \itemize{
    \item \code{\link{js_validate_schema}} / \code{\link{js_validate_schema_strict}}
    \item \code{\link{js_validate_instance}} / \code{\link{js_validate_instance_strict}}
    \item \code{\link{install_jsonstructure_binary}}, \code{\link{jsonstructure_binary_path}}
  }
}
\seealso{
  Project home: \url{https://json-structure.org};
  source: \url{https://github.com/json-structure/sdk}
}
\keyword{internal}
