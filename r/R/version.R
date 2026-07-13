# Version metadata for the JSON Structure R SDK.

# The prebuilt C library release tag this package is pinned to. Mirrors the
# Ruby SDK's BinaryInstaller::DEFAULT_VERSION.
JSONSTRUCTURE_BINARY_VERSION <- "v0.1.0"

# GitHub repository that hosts the prebuilt binaries.
JSONSTRUCTURE_REPO <- "json-structure/sdk"

#' Package version
#'
#' @return The installed package version as a character string.
#' @seealso [jsonstructure_binary_version()] for the native engine version.
#' @examples
#' jsonstructure_version()
#' @export
jsonstructure_version <- function() {
  as.character(utils::packageVersion("jsonstructure"))
}

#' Version of the loaded json_structure native engine
#'
#' Reports the version string exposed by the prebuilt `json_structure` shared
#' library currently loaded by the shim. Older engine builds do not export a
#' runtime version symbol; in that case (or when no engine is loaded) the
#' release tag this package is pinned to is returned instead.
#'
#' @return A single character string: the engine's reported version, or the
#'   pinned target version (without the leading `v`) when the engine does not
#'   report one.
#' @seealso [install_jsonstructure_binary()], [jsonstructure_binary_path()]
#' @examples
#' jsonstructure_binary_version()
#' @export
jsonstructure_binary_version <- function() {
  reported <- tryCatch(js_binding_version(), error = function(e) "")
  if (is.character(reported) && length(reported) == 1L && nzchar(reported)) {
    return(reported)
  }
  sub("^v", "", JSONSTRUCTURE_BINARY_VERSION)
}
