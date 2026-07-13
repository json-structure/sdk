#' jsonstructure: JSON Structure validation for R
#'
#' Validate JSON Structure schemas and JSON instances against them. The package
#' is a thin binding over the proven JSON Structure C engine: a small compiled
#' shim loads a prebuilt `json_structure` shared library (installed on demand
#' with [install_jsonstructure_binary()], or supplied via the
#' `JSONSTRUCTURE_LIB_PATH` environment variable) and marshals results back into
#' idiomatic R objects.
#'
#' @section Main functions:
#' \itemize{
#'   \item [js_validate_schema()] / [js_validate_schema_strict()]
#'   \item [js_validate_instance()] / [js_validate_instance_strict()]
#'   \item [install_jsonstructure_binary()], [jsonstructure_binary_path()]
#' }
#'
#' @useDynLib jsonstructure, .registration = TRUE, .fixes = "C_"
#' @importFrom jsonlite fromJSON toJSON
#' @importFrom tools R_user_dir
#' @importFrom utils askYesNo download.file untar unzip packageVersion
#' @keywords internal
"_PACKAGE"
