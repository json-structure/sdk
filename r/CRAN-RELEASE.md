# Releasing `jsonstructure` to CRAN

A maintainer runbook for submitting the R SDK (`r/`) to
[CRAN](https://cran.r-project.org/). It captures the exact pre-submission
validation and submission steps, including a workaround for uploading to
win-builder from networks that block outbound FTP.

- **Package:** `jsonstructure`
- **Maintainer (`cre`):** Clemens Vasters `<clemensv@microsoft.com>`
  (derived from `Authors@R` in `DESCRIPTION`)
- **Submission comments:** `cran-comments.md`
- **Expected result:** `0 errors | 0 warnings | 1 note` (the note is only the
  unavoidable "New submission" plus two false-positive "possibly misspelled
  words", `schemas` and `validator`, both of which are correct domain terms).

The package compiles the JSON Structure C validation engine and cJSON from
bundled source; nothing is downloaded at install or run time. See the
"Notes on compiled code" section of `cran-comments.md` for the CRAN-compliance
details (bounded `snprintf`, no diagnostic-suppressing pragmas).

---

## 0. Toolchain

Run everything from the repository root unless noted otherwise.

- **R** >= 4.0 (releases are validated on the current R release and R-devel).
- **Windows:** [Rtools45](https://cran.r-project.org/bin/windows/Rtools/rtools45/rtools.html)
  matching the R version. Ensure R and Rtools are on `PATH`, e.g.:

  ```powershell
  $rtools = "$env:LOCALAPPDATA\..\rtools45"   # adjust to your install
  $env:PATH = "C:\Program Files\R\R-4.6.1\bin\x64;$rtools\usr\bin;$rtools\x86_64-w64-mingw32.static.posix\bin;$env:PATH"
  ```

- Optional but recommended: `install.packages(c("devtools", "rhub", "spelling", "urlchecker"))`.

---

## 1. Pre-submission checks (local)

Bump the version in `DESCRIPTION` if needed, update `NEWS.md`, then build and
check the source tarball exactly as CRAN will.

```powershell
# Build the source tarball (into a scratch dir to keep the repo clean).
R CMD build .\r

# Check it as CRAN does, with the incoming-feasibility checks enabled.
$env:_R_CHECK_CRAN_INCOMING_REMOTE_ = "TRUE"
R CMD check --as-cran jsonstructure_0.1.0.tar.gz
```

Confirm the tail of the log reads **`Status: 1 NOTE`** and that the note is only
the "New submission" / spelling items above. Any other NOTE, WARNING, or ERROR
must be resolved before continuing.

Useful extra checks (do not gate the release but catch issues early):

```r
spelling::spell_check_package(".")   # WORDLIST lives at r/inst/WORDLIST
urlchecker::url_check(".")
```

CI also runs the full R matrix, `lintr`, and the ASAN/UBSAN sanitizer job; the
shared C engine has its own conformance suite (including the circular
`$extends` tests). Make sure the branch is green before releasing.

---

## 2. win-builder (Windows R-devel + R-release)

CRAN expects a package to have been checked on Windows against both the current
release and the development version of R. Submit the **same tarball** from
step 1 to both queues. Results are emailed to the maintainer address in
`DESCRIPTION` after ~30 minutes, with a link to a temporary results directory.

### Preferred: `devtools`

```r
devtools::check_win_devel()     # R-devel
devtools::check_win_release()   # current R-release
```

### Manual FTP (if not using devtools)

```powershell
curl.exe -T jsonstructure_0.1.0.tar.gz ftp://win-builder.r-project.org/R-devel/
curl.exe -T jsonstructure_0.1.0.tar.gz ftp://win-builder.r-project.org/R-release/
```

### Fallback: HTTPS upload form (for FTP-blocked networks)

Both methods above use FTP, whose passive data ports are blocked on many
corporate networks (you will see `curl: (28) Failed to connect ... port <high>`).
win-builder also exposes an HTTPS upload form at
<https://win-builder.r-project.org/upload.aspx>. It is an ASP.NET WebForms page,
so the request must echo back the `__VIEWSTATE` / `__VIEWSTATEGENERATOR` /
`__EVENTVALIDATION` hidden fields from a fresh `GET`. Use `Button2`/`FileUpload2`
for R-devel and `Button1`/`FileUpload1` for R-release:

```powershell
$tarball = "jsonstructure_0.1.0.tar.gz"
curl.exe -sS -c cookies.txt "https://win-builder.r-project.org/upload.aspx" -o page.html
$html = Get-Content page.html -Raw
$null = $html -match 'name="__VIEWSTATE" id="__VIEWSTATE" value="([^"]*)"';                   $vs  = $matches[1]
$null = $html -match 'name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="([^"]*)"'; $vsg = $matches[1]
$null = $html -match 'name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="([^"]*)"';       $ev  = $matches[1]

# R-devel = Button2/FileUpload2 ; R-release = Button1/FileUpload1
curl.exe -sS -b cookies.txt `
  --form-string "__VIEWSTATE=$vs" `
  --form-string "__VIEWSTATEGENERATOR=$vsg" `
  --form-string "__EVENTVALIDATION=$ev" `
  --form-string "Button2=Upload File" `
  -F "FileUpload2=@$tarball;type=application/octet-stream" `
  "https://win-builder.r-project.org/upload.aspx" -o resp.html
```

A successful upload echoes the file name and byte size back in the response
(the `Label` span for that form). Repeat with `Button1`/`FileUpload1` for
R-release.

**Interpreting the result:** open the emailed results URL and read
`00check.log`. It should end in `Status: 1 NOTE` on both queues, matching the
local check.

---

## 3. Submit to CRAN (maintainer-only)

The final submission is interactive and can only be completed by the maintainer,
because CRAN sends a confirmation link to the maintainer email.

Either use `devtools::submit_cran()`, or the web form:

1. Go to <https://cran.r-project.org/submit.html>.
2. Enter the maintainer name and email (must match the `cre` in `DESCRIPTION`).
3. Upload the tarball from step 1
   (`cran-comments.md` is **not** part of the tarball — it is `.Rbuildignore`d).
4. Paste the contents of `cran-comments.md` into the optional comments field.
5. Submit, then click the confirmation link CRAN emails to the maintainer.

After submitting, CRAN runs its own incoming checks and a human reviewer may
follow up by email. First submissions are always manually reviewed.

---

## 4. After acceptance

- Tag the release and update `NEWS.md`.
- CRAN builds the binaries; the package appears at
  `https://CRAN.R-project.org/package=jsonstructure`.
- For subsequent releases, bump `Version` in `DESCRIPTION`, refresh
  `cran-comments.md` (the note will no longer say "New submission"), and repeat
  steps 1–3. Reverse-dependency checks are only needed once other packages
  depend on this one.
