# JSON::Structure Perl SDK

A native Perl implementation of the JSON Structure schema validation system.

## Overview

JSON::Structure is a Perl SDK for validating JSON documents against JSON Structure schemas. It provides:

- **Schema Validation**: Validate that a JSON Structure schema is well-formed
- **Instance Validation**: Validate JSON data against a JSON Structure schema
- **Source Location Tracking**: Get line and column numbers for validation errors
- **Comprehensive Error Codes**: Standardized error codes matching other SDK implementations

## Requirements

- Perl 5.20 or later
- JSON::PP (included in Perl core since 5.14)
- MIME::Base64 (included in Perl core)
- Scalar::Util (included in Perl core)

## Installation

### From CPAN (when available)

```bash
cpanm JSON::Structure
```

### From Source

```bash
git clone https://github.com/json-structure/sdk.git
cd sdk/perl
perl Makefile.PL
make
make test
make install
```

### Using cpanm with dependencies

```bash
cd sdk/perl
cpanm --installdeps .
perl Makefile.PL
make test
```

## Command-Line Interface

The SDK includes `pjstruct`, a command-line tool for schema and instance validation.

### Usage

```bash
# Check if a schema is valid
pjstruct check schema.struct.json

# Validate an instance against a schema
pjstruct validate -s schema.struct.json data.json

# Validate multiple files
pjstruct validate -s schema.struct.json *.json

# Output in JSON format
pjstruct validate -s schema.struct.json data.json --format=json

# Output in TAP format (for test harnesses)
pjstruct check *.struct.json --format=tap

# Quiet mode (exit code only)
pjstruct validate -s schema.struct.json data.json -q
```

### Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `check` | `c` | Validate schema file(s) against the meta-schema |
| `validate` | `v` | Validate instance file(s) against a schema |
| `help` | | Show help for a command |
| `version` | | Show version information |

### Options

| Option | Short | Description |
|--------|-------|-------------|
| `--schema` | `-s` | Schema file (required for `validate`) |
| `--format` | `-f` | Output format: `text`, `json`, `tap` (default: `text`) |
| `--quiet` | `-q` | Suppress output, use exit code only |
| `--verbose` | `-v` | Show detailed validation information |
| `--help` | `-h` | Show help |
| `--version` | `-V` | Show version |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All files are valid |
| 1 | One or more files failed validation |
| 2 | Error (file not found, parse error, missing options) |

## Quick Start

### Schema Validation

```perl
use JSON::Structure::SchemaValidator;
use JSON::PP;

# Create a validator
my $validator = JSON::Structure::SchemaValidator->new();

# Parse your schema
my $schema_text = '{"type": "string"}';
my $schema = decode_json($schema_text);

# Validate the schema
my $result = $validator->validate($schema, $schema_text);

if ($result->is_valid) {
    print "Schema is valid!\n";
} else {
    for my $error (@{$result->errors}) {
        printf "Error at %s: %s (code: %s)\n",
            $error->path,
            $error->message,
            $error->code;
    }
}
```

### Instance Validation

```perl
use JSON::Structure::InstanceValidator;
use JSON::PP;

# Define your schema
my $schema = {
    '$schema' => 'https://json-structure.org/meta/core/v0/#',
    '$id'     => 'https://example.com/person.struct.json',
    name      => 'Person',
    type      => 'object',
    properties => {
        name  => { type => 'string' },
        age   => { type => 'int32' },
        email => { type => 'string' }
    },
    required => ['name', 'age']
};

# Your data to validate
my $instance = {
    name => 'John Doe',
    age  => 30,
    email => 'john@example.com'
};

# Validate
my $validator = JSON::Structure::InstanceValidator->new(schema => $schema);
my $result = $validator->validate($instance);

if ($result->is_valid) {
    print "Instance is valid!\n";
} else {
    for my $error (@{$result->errors}) {
        print "Validation error: " . $error->message . "\n";
    }
}
```

## Supported Types

### Primitive Types

| Type | Perl Validation |
|------|-----------------|
| `string` | String value |
| `boolean` | JSON true/false (JSON::PP::Boolean) |
| `int8`, `int16`, `int32`, `int64` | Integer within range |
| `uint8`, `uint16`, `uint32`, `uint64` | Unsigned integer within range |
| `float32`, `float64` | Numeric value |
| `bytes` | Base64-encoded string |
| `null` | undef or JSON null |

### Compound Types

| Type | Description |
|------|-------------|
| `object` | Object with defined properties |
| `array` | Homogeneous array of items |
| `set` | Array with unique items |
| `map` | Object as string-keyed dictionary |
| `tuple` | Fixed-length typed array |
| `choice` | Discriminated union |
| `any` | Any JSON value |

### String Formats

The SDK validates these string formats:
- `date-time`, `date`, `time`, `duration`
- `email`, `uri`, `uri-reference`, `uuid`
- `ipv4`, `ipv6`, `hostname`
- `json-pointer`, `regex`

## API Reference

### JSON::Structure::SchemaValidator

```perl
my $validator = JSON::Structure::SchemaValidator->new();
my $result = $validator->validate($schema_doc, $source_text);
```

- `new()`: Create a new schema validator
- `validate($schema, $source_text)`: Validate a schema document
  - `$schema`: Parsed JSON structure (hashref)
  - `$source_text`: Original JSON text (optional, for location tracking)
  - Returns: `ValidationResult` object

### JSON::Structure::InstanceValidator

```perl
my $validator = JSON::Structure::InstanceValidator->new(
    schema   => $schema,
    extended => 1,  # Enable extended validation
);
my $result = $validator->validate($instance, $source_text);
```

- `new(%options)`: Create a new instance validator
  - `schema`: The JSON Structure schema to validate against (required)
  - `extended`: Enable extended validation features (minLength, pattern, etc.)
  - `allow_import`: Enable processing of $import/$importdefs
  - `max_validation_depth`: Maximum recursion depth (default: 64)
- `validate($instance, $source_text)`: Validate an instance against the schema
  - `$instance`: Parsed JSON data to validate
  - `$source_text`: Original JSON text (optional, for location tracking)
  - Returns: `ValidationResult` object

### JSON::Structure::Types

```perl
use JSON::Structure::Types qw(ValidationResult ValidationError JsonLocation);

# Create a validation result
my $result = ValidationResult(\@errors, \@warnings);

# Create a validation error
my $error = ValidationError(
    code     => 'INSTANCE_TYPE_MISMATCH',
    message  => 'Expected string, got number',
    path     => '/name',
    severity => SEVERITY_ERROR,
    location => JsonLocation(line => 1, column => 10),
);

# Check result
if ($result->is_valid) { ... }
for my $err (@{$result->errors}) { ... }
```

### JSON::Structure::ErrorCodes

```perl
use JSON::Structure::ErrorCodes qw(:all);
# or import specific groups:
use JSON::Structure::ErrorCodes qw(:schema :instance);

# Available constants:
# Schema errors: SCHEMA_NULL, SCHEMA_INVALID_TYPE, SCHEMA_MISSING_TYPE, etc.
# Instance errors: INSTANCE_TYPE_MISMATCH, INSTANCE_REQUIRED_MEMBER_MISSING, etc.
```

## Error Handling

All validation errors use standardized error codes that are consistent across all JSON Structure SDK implementations:

```perl
use JSON::Structure::ErrorCodes qw(:all);

my $result = $validator->validate($schema, $instance);
for my $error (@{$result->errors}) {
    if ($error->code eq INSTANCE_TYPE_MISMATCH) {
        handle_type_error($error);
    }
    elsif ($error->code eq INSTANCE_REQUIRED_PROPERTY_MISSING) {
        handle_missing_field($error);
    }
    else {
        handle_generic_error($error);
    }
}
```

## Source Location Tracking

When you provide the original JSON text, the SDK can report exact line and column numbers for errors:

```perl
use JSON::Structure::JsonSourceLocator;

my $locator = JSON::Structure::JsonSourceLocator->new($json_text);
my $location = $locator->get_location('/path/to/element');

printf "Line %d, Column %d\n", $location->line, $location->column;
```

## Testing

```bash
# Run all tests
prove -l t/

# Run with verbose output
prove -lv t/

# Run specific test file
prove -l t/02_schema_validator.t

# Run with coverage
cover -test
```

## Publishing to CPAN

See [PUBLISHING.md](PUBLISHING.md) for detailed instructions on publishing to CPAN.

## Integration with Test Assets

The SDK can use the shared test assets for cross-SDK compatibility testing:

```perl
use File::Spec;
use JSON::PP;

my $assets_dir = File::Spec->catdir('..', 'test-assets');
# Load and run test cases from shared assets
```

## Contributing

See the main [SDK-GUIDELINES.md](../SDK-GUIDELINES.md) for contribution guidelines and coding standards.

## License

MIT License - see [LICENSE](LICENSE) for details.
