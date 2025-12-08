# frozen_string_literal: true

require_relative 'lib/json_structure/version'

Gem::Specification.new do |spec|
  spec.name = 'json_structure'
  spec.version = JsonStructure::VERSION
  spec.authors = ['JSON Structure Contributors']
  spec.email = ['']

  spec.summary = 'Ruby FFI bindings for JSON Structure schema validator'
  spec.description = 'JSON Structure SDK for Ruby using FFI bindings to the C library. ' \
                     'Provides schema validation and instance validation for JSON Structure schemas.'
  spec.homepage = 'https://github.com/json-structure/sdk'
  spec.license = 'MIT'
  spec.required_ruby_version = '>= 2.7.0'

  spec.metadata['homepage_uri'] = spec.homepage
  spec.metadata['source_code_uri'] = 'https://github.com/json-structure/sdk'
  spec.metadata['changelog_uri'] = 'https://github.com/json-structure/sdk/blob/main/CHANGELOG.md'

  # Specify which files should be added to the gem when it is released.
  spec.files = Dir.glob('{lib,spec}/**/*') + %w[
    Gemfile
    Rakefile
    README.md
  ]
  spec.bindir = 'exe'
  spec.executables = spec.files.grep(%r{\Aexe/}) { |f| File.basename(f) }
  spec.require_paths = ['lib']

  # Runtime dependencies
  spec.add_dependency 'ffi', '~> 1.15'

  # Development dependencies
  spec.add_development_dependency 'rake', '~> 13.0'
  spec.add_development_dependency 'rspec', '~> 3.0'
end
