// JSONStructure Swift SDK Tests
// Error Handling and Serialization Tests

import XCTest
import Foundation
@testable import JSONStructure

/// Tests for error handling and serialization
final class ErrorHandlingTests: XCTestCase {
    
    // MARK: - Multiple Error Collection Tests
    
    func testMultipleRequiredPropertiesMissing() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "a": ["type": "string"],
                "b": ["type": "string"],
                "c": ["type": "string"]
            ],
            "required": ["a", "b", "c"]
        ]
        
        let instance: [String: Any] = [:]
        let result = validator.validate(instance, schema: schema)
        
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.count, 3, "Should have 3 missing property errors")
    }
    
    func testMultipleTypeMismatches() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "name": ["type": "string"],
                "age": ["type": "int32"],
                "active": ["type": "boolean"]
            ]
        ]
        
        let instance: [String: Any] = [
            "name": 123,        // Wrong type
            "age": "thirty",    // Wrong type
            "active": "yes"     // Wrong type
        ]
        let result = validator.validate(instance, schema: schema)
        
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.count, 3, "Should have 3 type mismatch errors")
    }
    
    func testMultipleArrayItemErrors() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": ["type": "string"]
        ]
        
        let instance = [1, 2, 3, 4, 5]  // All wrong type
        let result = validator.validate(instance, schema: schema)
        
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.count, 5, "Should have 5 type errors for array items")
    }
    
    func testNestedErrors() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
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
                            ],
                            "required": ["city"]
                        ]
                    ],
                    "required": ["name"]
                ]
            ],
            "required": ["user"]
        ]
        
        let instance: [String: Any] = [
            "user": [
                "address": [:] as [String: Any]
            ]
        ]
        
        let result = validator.validate(instance, schema: schema)
        
        XCTAssertFalse(result.isValid)
        // Should have errors for missing name and missing city
        XCTAssertGreaterThanOrEqual(result.errors.count, 2)
    }
    
    // MARK: - Error Path Tests
    
    func testErrorPathRoot() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "string"
        ]
        
        let result = validator.validate(123, schema: schema)
        
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.first?.path, "#")
    }
    
    func testErrorPathProperty() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "name": ["type": "string"]
            ]
        ]
        
        let instance: [String: Any] = ["name": 123]
        let result = validator.validate(instance, schema: schema)
        
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.first?.path, "#/name")
    }
    
    func testErrorPathArrayItem() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": ["type": "string"]
        ]
        
        let instance: [Any] = ["a", "b", 123, "d"]
        let result = validator.validate(instance, schema: schema)
        
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.first?.path, "#[2]")
    }
    
    func testErrorPathNestedProperty() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "person": [
                    "type": "object",
                    "properties": [
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
            "person": [
                "address": [
                    "city": 123
                ]
            ]
        ]
        
        let result = validator.validate(instance, schema: schema)
        
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.first?.path, "#/person/address/city")
    }
    
    // MARK: - Schema Error Tests
    
    func testSchemaErrorMultipleIssues() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "a": ["type": "unknown_type"],
                "b": ["type": ["$ref": "#/definitions/Missing"]]
            ],
            "required": ["a", "b", "c"]  // c not in properties
        ]
        
        let result = validator.validate(schema)
        
        XCTAssertFalse(result.isValid)
        XCTAssertGreaterThanOrEqual(result.errors.count, 3)
    }
    
    func testSchemaWarningsWithErrors() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "unknown_type",  // Error
            "minLength": 5  // Warning (extension without $uses)
        ]
        
        let result = validator.validate(schema)
        
        XCTAssertFalse(result.isValid)
        XCTAssertFalse(result.errors.isEmpty)
        XCTAssertFalse(result.warnings.isEmpty)
    }
    
    // MARK: - JSON Parsing Error Tests
    
    func testMalformedJSONSchema() throws {
        let validator = SchemaValidator()
        
        let malformedJSON = "{ invalid json }".data(using: .utf8)!
        
        XCTAssertThrowsError(try validator.validateJSON(malformedJSON))
    }
    
    func testMalformedJSONInstance() throws {
        let validator = InstanceValidator()
        
        let schemaJSON = """
        {"$id": "urn:test", "name": "T", "type": "string"}
        """.data(using: .utf8)!
        
        let instanceJSON = "{ not valid json }".data(using: .utf8)!
        
        XCTAssertThrowsError(try validator.validateJSON(instanceJSON, schemaData: schemaJSON))
    }
    
    // MARK: - Type Coercion Tests
    
    func testIntegerNotAcceptedAsString() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        
        XCTAssertFalse(validator.validate(123, schema: schema).isValid)
        XCTAssertFalse(validator.validate(0, schema: schema).isValid)
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
    }
    
    func testStringNotAcceptedAsNumber() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "number"]
        
        XCTAssertFalse(validator.validate("123", schema: schema).isValid)
        XCTAssertFalse(validator.validate("3.14", schema: schema).isValid)
    }
    
    func testBooleanNotAcceptedAsString() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "boolean"]
        
        XCTAssertFalse(validator.validate("true", schema: schema).isValid)
        XCTAssertFalse(validator.validate("false", schema: schema).isValid)
        XCTAssertFalse(validator.validate(1, schema: schema).isValid)
        XCTAssertFalse(validator.validate(0, schema: schema).isValid)
    }
    
    func testNullNotAcceptedAsString() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        
        XCTAssertFalse(validator.validate(NSNull(), schema: schema).isValid)
    }
    
    // MARK: - Floating Point Edge Cases
    
    func testFloatingPointSpecialValues() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "number"]
        
        // Regular floats should be valid
        XCTAssertTrue(validator.validate(0.0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(-0.0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(Double.pi, schema: schema).isValid)
    }
    
    func testMultipleOfWithFloats() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "multipleOf": 0.5
        ]
        
        XCTAssertTrue(validator.validate(1.5, schema: schema).isValid)
        XCTAssertTrue(validator.validate(2.0, schema: schema).isValid)
        XCTAssertTrue(validator.validate(0.0, schema: schema).isValid)
        XCTAssertFalse(validator.validate(0.3, schema: schema).isValid)
    }
    
    // MARK: - Large Value Tests
    
    func testLargeArray() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": ["type": "int32"]
        ]
        
        let largeArray = Array(1...1000)
        XCTAssertTrue(validator.validate(largeArray, schema: schema).isValid)
    }
    
    func testLargeObject() throws {
        let validator = InstanceValidator()
        
        var properties: [String: Any] = [:]
        for i in 0..<100 {
            properties["prop\(i)"] = ["type": "string"]
        }
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": properties
        ]
        
        var instance: [String: Any] = [:]
        for i in 0..<100 {
            instance["prop\(i)"] = "value\(i)"
        }
        
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
    
    func testLargeMap() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "map",
            "values": ["type": "string"]
        ]
        
        var largeMap: [String: Any] = [:]
        for i in 0..<1000 {
            largeMap["key\(i)"] = "value\(i)"
        }
        
        XCTAssertTrue(validator.validate(largeMap, schema: schema).isValid)
    }
    
    // MARK: - Unicode Tests
    
    func testUnicodeStrings() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        
        let unicodeStrings = [
            "Hello, World!",
            "こんにちは世界",
            "مرحبا بالعالم",
            "שלום עולם",
            "🎉🎊🎈",
            "Mixed: Hello 世界 🌍",
            "\u{0041}\u{0301}",  // A with combining acute accent
            "\u{1F1FA}\u{1F1F8}"  // US flag emoji
        ]
        
        for str in unicodeStrings {
            XCTAssertTrue(validator.validate(str, schema: schema).isValid, "Should accept: \(str)")
        }
    }
    
    func testUnicodeStringLength() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "minLength": 3,
            "maxLength": 10
        ]
        
        // Unicode characters should count correctly
        XCTAssertTrue(validator.validate("こんにちは", schema: schema).isValid)  // 5 chars
        XCTAssertTrue(validator.validate("🎉🎊🎈", schema: schema).isValid)  // 3 emoji
        XCTAssertFalse(validator.validate("こ", schema: schema).isValid)  // 1 char, too short
    }
    
    // MARK: - Whitespace Tests
    
    func testWhitespaceStrings() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        
        // All whitespace strings should be valid strings
        XCTAssertTrue(validator.validate(" ", schema: schema).isValid)
        XCTAssertTrue(validator.validate("\t", schema: schema).isValid)
        XCTAssertTrue(validator.validate("\n", schema: schema).isValid)
        XCTAssertTrue(validator.validate("   ", schema: schema).isValid)
        XCTAssertTrue(validator.validate(" \t\n\r ", schema: schema).isValid)
    }
    
    // MARK: - Escape Sequence Tests
    
    func testEscapedStrings() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        
        // Strings with escape sequences
        XCTAssertTrue(validator.validate("line1\nline2", schema: schema).isValid)
        XCTAssertTrue(validator.validate("tab\there", schema: schema).isValid)
        XCTAssertTrue(validator.validate("quote\"here", schema: schema).isValid)
        XCTAssertTrue(validator.validate("backslash\\here", schema: schema).isValid)
    }
    
    // MARK: - Definition Usage Tests
    
    func testDefinitionUsedMultipleTimes() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "definitions": [
                "Address": [
                    "type": "object",
                    "properties": [
                        "city": ["type": "string"]
                    ],
                    "required": ["city"]
                ]
            ],
            "properties": [
                "home": ["type": ["$ref": "#/definitions/Address"]],
                "work": ["type": ["$ref": "#/definitions/Address"]],
                "shipping": ["type": ["$ref": "#/definitions/Address"]]
            ]
        ]
        
        let instance: [String: Any] = [
            "home": ["city": "NYC"],
            "work": ["city": "Boston"],
            "shipping": ["city": "Chicago"]
        ]
        
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
    
    func testNestedDefinitionReferences() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "definitions": [
                "Inner": [
                    "type": "object",
                    "properties": ["value": ["type": "string"]]
                ],
                "Middle": [
                    "type": "object",
                    "properties": ["inner": ["type": ["$ref": "#/definitions/Inner"]]]
                ],
                "Outer": [
                    "type": "object",
                    "properties": ["middle": ["type": ["$ref": "#/definitions/Middle"]]]
                ]
            ],
            "properties": [
                "outer": ["type": ["$ref": "#/definitions/Outer"]]
            ]
        ]
        
        let instance: [String: Any] = [
            "outer": [
                "middle": [
                    "inner": [
                        "value": "test"
                    ]
                ]
            ]
        ]
        
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
    
    // MARK: - Const and Enum Edge Cases
    
    func testConstWithDifferentTypes() throws {
        let validator = InstanceValidator()
        
        // String const
        let stringConstSchema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "string",
            "const": "fixed"
        ]
        XCTAssertTrue(validator.validate("fixed", schema: stringConstSchema).isValid)
        XCTAssertFalse(validator.validate("other", schema: stringConstSchema).isValid)
        
        // Number const
        let numberConstSchema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "number",
            "const": 42
        ]
        XCTAssertTrue(validator.validate(42, schema: numberConstSchema).isValid)
        XCTAssertFalse(validator.validate(43, schema: numberConstSchema).isValid)
        
        // Boolean const
        let boolConstSchema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "boolean",
            "const": true
        ]
        XCTAssertTrue(validator.validate(true, schema: boolConstSchema).isValid)
        XCTAssertFalse(validator.validate(false, schema: boolConstSchema).isValid)
    }
    
    func testEnumWithNumbers() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "int32",
            "enum": [1, 2, 3, 5, 8, 13]
        ]
        
        XCTAssertTrue(validator.validate(1, schema: schema).isValid)
        XCTAssertTrue(validator.validate(8, schema: schema).isValid)
        XCTAssertFalse(validator.validate(4, schema: schema).isValid)
        XCTAssertFalse(validator.validate(0, schema: schema).isValid)
    }
    
    // MARK: - AdditionalProperties Edge Cases
    
    func testAdditionalPropertiesWithTrue() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "name": ["type": "string"]
            ],
            "additionalProperties": true
        ]
        
        let instance: [String: Any] = [
            "name": "John",
            "extra1": 123,
            "extra2": true,
            "extra3": ["a", "b"]
        ]
        
        XCTAssertTrue(validator.validate(instance, schema: schema).isValid)
    }
    
    func testAdditionalPropertiesWithSchema() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "name": ["type": "string"]
            ],
            "additionalProperties": [
                "type": "int32"
            ]
        ]
        
        // Valid - additional properties match schema
        let valid: [String: Any] = [
            "name": "John",
            "age": 30,
            "score": 100
        ]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        // Invalid - additional property doesn't match
        let invalid: [String: Any] = [
            "name": "John",
            "extra": "not-an-int"
        ]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    // MARK: - Validator Options Tests
    
    func testExtendedOptionDisabled() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: false))
        
        // Without $uses, validation constraints should be ignored
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "string",
            "minLength": 5
        ]
        
        // With extended=false and no $uses, minLength should be ignored
        let result = validator.validate("ab", schema: schema)
        XCTAssertTrue(result.isValid, "With extended=false and no $uses, validation constraints should be ignored")
    }
    
    func testExtendedOptionWithUses() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: false))
        
        // With $uses, validation constraints should be applied even without extended=true
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "minLength": 5
        ]
        
        let result = validator.validate("ab", schema: schema)
        XCTAssertFalse(result.isValid, "With $uses, validation constraints should be applied")
    }
    
    func testSchemaValidatorExtendedOption() throws {
        let validatorExtended = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let validatorBase = SchemaValidator(options: SchemaValidatorOptions(extended: false))
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "string",
            "minLength": 5
        ]
        
        // Both should validate successfully (minLength is a valid keyword)
        XCTAssertTrue(validatorExtended.validate(schema).isValid)
        XCTAssertTrue(validatorBase.validate(schema).isValid)
    }
}
