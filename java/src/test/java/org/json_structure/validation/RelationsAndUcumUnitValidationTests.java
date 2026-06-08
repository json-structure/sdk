// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class RelationsAndUcumUnitValidationTests {

    private SchemaValidator validator;

    @BeforeEach
    void setUp() {
        validator = new SchemaValidator();
    }

    @Test
    @DisplayName("Valid numeric type with ucumUnit")
    void validNumericTypeWithUcumUnit() {
        String schema = """
            {
                "$schema": "https://json-structure.org/meta/extended/v0/#",
                "$id": "https://test.example.com/schema/ucum-number",
                "name": "Length",
                "$uses": ["JSONStructureUnits"],
                "type": "number",
                "ucumUnit": "m"
            }
            """;

        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Test
    @DisplayName("Valid numeric type with unit and ucumUnit")
    void validNumericTypeWithUnitAndUcumUnit() {
        String schema = """
            {
                "$schema": "https://json-structure.org/meta/extended/v0/#",
                "$id": "https://test.example.com/schema/ucum-both",
                "name": "Length",
                "$uses": ["JSONStructureUnits"],
                "type": "number",
                "unit": "meter",
                "ucumUnit": "m"
            }
            """;

        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"int32", "float", "double", "decimal"})
    @DisplayName("Valid extended numeric types with ucumUnit")
    void validExtendedNumericTypesWithUcumUnit(String typeName) {
        String schema = """
            {
                "$schema": "https://json-structure.org/meta/extended/v0/#",
                "$id": "https://test.example.com/schema/ucum-%s",
                "name": "%sWithUcumUnit",
                "$uses": ["JSONStructureUnits"],
                "type": "%s",
                "ucumUnit": "m"
            }
            """.formatted(typeName, typeName, typeName);

        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Test
    @DisplayName("Invalid non-numeric type with ucumUnit")
    void invalidNonNumericTypeWithUcumUnit() {
        String schema = """
            {
                "$schema": "https://json-structure.org/meta/extended/v0/#",
                "$id": "https://test.example.com/schema/ucum-string",
                "name": "TextWithUnit",
                "$uses": ["JSONStructureUnits"],
                "type": "string",
                "ucumUnit": "m"
            }
            """;

        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isFalse();
    }

    @Test
    @DisplayName("Invalid non-string ucumUnit values")
    void invalidNonStringUcumUnitValues() {
        String[] schemas = {
            """
                {
                    "$schema": "https://json-structure.org/meta/extended/v0/#",
                    "$id": "https://test.example.com/schema/ucum-number-value",
                    "name": "NumericUcumUnit",
                    "$uses": ["JSONStructureUnits"],
                    "type": "number",
                    "ucumUnit": 42
                }
                """,
            """
                {
                    "$schema": "https://json-structure.org/meta/extended/v0/#",
                    "$id": "https://test.example.com/schema/ucum-array-value",
                    "name": "ArrayUcumUnit",
                    "$uses": ["JSONStructureUnits"],
                    "type": "number",
                    "ucumUnit": ["m"]
                }
                """,
            """
                {
                    "$schema": "https://json-structure.org/meta/extended/v0/#",
                    "$id": "https://test.example.com/schema/ucum-object-value",
                    "name": "ObjectUcumUnit",
                    "$uses": ["JSONStructureUnits"],
                    "type": "number",
                    "ucumUnit": {"code": "m"}
                }
                """
        };

        for (String schema : schemas) {
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isFalse();
        }
    }

    @Test
    @DisplayName("Valid object identity array")
    void validObjectIdentityArray() {
        String schema = """
            {
                "$schema": "https://json-structure.org/meta/extended/v0/#",
                "$id": "https://test.example.com/schema/relations-identity",
                "name": "OrderIdentity",
                "$uses": ["JSONStructureRelations"],
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "tenantId": { "type": "string" }
                },
                "identity": ["id", "tenantId"]
            }
            """;

        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Test
    @DisplayName("Valid relations declarations")
    void validRelationsDeclarations() {
        String schema = """
            {
                "$schema": "https://json-structure.org/meta/extended/v0/#",
                "$id": "https://test.example.com/schema/relations-declarations",
                "name": "OrderRelations",
                "$uses": ["JSONStructureRelations"],
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "customerId": { "type": "string" }
                },
                "relations": {
                    "customer": {
                        "cardinality": "single",
                        "targettype": { "$ref": "#/definitions/Customer" }
                    }
                },
                "definitions": {
                    "Customer": {
                        "name": "Customer",
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" }
                        }
                    }
                }
            }
            """;

        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Test
    @DisplayName("Valid single cardinality relation with targettype ref")
    void validSingleCardinalityRelationWithTargettypeRef() {
        String schema = """
            {
                "$schema": "https://json-structure.org/meta/extended/v0/#",
                "$id": "https://test.example.com/schema/relations-single",
                "name": "OrderRelations",
                "$uses": ["JSONStructureRelations"],
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "customerId": { "type": "string" }
                },
                "relations": {
                    "customer": {
                        "cardinality": "single",
                        "targettype": { "$ref": "#/definitions/Customer" }
                    }
                },
                "definitions": {
                    "Customer": {
                        "name": "Customer",
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" }
                        }
                    }
                }
            }
            """;

        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid multiple cardinality relation with scope")
    void validMultipleCardinalityRelationWithScope() {
        String schema = """
            {
                "$schema": "https://json-structure.org/meta/extended/v0/#",
                "$id": "https://test.example.com/schema/relations-multiple",
                "name": "OrderRelations",
                "$uses": ["JSONStructureRelations"],
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "itemIds": { "type": "array", "items": { "type": "string" } }
                },
                "relations": {
                    "items": {
                        "cardinality": "multiple",
                        "targettype": { "$ref": "#/definitions/Item" },
                        "scope": "line-items"
                    }
                },
                "definitions": {
                    "Item": {
                        "name": "Item",
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" }
                        }
                    }
                }
            }
            """;

        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Valid relation with qualifiertype")
    void validRelationWithQualifierType() {
        String schema = """
            {
                "$schema": "https://json-structure.org/meta/extended/v0/#",
                "$id": "https://test.example.com/schema/relations-qualifier",
                "name": "OrderRelations",
                "$uses": ["JSONStructureRelations"],
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "qualifier": { "type": "string" }
                },
                "relations": {
                    "qualifiedCustomer": {
                        "cardinality": "single",
                        "targettype": { "$ref": "#/definitions/Customer" },
                        "qualifiertype": { "$ref": "#/definitions/RelationQualifier" }
                    }
                },
                "definitions": {
                    "Customer": {
                        "name": "Customer",
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" }
                        }
                    },
                    "RelationQualifier": {
                        "name": "RelationQualifier",
                        "type": "string"
                    }
                }
            }
            """;

        ValidationResult result = validator.validate(schema);
        assertThat(result.isValid()).isTrue();
    }

    @Test
    @DisplayName("Invalid Relations extension schemas")
    void invalidRelationsSchemas() {
        String[] schemas = {
            """
                {
                    "$schema": "https://json-structure.org/meta/extended/v0/#",
                    "$id": "https://test.example.com/schema/relations-identity-non-object",
                    "name": "IdentityOnString",
                    "$uses": ["JSONStructureRelations"],
                    "type": "string",
                    "identity": ["id"]
                }
                """,
            """
                {
                    "$schema": "https://json-structure.org/meta/extended/v0/#",
                    "$id": "https://test.example.com/schema/relations-invalid-cardinality",
                    "name": "InvalidCardinality",
                    "$uses": ["JSONStructureRelations"],
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    },
                    "relations": {
                        "customer": {
                            "cardinality": "many",
                            "targettype": { "$ref": "#/definitions/Customer" }
                        }
                    },
                    "definitions": {
                        "Customer": {
                            "name": "Customer",
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" }
                            }
                        }
                    }
                }
                """
        };

        for (String schema : schemas) {
            ValidationResult result = validator.validate(schema);
            assertThat(result.isValid()).isFalse();
        }
    }
}
