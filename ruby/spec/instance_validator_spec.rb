# frozen_string_literal: true

require 'spec_helper'

RSpec.describe JsonStructure::InstanceValidator do
  describe '.validate' do
    context 'with valid instance' do
      it 'validates string against string schema' do
        schema = '{"type": "string"}'
        instance = '"hello"'
        result = described_class.validate(instance, schema)

        expect(result).to be_valid
        expect(result.errors).to be_empty
      end

      it 'validates integer against integer schema' do
        schema = '{"type": "integer"}'
        instance = '42'
        result = described_class.validate(instance, schema)

        expect(result).to be_valid
        expect(result.errors).to be_empty
      end

      it 'validates object against object schema' do
        schema = '{"type": "object", "properties": {"name": {"type": "string"}}}'
        instance = '{"name": "Alice"}'
        result = described_class.validate(instance, schema)

        expect(result).to be_valid
        expect(result.errors).to be_empty
      end

      it 'validates array against array schema' do
        schema = '{"type": "array", "items": {"type": "integer"}}'
        instance = '[1, 2, 3]'
        result = described_class.validate(instance, schema)

        expect(result).to be_valid
        expect(result.errors).to be_empty
      end
    end

    context 'with invalid instance' do
      it 'rejects wrong type' do
        schema = '{"type": "string"}'
        instance = '123'
        result = described_class.validate(instance, schema)

        expect(result).to be_invalid
        expect(result.errors).not_to be_empty
      end

      it 'rejects string too short' do
        schema = '{"type": "string", "minLength": 5}'
        instance = '"hi"'
        result = described_class.validate(instance, schema)

        expect(result).to be_invalid
        expect(result.errors).not_to be_empty
      end

      it 'rejects number out of range' do
        schema = '{"type": "integer", "minimum": 10}'
        instance = '5'
        result = described_class.validate(instance, schema)

        expect(result).to be_invalid
        expect(result.errors).not_to be_empty
      end
    end

    context 'error handling' do
      it 'raises ArgumentError for non-string instance' do
        schema = '{"type": "string"}'

        expect { described_class.validate(nil, schema) }.to raise_error(ArgumentError)
        expect { described_class.validate(123, schema) }.to raise_error(ArgumentError)
      end

      it 'raises ArgumentError for non-string schema' do
        instance = '"hello"'

        expect { described_class.validate(instance, nil) }.to raise_error(ArgumentError)
        expect { described_class.validate(instance, 123) }.to raise_error(ArgumentError)
      end
    end
  end

  describe '.validate!' do
    context 'with valid instance' do
      it 'returns result without raising' do
        schema = '{"type": "string"}'
        instance = '"hello"'
        result = described_class.validate!(instance, schema)

        expect(result).to be_valid
      end
    end

    context 'with invalid instance' do
      it 'raises InstanceValidationError' do
        schema = '{"type": "string"}'
        instance = '123'

        expect { described_class.validate!(instance, schema) }.to raise_error(JsonStructure::InstanceValidationError)
      end

      it 'includes validation errors in exception' do
        schema = '{"type": "string"}'
        instance = '123'

        begin
          described_class.validate!(instance, schema)
          fail 'Expected InstanceValidationError to be raised'
        rescue JsonStructure::InstanceValidationError => e
          expect(e.errors).not_to be_empty
          expect(e.result).to be_invalid
        end
      end
    end
  end
end
