# Package load/unload hooks.
#
# Loading of the prebuilt json_structure engine is deferred entirely to the
# first validation call (see .js_ensure_loaded()): we do NOT load external
# native code during library()/.onLoad, which keeps package attach fast,
# side-effect-free and offline-safe. .onUnload releases the engine and the
# compiled shim when the package is unloaded.

.onUnload <- function(libpath) {
  try(.js_unload_binding(), silent = TRUE)
  library.dynam.unload("jsonstructure", libpath)
}
