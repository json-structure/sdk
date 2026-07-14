# Package unload hook.
#
# The JSON Structure C engine is compiled into the package shared object and is
# initialised in R_init_jsonstructure() when that object loads, so there is no
# .onLoad work to do. On unload we ask the engine to release its process-wide
# resources (the compiled-regex cache) before detaching the shared object, so a
# subsequent reload starts from a clean state.

.onUnload <- function(libpath) {
  try(.Call(C_engine_cleanup), silent = TRUE)
  library.dynam.unload("jsonstructure", libpath)
}
