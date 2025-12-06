// JSONStructure Swift SDK Tests
// Additional Comprehensive Tests for full coverage

import XCTest
import Foundation
@testable import JSONStructure

/// Additional comprehensive tests
final class ComprehensiveTests: XCTestCase {
    
    // MARK: - Int128/Uint128 Tests
    
    func testInt128Type() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int128"]
        
        // Valid int128 values (as strings)
        XCTAssertTrue(validator.validate("0", schema: schema).isValid)
        XCTAssertTrue(validator.validate("123456789012345678901234567890", schema: schema).isValid)
        XCTAssertTrue(validator.validate("-123456789012345678901234567890", schema: schema).isValid)
        
        // Invalid - not a string
        XCTAssertFalse(validator.validate(123, schema: schema).isValid)
    }
    
    func testUint128Type() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint128"]
        
        // Valid uint128 values (as strings)
        XCTAssertTrue(validator.validate("0", schema: schema).isValid)
        XCTAssertTrue(validator.validate("123456789012345678901234567890", schema: schema).isValid)
        
        // Invalid - negative
        XCTAssertFalse(validator.validate("-123", schema: schema).isValid)
    }
    
    // MARK: - Empty Value Tests
    
    func testEmptyString() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        
        XCTAssertTrue(validator.validate("", schema: schema).isValid)
    }
    
    func testEmptyArray() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": ["type": "string"]
        ]
        
        XCTAssertTrue(validator.validate([], schema: schema).isValid)
    }
    
    func testEmptyObject() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object"
        ]
        
        let instance: [String: Any] = [:]
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
    
    func testEmptyMap() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "map",
            "values": ["type": "string"]
        ]
        
        let instance: [String: Any] = [:]
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
    
    func testEmptySet() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "set",
            "items": ["type": "string"]
        ]
        
        XCTAssertTrue(validator.validate([], schema: schema).isValid)
    }
    
    // MARK: - Pattern Tests
    
    func testPatternWithSpecialChars() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "pattern": "^[a-z]+@[a-z]+\\.[a-z]{2,}$"
        ]
        
        XCTAssertTrue(validator.validate("test@example.com", schema: schema).isValid)
        XCTAssertFalse(validator.validate("invalid", schema: schema).isValid)
    }
    
    func testPatternWithUnicode() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "pattern": "^[\\p{L}]+$"  // Unicode letters
        ]
        
        XCTAssertTrue(validator.validate("こんにちは", schema: schema).isValid)
        XCTAssertTrue(validator.validate("Hello", schema: schema).isValid)
        XCTAssertFalse(validator.validate("123", schema: schema).isValid)
    }
    
    // MARK: - Boundary Value Tests
    
    func testBoundaryInt8() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int8"]
        
        XCTAssertTrue(validator.validate(-128, schema: schema).isValid)
        XCTAssertTrue(validator.validate(127, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-129, schema: schema).isValid)
        XCTAssertFalse(validator.validate(128, schema: schema).isValid)
    }
    
    func testBoundaryInt16() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int16"]
        
        XCTAssertTrue(validator.validate(-32768, schema: schema).isValid)
        XCTAssertTrue(validator.validate(32767, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-32769, schema: schema).isValid)
        XCTAssertFalse(validator.validate(32768, schema: schema).isValid)
    }
    
    func testBoundaryInt32() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int32"]
        
        XCTAssertTrue(validator.validate(-2147483648, schema: schema).isValid)
        XCTAssertTrue(validator.validate(2147483647, schema: schema).isValid)
    }
    
    func testBoundaryUint8() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint8"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(255, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
        XCTAssertFalse(validator.validate(256, schema: schema).isValid)
    }
    
    func testBoundaryUint16() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint16"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(65535, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
        XCTAssertFalse(validator.validate(65536, schema: schema).isValid)
    }
    
    func testBoundaryUint32() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint32"]
        
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(4294967295, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
    }
    
    // MARK: - Decimal Edge Cases
    
    func testDecimalPrecision() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "decimal"]
        
        XCTAssertTrue(validator.validate("123.456789012345678901234567890", schema: schema).isValid)
        XCTAssertTrue(validator.validate("-0.00001", schema: schema).isValid)
        XCTAssertTrue(validator.validate("999999999999999999.999999999999999999", schema: schema).isValid)
    }
    
    // MARK: - Nested Array Tests
    
    func testNestedArrays() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": [
                "type": "array",
                "items": ["type": "int32"]
            ]
        ]
        
        // Valid
        XCTAssertTrue(validator.validate([[1, 2], [3, 4], [5, 6]], schema: schema).isValid)
        
        // Invalid - wrong nested type
        XCTAssertFalse(validator.validate([[1, "a"], [3, 4]], schema: schema).isValid)
    }
    
    func testTripleNestedArrays() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": [
                "type": "array",
                "items": [
                    "type": "array",
                    "items": ["type": "string"]
                ]
            ]
        ]
        
        XCTAssertTrue(validator.validate([[["a", "b"], ["c"]], [["d"]]], schema: schema).isValid)
    }
    
    // MARK: - Complex Object Tests
    
    func testDeeplyNestedObject() throws {
        let validator = InstanceValidator()
        
        func buildSchema(depth: Int) -> [String: Any] {
            if depth <= 0 {
                return ["type": "string"]
            }
            return [
                "type": "object",
                "properties": [
                    "nested": buildSchema(depth: depth - 1)
                ]
            ]
        }
        
        var schema = buildSchema(depth: 5)
        schema["$id"] = "urn:test"
        schema["name"] = "DeepNested"
        
        func buildInstance(depth: Int) -> Any {
            if depth <= 0 {
                return "value"
            }
            return ["nested": buildInstance(depth: depth - 1)]
        }
        
        let instance = buildInstance(depth: 5)
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
    
    func testObjectWithManyProperties() throws {
        let validator = InstanceValidator()
        
        var properties: [String: Any] = [:]
        for i in 0..<50 {
            properties["prop\(i)"] = ["type": "string"]
        }
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "ManyProps",
            "type": "object",
            "properties": properties
        ]
        
        var instance: [String: Any] = [:]
        for i in 0..<50 {
            instance["prop\(i)"] = "value\(i)"
        }
        
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
    
    // MARK: - Reference Chain Tests
    
    func testDeepRefChain() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "RefChain",
            "type": "object",
            "properties": [
                "a": ["type": ["$ref": "#/definitions/B"]]
            ],
            "definitions": [
                "B": [
                    "type": "object",
                    "properties": [
                        "b": ["type": ["$ref": "#/definitions/C"]]
                    ]
                ],
                "C": [
                    "type": "object",
                    "properties": [
                        "c": ["type": ["$ref": "#/definitions/D"]]
                    ]
                ],
                "D": [
                    "type": "object",
                    "properties": [
                        "value": ["type": "string"]
                    ]
                ]
            ]
        ]
        
        let instance: [String: Any] = [
            "a": [
                "b": [
                    "c": [
                        "value": "test"
                    ]
                ]
            ]
        ]
        
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
    
    // MARK: - Default Values Tests
    
    func testOptionalProperties() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "OptProps",
            "type": "object",
            "properties": [
                "required": ["type": "string"],
                "optional": ["type": "int32"]
            ],
            "required": ["required"]
        ]
        
        // Valid - only required field
        let instance1: [String: Any] = ["required": "value"]
        XCTAssertTrue(validator.validate(instance1, schema: schema).isValid)
        
        // Valid - both fields
        let instance2: [String: Any] = ["required": "value", "optional": 42]
        XCTAssertTrue(validator.validate(instance2, schema: schema).isValid)
        
        // Invalid - wrong optional type
        let instance3: [String: Any] = ["required": "value", "optional": "not-a-number"]
        XCTAssertFalse(validator.validate(instance3, schema: schema).isValid)
    }
    
    // MARK: - Tuple Edge Cases
    
    func testTupleWithMixedTypes() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "MixedTuple",
            "type": "tuple",
            "tuple": ["name", "age", "active"],
            "properties": [
                "name": ["type": "string"],
                "age": ["type": "int32"],
                "active": ["type": "boolean"]
            ]
        ]
        
        // Valid
        XCTAssertTrue(validator.validate(["John", 30, true], schema: schema).isValid)
        
        // Invalid - wrong order types
        XCTAssertFalse(validator.validate([30, "John", true], schema: schema).isValid)
    }
    
    func testEmptyTuple() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "EmptyTuple",
            "type": "tuple",
            "tuple": [],
            "properties": [:]
        ]
        
        XCTAssertTrue(validator.validate([], schema: schema).isValid)
        XCTAssertFalse(validator.validate(["extra"], schema: schema).isValid)
    }
    
    // MARK: - Choice Edge Cases
    
    func testChoiceWithNestedObjects() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "NestedChoice",
            "type": "choice",
            "choices": [
                "person": [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string"],
                        "age": ["type": "int32"]
                    ],
                    "required": ["name"]
                ],
                "company": [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string"],
                        "employees": ["type": "int32"]
                    ],
                    "required": ["name", "employees"]
                ]
            ]
        ]
        
        // Valid person
        let person: [String: Any] = ["person": ["name": "John", "age": 30]]
        XCTAssertTrue(validator.validate(person, schema: schema).isValid)
        
        // Valid company
        let company: [String: Any] = ["company": ["name": "Acme", "employees": 100]]
        XCTAssertTrue(validator.validate(company, schema: schema).isValid)
        
        // Invalid - company missing required
        let invalidCompany: [String: Any] = ["company": ["name": "Acme"]]
        XCTAssertFalse(validator.validate(invalidCompany, schema: schema).isValid)
    }
    
    // MARK: - Map Key Validation Tests
    
    func testMapWithNumericKeys() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "NumericKeyMap",
            "type": "map",
            "values": ["type": "string"],
            "keyNames": ["pattern": "^[0-9]+$"]
        ]
        
        // Valid
        let valid: [String: Any] = ["1": "a", "2": "b", "100": "c"]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - non-numeric key
        let invalid: [String: Any] = ["1": "a", "abc": "b"]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    // MARK: - Multiple Constraints Tests
    
    func testStringWithAllConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "AllConstraints",
            "type": "string",
            "minLength": 5,
            "maxLength": 20,
            "pattern": "^[a-zA-Z]+$"
        ]
        
        // Valid
        XCTAssertTrue(validator.validate("Hello", schema: schema).isValid)
        XCTAssertTrue(validator.validate("ValidString", schema: schema).isValid)
        
        // Invalid - too short
        XCTAssertFalse(validator.validate("Hi", schema: schema).isValid)
        
        // Invalid - too long
        XCTAssertFalse(validator.validate("ThisStringIsTooLongForTheMaxLength", schema: schema).isValid)
        
        // Invalid - pattern mismatch
        XCTAssertFalse(validator.validate("Hello123", schema: schema).isValid)
    }
    
    func testNumberWithAllConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "AllConstraints",
            "type": "number",
            "minimum": 10,
            "maximum": 100,
            "multipleOf": 5
        ]
        
        // Valid
        XCTAssertTrue(validator.validate(50, schema: schema).isValid)
        XCTAssertTrue(validator.validate(10, schema: schema).isValid)
        XCTAssertTrue(validator.validate(100, schema: schema).isValid)
        
        // Invalid - below minimum
        XCTAssertFalse(validator.validate(5, schema: schema).isValid)
        
        // Invalid - above maximum
        XCTAssertFalse(validator.validate(105, schema: schema).isValid)
        
        // Invalid - not multiple
        XCTAssertFalse(validator.validate(47, schema: schema).isValid)
    }
    
    func testArrayWithAllConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "AllConstraints",
            "type": "array",
            "items": ["type": "string"],
            "minItems": 2,
            "maxItems": 5,
            "uniqueItems": true
        ]
        
        // Valid
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
        
        // Invalid - too few
        XCTAssertFalse(validator.validate(["a"], schema: schema).isValid)
        
        // Invalid - too many
        XCTAssertFalse(validator.validate(["a", "b", "c", "d", "e", "f"], schema: schema).isValid)
        
        // Invalid - not unique
        XCTAssertFalse(validator.validate(["a", "b", "a"], schema: schema).isValid)
    }
    
    // MARK: - Nullable Type Tests
    
    func testNullableString() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "NullableString",
            "type": ["string", "null"]
        ]
        
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
        XCTAssertFalse(validator.validate(123, schema: schema).isValid)
    }
    
    func testNullableObject() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "NullableObject",
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
        
        let person: [String: Any] = ["name": "John"]
        XCTAssertTrue(validator.validate(person, schema: schema).isValid)
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
        XCTAssertFalse(validator.validate("invalid", schema: schema).isValid)
    }
    
    // MARK: - Schema Validator Additional Tests
    
    func testSchemaWithAllIntegerTypes() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        for type in ["int8", "int16", "int32", "int64", "int128", "uint8", "uint16", "uint32", "uint64", "uint128"] {
            let schema: [String: Any] = [
                "$id": "urn:test:\(type)",
                "name": "\(type)Type",
                "type": type
            ]
            
            let result = validator.validate(schema)
            XCTAssertTrue(result.isValid, "Schema with type \(type) should be valid. Errors: \(result.errors)")
        }
    }
    
    func testSchemaWithAllTimeTypes() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        for type in ["date", "datetime", "time", "duration"] {
            let schema: [String: Any] = [
                "$id": "urn:test:\(type)",
                "name": "\(type)Type",
                "type": type
            ]
            
            let result = validator.validate(schema)
            XCTAssertTrue(result.isValid, "Schema with type \(type) should be valid. Errors: \(result.errors)")
        }
    }
    
    func testSchemaWithAllFormatTypes() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        for type in ["uuid", "uri", "binary", "jsonpointer", "decimal"] {
            let schema: [String: Any] = [
                "$id": "urn:test:\(type)",
                "name": "\(type)Type",
                "type": type
            ]
            
            let result = validator.validate(schema)
            XCTAssertTrue(result.isValid, "Schema with type \(type) should be valid. Errors: \(result.errors)")
        }
    }
    
    func testSchemaWithEnumVariants() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        // String enum
        let stringEnumSchema: [String: Any] = [
            "$id": "urn:test:string-enum",
            "name": "StringEnum",
            "type": "string",
            "enum": ["a", "b", "c"]
        ]
        XCTAssertTrue(validator.validate(stringEnumSchema).isValid)
        
        // Int enum
        let intEnumSchema: [String: Any] = [
            "$id": "urn:test:int-enum",
            "name": "IntEnum",
            "type": "int32",
            "enum": [1, 2, 3]
        ]
        XCTAssertTrue(validator.validate(intEnumSchema).isValid)
    }
    
    func testSchemaWithDescription() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:described",
            "name": "DescribedType",
            "description": "A type with a description",
            "type": "object",
            "properties": [
                "name": [
                    "type": "string",
                    "description": "The name of the thing"
                ]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Schema with descriptions should be valid. Errors: \(result.errors)")
    }
    
    // MARK: - Error Code Tests
    
    func testTypeMismatchErrorCodes() throws {
        let validator = InstanceValidator()
        
        // Test each type produces correct error code
        let typeTests: [(type: String, invalid: Any, expectedCode: String)] = [
            ("string", 123, instanceStringExpected),
            ("boolean", "true", instanceBooleanExpected),
            ("number", "123", instanceNumberExpected),
            ("object", "not-object", instanceObjectExpected),
            ("array", "not-array", instanceArrayExpected)
        ]
        
        for (type, invalid, expectedCode) in typeTests {
            let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": type]
            
            // Special handling for array and object types
            var schemaToUse = schema
            if type == "array" {
                schemaToUse["items"] = ["type": "string"]
            }
            
            let result = validator.validate(invalid, schema: schemaToUse)
            XCTAssertFalse(result.isValid)
            XCTAssertTrue(result.errors.contains { $0.code == expectedCode },
                         "Expected error code \(expectedCode) for type \(type), got: \(result.errors.map { $0.code })")
        }
    }
    
    func testConstraintErrorCodes() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        // Test minLength
        let minLengthSchema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "minLength": 5
        ]
        let minLengthResult = validator.validate("ab", schema: minLengthSchema)
        XCTAssertTrue(minLengthResult.errors.contains { $0.code == instanceStringMinLength })
        
        // Test maxLength
        let maxLengthSchema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "maxLength": 5
        ]
        let maxLengthResult = validator.validate("toolongstring", schema: maxLengthSchema)
        XCTAssertTrue(maxLengthResult.errors.contains { $0.code == instanceStringMaxLength })
        
        // Test minimum
        let minimumSchema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "minimum": 10
        ]
        let minimumResult = validator.validate(5, schema: minimumSchema)
        XCTAssertTrue(minimumResult.errors.contains { $0.code == instanceNumberMinimum })
        
        // Test maximum
        let maximumSchema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "maximum": 10
        ]
        let maximumResult = validator.validate(15, schema: maximumSchema)
        XCTAssertTrue(maximumResult.errors.contains { $0.code == instanceNumberMaximum })
    }
    
    // MARK: - Validation Result Tests
    
    func testValidationResultProperties() throws {
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
        
        // Valid result
        let validResult = validator.validate(["name": "test"], schema: schema)
        XCTAssertTrue(validResult.isValid)
        XCTAssertTrue(validResult.errors.isEmpty)
        
        // Invalid result
        let invalidResult = validator.validate(["age": 30], schema: schema)
        XCTAssertFalse(invalidResult.isValid)
        XCTAssertFalse(invalidResult.errors.isEmpty)
        XCTAssertEqual(invalidResult.errors[0].severity, .error)
    }
    
    // MARK: - Special Character Tests
    
    func testPropertyNamesWithSpecialChars() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "SpecialProps",
            "type": "object",
            "properties": [
                "snake_case": ["type": "string"],
                "camelCase": ["type": "string"],
                "kebab-case": ["type": "string"],
                "with.dots": ["type": "string"],
                "$special": ["type": "string"]
            ]
        ]
        
        let instance: [String: Any] = [
            "snake_case": "a",
            "camelCase": "b",
            "kebab-case": "c",
            "with.dots": "d",
            "$special": "e"
        ]
        
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
    
    func testUnicodePropertyNames() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "UnicodeProps",
            "type": "object",
            "properties": [
                "名前": ["type": "string"],
                "возраст": ["type": "int32"],
                "αβγ": ["type": "boolean"]
            ]
        ]
        
        let instance: [String: Any] = [
            "名前": "John",
            "возраст": 30,
            "αβγ": true
        ]
        
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
}
