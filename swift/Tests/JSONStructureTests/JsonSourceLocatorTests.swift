// JSONStructure Swift SDK Tests
// JSON Source Locator Tests

import XCTest
import Foundation
@testable import JSONStructure

/// Tests for JsonSourceLocator
final class JsonSourceLocatorTests: XCTestCase {
    
    // MARK: - Basic Parsing Tests
    
    func testEmptyJSON() throws {
        let json = "{}"
        let locator = JsonSourceLocator(json)
        
        let location = locator.getLocation("#")
        XCTAssertNotNil(location)
    }
    
    func testSimpleObject() throws {
        let json = """
        {
            "name": "John",
            "age": 30
        }
        """
        
        let locator = JsonSourceLocator(json)
        
        // Test locations
        let location = locator.getLocation("#/name")
        XCTAssertGreaterThan(location.line, 0)
    }
    
    func testNestedObject() throws {
        let json = """
        {
            "person": {
                "name": "John",
                "address": {
                    "city": "NYC"
                }
            }
        }
        """
        
        let locator = JsonSourceLocator(json)
        
        // Test nested locations
        let location = locator.getLocation("#/person/address/city")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    func testArrayElements() throws {
        let json = """
        {
            "items": [
                "first",
                "second",
                "third"
            ]
        }
        """
        
        let locator = JsonSourceLocator(json)
        
        // Test array element locations
        let location0 = locator.getLocation("#/items/0")
        XCTAssertGreaterThanOrEqual(location0.line, 1)
        
        let location1 = locator.getLocation("#/items/1")
        XCTAssertGreaterThanOrEqual(location1.line, 1)
    }
    
    func testArrayOfObjects() throws {
        let json = """
        {
            "people": [
                {"name": "John", "age": 30},
                {"name": "Jane", "age": 25}
            ]
        }
        """
        
        let locator = JsonSourceLocator(json)
        
        let location = locator.getLocation("#/people/0/name")
        XCTAssertGreaterThanOrEqual(location.line, 1)
        
        let location2 = locator.getLocation("#/people/1/age")
        XCTAssertGreaterThanOrEqual(location2.line, 1)
    }
    
    // MARK: - Value Type Tests
    
    func testStringValues() throws {
        let json = """
        {
            "simple": "hello",
            "empty": "",
            "unicode": "こんにちは",
            "escaped": "line1\\nline2"
        }
        """
        
        let locator = JsonSourceLocator(json)
        let location = locator.getLocation("#/simple")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    func testNumericValues() throws {
        let json = """
        {
            "integer": 42,
            "negative": -17,
            "float": 3.14,
            "scientific": 1.23e10,
            "negexp": 1.23e-5
        }
        """
        
        let locator = JsonSourceLocator(json)
        let location = locator.getLocation("#/integer")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    func testBooleanAndNull() throws {
        let json = """
        {
            "trueVal": true,
            "falseVal": false,
            "nullVal": null
        }
        """
        
        let locator = JsonSourceLocator(json)
        let location = locator.getLocation("#/trueVal")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    // MARK: - Complex Structures
    
    func testDeeplyNested() throws {
        let json = """
        {
            "level1": {
                "level2": {
                    "level3": {
                        "level4": {
                            "level5": {
                                "value": "deep"
                            }
                        }
                    }
                }
            }
        }
        """
        
        let locator = JsonSourceLocator(json)
        
        let location = locator.getLocation("#/level1/level2/level3/level4/level5/value")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    func testMixedArrayAndObject() throws {
        let json = """
        {
            "data": [
                {"type": "A", "values": [1, 2, 3]},
                {"type": "B", "values": [4, 5, 6]}
            ]
        }
        """
        
        let locator = JsonSourceLocator(json)
        
        let location = locator.getLocation("#/data/0/values/1")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    // MARK: - Edge Cases
    
    func testEmptyArray() throws {
        let json = """
        {
            "empty": []
        }
        """
        
        let locator = JsonSourceLocator(json)
        let location = locator.getLocation("#/empty")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    func testEmptyObject() throws {
        let json = """
        {
            "empty": {}
        }
        """
        
        let locator = JsonSourceLocator(json)
        let location = locator.getLocation("#/empty")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    func testSingleLineJSON() throws {
        let json = """
        {"name":"John","age":30,"active":true}
        """
        
        let locator = JsonSourceLocator(json)
        
        let location = locator.getLocation("#/name")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    func testWhitespaceVariations() throws {
        let json = """
        {
            "a" :  "value1"  ,
            "b":      "value2",
            "c"    :"value3"
        }
        """
        
        let locator = JsonSourceLocator(json)
        let location = locator.getLocation("#/a")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    func testSpecialCharactersInKeys() throws {
        let json = """
        {
            "key with spaces": "value1",
            "key-with-dashes": "value2",
            "key.with.dots": "value3"
        }
        """
        
        let locator = JsonSourceLocator(json)
        let location = locator.getLocation("#")
        XCTAssertGreaterThanOrEqual(location.line, 1)
    }
    
    // MARK: - Root Path Tests
    
    func testRootPath() throws {
        let json = """
        {
            "name": "test"
        }
        """
        
        let locator = JsonSourceLocator(json)
        
        let location = locator.getLocation("#")
        XCTAssertEqual(location.line, 1)
        XCTAssertEqual(location.column, 1)
    }
    
    // MARK: - Multi-Line Values
    
    func testMultipleProperties() throws {
        let json = """
        {
            "prop1": "value1",
            "prop2": "value2",
            "prop3": "value3",
            "prop4": "value4",
            "prop5": "value5"
        }
        """
        
        let locator = JsonSourceLocator(json)
        
        let loc1 = locator.getLocation("#/prop1")
        let loc3 = locator.getLocation("#/prop3")
        let loc5 = locator.getLocation("#/prop5")
        
        XCTAssertGreaterThan(loc1.line, 0)
        XCTAssertGreaterThan(loc3.line, 0)
        XCTAssertGreaterThan(loc5.line, 0)
    }
    
    // MARK: - Schema-like Structures
    
    func testSchemaStructure() throws {
        let json = """
        {
            "$id": "urn:example:schema",
            "name": "Person",
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "minLength": 1
                },
                "age": {
                    "type": "int32"
                }
            },
            "required": ["name"]
        }
        """
        
        let locator = JsonSourceLocator(json)
        
        let propLoc = locator.getLocation("#/properties")
        XCTAssertGreaterThan(propLoc.line, 0)
        
        let nameLoc = locator.getLocation("#/properties/name")
        XCTAssertGreaterThan(nameLoc.line, 0)
    }
    
    // MARK: - JsonLocation Tests
    
    func testJsonLocationEquality() throws {
        let loc1 = JsonLocation(line: 10, column: 5)
        let loc2 = JsonLocation(line: 10, column: 5)
        let loc3 = JsonLocation(line: 10, column: 6)
        
        XCTAssertEqual(loc1.line, loc2.line)
        XCTAssertEqual(loc1.column, loc2.column)
        XCTAssertNotEqual(loc1.column, loc3.column)
    }
    
    func testUnknownLocation() throws {
        let unknown = JsonLocation.unknown()
        XCTAssertEqual(unknown.line, 0)
        XCTAssertEqual(unknown.column, 0)
    }
}
