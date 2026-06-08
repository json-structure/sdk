# frozen_string_literal: true

require 'json'

module JsonStructure
  # Validates JSON Structure schema documents
  #
  # This class is thread-safe. Multiple threads can call validate concurrently.
  class SchemaValidator
    UCUM_NUMERIC_TYPES = %w[number integer float double decimal int32 uint32 int64 uint64 int128 uint128].freeze
    ENUM_NUMERIC_TYPES = %w[integer int8 int16 int32 int64 uint8 uint16 uint32 uint64 float double decimal].freeze
    RELATION_CONTAINER_TYPES = %w[object tuple].freeze
    IDENTIFIER_PATTERN = /\A[A-Za-z_$][A-Za-z0-9_$]*\z/
    URI_SCHEME_PATTERN = /\A[a-zA-Z][a-zA-Z0-9+\-.]*:/
    VALIDATION_KEYWORDS = %w[
      pattern format minLength maxLength minimum maximum exclusiveMinimum exclusiveMaximum multipleOf
      minItems maxItems uniqueItems contains minContains maxContains
      minProperties maxProperties propertyNames patternProperties dependentRequired
      minEntries maxEntries patternKeys keyNames
      contentEncoding contentMediaType has default
    ].freeze
    UNITS_KEYWORDS = %w[unit currency symbols].freeze

    class << self
      # Validate a schema string
    #
    # This method is thread-safe and can be called from multiple threads concurrently.
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
      def validate(schema_json)
        raise ArgumentError, 'schema_json must be a String' unless schema_json.is_a?(String)

        JsonStructure.validation_started
        begin
          result_ptr = ::FFI::MemoryPointer.new(FFI::JSResult.size)
          FFI.js_result_init(result_ptr)

          FFI.js_validate_schema(schema_json, result_ptr)
          base_result = ValidationResult.from_ffi(result_ptr)
          augment_extension_validation(base_result, schema_json)
        ensure
          JsonStructure.validation_completed
        end
      end

      # Validate a schema string, raising an exception on failure
      #
      # @param schema_json [String] JSON string containing the schema
      # @return [ValidationResult] validation result (only if valid)
      # @raise [SchemaValidationError] if validation fails
      #
      # @example
      #   begin
      #     JsonStructure::SchemaValidator.validate!(schema)
      #     puts "Schema is valid!"
      #   rescue JsonStructure::SchemaValidationError => e
      #     puts "Validation failed: #{e.message}"
      #   end
      def validate!(schema_json)
        result = validate(schema_json)
        raise SchemaValidationError.new(result) unless result.valid?

        result
      end

      private

      def augment_extension_validation(base_result, schema_json)
        schema = JSON.parse(schema_json)
        additional_errors = []
        validate_extension_keywords(schema, schema, '#', additional_errors)

        return base_result if additional_errors.empty?

        errors = base_result.errors + additional_errors
        ValidationResult.new(errors.none?(&:error?), errors)
      rescue JSON::ParserError
        base_result
      end

      def validate_extension_keywords(root_schema, node, path, errors)
        return unless node.is_a?(Hash)

        type = node['type']
        validate_root_schema_keywords(node, path, errors) if path == '#'
        validate_validation_extension_gating(root_schema, node, path, errors)
        validate_ucum_unit_keyword(root_schema, node, type, path, errors)
        validate_units_keywords(root_schema, node, type, path, errors)
        validate_relations_keywords(root_schema, node, type, path, errors)
        validate_extends_keyword(root_schema, node, path, errors)
        validate_tuple_ref_entries(root_schema, node, type, path, errors)
        validate_enum_values(type, node, path, errors)

        node.each do |key, value|
          child_path = path == '#' ? "#/#{escape_json_pointer(key)}" : "#{path}/#{escape_json_pointer(key)}"

          if value.is_a?(Hash)
            validate_extension_keywords(root_schema, value, child_path, errors)
          elsif value.is_a?(Array)
            value.each_with_index do |item, index|
              validate_extension_keywords(root_schema, item, "#{child_path}[#{index}]", errors)
            end
          end
        end
      end

      def validate_root_schema_keywords(node, path, errors)
        validate_root_id_keyword(node, path, errors)
        validate_root_name_keyword(node, path, errors)
      end

      def validate_root_id_keyword(node, path, errors)
        return unless node.key?('$id')
        return unless node['$id'].is_a?(String)

        if node['$id'].strip.empty?
          add_manual_error(errors, '$id must not be empty', "#{path}/$id", 'SCHEMA_KEYWORD_EMPTY')
        elsif node['$id'] !~ URI_SCHEME_PATTERN
          add_manual_error(errors, '$id must be a URI with a scheme', "#{path}/$id", 'SCHEMA_CONSTRAINT_VALUE_INVALID')
        end
      end

      def validate_root_name_keyword(node, path, errors)
        return unless node.key?('name')
        return unless node['name'].is_a?(String)
        return if node['name'].match?(IDENTIFIER_PATTERN)

        add_manual_error(errors, 'name must be a valid identifier', "#{path}/name", 'SCHEMA_NAME_INVALID')
      end

      def validate_validation_extension_gating(root_schema, node, path, errors)
        return if extension_enabled?(root_schema, 'JSONStructureValidation')

        VALIDATION_KEYWORDS.each do |keyword|
          next unless node.key?(keyword)

          add_manual_warning(errors, "'#{keyword}' requires JSONStructureValidation extension.", "#{path}/#{escape_json_pointer(keyword)}")
        end
      end

      def validate_ucum_unit_keyword(root_schema, node, type, path, errors)
        return unless node.key?('ucumUnit')

        add_manual_error(errors, "'ucumUnit' requires JSONStructureUnits extension.", "#{path}/ucumUnit") unless extension_enabled?(root_schema, 'JSONStructureUnits')

        add_manual_error(errors, "'ucumUnit' must be a string.", "#{path}/ucumUnit") unless node['ucumUnit'].is_a?(String)

        return if type.is_a?(String) && UCUM_NUMERIC_TYPES.include?(type)

        add_manual_error(errors, "'ucumUnit' can only appear in numeric schemas.", "#{path}/ucumUnit")
      end

      def validate_units_keywords(root_schema, node, type, path, errors)
        UNITS_KEYWORDS.each do |keyword|
          next unless node.key?(keyword)

          add_manual_error(errors, "'#{keyword}' requires JSONStructureUnits extension.", "#{path}/#{escape_json_pointer(keyword)}") unless extension_enabled?(root_schema, 'JSONStructureUnits')
        end

        return unless node.key?('unit')

        add_manual_error(errors, "'unit' must be a string.", "#{path}/unit") unless node['unit'].is_a?(String)

        return if type.is_a?(String) && UCUM_NUMERIC_TYPES.include?(type)

        add_manual_error(errors, "'unit' can only appear in numeric schemas.", "#{path}/unit")
      end

      def validate_relations_keywords(root_schema, node, type, path, errors)
        has_identity = node.key?('identity')
        has_relations = node.key?('relations')
        return unless has_identity || has_relations

        unless extension_enabled?(root_schema, 'JSONStructureRelations')
          add_manual_error(errors, "'identity' requires JSONStructureRelations extension.", "#{path}/identity") if has_identity
          add_manual_error(errors, "'relations' requires JSONStructureRelations extension.", "#{path}/relations") if has_relations
        end

        supports_relations = type.is_a?(String) && RELATION_CONTAINER_TYPES.include?(type)

        if has_identity
          validate_identity_keyword(node, path, supports_relations, errors)
        end

        validate_relations_object(root_schema, node, path, supports_relations, errors) if has_relations
      end

      def validate_identity_keyword(node, path, supports_relations, errors)
        identity = node['identity']
        add_manual_error(errors, "'identity' can only appear in object or tuple schemas.", "#{path}/identity") unless supports_relations

        unless identity.is_a?(Array)
          add_manual_error(errors, "'identity' must be an array of strings.", "#{path}/identity")
          return
        end

        properties = node['properties'].is_a?(Hash) ? node['properties'] : {}
        identity.each_with_index do |item, index|
          item_path = "#{path}/identity[#{index}]"
          unless item.is_a?(String)
            add_manual_error(errors, "'identity[#{index}]' must be a string.", item_path)
            next
          end

          unless properties.key?(item)
            add_manual_error(errors, "'identity' references property '#{item}' that is not in 'properties'.", item_path)
          end
        end
      end

      def validate_relations_object(root_schema, node, path, supports_relations, errors)
        relations = node['relations']
        add_manual_error(errors, "'relations' can only appear in object or tuple schemas.", "#{path}/relations") unless supports_relations

        unless relations.is_a?(Hash)
          add_manual_error(errors, "'relations' must be an object.", "#{path}/relations")
          return
        end

        relations.each do |relation_name, relation|
          relation_path = "#{path}/relations/#{escape_json_pointer(relation_name.to_s)}"

          unless relation.is_a?(Hash)
            add_manual_error(errors, 'Relation declaration must be an object.', relation_path)
            next
          end

          if relation.key?('targettype')
            validate_relation_ref_object(root_schema, relation['targettype'], relation_path, 'targettype', errors)
          else
            add_manual_error(errors, "Relation declaration must have 'targettype'.", "#{relation_path}/targettype")
          end

          if relation.key?('cardinality')
            cardinality = relation['cardinality']
            unless cardinality.is_a?(String) && %w[single multiple].include?(cardinality)
              add_manual_error(errors, "'cardinality' must be 'single' or 'multiple'.", "#{relation_path}/cardinality")
            end
          else
            add_manual_error(errors, "Relation declaration must have 'cardinality'.", "#{relation_path}/cardinality")
          end

          validate_relation_scope(relation['scope'], relation_path, errors) if relation.key?('scope')
          validate_relation_ref_object(root_schema, relation['qualifiertype'], relation_path, 'qualifiertype', errors) if relation.key?('qualifiertype')
        end
      end

      def validate_relation_scope(scope, relation_path, errors)
        return if scope.is_a?(String)

        if scope.is_a?(Array)
          scope.each_with_index do |item, index|
            next if item.is_a?(String)

            add_manual_error(errors, "'scope' array items must be strings.", "#{relation_path}/scope[#{index}]")
          end
          return
        end

        add_manual_error(errors, "'scope' must be a string or an array of strings.", "#{relation_path}/scope")
      end

      def validate_extends_keyword(root_schema, node, path, errors)
        return unless node.key?('$extends')

        refs = normalized_extends_refs(node['$extends'], path)
        refs.each do |ref, ref_path|
          next unless ref.start_with?('#/')

          resolved = resolve_ref(root_schema, ref)
          next unless resolved
          next if resolved.is_a?(Hash) && (!resolved.key?('type') || %w[object tuple map array set choice].include?(resolved['type']))

          add_manual_error(errors,
                           "$extends target '#{ref}' must not resolve to a primitive type",
                           ref_path,
                           'SCHEMA_CONSTRAINT_TYPE_MISMATCH')
        end
      end

      def normalized_extends_refs(extends_value, path)
        case extends_value
        when String
          [[extends_value, "#{path}/$extends"]]
        when Array
          extends_value.each_with_index.filter_map do |item, index|
            [item, "#{path}/$extends[#{index}]"] if item.is_a?(String)
          end
        else
          []
        end
      end

      def validate_tuple_ref_entries(root_schema, node, type, path, errors)
        return unless type == 'tuple'
        return unless node['tuple'].is_a?(Array)

        node['tuple'].each_with_index do |entry, index|
          next unless entry.is_a?(Hash) && entry['$ref'].is_a?(String)

          ref = entry['$ref']
          next unless ref.start_with?('#/')
          next if resolve_ref(root_schema, ref)

          add_manual_error(errors, "$ref '#{ref}' not found", "#{path}/tuple[#{index}]/$ref", 'SCHEMA_REF_NOT_FOUND')
        end
      end

      def validate_enum_values(type, node, path, errors)
        return unless node['enum'].is_a?(Array)
        return unless type.is_a?(String)

        node['enum'].each_with_index do |value, index|
          next if enum_value_valid_for_type?(type, value)

          add_manual_error(errors,
                           "enum value is not valid for type '#{type}'",
                           "#{path}/enum[#{index}]",
                           'SCHEMA_CONSTRAINT_TYPE_MISMATCH')
        end
      end

      def enum_value_valid_for_type?(type, value)
        case type
        when 'string'
          value.is_a?(String)
        when *ENUM_NUMERIC_TYPES
          value.is_a?(Numeric)
        when 'boolean'
          value == true || value == false
        when 'null'
          value.nil?
        else
          true
        end
      end

      def validate_relation_ref_object(root_schema, value, relation_path, keyword, errors)
        keyword_path = "#{relation_path}/#{keyword}"

        unless value.is_a?(Hash) && value['$ref'].is_a?(String)
          add_manual_error(errors, "'#{keyword}' must be an object with '$ref'.", keyword_path)
          return
        end

        ref = value['$ref']
        return unless ref.start_with?('#/')
        return if resolve_ref(root_schema, ref)

        add_manual_error(errors, "$ref '#{ref}' not found", "#{keyword_path}/$ref")
      end

      def extension_enabled?(root_schema, extension)
        uses = root_schema['$uses']
        uses.is_a?(Array) && uses.include?(extension)
      end

      def resolve_ref(root_schema, ref)
        return nil unless ref.start_with?('#/')

        ref.delete_prefix('#/').split('/').reduce(root_schema) do |current, segment|
          segment = segment.gsub('~1', '/').gsub('~0', '~')
          break nil unless current.is_a?(Hash) && current.key?(segment)

          current[segment]
        end
      end

      def escape_json_pointer(segment)
        segment.to_s.gsub('~', '~0').gsub('/', '~1')
      end

      def add_manual_error(errors, message, path, code = 0)
        errors << ValidationError.new(
          code: code,
          severity: FFI::JS_SEVERITY_ERROR,
          path: path,
          message: message,
          location: { line: 0, column: 0, offset: 0 }
        )
      end

      def add_manual_warning(errors, message, path, code = 0)
        errors << ValidationError.new(
          code: code,
          severity: FFI::JS_SEVERITY_WARNING,
          path: path,
          message: message,
          location: { line: 0, column: 0, offset: 0 }
        )
      end
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
