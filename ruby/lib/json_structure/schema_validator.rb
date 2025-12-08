# frozen_string_literal: true

module JsonStructure
  # Validates JSON Structure schema documents
  class SchemaValidator
    # Validate a schema string
    #
    # @param schema_json [String] JSON string containing the schema
    # @return [ValidationResult] validation result
    #
    # @example
    #   schema = '{"type": "string", "minLength": 1}'
    #   result = JsonStructure::SchemaValidator.validate(schema)
    #   if result.valid?
    #     puts "Schema is valid!"
    #   else
    #     result.errors.each { |e| puts e.message }
    #   end
    def self.validate(schema_json)
      raise ArgumentError, 'schema_json must be a String' unless schema_json.is_a?(String)

      result_ptr = ::FFI::MemoryPointer.new(FFI::JSResult.size)
      FFI.js_result_init(result_ptr)

      begin
        FFI.js_validate_schema(schema_json, result_ptr)
        ValidationResult.from_ffi(result_ptr)
      ensure
        # from_ffi already cleans up, but ensure it happens
      end
    end

    # Validate a schema string, raising an exception on failure
    #
    # @param schema_json [String] JSON string containing the schema
    # @return [ValidationResult] validation result (only if valid)
    # @raise [ValidationError] if validation fails
    #
    # @example
    #   begin
    #     JsonStructure::SchemaValidator.validate!(schema)
    #     puts "Schema is valid!"
    #   rescue JsonStructure::ValidationError => e
    #     puts "Validation failed: #{e.message}"
    #   end
    def self.validate!(schema_json)
      result = validate(schema_json)
      raise SchemaValidationError.new(result) unless result.valid?

      result
    end
  end

  # Exception raised when schema validation fails
  class SchemaValidationError < StandardError
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
