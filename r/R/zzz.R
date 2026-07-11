# Package load/unload hooks.
#
# On load we do a best-effort, network-free attempt to load an already-present
# library (from JSONSTRUCTURE_LIB_PATH or the local cache). Downloading is
# deferred to first validation call (see .js_ensure_loaded()), mirroring the
# Ruby SDK's lazy-on-first-use behaviour and keeping library() / R CMD check
# offline-safe.

.onLoad <- function(libname, pkgname) {
  override <- Sys.getenv("JSONSTRUCTURE_LIB_PATH", unset = "")
  path <- if (nzchar(override) && file.exists(override)) {
    override
  } else {
    cached <- tryCatch(.js_cached_binary_path(), error = function(e) "")
    if (nzchar(cached) && file.exists(cached)) cached else ""
  }

  if (nzchar(path) && file.exists(path)) {
    try(.js_load_binding(path), silent = TRUE)
  }
  invisible()
}

.onUnload <- function(libpath) {
  try(.js_unload_binding(), silent = TRUE)
  library.dynam.unload("jsonstructure", libpath)
}
