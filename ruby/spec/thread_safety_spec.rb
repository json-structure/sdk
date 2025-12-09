# frozen_string_literal: true

require 'spec_helper'

RSpec.describe 'Thread Safety' do
  let(:valid_schema) { '{"type": "object", "properties": {"name": {"type": "string"}}}' }
  let(:valid_instance) { '{"name": "test"}' }
  let(:invalid_instance) { '{"name": 123}' }

  describe 'concurrent schema validation' do
    it 'handles multiple threads validating schemas concurrently' do
      thread_count = 10
      iterations = 50
      errors = []
      mutex = Mutex.new

      threads = thread_count.times.map do |thread_id|
        Thread.new do
          iterations.times do |i|
            begin
              result = JsonStructure::SchemaValidator.validate(valid_schema)
              unless result.valid?
                mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i}: expected valid, got invalid" }
              end
            rescue => e
              mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i}: #{e.class} - #{e.message}" }
            end
          end
        end
      end

      threads.each(&:join)
      expect(errors).to be_empty, "Errors occurred during concurrent validation:\n#{errors.join("\n")}"
    end

    it 'handles mixed valid and invalid schemas concurrently' do
      thread_count = 10
      iterations = 20
      errors = []
      mutex = Mutex.new

      schemas = [
        { json: '{"type": "string"}', valid: true },
        { json: '{"type": "invalid_type"}', valid: false },
        { json: '{"type": "object", "properties": {"a": {"type": "integer"}}}', valid: true },
        { json: '{"minimum": "not_a_number"}', valid: false }
      ]

      threads = thread_count.times.map do |thread_id|
        Thread.new do
          iterations.times do |i|
            schema_info = schemas[(thread_id + i) % schemas.length]
            begin
              result = JsonStructure::SchemaValidator.validate(schema_info[:json])
              if result.valid? != schema_info[:valid]
                mutex.synchronize do
                  errors << "Thread #{thread_id}, iteration #{i}: expected #{schema_info[:valid]}, got #{result.valid?}"
                end
              end
            rescue => e
              mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i}: #{e.class} - #{e.message}" }
            end
          end
        end
      end

      threads.each(&:join)
      expect(errors).to be_empty, "Errors occurred during concurrent validation:\n#{errors.join("\n")}"
    end
  end

  describe 'concurrent instance validation' do
    it 'handles multiple threads validating instances concurrently' do
      thread_count = 10
      iterations = 50
      errors = []
      mutex = Mutex.new

      threads = thread_count.times.map do |thread_id|
        Thread.new do
          iterations.times do |i|
            begin
              result = JsonStructure::InstanceValidator.validate(valid_instance, valid_schema)
              unless result.valid?
                mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i}: expected valid, got invalid" }
              end
            rescue => e
              mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i}: #{e.class} - #{e.message}" }
            end
          end
        end
      end

      threads.each(&:join)
      expect(errors).to be_empty, "Errors occurred during concurrent validation:\n#{errors.join("\n")}"
    end

    it 'handles mixed valid and invalid instances concurrently' do
      thread_count = 10
      iterations = 20
      errors = []
      mutex = Mutex.new

      test_cases = [
        { instance: '{"name": "Alice"}', valid: true },
        { instance: '{"name": 123}', valid: false },
        { instance: '{"name": "Bob", "age": 30}', valid: true },
        { instance: '{}', valid: true }
      ]

      threads = thread_count.times.map do |thread_id|
        Thread.new do
          iterations.times do |i|
            test_case = test_cases[(thread_id + i) % test_cases.length]
            begin
              result = JsonStructure::InstanceValidator.validate(test_case[:instance], valid_schema)
              if result.valid? != test_case[:valid]
                mutex.synchronize do
                  errors << "Thread #{thread_id}, iteration #{i}: expected #{test_case[:valid]}, got #{result.valid?}"
                end
              end
            rescue => e
              mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i}: #{e.class} - #{e.message}" }
            end
          end
        end
      end

      threads.each(&:join)
      expect(errors).to be_empty, "Errors occurred during concurrent validation:\n#{errors.join("\n")}"
    end
  end

  describe 'mixed concurrent operations' do
    it 'handles schema and instance validations running concurrently' do
      thread_count = 10
      iterations = 30
      errors = []
      mutex = Mutex.new

      threads = thread_count.times.map do |thread_id|
        Thread.new do
          iterations.times do |i|
            begin
              if i.even?
                # Schema validation
                result = JsonStructure::SchemaValidator.validate(valid_schema)
                unless result.valid?
                  mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i} (schema): expected valid" }
                end
              else
                # Instance validation
                result = JsonStructure::InstanceValidator.validate(valid_instance, valid_schema)
                unless result.valid?
                  mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i} (instance): expected valid" }
                end
              end
            rescue => e
              mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i}: #{e.class} - #{e.message}" }
            end
          end
        end
      end

      threads.each(&:join)
      expect(errors).to be_empty, "Errors occurred during concurrent validation:\n#{errors.join("\n")}"
    end
  end

  describe 'validation tracking' do
    it 'properly tracks active validations' do
      # Initially no validations should be active
      expect(JsonStructure.validations_active?).to be false
    end

    it 'handles validation_started and validation_completed correctly' do
      # Start a validation
      JsonStructure.validation_started
      expect(JsonStructure.validations_active?).to be true

      # Complete the validation
      JsonStructure.validation_completed
      expect(JsonStructure.validations_active?).to be false
    end

    it 'handles multiple concurrent validation tracking' do
      # Start multiple validations
      5.times { JsonStructure.validation_started }
      expect(JsonStructure.validations_active?).to be true

      # Complete them all
      5.times { JsonStructure.validation_completed }
      expect(JsonStructure.validations_active?).to be false
    end
  end

  describe 'stress test' do
    it 'survives high-concurrency stress test' do
      thread_count = 20
      iterations = 100
      errors = []
      mutex = Mutex.new

      schemas = [
        '{"type": "string"}',
        '{"type": "integer", "minimum": 0}',
        '{"type": "object", "properties": {"id": {"type": "integer"}}}',
        '{"type": "array", "items": {"type": "string"}}'
      ]

      instances = [
        ['"hello"', '{"type": "string"}', true],
        ['42', '{"type": "integer", "minimum": 0}', true],
        ['{"id": 123}', '{"type": "object", "properties": {"id": {"type": "integer"}}}', true],
        ['["a", "b", "c"]', '{"type": "array", "items": {"type": "string"}}', true],
        ['"hello"', '{"type": "integer"}', false],
        ['-5', '{"type": "integer", "minimum": 0}', false]
      ]

      threads = thread_count.times.map do |thread_id|
        Thread.new do
          iterations.times do |i|
            begin
              case i % 3
              when 0
                # Schema validation
                schema = schemas[rand(schemas.length)]
                JsonStructure::SchemaValidator.validate(schema)
              when 1
                # Instance validation with expected result
                instance_info = instances[rand(instances.length)]
                result = JsonStructure::InstanceValidator.validate(instance_info[0], instance_info[1])
                if result.valid? != instance_info[2]
                  mutex.synchronize do
                    errors << "Thread #{thread_id}, iteration #{i}: unexpected result for #{instance_info[0]}"
                  end
                end
              when 2
                # validate! with exception handling
                begin
                  JsonStructure::SchemaValidator.validate!('{"type": "string"}')
                rescue JsonStructure::SchemaValidationError
                  mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i}: unexpected exception" }
                end
              end
            rescue => e
              mutex.synchronize { errors << "Thread #{thread_id}, iteration #{i}: #{e.class} - #{e.message}" }
            end
          end
        end
      end

      threads.each(&:join)
      expect(errors).to be_empty, "Errors occurred during stress test:\n#{errors.first(10).join("\n")}"
    end
  end
end
