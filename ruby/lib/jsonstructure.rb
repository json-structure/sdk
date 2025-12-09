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
# ## Thread Safety
#
# This library is thread-safe. Multiple threads can perform validations
# concurrently without synchronization. The underlying C library uses
# proper synchronization primitives to protect shared state.
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
# @example Concurrent Validation
#   threads = 10.times.map do |i|
#     Thread.new do
#       result = JsonStructure::SchemaValidator.validate('{"type": "string"}')
#       puts "Thread #{i}: #{result.valid?}"
#     end
#   end
#   threads.each(&:join)
#
# @see SchemaValidator
# @see InstanceValidator
# @see ValidationResult
module JsonStructure
  class Error < StandardError; end

  # Mutex for protecting cleanup coordination
  @cleanup_mutex = Mutex.new
  # Count of active validations (for safe cleanup)
  @active_validations = 0
  # Flag to prevent new validations during shutdown
  @shutting_down = false

  class << self
    # Track when a validation starts
    # @api private
    def validation_started
      @cleanup_mutex.synchronize do
        raise Error, 'Library is shutting down' if @shutting_down

        @active_validations += 1
      end
    end

    # Track when a validation completes
    # @api private
    def validation_completed
      @cleanup_mutex.synchronize do
        @active_validations -= 1
      end
    end

    # Check if any validations are currently active
    # @api private
    def validations_active?
      @cleanup_mutex.synchronize do
        @active_validations > 0
      end
    end

    # Safely clean up the library, waiting for active validations
    # @api private
    def safe_cleanup
      @cleanup_mutex.synchronize do
        @shutting_down = true
      end

      # Wait briefly for active validations to complete (up to 1 second)
      10.times do
        break unless validations_active?

        sleep 0.1
      end

      # Perform cleanup - the C library is thread-safe, so this is safe
      # even if a validation is somehow still running
      FFI.js_cleanup
    end
  end

  # Initialize the JSON Structure library
  # This is called automatically when the module is loaded
  FFI.js_init

  # Clean up the JSON Structure library when Ruby exits
  # Uses safe_cleanup to coordinate with active validations
  at_exit do
    JsonStructure.safe_cleanup
  end
end
