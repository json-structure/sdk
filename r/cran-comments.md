## R CMD check results

0 errors | 0 warnings | 1 note

* This is a new submission.
* The note also lists two "possibly misspelled words" in DESCRIPTION,
  'schemas' and 'validator'. Both are spelled correctly and are standard
  terms in this domain: a *validator* checks data against *schemas*.

## Test environments

* Windows 11 x86_64, R 4.6.1 (local), gcc 14.3.0 (Rtools45)
* win-builder: R-devel and R-release (Status: 1 NOTE, new submission only)
* GitHub Actions: ubuntu-latest, macos-latest, windows-latest; R release and
  oldrel-1

## Notes on compiled code

The package bundles and compiles from source the JSON Structure validation
engine (portable C99) together with cJSON. Nothing is downloaded at install or
run time. The package is pure C and links only with the C runtime; `pattern`
keyword matching is provided by a small embedded regular-expression engine, so
there is no `std::regex`/C++ dependency and behaviour is identical on every
platform.

The bundled cJSON (v1.7.18, MIT) is used unmodified except for two changes made
for CRAN compliance: its `sprintf()` calls are replaced by bounded `snprintf()`
(no `sprintf` entry point in compiled code), and the upstream
`#pragma GCC diagnostic ignored "-Wcast-qual"` around an internal helper is
removed (no diagnostic-suppressing pragmas). Both changes are recorded in
`inst/COPYRIGHTS`.
