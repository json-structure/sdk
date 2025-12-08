# frozen_string_literal: true

require 'ffi'

module JsonStructure
  # Low-level FFI bindings to the C library
  module FFI
    extend ::FFI::Library

    # Determine library name based on platform
    lib_name = case RbConfig::CONFIG['host_os']
               when /darwin|mac os/
                 'libjson_structure.dylib'
               when /mswin|msys|mingw|cygwin|bccwin|wince|emc/
                 'json_structure.dll'
               else
                 'libjson_structure.so'
               end

    # Try to load from several possible locations
    # Priority: downloaded binaries (ext/), system paths, then local build (fallback for development)
    lib_paths = [
      ::File.expand_path("../../../ext/#{lib_name}", __FILE__),
      lib_name, # Let FFI search in standard library paths
      ::File.expand_path("../../../../c/build/#{lib_name}", __FILE__) # Fallback for local development
    ]

    loaded = false
    lib_paths.each do |path|
      begin
        ffi_lib path
        loaded = true
        break
      rescue LoadError
        next
      end
    end

    raise LoadError, "Could not load json_structure library from: #{lib_paths.join(', ')}" unless loaded

    # Enums
    typedef :int, :js_type_t
    typedef :int, :js_error_code_t
    typedef :int, :js_severity_t

    # js_severity_t enum values
    JS_SEVERITY_ERROR = 0
    JS_SEVERITY_WARNING = 1
    JS_SEVERITY_INFO = 2

    # Structs
    class JSLocation < ::FFI::Struct
      layout :line, :int,
             :column, :int,
             :offset, :size_t
    end

    class JSError < ::FFI::Struct
      layout :code, :js_error_code_t,
             :severity, :js_severity_t,
             :location, JSLocation,
             :path, :pointer,
             :message, :pointer

      def path_str
        ptr = self[:path]
        ptr.null? ? nil : ptr.read_string
      end

      def message_str
        ptr = self[:message]
        ptr.null? ? '' : ptr.read_string
      end

      def location_hash
        loc = self[:location]
        {
          line: loc[:line],
          column: loc[:column],
          offset: loc[:offset]
        }
      end
    end

    class JSResult < ::FFI::Struct
      layout :valid, :bool,
             :errors, :pointer,
             :error_count, :size_t,
             :error_capacity, :size_t

      def errors_array
        return [] if self[:error_count].zero?

        errors_ptr = self[:errors]
        (0...self[:error_count]).map do |i|
          JSError.new(errors_ptr + i * JSError.size)
        end
      end
    end

    class JSSchemaValidator < ::FFI::Struct
      layout :allow_import, :bool,
             :warnings_enabled, :bool,
             :import_registry, :pointer
    end

    class JSInstanceValidator < ::FFI::Struct
      layout :check_refs, :bool,
             :warnings_enabled, :bool,
             :import_registry, :pointer
    end

    # Library functions
    attach_function :js_init, [], :void
    attach_function :js_cleanup, [], :void

    # Result functions
    attach_function :js_result_init, [:pointer], :void
    attach_function :js_result_cleanup, [:pointer], :void
    attach_function :js_result_to_string, [:pointer], :pointer

    # Schema validator functions
    attach_function :js_schema_validator_init, [:pointer], :void
    attach_function :js_schema_validate_string, [:pointer, :string, :pointer], :bool

    # Instance validator functions
    attach_function :js_instance_validator_init, [:pointer], :void
    attach_function :js_instance_validate_strings, [:pointer, :string, :string, :pointer], :bool

    # Error message function
    attach_function :js_error_message, [:js_error_code_t], :string

    # Memory management
    attach_function :js_free, [:pointer], :void

    # Convenience wrappers (since the C inline functions aren't exported)
    def self.js_validate_schema(schema_json, result_ptr)
      validator_ptr = ::FFI::MemoryPointer.new(JSSchemaValidator.size)
      js_schema_validator_init(validator_ptr)
      js_schema_validate_string(validator_ptr, schema_json, result_ptr)
    end

    def self.js_validate_instance(instance_json, schema_json, result_ptr)
      validator_ptr = ::FFI::MemoryPointer.new(JSInstanceValidator.size)
      js_instance_validator_init(validator_ptr)
      js_instance_validate_strings(validator_ptr, instance_json, schema_json, result_ptr)
    end
  end
end
