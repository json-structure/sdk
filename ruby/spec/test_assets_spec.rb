# frozen_string_literal: true

require 'spec_helper'
require 'json'

# Test against the shared test-assets to ensure consistency with other SDKs
RSpec.describe 'Test Assets Conformance' do
  # Find test-assets directory relative to this file
  def find_test_assets_path
    current = File.dirname(__FILE__)
    
    # Try different relative paths
    candidates = [
      File.join(current, '..', '..', 'test-assets'),
      File.join(current, '..', '..', '..', 'test-assets'),
      File.join(current, '..', '..', 'sdk', 'test-assets')
    ]
    
    candidates.each do |path|
      expanded = File.expand_path(path)
      return expanded if File.directory?(expanded)
    end
    
    nil
  end

  let(:test_assets_path) { find_test_assets_path }

  before do
    skip 'test-assets directory not found' unless test_assets_path
  end

  describe 'Invalid Schemas' do
    let(:invalid_schemas_path) { File.join(test_assets_path, 'schemas', 'invalid') }

    it 'rejects all invalid schemas' do
      skip 'invalid schemas directory not found' unless File.directory?(invalid_schemas_path)

      schema_files = Dir.glob(File.join(invalid_schemas_path, '*.struct.json'))
      skip 'no invalid schema files found' if schema_files.empty?

      passed = 0
      failed = []

      schema_files.each do |file|
        schema_content = File.read(file)
        result = JsonStructure::SchemaValidator.validate(schema_content)

        if result.invalid?
          passed += 1
        else
          failed << File.basename(file)
        end
      end

      expect(failed).to be_empty,
        "Expected these schemas to be invalid but they were valid: #{failed.join(', ')}"
      
      puts "  Tested #{passed} invalid schemas - all correctly rejected"
    end
  end

  describe 'Valid Schemas (validation extension)' do
    let(:valid_schemas_path) { File.join(test_assets_path, 'schemas', 'validation') }

    it 'accepts all validation extension schemas' do
      skip 'validation schemas directory not found' unless File.directory?(valid_schemas_path)

      schema_files = Dir.glob(File.join(valid_schemas_path, '*.struct.json'))
      skip 'no validation schema files found' if schema_files.empty?

      passed = 0
      failed = []

      schema_files.each do |file|
        schema_content = File.read(file)
        result = JsonStructure::SchemaValidator.validate(schema_content)

        # Check for errors only, warnings are acceptable
        errors = result.errors.select { |e| e.severity == :error }
        if errors.empty?
          passed += 1
        else
          failed << "#{File.basename(file)}: #{result.error_messages.join(', ')}"
        end
      end

      expect(failed).to be_empty,
        "Expected these schemas to be valid but got errors:\n  #{failed.join("\n  ")}"
      
      puts "  Tested #{passed} validation schemas - all accepted"
    end
  end

  describe 'Instance Validation against test schemas' do
    let(:validation_instances_path) { File.join(test_assets_path, 'instances', 'validation') }
    let(:validation_schemas_path) { File.join(test_assets_path, 'schemas', 'validation') }

    # Known C SDK limitations - these validation keywords are not yet implemented
    # TODO: Remove from skip list as C SDK adds support
    let(:skip_schemas) do
      %w[
        object-minproperties-with-uses
      ]
    end

    it 'rejects invalid instances against their schemas' do
      skip 'validation instances directory not found' unless File.directory?(validation_instances_path)

      # Each schema has a corresponding directory with invalid instances
      schema_dirs = Dir.glob(File.join(validation_instances_path, '*')).select { |f| File.directory?(f) }
      skip 'no instance directories found' if schema_dirs.empty?

      passed = 0
      skipped = 0
      failed = []

      schema_dirs.each do |instance_dir|
        schema_name = File.basename(instance_dir)
        
        if skip_schemas.include?(schema_name)
          skipped += 1
          next
        end
        
        schema_file = File.join(validation_schemas_path, "#{schema_name}.struct.json")
        
        next unless File.exist?(schema_file)

        schema_content = File.read(schema_file)

        # Test invalid instances (files directly in the schema's instance directory)
        instance_files = Dir.glob(File.join(instance_dir, '*.json'))
        instance_files.each do |instance_file|
          instance_content = File.read(instance_file)
          result = JsonStructure::InstanceValidator.validate(instance_content, schema_content)

          if result.invalid?
            passed += 1
          else
            failed << "#{schema_name}/#{File.basename(instance_file)}"
          end
        end
      end

      expect(failed).to be_empty,
        "Expected these instances to be invalid but they were valid:\n  #{failed.join("\n  ")}"
      
      puts "  Tested #{passed} invalid instances - all correctly rejected (#{skipped} schemas skipped due to C SDK limitations)"
    end
  end

  describe 'Primer sample schemas' do
    def find_primer_samples_path
      current = File.dirname(__FILE__)
      
      candidates = [
        File.join(current, '..', '..', 'primer-and-samples', 'samples', 'core'),
        File.join(current, '..', '..', '..', 'primer-and-samples', 'samples', 'core')
      ]
      
      candidates.each do |path|
        expanded = File.expand_path(path)
        return expanded if File.directory?(expanded)
      end
      
      nil
    end

    let(:primer_path) { find_primer_samples_path }

    it 'accepts all primer sample schemas' do
      skip 'primer samples directory not found' unless primer_path

      # Find all .struct.json files recursively
      schema_files = Dir.glob(File.join(primer_path, '**', '*.struct.json'))
      skip 'no primer schema files found' if schema_files.empty?

      passed = 0
      failed = []

      schema_files.each do |file|
        schema_content = File.read(file)
        result = JsonStructure::SchemaValidator.validate(schema_content)

        # Check for errors only
        errors = result.errors.select { |e| e.severity == :error }
        if errors.empty?
          passed += 1
        else
          relative_path = file.sub(primer_path + '/', '')
          failed << "#{relative_path}: #{result.error_messages.join(', ')}"
        end
      end

      expect(failed).to be_empty,
        "Expected these primer schemas to be valid but got errors:\n  #{failed.join("\n  ")}"
      
      puts "  Tested #{passed} primer sample schemas - all accepted"
    end
  end
end
