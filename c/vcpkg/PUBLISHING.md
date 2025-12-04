# Publishing json-structure to vcpkg

This directory contains the vcpkg port files for the JSON Structure C/C++ SDK.

## Files

- `vcpkg.json` - Port manifest with package metadata and dependencies
- `portfile.cmake` - Build instructions for vcpkg
- `usage` - Usage instructions displayed after installation

## Submitting to the vcpkg Registry

### Prerequisites

1. [vcpkg installed and bootstrapped](https://learn.microsoft.com/en-us/vcpkg/get_started/get-started-packaging#1---set-up-vcpkg)
2. Fork the [vcpkg repository](https://github.com/Microsoft/vcpkg)
3. A tagged release in the SDK repo (e.g., `v0.1.0`)

### Steps

1. **Clone your vcpkg fork and add it as a remote:**

   ```powershell
   git clone https://github.com/microsoft/vcpkg.git
   cd vcpkg
   .\bootstrap-vcpkg.bat
   git remote add myfork https://github.com/<Your-GitHub-Username>/vcpkg.git
   ```

2. **Create a topic branch:**

   ```powershell
   git checkout -b add-json-structure
   ```

3. **Copy the port files to vcpkg:**

   ```powershell
   Copy-Item -Path <path/to/sdk/c/vcpkg>/* -Destination ports/json-structure -Recurse
   ```

4. **Get the correct SHA512 hash (run install to get the hash error):**

   ```powershell
   vcpkg install json-structure
   ```

   The command will fail and show the actual SHA512. Copy that value and update `portfile.cmake`.

5. **Verify the port builds correctly:**

   ```powershell
   vcpkg install json-structure
   
   # With regex feature
   vcpkg install json-structure[regex]
   ```

6. **Commit the port and add version information:**

   ```powershell
   git add ports/json-structure
   git commit -m "[json-structure] Add new port"
   
   vcpkg x-add-version json-structure
   
   git add versions/
   git commit --amend --no-edit
   ```

7. **Push and create a pull request:**

   ```powershell
   git push myfork add-json-structure
   ```

   Then navigate to your fork on GitHub and create a Pull Request to `microsoft/vcpkg`.

### Version Updates

When releasing a new version:

1. Update `version` in `vcpkg.json`
2. Update `SHA512` in `portfile.cmake` (or set to 0 and run install to get it)
3. Copy updated files to `vcpkg/ports/json-structure`
4. Run `vcpkg x-add-version json-structure --overwrite-version`
5. Commit and submit PR to microsoft/vcpkg

## Automation

The workflow `.github/workflows/vcpkg.yml` automatically updates the port files when a new version tag is pushed. It:

1. Extracts the version from the git tag
2. Downloads the release tarball and calculates its SHA512
3. Updates `vcpkg.json` and `portfile.cmake`
4. Commits the changes back to the repository

### Enabling Automated PRs to microsoft/vcpkg

The workflow contains a commented-out job that can automatically create PRs to the official vcpkg registry. To enable it:

1. Create a GitHub Personal Access Token (PAT) with `repo` scope
2. Add it as a repository secret named `VCPKG_PAT` in the SDK repo settings
3. Uncomment the `create-vcpkg-pr` job in `.github/workflows/vcpkg.yml`

Once enabled, pushing a version tag will automatically:
- Update the local port files
- Fork/update the vcpkg repository
- Create a PR to `microsoft/vcpkg`

## Using as an Overlay Port

Before the package is available in the vcpkg registry, or to use the latest development version, you can use this directory as an overlay port:

```powershell
# Clone the SDK repo (or use existing checkout)
git clone https://github.com/json-structure/sdk.git

# Install using overlay port
vcpkg install json-structure --overlay-ports=<path/to/sdk/c/vcpkg>

# With regex feature
vcpkg install json-structure[regex] --overlay-ports=<path/to/sdk/c/vcpkg>
```

This allows immediate use without waiting for the official registry to accept the PR.

## Resources

- [vcpkg Packaging Tutorial](https://learn.microsoft.com/en-us/vcpkg/get_started/get-started-packaging)
- [Adding Ports to the Registry](https://learn.microsoft.com/en-us/vcpkg/get_started/get-started-adding-to-registry)
- [vcpkg Maintainer Guide](https://github.com/microsoft/vcpkg/blob/master/docs/maintainers/maintainer-guide.md)
- [vcpkg Port Review Checklist](https://github.com/microsoft/vcpkg/blob/master/docs/maintainers/pr-review-checklist.md)
