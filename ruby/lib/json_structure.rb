# frozen_string_literal: true

require 'rbconfig'
require 'ffi'

require_relative 'json_structure/version'
require_relative 'json_structure/ffi'
require_relative 'json_structure/validation_result'
require_relative 'json_structure/schema_validator'
require_relative 'json_structure/instance_validator'

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
