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

# Ensure the prebuilt library is loaded, resolving it lazily on first use:
# JSONSTRUCTURE_LIB_PATH override -> cached binary -> download from Releases.
.js_ensure_loaded <- function() {
  if (js_binding_loaded()) {
    return(invisible(TRUE))
  }

  override <- Sys.getenv("JSONSTRUCTURE_LIB_PATH", unset = "")
  path <- if (nzchar(override) && file.exists(override)) {
    override
  } else {
    .js_ensure_binary(quiet = FALSE)
  }

  .js_load_binding(path)
}
