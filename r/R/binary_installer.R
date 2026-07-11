# Downloads and caches the prebuilt json_structure shared library from GitHub
# Releases. Mirrors ruby/lib/jsonstructure/binary_installer.rb.
#
# The package ships only a thin compiled shim; the actual validation engine is
# the prebuilt C library, resolved at first use. Set JSONSTRUCTURE_LIB_PATH to
# point at a locally built library and skip the download entirely.

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
#' \code{tools::R_user_dir("jsonstructure", "cache")}. This is normally called
#' automatically on first validation; call it explicitly to pre-fetch or to
#' force a re-download.
#'
#' @param version Release tag to download (defaults to the pinned binary
#'   version).
#' @param force Re-download even if a cached copy exists.
#' @param quiet Suppress download progress output.
#' @return (Invisibly) the path to the cached shared library.
#' @export
install_jsonstructure_binary <- function(version = NULL, force = FALSE,
                                         quiet = FALSE) {
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
  # place the library under lib/ or bin/), so search recursively and copy every
  # matching shared-library file into the cache directory.
  libs <- list.files(exdir, pattern = .js_lib_pattern(), recursive = TRUE,
                     full.names = TRUE)
  for (f in libs) {
    file.copy(f, file.path(dir, basename(f)), overwrite = TRUE)
  }

  if (!file.exists(target)) {
    stop(sprintf(
      "Downloaded archive from '%s' did not contain '%s'.",
      url, .js_binary_name()), call. = FALSE)
  }

  invisible(target)
}

# Resolve the library path, downloading if necessary. Used by .js_ensure_loaded.
.js_ensure_binary <- function(quiet = FALSE) {
  override <- Sys.getenv("JSONSTRUCTURE_LIB_PATH", unset = "")
  if (nzchar(override)) {
    if (!file.exists(override)) {
      stop(sprintf("JSONSTRUCTURE_LIB_PATH is set to '%s' but that file does not exist.",
                   override), call. = FALSE)
    }
    return(override)
  }

  cached <- .js_cached_binary_path()
  if (file.exists(cached)) {
    return(cached)
  }

  install_jsonstructure_binary(quiet = quiet)
  cached
}
