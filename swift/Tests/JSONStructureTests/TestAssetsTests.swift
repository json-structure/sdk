// JSONStructure Swift SDK Tests
// Test Assets Integration Tests
// Validates all schemas and instances from test-assets directory

import XCTest
import Foundation
@testable import JSONStructure

/// Test Assets Integration Tests
/// Tests validation against all schema and instance files in test-assets/
final class TestAssetsTests: XCTestCase {
    
    // MARK: - Helper Methods
    
    /// Returns the path to test-assets directory.
    static func getTestAssetsPath() -> String? {
        // Try from current working directory
        let cwd = FileManager.default.currentDirectoryPath
        
        // Try going up from swift/ directory
        var testAssetsPath = (cwd as NSString).appendingPathComponent("../test-assets")
        if FileManager.default.fileExists(atPath: testAssetsPath) {
            return testAssetsPath
        }
        
        // Try from repository root
        testAssetsPath = (cwd as NSString).appendingPathComponent("test-assets")
        if FileManager.default.fileExists(atPath: testAssetsPath) {
            return testAssetsPath
        }
        
        // Try two levels up (from swift/.build/debug)
        testAssetsPath = (cwd as NSString).appendingPathComponent("../../test-assets")
        if FileManager.default.fileExists(atPath: testAssetsPath) {
            return testAssetsPath
        }
        
        // Try three levels up
        testAssetsPath = (cwd as NSString).appendingPathComponent("../../../test-assets")
        if FileManager.default.fileExists(atPath: testAssetsPath) {
            return testAssetsPath
        }
        
        return nil
    }
    
    /// Gets all files matching pattern in directory.
    static func getFiles(inDirectory dir: String, withExtension ext: String) -> [String] {
        guard FileManager.default.fileExists(atPath: dir) else { return [] }
        
        do {
            let contents = try FileManager.default.contentsOfDirectory(atPath: dir)
            return contents
                .filter { $0.hasSuffix(ext) }
                .map { (dir as NSString).appendingPathComponent($0) }
                .sorted()
        } catch {
            return []
        }
    }
    
    /// Gets all subdirectories.
    static func getDirectories(inDirectory dir: String) -> [String] {
        guard FileManager.default.fileExists(atPath: dir) else { return [] }
        
        do {
            let contents = try FileManager.default.contentsOfDirectory(atPath: dir)
            return contents
                .map { (dir as NSString).appendingPathComponent($0) }
                .filter { isDirectory($0) }
                .sorted()
        } catch {
            return []
        }
    }
    
    /// Checks if path is a directory.
    static func isDirectory(_ path: String) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &isDir) && isDir.boolValue
    }
    
    /// Loads JSON from file.
    static func loadJSON(from path: String) -> Any? {
        guard let data = FileManager.default.contents(atPath: path) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }
    
    /// Cleans instance by removing underscore-prefixed metadata fields.
    static func cleanInstance(_ instance: Any) -> Any {
        if let map = instance as? [String: Any] {
            var clean = [String: Any]()
            for (key, value) in map {
                if !key.hasPrefix("_") {
                    clean[key] = cleanInstance(value)
                }
            }
            return clean
        }
        if let arr = instance as? [Any] {
            return arr.map { cleanInstance($0) }
        }
        return instance
    }
    
    // MARK: - Invalid Schema Tests
    
    /// Tests that all invalid schemas in test-assets fail validation.
    func testInvalidSchemas() throws {
        guard let testAssetsPath = Self.getTestAssetsPath() else {
            throw XCTSkip("test-assets not found")
        }
        
        let invalidDir = (testAssetsPath as NSString).appendingPathComponent("schemas/invalid")
        let files = Self.getFiles(inDirectory: invalidDir, withExtension: ".struct.json")
        
        guard !files.isEmpty else {
            throw XCTSkip("No invalid schema files found")
        }
        
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        for file in files {
            let name = (file as NSString).lastPathComponent
            
            guard let data = FileManager.default.contents(atPath: file),
                  let schema = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                XCTFail("Failed to load schema: \(name)")
                continue
            }
            
            let result = validator.validate(schema)
            XCTAssertFalse(result.isValid, "Schema \(name) should be INVALID")
        }
    }
    
    /// Tests count of invalid schemas.
    func testInvalidSchemasCount() throws {
        guard let testAssetsPath = Self.getTestAssetsPath() else {
            throw XCTSkip("test-assets not found")
        }
        
        let invalidDir = (testAssetsPath as NSString).appendingPathComponent("schemas/invalid")
        let files = Self.getFiles(inDirectory: invalidDir, withExtension: ".struct.json")
        
        XCTAssertGreaterThanOrEqual(files.count, 25, "Expected at least 25 invalid schemas, got \(files.count)")
    }
    
    // MARK: - Validation Schema Tests
    
    /// Tests that all validation schemas are valid.
    func testValidationSchemas() throws {
        guard let testAssetsPath = Self.getTestAssetsPath() else {
            throw XCTSkip("test-assets not found")
        }
        
        let validationDir = (testAssetsPath as NSString).appendingPathComponent("schemas/validation")
        let files = Self.getFiles(inDirectory: validationDir, withExtension: ".struct.json")
        
        guard !files.isEmpty else {
            throw XCTSkip("No validation schema files found")
        }
        
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        for file in files {
            let name = (file as NSString).lastPathComponent
            
            guard let data = FileManager.default.contents(atPath: file),
                  let schema = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                XCTFail("Failed to load schema: \(name)")
                continue
            }
            
            let result = validator.validate(schema)
            XCTAssertTrue(result.isValid, "Validation schema \(name) should be VALID. Errors: \(result.errors)")
        }
    }
    
    // MARK: - Validation Instance Tests
    
    /// Tests validation instances against their corresponding schemas.
    func testValidationInstances() throws {
        guard let testAssetsPath = Self.getTestAssetsPath() else {
            throw XCTSkip("test-assets not found")
        }
        
        let validationDir = (testAssetsPath as NSString).appendingPathComponent("instances/validation")
        let schemaDir = (testAssetsPath as NSString).appendingPathComponent("schemas/validation")
        let instanceDirs = Self.getDirectories(inDirectory: validationDir)
        
        guard !instanceDirs.isEmpty else {
            throw XCTSkip("No validation instance directories found")
        }
        
        for instanceDir in instanceDirs {
            let categoryName = (instanceDir as NSString).lastPathComponent
            
            // Find matching schema
            let schemaPath = (schemaDir as NSString).appendingPathComponent("\(categoryName).struct.json")
            guard let schemaData = FileManager.default.contents(atPath: schemaPath),
                  let schema = try? JSONSerialization.jsonObject(with: schemaData) as? [String: Any] else {
                continue // Skip if schema not found
            }
            
            let schemaType = schema["type"] as? String ?? "object"
            let valueWrapperTypes = ["string", "number", "integer", "boolean", "int8", "uint8",
                                      "int16", "uint16", "int32", "uint32", "float", "double", "decimal",
                                      "array", "set", "int64", "uint64"]
            
            // Get instance files
            let instanceFiles = Self.getFiles(inDirectory: instanceDir, withExtension: ".json")
            
            for instanceFile in instanceFiles {
                let instanceName = (instanceFile as NSString).lastPathComponent
                
                guard let instanceData = FileManager.default.contents(atPath: instanceFile),
                      let rawInstance = try? JSONSerialization.jsonObject(with: instanceData) else {
                    XCTFail("Failed to load instance: \(categoryName)/\(instanceName)")
                    continue
                }
                
                guard let instanceMap = rawInstance as? [String: Any] else {
                    continue // Skip non-object instances
                }
                
                // Extract metadata
                let expectedError = instanceMap["_expectedError"] as? String
                // If _expectedError is present, the instance is expected to be invalid
                let expectedValid = instanceMap["_expectedValid"] as? Bool ?? (expectedError == nil)
                
                // Get instance for validation
                var instance: Any
                if let val = instanceMap["value"], valueWrapperTypes.contains(schemaType) {
                    instance = val
                } else {
                    instance = Self.cleanInstance(instanceMap)
                }
                
                let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
                let result = validator.validate(instance, schema: schema)
                
                if expectedValid {
                    XCTAssertTrue(result.isValid, "\(categoryName)/\(instanceName) should be VALID. Errors: \(result.errors)")
                } else {
                    XCTAssertFalse(result.isValid, "\(categoryName)/\(instanceName) should be INVALID")
                    
                    if let expectedCode = expectedError, !expectedCode.isEmpty {
                        let hasExpectedError = result.errors.contains { $0.code == expectedCode }
                        XCTAssertTrue(hasExpectedError, "\(categoryName)/\(instanceName) should have error code \(expectedCode), got: \(result.errors.map { $0.code })")
                    }
                }
            }
        }
    }
    
    // MARK: - Warning Schema Tests
    
    /// Tests that warning schemas produce appropriate warnings.
    func testWarningSchemas() throws {
        guard let testAssetsPath = Self.getTestAssetsPath() else {
            throw XCTSkip("test-assets not found")
        }
        
        let warningsDir = (testAssetsPath as NSString).appendingPathComponent("schemas/warnings")
        let files = Self.getFiles(inDirectory: warningsDir, withExtension: ".struct.json")
        
        guard !files.isEmpty else {
            throw XCTSkip("No warning schema files found")
        }
        
        for file in files {
            let name = (file as NSString).lastPathComponent
            let hasUsesInName = name.contains("with-uses")
            
            guard let data = FileManager.default.contents(atPath: file),
                  let schema = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                XCTFail("Failed to load schema: \(name)")
                continue
            }
            
            let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
            let result = validator.validate(schema)
            
            XCTAssertTrue(result.isValid, "Warning schema \(name) should be valid. Errors: \(result.errors)")
            
            if hasUsesInName {
                // Schemas with $uses should NOT produce extension keyword warnings
                let hasExtensionWarning = result.warnings.contains { $0.code == schemaExtensionKeywordNotEnabled }
                XCTAssertFalse(hasExtensionWarning, "Schema \(name) with $uses should not produce extension warnings")
            } else {
                // Schemas without $uses SHOULD produce extension keyword warnings
                let hasExtensionWarning = result.warnings.contains { $0.code == schemaExtensionKeywordNotEnabled }
                XCTAssertTrue(hasExtensionWarning, "Schema \(name) without $uses should produce extension warnings")
            }
        }
    }
    
    // MARK: - Adversarial Tests
    
    /// Known invalid adversarial schemas.
    static let invalidAdversarialSchemas: Set<String> = [
        "ref-to-nowhere.struct.json",
        "malformed-json-pointer.struct.json",
        "self-referencing-extends.struct.json",
        "extends-circular-chain.struct.json"
    ]
    
    /// Tests that adversarial schemas are handled correctly (no crashes).
    func testAdversarialSchemas() throws {
        guard let testAssetsPath = Self.getTestAssetsPath() else {
            throw XCTSkip("test-assets not found")
        }
        
        let adversarialDir = (testAssetsPath as NSString).appendingPathComponent("schemas/adversarial")
        let files = Self.getFiles(inDirectory: adversarialDir, withExtension: ".struct.json")
        
        guard !files.isEmpty else {
            throw XCTSkip("No adversarial schema files found")
        }
        
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        for file in files {
            let name = (file as NSString).lastPathComponent
            
            guard let data = FileManager.default.contents(atPath: file),
                  let schema = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                continue
            }
            
            let result = validator.validate(schema)
            
            // Check if this schema MUST be invalid
            if Self.invalidAdversarialSchemas.contains(name) {
                XCTAssertFalse(result.isValid, "Adversarial schema \(name) should be invalid")
            }
            // Otherwise just verify it returns a result without crashing
        }
    }
    
    /// Instance to schema mapping for adversarial tests.
    static let adversarialInstanceSchemaMap: [String: String] = [
        "deep-nesting.json": "deep-nesting-100.struct.json",
        "recursive-tree.json": "recursive-array-items.struct.json",
        "property-name-edge-cases.json": "property-name-edge-cases.struct.json",
        "unicode-edge-cases.json": "unicode-edge-cases.struct.json",
        "string-length-surrogate.json": "string-length-surrogate.struct.json",
        "int64-precision.json": "int64-precision-loss.struct.json",
        "floating-point.json": "floating-point-precision.struct.json",
        "null-edge-cases.json": "null-edge-cases.struct.json",
        "empty-collections-invalid.json": "empty-arrays-objects.struct.json",
        "redos-attack.json": "redos-pattern.struct.json",
        "allof-conflict.json": "allof-conflicting-types.struct.json",
        "oneof-all-match.json": "oneof-all-match.struct.json",
        "type-union-int.json": "type-union-ambiguous.struct.json",
        "type-union-number.json": "type-union-ambiguous.struct.json",
        "conflicting-constraints.json": "conflicting-constraints.struct.json",
        "format-invalid.json": "format-edge-cases.struct.json",
        "format-valid.json": "format-edge-cases.struct.json",
        "pattern-flags.json": "pattern-with-flags.struct.json",
        "additionalProperties-combined.json": "additionalProperties-combined.struct.json",
        "extends-override.json": "extends-with-overrides.struct.json",
        "quadratic-blowup.json": "quadratic-blowup.struct.json",
        "anyof-none-match.json": "anyof-none-match.struct.json"
    ]
    
    /// Tests that adversarial instances don't crash the validator.
    func testAdversarialInstances() throws {
        guard let testAssetsPath = Self.getTestAssetsPath() else {
            throw XCTSkip("test-assets not found")
        }
        
        let adversarialInstanceDir = (testAssetsPath as NSString).appendingPathComponent("instances/adversarial")
        let adversarialSchemaDir = (testAssetsPath as NSString).appendingPathComponent("schemas/adversarial")
        let files = Self.getFiles(inDirectory: adversarialInstanceDir, withExtension: ".json")
        
        guard !files.isEmpty else {
            throw XCTSkip("No adversarial instance files found")
        }
        
        for file in files {
            let instanceName = (file as NSString).lastPathComponent
            
            guard let schemaName = Self.adversarialInstanceSchemaMap[instanceName] else {
                continue // Skip instances without schema mapping
            }
            
            let schemaPath = (adversarialSchemaDir as NSString).appendingPathComponent(schemaName)
            guard let schemaData = FileManager.default.contents(atPath: schemaPath),
                  let schema = try? JSONSerialization.jsonObject(with: schemaData) as? [String: Any] else {
                continue
            }
            
            guard let instanceData = FileManager.default.contents(atPath: file),
                  var instance = try? JSONSerialization.jsonObject(with: instanceData) as? [String: Any] else {
                continue
            }
            
            // Remove $schema from instance
            instance.removeValue(forKey: "$schema")
            
            let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
            
            // Should complete without crashing
            let result = validator.validate(instance, schema: schema)
            
            // Just verify it returns a result (valid or invalid)
            _ = result.isValid
        }
    }
    
    // MARK: - Invalid Instance Tests
    
    /// Returns the samples path.
    static func getSamplesPath() -> String? {
        guard let testAssetsPath = getTestAssetsPath() else { return nil }
        // test-assets is in sdk/, primer-and-samples is also in sdk/
        let samplesPath = (testAssetsPath as NSString).deletingLastPathComponent
        return (samplesPath as NSString).appendingPathComponent("primer-and-samples/samples/core")
    }
    
    /// Tests that all invalid instances fail validation.
    func testInvalidInstances() throws {
        guard let testAssetsPath = Self.getTestAssetsPath() else {
            throw XCTSkip("test-assets not found")
        }
        
        guard let samplesPath = Self.getSamplesPath(),
              FileManager.default.fileExists(atPath: samplesPath) else {
            throw XCTSkip("Samples path not found")
        }
        
        let invalidDir = (testAssetsPath as NSString).appendingPathComponent("instances/invalid")
        let instanceDirs = Self.getDirectories(inDirectory: invalidDir)
        
        guard !instanceDirs.isEmpty else {
            throw XCTSkip("No invalid instance directories found")
        }
        
        for instanceDir in instanceDirs {
            let sampleName = (instanceDir as NSString).lastPathComponent
            
            // Load schema from samples
            let schemaPath = (samplesPath as NSString).appendingPathComponent("\(sampleName)/schema.struct.json")
            guard let schemaData = FileManager.default.contents(atPath: schemaPath),
                  let schema = try? JSONSerialization.jsonObject(with: schemaData) as? [String: Any] else {
                continue // Skip if schema not found
            }
            
            let instanceFiles = Self.getFiles(inDirectory: instanceDir, withExtension: ".json")
            
            for instanceFile in instanceFiles {
                let instanceName = (instanceFile as NSString).lastPathComponent
                
                guard let instanceData = FileManager.default.contents(atPath: instanceFile),
                      let rawInstance = try? JSONSerialization.jsonObject(with: instanceData) else {
                    XCTFail("Failed to load instance: \(sampleName)/\(instanceName)")
                    continue
                }
                
                let instance = Self.cleanInstance(rawInstance)
                let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
                let result = validator.validate(instance, schema: schema)
                
                XCTAssertFalse(result.isValid, "\(sampleName)/\(instanceName) should be INVALID")
            }
        }
    }
    
    // MARK: - Valid Sample Tests
    
    /// Tests that all sample schemas are valid.
    func testValidSampleSchemas() throws {
        guard let samplesPath = Self.getSamplesPath(),
              FileManager.default.fileExists(atPath: samplesPath) else {
            throw XCTSkip("Samples path not found")
        }
        
        let sampleDirs = Self.getDirectories(inDirectory: samplesPath)
        
        guard !sampleDirs.isEmpty else {
            throw XCTSkip("No sample directories found")
        }
        
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        for sampleDir in sampleDirs {
            let sampleName = (sampleDir as NSString).lastPathComponent
            let schemaPath = (sampleDir as NSString).appendingPathComponent("schema.struct.json")
            
            guard let schemaData = FileManager.default.contents(atPath: schemaPath),
                  let schema = try? JSONSerialization.jsonObject(with: schemaData) as? [String: Any] else {
                continue
            }
            
            let result = validator.validate(schema)
            XCTAssertTrue(result.isValid, "Sample schema \(sampleName) should be valid. Errors: \(result.errors)")
        }
    }
    
    /// Tests that all valid sample instances pass validation.
    func testValidSampleInstances() throws {
        guard let samplesPath = Self.getSamplesPath(),
              FileManager.default.fileExists(atPath: samplesPath) else {
            throw XCTSkip("Samples path not found")
        }
        
        let sampleDirs = Self.getDirectories(inDirectory: samplesPath)
        
        guard !sampleDirs.isEmpty else {
            throw XCTSkip("No sample directories found")
        }
        
        for sampleDir in sampleDirs {
            let sampleName = (sampleDir as NSString).lastPathComponent
            let schemaPath = (sampleDir as NSString).appendingPathComponent("schema.struct.json")
            
            guard let schemaData = FileManager.default.contents(atPath: schemaPath),
                  let schema = try? JSONSerialization.jsonObject(with: schemaData) as? [String: Any] else {
                continue
            }
            
            // Find valid instance files
            let allFiles = Self.getFiles(inDirectory: sampleDir, withExtension: ".json")
            let validInstanceFiles = allFiles.filter { 
                let name = ($0 as NSString).lastPathComponent
                return name.hasPrefix("valid")
            }
            
            for instanceFile in validInstanceFiles {
                let instanceName = (instanceFile as NSString).lastPathComponent
                
                guard let instanceData = FileManager.default.contents(atPath: instanceFile),
                      let rawInstance = try? JSONSerialization.jsonObject(with: instanceData) else {
                    XCTFail("Failed to load instance: \(sampleName)/\(instanceName)")
                    continue
                }
                
                let instance = Self.cleanInstance(rawInstance)
                let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
                let result = validator.validate(instance, schema: schema)
                
                XCTAssertTrue(result.isValid, "\(sampleName)/\(instanceName) should be VALID. Errors: \(result.errors)")
            }
        }
    }
}
