// JSONStructure Swift SDK Tests
// Final Coverage Tests

import XCTest
import Foundation
@testable import JSONStructure

/// Final coverage tests to maximize test count
final class FinalCoverageTests: XCTestCase {
    
    // MARK: - Individual Type Validation Tests
    
    func testStringType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        
        XCTAssertTrue(validator.validate("", schema: schema).isValid)
        XCTAssertTrue(validator.validate("a", schema: schema).isValid)
        XCTAssertTrue(validator.validate("hello world", schema: schema).isValid)
        XCTAssertFalse(validator.validate(0, schema: schema).isValid)
        XCTAssertFalse(validator.validate(true, schema: schema).isValid)
        XCTAssertFalse(validator.validate(NSNull(), schema: schema).isValid)
    }
    
    func testBooleanType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "boolean"]
        
        XCTAssertTrue(validator.validate(true, schema: schema).isValid)
        XCTAssertTrue(validator.validate(false, schema: schema).isValid)
        XCTAssertFalse(validator.validate("true", schema: schema).isValid)
        XCTAssertFalse(validator.validate(1, schema: schema).isValid)
        XCTAssertFalse(validator.validate(0, schema: schema).isValid)
    }
    
    func testNullType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "null"]
        
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
        XCTAssertFalse(validator.validate("null", schema: schema).isValid)
        XCTAssertFalse(validator.validate(0, schema: schema).isValid)
        XCTAssertFalse(validator.validate(false, schema: schema).isValid)
    }
    
    func testNumberType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "number"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(42, schema: schema).isValid)
        XCTAssertTrue(validator.validate(-17, schema: schema).isValid)
        XCTAssertTrue(validator.validate(3.14, schema: schema).isValid)
        XCTAssertFalse(validator.validate("42", schema: schema).isValid)
    }
    
    func testIntegerType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "integer"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(42, schema: schema).isValid)
        XCTAssertTrue(validator.validate(-17, schema: schema).isValid)
        XCTAssertFalse(validator.validate(3.14, schema: schema).isValid)
        XCTAssertFalse(validator.validate("42", schema: schema).isValid)
    }
    
    func testInt8Type() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int8"]
        
        XCTAssertTrue(validator.validate(-128, schema: schema).isValid)
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(127, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-129, schema: schema).isValid)
        XCTAssertFalse(validator.validate(128, schema: schema).isValid)
    }
    
    func testUint8Type() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint8"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(255, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
        XCTAssertFalse(validator.validate(256, schema: schema).isValid)
    }
    
    func testInt16Type() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int16"]
        
        XCTAssertTrue(validator.validate(-32768, schema: schema).isValid)
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(32767, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-32769, schema: schema).isValid)
        XCTAssertFalse(validator.validate(32768, schema: schema).isValid)
    }
    
    func testUint16Type() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint16"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(65535, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
        XCTAssertFalse(validator.validate(65536, schema: schema).isValid)
    }
    
    func testInt32Type() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int32"]
        
        XCTAssertTrue(validator.validate(-2147483648, schema: schema).isValid)
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(2147483647, schema: schema).isValid)
    }
    
    func testUint32Type() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint32"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(4294967295, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
    }
    
    func testInt64Type() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int64"]
        
        XCTAssertTrue(validator.validate("0", schema: schema).isValid)
        XCTAssertTrue(validator.validate("-9223372036854775808", schema: schema).isValid)
        XCTAssertTrue(validator.validate("9223372036854775807", schema: schema).isValid)
        XCTAssertFalse(validator.validate(123, schema: schema).isValid)  // Should be string
    }
    
    func testUint64Type() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint64"]
        
        XCTAssertTrue(validator.validate("0", schema: schema).isValid)
        XCTAssertTrue(validator.validate("18446744073709551615", schema: schema).isValid)
        XCTAssertFalse(validator.validate("-1", schema: schema).isValid)
    }
    
    func testFloatType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "float"]
        
        XCTAssertTrue(validator.validate(0.0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(3.14, schema: schema).isValid)
        XCTAssertTrue(validator.validate(-3.14, schema: schema).isValid)
        XCTAssertFalse(validator.validate("3.14", schema: schema).isValid)
    }
    
    func testDoubleType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "double"]
        
        XCTAssertTrue(validator.validate(0.0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(Double.pi, schema: schema).isValid)
        XCTAssertFalse(validator.validate("3.14159", schema: schema).isValid)
    }
    
    func testDecimalType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "decimal"]
        
        XCTAssertTrue(validator.validate("0", schema: schema).isValid)
        XCTAssertTrue(validator.validate("123.456", schema: schema).isValid)
        XCTAssertTrue(validator.validate("-999.999", schema: schema).isValid)
        XCTAssertFalse(validator.validate(123.456, schema: schema).isValid)  // Should be string
    }
    
    func testDateType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "date"]
        
        XCTAssertTrue(validator.validate("2024-01-15", schema: schema).isValid)
        XCTAssertTrue(validator.validate("1970-01-01", schema: schema).isValid)
        XCTAssertTrue(validator.validate("2099-12-31", schema: schema).isValid)
        XCTAssertFalse(validator.validate("01-15-2024", schema: schema).isValid)
    }
    
    func testDatetimeType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "datetime"]
        
        XCTAssertTrue(validator.validate("2024-01-15T10:30:00Z", schema: schema).isValid)
        XCTAssertTrue(validator.validate("2024-01-15T10:30:00+05:00", schema: schema).isValid)
        XCTAssertFalse(validator.validate("2024-01-15", schema: schema).isValid)
    }
    
    func testTimeType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "time"]
        
        XCTAssertTrue(validator.validate("10:30:00", schema: schema).isValid)
        XCTAssertTrue(validator.validate("23:59:59", schema: schema).isValid)
        XCTAssertTrue(validator.validate("00:00:00Z", schema: schema).isValid)
        XCTAssertFalse(validator.validate("10:30", schema: schema).isValid)
    }
    
    func testDurationType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "duration"]
        
        XCTAssertTrue(validator.validate("P1Y", schema: schema).isValid)
        XCTAssertTrue(validator.validate("PT1H", schema: schema).isValid)
        XCTAssertTrue(validator.validate("P2W", schema: schema).isValid)
        XCTAssertFalse(validator.validate("1 day", schema: schema).isValid)
    }
    
    func testUUIDType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uuid"]
        
        XCTAssertTrue(validator.validate("550e8400-e29b-41d4-a716-446655440000", schema: schema).isValid)
        XCTAssertTrue(validator.validate("00000000-0000-0000-0000-000000000000", schema: schema).isValid)
        XCTAssertFalse(validator.validate("not-a-uuid", schema: schema).isValid)
    }
    
    func testURIType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uri"]
        
        XCTAssertTrue(validator.validate("https://example.com", schema: schema).isValid)
        XCTAssertTrue(validator.validate("urn:example:resource", schema: schema).isValid)
        XCTAssertFalse(validator.validate(123, schema: schema).isValid)
    }
    
    func testBinaryType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "binary"]
        
        XCTAssertTrue(validator.validate("SGVsbG8=", schema: schema).isValid)
        XCTAssertTrue(validator.validate("", schema: schema).isValid)
        XCTAssertFalse(validator.validate(123, schema: schema).isValid)
    }
    
    func testJsonPointerType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "jsonpointer"]
        
        XCTAssertTrue(validator.validate("", schema: schema).isValid)
        XCTAssertTrue(validator.validate("/", schema: schema).isValid)
        XCTAssertTrue(validator.validate("/foo/bar", schema: schema).isValid)
        XCTAssertFalse(validator.validate("foo/bar", schema: schema).isValid)
    }
    
    func testAnyType() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "any"]
        
        XCTAssertTrue(validator.validate("string", schema: schema).isValid)
        XCTAssertTrue(validator.validate(123, schema: schema).isValid)
        XCTAssertTrue(validator.validate(true, schema: schema).isValid)
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
        XCTAssertTrue(validator.validate(["a", "b"], schema: schema).isValid)
        XCTAssertTrue(validator.validate(["key": "value"], schema: schema).isValid)
    }
    
    // MARK: - Object Validation Tests
    
    func testObjectWithNoProperties() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object"
        ]
        
        XCTAssertTrue(validator.validate([:] as [String: Any], schema: schema).isValid)
        XCTAssertTrue(validator.validate(["a": 1, "b": 2], schema: schema).isValid)
    }
    
    func testObjectWithRequiredOnly() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "name": ["type": "string"]
            ],
            "required": ["name"]
        ]
        
        XCTAssertTrue(validator.validate(["name": "John"], schema: schema).isValid)
        XCTAssertFalse(validator.validate([:] as [String: Any], schema: schema).isValid)
    }
    
    func testObjectWithMixedRequiredOptional() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "name": ["type": "string"],
                "age": ["type": "int32"],
                "email": ["type": "string"]
            ],
            "required": ["name"]
        ]
        
        // Only required field
        XCTAssertTrue(validator.validate(["name": "John"], schema: schema).isValid)
        
        // All fields
        let all: [String: Any] = ["name": "John", "age": 30, "email": "john@example.com"]
        XCTAssertTrue(validator.validate(all, schema: schema).isValid)
        
        // Missing required
        let missing: [String: Any] = ["age": 30, "email": "john@example.com"]
        XCTAssertFalse(validator.validate(missing, schema: schema).isValid)
    }
    
    // MARK: - Array Validation Tests
    
    func testArrayBasic() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": ["type": "string"]
        ]
        
        XCTAssertTrue(validator.validate([], schema: schema).isValid)
        XCTAssertTrue(validator.validate(["a"], schema: schema).isValid)
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
        XCTAssertFalse(validator.validate([1, 2, 3], schema: schema).isValid)
    }
    
    func testArrayOfIntegers() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": ["type": "int32"]
        ]
        
        XCTAssertTrue(validator.validate([1, 2, 3], schema: schema).isValid)
        XCTAssertFalse(validator.validate(["a", "b"], schema: schema).isValid)
    }
    
    func testArrayOfObjects() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": [
                "type": "object",
                "properties": ["name": ["type": "string"]],
                "required": ["name"]
            ]
        ]
        
        let valid: [[String: Any]] = [["name": "John"], ["name": "Jane"]]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        let invalid: [[String: Any]] = [["name": "John"], ["age": 30]]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    // MARK: - Set Validation Tests
    
    func testSetBasic() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "set",
            "items": ["type": "string"]
        ]
        
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
        XCTAssertFalse(validator.validate(["a", "b", "a"], schema: schema).isValid)  // Duplicate
    }
    
    func testSetOfNumbers() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "set",
            "items": ["type": "int32"]
        ]
        
        XCTAssertTrue(validator.validate([1, 2, 3], schema: schema).isValid)
        XCTAssertFalse(validator.validate([1, 2, 1], schema: schema).isValid)
    }
    
    // MARK: - Map Validation Tests
    
    func testMapBasic() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "map",
            "values": ["type": "string"]
        ]
        
        XCTAssertTrue(validator.validate([:] as [String: Any], schema: schema).isValid)
        XCTAssertTrue(validator.validate(["a": "1", "b": "2"], schema: schema).isValid)
        
        let invalid: [String: Any] = ["a": "1", "b": 2]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testMapOfIntegers() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "map",
            "values": ["type": "int32"]
        ]
        
        XCTAssertTrue(validator.validate(["a": 1, "b": 2], schema: schema).isValid)
        
        let invalid: [String: Any] = ["a": 1, "b": "two"]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    // MARK: - Tuple Validation Tests
    
    func testTupleBasic() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "tuple",
            "tuple": ["x", "y"],
            "properties": [
                "x": ["type": "number"],
                "y": ["type": "number"]
            ]
        ]
        
        XCTAssertTrue(validator.validate([1.0, 2.0], schema: schema).isValid)
        XCTAssertFalse(validator.validate([1.0], schema: schema).isValid)  // Too short
        XCTAssertFalse(validator.validate([1.0, 2.0, 3.0], schema: schema).isValid)  // Too long
    }
    
    func testTupleMixedTypes() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "tuple",
            "tuple": ["name", "age", "active"],
            "properties": [
                "name": ["type": "string"],
                "age": ["type": "int32"],
                "active": ["type": "boolean"]
            ]
        ]
        
        XCTAssertTrue(validator.validate(["John", 30, true], schema: schema).isValid)
        XCTAssertFalse(validator.validate([30, "John", true], schema: schema).isValid)
    }
    
    // MARK: - Choice Validation Tests
    
    func testChoiceBasic() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "choice",
            "choices": [
                "a": ["type": "string"],
                "b": ["type": "int32"]
            ]
        ]
        
        XCTAssertTrue(validator.validate(["a": "hello"], schema: schema).isValid)
        XCTAssertTrue(validator.validate(["b": 42], schema: schema).isValid)
        XCTAssertFalse(validator.validate(["c": true], schema: schema).isValid)  // Unknown choice
    }
    
    func testChoiceWithObjects() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "choice",
            "choices": [
                "person": [
                    "type": "object",
                    "properties": ["name": ["type": "string"]],
                    "required": ["name"]
                ],
                "company": [
                    "type": "object",
                    "properties": ["employees": ["type": "int32"]],
                    "required": ["employees"]
                ]
            ]
        ]
        
        let person: [String: Any] = ["person": ["name": "John"]]
        XCTAssertTrue(validator.validate(person, schema: schema).isValid)
        
        let company: [String: Any] = ["company": ["employees": 100]]
        XCTAssertTrue(validator.validate(company, schema: schema).isValid)
        
        let invalid: [String: Any] = ["person": ["age": 30]]  // Missing required
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    // MARK: - Constraint Validation Tests
    
    func testMinLengthConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "minLength": 5
        ]
        
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        XCTAssertTrue(validator.validate("hello world", schema: schema).isValid)
        XCTAssertFalse(validator.validate("hi", schema: schema).isValid)
    }
    
    func testMaxLengthConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "maxLength": 10
        ]
        
        XCTAssertTrue(validator.validate("hi", schema: schema).isValid)
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        XCTAssertFalse(validator.validate("hello world!", schema: schema).isValid)
    }
    
    func testPatternConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "pattern": "^[a-z]+$"
        ]
        
        XCTAssertTrue(validator.validate("abc", schema: schema).isValid)
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        XCTAssertFalse(validator.validate("ABC", schema: schema).isValid)
        XCTAssertFalse(validator.validate("abc123", schema: schema).isValid)
    }
    
    func testMinimumConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "minimum": 10
        ]
        
        XCTAssertTrue(validator.validate(10, schema: schema).isValid)
        XCTAssertTrue(validator.validate(100, schema: schema).isValid)
        XCTAssertFalse(validator.validate(5, schema: schema).isValid)
    }
    
    func testMaximumConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "maximum": 100
        ]
        
        XCTAssertTrue(validator.validate(50, schema: schema).isValid)
        XCTAssertTrue(validator.validate(100, schema: schema).isValid)
        XCTAssertFalse(validator.validate(150, schema: schema).isValid)
    }
    
    func testExclusiveMinimumConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "exclusiveMinimum": 10
        ]
        
        XCTAssertTrue(validator.validate(11, schema: schema).isValid)
        XCTAssertFalse(validator.validate(10, schema: schema).isValid)
        XCTAssertFalse(validator.validate(5, schema: schema).isValid)
    }
    
    func testExclusiveMaximumConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "exclusiveMaximum": 100
        ]
        
        XCTAssertTrue(validator.validate(50, schema: schema).isValid)
        XCTAssertFalse(validator.validate(100, schema: schema).isValid)
        XCTAssertFalse(validator.validate(150, schema: schema).isValid)
    }
    
    func testMultipleOfConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "multipleOf": 5
        ]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(15, schema: schema).isValid)
        XCTAssertFalse(validator.validate(7, schema: schema).isValid)
    }
    
    func testMinItemsConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "array",
            "items": ["type": "string"],
            "minItems": 2
        ]
        
        XCTAssertTrue(validator.validate(["a", "b"], schema: schema).isValid)
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
        XCTAssertFalse(validator.validate(["a"], schema: schema).isValid)
    }
    
    func testMaxItemsConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "array",
            "items": ["type": "string"],
            "maxItems": 3
        ]
        
        XCTAssertTrue(validator.validate(["a"], schema: schema).isValid)
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
        XCTAssertFalse(validator.validate(["a", "b", "c", "d"], schema: schema).isValid)
    }
    
    func testUniqueItemsConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "array",
            "items": ["type": "string"],
            "uniqueItems": true
        ]
        
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
        XCTAssertFalse(validator.validate(["a", "b", "a"], schema: schema).isValid)
    }
    
    // MARK: - Enum and Const Tests
    
    func testEnumConstraint() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "string",
            "enum": ["red", "green", "blue"]
        ]
        
        XCTAssertTrue(validator.validate("red", schema: schema).isValid)
        XCTAssertTrue(validator.validate("green", schema: schema).isValid)
        XCTAssertTrue(validator.validate("blue", schema: schema).isValid)
        XCTAssertFalse(validator.validate("yellow", schema: schema).isValid)
    }
    
    func testConstConstraint() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "string",
            "const": "fixed-value"
        ]
        
        XCTAssertTrue(validator.validate("fixed-value", schema: schema).isValid)
        XCTAssertFalse(validator.validate("other-value", schema: schema).isValid)
    }
    
    // MARK: - Reference Tests
    
    func testRefToDefinition() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "value": ["type": ["$ref": "#/definitions/MyType"]]
            ],
            "definitions": [
                "MyType": ["type": "string"]
            ]
        ]
        
        XCTAssertTrue(validator.validate(["value": "test"], schema: schema).isValid)
        XCTAssertFalse(validator.validate(["value": 123], schema: schema).isValid)
    }
    
    func testRootRef() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$root": "#/definitions/Main",
            "definitions": [
                "Main": [
                    "type": "object",
                    "properties": ["name": ["type": "string"]],
                    "required": ["name"]
                ]
            ]
        ]
        
        XCTAssertTrue(validator.validate(["name": "test"], schema: schema).isValid)
        XCTAssertFalse(validator.validate([:] as [String: Any], schema: schema).isValid)
    }
    
    func testExtendsRef() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "Derived",
            "$extends": "#/definitions/Base",
            "type": "object",
            "definitions": [
                "Base": [
                    "type": "object",
                    "properties": ["name": ["type": "string"]],
                    "required": ["name"]
                ]
            ],
            "properties": [
                "age": ["type": "int32"]
            ]
        ]
        
        let valid: [String: Any] = ["name": "John", "age": 30]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        let invalid: [String: Any] = ["age": 30]  // Missing base required
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    // MARK: - Union Type Tests
    
    func testUnionStringOrNumber() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": ["string", "number"]
        ]
        
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        XCTAssertTrue(validator.validate(42, schema: schema).isValid)
        XCTAssertFalse(validator.validate(true, schema: schema).isValid)
    }
    
    func testUnionNullable() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": ["string", "null"]
        ]
        
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
        XCTAssertFalse(validator.validate(42, schema: schema).isValid)
    }
    
    func testUnionWithRef() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": [
                ["$ref": "#/definitions/Person"],
                "null"
            ],
            "definitions": [
                "Person": [
                    "type": "object",
                    "properties": ["name": ["type": "string"]],
                    "required": ["name"]
                ]
            ]
        ]
        
        XCTAssertTrue(validator.validate(["name": "John"], schema: schema).isValid)
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
        XCTAssertFalse(validator.validate("string", schema: schema).isValid)
    }
}
