# Downloads and caches the prebuilt json_structure shared library from GitHub
# Releases. Mirrors ruby/lib/jsonstructure/binary_installer.rb.
#
# The package ships only a thin compiled shim; the actual validation engine is
# the prebuilt C library. It is NEVER downloaded implicitly during validation:
# the download happens only when the user explicitly calls
# install_jsonstructure_binary(), or, in an interactive session, agrees to the
# consent prompt raised on first use. Set JSONSTRUCTURE_LIB_PATH to point at a
# locally built library to skip the download entirely.

`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || identical(a, "")) b else a

# Normalise a CPU architecture string to the tokens used in release assets.
.js_normalize_arch <- function(arch = R.version$arch) {
  arch <- tolower(arch)
  if (grepl("aarch64|arm64", arch)) {
    "arm64"
  } else if (grepl("x86_64|x86-64|amd64|x64", arch)) {
    "x86_64"
  } else {
    arch
  }
}

# Operating system token used in release asset names.
.js_os_token <- function(sysname = Sys.info()[["sysname"]]) {
  switch(sysname,
    Windows = "windows",
    Darwin = "macos",
    Linux = "linux",
    tolower(sysname)
  )
}

# Platform token, e.g. "linux-x86_64", "macos-arm64", "windows-x86_64".
.js_platform <- function() {
  paste0(.js_os_token(), "-", .js_normalize_arch())
}

# File name of the shared library for this platform.
.js_binary_name <- function(sysname = Sys.info()[["sysname"]]) {
  switch(sysname,
    Windows = "json_structure.dll",
    Darwin = "libjson_structure.dylib",
    "libjson_structure.so"
  )
}

# Regex matching the shared-library files to copy out of the archive.
.js_lib_pattern <- function(sysname = Sys.info()[["sysname"]]) {
  switch(sysname,
    Windows = "\\.dll$",
    Darwin = "\\.dylib$",
    "\\.so$"
  )
}

# Per-user cache directory holding the downloaded library.
.js_lib_dir <- function(create = FALSE) {
  dir <- tools::R_user_dir("jsonstructure", which = "cache")
  if (create && !dir.exists(dir)) {
    dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  }
  dir
}

.js_cached_binary_path <- function() {
  file.path(.js_lib_dir(create = FALSE), .js_binary_name())
}

# URL of the release asset for this platform. Overridable for testing / mirrors.
.js_download_url <- function(version = JSONSTRUCTURE_BINARY_VERSION,
                             platform = .js_platform()) {
  full <- Sys.getenv("JSONSTRUCTURE_BINARY_URL", unset = "")
  if (nzchar(full)) {
    return(full)
  }
  base <- Sys.getenv(
    "JSONSTRUCTURE_BINARY_BASEURL",
    unset = sprintf("https://github.com/%s/releases/download", JSONSTRUCTURE_REPO)
  )
  sprintf("%s/%s/json_structure-%s.tar.gz", base, version, platform)
}

#' Path to the resolved json_structure library, if available
#'
#' Returns the path to the shared library that would be (or has been) loaded:
#' the `JSONSTRUCTURE_LIB_PATH` override if set, otherwise the cached download.
#'
#' @return A file path, or `NULL` if no library is available locally.
#' @seealso [install_jsonstructure_binary()]
#' @examples
#' jsonstructure_binary_path()
#' @export
jsonstructure_binary_path <- function() {
  override <- Sys.getenv("JSONSTRUCTURE_LIB_PATH", unset = "")
  if (nzchar(override) && file.exists(override)) {
    return(override)
  }
  cached <- .js_cached_binary_path()
  if (file.exists(cached)) cached else NULL
}

#' Download and cache the prebuilt json_structure library
#'
#' Downloads the prebuilt shared library for the current platform from the
#' project's GitHub Releases and caches it under
#' \code{tools::R_user_dir("jsonstructure", "cache")}. The library is never
#' downloaded implicitly by the validators; call this function explicitly to
#' install or update it (in an interactive session, the validators will offer
#' to call it on first use). Set the \code{JSONSTRUCTURE_LIB_PATH} environment
#' variable to point at a locally built library and skip downloading entirely.
#'
#' @param version Release tag to download (defaults to the pinned binary
#'   version).
#' @param force Re-download even if a cached copy exists.
#' @param quiet Suppress download progress and integrity messages.
#' @param sha256 Optional expected SHA-256 (hex) of the downloaded archive. When
#'   supplied (or when \code{JSONSTRUCTURE_BINARY_SHA256} is set, or a shipped
#'   checksum manifest matches), the download is verified before extraction and
#'   an error is raised on mismatch. When no expected digest is available the
#'   computed digest is reported so it can be pinned.
#' @return (Invisibly) the path to the cached shared library.
#' @seealso [jsonstructure_binary_path()], [jsonstructure_binary_version()]
#' @examples
#' \dontrun{
#' # Downloads the prebuilt engine for the current platform (network access):
#' install_jsonstructure_binary()
#' # Enforce integrity against a known digest:
#' install_jsonstructure_binary(sha256 = "e3b0c4...")
#' }
#' @export
install_jsonstructure_binary <- function(version = NULL, force = FALSE,
                                         quiet = FALSE, sha256 = NULL) {
  version <- version %||% JSONSTRUCTURE_BINARY_VERSION
  dir <- .js_lib_dir(create = TRUE)
  target <- .js_cached_binary_path()

  if (file.exists(target) && !force) {
    return(invisible(target))
  }

  url <- .js_download_url(version = version)
  tmp <- tempfile(fileext = if (grepl("\\.zip$", url)) ".zip" else ".tar.gz")
  on.exit(unlink(tmp, force = TRUE), add = TRUE)

  ok <- tryCatch({
    utils::download.file(url, destfile = tmp, mode = "wb", quiet = quiet)
    TRUE
  }, error = function(e) {
    stop(sprintf(
      "Failed to download the json_structure library from '%s': %s\nSet JSONSTRUCTURE_LIB_PATH to a locally built library to bypass the download.",
      url, conditionMessage(e)), call. = FALSE)
  })
  if (!isTRUE(ok) || !file.exists(tmp)) {
    stop(sprintf("Failed to download the json_structure library from '%s'.", url),
         call. = FALSE)
  }

  # Verify integrity before we extract and later load native code.
  .js_verify_download(tmp, url = url, version = version,
                      platform = .js_platform(), sha256 = sha256, quiet = quiet)

  exdir <- file.path(dir, "extract")
  unlink(exdir, recursive = TRUE, force = TRUE)
  dir.create(exdir, recursive = TRUE, showWarnings = FALSE)
  on.exit(unlink(exdir, recursive = TRUE, force = TRUE), add = TRUE)

  if (grepl("\\.zip$", url)) {
    utils::unzip(tmp, exdir = exdir)
  } else {
    utils::untar(tmp, exdir = exdir)
  }

  # The archive layout is not guaranteed to be flat (CMake install prefixes
  # place the library under lib/ or bin/), so search recursively. Prefer the
  # file whose name exactly matches this platform's expected library name and
  # only fall back to a pattern match, so unexpected archive contents cannot
  # silently substitute a differently named library.
  expected_name <- .js_binary_name()
  all_libs <- list.files(exdir, pattern = .js_lib_pattern(), recursive = TRUE,
                         full.names = TRUE)
  libs <- all_libs[basename(all_libs) == expected_name]
  if (length(libs) == 0) {
    libs <- all_libs
  }
  for (f in libs) {
    file.copy(f, file.path(dir, basename(f)), overwrite = TRUE)
  }

  if (!file.exists(target)) {
    stop(sprintf(
      "Downloaded archive from '%s' did not contain the expected library '%s'.",
      url, expected_name), call. = FALSE)
  }

  invisible(target)
}

# --- Integrity verification ------------------------------------------------

# Compute the SHA-256 (lowercase hex) of a file, using whatever hashing
# facility is available: base tools (R >= 4.5), then the openssl or digest
# packages. Returns NA_character_ if none is available.
.js_sha256 <- function(file) {
  tools_ns <- asNamespace("tools")
  if (exists("sha256sum", where = tools_ns, inherits = FALSE)) {
    return(tolower(unname(get("sha256sum", tools_ns)(file))))
  }
  if (requireNamespace("openssl", quietly = TRUE)) {
    con <- file(file, "rb")
    on.exit(close(con), add = TRUE)
    # paste(collapse=) strips the openssl "hash" class and guarantees a plain,
    # single lowercase hex string regardless of the openssl version in use.
    return(tolower(paste(as.character(openssl::sha256(con)), collapse = "")))
  }
  if (requireNamespace("digest", quietly = TRUE)) {
    return(tolower(digest::digest(file, algo = "sha256", file = TRUE)))
  }
  NA_character_
}

# Expected checksum shipped with the package, if any. Looks up a DCF manifest
# (inst/checksums.dcf) keyed by Version + Platform. Returns "" when no manifest
# or matching entry exists.
.js_manifest_sha256 <- function(version, platform) {
  path <- system.file("checksums.dcf", package = "jsonstructure")
  if (!nzchar(path) || !file.exists(path)) {
    return("")
  }
  recs <- tryCatch(read.dcf(path), error = function(e) NULL)
  if (is.null(recs) || !all(c("Version", "Platform", "SHA256") %in% colnames(recs))) {
    return("")
  }
  hit <- recs[, "Version"] == version & recs[, "Platform"] == platform
  if (any(hit)) tolower(recs[which(hit)[1], "SHA256"]) else ""
}

# Verify a downloaded archive against an expected SHA-256. Resolution order for
# the expected digest: explicit `sha256` arg -> JSONSTRUCTURE_BINARY_SHA256 ->
# shipped manifest. Aborts on mismatch; warns (but proceeds) when no digest is
# available to verify against.
.js_verify_download <- function(file, url, version, platform, sha256 = NULL,
                                quiet = FALSE) {
  expected <- sha256 %||% Sys.getenv("JSONSTRUCTURE_BINARY_SHA256", unset = "")
  if (!nzchar(expected)) {
    expected <- .js_manifest_sha256(version, platform)
  }
  actual <- .js_sha256(file)

  if (is.na(actual)) {
    warning("Could not compute a SHA-256 of the downloaded archive (no hashing ",
            "facility available); integrity was not verified. Install the ",
            "'openssl' package to enable verification.", call. = FALSE)
    return(invisible(NA_character_))
  }

  if (nzchar(expected)) {
    if (!isTRUE(tolower(expected) == actual)) {
      stop(sprintf(
        "Checksum mismatch for '%s':\n  expected %s\n  actual   %s\nThe download may be corrupt or tampered with; aborting.",
        url, tolower(expected), actual), call. = FALSE)
    }
    if (!quiet) {
      message(sprintf("Verified SHA-256 of %s.", basename(url)))
    }
  } else if (!quiet) {
    message(sprintf(
      "Downloaded %s\n  SHA-256: %s\n  No expected checksum was available to verify against; pass sha256= or set JSONSTRUCTURE_BINARY_SHA256 to enforce integrity.",
      basename(url), actual))
  }
  invisible(actual)
}

# Resolve the library path with explicit user consent. Called only when no
# library is available via JSONSTRUCTURE_LIB_PATH or the cache. In an
# interactive session the user is asked before any download; otherwise a clear,
# actionable error is raised (no implicit network access).
.js_prompt_and_install <- function() {
  detail <- paste0(
    "The json_structure native library is not installed. It can be downloaded ",
    "from GitHub Releases into the per-user cache (",
    .js_lib_dir(create = FALSE), "), or you can set the JSONSTRUCTURE_LIB_PATH ",
    "environment variable to a locally built library.")

  if (!interactive()) {
    stop(detail,
         "\nRun install_jsonstructure_binary() to download it, or set ",
         "JSONSTRUCTURE_LIB_PATH.", call. = FALSE)
  }

  consent <- utils::askYesNo(
    paste0(detail, "\nDownload it now?"), default = FALSE)
  if (!isTRUE(consent)) {
    stop("json_structure library not available and download was declined. ",
         "Run install_jsonstructure_binary() or set JSONSTRUCTURE_LIB_PATH.",
         call. = FALSE)
  }

  install_jsonstructure_binary()
  path <- jsonstructure_binary_path()
  if (is.null(path)) {
    stop("Installation did not produce a usable json_structure library.",
         call. = FALSE)
  }
  path
}
