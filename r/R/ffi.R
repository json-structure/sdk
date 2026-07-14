# Low-level wrappers over the compiled shim (.Call entry points).
#
# The JSON Structure C engine is compiled directly into this package's shared
# object (see src/), so there is no runtime library to load, download or
# resolve: these helpers simply forward to the registered native routines. The
# `C_*` symbols are created by useDynLib(..., .fixes = "C_") in NAMESPACE.

.js_call_validate_schema <- function(schema_json) {
  .Call(C_validate_schema, schema_json)
}

.js_call_validate_instance <- function(instance_json, schema_json) {
  .Call(C_validate_instance, instance_json, schema_json)
}

# Version string reported by the JSON Structure C engine compiled into this
# package.
.js_engine_version <- function() {
  .Call(C_engine_version)
}
