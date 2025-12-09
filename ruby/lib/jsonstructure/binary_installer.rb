# frozen_string_literal: true

require 'fileutils'
require 'net/http'
require 'uri'
require 'rbconfig'

module JsonStructure
  # Downloads and installs pre-built C library binaries from GitHub releases
  class BinaryInstaller
    REPO = 'json-structure/sdk'
    DEFAULT_VERSION = 'v0.1.0'

    attr_reader :version, :platform, :lib_dir

    def initialize(version: nil)
      @version = version || DEFAULT_VERSION
      @platform = detect_platform
      @lib_dir = File.expand_path('../../ext', __dir__)
    end

    def install
      FileUtils.mkdir_p(lib_dir)

      if binary_exists?
        puts "Binary already installed at #{binary_path}"
        return true
      end

      puts "Downloading C library binary for #{platform}..."
      download_binary
      puts "Binary installed successfully at #{binary_path}"
      true
    rescue StandardError => e
      warn "Failed to download binary: #{e.message}"
      warn "You may need to build the C library manually."
      false
    end

    def binary_exists?
      File.exist?(binary_path)
    end

    def binary_path
      File.join(lib_dir, binary_name)
    end

    private

    def detect_platform
      os = RbConfig::CONFIG['host_os']
      arch = RbConfig::CONFIG['host_cpu']

      case os
      when /darwin|mac os/
        "macos-#{normalize_arch(arch)}"
      when /linux/
        "linux-#{normalize_arch(arch)}"
      when /mswin|msys|mingw|cygwin|bccwin|wince|emc/
        "windows-#{normalize_arch(arch)}"
      else
        raise "Unsupported platform: #{os}"
      end
    end

    def normalize_arch(arch)
      case arch
      when /x86_64|x64|amd64/
        'x86_64'
      when /aarch64|arm64/
        'arm64'
      when /arm/
        'arm'
      else
        arch
      end
    end

    def binary_name
      case RbConfig::CONFIG['host_os']
      when /darwin|mac os/
        'libjson_structure.dylib'
      when /mswin|msys|mingw|cygwin|bccwin|wince|emc/
        'json_structure.dll'
      else
        'libjson_structure.so'
      end
    end

    def download_url
      # Try to get from GitHub releases
      # Format: https://github.com/json-structure/sdk/releases/download/v0.1.0/json_structure-macos-x86_64.tar.gz
      "https://github.com/#{REPO}/releases/download/#{version}/json_structure-#{platform}.tar.gz"
    end

    def download_binary
      uri = URI(download_url)
      response = fetch_with_redirects(uri)

      unless response.is_a?(Net::HTTPSuccess)
        raise "Failed to download binary from #{download_url}: HTTP #{response.code}"
      end

      # Save and extract tarball
      tarball_path = File.join(lib_dir, 'binary.tar.gz')
      File.binwrite(tarball_path, response.body)

      # Extract tarball
      Dir.chdir(lib_dir) do
        system('tar', '-xzf', 'binary.tar.gz') || raise('Failed to extract tarball')
        FileUtils.rm('binary.tar.gz')
      end

      # Verify the binary was extracted
      raise "Binary not found after extraction: #{binary_path}" unless File.exist?(binary_path)
    end

    def fetch_with_redirects(uri, limit = 10)
      raise 'Too many HTTP redirects' if limit.zero?

      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = (uri.scheme == 'https')
      request = Net::HTTP::Get.new(uri.request_uri)
      response = http.request(request)

      case response
      when Net::HTTPRedirection
        fetch_with_redirects(URI(response['location']), limit - 1)
      else
        response
      end
    end
  end
end
