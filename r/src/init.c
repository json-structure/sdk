/*
 * init.c - Registration of native routines for the jsonstructure package.
 * SPDX-License-Identifier: MIT
 */

#include <R.h>
#include <Rinternals.h>
#include <R_ext/Rdynload.h>
#include <stdlib.h>

extern SEXP r_load_library(SEXP);
extern SEXP r_unload_library(void);
extern SEXP r_binding_loaded(void);
extern SEXP r_binding_version(void);
extern SEXP r_validate_schema(SEXP);
extern SEXP r_validate_instance(SEXP, SEXP);

static const R_CallMethodDef CallEntries[] = {
    {"load_library",     (DL_FUNC) &r_load_library,     1},
    {"unload_library",   (DL_FUNC) &r_unload_library,   0},
    {"binding_loaded",   (DL_FUNC) &r_binding_loaded,   0},
    {"binding_version",  (DL_FUNC) &r_binding_version,  0},
    {"validate_schema",  (DL_FUNC) &r_validate_schema,  1},
    {"validate_instance",(DL_FUNC) &r_validate_instance,2},
    {NULL, NULL, 0}
};

void R_init_jsonstructure(DllInfo *dll) {
    R_registerRoutines(dll, NULL, CallEntries, NULL, NULL);
    R_useDynamicSymbols(dll, FALSE);
    R_forceSymbols(dll, TRUE);
}
