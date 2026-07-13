# Low-level wrappers over the compiled shim (.Call entry points).
#
# The C shim (src/shim.c) loads the prebuilt json_structure shared library at
# runtime via dlopen/LoadLibraryEx. These helpers wrap the registered .Call
# routines. The `C_*` symbols are created by useDynLib(..., .fixes = "C_") in
# NAMESPACE.

# Whether the prebuilt json_structure library is currently loaded by the shim.
js_binding_loaded <- function() {
  isTRUE(.Call(C_binding_loaded))
}

# Load the prebuilt library from `path`; stop() with a helpful message on error.
.js_load_binding <- function(path) {
  err <- .Call(C_load_library, path)
  if (nzchar(err)) {
    stop(sprintf("Failed to load the json_structure library from '%s': %s",
                 path, err), call. = FALSE)
  }
  invisible(TRUE)
}

.js_unload_binding <- function() {
  invisible(.Call(C_unload_library))
}

.js_call_validate_schema <- function(schema_json) {
  .Call(C_validate_schema, schema_json)
}

.js_call_validate_instance <- function(instance_json, schema_json) {
  .Call(C_validate_instance, instance_json, schema_json)
}

# Ensure the prebuilt library is loaded, resolving it lazily on first use from
# the JSONSTRUCTURE_LIB_PATH override or the per-user cache. The native engine
# is never downloaded implicitly: if no library is available the user is asked
# for consent (interactive sessions only), otherwise a clear error explains how
# to install it. This keeps validation offline-safe and non-interactive / CRAN
# runs quiet and free of surprise network access.
.js_ensure_loaded <- function() {
  if (js_binding_loaded()) {
    return(invisible(TRUE))
  }

  override <- Sys.getenv("JSONSTRUCTURE_LIB_PATH", unset = "")
  if (nzchar(override) && !file.exists(override)) {
    stop(sprintf(
      "JSONSTRUCTURE_LIB_PATH is set to '%s' but that file does not exist.",
      override), call. = FALSE)
  }

  path <- jsonstructure_binary_path()
  if (is.null(path)) {
    path <- .js_prompt_and_install()
  }

  .js_load_binding(path)
}

# Version string reported by the loaded json_structure engine, or "" when the
# library is not loaded or does not export runtime version information.
js_binding_version <- function() {
  if (!js_binding_loaded()) {
    return("")
  }
  .Call(C_binding_version)
}
