/*
 * regex_asan.c - AddressSanitizer / UndefinedBehaviorSanitizer harness for the
 * hand-written pure-C ECMAScript-subset matcher in src/regex_utils.c.
 *
 * This is a CI/maintenance tool: it is excluded from the package tarball via
 * .Rbuildignore (^tools$) and is compiled with clang -fsanitize=address,
 * undefined in the R workflow to prove the matcher is memory-safe and free of
 * undefined behaviour across valid patterns, invalid patterns, adversarial
 * (ReDoS) patterns, boundary inputs and cache eviction.
 *
 * Exit status: 0 = all good; non-zero = a functional assertion failed. Any
 * sanitizer diagnostic aborts the process with a non-zero status regardless.
 */
#include "regex_utils.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

/* Assert an expected match verdict; keeps going so we report every mismatch. */
static void expect_match(const char *pattern, const char *text, bool want) {
    bool got = js_regex_match(pattern, text);
    if (got != want) {
        fprintf(stderr, "MATCH MISMATCH pattern=<%s> text=<%s> want=%d got=%d\n",
                pattern, text, (int)want, (int)got);
        failures++;
    }
}

static void expect_valid(const char *pattern, bool want) {
    bool got = js_regex_is_valid(pattern);
    if (got != want) {
        fprintf(stderr, "VALID MISMATCH pattern=<%s> want=%d got=%d\n",
                pattern, (int)want, (int)got);
        failures++;
    }
}

/* Patterns that must be accepted (inside the supported subset). */
static const char *const kValidPatterns[] = {
    "",
    "abc",
    ".",
    "^abc$",
    "a*",
    "a+",
    "a?",
    "a{3}",
    "a{2,}",
    "a{2,5}",
    "a*?",
    "a+?",
    "a{2,5}?",
    "[abc]",
    "[^abc]",
    "[a-z]",
    "[A-Za-z0-9_]",
    "[a-z-]",
    "[-a-z]",
    "\\d+",
    "\\D+",
    "\\w+",
    "\\W+",
    "\\s+",
    "\\S+",
    "\\bword\\b",
    "\\Bword",
    "(abc)",
    "(?:abc)",
    "(a|b|c)",
    "(foo|bar)+",
    "^[A-Z][a-z]+$",
    "^[A-Z]",
    "^[a-z]+$",
    "^\\d{4}-\\d{2}-\\d{2}$",
    "colou?r",
    "\\x41\\x42",
    "\\u00e9",
    "a\\.b",
    "[\\d.]+",
    "^(a+)+$",     /* classic ReDoS - must compile, must not hang */
    "(x+x+)+y",    /* another catastrophic-backtracking shape */
    ".*",
    ".+",
    "\\n\\r\\t",
    "a{",          /* ECMAScript: `{` not forming a quantifier is a literal */
};

/* Patterns that must be rejected (outside the supported subset / malformed). */
static const char *const kInvalidPatterns[] = {
    "(?<=foo)",       /* lookbehind */
    "(?<name>x)",     /* named group */
    "(?=foo)",        /* lookahead */
    "(?!foo)",        /* negative lookahead */
    "(?i)abc",        /* inline flags */
    "(?m)^x",
    "(?s).",
    "\\p{L}",         /* unicode property */
    "\\P{L}",
    "[invalid",       /* unterminated class */
    "(unclosed",      /* unmatched paren */
    "a)b",            /* stray close paren */
    "a\\",            /* dangling escape */
    "a**",            /* stacked quantifier */
    "*abc",           /* nothing to repeat */
    "[z-a]",          /* reversed range */
};

/* A spread of input texts, incl. empty, control chars and high bytes. */
static const char *const kTexts[] = {
    "",
    "a",
    "abc",
    "Hello",
    "hello",
    "HELLO",
    "Hello World",
    "2024-01-31",
    "not-a-date",
    "\t\n\r ",
    "\x41\x42",
    "caf\xc3\xa9",             /* UTF-8 e-acute bytes */
    "the quick brown fox",
    "aaaaaaaaaaaaaaaaaaaa",
    "aaaaaaaaaaaaaaaaaaab",
    "!@#$%^&*()_+-=[]{}|;':\",./<>?",
};

static void run_matrix(void) {
    size_t np = sizeof(kValidPatterns) / sizeof(kValidPatterns[0]);
    size_t ni = sizeof(kInvalidPatterns) / sizeof(kInvalidPatterns[0]);
    size_t nt = sizeof(kTexts) / sizeof(kTexts[0]);

    for (size_t p = 0; p < np; ++p) {
        expect_valid(kValidPatterns[p], true);
        for (size_t t = 0; t < nt; ++t) {
            /* Verdict not asserted here; we only require memory-safety. */
            (void)js_regex_match(kValidPatterns[p], kTexts[t]);
        }
    }

    for (size_t p = 0; p < ni; ++p) {
        expect_valid(kInvalidPatterns[p], false);
        for (size_t t = 0; t < nt; ++t) {
            /* Matching an invalid pattern must be safe and never true. */
            if (js_regex_match(kInvalidPatterns[p], kTexts[t])) {
                fprintf(stderr, "invalid pattern <%s> unexpectedly matched <%s>\n",
                        kInvalidPatterns[p], kTexts[t]);
                failures++;
            }
        }
    }
}

/* A handful of exact-verdict checks that mirror what the R corpus relies on. */
static void run_semantics(void) {
    expect_match("^[A-Z][a-z]+$", "Hello", true);
    expect_match("^[A-Z][a-z]+$", "hello", false);   /* must be rejected */
    expect_match("^[A-Z][a-z]+$", "HELLO", false);
    expect_match("^[a-z]+$", "hello", true);
    expect_match("^[A-Z]", "Hello", true);
    expect_match("^[A-Z]", "hello", false);
    expect_match("\\d+", "abc123", true);             /* search semantics */
    expect_match("^\\d+$", "abc123", false);
    expect_match("colou?r", "color", true);
    expect_match("colou?r", "colour", true);
    expect_match("(foo|bar)+", "foobarfoo", true);
    expect_match("a{2,3}", "a", false);
    expect_match("a{2,3}", "aa", true);
}

/* ReDoS guard: pathological patterns against long non-matching input must
 * return (bounded by the step budget) without crashing or hanging. */
static void run_redos(void) {
    char buf[64];
    memset(buf, 'a', sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';
    buf[sizeof(buf) - 2] = '!';           /* force a non-match at the end */
    (void)js_regex_match("^(a+)+$", buf);
    (void)js_regex_match("(x+x+)+y", "xxxxxxxxxxxxxxxxxxxxxxxx!");
}

/* Long input to catch buffer-boundary issues in the VM. */
static void run_long_input(void) {
    size_t n = 100000;
    char *big = (char *)malloc(n + 1);
    if (!big) return;
    memset(big, 'a', n);
    big[n] = '\0';
    (void)js_regex_match("a+", big);
    (void)js_regex_match("^a+$", big);
    (void)js_regex_match("z", big);
    (void)js_regex_match("[a-z]{10,20}", big);
    free(big);
}

/* Exercise the compile cache past its capacity to hit LRU eviction paths. */
static void run_cache_churn(void) {
    char pat[32];
    for (int i = 0; i < 200; ++i) {
        snprintf(pat, sizeof(pat), "pat%d[a-z]*%d", i, i % 7);
        (void)js_regex_is_valid(pat);
        (void)js_regex_match(pat, "pat123abc4");
    }
}

int main(void) {
    run_matrix();
    run_semantics();
    run_redos();
    run_long_input();
    run_cache_churn();

    /* Free all cached compiled programs so LeakSanitizer sees a clean exit. */
    js_regex_cache_clear();

    if (failures) {
        fprintf(stderr, "regex_asan: %d functional assertion(s) failed\n", failures);
        return 1;
    }
    printf("regex_asan: OK (no sanitizer errors, all assertions passed)\n");
    return 0;
}
