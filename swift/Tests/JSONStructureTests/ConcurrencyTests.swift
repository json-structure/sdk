// JSONStructure Swift SDK
// Thread Safety and Concurrency Tests

import XCTest
@testable import JSONStructure

/// Tests for thread safety and concurrent usage of validators.
final class ConcurrencyTests: XCTestCase {
    
    // MARK: - DispatchQueue Tests
    
    /// Test InstanceValidator with concurrent DispatchQueue operations.
    func testInstanceValidatorThreadSafety() {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test:person",
            "name": "Person",
            "type": "object",
            "properties": [
                "name": ["type": "string"],
                "age": ["type": "int32"]
            ],
            "required": ["name"]
        ]
        
        let validInstance: [String: Any] = [
            "name": "Alice",
            "age": 30
        ]
        
        let invalidInstance: [String: Any] = [
            "age": "not a number"
        ]
        
        // Run 100 concurrent validations
        let iterations = 100
        var results: [ValidationResult?] = Array(repeating: nil, count: iterations)
        
        DispatchQueue.concurrentPerform(iterations: iterations) { i in
            // Alternate between valid and invalid instances
            let instance = (i % 2 == 0) ? validInstance : invalidInstance
            results[i] = validator.validate(instance, schema: schema)
        }
        
        // Verify all results
        for i in 0..<iterations {
            guard let result = results[i] else {
                XCTFail("Result \(i) is nil")
                continue
            }
            
            if i % 2 == 0 {
                // Valid instances
                XCTAssertTrue(result.isValid, "Result \(i) should be valid")
                XCTAssertTrue(result.errors.isEmpty, "Result \(i) should have no errors")
            } else {
                // Invalid instances
                XCTAssertFalse(result.isValid, "Result \(i) should be invalid")
                XCTAssertFalse(result.errors.isEmpty, "Result \(i) should have errors")
            }
        }
    }
    
    /// Test SchemaValidator with concurrent DispatchQueue operations.
    func testSchemaValidatorThreadSafety() {
        let validator = SchemaValidator()
        
        let validSchema: [String: Any] = [
            "$id": "urn:test:valid",
            "name": "ValidSchema",
            "type": "string"
        ]
        
        let invalidSchema: [String: Any] = [
            // Missing required $id and name
            "type": "unknown-type"
        ]
        
        // Run 100 concurrent validations
        let iterations = 100
        var results: [ValidationResult?] = Array(repeating: nil, count: iterations)
        
        DispatchQueue.concurrentPerform(iterations: iterations) { i in
            // Alternate between valid and invalid schemas
            let schema = (i % 2 == 0) ? validSchema : invalidSchema
            results[i] = validator.validate(schema)
        }
        
        // Verify all results
        for i in 0..<iterations {
            guard let result = results[i] else {
                XCTFail("Result \(i) is nil")
                continue
            }
            
            if i % 2 == 0 {
                // Valid schemas
                XCTAssertTrue(result.isValid, "Result \(i) should be valid")
            } else {
                // Invalid schemas
                XCTAssertFalse(result.isValid, "Result \(i) should be invalid")
            }
        }
    }
    
    // MARK: - Swift Concurrency Tests
    
    /// Test InstanceValidator with Task groups (Swift Concurrency).
    func testInstanceValidatorSwiftConcurrency() async {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test:number",
            "name": "Number",
            "type": "int32"
        ]
        
        // Create 50 validation tasks
        await withTaskGroup(of: (Int, ValidationResult).self) { group in
            for i in 0..<50 {
                group.addTask {
                    let instance: Any = i % 2 == 0 ? 42 : "not a number"
                    let result = validator.validate(instance, schema: schema)
                    return (i, result)
                }
            }
            
            // Collect and verify results
            for await (index, result) in group {
                if index % 2 == 0 {
                    XCTAssertTrue(result.isValid, "Task \(index) should be valid")
                } else {
                    XCTAssertFalse(result.isValid, "Task \(index) should be invalid")
                }
            }
        }
    }
    
    /// Test SchemaValidator with Task groups (Swift Concurrency).
    func testSchemaValidatorSwiftConcurrency() async {
        let validator = SchemaValidator()
        
        // Create 50 validation tasks
        await withTaskGroup(of: (Int, ValidationResult).self) { group in
            for i in 0..<50 {
                group.addTask {
                    let schema: [String: Any] = [
                        "$id": "urn:test:schema\(i)",
                        "name": "Schema\(i)",
                        "type": i % 2 == 0 ? "string" : "invalid-type"
                    ]
                    let result = validator.validate(schema)
                    return (i, result)
                }
            }
            
            // Collect and verify results
            for await (index, result) in group {
                if index % 2 == 0 {
                    XCTAssertTrue(result.isValid, "Task \(index) should be valid")
                } else {
                    XCTAssertFalse(result.isValid, "Task \(index) should be invalid")
                }
            }
        }
    }
    
    // MARK: - No State Leakage Tests
    
    /// Verify no error leakage between concurrent validations.
    func testNoErrorLeakageBetweenValidations() {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test:leak",
            "name": "Leak",
            "type": "string"
        ]
        
        let validInstance = "valid string"
        let invalidInstance = 12345
        
        var results: [(Bool, Int)] = []
        let lock = NSLock()
        
        // Run many concurrent validations
        DispatchQueue.concurrentPerform(iterations: 200) { i in
            let instance: Any = (i % 3 == 0) ? invalidInstance : validInstance
            let result = validator.validate(instance, schema: schema)
            
            lock.lock()
            results.append((result.isValid, result.errors.count))
            lock.unlock()
        }
        
        // Verify each result is independent
        for (isValid, errorCount) in results {
            if isValid {
                XCTAssertEqual(errorCount, 0, "Valid result should have 0 errors")
            } else {
                XCTAssertGreaterThan(errorCount, 0, "Invalid result should have errors")
            }
        }
    }
    
    /// Test that validators are truly Sendable and can be shared across tasks.
    func testValidatorsSendable() async {
        let instanceValidator = InstanceValidator()
        let schemaValidator = SchemaValidator()
        
        // These should compile without warnings since validators are Sendable
        let task1 = Task {
            let schema: [String: Any] = [
                "$id": "urn:test:sendable",
                "name": "Sendable",
                "type": "boolean"
            ]
            return instanceValidator.validate(true, schema: schema)
        }
        
        let task2 = Task {
            let schema: [String: Any] = [
                "$id": "urn:test:sendable",
                "name": "Sendable",
                "type": "boolean"
            ]
            return schemaValidator.validate(schema)
        }
        
        let result1 = await task1.value
        let result2 = await task2.value
        
        XCTAssertTrue(result1.isValid)
        XCTAssertTrue(result2.isValid)
    }
    
    // MARK: - Stress Tests
    
    /// Stress test with many concurrent operations.
    func testHighConcurrencyStress() {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test:stress",
            "name": "Stress",
            "type": "object",
            "properties": [
                "id": ["type": "int32"],
                "data": ["type": "string"]
            ]
        ]
        
        let iterations = 1000
        var successCount = 0
        let lock = NSLock()
        
        DispatchQueue.concurrentPerform(iterations: iterations) { i in
            let instance: [String: Any] = [
                "id": i,
                "data": "item-\(i)"
            ]
            
            let result = validator.validate(instance, schema: schema)
            
            if result.isValid {
                lock.lock()
                successCount += 1
                lock.unlock()
            }
        }
        
        XCTAssertEqual(successCount, iterations, "All validations should succeed")
    }
}
