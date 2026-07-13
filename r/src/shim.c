/*
 * shim.c - Thin R <-> JSON Structure C library binding.
 *
 * Mirrors the Ruby SDK's ffi.rb: instead of statically linking the C
 * validator, this shim loads a prebuilt "json_structure" shared library at
 * runtime (downloaded from GitHub Releases with the user's consent, or pointed
 * at by JSONSTRUCTURE_LIB_PATH) and resolves the small set of C entry points it
 * needs. The struct ABI below is re-declared to match c/include/json_structure
 * headers exactly, pinned to the same library version as this package. When the
 * loaded engine exports a runtime version symbol, its ABI major version is
 * checked for compatibility before use.
 *
 * SPDX-License-Identifier: MIT
 */

#include <R.h>
#include <Rinternals.h>

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Re-declared C library ABI (must match the c/include/json_structure headers) */
/* ------------------------------------------------------------------ */

typedef int js_error_code_t;   /* typedef int in types.h */

typedef enum {                 /* js_severity_t */
    JS_SEVERITY_ERROR = 0,
    JS_SEVERITY_WARNING = 1,
    JS_SEVERITY_INFO = 2
} js_severity_t;

typedef struct {               /* js_location_t */
    int line;
    int column;
    size_t offset;
} js_location_t;

typedef struct {               /* js_error_t */
    js_error_code_t code;
    js_severity_t severity;
    js_location_t location;
    char *path;
    char *message;
} js_error_t;

typedef struct {               /* js_result_t */
    bool valid;
    js_error_t *errors;
    size_t error_count;
    size_t error_capacity;
} js_result_t;

/* Only the size/layout of these matters; the C init functions fill them in. */
typedef struct {               /* js_schema_options_t */
    bool allow_import;
    bool warnings_enabled;
    const void *import_registry;
} js_schema_options_t;

typedef struct {               /* js_schema_validator_t */
    js_schema_options_t options;
} js_schema_validator_t;

typedef struct {               /* js_instance_options_t */
    bool allow_additional_properties;
    bool validate_formats;
    bool allow_import;
    const void *import_registry;
} js_instance_options_t;

typedef struct {               /* js_instance_validator_t */
    js_instance_options_t options;
} js_instance_validator_t;

/* Function pointer typedefs for the resolved entry points. */
typedef void (*js_init_fn)(void);
typedef void (*js_cleanup_fn)(void);
typedef void (*js_result_init_fn)(js_result_t *);
typedef void (*js_result_cleanup_fn)(js_result_t *);
typedef void (*js_schema_validator_init_fn)(js_schema_validator_t *);
typedef bool (*js_schema_validate_string_fn)(const js_schema_validator_t *,
                                             const char *, js_result_t *);
typedef void (*js_instance_validator_init_fn)(js_instance_validator_t *);
typedef bool (*js_instance_validate_strings_fn)(const js_instance_validator_t *,
                                                const char *, const char *,
                                                js_result_t *);

/*
 * Optional entry point exported by newer engines:
 *   const char *js_version_string(void);
 * When present, its ABI major version is checked against the version this
 * shim's struct layout was declared against. Absent in older builds.
 */
typedef const char *(*js_version_string_fn)(void);

/* Engine ABI major version this shim is compatible with (pinned release). */
#define JS_EXPECTED_ABI_MAJOR 0

/* ------------------------------------------------------------------ */
/* Platform dynamic loading abstraction                               */
/* ------------------------------------------------------------------ */

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOGDI
#define NOMINMAX
#include <windows.h>
typedef HMODULE lib_handle_t;
/*
 * The path arrives as UTF-8 (from Rf_translateCharUTF8). The ANSI
 * LoadLibraryExA would misinterpret non-ASCII bytes (e.g. accented user names
 * in the cache path), so convert to UTF-16 and use the wide entry point. The
 * R_alloc scratch buffer is released when the enclosing .Call returns.
 */
static lib_handle_t lib_open(const char *p) {
    int wlen = MultiByteToWideChar(CP_UTF8, 0, p, -1, NULL, 0);
    if (wlen <= 0) {
        return NULL;
    }
    wchar_t *wpath = (wchar_t *) R_alloc((size_t) wlen, sizeof(wchar_t));
    if (MultiByteToWideChar(CP_UTF8, 0, p, -1, wpath, wlen) <= 0) {
        return NULL;
    }
    /*
     * Restrict the dependency search to the system directories and the folder
     * containing the library itself, rather than the current working directory
     * or the full PATH, to avoid DLL pre-loading ("planting") hazards. These
     * flags require an absolute path and Windows 8+/KB2533623; if they are
     * rejected, fall back to the legacy altered-search-path behaviour.
     */
    HMODULE h = LoadLibraryExW(wpath, NULL,
                               LOAD_LIBRARY_SEARCH_DEFAULT_DIRS |
                               LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR);
    if (h == NULL) {
        h = LoadLibraryExW(wpath, NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
    }
    return h;
}
static void *lib_sym(lib_handle_t h, const char *n) {
    return (void *) GetProcAddress(h, n);
}
static void lib_close(lib_handle_t h) { if (h) FreeLibrary(h); }
static void last_error(char *buf, size_t n) {
    DWORD e = GetLastError();
    if (!FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                        NULL, e, 0, buf, (DWORD) n, NULL)) {
        snprintf(buf, n, "Windows error %lu", (unsigned long) e);
    }
}
#else
#include <dlfcn.h>
typedef void *lib_handle_t;
static lib_handle_t lib_open(const char *p) {
    /* RTLD_LOCAL keeps the engine's symbols out of the global namespace, so it
     * cannot collide with or be shadowed by symbols from other loaded objects. */
    return dlopen(p, RTLD_NOW | RTLD_LOCAL);
}
static void *lib_sym(lib_handle_t h, const char *n) { return dlsym(h, n); }
static void lib_close(lib_handle_t h) { if (h) dlclose(h); }
static void last_error(char *buf, size_t n) {
    const char *e = dlerror();
    snprintf(buf, n, "%s", e ? e : "unknown dynamic loader error");
}
#endif

/* ------------------------------------------------------------------ */
/* Resolved symbols and handle                                        */
/* ------------------------------------------------------------------ */

static lib_handle_t g_handle = NULL;
static js_init_fn g_init = NULL;
static js_cleanup_fn g_cleanup = NULL;
static js_result_init_fn g_result_init = NULL;
static js_result_cleanup_fn g_result_cleanup = NULL;
static js_schema_validator_init_fn g_schema_init = NULL;
static js_schema_validate_string_fn g_schema_validate = NULL;
static js_instance_validator_init_fn g_instance_init = NULL;
static js_instance_validate_strings_fn g_instance_validate = NULL;
static js_version_string_fn g_version_string = NULL;
static char g_lib_version[64] = {0};

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
/* .Call entry points                                                 */
/* ------------------------------------------------------------------ */

/* Returns "" on success, or an error message on failure. */
SEXP r_load_library(SEXP path_sexp) {
    const char *path = to_utf8(path_sexp, "library path");
    char errbuf[512];

    if (g_handle != NULL) {
        return Rf_mkString("");
    }

    lib_handle_t h = lib_open(path);
    if (h == NULL) {
        last_error(errbuf, sizeof errbuf);
        return Rf_mkString(errbuf);
    }

    g_result_init = (js_result_init_fn) lib_sym(h, "js_result_init");
    g_result_cleanup = (js_result_cleanup_fn) lib_sym(h, "js_result_cleanup");
    g_schema_init = (js_schema_validator_init_fn) lib_sym(h, "js_schema_validator_init");
    g_schema_validate = (js_schema_validate_string_fn) lib_sym(h, "js_schema_validate_string");
    g_instance_init = (js_instance_validator_init_fn) lib_sym(h, "js_instance_validator_init");
    g_instance_validate = (js_instance_validate_strings_fn) lib_sym(h, "js_instance_validate_strings");
    /* Optional lifecycle hooks. */
    g_init = (js_init_fn) lib_sym(h, "js_init");
    g_cleanup = (js_cleanup_fn) lib_sym(h, "js_cleanup");

    if (!g_result_init || !g_result_cleanup || !g_schema_init ||
        !g_schema_validate || !g_instance_init || !g_instance_validate) {
        lib_close(h);
        g_result_init = NULL; g_result_cleanup = NULL;
        g_schema_init = NULL; g_schema_validate = NULL;
        g_instance_init = NULL; g_instance_validate = NULL;
        g_init = NULL; g_cleanup = NULL;
        g_version_string = NULL; g_lib_version[0] = '\0';
        return Rf_mkString("json_structure library is missing required symbols");
    }

    /*
     * Optional runtime ABI/version check. Older engines do not export
     * js_version_string(); when present, refuse to use a library whose ABI
     * major version differs from the one this shim's struct layout matches.
     */
    g_version_string = (js_version_string_fn) lib_sym(h, "js_version_string");
    g_lib_version[0] = '\0';
    if (g_version_string != NULL) {
        const char *v = g_version_string();
        if (v != NULL) {
            snprintf(g_lib_version, sizeof g_lib_version, "%s", v);
            long major = strtol(v, NULL, 10);
            if (major != JS_EXPECTED_ABI_MAJOR) {
                lib_close(h);
                g_result_init = NULL; g_result_cleanup = NULL;
                g_schema_init = NULL; g_schema_validate = NULL;
                g_instance_init = NULL; g_instance_validate = NULL;
                g_init = NULL; g_cleanup = NULL;
                g_version_string = NULL; g_lib_version[0] = '\0';
                snprintf(errbuf, sizeof errbuf,
                         "json_structure ABI major version %ld is incompatible "
                         "with this package (expected %d)",
                         major, JS_EXPECTED_ABI_MAJOR);
                return Rf_mkString(errbuf);
            }
        }
    }

    if (g_init) g_init();
    g_handle = h;
    return Rf_mkString("");
}

SEXP r_unload_library(void) {
    if (g_handle != NULL) {
        if (g_cleanup) g_cleanup();
        lib_close(g_handle);
        g_handle = NULL;
    }
    g_version_string = NULL;
    g_lib_version[0] = '\0';
    return R_NilValue;
}

SEXP r_binding_loaded(void) {
    return Rf_ScalarLogical(g_handle != NULL);
}

/* Version string reported by the loaded engine, or "" if none / not loaded. */
SEXP r_binding_version(void) {
    return Rf_mkString(g_handle != NULL ? g_lib_version : "");
}

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
    g_result_cleanup((js_result_t *) data);
}
static SEXP marshal_result(js_result_t *res) {
    SEXP cont = PROTECT(R_MakeUnwindCont());
    SEXP out = R_UnwindProtect(marshal_body, res, marshal_cleanup, res, cont);
    UNPROTECT(1);
    return out;
}

SEXP r_validate_schema(SEXP schema_sexp) {
    if (g_handle == NULL) Rf_error("json_structure library is not loaded");
    const char *schema = dup_utf8(schema_sexp, "schema");

    js_schema_validator_t validator;
    memset(&validator, 0, sizeof validator);
    g_schema_init(&validator);

    js_result_t res;
    memset(&res, 0, sizeof res);
    g_result_init(&res);
    g_schema_validate(&validator, schema, &res);

    return marshal_result(&res);
}

SEXP r_validate_instance(SEXP instance_sexp, SEXP schema_sexp) {
    if (g_handle == NULL) Rf_error("json_structure library is not loaded");
    const char *instance = dup_utf8(instance_sexp, "instance");
    const char *schema = dup_utf8(schema_sexp, "schema");

    js_instance_validator_t validator;
    memset(&validator, 0, sizeof validator);
    g_instance_init(&validator);

    js_result_t res;
    memset(&res, 0, sizeof res);
    g_result_init(&res);
    g_instance_validate(&validator, instance, schema, &res);

    return marshal_result(&res);
}
