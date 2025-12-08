# jstruct - JSON Structure CLI

A command-line tool for validating JSON Structure schemas and instances.

## Installation

### From Cargo (Rust)

```bash
cargo install json-structure --features cli
```

### From Source

```bash
git clone https://github.com/json-structure/sdk.git
cd sdk/rust
cargo build --release --features cli
# Binary at: target/release/jstruct
```

### Pre-built Binaries

Download from [GitHub Releases](https://github.com/json-structure/sdk/releases):

| Platform | Architecture | File |
|----------|--------------|------|
| Linux | x86_64 | `jstruct-x86_64-unknown-linux-gnu.tar.gz` |
| Linux | ARM64 | `jstruct-aarch64-unknown-linux-gnu.tar.gz` |
| Windows | x86_64 | `jstruct-x86_64-pc-windows-msvc.zip` |
| Windows | ARM64 | `jstruct-aarch64-pc-windows-msvc.zip` |
| macOS | Intel | `jstruct-x86_64-apple-darwin.tar.gz` |
| macOS | Apple Silicon | `jstruct-aarch64-apple-darwin.tar.gz` |

### Package Managers

**Homebrew (macOS/Linux):**
```bash
brew tap json-structure/tap
brew install jstruct
```

**Chocolatey (Windows):**
```powershell
choco install jstruct
```

**Debian/Ubuntu:**
```bash
sudo dpkg -i jstruct_*.deb
```

**RHEL/Fedora:**
```bash
sudo rpm -i jstruct-*.rpm
```

### One-liner Installers

**Linux/macOS:**
```bash
curl -fsSL https://json-structure.org/install.sh | sh
```

**Windows PowerShell:**
```powershell
iwr -useb https://json-structure.org/install.ps1 | iex
```

## Commands

### `jstruct check` - Validate Schema(s)

Validate one or more JSON Structure schema files for correctness.

```bash
jstruct check [OPTIONS] <FILES>...
```

**Arguments:**
- `<FILES>...` - Schema file(s) to check. Use `-` for stdin.

**Options:**
- `-b, --bundle <FILE>` - Bundle file(s) containing schemas for `$import` resolution. Can be specified multiple times.
- `-f, --format <FORMAT>` - Output format: `text` (default), `json`, `tap`
- `-q, --quiet` - Suppress output, use exit code only
- `-v, --verbose` - Show detailed validation information

**Examples:**

```bash
# Check a single schema
jstruct check person.struct.json

# Check multiple schemas
jstruct check schemas/*.struct.json

# Check schema with external dependencies
jstruct check --bundle common-types.json --bundle address.json order.struct.json

# Read from stdin
cat schema.json | jstruct check -

# JSON output for CI integration
jstruct check --format json schema.json

# Quiet mode for scripts
jstruct check -q schema.json && echo "Valid"
```

### `jstruct validate` - Validate Instance(s)

Validate JSON instance files against a schema.

```bash
jstruct validate [OPTIONS] --schema <SCHEMA> <FILES>...
```

**Arguments:**
- `<FILES>...` - Instance file(s) to validate. Use `-` for stdin.

**Options:**
- `-s, --schema <SCHEMA>` - Schema file to validate against (required)
- `-b, --bundle <FILE>` - Bundle file(s) containing schemas for `$import` resolution in the schema. Can be specified multiple times.
- `-f, --format <FORMAT>` - Output format: `text` (default), `json`, `tap`
- `-q, --quiet` - Suppress output, use exit code only
- `-v, --verbose` - Show detailed validation information

**Examples:**

```bash
# Validate a single instance
jstruct validate --schema person.struct.json alice.json

# Validate multiple instances
jstruct validate -s schema.json data/*.json

# Validate with schema that uses $import
jstruct validate -s order.struct.json -b common-types.json -b address.json order.json

# Read instance from stdin
cat data.json | jstruct validate -s schema.json -

# JSON output
jstruct validate -s schema.json --format json data.json
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All files valid |
| `1` | One or more files invalid |
| `2` | Error (file not found, JSON parse error, etc.) |

## Output Formats

### Text (Default)

Human-readable output with symbols:

```
✓ person.struct.json: valid
✗ bad-schema.struct.json: invalid
  - /$id: Missing required property "$id"
  - /type: Unknown type "invalid_type"
```

### JSON

Machine-readable JSON array:

```json
[
  {
    "file": "person.struct.json",
    "valid": true,
    "errors": []
  },
  {
    "file": "bad-schema.struct.json",
    "valid": false,
    "errors": [
      {
        "path": "/$id",
        "code": "SCHEMA_MISSING_ID",
        "message": "Missing required property \"$id\""
      }
    ]
  }
]
```

### TAP (Test Anything Protocol)

Compatible with TAP consumers for CI/CD:

```tap
1..2
ok 1 - person.struct.json
not ok 2 - bad-schema.struct.json
  - /$id: Missing required property "$id"
  - /type: Unknown type "invalid_type"
```

## Schema Bundles for $import Resolution

JSON Structure schemas can use `$import` and `$importdefs` to reference definitions from
external schemas. When validating schemas that use these keywords, you need to provide
the referenced schemas as a bundle.

### How Bundles Work

1. Each bundle schema must have a `$id` property with a URI
2. When the main schema uses `$import: "https://example.com/types.json"`, the validator
   looks for a bundled schema with `$id: "https://example.com/types.json"`
3. If found, the definitions from the bundled schema are available for resolution

### Example

Given these files:

**common-types.json:**
```json
{
  "$schema": "https://json-structure.org/meta/core/v0/#",
  "$id": "https://example.com/common-types",
  "definitions": {
    "Address": {
      "type": "object",
      "properties": {
        "street": { "type": "string" },
        "city": { "type": "string" }
      }
    }
  }
}
```

**order.struct.json:**
```json
{
  "$schema": "https://json-structure.org/meta/core/v0/#",
  "$id": "https://example.com/order",
  "$import": "https://example.com/common-types",
  "type": "object",
  "properties": {
    "orderId": { "type": "string" },
    "shippingAddress": { "type": { "$ref": "#/definitions/Address" } }
  }
}
```

**Validate with bundle:**
```bash
jstruct check --bundle common-types.json order.struct.json
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Validate schemas
  run: |
    jstruct check --format tap schemas/*.struct.json
```

### GitLab CI

```yaml
validate:
  script:
    - jstruct check --format json schemas/ > schema-results.json
  artifacts:
    reports:
      dotenv: schema-results.json
```

### Pre-commit Hook

```bash
#!/bin/sh
# .git/hooks/pre-commit

SCHEMAS=$(git diff --cached --name-only --diff-filter=ACM | grep '\.struct\.json$')
if [ -n "$SCHEMAS" ]; then
    jstruct check $SCHEMAS || exit 1
fi
```

## Examples

### Validate All Schemas in a Directory

```bash
find . -name "*.struct.json" -exec jstruct check {} +
```

### Validate API Request/Response

```bash
# Validate request body
echo '{"name": "Alice", "age": 30}' | jstruct validate -s person.struct.json -

# Validate API response
curl -s https://api.example.com/person/1 | jstruct validate -s person.struct.json -
```

### Batch Validation with Summary

```bash
jstruct check --format json schemas/*.json | jq '.[] | select(.valid == false)'
```

### Watch Mode (with external tool)

```bash
# Using entr
ls schemas/*.json | entr -c jstruct check schemas/*.json
```

## Related

- [JSON Structure Specification](https://json-structure.org)
- [Rust SDK Documentation](./README.md)
- [SDK Guidelines](../SDK-GUIDELINES.md)

## License

MIT License - see [LICENSE](LICENSE) for details.
