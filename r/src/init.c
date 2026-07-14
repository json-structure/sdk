/*
 * init.c - Registration of native routines for the jsonstructure package.
 *
 * The JSON Structure C engine is compiled into this package, so R_init also
 * performs the engine's one-time initialization when the shared object loads.
 *
 * SPDX-License-Identifier: MIT
 */

#include <R.h>
#include <Rinternals.h>
#include <R_ext/Rdynload.h>

#include "json_structure/json_structure.h"

extern SEXP r_validate_schema(SEXP);
extern SEXP r_validate_instance(SEXP, SEXP);
extern SEXP r_engine_version(void);
extern SEXP r_engine_cleanup(void);

static const R_CallMethodDef CallEntries[] = {
    {"validate_schema",   (DL_FUNC) &r_validate_schema,   1},
    {"validate_instance", (DL_FUNC) &r_validate_instance, 2},
    {"engine_version",    (DL_FUNC) &r_engine_version,    0},
    {"engine_cleanup",    (DL_FUNC) &r_engine_cleanup,    0},
    {NULL, NULL, 0}
};

void R_init_jsonstructure(DllInfo *dll) {
    js_init();
    R_registerRoutines(dll, NULL, CallEntries, NULL, NULL);
    R_useDynamicSymbols(dll, FALSE);
    R_forceSymbols(dll, TRUE);
}
