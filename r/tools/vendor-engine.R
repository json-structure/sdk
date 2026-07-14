#!/usr/bin/env Rscript
# ---------------------------------------------------------------------------
# vendor-engine.R
#
# Refreshes the copy of the JSON Structure C engine that is vendored into this
# R package (r/src/) from the upstream C SDK sources (c/). The R package
# compiles the engine from these bundled sources at install time, so this
# script is the single point that keeps them in sync with c/.
#
# Run from anywhere inside the repository:
#
#     Rscript r/tools/vendor-engine.R
#
# WHAT IS SYNCED (copied verbatim from c/ -> r/src/):
#   * engine C sources          c/src/*.c           -> r/src/
#   * regex header              c/src/regex_utils.h -> r/src/
#   * public engine headers     c/include/json_structure/*.h -> r/src/json_structure/
#
# WHAT IS NOT SYNCED (R-specific, hand-maintained -- never overwritten here):
#   * r/src/shim.c        R .Call marshaling for the engine ABI
#   * r/src/init.c        R native-routine registration / engine init
#   * r/src/regex_utils.c pure-C ECMAScript-subset matcher used INSTEAD of the
#                         upstream c/src/regex_utils.cpp (std::regex), because
#                         MinGW std::regex deadlocks inside an R-loaded DLL on
#                         Windows. Keep this file; do not replace it with the
#                         C++ upstream.
#   * r/src/cJSON.c, r/src/cjson/cJSON.h
#                         cJSON is pinned at v1.7.18 (MIT, (c) Dave Gamble) and
#                         vendored directly from the cJSON project, not from c/.
#                         Update it deliberately, not through this script.
# ---------------------------------------------------------------------------

find_repo_root <- function() {
  # Walk up from this script's location until we find both c/ and r/.
  args <- commandArgs(trailingOnly = FALSE)
  file_arg <- sub("^--file=", "", args[grepl("^--file=", args)])
  start <- if (length(file_arg) == 1L && nzchar(file_arg)) {
    dirname(normalizePath(file_arg))
  } else {
    getwd()
  }
  dir <- start
  for (i in seq_len(8)) {
    if (dir.exists(file.path(dir, "c", "src")) &&
        dir.exists(file.path(dir, "r", "src"))) {
      return(dir)
    }
    parent <- dirname(dir)
    if (identical(parent, dir)) break
    dir <- parent
  }
  stop("could not locate the repository root (expected sibling c/ and r/ dirs)")
}

# Engine C translation units shared with the C SDK.
ENGINE_SOURCES <- c(
  "error_codes.c",
  "instance_validator.c",
  "json_source_locator.c",
  "schema_validator.c",
  "types.c"
)

# The regex ABI header is shared; the implementation (regex_utils.c) is not.
SHARED_SRC_HEADERS <- c(
  "regex_utils.h"
)

# Public engine headers (c/include/json_structure/ -> r/src/json_structure/).
ENGINE_HEADERS <- c(
  "error_codes.h",
  "export.h",
  "instance_validator.h",
  "json.h",
  "json_structure.h",
  "schema_validator.h",
  "types.h"
)

copy_one <- function(from, to) {
  if (!file.exists(from)) {
    stop(sprintf("missing upstream source: %s", from))
  }
  ok <- file.copy(from, to, overwrite = TRUE, copy.date = TRUE)
  if (!ok) stop(sprintf("failed to copy %s -> %s", from, to))
  invisible(TRUE)
}

main <- function() {
  root <- find_repo_root()
  c_src <- file.path(root, "c", "src")
  c_inc <- file.path(root, "c", "include", "json_structure")
  r_src <- file.path(root, "r", "src")
  r_inc <- file.path(r_src, "json_structure")

  dir.create(r_inc, showWarnings = FALSE, recursive = TRUE)

  n <- 0L
  for (f in c(ENGINE_SOURCES, SHARED_SRC_HEADERS)) {
    copy_one(file.path(c_src, f), file.path(r_src, f))
    message(sprintf("  synced  c/src/%-24s -> r/src/%s", f, f))
    n <- n + 1L
  }
  for (h in ENGINE_HEADERS) {
    copy_one(file.path(c_inc, h), file.path(r_inc, h))
    message(sprintf("  synced  c/include/json_structure/%-16s -> r/src/json_structure/%s", h, h))
    n <- n + 1L
  }

  message(sprintf("\nDone: %d file(s) synced from c/ into r/src/.", n))
  message("Left untouched (R-specific): shim.c, init.c, regex_utils.c, cJSON.c, cjson/cJSON.h")
  message("Reminder: r/src/regex_utils.c replaces the upstream C++ std::regex")
  message("implementation and must be kept in place for the Windows build.")
}

main()
