# frozen_string_literal: true

require 'rbconfig'
require 'ffi'

require_relative 'jsonstructure/version'
require_relative 'jsonstructure/binary_installer'
require_relative 'jsonstructure/ffi'
require_relative 'jsonstructure/validation_result'
require_relative 'jsonstructure/schema_validator'
require_relative 'jsonstructure/instance_validator'

# JSON Structure SDK for Ruby
#
# This gem provides Ruby bindings to the JSON Structure C library
# via FFI (Foreign Function Interface). It allows you to validate
# JSON Structure schemas and validate JSON instances against schemas.
#
# @example Schema Validation
#   schema = '{"type": "string", "minLength": 1}'
#   result = JsonStructure::SchemaValidator.validate(schema)
#   puts "Valid!" if result.valid?
#
# @example Instance Validation
#   schema = '{"type": "string"}'
#   instance = '"hello"'
#   result = JsonStructure::InstanceValidator.validate(instance, schema)
#   puts "Valid!" if result.valid?
#
# @see SchemaValidator
# @see InstanceValidator
# @see ValidationResult
module JsonStructure
  class Error < StandardError; end

  # Initialize the JSON Structure library
  # This is called automatically when the module is loaded
  FFI.js_init

  # Clean up the JSON Structure library when Ruby exits
  at_exit do
    FFI.js_cleanup
  end
end
