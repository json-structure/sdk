// JSONStructure Swift SDK Tests
// Additional Validation Tests

import XCTest
import Foundation
@testable import JSONStructure

/// Additional validation tests to expand coverage
final class AdditionalValidationTests: XCTestCase {
    
    // MARK: - Schema Validation Tests
    
    func testSchemaWithStringType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithBooleanType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "boolean"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithNullType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "null"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithNumberType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "number"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithIntegerType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "integer"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithInt8Type() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int8"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithUint8Type() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint8"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithInt16Type() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int16"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithUint16Type() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint16"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithInt32Type() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int32"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithUint32Type() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint32"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithInt64Type() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int64"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithUint64Type() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint64"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithInt128Type() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int128"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithUint128Type() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint128"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithFloatType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "float"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithDoubleType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "double"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithDecimalType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "decimal"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithDateType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "date"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithDatetimeType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "datetime"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithTimeType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "time"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithDurationType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "duration"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithUUIDType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uuid"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithURIType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uri"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithBinaryType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "binary"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithJsonPointerType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "jsonpointer"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithAnyType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "any"]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithObjectType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "name": ["type": "string"]
            ]
        ]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithArrayType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": ["type": "string"]
        ]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithSetType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "set",
            "items": ["type": "string"]
        ]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithMapType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "map",
            "values": ["type": "string"]
        ]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithTupleType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
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
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    func testSchemaWithChoiceType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "choice",
            "choices": [
                "a": ["type": "string"],
                "b": ["type": "int32"]
            ]
        ]
        XCTAssertTrue(validator.validate(schema).isValid)
    }
    
    // MARK: - Invalid Schema Tests
    
    func testInvalidSchemaWithUnknownType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "unknown"]
        XCTAssertFalse(validator.validate(schema).isValid)
    }
    
    func testInvalidSchemaWithEmptyEnum() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string", "enum": []]
        XCTAssertFalse(validator.validate(schema).isValid)
    }
    
    func testInvalidSchemaWithDuplicateEnum() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string", "enum": ["a", "a"]]
        XCTAssertFalse(validator.validate(schema).isValid)
    }
    
    func testInvalidSchemaWithMissingItems() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "array"]
        XCTAssertFalse(validator.validate(schema).isValid)
    }
    
    func testInvalidSchemaWithMissingValues() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "map"]
        XCTAssertFalse(validator.validate(schema).isValid)
    }
    
    func testInvalidSchemaWithMissingChoices() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "choice"]
        XCTAssertFalse(validator.validate(schema).isValid)
    }
    
    func testInvalidSchemaWithMissingTuple() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "tuple", "properties": ["x": ["type": "number"]]]
        XCTAssertFalse(validator.validate(schema).isValid)
    }
    
    // MARK: - Instance Error Tests
    
    func testInstanceStringInsteadOfObject() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": ["name": ["type": "string"]]
        ]
        
        let result = validator.validate("not-an-object", schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.first?.code, instanceObjectExpected)
    }
    
    func testInstanceObjectInsteadOfString() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        
        let result = validator.validate(["key": "value"], schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.first?.code, instanceStringExpected)
    }
    
    func testInstanceArrayInsteadOfObject() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": ["name": ["type": "string"]]
        ]
        
        let result = validator.validate(["a", "b", "c"], schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.first?.code, instanceObjectExpected)
    }
    
    func testInstanceNumberInsteadOfString() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        
        let result = validator.validate(42, schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.first?.code, instanceStringExpected)
    }
    
    func testInstanceBooleanInsteadOfNumber() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "number"]
        
        let result = validator.validate(true, schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.first?.code, instanceNumberExpected)
    }
    
    func testInstanceNullInsteadOfBoolean() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "boolean"]
        
        let result = validator.validate(NSNull(), schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertEqual(result.errors.first?.code, instanceBooleanExpected)
    }
    
    // MARK: - Constraint Error Code Tests
    
    func testMinLengthErrorCode() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "minLength": 10
        ]
        
        let result = validator.validate("short", schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceStringMinLength })
    }
    
    func testMaxLengthErrorCode() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "maxLength": 5
        ]
        
        let result = validator.validate("this is too long", schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceStringMaxLength })
    }
    
    func testPatternErrorCode() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "string",
            "pattern": "^[a-z]+$"
        ]
        
        let result = validator.validate("ABC123", schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceStringPatternMismatch })
    }
    
    func testMinimumErrorCode() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "minimum": 100
        ]
        
        let result = validator.validate(50, schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceNumberMinimum })
    }
    
    func testMaximumErrorCode() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "maximum": 100
        ]
        
        let result = validator.validate(200, schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceNumberMaximum })
    }
    
    func testMultipleOfErrorCode() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "number",
            "multipleOf": 5
        ]
        
        let result = validator.validate(7, schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceNumberMultipleOf })
    }
    
    func testMinItemsErrorCode() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "array",
            "items": ["type": "string"],
            "minItems": 5
        ]
        
        let result = validator.validate(["a", "b"], schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceMinItems })
    }
    
    func testMaxItemsErrorCode() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "array",
            "items": ["type": "string"],
            "maxItems": 2
        ]
        
        let result = validator.validate(["a", "b", "c", "d"], schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceMaxItems })
    }
    
    func testUniqueItemsErrorCode() throws {
        let validator = InstanceValidator(options: InstanceValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$id": "urn:test",
            "$uses": ["JSONStructureValidation"],
            "name": "T",
            "type": "array",
            "items": ["type": "string"],
            "uniqueItems": true
        ]
        
        let result = validator.validate(["a", "b", "a"], schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceSetDuplicate })
    }
    
    func testEnumErrorCode() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "string",
            "enum": ["red", "green", "blue"]
        ]
        
        let result = validator.validate("yellow", schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceEnumMismatch })
    }
    
    func testConstErrorCode() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "string",
            "const": "expected"
        ]
        
        let result = validator.validate("different", schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceConstMismatch })
    }
    
    func testRequiredPropertyErrorCode() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": ["name": ["type": "string"]],
            "required": ["name"]
        ]
        
        let result = validator.validate([:] as [String: Any], schema: schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.code == instanceRequiredPropertyMissing })
    }
    
    // MARK: - ValidateJSON Method Tests
    
    func testValidateJSONInstance() throws {
        let validator = InstanceValidator()
        
        let schemaJSON = """
        {"$id": "urn:test", "name": "T", "type": "object", "properties": {"name": {"type": "string"}}}
        """.data(using: .utf8)!
        
        let instanceJSON = """
        {"name": "John"}
        """.data(using: .utf8)!
        
        let result = try validator.validateJSON(instanceJSON, schemaData: schemaJSON)
        XCTAssertTrue(result.isValid)
    }
    
    func testValidateJSONInstanceInvalid() throws {
        let validator = InstanceValidator()
        
        let schemaJSON = """
        {"$id": "urn:test", "name": "T", "type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
        """.data(using: .utf8)!
        
        let instanceJSON = """
        {}
        """.data(using: .utf8)!
        
        let result = try validator.validateJSON(instanceJSON, schemaData: schemaJSON)
        XCTAssertFalse(result.isValid)
    }
    
    func testSchemaValidateJSON() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schemaJSON = """
        {"$id": "urn:test", "name": "T", "type": "string"}
        """.data(using: .utf8)!
        
        let result = try validator.validateJSON(schemaJSON)
        XCTAssertTrue(result.isValid)
    }
    
    func testSchemaValidateJSONInvalid() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schemaJSON = """
        {"$id": "urn:test", "name": "T", "type": "invalid_type"}
        """.data(using: .utf8)!
        
        let result = try validator.validateJSON(schemaJSON)
        XCTAssertFalse(result.isValid)
    }
    
    // MARK: - Additional Type Tests
    
    func testInt128TypeValidation() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int128"]
        
        XCTAssertTrue(validator.validate("0", schema: schema).isValid)
        XCTAssertTrue(validator.validate("-170141183460469231731687303715884105728", schema: schema).isValid)
        XCTAssertTrue(validator.validate("170141183460469231731687303715884105727", schema: schema).isValid)
        XCTAssertFalse(validator.validate(123, schema: schema).isValid)
    }
    
    func testUint128TypeValidation() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint128"]
        
        XCTAssertTrue(validator.validate("0", schema: schema).isValid)
        XCTAssertTrue(validator.validate("340282366920938463463374607431768211455", schema: schema).isValid)
        XCTAssertFalse(validator.validate("-1", schema: schema).isValid)
        XCTAssertFalse(validator.validate(123, schema: schema).isValid)
    }
    
    // MARK: - Complex Nested Validation
    
    func testDeeplyNestedObjectValidation() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "object",
            "properties": [
                "level1": [
                    "type": "object",
                    "properties": [
                        "level2": [
                            "type": "object",
                            "properties": [
                                "level3": [
                                    "type": "object",
                                    "properties": [
                                        "value": ["type": "string"]
                                    ],
                                    "required": ["value"]
                                ]
                            ],
                            "required": ["level3"]
                        ]
                    ],
                    "required": ["level2"]
                ]
            ],
            "required": ["level1"]
        ]
        
        let valid: [String: Any] = [
            "level1": [
                "level2": [
                    "level3": [
                        "value": "test"
                    ]
                ]
            ]
        ]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        let invalid: [String: Any] = [
            "level1": [
                "level2": [
                    "level3": [:]
                ]
            ]
        ]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testArrayOfMapsValidation() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "array",
            "items": [
                "type": "map",
                "values": ["type": "int32"]
            ]
        ]
        
        let valid: [[String: Int]] = [
            ["a": 1, "b": 2],
            ["x": 10, "y": 20, "z": 30]
        ]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        let invalid: [[String: Any]] = [
            ["a": 1, "b": "two"]
        ]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
    
    func testMapOfArraysValidation() throws {
        let validator = InstanceValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:test",
            "name": "T",
            "type": "map",
            "values": [
                "type": "array",
                "items": ["type": "string"]
            ]
        ]
        
        let valid: [String: [String]] = [
            "group1": ["a", "b", "c"],
            "group2": ["x", "y"]
        ]
        XCTAssertTrue(validator.validate(valid, schema: schema).isValid)
        
        let invalid: [String: Any] = [
            "group1": ["a", 2, "c"]
        ]
        XCTAssertFalse(validator.validate(invalid, schema: schema).isValid)
    }
}
