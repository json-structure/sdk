#' jsonstructure: JSON Structure validation for R
#'
#' Validate JSON Structure schemas and JSON instances against them. The package
#' is a thin binding over the JSON Structure C engine, which is compiled from
#' bundled source directly into the package: validation runs in native code and
#' the results are marshalled back into idiomatic R objects. Nothing is
#' downloaded at install or run time.
#'
#' @section Main functions:
#' \itemize{
#'   \item [js_validate_schema()] / [js_validate_schema_strict()]
#'   \item [js_validate_instance()] / [js_validate_instance_strict()]
#'   \item [jsonstructure_version()], [jsonstructure_engine_version()]
#' }
#'
#' @useDynLib jsonstructure, .registration = TRUE, .fixes = "C_"
#' @importFrom jsonlite fromJSON toJSON
#' @importFrom utils packageVersion
#' @keywords internal
"_PACKAGE"
