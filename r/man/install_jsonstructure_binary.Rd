\name{install_jsonstructure_binary}
\alias{install_jsonstructure_binary}
\alias{jsonstructure_binary_path}
\title{Download or locate the prebuilt json_structure library}
\usage{
install_jsonstructure_binary(version = NULL, force = FALSE, quiet = FALSE)

jsonstructure_binary_path()
}
\arguments{
  \item{version}{Release tag to download (defaults to the pinned binary
    version).}
  \item{force}{Re-download even if a cached copy exists.}
  \item{quiet}{Suppress download progress output.}
}
\value{
  \code{install_jsonstructure_binary} returns (invisibly) the path to the cached
  shared library. \code{jsonstructure_binary_path} returns the path to the
  library that would be loaded (the \code{JSONSTRUCTURE_LIB_PATH} override if set,
  otherwise the cached download), or \code{NULL} if none is available locally.
}
\description{
  The package ships only a thin compiled shim; the validation engine is a
  prebuilt \code{json_structure} shared library downloaded from the project's
  GitHub Releases and cached under
  \code{tools::R_user_dir("jsonstructure", "cache")}. This normally happens
  automatically on first validation; call \code{install_jsonstructure_binary}
  to pre-fetch or force a re-download. Set the \code{JSONSTRUCTURE_LIB_PATH}
  environment variable to point at a locally built library and skip the
  download entirely.
}
\examples{
\dontrun{
install_jsonstructure_binary()
jsonstructure_binary_path()
}
}
