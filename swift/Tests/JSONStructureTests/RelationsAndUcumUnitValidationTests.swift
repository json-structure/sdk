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
        throw XCTSkip("Pending ucumUnit keyword enforcement in the Swift schema validator")
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
        throw XCTSkip("Pending Relations keyword enforcement in the Swift schema validator")
    }
}
