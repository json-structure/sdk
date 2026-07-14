## R CMD check results

0 errors | 0 warnings | 2 notes

* This is a new submission.

* checking pragmas in C/C++ headers and code ... NOTE
  File which contains pragma(s) suppressing diagnostics: 'src/cJSON.c'

  `src/cJSON.c` is the unmodified, vendored cJSON library (v1.7.18, MIT,
  © Dave Gamble and cJSON contributors). It contains a
  `#pragma GCC diagnostic ignored "-Wcast-qual"` in its upstream source. The
  file is bundled verbatim so that the package's native engine has no external
  dependency; the pragma only takes effect under `-Wcast-qual`, which is not part
  of the default R compilation flags. Authorship and copyright are recorded in
  `DESCRIPTION` and `inst/COPYRIGHTS`.

## Test environments

* Windows 11 x86_64, R 4.6.1 (local), gcc 14.3.0 (Rtools45)
* GitHub Actions: ubuntu-latest, macos-latest, windows-latest; R release and
  oldrel-1

## Notes on compiled code

The package bundles and compiles from source the JSON Structure validation
engine (portable C99) together with cJSON. Nothing is downloaded at install or
run time. The package is pure C and links only with the C runtime; `pattern`
keyword matching is provided by a small embedded regular-expression engine, so
there is no `std::regex`/C++ dependency and behaviour is identical on every
platform.
