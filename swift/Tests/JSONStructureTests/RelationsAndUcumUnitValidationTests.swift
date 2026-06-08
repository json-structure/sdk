import XCTest
@testable import JSONStructure

final class RelationsAndUcumUnitValidationTests: XCTestCase {
    func testValidNumericTypeWithUcumUnit() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "urn:example:ucum-number",
            "name": "Length",
            "$uses": ["JSONStructureUnits"],
            "type": "number",
            "ucumUnit": "m"
        ]

        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }

    func testValidNumericTypeWithUnitAndUcumUnit() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "urn:example:ucum-both",
            "name": "Length",
            "$uses": ["JSONStructureUnits"],
            "type": "number",
            "unit": "meter",
            "ucumUnit": "m"
        ]

        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }

    func testValidExtendedNumericTypesWithUcumUnit() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))

        for type in ["int32", "float", "double", "decimal"] {
            let schema: [String: Any] = [
                "$schema": "https://json-structure.org/meta/extended/v0/#",
                "$id": "urn:example:ucum-\(type)",
                "name": "\(type)WithUcumUnit",
                "$uses": ["JSONStructureUnits"],
                "type": type,
                "ucumUnit": "m"
            ]

            let result = validator.validate(schema)
            XCTAssertTrue(result.isValid, "Expected valid schema for \(type), got errors: \(result.errors)")
        }
    }

    func testInvalidUcumUnitScenariosArePending() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))

        let invalidTypeSchema: [String: Any] = [
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "urn:example:ucum-invalid-type",
            "name": "BadUcumType",
            "type": "string",
            "ucumUnit": "m"
        ]

        let invalidValueSchema: [String: Any] = [
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "urn:example:ucum-invalid-value",
            "name": "BadUcumValue",
            "$uses": ["JSONStructureUnits"],
            "type": "number",
            "ucumUnit": 5
        ]

        let invalidTypeResult = validator.validate(invalidTypeSchema)
        XCTAssertFalse(invalidTypeResult.isValid)
        XCTAssertTrue(invalidTypeResult.errors.contains { $0.message.contains("JSONStructureUnits extension") })
        XCTAssertTrue(invalidTypeResult.errors.contains { $0.message.contains("can only appear in numeric schemas") })

        let invalidValueResult = validator.validate(invalidValueSchema)
        XCTAssertFalse(invalidValueResult.isValid)
        XCTAssertTrue(invalidValueResult.errors.contains { $0.message.contains("'ucumUnit' must be a string.") })
    }

    func testValidRelationsIdentityArray() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "urn:example:relations-identity",
            "name": "OrderIdentity",
            "$uses": ["JSONStructureRelations"],
            "type": "object",
            "properties": [
                "id": ["type": "string"],
                "tenantId": ["type": "string"]
            ],
            "identity": ["id", "tenantId"]
        ]

        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }

    func testValidRelationsDeclarations() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))
        let schema: [String: Any] = [
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "urn:example:relations-valid",
            "name": "OrderRelations",
            "$uses": ["JSONStructureRelations"],
            "type": "object",
            "properties": [
                "id": ["type": "string"],
                "customerId": ["type": "string"],
                "itemIds": [
                    "type": "array",
                    "items": ["type": "string"]
                ],
                "qualifier": ["type": "string"]
            ],
            "relations": [
                "customer": [
                    "cardinality": "single",
                    "targettype": ["$ref": "#/definitions/Customer"]
                ],
                "items": [
                    "cardinality": "multiple",
                    "targettype": ["$ref": "#/definitions/Item"],
                    "scope": "line-items"
                ],
                "qualifiedCustomer": [
                    "cardinality": "single",
                    "targettype": ["$ref": "#/definitions/Customer"],
                    "qualifiertype": ["$ref": "#/definitions/RelationQualifier"]
                ]
            ],
            "definitions": [
                "Customer": [
                    "name": "Customer",
                    "type": "object",
                    "properties": ["id": ["type": "string"]]
                ],
                "Item": [
                    "name": "Item",
                    "type": "object",
                    "properties": ["id": ["type": "string"]]
                ],
                "RelationQualifier": [
                    "name": "RelationQualifier",
                    "type": "string"
                ]
            ]
        ]

        let result = validator.validate(schema)
        XCTAssertTrue(result.isValid, "Expected valid schema, got errors: \(result.errors)")
    }

    func testInvalidRelationsScenariosArePending() throws {
        let validator = SchemaValidator(options: SchemaValidatorOptions(extended: true))

        let schema: [String: Any] = [
            "$schema": "https://json-structure.org/meta/extended/v0/#",
            "$id": "urn:example:relations-invalid",
            "name": "BadRelations",
            "type": "string",
            "identity": ["id"],
            "relations": [
                "customer": [
                    "cardinality": "many",
                    "targettype": ["type": "object"],
                    "scope": ["tenant", 3],
                    "qualifiertype": ["type": "string"]
                ]
            ]
        ]

        let result = validator.validate(schema)
        XCTAssertFalse(result.isValid)
        XCTAssertTrue(result.errors.contains { $0.message.contains("JSONStructureRelations extension") })
        XCTAssertTrue(result.errors.contains { $0.message.contains("'identity' can only appear in object or tuple schemas.") })
        XCTAssertTrue(result.errors.contains { $0.message.contains("'identity' references property 'id' that is not in 'properties'.") })
        XCTAssertTrue(result.errors.contains { $0.message.contains("'relations' can only appear in object or tuple schemas.") })
        XCTAssertTrue(result.errors.contains { $0.message.contains("'targettype' must be an object with '$ref'.") })
        XCTAssertTrue(result.errors.contains { $0.message.contains("'cardinality' must be 'single' or 'multiple'.") })
        XCTAssertTrue(result.errors.contains { $0.message.contains("'scope' array items must be strings.") })
        XCTAssertTrue(result.errors.contains { $0.message.contains("'qualifiertype' must be an object with '$ref'.") })
    }
}
