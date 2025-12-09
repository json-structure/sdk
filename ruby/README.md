# JSON Structure Ruby SDK

Ruby SDK for JSON Structure schema validation using FFI bindings to the C library.

## Features

- **Schema validation** - Validate JSON Structure schema documents
- **Instance validation** - Validate JSON instances against schemas
- **High performance** - FFI bindings to native C library
- **Idiomatic Ruby API** - Wrapped in clean, Ruby-friendly classes
- **Cross-platform** - Works on Linux, macOS, and Windows

## Installation

Add this line to your application's Gemfile:

```ruby
gem 'jsonstructure'
```

And then execute:

```bash
bundle install
```

Or install it yourself as:

```bash
gem install jsonstructure
```

### Binary Distribution

**The gem automatically downloads pre-built C library binaries from GitHub releases.** No compilation is required during installation.

Supported platforms:
- Linux (x86_64, arm64)
- macOS (x86_64, arm64)
- Windows (x86_64)

If you're developing the gem itself or contributing, see the Development section below for building from source.

## Usage

### Schema Validation

```ruby
require 'jsonstructure'

schema = '{"type": "string", "minLength": 1}'
result = JsonStructure::SchemaValidator.validate(schema)

if result.valid?
  puts "Schema is valid!"
else
  result.errors.each do |error|
    puts "Error: #{error.message}"
  end
end
```

### Instance Validation

```ruby
require 'jsonstructure'

schema = '{"type": "string", "minLength": 1}'
instance = '"hello"'

result = JsonStructure::InstanceValidator.validate(instance, schema)

if result.valid?
  puts "Instance is valid!"
else
  result.errors.each do |error|
    puts "Error: #{error.message}"
    puts "  Path: #{error.path}" if error.path
  end
end
```

### Using Exceptions

Both validators provide a `validate!` method that raises an exception on validation failure:

```ruby
require 'jsonstructure'

begin
  schema = '{"type": "string"}'
  JsonStructure::SchemaValidator.validate!(schema)
  puts "Schema is valid!"
rescue JsonStructure::SchemaValidationError => e
  puts "Schema validation failed: #{e.message}"
  e.errors.each { |err| puts "  - #{err.message}" }
end

begin
  instance = '123'
  schema = '{"type": "string"}'
  JsonStructure::InstanceValidator.validate!(instance, schema)
  puts "Instance is valid!"
rescue JsonStructure::InstanceValidationError => e
  puts "Instance validation failed: #{e.message}"
  e.errors.each { |err| puts "  - #{err.message}" }
end
```

### Working with Validation Results

```ruby
result = JsonStructure::InstanceValidator.validate(instance, schema)

# Check validity
puts result.valid?    # => true or false
puts result.invalid?  # => opposite of valid?

# Access errors
result.errors.each do |error|
  puts error.code      # Error code
  puts error.severity  # Severity level
  puts error.message   # Human-readable message
  puts error.path      # JSON Pointer path to error location
  puts error.location  # Hash with :line, :column, :offset

  # Check error type
  puts error.error?    # true if severity is ERROR
  puts error.warning?  # true if severity is WARNING
  puts error.info?     # true if severity is INFO
end

# Get error/warning messages
error_msgs = result.error_messages    # Array of error messages
warning_msgs = result.warning_messages # Array of warning messages
```

## API Reference

### `JsonStructure::SchemaValidator`

- `validate(schema_json)` - Validate a schema, returns `ValidationResult`
- `validate!(schema_json)` - Validate a schema, raises `SchemaValidationError` on failure

### `JsonStructure::InstanceValidator`

- `validate(instance_json, schema_json)` - Validate an instance against a schema, returns `ValidationResult`
- `validate!(instance_json, schema_json)` - Validate an instance, raises `InstanceValidationError` on failure

### `JsonStructure::ValidationResult`

- `valid?` - Returns true if validation passed
- `invalid?` - Returns true if validation failed
- `errors` - Array of `ValidationError` objects
- `error_messages` - Array of error message strings
- `warning_messages` - Array of warning message strings

### `JsonStructure::ValidationError`

- `code` - Error code (integer)
- `severity` - Severity level (ERROR, WARNING, or INFO)
- `message` - Human-readable error message
- `path` - JSON Pointer path to error location (may be nil)
- `location` - Hash with `:line`, `:column`, `:offset` keys
- `error?`, `warning?`, `info?` - Check severity level

## Thread Safety

This library is **thread-safe**. Multiple threads can perform validations concurrently without any external synchronization.

### Concurrent Validation

```ruby
require 'jsonstructure'

schema = '{"type": "object", "properties": {"name": {"type": "string"}}}'

# Safe to validate from multiple threads simultaneously
threads = 10.times.map do |i|
  Thread.new do
    instance = %Q({"name": "Thread #{i}"})
    result = JsonStructure::InstanceValidator.validate(instance, schema)
    puts "Thread #{i}: #{result.valid? ? 'valid' : 'invalid'}"
  end
end
threads.each(&:join)
```

### Implementation Details

- The underlying C library uses proper synchronization primitives (SRWLOCK on Windows, pthread_mutex on Unix) to protect shared state
- Each validation call is independent and does not share mutable state with other calls
- The `at_exit` cleanup hook coordinates with active validations to avoid races during process shutdown

### Best Practices

1. **Prefer stateless validation**: Each `validate` call is independent. There's no need to create validator instances or manage state.

2. **Thread-local results**: ValidationResult objects returned by `validate` are thread-local and can be safely used without synchronization.

3. **Exception safety**: If a validation raises an exception (e.g., ArgumentError for invalid input), the library state remains consistent.

## Development

After checking out the repo, run `bundle install` to install dependencies.

### For Local Development (Building from Source)

When developing the gem with the C library in the same repository:

```bash
# Build the C library locally
rake build_c_lib_local

# Run the tests
rake test
```

The `rake test` task will attempt to download a pre-built binary first. If that fails (e.g., during development), it will fall back to building the C library from source if available.

### For Production Use

Production installations automatically download pre-built binaries from GitHub releases. No local build is required:

```bash
# Just install and use
gem install jsonstructure
# The binary will be downloaded automatically on first require
```

## Architecture

This Ruby SDK treats the JSON Structure C library as an external dependency, downloading pre-built binaries from GitHub releases. The architecture consists of:

1. **C Library Binaries** - Pre-built shared libraries (`.so`, `.dylib`, `.dll`) distributed via GitHub releases
2. **Binary Installer** (`lib/jsonstructure/binary_installer.rb`) - Downloads and installs platform-specific binaries
3. **FFI Bindings** (`lib/jsonstructure/ffi.rb`) - Low-level FFI mappings to C functions
4. **Ruby Wrappers** - Idiomatic Ruby classes that wrap the FFI calls
   - `SchemaValidator` - Schema validation
   - `InstanceValidator` - Instance validation
   - `ValidationResult` - Result container
   - `ValidationError` - Error information

This design allows the Ruby SDK to be distributed independently of the C library source code, treating it as a foreign SDK dependency.

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/json-structure/sdk.

## License

The gem is available as open source under the terms of the [MIT License](https://opensource.org/licenses/MIT).
