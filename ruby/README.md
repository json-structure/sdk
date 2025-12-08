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
gem 'json_structure'
```

And then execute:

```bash
bundle install
```

Or install it yourself as:

```bash
gem install json_structure
```

### Prerequisites

The gem requires the JSON Structure C library to be built. If you're installing from source:

1. Ensure you have CMake 3.14+ and a C99 compiler installed
2. The C library will be built automatically when running tests

## Usage

### Schema Validation

```ruby
require 'json_structure'

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
require 'json_structure'

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
require 'json_structure'

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

## Development

After checking out the repo, run `bundle install` to install dependencies.

Build the C library:

```bash
rake build_c_lib
```

Run the tests:

```bash
rake test
```

## Architecture

This Ruby SDK wraps the JSON Structure C library using Ruby's FFI (Foreign Function Interface). The architecture consists of:

1. **C Library** - Core validation logic implemented in C99
2. **FFI Bindings** (`lib/json_structure/ffi.rb`) - Low-level FFI mappings to C functions
3. **Ruby Wrappers** - Idiomatic Ruby classes that wrap the FFI calls
   - `SchemaValidator` - Schema validation
   - `InstanceValidator` - Instance validation
   - `ValidationResult` - Result container
   - `ValidationError` - Error information

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/json-structure/sdk.

## License

The gem is available as open source under the terms of the [MIT License](https://opensource.org/licenses/MIT).
