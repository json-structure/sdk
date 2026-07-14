# Version metadata for the JSON Structure R SDK.

#' Package version
#'
#' @return The installed package version as a character string.
#' @seealso [jsonstructure_engine_version()] for the bundled C engine version.
#' @examples
#' jsonstructure_version()
#' @export
jsonstructure_version <- function() {
  as.character(utils::packageVersion("jsonstructure"))
}

#' Version of the bundled JSON Structure C engine
#'
#' Reports the version string of the JSON Structure C engine that is compiled
#' into this package. The engine and its cJSON dependency are built from source
#' at install time; nothing is downloaded at run time.
#'
#' @return A single character string: the bundled engine's version.
#' @examples
#' jsonstructure_engine_version()
#' @export
jsonstructure_engine_version <- function() {
  .js_engine_version()
}
