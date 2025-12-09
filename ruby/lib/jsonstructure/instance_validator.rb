# frozen_string_literal: true

module JsonStructure
  # Validates JSON instances against JSON Structure schemas
  #
  # This class is thread-safe. Multiple threads can call validate concurrently.
  class InstanceValidator
    # Validate an instance against a schema
    #
    # This method is thread-safe and can be called from multiple threads concurrently.
    #
    # @param instance_json [String] JSON string containing the instance to validate
    # @param schema_json [String] JSON string containing the schema
    # @return [ValidationResult] validation result
    #
    # @example
    #   schema = '{"type": "string", "minLength": 1}'
    #   instance = '"hello"'
    #   result = JsonStructure::InstanceValidator.validate(instance, schema)
    #   if result.valid?
    #     puts "Instance is valid!"
    #   else
    #     result.errors.each { |e| puts e.message }
    #   end
    def self.validate(instance_json, schema_json)
      raise ArgumentError, 'instance_json must be a String' unless instance_json.is_a?(String)
      raise ArgumentError, 'schema_json must be a String' unless schema_json.is_a?(String)

      JsonStructure.validation_started
      begin
        result_ptr = ::FFI::MemoryPointer.new(FFI::JSResult.size)
        FFI.js_result_init(result_ptr)

        FFI.js_validate_instance(instance_json, schema_json, result_ptr)
        ValidationResult.from_ffi(result_ptr)
      ensure
        JsonStructure.validation_completed
      end
    end

    # Validate an instance against a schema, raising an exception on failure
    #
    # @param instance_json [String] JSON string containing the instance to validate
    # @param schema_json [String] JSON string containing the schema
    # @return [ValidationResult] validation result (only if valid)
    # @raise [InstanceValidationError] if validation fails
    #
    # @example
    #   begin
    #     result = JsonStructure::InstanceValidator.validate!(instance, schema)
    #     puts "Instance is valid!"
    #   rescue JsonStructure::InstanceValidationError => e
    #     puts "Validation failed: #{e.message}"
    #   end
    def self.validate!(instance_json, schema_json)
      result = validate(instance_json, schema_json)
      raise InstanceValidationError.new(result) unless result.valid?

      result
    end
  end

  # Exception raised when instance validation fails
  class InstanceValidationError < StandardError
    attr_reader :result

    def initialize(result)
      @result = result
      super(result.to_s)
    end

    def errors
      @result.errors
    end
  end
end
