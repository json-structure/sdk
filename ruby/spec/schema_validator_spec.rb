# frozen_string_literal: true

require 'spec_helper'

RSpec.describe JsonStructure::SchemaValidator do
  describe '.validate' do
    context 'with valid schema' do
      it 'returns valid result for simple string schema' do
        schema = '{"type": "string"}'
        result = described_class.validate(schema)

        expect(result).to be_valid
        expect(result.error_messages).to be_empty # Only check errors, not warnings
      end

      it 'returns valid result for object schema' do
        schema = '{"type": "object", "properties": {"name": {"type": "string"}}}'
        result = described_class.validate(schema)

        expect(result).to be_valid
        expect(result.error_messages).to be_empty # Only check errors, not warnings
      end

      it 'returns valid result for array schema' do
        schema = '{"type": "array", "items": {"type": "integer"}}'
        result = described_class.validate(schema)

        expect(result).to be_valid
        expect(result.error_messages).to be_empty # Only check errors, not warnings
      end
    end

    context 'with invalid schema' do
      it 'returns invalid result for malformed JSON' do
        schema = '{invalid json}'
        result = described_class.validate(schema)

        expect(result).to be_invalid
        expect(result.errors).not_to be_empty
      end

      it 'returns invalid result for invalid type' do
        schema = '{"type": "not_a_type"}'
        result = described_class.validate(schema)

        expect(result).to be_invalid
        expect(result.errors).not_to be_empty
      end
    end

    context 'error handling' do
      it 'raises ArgumentError for non-string input' do
        expect { described_class.validate(nil) }.to raise_error(ArgumentError)
        expect { described_class.validate(123) }.to raise_error(ArgumentError)
        expect { described_class.validate({}) }.to raise_error(ArgumentError)
      end
    end
  end

  describe '.validate!' do
    context 'with valid schema' do
      it 'returns result without raising' do
        schema = '{"type": "string"}'
        result = described_class.validate!(schema)

        expect(result).to be_valid
      end
    end

    context 'with invalid schema' do
      it 'raises SchemaValidationError' do
        schema = '{invalid json}'

        expect { described_class.validate!(schema) }.to raise_error(JsonStructure::SchemaValidationError)
      end

      it 'includes validation errors in exception' do
        schema = '{invalid json}'

        begin
          described_class.validate!(schema)
          raise 'Expected SchemaValidationError to be raised'
        rescue JsonStructure::SchemaValidationError => e
          expect(e.errors).not_to be_empty
          expect(e.result).to be_invalid
        end
      end
    end
  end

  describe '.validate with ucumUnit keyword' do
    it 'accepts a numeric type with ucumUnit' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/extended/v0/#",
          "$id": "urn:example:ucum-number",
          "name": "Length",
          "$uses": ["JSONStructureUnits"],
          "type": "number",
          "ucumUnit": "m"
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_valid
      expect(result.error_messages).to be_empty
    end

    it 'accepts a numeric type with unit and ucumUnit' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/extended/v0/#",
          "$id": "urn:example:ucum-both",
          "name": "Length",
          "$uses": ["JSONStructureUnits"],
          "type": "number",
          "unit": "meter",
          "ucumUnit": "m"
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_valid
      expect(result.error_messages).to be_empty
    end

    it 'accepts extended numeric types with ucumUnit' do
      %w[int32 float double decimal].each do |type|
        schema = <<~JSON
          {
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "urn:example:ucum-#{type}",
            "name": "#{type}WithUcumUnit",
            "$uses": ["JSONStructureUnits"],
            "type": "#{type}",
            "ucumUnit": "m"
          }
        JSON

        result = described_class.validate(schema)

        expect(result).to be_valid
        expect(result.error_messages).to be_empty
      end
    end

    it 'rejects ucumUnit on non-numeric types' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/extended/v0/#",
          "$id": "urn:example:ucum-string",
          "name": "BadUcumType",
          "$uses": ["JSONStructureUnits"],
          "type": "string",
          "ucumUnit": "m"
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_invalid
      expect(result.error_messages).to include("'ucumUnit' can only appear in numeric schemas.")
    end

    it 'rejects non-string ucumUnit values' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/extended/v0/#",
          "$id": "urn:example:ucum-non-string",
          "name": "BadUcumValue",
          "$uses": ["JSONStructureUnits"],
          "type": "number",
          "ucumUnit": 5
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_invalid
      expect(result.error_messages).to include("'ucumUnit' must be a string.")
    end
  end

  describe '.validate with root keyword checks' do
    it 'rejects empty $id values' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/core/v0/#",
          "$id": "   ",
          "name": "BadId",
          "type": "object"
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_invalid
      expect(result.errors).to include(have_attributes(code: 'SCHEMA_KEYWORD_EMPTY', message: '$id must not be empty'))
    end

    it 'rejects $id values without a URI scheme' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/core/v0/#",
          "$id": "example.com/no-scheme",
          "name": "BadId",
          "type": "object"
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_invalid
      expect(result.errors).to include(have_attributes(code: 'SCHEMA_CONSTRAINT_VALUE_INVALID', message: '$id must be a URI with a scheme'))
    end

    it 'rejects invalid root names' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/core/v0/#",
          "$id": "https://example.com/bad-name-id",
          "name": "123invalid",
          "type": "object"
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_invalid
      expect(result.errors).to include(have_attributes(code: 'SCHEMA_NAME_INVALID', message: 'name must be a valid identifier'))
    end
  end

  describe '.validate with enum type checks' do
    it 'rejects enum values that do not match the declared type' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/core/v0/#",
          "$id": "https://example.com/enum-type-mismatch",
          "name": "EnumTypeMismatch",
          "type": "boolean",
          "enum": [true, "false"]
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_invalid
      expect(result.errors).to include(have_attributes(code: 'SCHEMA_CONSTRAINT_TYPE_MISMATCH', message: "enum value is not valid for type 'boolean'"))
    end
  end

  describe '.validate with $extends checks' do
    it 'rejects $extends targets that are not object or tuple schemas' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/core/v0/#",
          "$id": "https://example.com/bad-extends-target",
          "name": "Derived",
          "type": "object",
          "$extends": "#/definitions/Base",
          "definitions": {
            "Base": {
              "name": "Base",
              "type": "string"
            }
          }
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_invalid
      expect(result.errors).to include(
        have_attributes(
          code: 'SCHEMA_CONSTRAINT_TYPE_MISMATCH',
          message: "$extends target '#/definitions/Base' must not resolve to a primitive type"
        )
      )
    end
  end

  describe '.validate with tuple ref checks' do
    it 'rejects tuple refs that cannot be resolved' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/core/v0/#",
          "$id": "https://example.com/tuple-ref",
          "name": "TupleRef",
          "type": "tuple",
          "properties": {
            "name": { "type": "string" }
          },
          "tuple": [{ "$ref": "#/definitions/Missing" }]
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_invalid
      expect(result.errors).to include(
        have_attributes(
          code: 'SCHEMA_REF_NOT_FOUND',
          message: "$ref '#/definitions/Missing' not found"
        )
      )
    end
  end

  describe '.validate with Relations extension' do
    it 'accepts object identity arrays' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/extended/v0/#",
          "$id": "urn:example:relations-identity",
          "name": "OrderIdentity",
          "$uses": ["JSONStructureRelations"],
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "tenantId": { "type": "string" }
          },
          "identity": ["id", "tenantId"]
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_valid
      expect(result.error_messages).to be_empty
    end

    it 'accepts valid relation declarations' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/extended/v0/#",
          "$id": "urn:example:relations-valid",
          "name": "OrderRelations",
          "$uses": ["JSONStructureRelations"],
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "customerId": { "type": "string" },
            "itemIds": { "type": "array", "items": { "type": "string" } },
            "qualifier": { "type": "string" }
          },
          "relations": {
            "customer": {
              "cardinality": "single",
              "targettype": { "$ref": "#/definitions/Customer" }
            },
            "items": {
              "cardinality": "multiple",
              "targettype": { "$ref": "#/definitions/Item" },
              "scope": "line-items"
            },
            "qualifiedCustomer": {
              "cardinality": "single",
              "targettype": { "$ref": "#/definitions/Customer" },
              "qualifiertype": { "$ref": "#/definitions/RelationQualifier" }
            }
          },
          "definitions": {
            "Customer": {
              "name": "Customer",
              "type": "object",
              "properties": { "id": { "type": "string" } }
            },
            "Item": {
              "name": "Item",
              "type": "object",
              "properties": { "id": { "type": "string" } }
            },
            "RelationQualifier": {
              "name": "RelationQualifier",
              "type": "string"
            }
          }
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_valid
      expect(result.error_messages).to be_empty
    end

    it 'rejects invalid Relations schemas' do
      schema = <<~JSON
        {
          "$schema": "https://json-structure.org/meta/extended/v0/#",
          "$id": "urn:example:relations-invalid",
          "name": "BadRelations",
          "$uses": ["JSONStructureRelations"],
          "type": "string",
          "identity": ["id"],
          "relations": {
            "customer": {
              "cardinality": "many",
              "targettype": { "type": "object" },
              "scope": ["ok", 3],
              "qualifiertype": { "type": "string" }
            }
          }
        }
      JSON

      result = described_class.validate(schema)

      expect(result).to be_invalid
      expect(result.error_messages).to include("'identity' can only appear in object or tuple schemas.")
      expect(result.error_messages).to include("'identity' references property 'id' that is not in 'properties'.")
      expect(result.error_messages).to include("'relations' can only appear in object or tuple schemas.")
      expect(result.error_messages).to include("'targettype' must be an object with '$ref'.")
      expect(result.error_messages).to include("'cardinality' must be 'single' or 'multiple'.")
      expect(result.error_messages).to include("'scope' array items must be strings.")
      expect(result.error_messages).to include("'qualifiertype' must be an object with '$ref'.")
    end
  end
end
