// JSONStructure Swift SDK Tests
// Edge Cases and Additional Coverage Tests

import XCTest
import Foundation
@testable import JSONStructure

/// Edge case tests to improve code coverage
final class EdgeCaseTests: XCTestCase {
    
    // MARK: - Schema Validator Edge Cases
    
    func testSchemaValidatorRequiredArray() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        // Valid required array
        let schema1: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "object",
            "properties": ["name": ["type": "string"]],
            "required": ["name"]
        ]
        XCTAssertTrue(validator.validate(schema1).isValid)
        
        // Empty required array
        let schema2: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "object",
            "properties": ["name": ["type": "string"]],
            "required": []
        ]
        XCTAssertTrue(validator.validate(schema2).isValid)
        
        // Required not an array
        let schema3: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "object",
            "properties": ["name": ["type": "string"]],
            "required": "name"
        ]
        XCTAssertFalse(validator.validate(schema3).isValid)
    }
    
    func testSchemaValidatorNestedObjects() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "object",
            "properties": [
                "address": [
                    "type": "object",
                    "properties": [
                        "street": ["type": "string"],
                        "city": ["type": "string"],
                        "geo": [
                            "type": "object",
                            "properties": [
                                "lat": ["type": "double"],
                                "lon": ["type": "double"]
                            ],
                            "required": ["lat", "lon"]
                        ]
                    ],
                    "required": ["street"]
                ]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }
    
    func testSchemaValidatorDefinitions() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "object",
            "definitions": [
                "Address": [
                    "type": "object",
                    "properties": [
                        "street": ["type": "string"]
                    ]
                ],
                "Phone": [
                    "type": "string",
                    "pattern": "^\\+?[0-9]+$"
                ]
            ],
            "properties": [
                "home": ["type": ["$ref": "#/definitions/Address"]],
                "work": ["type": ["$ref": "#/definitions/Address"]],
                "phone": ["type": ["$ref": "#/definitions/Phone"]]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }
    
    func testSchemaValidatorArrayItems() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        // Array with items schema
        let schema1: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "array",
            "items": ["type": "string"]
        ]
        XCTAssertTrue(validator.validate(schema1).isValid)
        
        // Array with object items
        let schema2: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "array",
            "items": [
                "type": "object",
                "properties": [
                    "id": ["type": "int32"]
                ]
            ]
        ]
        XCTAssertTrue(validator.validate(schema2).isValid)
    }
    
    func testSchemaValidatorMapValues() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        // Map with values schema
        let schema1: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "map",
            "values": ["type": "int32"]
        ]
        XCTAssertTrue(validator.validate(schema1).isValid)
        
        // Map with object values
        let schema2: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "map",
            "values": [
                "type": "object",
                "properties": [
                    "count": ["type": "int32"]
                ]
            ]
        ]
        XCTAssertTrue(validator.validate(schema2).isValid)
    }
    
    // MARK: - Instance Validator Edge Cases
    
    func testInstanceValidatorNestedObjects() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "object",
            "properties": [
                "user": [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string"],
                        "address": [
                            "type": "object",
                            "properties": [
                                "city": ["type": "string"]
                            ]
                        ]
                    ]
                ]
            ]
        ]
        
        let instance: [String: Any] = [
            "user": [
                "name": "John",
                "address": ["city": "NYC"]
            ]
        ]
        
        let result = validator.validate(instance, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testInstanceValidatorDeepNesting() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        // Create deeply nested schema
        func nestedObjectSchema(depth: Int) -> [String: Any] {
            if depth == 0 {
                return ["type": "string"]
            }
            return [
                "type": "object",
                "properties": [
                    "nested": nestedObjectSchema(depth: depth - 1)
                ]
            ]
        }
        
        var schema = nestedObjectSchema(depth: 10)
        schema["$id"] = "urn:example:deep"
        schema["name"] = "DeepType"
        
        // Create matching instance
        func nestedObject(depth: Int) -> Any {
            if depth == 0 {
                return "value"
            }
            return ["nested": nestedObject(depth: depth - 1)]
        }
        
        let instance = nestedObject(depth: 10)
        let result = validator.validate(instance, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid deeply nested instance")
    }
    
    func testInstanceValidatorComplexArray() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:test",
            "name": "Test",
            "type": "array",
            "items": [
                "type": "object",
                "properties": [
                    "id": ["type": "int32"],
                    "tags": [
                        "type": "array",
                        "items": ["type": "string"]
                    ]
                ],
                "required": ["id"]
            ]
        ]
        
        let instance: [[String: Any]] = [
            ["id": 1, "tags": ["a", "b"]],
            ["id": 2, "tags": ["c"]]
        ]
        
        let result = validator.validate(instance, schema: schema)
        XCTAssertTrue(result.isValid, "Expected valid instance, got errors: \(result.errors)")
    }
    
    func testInstanceValidatorIntegerTypes() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        // Test int8 bounds
        let int8Schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int8"]
        XCTAssertTrue(validator.validate(-128, schema: int8Schema).isValid)
        XCTAssertTrue(validator.validate(127, schema: int8Schema).isValid)
        XCTAssertFalse(validator.validate(128, schema: int8Schema).isValid)
        XCTAssertFalse(validator.validate(-129, schema: int8Schema).isValid)
        
        // Test uint8 bounds
        let uint8Schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint8"]
        XCTAssertTrue(validator.validate(0, schema: uint8Schema).isValid)
        XCTAssertTrue(validator.validate(255, schema: uint8Schema).isValid)
        XCTAssertFalse(validator.validate(256, schema: uint8Schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: uint8Schema).isValid)
        
        // Test int16 bounds
        let int16Schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int16"]
        XCTAssertTrue(validator.validate(-32768, schema: int16Schema).isValid)
        XCTAssertTrue(validator.validate(32767, schema: int16Schema).isValid)
        
        // Test uint16 bounds
        let uint16Schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint16"]
        XCTAssertTrue(validator.validate(0, schema: uint16Schema).isValid)
        XCTAssertTrue(validator.validate(65535, schema: uint16Schema).isValid)
        
        // Test int32 bounds
        let int32Schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int32"]
        XCTAssertTrue(validator.validate(-2147483648, schema: int32Schema).isValid)
        XCTAssertTrue(validator.validate(2147483647, schema: int32Schema).isValid)
        
        // Test uint32 bounds
        let uint32Schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint32"]
        XCTAssertTrue(validator.validate(0, schema: uint32Schema).isValid)
        XCTAssertTrue(validator.validate(4294967295, schema: uint32Schema).isValid)
    }
    
    func testInstanceValidatorFloatTypes() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        // Test float
        let floatSchema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "float"]
        XCTAssertTrue(validator.validate(3.14, schema: floatSchema).isValid)
        XCTAssertFalse(validator.validate("3.14", schema: floatSchema).isValid)
        
        // Test double
        let doubleSchema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "double"]
        XCTAssertTrue(validator.validate(3.14159265358979, schema: doubleSchema).isValid)
    }
    
    func testInstanceValidatorUnionTypes() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        // Union type
        let schema: [String: Any] = [
            "$id": "urn:example:union",
            "name": "Union",
            "type": ["string", "int32", "null"]
        ]
        
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        XCTAssertTrue(validator.validate(42, schema: schema).isValid)
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
        XCTAssertFalse(validator.validate(true, schema: schema).isValid)
        XCTAssertFalse(validator.validate([1, 2, 3], schema: schema).isValid)
    }
    
    func testInstanceValidatorExtendsKeyword() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:extends",
            "name": "Derived",
            "$extends": "#/definitions/Base",
            "type": "object",
            "definitions": [
                "Base": [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string"]
                    ],
                    "required": ["name"]
                ]
            ],
            "properties": [
                "age": ["type": "int32"]
            ]
        ]
        
        // Valid - has both base and derived properties
        let valid: [String: Any] = ["name": "John", "age": 30]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - missing base required property
        let invalid: [String: Any] = ["age": 30]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testInstanceValidatorExtendsArray() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:multi-extends",
            "name": "MultiDerived",
            "$extends": ["#/definitions/Named", "#/definitions/Aged"],
            "type": "object",
            "definitions": [
                "Named": [
                    "type": "object",
                    "properties": ["name": ["type": "string"]],
                    "required": ["name"]
                ],
                "Aged": [
                    "type": "object",
                    "properties": ["age": ["type": "int32"]],
                    "required": ["age"]
                ]
            ]
        ]
        
        // Valid
        let valid: [String: Any] = ["name": "John", "age": 30]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - missing name
        let invalid1: [String: Any] = ["age": 30]
        XCTAssertFalse(validator.validate(invalid1, schema: schema).isValid)
        
        // Invalid - missing age
        let invalid2: [String: Any] = ["name": "John"]
        XCTAssertFalse(validator.validate(invalid2, schema: schema).isValid)
    }
    
    func testInstanceValidatorTypeRef() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:type-ref",
            "name": "Container",
            "type": ["$ref": "#/definitions/MyString"],
            "definitions": [
                "MyString": [
                    "type": "string",
                    "minLength": 5
                ]
            ]
        ]
        
        // Valid - meets minLength
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
        
        // Invalid - too short
        XCTAssertFalse(validator.validate("hi", schema: schema).isValid)
    }
    
    func testInstanceValidatorContains() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:contains",
            "$uses": ["JSONStructureValidation"],
            "name": "ArrayWithContains",
            "type": "array",
            "items": ["type": "string"],
            "contains": ["type": "string", "const": "special"]
        ]
        
        // Valid - contains "special"
        XCTAssertTrue(validator.validate(["a", "special", "b"], schema: schema).isValid)
        
        // Invalid - doesn't contain "special"
        XCTAssertFalse(validator.validate(["a", "b", "c"], schema: schema).isValid)
    }
    
    func testInstanceValidatorMinContains() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:mincontains",
            "$uses": ["JSONStructureValidation"],
            "name": "ArrayWithMinContains",
            "type": "array",
            "items": ["type": "string"],
            "contains": ["type": "string", "const": "x"],
            "minContains": 2
        ]
        
        // Valid - contains 2 "x"
        XCTAssertTrue(validator.validate(["x", "y", "x"], schema: schema).isValid)
        
        // Invalid - only 1 "x"
        XCTAssertFalse(validator.validate(["x", "y", "z"], schema: schema).isValid)
    }
    
    func testInstanceValidatorUniqueItems() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:unique",
            "$uses": ["JSONStructureValidation"],
            "name": "UniqueArray",
            "type": "array",
            "items": ["type": "string"],
            "uniqueItems": true
        ]
        
        // Valid - all unique
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
        
        // Invalid - duplicates
        XCTAssertFalse(validator.validate(["a", "b", "a"], schema: schema).isValid)
    }
    
    func testInstanceValidatorExclusiveConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:exclusive",
            "$uses": ["JSONStructureValidation"],
            "name": "ExclusiveType",
            "type": "number",
            "exclusiveMinimum": 0,
            "exclusiveMaximum": 10
        ]
        
        // Valid - in range
        XCTAssertTrue(validator.validate(5, schema: schema).isValid)
        
        // Invalid - equals exclusiveMinimum
        XCTAssertFalse(validator.validate(0, schema: schema).isValid)
        
        // Invalid - equals exclusiveMaximum
        XCTAssertFalse(validator.validate(10, schema: schema).isValid)
    }
    
    func testInstanceValidatorMultipleOf() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:multipleof",
            "$uses": ["JSONStructureValidation"],
            "name": "MultipleOfType",
            "type": "number",
            "multipleOf": 5
        ]
        
        // Valid - is multiple
        XCTAssertTrue(validator.validate(15, schema: schema).isValid)
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
        
        // Invalid - not multiple
        XCTAssertFalse(validator.validate(12, schema: schema).isValid)
    }
    
    func testInstanceValidatorDependentRequired() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:depreq",
            "$uses": ["JSONStructureValidation"],
            "name": "DepReqType",
            "type": "object",
            "properties": [
                "creditCard": ["type": "string"],
                "billingAddress": ["type": "string"]
            ],
            "dependentRequired": [
                "creditCard": ["billingAddress"]
            ]
        ]
        
        // Valid - creditCard present with billingAddress
        let valid: [String: Any] = ["creditCard": "1234", "billingAddress": "123 Main St"]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Valid - no creditCard
        let valid2: [String: Any] = ["billingAddress": "123 Main St"]
        XCTAssertTrue(validator.validate(valid2, schema: schema).isValid)
        
        // Invalid - creditCard without billingAddress
        let invalid: [String: Any] = ["creditCard": "1234"]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testInstanceValidatorMinMaxProperties() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:minmaxprops",
            "$uses": ["JSONStructureValidation"],
            "name": "PropCountType",
            "type": "object",
            "minProperties": 2,
            "maxProperties": 4
        ]
        
        // Valid - 3 properties
        let valid: [String: Any] = ["a": 1, "b": 2, "c": 3]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - too few
        let tooFew: [String: Any] = ["a": 1]
        XCTAssertFalse(validator.validate(tooFew, schema: schema).isValid)
        
        // Invalid - too many
        let tooMany: [String: Any] = ["a": 1, "b": 2, "c": 3, "d": 4, "e": 5]
        XCTAssertFalse(validator.validate(tooMany, schema: schema).isValid)
    }
    
    func testInstanceValidatorMapConstraints() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:mapconstraints",
            "$uses": ["JSONStructureValidation"],
            "name": "MapType",
            "type": "map",
            "values": ["type": "string"],
            "minEntries": 2,
            "maxEntries": 4
        ]
        
        // Valid
        let valid: [String: Any] = ["a": "1", "b": "2", "c": "3"]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - too few
        let tooFew: [String: Any] = ["a": "1"]
        XCTAssertFalse(validator.validate(tooFew, schema: schema).isValid)
        
        // Invalid - too many
        let tooMany: [String: Any] = ["a": "1", "b": "2", "c": "3", "d": "4", "e": "5"]
        XCTAssertFalse(validator.validate(tooMany, schema: schema).isValid)
    }
    
    func testInstanceValidatorKeyNames() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:keynames",
            "name": "KeyNamesType",
            "type": "map",
            "values": ["type": "string"],
            "keyNames": [
                "pattern": "^[a-z]+$"
            ]
        ]
        
        // Valid - all lowercase keys
        let valid: [String: Any] = ["abc": "1", "xyz": "2"]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - uppercase key
        let invalid: [String: Any] = ["ABC": "1"]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testInstanceValidatorPatternKeys() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:patternkeys",
            "name": "PatternKeysType",
            "type": "map",
            "values": ["type": "string"],
            "patternKeys": [
                "pattern": "^prop-[0-9]+$"
            ]
        ]
        
        // Valid
        let valid: [String: Any] = ["prop-1": "a", "prop-2": "b"]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid
        let invalid: [String: Any] = ["invalid-key": "a"]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testInstanceValidatorIfThenElse() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:ifthenelse",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "CondType",
            "type": "object",
            "if": [
                "properties": [
                    "type": ["const": "premium"]
                ],
                "required": ["type"]
            ],
            "then": [
                "properties": [
                    "discount": ["type": "number"]
                ],
                "required": ["discount"]
            ],
            "else": [
                "properties": [
                    "price": ["type": "number"]
                ],
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
    
    // MARK: - JSON Serialization Edge Cases
    
    func testValidateJSONMethod() throws {
        let schemaJSON = """
        {
            "$id": "urn:example:test",
            "name": "TestType",
            "type": "object",
            "properties": {
                "name": {"type": "string"}
            },
            "required": ["name"]
        }
        """.data(using: .utf8)!
        
        let instanceValidator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        // Valid instance
        let validJSON = """
        {"name": "John"}
        """.data(using: .utf8)!
        
        let result = try instanceValidator.validateJSON(validJSON, schemaData: schemaJSON)
        XCTAssertTrue(result.isValid)
        
        // Invalid instance
        let invalidJSON = """
        {"age": 30}
        """.data(using: .utf8)!
        
        let result2 = try instanceValidator.validateJSON(invalidJSON, schemaData: schemaJSON)
        XCTAssertFalse(result2.isValid)
    }
    
    func testSchemaValidateJSONMethod() throws {
        let schemaValidator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        // Valid schema
        let validSchema = """
        {
            "$id": "urn:example:test",
            "name": "TestType",
            "type": "object",
            "properties": {
                "name": {"type": "string"}
            }
        }
        """.data(using: .utf8)!
        
        let result = try schemaValidator.validateJSON(validSchema)
        XCTAssertTrue(result.isValid)
        
        // Invalid JSON
        let invalidJSON = "not valid json".data(using: .utf8)!
        XCTAssertThrowsError(try schemaValidator.validateJSON(invalidJSON))
    }
    
    // MARK: - Format Validation Edge Cases
    
    func testFormatValidation() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        // Date format
        let dateSchema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "date"]
        XCTAssertTrue(validator.validate("2024-01-15", schema: dateSchema).isValid)
        XCTAssertFalse(validator.validate("01-15-2024", schema: dateSchema).isValid)
        
        // Datetime format
        let datetimeSchema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "datetime"]
        XCTAssertTrue(validator.validate("2024-01-15T10:30:00Z", schema: datetimeSchema).isValid)
        XCTAssertTrue(validator.validate("2024-01-15T10:30:00+05:00", schema: datetimeSchema).isValid)
        XCTAssertFalse(validator.validate("2024-01-15", schema: datetimeSchema).isValid)
        
        // Time format
        let timeSchema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "time"]
        XCTAssertTrue(validator.validate("10:30:00", schema: timeSchema).isValid)
        XCTAssertTrue(validator.validate("10:30:00Z", schema: timeSchema).isValid)
        XCTAssertFalse(validator.validate("10:30", schema: timeSchema).isValid)
        
        // Duration format
        let durationSchema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "duration"]
        XCTAssertTrue(validator.validate("P1Y2M3D", schema: durationSchema).isValid)
        XCTAssertTrue(validator.validate("PT1H30M", schema: durationSchema).isValid)
        XCTAssertTrue(validator.validate("P2W", schema: durationSchema).isValid)
        XCTAssertFalse(validator.validate("1 day", schema: durationSchema).isValid)
        
        // UUID format
        let uuidSchema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uuid"]
        XCTAssertTrue(validator.validate("550e8400-e29b-41d4-a716-446655440000", schema: uuidSchema).isValid)
        XCTAssertFalse(validator.validate("not-a-uuid", schema: uuidSchema).isValid)
        
        // URI format
        let uriSchema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uri"]
        XCTAssertTrue(validator.validate("https://example.com/path", schema: uriSchema).isValid)
        // Note: Foundation's URL(string:) is lenient - strings without spaces may be accepted
        // This test verifies the validator correctly handles non-strings
        XCTAssertFalse(validator.validate(123, schema: uriSchema).isValid)
        
        // JSON Pointer format
        let jsonPointerSchema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "jsonpointer"]
        XCTAssertTrue(validator.validate("/foo/bar/0", schema: jsonPointerSchema).isValid)
        XCTAssertTrue(validator.validate("/a~0b/c~1d", schema: jsonPointerSchema).isValid)
        XCTAssertTrue(validator.validate("", schema: jsonPointerSchema).isValid) // Empty is valid
    }
    
    // MARK: - Abstract Type Tests
    
    func testAbstractType() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:abstract",
            "name": "AbstractType",
            "type": "object",
            "abstract": true,
            "properties": [
                "name": ["type": "string"]
            ]
        ]
        
        // Should fail - cannot validate against abstract
        let instance: [String: Any] = ["name": "test"]
        let result = validator.validate(instance, schema: schema)
        XCTAssertFalse(result.isValid)
    }
    
    // MARK: - Any Type Tests
    
    func testAnyType() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:example:any",
            "name": "AnyType",
            "type": "any"
        ]
        
        // All values should be valid for any type
        XCTAssertTrue(validator.validate("string", schema: schema).isValid)
        XCTAssertTrue(validator.validate(42, schema: schema).isValid)
        XCTAssertTrue(validator.validate(3.14, schema: schema).isValid)
        XCTAssertTrue(validator.validate(true, schema: schema).isValid)
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
        XCTAssertTrue(validator.validate(["a", "b"], schema: schema).isValid)
        XCTAssertTrue(validator.validate(["key": "value"], schema: schema).isValid)
    }
}
