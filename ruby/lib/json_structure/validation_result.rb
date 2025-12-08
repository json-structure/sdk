# frozen_string_literal: true

module JsonStructure
  # Represents a validation error
  class ValidationError
    attr_reader :code, :severity, :path, :message, :location

    def initialize(code:, severity:, path:, message:, location:)
      @code = code
      @severity = severity
      @path = path
      @message = message
      @location = location
    end

    def error?
      @severity == FFI::JS_SEVERITY_ERROR
    end

    def warning?
      @severity == FFI::JS_SEVERITY_WARNING
    end

    def info?
      @severity == FFI::JS_SEVERITY_INFO
    end

    def to_s
      if @path && !@path.empty?
        "#{@message} (at #{@path})"
      else
        @message
      end
    end

    def inspect
      "#<#{self.class.name} @severity=#{@severity} @code=#{@code} @message=#{@message.inspect} @path=#{@path.inspect}>"
    end
  end

  # Represents the result of a validation operation
  class ValidationResult
    attr_reader :errors

    def initialize(valid, errors = [])
      @valid = valid
      @errors = errors
    end

    def valid?
      @valid
    end

    def invalid?
      !@valid
    end

    def error_messages
      @errors.select(&:error?).map(&:message)
    end

    def warning_messages
      @errors.select(&:warning?).map(&:message)
    end

    def to_s
      if valid?
        'Validation succeeded'
      else
        "Validation failed with #{@errors.count} error(s):\n" +
          @errors.map { |e| "  - #{e}" }.join("\n")
      end
    end

    # Creates a ValidationResult from an FFI JSResult struct
    # @api private
    def self.from_ffi(result_ptr)
      result = FFI::JSResult.new(result_ptr)
      valid = result[:valid]

      errors = result.errors_array.map do |ffi_error|
        ValidationError.new(
          code: ffi_error[:code],
          severity: ffi_error[:severity],
          path: ffi_error.path_str,
          message: ffi_error.message_str,
          location: ffi_error.location_hash
        )
      end

      new(valid, errors)
    ensure
      FFI.js_result_cleanup(result_ptr) if result_ptr
    end
  end
end
