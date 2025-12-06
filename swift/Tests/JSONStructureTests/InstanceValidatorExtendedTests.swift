// JSONStructure Swift SDK Tests
// Extended Instance Validator Tests
// Comprehensive validation tests for all types and constraints

import XCTest
import Foundation
@testable import JSONStructure

/// Extended tests for instance validation
final class InstanceValidatorExtendedTests: XCTestCase {
    
    // MARK: - Primitive Type Tests
    
    func testAllPrimitiveTypes() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        // Test each primitive type with valid and invalid values
        let primitiveTests: [(type: String, valid: Any, invalid: Any)] = [
            ("string", "hello", 123),
            ("boolean", true, "true"),
            ("null", NSNull(), "null"),
            ("number", 3.14, "3.14"),
            ("integer", 42, 3.14),
            ("int8", 127, 200),
            ("uint8", 255, -1),
            ("int16", 32767, 40000),
            ("uint16", 65535, -1),
            ("int32", 2147483647, 3000000000),
            ("uint32", 4294967295, -1),
            ("int64", "100", 123),  // int64 is represented as string
            ("uint64", "100", "invalid"),  // uint64 is represented as string
            ("float", 3.14, "3.14"),
            ("double", 3.14159265358979, "3.14"),
        ]
        
        for (type, valid, invalid) in primitiveTests {
            let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": type]
            
            let validResult = validator.validate(valid, schema: schema)
            XCTAssertTrue(validResult.isValid, "\(type) should accept \(valid). Errors: \(validResult.errors)")
            
            let invalidResult = validator.validate(invalid, schema: schema)
            XCTAssertFalse(invalidResult.isValid, "\(type) should reject \(invalid)")
        }
    }
    
    func testInt8Bounds() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int8"]
        
        // Valid bounds
        XCTAssertTrue(validator.validate(-128, schema: schema).isValid)
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(127, schema: schema).isValid)
        
        // Invalid bounds
        XCTAssertFalse(validator.validate(-129, schema: schema).isValid)
        XCTAssertFalse(validator.validate(128, schema: schema).isValid)
    }
    
    func testUint8Bounds() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint8"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(255, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
        XCTAssertFalse(validator.validate(256, schema: schema).isValid)
    }
    
    func testInt16Bounds() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int16"]
        
        XCTAssertTrue(validator.validate(-32768, schema: schema).isValid)
        XCTAssertTrue(validator.validate(32767, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-32769, schema: schema).isValid)
        XCTAssertFalse(validator.validate(32768, schema: schema).isValid)
    }
    
    func testUint16Bounds() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint16"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(65535, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
        XCTAssertFalse(validator.validate(65536, schema: schema).isValid)
    }
    
    func testInt32Bounds() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int32"]
        
        XCTAssertTrue(validator.validate(-2147483648, schema: schema).isValid)
        XCTAssertTrue(validator.validate(2147483647, schema: schema).isValid)
    }
    
    func testUint32Bounds() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint32"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(4294967295, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
    }
    
    func testDecimalFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "decimal"]
        
        XCTAssertTrue(validator.validate("123.456", schema: schema).isValid)
        XCTAssertTrue(validator.validate("0", schema: schema).isValid)
        XCTAssertTrue(validator.validate("-123.456", schema: schema).isValid)
        XCTAssertFalse(validator.validate("abc", schema: schema).isValid)
        XCTAssertFalse(validator.validate(123.456, schema: schema).isValid) // Should be string
    }
    
    func testBinaryFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "binary"]
        
        // Valid base64
        XCTAssertTrue(validator.validate("SGVsbG8gV29ybGQ=", schema: schema).isValid)
        XCTAssertTrue(validator.validate("", schema: schema).isValid)
        
        // Invalid - not a string
        XCTAssertFalse(validator.validate(123, schema: schema).isValid)
    }
    
    // MARK: - Date/Time Tests
    
    func testDateFormats() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "date"]
        
        // Valid dates
        XCTAssertTrue(validator.validate("2024-01-15", schema: schema).isValid)
        XCTAssertTrue(validator.validate("1970-01-01", schema: schema).isValid)
        XCTAssertTrue(validator.validate("2099-12-31", schema: schema).isValid)
        
        // Invalid dates
        XCTAssertFalse(validator.validate("01-15-2024", schema: schema).isValid)
        XCTAssertFalse(validator.validate("2024/01/15", schema: schema).isValid)
        XCTAssertFalse(validator.validate("not-a-date", schema: schema).isValid)
    }
    
    func testDatetimeFormats() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "datetime"]
        
        // Valid datetimes
        XCTAssertTrue(validator.validate("2024-01-15T14:30:00Z", schema: schema).isValid)
        XCTAssertTrue(validator.validate("2024-01-15T14:30:00+05:00", schema: schema).isValid)
        XCTAssertTrue(validator.validate("2024-01-15T14:30:00-08:00", schema: schema).isValid)
        XCTAssertTrue(validator.validate("2024-01-15T14:30:00.123Z", schema: schema).isValid)
        
        // Invalid datetimes
        XCTAssertFalse(validator.validate("2024-01-15", schema: schema).isValid)
        XCTAssertFalse(validator.validate("14:30:00", schema: schema).isValid)
    }
    
    func testTimeFormats() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "time"]
        
        // Valid times
        XCTAssertTrue(validator.validate("14:30:00", schema: schema).isValid)
        XCTAssertTrue(validator.validate("00:00:00", schema: schema).isValid)
        XCTAssertTrue(validator.validate("23:59:59", schema: schema).isValid)
        XCTAssertTrue(validator.validate("14:30:00Z", schema: schema).isValid)
        XCTAssertTrue(validator.validate("14:30:00+05:00", schema: schema).isValid)
        
        // Invalid times
        XCTAssertFalse(validator.validate("14:30", schema: schema).isValid)
        XCTAssertFalse(validator.validate("2:30:00", schema: schema).isValid)
    }
    
    func testDurationFormats() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "duration"]
        
        // Valid durations
        XCTAssertTrue(validator.validate("P1Y", schema: schema).isValid)
        XCTAssertTrue(validator.validate("P1M", schema: schema).isValid)
        XCTAssertTrue(validator.validate("P1D", schema: schema).isValid)
        XCTAssertTrue(validator.validate("PT1H", schema: schema).isValid)
        XCTAssertTrue(validator.validate("PT1M", schema: schema).isValid)
        XCTAssertTrue(validator.validate("PT1S", schema: schema).isValid)
        XCTAssertTrue(validator.validate("P1Y2M3D", schema: schema).isValid)
        XCTAssertTrue(validator.validate("PT1H30M45S", schema: schema).isValid)
        XCTAssertTrue(validator.validate("P1Y2M3DT4H5M6S", schema: schema).isValid)
        XCTAssertTrue(validator.validate("P2W", schema: schema).isValid)
        
        // Invalid durations
        XCTAssertFalse(validator.validate("1 day", schema: schema).isValid)
        XCTAssertFalse(validator.validate("not-a-duration", schema: schema).isValid)
    }
    
    func testUUIDFormats() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uuid"]
        
        // Valid UUIDs
        XCTAssertTrue(validator.validate("550e8400-e29b-41d4-a716-446655440000", schema: schema).isValid)
        XCTAssertTrue(validator.validate("00000000-0000-0000-0000-000000000000", schema: schema).isValid)
        XCTAssertTrue(validator.validate("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", schema: schema).isValid)
        
        // Invalid UUIDs
        XCTAssertFalse(validator.validate("not-a-uuid", schema: schema).isValid)
        XCTAssertFalse(validator.validate("550e8400-e29b-41d4-a716", schema: schema).isValid)
        XCTAssertFalse(validator.validate("550e8400e29b41d4a716446655440000", schema: schema).isValid)
    }
    
    func testURIFormats() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uri"]
        
        // Valid URIs
        XCTAssertTrue(validator.validate("https://example.com", schema: schema).isValid)
        XCTAssertTrue(validator.validate("http://example.com/path?query=value", schema: schema).isValid)
        XCTAssertTrue(validator.validate("urn:example:resource", schema: schema).isValid)
        XCTAssertTrue(validator.validate("file:///path/to/file", schema: schema).isValid)
        
        // Invalid - not a string
        XCTAssertFalse(validator.validate(123, schema: schema).isValid)
    }
    
    func testJsonPointerFormats() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "jsonpointer"]
        
        // Valid JSON pointers
        XCTAssertTrue(validator.validate("", schema: schema).isValid)
        XCTAssertTrue(validator.validate("/", schema: schema).isValid)
        XCTAssertTrue(validator.validate("/foo", schema: schema).isValid)
        XCTAssertTrue(validator.validate("/foo/bar", schema: schema).isValid)
        XCTAssertTrue(validator.validate("/foo/0", schema: schema).isValid)
        XCTAssertTrue(validator.validate("/a~0b", schema: schema).isValid) // ~ escaped as ~0
        XCTAssertTrue(validator.validate("/a~1b", schema: schema).isValid) // / escaped as ~1
        
        // Invalid - not starting with /
        XCTAssertFalse(validator.validate("foo/bar", schema: schema).isValid)
    }
    
    // MARK: - Compound Type Tests
    
    func testObjectValidation() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "Person",
            "type": "object",
            "properties": [
                "name": ["type": "string"],
                "age": ["type": "int32"],
                "email": ["type": "string"]
            ],
            "required": ["name", "email"]
        ]
        
        // Valid
        let valid: [String: Any] = ["name": "John", "email": "john@example.com", "age": 30]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Valid - optional field missing
        let validNoAge: [String: Any] = ["name": "John", "email": "john@example.com"]
        XCTAssertTrue(validator.validate(validNoAge, schema: schema).isValid)
        
        // Invalid - required field missing
        let missingEmail: [String: Any] = ["name": "John", "age": 30]
        XCTAssertFalse(validator.validate(missingEmail, schema: schema).isValid)
        
        // Invalid - wrong type
        let wrongType: [String: Any] = ["name": "John", "email": "john@example.com", "age": "thirty"]
        XCTAssertFalse(validator.validate(wrongType, schema: schema).isValid)
    }
    
    func testNestedObjectValidation() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "Person",
            "type": "object",
            "properties": [
                "name": ["type": "string"],
                "address": [
                    "type": "object",
                    "properties": [
                        "street": ["type": "string"],
                        "city": ["type": "string"],
                        "zip": ["type": "string"]
                    ],
                    "required": ["city"]
                ]
            ]
        ]
        
        // Valid
        let valid: [String: Any] = [
            "name": "John",
            "address": [
                "street": "123 Main St",
                "city": "NYC",
                "zip": "10001"
            ]
        ]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - nested required field missing
        let missingCity: [String: Any] = [
            "name": "John",
            "address": [
                "street": "123 Main St"
            ]
        ]
        XCTAssertFalse(validator.validate(missingCity, schema: schema).isValid)
    }
    
    func testArrayValidation() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "StringArray",
            "type": "array",
            "items": ["type": "string"]
        ]
        
        // Valid
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
        XCTAssertTrue(validator.validate([], schema: schema).isValid)
        
        // Invalid - wrong item type
        XCTAssertFalse(validator.validate([1, 2, 3], schema: schema).isValid)
        XCTAssertFalse(validator.validate(["a", 2, "c"], schema: schema).isValid)
        
        // Invalid - not an array
        XCTAssertFalse(validator.validate("not an array", schema: schema).isValid)
    }
    
    func testArrayWithObjectItems() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "PersonArray",
            "type": "array",
            "items": [
                "type": "object",
                "properties": [
                    "name": ["type": "string"],
                    "age": ["type": "int32"]
                ],
                "required": ["name"]
            ]
        ]
        
        // Valid
        let valid: [[String: Any]] = [
            ["name": "John", "age": 30],
            ["name": "Jane"]
        ]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - missing required in item
        let invalid: [[String: Any]] = [
            ["name": "John"],
            ["age": 25]
        ]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testSetValidation() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "StringSet",
            "type": "set",
            "items": ["type": "string"]
        ]
        
        // Valid - unique items
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
        
        // Invalid - duplicate items
        XCTAssertFalse(validator.validate(["a", "b", "a"], schema: schema).isValid)
    }
    
    func testMapValidation() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "StringToIntMap",
            "type": "map",
            "values": ["type": "int32"]
        ]
        
        // Valid
        let valid: [String: Any] = ["a": 1, "b": 2, "c": 3]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - wrong value type
        let invalid: [String: Any] = ["a": 1, "b": "two"]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testMapWithObjectValues() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "PersonMap",
            "type": "map",
            "values": [
                "type": "object",
                "properties": [
                    "name": ["type": "string"],
                    "age": ["type": "int32"]
                ]
            ]
        ]
        
        // Valid
        let valid: [String: Any] = [
            "person1": ["name": "John", "age": 30],
            "person2": ["name": "Jane", "age": 25]
        ]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
    }
    
    func testTupleValidation() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "Point2D",
            "type": "tuple",
            "tuple": ["x", "y"],
            "properties": [
                "x": ["type": "number"],
                "y": ["type": "number"]
            ]
        ]
        
        // Valid
        XCTAssertTrue(validator.validate([10.0, 20.0], schema: schema).isValid)
        XCTAssertTrue(validator.validate([0, 0], schema: schema).isValid)
        
        // Invalid - wrong length
        XCTAssertFalse(validator.validate([10.0], schema: schema).isValid)
        XCTAssertFalse(validator.validate([10.0, 20.0, 30.0], schema: schema).isValid)
        
        // Invalid - wrong type
        XCTAssertFalse(validator.validate(["a", "b"], schema: schema).isValid)
    }
    
    func testChoiceTaggedUnion() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "Shape",
            "type": "choice",
            "choices": [
                "circle": [
                    "type": "object",
                    "properties": [
                        "radius": ["type": "number"]
                    ]
                ],
                "rectangle": [
                    "type": "object",
                    "properties": [
                        "width": ["type": "number"],
                        "height": ["type": "number"]
                    ]
                ]
            ]
        ]
        
        // Valid - circle
        let circle: [String: Any] = ["circle": ["radius": 5.0]]
        XCTAssertTrue(validator.validate(circle, schema: schema).isValid)
        
        // Valid - rectangle
        let rectangle: [String: Any] = ["rectangle": ["width": 10.0, "height": 20.0]]
        XCTAssertTrue(validator.validate(rectangle, schema: schema).isValid)
        
        // Invalid - unknown choice
        let triangle: [String: Any] = ["triangle": ["base": 10.0, "height": 5.0]]
        XCTAssertFalse(validator.validate(triangle, schema: schema).isValid)
        
        // Invalid - multiple choices
        let multiple: [String: Any] = [
            "circle": ["radius": 5.0],
            "rectangle": ["width": 10.0, "height": 20.0]
        ]
        XCTAssertFalse(validator.validate(multiple, schema: schema).isValid)
    }
    
    // MARK: - Union Type Tests
    
    func testUnionTypes() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "StringOrNumber",
            "type": ["string", "number"]
        ]
        
        // Valid - string
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        
        // Valid - number
        XCTAssertTrue(validator.validate(42.0, schema: schema).isValid)
        
        // Invalid - boolean
        XCTAssertFalse(validator.validate(true, schema: schema).isValid)
    }
    
    func testNullableUnion() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "NullableString",
            "type": ["string", "null"]
        ]
        
        // Valid - string
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        
        // Valid - null
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
        
        // Invalid - number
        XCTAssertFalse(validator.validate(42, schema: schema).isValid)
    }
    
    func testUnionWithRef() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "PersonOrNull",
            "type": [
                ["$ref": "#/definitions/Person"],
                "null"
            ],
            "definitions": [
                "Person": [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string"]
                    ],
                    "required": ["name"]
                ]
            ]
        ]
        
        // Valid - person
        let person: [String: Any] = ["name": "John"]
        XCTAssertTrue(validator.validate(person, schema: schema).isValid)
        
        // Valid - null
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
        
        // Invalid - person missing required field
        let invalidPerson: [String: Any] = ["age": 30]
        XCTAssertFalse(validator.validate(invalidPerson, schema: schema).isValid)
    }
    
    // MARK: - Extended Constraint Tests
    
    func testStringConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "ConstrainedString",
            "type": "string",
            "minLength": 3,
            "maxLength": 10,
            "pattern": "^[a-z]+$"
        ]
        
        // Valid
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        XCTAssertTrue(validator.validate("abc", schema: schema).isValid)
        
        // Invalid - too short
        XCTAssertFalse(validator.validate("ab", schema: schema).isValid)
        
        // Invalid - too long
        XCTAssertFalse(validator.validate("abcdefghijk", schema: schema).isValid)
        
        // Invalid - pattern mismatch
        XCTAssertFalse(validator.validate("ABC123", schema: schema).isValid)
    }
    
    func testNumericConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "ConstrainedNumber",
            "type": "number",
            "minimum": 0,
            "maximum": 100,
            "multipleOf": 5
        ]
        
        // Valid
        XCTAssertTrue(validator.validate(50, schema: schema).isValid)
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(100, schema: schema).isValid)
        
        // Invalid - below minimum
        XCTAssertFalse(validator.validate(-5, schema: schema).isValid)
        
        // Invalid - above maximum
        XCTAssertFalse(validator.validate(105, schema: schema).isValid)
        
        // Invalid - not multiple of 5
        XCTAssertFalse(validator.validate(42, schema: schema).isValid)
    }
    
    func testExclusiveConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "ExclusiveNumber",
            "type": "number",
            "exclusiveMinimum": 0,
            "exclusiveMaximum": 100
        ]
        
        // Valid
        XCTAssertTrue(validator.validate(50, schema: schema).isValid)
        XCTAssertTrue(validator.validate(1, schema: schema).isValid)
        XCTAssertTrue(validator.validate(99, schema: schema).isValid)
        
        // Invalid - equals exclusiveMinimum
        XCTAssertFalse(validator.validate(0, schema: schema).isValid)
        
        // Invalid - equals exclusiveMaximum
        XCTAssertFalse(validator.validate(100, schema: schema).isValid)
    }
    
    func testArrayConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "ConstrainedArray",
            "type": "array",
            "items": ["type": "string"],
            "minItems": 2,
            "maxItems": 5,
            "uniqueItems": true
        ]
        
        // Valid
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
        XCTAssertTrue(validator.validate(["a", "b"], schema: schema).isValid)
        
        // Invalid - too few items
        XCTAssertFalse(validator.validate(["a"], schema: schema).isValid)
        
        // Invalid - too many items
        XCTAssertFalse(validator.validate(["a", "b", "c", "d", "e", "f"], schema: schema).isValid)
        
        // Invalid - not unique
        XCTAssertFalse(validator.validate(["a", "b", "a"], schema: schema).isValid)
    }
    
    func testContainsConstraint() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "ContainsArray",
            "type": "array",
            "items": ["type": "string"],
            "contains": ["const": "special"]
        ]
        
        // Valid - contains "special"
        XCTAssertTrue(validator.validate(["a", "special", "b"], schema: schema).isValid)
        
        // Invalid - doesn't contain "special"
        XCTAssertFalse(validator.validate(["a", "b", "c"], schema: schema).isValid)
    }
    
    func testMinMaxContains() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "ContainsArray",
            "type": "array",
            "items": ["type": "string"],
            "contains": ["const": "x"],
            "minContains": 2,
            "maxContains": 4
        ]
        
        // Valid - 2 matches
        XCTAssertTrue(validator.validate(["x", "a", "x"], schema: schema).isValid)
        
        // Valid - 3 matches
        XCTAssertTrue(validator.validate(["x", "x", "x"], schema: schema).isValid)
        
        // Invalid - only 1 match
        XCTAssertFalse(validator.validate(["x", "a", "b"], schema: schema).isValid)
        
        // Invalid - 5 matches
        XCTAssertFalse(validator.validate(["x", "x", "x", "x", "x"], schema: schema).isValid)
    }
    
    func testObjectPropertyConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "ConstrainedObject",
            "type": "object",
            "minProperties": 2,
            "maxProperties": 5
        ]
        
        // Valid
        let valid: [String: Any] = ["a": 1, "b": 2, "c": 3]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - too few
        let tooFew: [String: Any] = ["a": 1]
        XCTAssertFalse(validator.validate(tooFew, schema: schema).isValid)
        
        // Invalid - too many
        let tooMany: [String: Any] = ["a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6]
        XCTAssertFalse(validator.validate(tooMany, schema: schema).isValid)
    }
    
    func testDependentRequired() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "DependentObject",
            "type": "object",
            "properties": [
                "creditCard": ["type": "string"],
                "billingAddress": ["type": "string"],
                "shippingAddress": ["type": "string"]
            ],
            "dependentRequired": [
                "creditCard": ["billingAddress"],
                "billingAddress": ["shippingAddress"]
            ]
        ]
        
        // Valid - credit card with billing address
        let valid1: [String: Any] = [
            "creditCard": "1234-5678",
            "billingAddress": "123 Main St",
            "shippingAddress": "456 Oak Ave"
        ]
        XCTAssertTrue(validator.validate(valid1, schema: schema).isValid)
        
        // Valid - no credit card
        let valid2: [String: Any] = ["shippingAddress": "456 Oak Ave"]
        XCTAssertTrue(validator.validate(valid2, schema: schema).isValid)
        
        // Invalid - credit card without billing address
        let invalid: [String: Any] = ["creditCard": "1234-5678"]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testMapConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "ConstrainedMap",
            "type": "map",
            "values": ["type": "string"],
            "minEntries": 2,
            "maxEntries": 5,
            "keyNames": ["pattern": "^[a-z]+$"]
        ]
        
        // Valid
        let valid: [String: Any] = ["alpha": "a", "beta": "b", "gamma": "c"]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - too few entries
        let tooFew: [String: Any] = ["alpha": "a"]
        XCTAssertFalse(validator.validate(tooFew, schema: schema).isValid)
        
        // Invalid - key doesn't match pattern
        let badKey: [String: Any] = ["ALPHA": "a", "beta": "b"]
        XCTAssertFalse(validator.validate(badKey, schema: schema).isValid)
    }
    
    // MARK: - Conditional Composition Tests
    
    func testAllOfComposition() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "AllOfType",
            "type": "object",
            "allOf": [
                [
                    "properties": ["name": ["type": "string"]],
                    "required": ["name"]
                ],
                [
                    "properties": ["age": ["type": "int32"]],
                    "required": ["age"]
                ]
            ]
        ]
        
        // Valid - has both required fields
        let valid: [String: Any] = ["name": "John", "age": 30]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - missing name
        let missingName: [String: Any] = ["age": 30]
        XCTAssertFalse(validator.validate(missingName, schema: schema).isValid)
        
        // Invalid - missing age
        let missingAge: [String: Any] = ["name": "John"]
        XCTAssertFalse(validator.validate(missingAge, schema: schema).isValid)
    }
    
    func testAnyOfComposition() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "AnyOfType",
            "anyOf": [
                ["type": "string", "minLength": 3],
                ["type": "number", "minimum": 0]
            ]
        ]
        
        // Valid - matches first
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        
        // Valid - matches second
        XCTAssertTrue(validator.validate(42, schema: schema).isValid)
        
        // Invalid - matches neither
        XCTAssertFalse(validator.validate(true, schema: schema).isValid)
    }
    
    func testOneOfComposition() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "OneOfType",
            "oneOf": [
                ["type": "string"],
                ["type": "number"]
            ]
        ]
        
        // Valid - matches exactly one
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        XCTAssertTrue(validator.validate(42, schema: schema).isValid)
        
        // Invalid - matches neither
        XCTAssertFalse(validator.validate(true, schema: schema).isValid)
    }
    
    func testNotComposition() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "NotType",
            "type": "string",
            "not": ["const": "forbidden"]
        ]
        
        // Valid - doesn't match not schema
        XCTAssertTrue(validator.validate("allowed", schema: schema).isValid)
        XCTAssertTrue(validator.validate("anything else", schema: schema).isValid)
        
        // Invalid - matches not schema
        XCTAssertFalse(validator.validate("forbidden", schema: schema).isValid)
    }
    
    func testIfThenElse() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "ConditionalType",
            "type": "object",
            "if": [
                "properties": ["type": ["const": "premium"]],
                "required": ["type"]
            ],
            "then": [
                "properties": ["discount": ["type": "number"]],
                "required": ["discount"]
            ],
            "else": [
                "properties": ["price": ["type": "number"]],
                "required": ["price"]
            ]
        ]
        
        // Valid - premium with discount
        let validPremium: [String: Any] = ["type": "premium", "discount": 10]
        XCTAssertTrue(validator.validate(validPremium, schema: schema).isValid)
        
        // Valid - standard with price
        let validStandard: [String: Any] = ["type": "standard", "price": 100]
        XCTAssertTrue(validator.validate(validStandard, schema: schema).isValid)
        
        // Invalid - premium without discount
        let invalidPremium: [String: Any] = ["type": "premium"]
        XCTAssertFalse(validator.validate(invalidPremium, schema: schema).isValid)
    }
    
    // MARK: - Reference Tests
    
    func testRefResolution() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "Container",
            "type": "object",
            "properties": [
                "value": ["type": ["$ref": "#/definitions/MyType"]]
            ],
            "definitions": [
                "MyType": [
                    "type": "object",
                    "properties": ["name": ["type": "string"]],
                    "required": ["name"]
                ]
            ]
        ]
        
        // Valid
        let valid: [String: Any] = ["value": ["name": "test"]]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - missing required in ref
        let invalid: [String: Any] = ["value": ["other": "test"]]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testNestedRefResolution() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "Container",
            "type": "object",
            "properties": [
                "person": ["type": ["$ref": "#/definitions/Person"]]
            ],
            "definitions": [
                "Person": [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string"],
                        "address": ["type": ["$ref": "#/definitions/Address"]]
                    ]
                ],
                "Address": [
                    "type": "object",
                    "properties": [
                        "city": ["type": "string"]
                    ],
                    "required": ["city"]
                ]
            ]
        ]
        
        // Valid
        let valid: [String: Any] = [
            "person": [
                "name": "John",
                "address": ["city": "NYC"]
            ]
        ]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - nested ref validation fails
        let invalid: [String: Any] = [
            "person": [
                "name": "John",
                "address": ["street": "123 Main"]
            ]
        ]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testExtendsKeyword() throws {
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
        
        // Valid - has base required field
        let valid: [String: Any] = ["name": "John", "age": 30]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - missing base required field
        let invalid: [String: Any] = ["age": 30]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testRootReference() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$root": "#/definitions/Main",
            "definitions": [
                "Main": [
                    "type": "object",
                    "properties": ["value": ["type": "string"]],
                    "required": ["value"]
                ]
            ]
        ]
        
        // Valid
        let valid: [String: Any] = ["value": "test"]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid
        let invalid: [String: Any] = ["other": "test"]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    // MARK: - Enum and Const Tests
    
    func testEnumConstraint() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "Color",
            "type": "string",
            "enum": ["red", "green", "blue"]
        ]
        
        // Valid
        XCTAssertTrue(validator.validate("red", schema: schema).isValid)
        XCTAssertTrue(validator.validate("green", schema: schema).isValid)
        XCTAssertTrue(validator.validate("blue", schema: schema).isValid)
        
        // Invalid
        XCTAssertFalse(validator.validate("yellow", schema: schema).isValid)
        XCTAssertFalse(validator.validate("RED", schema: schema).isValid)
    }
    
    func testConstConstraint() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "FixedValue",
            "type": "string",
            "const": "fixed"
        ]
        
        // Valid
        XCTAssertTrue(validator.validate("fixed", schema: schema).isValid)
        
        // Invalid
        XCTAssertFalse(validator.validate("other", schema: schema).isValid)
        XCTAssertFalse(validator.validate("Fixed", schema: schema).isValid)
    }
    
    // MARK: - Additional Properties Tests
    
    func testAdditionalPropertiesFalse() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "Strict",
            "type": "object",
            "properties": [
                "name": ["type": "string"],
                "age": ["type": "int32"]
            ],
            "additionalProperties": false
        ]
        
        // Valid - only defined properties
        let valid: [String: Any] = ["name": "John", "age": 30]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - has additional property
        let invalid: [String: Any] = ["name": "John", "age": 30, "extra": "value"]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testAdditionalPropertiesSchema() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "Flexible",
            "type": "object",
            "properties": [
                "name": ["type": "string"]
            ],
            "additionalProperties": ["type": "int32"]
        ]
        
        // Valid - additional property matches schema
        let valid: [String: Any] = ["name": "John", "age": 30, "count": 5]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - additional property doesn't match schema
        let invalid: [String: Any] = ["name": "John", "extra": "string"]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
}
