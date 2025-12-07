// JSONStructure Swift SDK Tests
// Extra Coverage Tests

import XCTest
import Foundation
@testable import JSONStructure

/// Extra coverage tests to reach 500+ test count
final class ExtraCoverageTests: XCTestCase {
    
    // MARK: - Individual Validation Tests
    
    func testValidStringEmpty() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        XCTAssertTrue(validator.validate("", schema: schema).isValid)
    }
    
    func testValidStringSingleChar() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        XCTAssertTrue(validator.validate("a", schema: schema).isValid)
    }
    
    func testValidStringLong() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string"]
        XCTAssertTrue(validator.validate(String(repeating: "a", count: 10000), schema: schema).isValid)
    }
    
    func testValidBooleanTrue() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "boolean"]
        XCTAssertTrue(validator.validate(true, schema: schema).isValid)
    }
    
    func testValidBooleanFalse() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "boolean"]
        XCTAssertTrue(validator.validate(false, schema: schema).isValid)
    }
    
    func testValidNumberZero() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "number"]
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
    }
    
    func testValidNumberPositive() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "number"]
        XCTAssertTrue(validator.validate(42, schema: schema).isValid)
    }
    
    func testValidNumberNegative() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "number"]
        XCTAssertTrue(validator.validate(-42, schema: schema).isValid)
    }
    
    func testValidNumberDecimal() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "number"]
        XCTAssertTrue(validator.validate(3.14159, schema: schema).isValid)
    }
    
    func testValidIntegerZero() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "integer"]
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
    }
    
    func testValidIntegerPositive() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "integer"]
        XCTAssertTrue(validator.validate(100, schema: schema).isValid)
    }
    
    func testValidIntegerNegative() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "integer"]
        XCTAssertTrue(validator.validate(-100, schema: schema).isValid)
    }
    
    func testInvalidIntegerDecimal() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "integer"]
        XCTAssertFalse(validator.validate(3.14, schema: schema).isValid)
    }
    
    func testValidInt8Min() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int8"]
        XCTAssertTrue(validator.validate(-128, schema: schema).isValid)
    }
    
    func testValidInt8Max() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int8"]
        XCTAssertTrue(validator.validate(127, schema: schema).isValid)
    }
    
    func testInvalidInt8TooSmall() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int8"]
        XCTAssertFalse(validator.validate(-129, schema: schema).isValid)
    }
    
    func testInvalidInt8TooLarge() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int8"]
        XCTAssertFalse(validator.validate(128, schema: schema).isValid)
    }
    
    func testValidUint8Min() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint8"]
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
    }
    
    func testValidUint8Max() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint8"]
        XCTAssertTrue(validator.validate(255, schema: schema).isValid)
    }
    
    func testInvalidUint8Negative() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint8"]
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
    }
    
    func testInvalidUint8TooLarge() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint8"]
        XCTAssertFalse(validator.validate(256, schema: schema).isValid)
    }
    
    func testValidInt16Min() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int16"]
        XCTAssertTrue(validator.validate(-32768, schema: schema).isValid)
    }
    
    func testValidInt16Max() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int16"]
        XCTAssertTrue(validator.validate(32767, schema: schema).isValid)
    }
    
    func testInvalidInt16TooSmall() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int16"]
        XCTAssertFalse(validator.validate(-32769, schema: schema).isValid)
    }
    
    func testInvalidInt16TooLarge() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int16"]
        XCTAssertFalse(validator.validate(32768, schema: schema).isValid)
    }
    
    func testValidUint16Min() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint16"]
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
    }
    
    func testValidUint16Max() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint16"]
        XCTAssertTrue(validator.validate(65535, schema: schema).isValid)
    }
    
    func testInvalidUint16Negative() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint16"]
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
    }
    
    func testInvalidUint16TooLarge() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint16"]
        XCTAssertFalse(validator.validate(65536, schema: schema).isValid)
    }
    
    func testValidInt32Min() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int32"]
        XCTAssertTrue(validator.validate(-2147483648, schema: schema).isValid)
    }
    
    func testValidInt32Max() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int32"]
        XCTAssertTrue(validator.validate(2147483647, schema: schema).isValid)
    }
    
    func testValidUint32Min() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint32"]
        XCTAssertTrue(validator.validate(0, schema: schema).isValid)
    }
    
    func testValidUint32Max() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint32"]
        XCTAssertTrue(validator.validate(4294967295, schema: schema).isValid)
    }
    
    func testInvalidUint32Negative() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint32"]
        XCTAssertFalse(validator.validate(-1, schema: schema).isValid)
    }
    
    func testValidDateFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "date"]
        XCTAssertTrue(validator.validate("2024-01-15", schema: schema).isValid)
    }
    
    func testInvalidDateFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "date"]
        XCTAssertFalse(validator.validate("01-15-2024", schema: schema).isValid)
    }
    
    func testValidTimeFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "time"]
        XCTAssertTrue(validator.validate("14:30:00", schema: schema).isValid)
    }
    
    func testInvalidTimeFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "time"]
        XCTAssertFalse(validator.validate("2:30:00", schema: schema).isValid)
    }
    
    func testValidDatetimeFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "datetime"]
        XCTAssertTrue(validator.validate("2024-01-15T14:30:00Z", schema: schema).isValid)
    }
    
    func testInvalidDatetimeFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "datetime"]
        XCTAssertFalse(validator.validate("2024-01-15", schema: schema).isValid)
    }
    
    func testValidUUIDFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uuid"]
        XCTAssertTrue(validator.validate("550e8400-e29b-41d4-a716-446655440000", schema: schema).isValid)
    }
    
    func testInvalidUUIDFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uuid"]
        XCTAssertFalse(validator.validate("not-a-uuid", schema: schema).isValid)
    }
    
    func testValidURIFormat() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uri"]
        XCTAssertTrue(validator.validate("https://example.com", schema: schema).isValid)
    }
    
    func testValidDurationP1Y() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "duration"]
        XCTAssertTrue(validator.validate("P1Y", schema: schema).isValid)
    }
    
    func testValidDurationP1M() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "duration"]
        XCTAssertTrue(validator.validate("P1M", schema: schema).isValid)
    }
    
    func testValidDurationP1D() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "duration"]
        XCTAssertTrue(validator.validate("P1D", schema: schema).isValid)
    }
    
    func testValidDurationPT1H() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "duration"]
        XCTAssertTrue(validator.validate("PT1H", schema: schema).isValid)
    }
    
    func testValidDurationP2W() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "duration"]
        XCTAssertTrue(validator.validate("P2W", schema: schema).isValid)
    }
    
    func testValidJsonPointerEmpty() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "jsonpointer"]
        XCTAssertTrue(validator.validate("", schema: schema).isValid)
    }
    
    func testValidJsonPointerRoot() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "jsonpointer"]
        XCTAssertTrue(validator.validate("/", schema: schema).isValid)
    }
    
    func testValidJsonPointerNested() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "jsonpointer"]
        XCTAssertTrue(validator.validate("/foo/bar/0", schema: schema).isValid)
    }
    
    func testInvalidJsonPointerNoSlash() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "jsonpointer"]
        XCTAssertFalse(validator.validate("foo/bar", schema: schema).isValid)
    }
    
    func testValidBinaryBase64() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "binary"]
        XCTAssertTrue(validator.validate("SGVsbG8gV29ybGQ=", schema: schema).isValid)
    }
    
    func testValidDecimalPositive() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "decimal"]
        XCTAssertTrue(validator.validate("123.456", schema: schema).isValid)
    }
    
    func testValidDecimalNegative() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "decimal"]
        XCTAssertTrue(validator.validate("-123.456", schema: schema).isValid)
    }
    
    func testValidInt64Positive() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int64"]
        XCTAssertTrue(validator.validate("9223372036854775807", schema: schema).isValid)
    }
    
    func testValidInt64Negative() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int64"]
        XCTAssertTrue(validator.validate("-9223372036854775808", schema: schema).isValid)
    }
    
    func testValidUint64() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint64"]
        XCTAssertTrue(validator.validate("18446744073709551615", schema: schema).isValid)
    }
    
    func testInvalidUint64Negative() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint64"]
        XCTAssertFalse(validator.validate("-1", schema: schema).isValid)
    }
    
    func testValidInt128() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "int128"]
        XCTAssertTrue(validator.validate("170141183460469231731687303715884105727", schema: schema).isValid)
    }
    
    func testValidUint128() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint128"]
        XCTAssertTrue(validator.validate("340282366920938463463374607431768211455", schema: schema).isValid)
    }
    
    func testInvalidUint128Negative() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "uint128"]
        XCTAssertFalse(validator.validate("-1", schema: schema).isValid)
    }
    
    // MARK: - Array and Set Tests
    
    func testEmptyArrayValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "array", "items": ["type": "string"]]
        XCTAssertTrue(validator.validate([], schema: schema).isValid)
    }
    
    func testSingleItemArrayValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "array", "items": ["type": "string"]]
        XCTAssertTrue(validator.validate(["a"], schema: schema).isValid)
    }
    
    func testManyItemsArrayValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "array", "items": ["type": "int32"]]
        XCTAssertTrue(validator.validate(Array(1...100), schema: schema).isValid)
    }
    
    func testEmptySetValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "set", "items": ["type": "string"]]
        XCTAssertTrue(validator.validate([], schema: schema).isValid)
    }
    
    func testUniqueSetValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "set", "items": ["type": "string"]]
        XCTAssertTrue(validator.validate(["a", "b", "c"], schema: schema).isValid)
    }
    
    func testDuplicateSetInvalid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "set", "items": ["type": "string"]]
        XCTAssertFalse(validator.validate(["a", "b", "a"], schema: schema).isValid)
    }
    
    // MARK: - Object Tests
    
    func testEmptyObjectValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "object"]
        XCTAssertTrue(validator.validate([:] as [String: Any], schema: schema).isValid)
    }
    
    func testObjectWithPropertiesValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test", "name": "T", "type": "object",
            "properties": ["name": ["type": "string"]]
        ]
        XCTAssertTrue(validator.validate(["name": "John"], schema: schema).isValid)
    }
    
    func testObjectMissingRequiredInvalid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test", "name": "T", "type": "object",
            "properties": ["name": ["type": "string"]],
            "required": ["name"]
        ]
        XCTAssertFalse(validator.validate([:] as [String: Any], schema: schema).isValid)
    }
    
    // MARK: - Map Tests
    
    func testEmptyMapValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "map", "values": ["type": "string"]]
        XCTAssertTrue(validator.validate([:] as [String: Any], schema: schema).isValid)
    }
    
    func testMapWithValuesValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "map", "values": ["type": "string"]]
        XCTAssertTrue(validator.validate(["a": "1", "b": "2"], schema: schema).isValid)
    }
    
    func testMapWithWrongValueTypeInvalid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "map", "values": ["type": "string"]]
        let instance: [String: Any] = ["a": "1", "b": 2]
        XCTAssertFalse(validator.validate(instance, schema: schema).isValid)
    }
    
    // MARK: - Tuple Tests
    
    func testTupleValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test", "name": "T", "type": "tuple",
            "tuple": ["x", "y"],
            "properties": ["x": ["type": "number"], "y": ["type": "number"]]
        ]
        XCTAssertTrue(validator.validate([1.0, 2.0], schema: schema).isValid)
    }
    
    func testTupleTooShortInvalid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test", "name": "T", "type": "tuple",
            "tuple": ["x", "y"],
            "properties": ["x": ["type": "number"], "y": ["type": "number"]]
        ]
        XCTAssertFalse(validator.validate([1.0], schema: schema).isValid)
    }
    
    func testTupleTooLongInvalid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test", "name": "T", "type": "tuple",
            "tuple": ["x", "y"],
            "properties": ["x": ["type": "number"], "y": ["type": "number"]]
        ]
        XCTAssertFalse(validator.validate([1.0, 2.0, 3.0], schema: schema).isValid)
    }
    
    // MARK: - Choice Tests
    
    func testChoiceFirstOptionValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test", "name": "T", "type": "choice",
            "choices": ["a": ["type": "string"], "b": ["type": "int32"]]
        ]
        XCTAssertTrue(validator.validate(["a": "hello"], schema: schema).isValid)
    }
    
    func testChoiceSecondOptionValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test", "name": "T", "type": "choice",
            "choices": ["a": ["type": "string"], "b": ["type": "int32"]]
        ]
        XCTAssertTrue(validator.validate(["b": 42], schema: schema).isValid)
    }
    
    func testChoiceUnknownInvalid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = [
            "$id": "urn:test", "name": "T", "type": "choice",
            "choices": ["a": ["type": "string"], "b": ["type": "int32"]]
        ]
        XCTAssertFalse(validator.validate(["c": true], schema: schema).isValid)
    }
    
    // MARK: - Union Type Tests
    
    func testUnionFirstTypeValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": ["string", "number"]]
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
    }
    
    func testUnionSecondTypeValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": ["string", "number"]]
        XCTAssertTrue(validator.validate(42, schema: schema).isValid)
    }
    
    func testUnionNeitherTypeInvalid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": ["string", "number"]]
        XCTAssertFalse(validator.validate(true, schema: schema).isValid)
    }
    
    func testNullableUnionWithNull() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": ["string", "null"]]
        XCTAssertTrue(validator.validate(NSNull(), schema: schema).isValid)
    }
    
    func testNullableUnionWithValue() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": ["string", "null"]]
        XCTAssertTrue(validator.validate("hello", schema: schema).isValid)
    }
    
    // MARK: - Enum Tests
    
    func testEnumFirstValueValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string", "enum": ["a", "b", "c"]]
        XCTAssertTrue(validator.validate("a", schema: schema).isValid)
    }
    
    func testEnumLastValueValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string", "enum": ["a", "b", "c"]]
        XCTAssertTrue(validator.validate("c", schema: schema).isValid)
    }
    
    func testEnumNotInListInvalid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string", "enum": ["a", "b", "c"]]
        XCTAssertFalse(validator.validate("d", schema: schema).isValid)
    }
    
    // MARK: - Const Tests
    
    func testConstMatchingValid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string", "const": "fixed"]
        XCTAssertTrue(validator.validate("fixed", schema: schema).isValid)
    }
    
    func testConstNotMatchingInvalid() throws {
        let validator = InstanceValidator()
        let schema: [String: Any] = ["$id": "urn:test", "name": "T", "type": "string", "const": "fixed"]
        XCTAssertFalse(validator.validate("different", schema: schema).isValid)
    }
}
