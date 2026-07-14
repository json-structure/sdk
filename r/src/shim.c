/*
 * shim.c - Thin R <-> JSON Structure C engine binding.
 *
 * The JSON Structure C engine (and its cJSON dependency) is compiled directly
 * into this package's shared object, so there is nothing to load or download at
 * runtime: the shim calls the engine entry points through the real public
 * headers and marshals validation results back into R objects.
 *
 * SPDX-License-Identifier: MIT
 */

#include <R.h>
#include <Rinternals.h>

#include <string.h>

#include "json_structure/json_structure.h"

/* ------------------------------------------------------------------ */
/* UTF-8 argument helpers                                             */
/* ------------------------------------------------------------------ */

static const char *to_utf8(SEXP s, const char *what) {
    if (TYPEOF(s) != STRSXP || LENGTH(s) < 1 || STRING_ELT(s, 0) == NA_STRING) {
        Rf_error("%s must be a non-NA character string", what);
    }
    return Rf_translateCharUTF8(STRING_ELT(s, 0));
}

/*
 * translateCharUTF8() may return a pointer into a rotating buffer that a
 * subsequent call can overwrite, so copy into R_alloc memory (freed
 * automatically when the enclosing .Call returns) before holding two strings.
 */
static const char *dup_utf8(SEXP s, const char *what) {
    const char *p = to_utf8(s, what);
    size_t len = strlen(p);
    char *c = R_alloc(len + 1, 1);
    memcpy(c, p, len + 1);
    return c;
}

/* ------------------------------------------------------------------ */
/* Result marshalling                                                 */
/* ------------------------------------------------------------------ */

/* Marshal a js_result_t into a named list of columns. */
static SEXP make_result(const js_result_t *res) {
    R_xlen_t n = (R_xlen_t) res->error_count;

    SEXP valid = PROTECT(Rf_ScalarLogical(res->valid));
    SEXP code = PROTECT(Rf_allocVector(INTSXP, n));
    SEXP severity = PROTECT(Rf_allocVector(INTSXP, n));
    SEXP message = PROTECT(Rf_allocVector(STRSXP, n));
    SEXP path = PROTECT(Rf_allocVector(STRSXP, n));
    SEXP line = PROTECT(Rf_allocVector(INTSXP, n));
    SEXP column = PROTECT(Rf_allocVector(INTSXP, n));
    SEXP offset = PROTECT(Rf_allocVector(REALSXP, n));

    for (R_xlen_t i = 0; i < n; i++) {
        const js_error_t *e = &res->errors[i];
        INTEGER(code)[i] = e->code;
        INTEGER(severity)[i] = (int) e->severity;
        SET_STRING_ELT(message, i,
                       e->message ? Rf_mkCharCE(e->message, CE_UTF8) : NA_STRING);
        SET_STRING_ELT(path, i,
                       e->path ? Rf_mkCharCE(e->path, CE_UTF8) : NA_STRING);
        INTEGER(line)[i] = e->location.line;
        INTEGER(column)[i] = e->location.column;
        REAL(offset)[i] = (double) e->location.offset;
    }

    SEXP out = PROTECT(Rf_allocVector(VECSXP, 8));
    SET_VECTOR_ELT(out, 0, valid);
    SET_VECTOR_ELT(out, 1, code);
    SET_VECTOR_ELT(out, 2, severity);
    SET_VECTOR_ELT(out, 3, message);
    SET_VECTOR_ELT(out, 4, path);
    SET_VECTOR_ELT(out, 5, line);
    SET_VECTOR_ELT(out, 6, column);
    SET_VECTOR_ELT(out, 7, offset);

    SEXP names = PROTECT(Rf_allocVector(STRSXP, 8));
    SET_STRING_ELT(names, 0, Rf_mkChar("valid"));
    SET_STRING_ELT(names, 1, Rf_mkChar("code"));
    SET_STRING_ELT(names, 2, Rf_mkChar("severity"));
    SET_STRING_ELT(names, 3, Rf_mkChar("message"));
    SET_STRING_ELT(names, 4, Rf_mkChar("path"));
    SET_STRING_ELT(names, 5, Rf_mkChar("line"));
    SET_STRING_ELT(names, 6, Rf_mkChar("column"));
    SET_STRING_ELT(names, 7, Rf_mkChar("offset"));
    Rf_setAttrib(out, R_NamesSymbol, names);

    UNPROTECT(10);
    return out;
}

/*
 * Marshal a js_result_t into R objects, guaranteeing js_result_cleanup() runs
 * even if an allocation inside make_result() triggers an R error long-jump
 * (which would otherwise skip the cleanup and leak the C-side result).
 */
static SEXP marshal_body(void *data) {
    return make_result((const js_result_t *) data);
}
static void marshal_cleanup(void *data, Rboolean jump) {
    (void) jump;
    js_result_cleanup((js_result_t *) data);
}
static SEXP marshal_result(js_result_t *res) {
    SEXP cont = PROTECT(R_MakeUnwindCont());
    SEXP out = R_UnwindProtect(marshal_body, res, marshal_cleanup, res, cont);
    UNPROTECT(1);
    return out;
}

/* ------------------------------------------------------------------ */
/* .Call entry points                                                 */
/* ------------------------------------------------------------------ */

SEXP r_validate_schema(SEXP schema_sexp) {
    const char *schema = dup_utf8(schema_sexp, "schema");

    js_schema_validator_t validator;
    memset(&validator, 0, sizeof validator);
    js_schema_validator_init(&validator);

    js_result_t res;
    memset(&res, 0, sizeof res);
    js_result_init(&res);
    js_schema_validate_string(&validator, schema, &res);

    return marshal_result(&res);
}

SEXP r_validate_instance(SEXP instance_sexp, SEXP schema_sexp) {
    const char *instance = dup_utf8(instance_sexp, "instance");
    const char *schema = dup_utf8(schema_sexp, "schema");

    js_instance_validator_t validator;
    memset(&validator, 0, sizeof validator);
    js_instance_validator_init(&validator);

    js_result_t res;
    memset(&res, 0, sizeof res);
    js_result_init(&res);
    js_instance_validate_strings(&validator, instance, schema, &res);

    return marshal_result(&res);
}

/* Version string of the JSON Structure C engine compiled into this package. */
SEXP r_engine_version(void) {
    return Rf_mkString(JSON_STRUCTURE_VERSION_STRING);
}

/* Release engine-held resources (e.g. the compiled-regex cache). Called from
 * the package .onUnload hook so a reload starts from a clean state. */
SEXP r_engine_cleanup(void) {
    js_cleanup();
    return R_NilValue;
}
