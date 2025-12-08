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
end
