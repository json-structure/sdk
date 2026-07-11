# Version metadata for the JSON Structure R SDK.

# The prebuilt C library release tag this package is pinned to. Mirrors the
# Ruby SDK's BinaryInstaller::DEFAULT_VERSION.
JSONSTRUCTURE_BINARY_VERSION <- "v0.1.0"

# GitHub repository that hosts the prebuilt binaries.
JSONSTRUCTURE_REPO <- "json-structure/sdk"

#' Package version
#'
#' @return The installed package version as a character string.
#' @examples
#' \dontrun{
#' jsonstructure_version()
#' }
#' @export
jsonstructure_version <- function() {
  as.character(utils::packageVersion("jsonstructure"))
}
