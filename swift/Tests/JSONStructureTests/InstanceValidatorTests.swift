// JSONStructure Swift SDK Tests
// Instance Validator Tests

import XCTest
@testable import JSONStructure

final class InstanceValidatorTests: XCTestCase {
    
    // MARK: - Valid Instance Tests
    
    func testValidObject() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:test-schema",
            "name": "TestType",
            "type": "object",
            "properties": [
                "name": ["type": "string"],
                "age": ["type": "int32"]
            ],
            "required": ["name"]
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let instance: [String: Any] = [
            "name": "John",
            "age": 30
        ]
        
        let result = validator.validate(instance, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidString() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:string-schema",
            "name": "StringType",
            "type": "string"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("hello", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidBoolean() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:boolean-schema",
            "name": "BooleanType",
            "type": "boolean"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate(true, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidNull() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:null-schema",
            "name": "NullType",
            "type": "null"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate(NSNull(), schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidNumber() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:number-schema",
            "name": "NumberType",
            "type": "number"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate(3.14, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidInteger() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:integer-schema",
            "name": "IntegerType",
            "type": "integer"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate(42, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidArray() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:array-schema",
            "name": "ArrayType",
            "type": "array",
            "items": ["type": "string"]
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate(["a", "b", "c"], schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidSet() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:set-schema",
            "name": "SetType",
            "type": "set",
            "items": ["type": "int32"]
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate([1, 2, 3], schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidMap() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:map-schema",
            "name": "MapType",
            "type": "map",
            "values": ["type": "int32"]
        ]
        
        let validator = InstanceValidator()
        let instance: [String: Any] = ["a": 1, "b": 2]
        let result = validator.validate(instance, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidTuple() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:tuple-schema",
            "name": "TupleType",
            "type": "tuple",
            "properties": [
                "x": ["type": "int32"],
                "y": ["type": "int32"]
            ],
            "tuple": ["x", "y"]
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate([10, 20], schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidChoice() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:choice-schema",
            "name": "ChoiceType",
            "type": "choice",
            "choices": [
                "option1": ["type": "string"],
                "option2": ["type": "int32"]
            ]
        ]
        
        let validator = InstanceValidator()
        let instance: [String: Any] = ["option1": "hello"]
        let result = validator.validate(instance, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidDate() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:date-schema",
            "name": "DateType",
            "type": "date"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("2024-01-15", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidDatetime() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:datetime-schema",
            "name": "DatetimeType",
            "type": "datetime"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("2024-01-15T14:30:00Z", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidTime() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:time-schema",
            "name": "TimeType",
            "type": "time"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("14:30:00", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidDuration() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:duration-schema",
            "name": "DurationType",
            "type": "duration"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("P1Y2M3D", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidUUID() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:uuid-schema",
            "name": "UUIDType",
            "type": "uuid"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("550e8400-e29b-41d4-a716-446655440000", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidURI() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:uri-schema",
            "name": "URIType",
            "type": "uri"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("https://example.com/path", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidBinary() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:binary-schema",
            "name": "BinaryType",
            "type": "binary"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("SGVsbG8gV29ybGQ=", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidJsonPointer() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:jsonpointer-schema",
            "name": "JsonPointerType",
            "type": "jsonpointer"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("/foo/bar/0", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidDecimal() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:decimal-schema",
            "name": "DecimalType",
            "type": "decimal"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("123.456", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidEnum() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:enum-schema",
            "name": "EnumType",
            "type": "string",
            "enum": ["red", "green", "blue"]
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("green", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testValidConst() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:const-schema",
            "name": "ConstType",
            "type": "string",
            "const": "fixed-value"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("fixed-value", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    // MARK: - Invalid Instance Tests
    
    func testTypeMismatchString() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:string-schema",
            "name": "StringType",
            "type": "string"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate(42, schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (type mismatch)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceStringExpected })
    }
    
    func testTypeMismatchBoolean() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:boolean-schema",
            "name": "BooleanType",
            "type": "boolean"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("true", schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (type mismatch)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceBooleanExpected })
    }
    
    func testMissingRequiredProperty() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:test-schema",
            "name": "TestType",
            "type": "object",
            "properties": [
                "name": ["type": "string"]
            ],
            "required": ["name"]
        ]
        
        let validator = InstanceValidator()
        let instance: [String: Any] = [:]
        let result = validator.validate(instance, schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (missing required property)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceRequiredPropertyMissing })
    }
    
    func testAdditionalPropertyNotAllowed() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:test-schema",
            "name": "TestType",
            "type": "object",
            "properties": [
                "name": ["type": "string"]
            ],
            "additionalProperties": false
        ]
        
        let validator = InstanceValidator()
        let instance: [String: Any] = [
            "name": "John",
            "extra": "not allowed"
        ]
        let result = validator.validate(instance, schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (additional property)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceAdditionalPropertyNotAllowed })
    }
    
    func testEnumMismatch() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:enum-schema",
            "name": "EnumType",
            "type": "string",
            "enum": ["red", "green", "blue"]
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("yellow", schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (enum mismatch)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceEnumMismatch })
    }
    
    func testConstMismatch() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:const-schema",
            "name": "ConstType",
            "type": "string",
            "const": "fixed-value"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("wrong-value", schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (const mismatch)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceConstMismatch })
    }
    
    func testSetDuplicate() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:set-schema",
            "name": "SetType",
            "type": "set",
            "items": ["type": "int32"]
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate([1, 2, 1], schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (set duplicate)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceSetDuplicate })
    }
    
    func testTupleLengthMismatch() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:tuple-schema",
            "name": "TupleType",
            "type": "tuple",
            "properties": [
                "x": ["type": "int32"],
                "y": ["type": "int32"]
            ],
            "tuple": ["x", "y"]
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate([10, 20, 30], schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (tuple length mismatch)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceTupleLengthMismatch })
    }
    
    func testInvalidDateFormat() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:date-schema",
            "name": "DateType",
            "type": "date"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("not-a-date", schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (invalid date format)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceDateFormatInvalid })
    }
    
    func testInvalidUUIDFormat() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:uuid-schema",
            "name": "UUIDType",
            "type": "uuid"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate("not-a-uuid", schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (invalid uuid format)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceUUIDFormatInvalid })
    }
    
    func testIntRangeInvalid() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:int8-schema",
            "name": "Int8Type",
            "type": "int8"
        ]
        
        let validator = InstanceValidator()
        let result = validator.validate(200, schema: schema) // int8 max is 127
        XCTAssertFalse(result.isValid, "Expected invalid instance (int range invalid)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceIntRangeInvalid })
    }
    
    // MARK: - Extended Validation Tests
    
    func testMinLength() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:minlen-schema",
            "$uses": ["JSONStructureValidation"],
            "name": "MinLenType",
            "type": "string",
            "minLength": 5
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate("hi", schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (minLength)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceStringMinLength })
    }
    
    func testMaxLength() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:maxlen-schema",
            "$uses": ["JSONStructureValidation"],
            "name": "MaxLenType",
            "type": "string",
            "maxLength": 5
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate("hello world", schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (maxLength)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceStringMaxLength })
    }
    
    func testPattern() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:pattern-schema",
            "$uses": ["JSONStructureValidation"],
            "name": "PatternType",
            "type": "string",
            "pattern": "^[a-z]+$"
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate("ABC123", schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (pattern mismatch)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceStringPatternMismatch })
    }
    
    func testMinimum() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:min-schema",
            "$uses": ["JSONStructureValidation"],
            "name": "MinType",
            "type": "int32",
            "minimum": 10
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate(5, schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (minimum)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceNumberMinimum })
    }
    
    func testMaximum() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:max-schema",
            "$uses": ["JSONStructureValidation"],
            "name": "MaxType",
            "type": "int32",
            "maximum": 10
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate(15, schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (maximum)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceNumberMaximum })
    }
    
    func testMinItems() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:minitems-schema",
            "$uses": ["JSONStructureValidation"],
            "name": "MinItemsType",
            "type": "array",
            "items": ["type": "string"],
            "minItems": 3
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate(["a"], schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (minItems)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceMinItems })
    }
    
    func testMaxItems() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:maxitems-schema",
            "$uses": ["JSONStructureValidation"],
            "name": "MaxItemsType",
            "type": "array",
            "items": ["type": "string"],
            "maxItems": 2
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate(["a", "b", "c", "d"], schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (maxItems)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceMaxItems })
    }
    
    // MARK: - Reference Tests
    
    func testRefResolution() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:ref-schema",
            "name": "RefType",
            "type": "object",
            "properties": [
                "value": [
                    "type": ["$ref": "#/definitions/MyString"]
                ]
            ],
            "definitions": [
                "MyString": ["type": "string"]
            ]
        ]
        
        let validator = InstanceValidator()
        let instance: [String: Any] = ["value": "hello"]
        let result = validator.validate(instance, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance with $ref, got errors: \(result.errors)")
    }
    
    func testRootReference() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:root-ref-schema",
            "$root": "#/definitions/MyType",
            "definitions": [
                "MyType": [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string"]
                    ]
                ]
            ]
        ]
        
        let validator = InstanceValidator()
        let instance: [String: Any] = ["name": "test"]
        let result = validator.validate(instance, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance with $root, got errors: \(result.errors)")
    }
    
    // MARK: - Conditional Composition Tests
    
    func testAllOf() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:allof-schema",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "AllOfType",
            "type": "object",
            "properties": [
                "name": ["type": "string"]
            ],
            "allOf": [
                [
                    "properties": [
                        "age": ["type": "int32"]
                    ],
                    "required": ["age"]
                ]
            ]
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let instance: [String: Any] = ["name": "John", "age": 30]
        let result = validator.validate(instance, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance with allOf, got errors: \(result.errors)")
    }
    
    func testAnyOfSuccess() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:anyof-schema",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "AnyOfType",
            "anyOf": [
                ["type": "string"],
                ["type": "int32"]
            ]
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate("hello", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance with anyOf, got errors: \(result.errors)")
    }
    
    func testAnyOfFailure() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:anyof-schema",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "AnyOfType",
            "anyOf": [
                ["type": "string"],
                ["type": "int32"]
            ]
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate(true, schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (anyOf none matched)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceAnyOfNoneMatched })
    }
    
    func testOneOfSuccess() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:oneof-schema",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "OneOfType",
            "oneOf": [
                ["type": "string"],
                ["type": "int32"]
            ]
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate("hello", schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance with oneOf, got errors: \(result.errors)")
    }
    
    func testNotSchema() throws {
        let schema: [String: Any] = [
            "$id": "urn:example:not-schema",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "NotType",
            "type": "string",
            "not": [
                "type": "string",
                "const": "forbidden"
            ]
        ]
        
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let result = validator.validate("forbidden", schema: schema)
        XCTAssertFalse(result.isValid, "Expected invalid instance (not matched)")
        XCTAssertTrue(result.errors.contains { $0.code == instanceNotMatched })
    }
}
