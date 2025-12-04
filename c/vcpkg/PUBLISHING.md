# Publishing json-structure to vcpkg

This directory contains the vcpkg port files for the JSON Structure C/C++ SDK.

## Files

- `vcpkg.json` - Port manifest with package metadata and dependencies
- `portfile.cmake` - Build instructions for vcpkg
- `usage` - Usage instructions displayed after installation

## Submitting to the vcpkg Registry

### Prerequisites

1. Fork the [vcpkg repository](https://github.com/Microsoft/vcpkg)
2. Clone your fork locally
3. Ensure you have a tagged release (e.g., `v0.1.0`)

### Steps

1. **Create a topic branch in your vcpkg fork:**

   ```bash
   cd /path/to/vcpkg
   git checkout -b add-json-structure
   ```

2. **Copy the port files to vcpkg:**

   ```bash
   mkdir -p ports/json-structure
   cp /path/to/sdk/c/vcpkg/* ports/json-structure/
   ```

3. **Calculate the SHA512 hash for the release tarball:**

   ```bash
   # Get the hash for the tagged release
   vcpkg hash https://github.com/json-structure/sdk/archive/refs/tags/v0.1.0.tar.gz
   ```

4. **Update `portfile.cmake` with the correct SHA512:**

   Replace `SHA512 0` with the actual hash from step 3.

5. **Test the port locally:**

   ```bash
   # From vcpkg root
   ./vcpkg install json-structure
   
   # With regex feature
   ./vcpkg install json-structure[regex]
   ```

6. **Add version information:**

   ```bash
   vcpkg x-add-version json-structure
   git add versions/ ports/json-structure/
   git commit -m "Add json-structure port"
   ```

7. **Push and create a pull request:**

   ```bash
   git push origin add-json-structure
   ```

   Then create a PR from your fork to `microsoft/vcpkg`.

## Using as an Overlay Port

Before the package is accepted into vcpkg, you can use it as an overlay port:

```bash
# Clone the SDK
git clone https://github.com/json-structure/sdk.git

# Use as overlay
vcpkg install json-structure --overlay-ports=/path/to/sdk/c/vcpkg
```

Or in your `vcpkg.json`:

```json
{
  "dependencies": ["json-structure"]
}
```

With `vcpkg-configuration.json`:

```json
{
  "overlay-ports": ["./path/to/sdk/c/vcpkg"]
}
```

## Version Updates

When releasing a new version:

1. Update `version` in `vcpkg.json`
2. Create a git tag (e.g., `v0.2.0`)
3. Calculate new SHA512 hash
4. Update `portfile.cmake` with new SHA512
5. Run `vcpkg x-add-version --overwrite-version json-structure`
6. Submit PR to vcpkg
