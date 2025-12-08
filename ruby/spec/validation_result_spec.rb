# frozen_string_literal: true

require 'spec_helper'

RSpec.describe JsonStructure::ValidationResult do
  describe '#valid?' do
    it 'returns true for valid result' do
      result = described_class.new(true, [])
      expect(result).to be_valid
    end

    it 'returns false for invalid result' do
      result = described_class.new(false, [])
      expect(result).to be_invalid
    end
  end

  describe '#errors' do
    it 'returns empty array for valid result' do
      result = described_class.new(true, [])
      expect(result.errors).to be_empty
    end

    it 'returns error array for invalid result' do
      error = JsonStructure::ValidationError.new(
        code: 1,
        severity: JsonStructure::FFI::JS_SEVERITY_ERROR,
        path: '/test',
        message: 'Test error',
        location: { line: 1, column: 1, offset: 0 }
      )
      result = described_class.new(false, [error])

      expect(result.errors).not_to be_empty
      expect(result.errors.first).to be_a(JsonStructure::ValidationError)
    end
  end

  describe '#error_messages' do
    it 'returns only error-level messages' do
      errors = [
        JsonStructure::ValidationError.new(
          code: 1,
          severity: JsonStructure::FFI::JS_SEVERITY_ERROR,
          path: '/test',
          message: 'Error message',
          location: { line: 1, column: 1, offset: 0 }
        ),
        JsonStructure::ValidationError.new(
          code: 2,
          severity: JsonStructure::FFI::JS_SEVERITY_WARNING,
          path: '/test',
          message: 'Warning message',
          location: { line: 1, column: 1, offset: 0 }
        )
      ]
      result = described_class.new(false, errors)

      expect(result.error_messages).to eq(['Error message'])
    end
  end

  describe '#warning_messages' do
    it 'returns only warning-level messages' do
      errors = [
        JsonStructure::ValidationError.new(
          code: 1,
          severity: JsonStructure::FFI::JS_SEVERITY_ERROR,
          path: '/test',
          message: 'Error message',
          location: { line: 1, column: 1, offset: 0 }
        ),
        JsonStructure::ValidationError.new(
          code: 2,
          severity: JsonStructure::FFI::JS_SEVERITY_WARNING,
          path: '/test',
          message: 'Warning message',
          location: { line: 1, column: 1, offset: 0 }
        )
      ]
      result = described_class.new(false, errors)

      expect(result.warning_messages).to eq(['Warning message'])
    end
  end
end

RSpec.describe JsonStructure::ValidationError do
  describe '#error?' do
    it 'returns true for error severity' do
      error = described_class.new(
        code: 1,
        severity: JsonStructure::FFI::JS_SEVERITY_ERROR,
        path: '/test',
        message: 'Test',
        location: { line: 1, column: 1, offset: 0 }
      )

      expect(error).to be_error
    end

    it 'returns false for non-error severity' do
      warning = described_class.new(
        code: 1,
        severity: JsonStructure::FFI::JS_SEVERITY_WARNING,
        path: '/test',
        message: 'Test',
        location: { line: 1, column: 1, offset: 0 }
      )

      expect(warning).not_to be_error
    end
  end

  describe '#warning?' do
    it 'returns true for warning severity' do
      warning = described_class.new(
        code: 1,
        severity: JsonStructure::FFI::JS_SEVERITY_WARNING,
        path: '/test',
        message: 'Test',
        location: { line: 1, column: 1, offset: 0 }
      )

      expect(warning).to be_warning
    end
  end

  describe '#to_s' do
    it 'includes path when present' do
      error = described_class.new(
        code: 1,
        severity: JsonStructure::FFI::JS_SEVERITY_ERROR,
        path: '/test/path',
        message: 'Test error',
        location: { line: 1, column: 1, offset: 0 }
      )

      expect(error.to_s).to include('Test error')
      expect(error.to_s).to include('/test/path')
    end

    it 'works without path' do
      error = described_class.new(
        code: 1,
        severity: JsonStructure::FFI::JS_SEVERITY_ERROR,
        path: nil,
        message: 'Test error',
        location: { line: 1, column: 1, offset: 0 }
      )

      expect(error.to_s).to eq('Test error')
    end
  end
end
