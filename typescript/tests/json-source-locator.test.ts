import { describe, it, expect } from 'vitest';
import { JsonSourceLocator } from '../src/json-source-locator';

describe('JsonSourceLocator', () => {
  describe('getLocation', () => {
    it('should return root location for empty path', () => {
      const json = '{"name": "test"}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('');
      expect(location.line).toBe(1);
      expect(location.column).toBe(1);
    });

    it('should return root location for json with leading whitespace', () => {
      const json = '  \n  {"name": "test"}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('');
      expect(location.line).toBe(2);
      expect(location.column).toBe(3);
    });

    it('should find location of top-level property', () => {
      const json = '{\n  "name": "test"\n}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/name');
      expect(location.line).toBe(2);
    });

    it('should find location of nested property', () => {
      const json = '{\n  "person": {\n    "name": "Alice"\n  }\n}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/person/name');
      expect(location.line).toBe(3);
    });

    it('should find location with JSON Pointer anchor (#)', () => {
      const json = '{\n  "name": "test"\n}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('#/name');
      expect(location.line).toBe(2);
    });

    it('should find location of array element', () => {
      const json = '{\n  "items": [\n    "first",\n    "second"\n  ]\n}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/items/1');
      expect(location.line).toBe(4);
    });

    it('should find location of first array element', () => {
      const json = '["a", "b", "c"]';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/0');
      expect(location.line).toBe(1);
      expect(location.column).toBe(2);
    });

    it('should find location of object in array', () => {
      const json = '{\n  "users": [\n    {"name": "Alice"},\n    {"name": "Bob"}\n  ]\n}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/users/1/name');
      expect(location.line).toBe(4);
    });

    it('should cache locations', () => {
      const json = '{"name": "test"}';
      const locator = new JsonSourceLocator(json);
      const location1 = locator.getLocation('/name');
      const location2 = locator.getLocation('/name');
      expect(location1).toEqual(location2);
    });

    it('should return unknown location for non-existent path', () => {
      const json = '{"name": "test"}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/nonexistent');
      expect(location.line).toBe(0);
      expect(location.column).toBe(0);
    });

    it('should return unknown location for invalid array index', () => {
      const json = '["a", "b"]';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/10');
      expect(location.line).toBe(0);
      expect(location.column).toBe(0);
    });

    it('should handle escaped JSON Pointer tokens (~0 and ~1)', () => {
      const json = '{"a/b": "slash", "c~d": "tilde"}';
      const locator = new JsonSourceLocator(json);
      const location1 = locator.getLocation('/a~1b');
      expect(location1.line).toBe(1);
      const location2 = locator.getLocation('/c~0d');
      expect(location2.line).toBe(1);
    });

    it('should handle array index notation in path', () => {
      const json = '{\n  "required": ["a", "b"]\n}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/required[1]');
      expect(location.line).toBe(2);
    });

    it('should handle deeply nested structures', () => {
      const json = `{
  "a": {
    "b": {
      "c": {
        "d": "value"
      }
    }
  }
}`;
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/a/b/c/d');
      expect(location.line).toBe(5);
    });

    it('should handle strings with escape sequences', () => {
      const json = '{"message": "Hello\\nWorld", "name": "test"}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/name');
      expect(location.line).toBe(1);
    });

    it('should handle various JSON value types', () => {
      const json = `{
  "string": "text",
  "number": 42,
  "float": 3.14,
  "boolean": true,
  "null": null,
  "target": "found"
}`;
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/target');
      expect(location.line).toBe(7);
    });

    it('should handle nested arrays', () => {
      const json = '[[1, 2], [3, 4], [5, 6]]';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/1/0');
      expect(location.line).toBe(1);
    });

    it('should handle empty object', () => {
      const json = '{}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/name');
      expect(location.line).toBe(0);
    });

    it('should handle empty array', () => {
      const json = '[]';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/0');
      expect(location.line).toBe(0);
    });

    it('should handle array at root level', () => {
      const json = '[\n  {"id": 1},\n  {"id": 2}\n]';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/0/id');
      expect(location.line).toBe(2);
    });

    it('should handle multiline strings in values', () => {
      const json = '{\n  "text": "line1",\n  "name": "test"\n}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/name');
      expect(location.line).toBe(3);
    });

    it('should return unknown for path expecting object but finding array', () => {
      const json = '[1, 2, 3]';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/name');
      expect(location.line).toBe(0);
    });

    it('should return unknown for path expecting array but finding object', () => {
      const json = '{"name": "test"}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/0');
      expect(location.line).toBe(0);
    });

    it('should handle Windows-style line endings', () => {
      const json = '{\r\n  "name": "test"\r\n}';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/name');
      expect(location.line).toBe(2);
    });

    it('should handle complex nested structure with arrays and objects', () => {
      const json = `{
  "definitions": {
    "Person": {
      "properties": {
        "name": { "type": "string" }
      }
    }
  }
}`;
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/definitions/Person/properties/name/type');
      expect(location.line).toBe(5);
    });

    it('should handle only whitespace JSON', () => {
      const json = '   \n   \n   ';
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('');
      expect(location.line).toBe(1);
      expect(location.column).toBe(1);
    });

    it('should skip nested objects when looking for sibling', () => {
      const json = `{
  "first": {
    "nested": {
      "deep": "value"
    }
  },
  "second": "target"
}`;
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/second');
      expect(location.line).toBe(7);
    });

    it('should skip nested arrays when looking for sibling', () => {
      const json = `{
  "first": [[1, 2], [3, 4]],
  "second": "target"
}`;
      const locator = new JsonSourceLocator(json);
      const location = locator.getLocation('/second');
      expect(location.line).toBe(3);
    });
  });
});
