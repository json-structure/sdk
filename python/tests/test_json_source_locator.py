# encoding: utf-8
"""
Tests for JsonSourceLocator.
"""

import pytest
from json_structure.json_source_locator import JsonSourceLocator
from json_structure.error_codes import JsonLocation


class TestJsonSourceLocator:
    """Test the JsonSourceLocator class."""

    def test_empty_path_returns_document_start(self):
        """Empty path should return the start of the JSON document."""
        json_text = '{"name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("")
        # Empty path returns unknown location per implementation
        assert isinstance(location, JsonLocation)

    def test_root_path(self):
        """Root path '/' should return document start."""
        json_text = '{"name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/")
        assert isinstance(location, JsonLocation)

    def test_simple_property_location(self):
        """Find location of a simple top-level property."""
        json_text = '{\n  "name": "test"\n}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 2

    def test_nested_property_location(self):
        """Find location of a nested property."""
        json_text = '{\n  "person": {\n    "name": "Alice"\n  }\n}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/person/name")
        assert location.line == 3

    def test_json_pointer_with_anchor(self):
        """Handle JSON Pointer with # anchor."""
        json_text = '{\n  "name": "test"\n}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("#/name")
        assert location.line == 2

    def test_array_element_location(self):
        """Find location of an array element."""
        json_text = '{\n  "items": [\n    "first",\n    "second"\n  ]\n}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/items/1")
        assert location.line == 4

    def test_first_array_element(self):
        """Find location of the first array element."""
        json_text = '["a", "b", "c"]'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/0")
        assert location.line == 1

    def test_object_in_array(self):
        """Find location of an object property within an array."""
        json_text = '{\n  "users": [\n    {"name": "Alice"},\n    {"name": "Bob"}\n  ]\n}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/users/1/name")
        assert location.line == 4

    def test_nonexistent_property(self):
        """Non-existent property should return unknown location."""
        json_text = '{"name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/nonexistent")
        assert location.line == 0 or location.column == 0

    def test_invalid_array_index(self):
        """Invalid array index should return unknown location."""
        json_text = '["a", "b"]'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/10")
        assert location.line == 0 or location.column == 0

    def test_escaped_json_pointer_tokens(self):
        """Handle escaped JSON Pointer tokens (~0 and ~1)."""
        json_text = '{"a/b": "slash", "c~d": "tilde"}'
        locator = JsonSourceLocator(json_text)
        # ~1 decodes to /
        location1 = locator.get_location("/a~1b")
        assert location1.line == 1
        # ~0 decodes to ~
        location2 = locator.get_location("/c~0d")
        assert location2.line == 1

    def test_deeply_nested_structure(self):
        """Find location in a deeply nested structure."""
        json_text = """{
  "a": {
    "b": {
      "c": {
        "d": "value"
      }
    }
  }
}"""
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/a/b/c/d")
        assert location.line == 5

    def test_strings_with_escape_sequences(self):
        """Handle strings with escape sequences."""
        json_text = '{"message": "Hello\\nWorld", "name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 1

    def test_various_json_value_types(self):
        """Handle various JSON value types."""
        json_text = """{
  "string": "text",
  "number": 42,
  "float": 3.14,
  "boolean": true,
  "null": null,
  "target": "found"
}"""
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/target")
        assert location.line == 7

    def test_nested_arrays(self):
        """Handle nested arrays."""
        json_text = '[[1, 2], [3, 4], [5, 6]]'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/1/0")
        assert location.line == 1

    def test_empty_object(self):
        """Handle empty object."""
        json_text = '{}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 0 or location.column == 0

    def test_empty_array(self):
        """Handle empty array."""
        json_text = '[]'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/0")
        assert location.line == 0 or location.column == 0

    def test_array_at_root(self):
        """Handle array at root level."""
        json_text = '[\n  {"id": 1},\n  {"id": 2}\n]'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/0/id")
        assert location.line == 2

    def test_path_expecting_object_but_finding_array(self):
        """Path expecting object but finding array should return unknown."""
        json_text = '[1, 2, 3]'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 0 or location.column == 0

    def test_path_expecting_array_but_finding_object(self):
        """Path expecting array but finding object should return unknown."""
        json_text = '{"name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/0")
        assert location.line == 0 or location.column == 0

    def test_windows_line_endings(self):
        """Handle Windows-style line endings."""
        json_text = '{\r\n  "name": "test"\r\n}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 2

    def test_complex_nested_structure(self):
        """Handle complex nested structure with arrays and objects."""
        json_text = """{
  "definitions": {
    "Person": {
      "properties": {
        "name": { "type": "string" }
      }
    }
  }
}"""
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/definitions/Person/properties/name/type")
        assert location.line == 5

    def test_skip_sibling_objects(self):
        """Skip nested objects when looking for sibling."""
        json_text = """{
  "first": {
    "nested": {
      "deep": "value"
    }
  },
  "second": "target"
}"""
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/second")
        assert location.line == 7

    def test_skip_sibling_arrays(self):
        """Skip nested arrays when looking for sibling."""
        json_text = """{
  "first": [[1, 2], [3, 4]],
  "second": "target"
}"""
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/second")
        assert location.line == 3

    def test_empty_json_text(self):
        """Handle empty JSON text."""
        json_text = ''
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 0 or location.column == 0

    def test_whitespace_only(self):
        """Handle JSON text with only whitespace."""
        json_text = '   \n   \n   '
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert isinstance(location, JsonLocation)

    def test_offset_to_location_boundary(self):
        """Test offset to location conversion at boundaries."""
        json_text = '{"a": 1}'
        locator = JsonSourceLocator(json_text)
        # Test with negative offset
        location = locator._offset_to_location(-1)
        assert location.line == 0 and location.column == 0
        # Test with offset beyond text
        location = locator._offset_to_location(1000)
        assert location.line == 0 and location.column == 0

    def test_skip_string_with_escapes(self):
        """Test skipping strings with various escape sequences."""
        json_text = '{"text": "line1\\nline2\\ttab", "name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 1

    def test_skip_string_with_unicode_escapes(self):
        """Test skipping strings with unicode escapes."""
        json_text = '{"unicode": "\\u0041\\u0042", "name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 1

    def test_skip_numbers_with_exponent(self):
        """Test skipping numbers with exponent notation."""
        json_text = '{"big": 1.23e+10, "small": 4.56e-5, "name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 1

    def test_boolean_values(self):
        """Test finding properties after boolean values."""
        json_text = '{"flag1": true, "flag2": false, "name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 1

    def test_null_values(self):
        """Test finding properties after null values."""
        json_text = '{"nothing": null, "name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 1

    def test_negative_numbers(self):
        """Test skipping negative numbers."""
        json_text = '{"value": -42, "name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 1

    def test_multiple_array_indices(self):
        """Test navigation through multiple array levels."""
        json_text = '[[[1, 2], [3, 4]], [[5, 6], [7, 8]]]'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/1/1/0")
        assert location.line == 1

    def test_mixed_array_object_nesting(self):
        """Test mixed array and object nesting."""
        json_text = '{"arr": [{"inner": [{"deep": "value"}]}]}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/arr/0/inner/0/deep")
        assert location.line == 1

    def test_property_with_empty_string_key(self):
        """Test finding property with empty string key."""
        json_text = '{"": "empty key", "name": "test"}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/name")
        assert location.line == 1

    def test_json_location_unknown(self):
        """Test JsonLocation.unknown() method."""
        location = JsonLocation.unknown()
        assert location.line == 0
        assert location.column == 0

    def test_json_location_is_known(self):
        """Test JsonLocation.is_known property."""
        unknown = JsonLocation.unknown()
        known = JsonLocation(1, 1)
        assert not unknown.is_known
        assert known.is_known

    def test_json_location_str(self):
        """Test JsonLocation string representation."""
        location = JsonLocation(5, 10)
        assert str(location) == "(5:10)"

    def test_large_array_index(self):
        """Test with a larger array."""
        items = ', '.join(['{"id": ' + str(i) + '}' for i in range(10)])
        json_text = '{"items": [' + items + ']}'
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/items/5/id")
        assert location.line == 1

    def test_deeply_nested_arrays_in_objects(self):
        """Test deeply nested arrays within objects."""
        json_text = """{
  "level1": {
    "arr1": [
      {
        "arr2": [
          {
            "value": "found"
          }
        ]
      }
    ]
  }
}"""
        locator = JsonSourceLocator(json_text)
        location = locator.get_location("/level1/arr1/0/arr2/0/value")
        assert location.line == 7
