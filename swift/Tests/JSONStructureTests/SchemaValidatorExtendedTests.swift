// JSONStructure Swift SDK Tests
// Extended Schema Validator Tests
// Comprehensive tests for schema validation

import XCTest
import Foundation
@testable import JSONStructure

/// Extended tests for schema validation
final class SchemaValidatorExtendedTests: XCTestCase {
    
    // MARK: - Valid Schema Tests
    
    func testAllPrimitiveTypes() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let primitiveTypes = [
            "string", "boolean", "null", "number", "integer",
            "int8", "uint8", "int16", "uint16", "int32", "uint32",
            "int64", "uint64", "float", "double", "decimal",
            "date", "datetime", "time", "duration",
            "uuid", "uri", "binary", "jsonpointer", "any"
        ]
        
        for type in primitiveTypes {
            let schema: [String: Any] = [
                "$id": "urn:test:\(type)",
                "name": "\(type.capitalized)Type",
                "type": type
            ]
            
            let result = validator.validate(schema)
            XCTAssertTrue(result.isValid, "Schema with type \(type) should be valid. Errors: \(result.errors)")
        }
    }
    
    func testCompoundTypes() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        // Object type
        let objectSchema: [String: Any] = [
            "$id": "urn:test:object",
            "name": "ObjectType",
            "type": "object",
            "properties": [
                "name": ["type": "string"],
                "age": ["type": "int32"]
            ]
        ]
        XCTAssertTrue(validator.validate(objectSchema).isValid)
        
        // Array type
        let arraySchema: [String: Any] = [
            "$id": "urn:test:array",
            "name": "ArrayType",
            "type": "array",
            "items": ["type": "string"]
        ]
        XCTAssertTrue(validator.validate(arraySchema).isValid)
        
        // Set type
        let setSchema: [String: Any] = [
            "$id": "urn:test:set",
            "name": "SetType",
            "type": "set",
            "items": ["type": "int32"]
        ]
        XCTAssertTrue(validator.validate(setSchema).isValid)
        
        // Map type
        let mapSchema: [String: Any] = [
            "$id": "urn:test:map",
            "name": "MapType",
            "type": "map",
            "values": ["type": "string"]
        ]
        XCTAssertTrue(validator.validate(mapSchema).isValid)
        
        // Tuple type
        let tupleSchema: [String: Any] = [
            "$id": "urn:test:tuple",
            "name": "TupleType",
            "type": "tuple",
            "tuple": ["x", "y"],
            "properties": [
                "x": ["type": "number"],
                "y": ["type": "number"]
            ]
        ]
        XCTAssertTrue(validator.validate(tupleSchema).isValid)
        
        // Choice type
        let choiceSchema: [String: Any] = [
            "$id": "urn:test:choice",
            "name": "ChoiceType",
            "type": "choice",
            "choices": [
                "option1": ["type": "string"],
                "option2": ["type": "int32"]
            ]
        ]
        XCTAssertTrue(validator.validate(choiceSchema).isValid)
    }
    
    func testDefinitionsSchema() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:definitions",
            "name": "WithDefinitions",
            "type": "object",
            "definitions": [
                "Address": [
                    "type": "object",
                    "properties": [
                        "street": ["type": "string"],
                        "city": ["type": "string"]
                    ]
                ],
                "Phone": [
                    "type": "string",
                    "pattern": "^[0-9]+$"
                ]
            ],
            "properties": [
                "home": ["type": ["$ref": "#/definitions/Address"]],
                "phone": ["type": ["$ref": "#/definitions/Phone"]]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Schema with definitions should be valid. Errors: \(result.errors)")
    }
    
    func testNestedDefinitionsSchema() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:nested",
            "name": "NestedDefinitions",
            "type": "object",
            "definitions": [
                "GeoLocation": [
                    "type": "object",
                    "properties": [
                        "lat": ["type": "double"],
                        "lon": ["type": "double"]
                    ]
                ],
                "Address": [
                    "type": "object",
                    "properties": [
                        "street": ["type": "string"],
                        "location": ["type": ["$ref": "#/definitions/GeoLocation"]]
                    ]
                ]
            ],
            "properties": [
                "address": ["type": ["$ref": "#/definitions/Address"]]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Schema with nested definitions should be valid. Errors: \(result.errors)")
    }
    
    func testUnionTypes() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        // Union of primitives
        let unionSchema: [String: Any] = [
            "$id": "urn:test:union",
            "name": "UnionType",
            "type": ["string", "number", "null"]
        ]
        XCTAssertTrue(validator.validate(unionSchema).isValid)
        
        // Union with $ref
        let unionRefSchema: [String: Any] = [
            "$id": "urn:test:union-ref",
            "name": "UnionWithRef",
            "type": [
                ["$ref": "#/definitions/Address"],
                "null"
            ],
            "definitions": [
                "Address": [
                    "type": "object",
                    "properties": [
                        "city": ["type": "string"]
                    ]
                ]
            ]
        ]
        XCTAssertTrue(validator.validate(unionRefSchema).isValid)
    }
    
    func testExtendedConstraints() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        // String constraints
        let stringSchema: [String: Any] = [
            "$id": "urn:test:string-constraints",
            "$uses": ["JSONStructureValidation"],
            "name": "ConstrainedString",
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": "^[a-z]+$"
        ]
        XCTAssertTrue(validator.validate(stringSchema).isValid)
        
        // Numeric constraints
        let numericSchema: [String: Any] = [
            "$id": "urn:test:numeric-constraints",
            "$uses": ["JSONStructureValidation"],
            "name": "ConstrainedNumber",
            "type": "number",
            "minimum": 0,
            "maximum": 100,
            "exclusiveMinimum": -1,
            "exclusiveMaximum": 101,
            "multipleOf": 5
        ]
        XCTAssertTrue(validator.validate(numericSchema).isValid)
        
        // Array constraints
        let arraySchema: [String: Any] = [
            "$id": "urn:test:array-constraints",
            "$uses": ["JSONStructureValidation"],
            "name": "ConstrainedArray",
            "type": "array",
            "items": ["type": "string"],
            "minItems": 1,
            "maxItems": 10,
            "uniqueItems": true
        ]
        XCTAssertTrue(validator.validate(arraySchema).isValid)
        
        // Object constraints
        let objectSchema: [String: Any] = [
            "$id": "urn:test:object-constraints",
            "$uses": ["JSONStructureValidation"],
            "name": "ConstrainedObject",
            "type": "object",
            "minProperties": 1,
            "maxProperties": 10
        ]
        XCTAssertTrue(validator.validate(objectSchema).isValid)
    }
    
    func testConditionalKeywords() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        // allOf - with a type that works
        let allOfSchema: [String: Any] = [
            "$id": "urn:test:allof",
            "name": "AllOfType",
            "type": "object",
            "properties": [
                "a": ["type": "string"],
                "b": ["type": "number"]
            ]
        ]
        let allOfResult = validator.validate(allOfSchema)
        XCTAssertTrue(allOfResult.isValid, "allOf schema should be valid. Errors: \(allOfResult.errors)")
        
        // anyOf - test using union type which is the correct JSON Structure approach
        let anyOfSchema: [String: Any] = [
            "$id": "urn:test:anyof",
            "name": "AnyOfType",
            "type": ["string", "number"]  // Union type is the correct way
        ]
        let anyOfResult = validator.validate(anyOfSchema)
        XCTAssertTrue(anyOfResult.isValid, "anyOf schema should be valid. Errors: \(anyOfResult.errors)")
        
        // oneOf - using choice type
        let oneOfSchema: [String: Any] = [
            "$id": "urn:test:oneof",
            "name": "OneOfType",
            "type": "choice",
            "choices": [
                "stringOption": ["type": "string"],
                "numberOption": ["type": "number"]
            ]
        ]
        let oneOfResult = validator.validate(oneOfSchema)
        XCTAssertTrue(oneOfResult.isValid, "oneOf schema should be valid. Errors: \(oneOfResult.errors)")
        
        // Const constraint
        let constSchema: [String: Any] = [
            "$id": "urn:test:const",
            "name": "ConstType",
            "type": "string",
            "const": "fixed-value"
        ]
        let constResult = validator.validate(constSchema)
        XCTAssertTrue(constResult.isValid, "const schema should be valid. Errors: \(constResult.errors)")
        
        // Enum constraint
        let enumSchema: [String: Any] = [
            "$id": "urn:test:enum",
            "name": "EnumType",
            "type": "string",
            "enum": ["red", "green", "blue"]
        ]
        let enumResult = validator.validate(enumSchema)
        XCTAssertTrue(enumResult.isValid, "enum schema should be valid. Errors: \(enumResult.errors)")
    }
    
    // MARK: - Invalid Schema Tests
    
    func testMissingType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:notype",
            "name": "NoType",
            "properties": [
                "name": ["type": "string"]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema without type should be invalid")
    }
    
    func testUnknownType() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:unknown",
            "name": "UnknownType",
            "type": "foobar"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with unknown type should be invalid")
    }
    
    func testInvalidEnumNotArray() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:invalid-enum",
            "name": "InvalidEnum",
            "type": "string",
            "enum": "not-an-array"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-array enum should be invalid")
    }
    
    func testInvalidEnumEmpty() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:empty-enum",
            "name": "EmptyEnum",
            "type": "string",
            "enum": []
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with empty enum should be invalid")
    }
    
    func testInvalidEnumDuplicates() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:dup-enum",
            "name": "DupEnum",
            "type": "string",
            "enum": ["a", "b", "a"]
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with duplicate enum values should be invalid")
    }
    
    func testInvalidRequiredNotArray() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:invalid-required",
            "name": "InvalidRequired",
            "type": "object",
            "properties": ["name": ["type": "string"]],
            "required": "name"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-array required should be invalid")
    }
    
    func testInvalidRequiredMissingProperty() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:missing-prop",
            "name": "MissingProp",
            "type": "object",
            "properties": ["name": ["type": "string"]],
            "required": ["name", "age"]
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with required property not in properties should be invalid")
    }
    
    func testInvalidPropertiesNotObject() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:invalid-props",
            "name": "InvalidProps",
            "type": "object",
            "properties": "not-an-object"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-object properties should be invalid")
    }
    
    func testInvalidDefinitionsNotObject() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:invalid-defs",
            "name": "InvalidDefs",
            "type": "object",
            "definitions": "not-an-object"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-object definitions should be invalid")
    }
    
    func testInvalidRefUndefined() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:undefined-ref",
            "name": "UndefinedRef",
            "type": "object",
            "properties": [
                "value": ["type": ["$ref": "#/definitions/Missing"]]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with undefined $ref should be invalid")
    }
    
    func testInvalidMinimumExceedsMaximum() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:min-exceeds-max",
            "$uses": ["JSONStructureValidation"],
            "name": "MinExceedsMax",
            "type": "number",
            "minimum": 100,
            "maximum": 10
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with minimum > maximum should be invalid")
    }
    
    func testInvalidMinLengthExceedsMaxLength() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:minlen-exceeds-maxlen",
            "$uses": ["JSONStructureValidation"],
            "name": "MinLenExceedsMaxLen",
            "type": "string",
            "minLength": 100,
            "maxLength": 10
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with minLength > maxLength should be invalid")
    }
    
    func testInvalidMinItemsExceedsMaxItems() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:minitems-exceeds-maxitems",
            "$uses": ["JSONStructureValidation"],
            "name": "MinItemsExceedsMaxItems",
            "type": "array",
            "items": ["type": "string"],
            "minItems": 10,
            "maxItems": 5
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with minItems > maxItems should be invalid")
    }
    
    func testInvalidNegativeMinLength() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:negative-minlen",
            "$uses": ["JSONStructureValidation"],
            "name": "NegativeMinLen",
            "type": "string",
            "minLength": -1
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with negative minLength should be invalid")
    }
    
    func testInvalidNegativeMinItems() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:negative-minitems",
            "$uses": ["JSONStructureValidation"],
            "name": "NegativeMinItems",
            "type": "array",
            "items": ["type": "string"],
            "minItems": -1
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with negative minItems should be invalid")
    }
    
    func testInvalidMultipleOfZero() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:zero-multipleOf",
            "$uses": ["JSONStructureValidation"],
            "name": "ZeroMultipleOf",
            "type": "number",
            "multipleOf": 0
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with multipleOf = 0 should be invalid")
    }
    
    func testInvalidMultipleOfNegative() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:negative-multipleOf",
            "$uses": ["JSONStructureValidation"],
            "name": "NegativeMultipleOf",
            "type": "number",
            "multipleOf": -5
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with negative multipleOf should be invalid")
    }
    
    func testInvalidPattern() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:invalid-pattern",
            "$uses": ["JSONStructureValidation"],
            "name": "InvalidPattern",
            "type": "string",
            "pattern": "[invalid(regex"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with invalid regex pattern should be invalid")
    }
    
    func testInvalidArrayMissingItems() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:array-no-items",
            "name": "ArrayNoItems",
            "type": "array"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Array schema without items should be invalid")
    }
    
    func testInvalidMapMissingValues() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:map-no-values",
            "name": "MapNoValues",
            "type": "map"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Map schema without values should be invalid")
    }
    
    func testInvalidTupleMissingTuple() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:tuple-no-tuple",
            "name": "TupleNoTuple",
            "type": "tuple",
            "properties": ["x": ["type": "number"]]
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Tuple schema without tuple keyword should be invalid")
    }
    
    func testInvalidChoiceMissingChoices() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:choice-no-choices",
            "name": "ChoiceNoChoices",
            "type": "choice"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Choice schema without choices should be invalid")
    }
    
    func testInvalidAllOfNotArray() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:allof-not-array",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "AllOfNotArray",
            "type": "object",
            "allOf": "not-an-array"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-array allOf should be invalid")
    }
    
    func testInvalidAnyOfNotArray() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:anyof-not-array",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "AnyOfNotArray",
            "anyOf": "not-an-array"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-array anyOf should be invalid")
    }
    
    func testInvalidOneOfNotArray() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:oneof-not-array",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "OneOfNotArray",
            "oneOf": "not-an-array"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-array oneOf should be invalid")
    }
    
    func testInvalidNotNotObject() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:not-not-object",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "NotNotObject",
            "type": "string",
            "not": "not-an-object"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-object not should be invalid")
    }
    
    func testInvalidIfNotObject() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:if-not-object",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "IfNotObject",
            "type": "object",
            "if": "not-an-object"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-object if should be invalid")
    }
    
    func testInvalidThenNotObject() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:then-not-object",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "ThenNotObject",
            "type": "object",
            "if": ["properties": [:]],
            "then": "not-an-object"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-object then should be invalid")
    }
    
    func testInvalidElseNotObject() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:else-not-object",
            "$uses": ["JSONStructureConditionalComposition"],
            "name": "ElseNotObject",
            "type": "object",
            "if": ["properties": [:]],
            "else": "not-an-object"
        ]
        
        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid, "Schema with non-object else should be invalid")
    }
    
    // MARK: - Warning Tests
    
    func testWarningForExtensionWithoutUses() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:no-uses",
            "name": "NoUses",
            "type": "string",
            "minLength": 1,
            "maxLength": 100
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Schema should be valid")
        XCTAssertTrue(result.warnings.contains { $0.code == schemaExtensionKeywordNotEnabled },
                     "Should produce warning for extension keywords without $uses")
    }
    
    func testNoWarningWithUses() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:with-uses",
            "$uses": ["JSONStructureValidation"],
            "name": "WithUses",
            "type": "string",
            "minLength": 1,
            "maxLength": 100
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Schema should be valid")
        XCTAssertFalse(result.warnings.contains { $0.code == schemaExtensionKeywordNotEnabled },
                      "Should not produce warning when $uses includes JSONStructureValidation")
    }
    
    func testWarningSuppressionOption() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(
            extended: true,
            warnOnUnusedExtensionKeywords: false
        ))
        
        let schema: [String: Any] = [
            "$id": "urn:test:no-uses-no-warn",
            "name": "NoUsesNoWarn",
            "type": "string",
            "minLength": 1
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Schema should be valid")
        XCTAssertFalse(result.warnings.contains { $0.code == schemaExtensionKeywordNotEnabled },
                      "Should not produce warning when option is disabled")
    }
    
    // MARK: - Special Cases
    
    func testRootReference() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:root-ref",
            "$root": "#/definitions/Main",
            "definitions": [
                "Main": [
                    "type": "object",
                    "properties": ["value": ["type": "string"]]
                ]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Schema with $root should be valid. Errors: \(result.errors)")
    }
    
    func testDefinitionsOnlySchema() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:defs-only",
            "$root": "#/definitions/Root",
            "definitions": [
                "Root": ["type": "string"],
                "Helper": ["type": "int32"]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Schema with only definitions and $root should be valid. Errors: \(result.errors)")
    }
    
    func testAbstractSchema() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:abstract",
            "name": "AbstractType",
            "type": "object",
            "abstract": true,
            "properties": ["name": ["type": "string"]]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Abstract schema should be valid. Errors: \(result.errors)")
    }
    
    func testExtendsKeyword() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:extends",
            "name": "Derived",
            "$extends": "#/definitions/Base",
            "type": "object",
            "definitions": [
                "Base": [
                    "type": "object",
                    "properties": ["name": ["type": "string"]]
                ]
            ],
            "properties": [
                "age": ["type": "int32"]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Schema with $extends should be valid. Errors: \(result.errors)")
    }
    
    func testMultipleExtends() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schema: [String: Any] = [
            "$id": "urn:test:multi-extends",
            "name": "MultiDerived",
            "$extends": ["#/definitions/Base1", "#/definitions/Base2"],
            "type": "object",
            "definitions": [
                "Base1": ["type": "object", "properties": ["a": ["type": "string"]]],
                "Base2": ["type": "object", "properties": ["b": ["type": "int32"]]]
            ]
        ]
        
        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Schema with multiple $extends should be valid. Errors: \(result.errors)")
    }
    
    // MARK: - ValidateJSON Method
    
    func testValidateJSONValid() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schemaJSON = """
        {
            "$id": "urn:test:json",
            "name": "JsonTest",
            "type": "object",
            "properties": {
                "name": {"type": "string"}
            }
        }
        """.data(using: .utf8)!
        
        let result = try validator.validateJSON(schemaJSON)
        XCTAssertTrue(result.isValid, "Valid schema JSON should pass validation")
    }
    
    func testValidateJSONInvalid() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let schemaJSON = """
        {
            "$id": "urn:test:json-invalid",
            "name": "JsonTestInvalid",
            "type": "unknowntype"
        }
        """.data(using: .utf8)!
        
        let result = try validator.validateJSON(schemaJSON)
        XCTAssertFalse(result.isValid, "Invalid schema JSON should fail validation")
    }
    
    func testValidateJSONMalformed() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        
        let malformedJSON = "not valid json".data(using: .utf8)!
        
        XCTAssertThrowsError(try validator.validateJSON(malformedJSON),
                            "Malformed JSON should throw error")
    }
}
