// JSONStructure Swift SDK Tests
// Schema Validator Tests

import XCTest
@testable import JSONStructure

final class SchemaValidatorTests: XCTestCase {
    
    // MARK: - Valid Schema Tests
    
    func testValidSimpleSchema() throws {
        let validator = SchemaValidator()
        
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
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }
    
    func testValidStringType() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:string-schema",
            "name": "StringType",
            "type": "string"
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }
    
    func testValidArrayType() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:array-schema",
            "name": "ArrayType",
            "type": "array",
            "items": ["type": "string"]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }
    
    func testValidMapType() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:map-schema",
            "name": "MapType",
            "type": "map",
            "values": ["type": "int32"]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }
    
    func testValidTupleType() throws {
        let validator = SchemaValidator()
        
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
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }
    
    func testValidChoiceType() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:choice-schema",
            "name": "ChoiceType",
            "type": "choice",
            "choices": [
                "option1": ["type": "string"],
                "option2": ["type": "int32"]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }
    
    func testValidDefinitionsOnlySchema() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:defs-schema",
            "definitions": [
                "MyType": [
                    "type": "string"
                ]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }
    
    func testValidRootReference() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:root-ref-schema",
            "$root": "#/definitions/MyType",
            "definitions": [
                "MyType": [
                    "type": "string"
                ]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }
    
    // MARK: - Invalid Schema Tests
    
    func testMissingType() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:missing-type",
            "name": "MissingType",
            "properties": [
                "name": ["type": "string"]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (missing type)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaMissingType })
    }
    
    func testUnknownType() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:unknown-type",
            "name": "UnknownType",
            "type": "foobar"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (unknown type)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaTypeInvalid })
    }
    
    func testMissingId() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "name": "MissingId",
            "type": "string"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (missing $id)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaRootMissingID })
    }
    
    func testMissingName() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:missing-name",
            "type": "string"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (missing name)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaRootMissingName })
    }
    
    func testArrayMissingItems() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:array-missing-items",
            "name": "ArrayMissingItems",
            "type": "array"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (array missing items)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaArrayMissingItems })
    }
    
    func testMapMissingValues() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:map-missing-values",
            "name": "MapMissingValues",
            "type": "map"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (map missing values)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaMapMissingValues })
    }
    
    func testTupleMissingDefinition() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:tuple-missing-def",
            "name": "TupleMissingDef",
            "type": "tuple",
            "properties": [
                "x": ["type": "int32"]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (tuple missing definition)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaTupleMissingDefinition })
    }
    
    func testChoiceMissingChoices() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:choice-missing",
            "name": "ChoiceMissing",
            "type": "choice"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (choice missing choices)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaChoiceMissingChoices })
    }
    
    func testEnumEmpty() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:enum-empty",
            "name": "EnumEmpty",
            "type": "string",
            "enum": [] as [Any]
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (enum empty)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaEnumEmpty })
    }
    
    func testEnumDuplicates() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:enum-duplicates",
            "name": "EnumDuplicates",
            "type": "string",
            "enum": ["a", "b", "a"]
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (enum duplicates)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaEnumDuplicates })
    }
    
    func testRefNotFound() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:ref-not-found",
            "name": "RefNotFound",
            "type": "object",
            "properties": [
                "value": [
                    "type": ["$ref": "#/definitions/NonExistent"]
                ]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (ref not found)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaRefNotFound })
    }
    
    func testDefsNotObject() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:defs-not-object",
            "name": "DefsNotObject",
            "type": "object",
            "definitions": "not-an-object"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (definitions not object)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaPropertiesNotObject })
    }
    
    func testMinLengthExceedsMaxLength() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:minlen-exceeds",
            "name": "MinLenExceeds",
            "type": "string",
            "minLength": 10,
            "maxLength": 5
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (minLength exceeds maxLength)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaMinGreaterThanMax })
    }
    
    func testMinimumExceedsMaximum() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:min-exceeds",
            "name": "MinExceeds",
            "type": "int32",
            "minimum": 100,
            "maximum": 50
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (minimum exceeds maximum)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaMinGreaterThanMax })
    }
    
    func testMinItemsExceedsMaxItems() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:minitems-exceeds",
            "name": "MinItemsExceeds",
            "type": "array",
            "items": ["type": "string"],
            "minItems": 10,
            "maxItems": 5
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (minItems exceeds maxItems)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaMinGreaterThanMax })
    }
    
    func testInvalidRegexPattern() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:invalid-regex",
            "name": "InvalidRegex",
            "type": "string",
            "pattern": "[invalid"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (invalid regex)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaPatternInvalid })
    }
    
    func testMultipleOfZero() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:multipleof-zero",
            "name": "MultipleOfZero",
            "type": "int32",
            "multipleOf": 0
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (multipleOf zero)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaPositiveNumberConstraintInvalid })
    }
    
    func testConstraintTypeMismatch() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:constraint-mismatch",
            "name": "ConstraintMismatch",
            "type": "string",
            "minimum": 10  // numeric constraint on string
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (constraint type mismatch)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaConstraintInvalidForType })
    }
    
    // MARK: - Conditional Keywords Tests
    
    func testValidAllOf() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:allof",
            "name": "AllOfType",
            "type": "object",
            "allOf": [
                [
                    "type": "object",
                    "properties": ["a": ["type": "string"]]
                ]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema with allOf, got errors: \(result.errors)")
    }
    
    func testAllOfNotArray() throws {
        let validator = SchemaValidator()
        
        let schema: [String: Any] = [
            "$id": "urn:example:allof-not-array",
            "name": "AllOfNotArray",
            "type": "object",
            "allOf": "not-an-array"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Expected invalid schema (allOf not array)")
        XCTAssertTrue(result.errors.contains { $0.code == schemaCompositionNotArray })
    }
    
    // MARK: - All Type Tests
    
    func testAllPrimitiveTypes() throws {
        let validator = SchemaValidator()
        
        for typeName in primitiveTypes {
            let schema: [String: Any] = [
                "$id": "urn:example:\(typeName)-schema",
                "name": "\(typeName.capitalized)Type",
                "type": typeName
            ]
            
            let result = validator.validate(schema)
            XCTAssertTrue(result.isValid, "Expected valid schema for type '\(typeName)', got errors: \(result.errors)")
        }
    }
}
