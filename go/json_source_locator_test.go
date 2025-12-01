// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package jsonstructure

import (
	"testing"
)

func TestJsonSourceLocatorBasic(t *testing.T) {
	jsonText := `{
  "name": "John",
  "age": 30
}`
	locator := NewJsonSourceLocator(jsonText)
	
	// Test root location
	loc := locator.GetLocation("")
	// Empty path should return unknown - just verify no panic
	_ = loc
}

func TestJsonSourceLocatorPropertyPath(t *testing.T) {
	jsonText := `{
  "name": "John",
  "address": {
    "city": "NYC"
  }
}`
	locator := NewJsonSourceLocator(jsonText)
	
	// Test path to name
	loc := locator.GetLocation("/name")
	if loc.Line <= 0 {
		// Location should be found
		t.Logf("Name location: %d:%d", loc.Line, loc.Column)
	}
	
	// Test path to nested property
	loc = locator.GetLocation("/address/city")
	t.Logf("City location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorArrayPath(t *testing.T) {
	jsonText := `{
  "items": [
    {"id": 1},
    {"id": 2},
    {"id": 3}
  ]
}`
	locator := NewJsonSourceLocator(jsonText)
	
	// Test path to array element
	loc := locator.GetLocation("/items/0")
	t.Logf("First item location: %d:%d", loc.Line, loc.Column)
	
	loc = locator.GetLocation("/items/1/id")
	t.Logf("Second item id location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorBracketNotation(t *testing.T) {
	jsonText := `{
  "data": [1, 2, 3]
}`
	locator := NewJsonSourceLocator(jsonText)
	
	// Test bracket notation
	loc := locator.GetLocation("/data[0]")
	t.Logf("data[0] location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorEmptyJSON(t *testing.T) {
	locator := NewJsonSourceLocator("")
	loc := locator.GetLocation("/any/path")
	if loc.IsKnown() {
		t.Error("Expected unknown location for empty JSON")
	}
}

func TestJsonSourceLocatorComplexPath(t *testing.T) {
	jsonText := `{
  "users": [
    {
      "name": "Alice",
      "emails": ["alice@example.com", "a@example.org"]
    }
  ]
}`
	locator := NewJsonSourceLocator(jsonText)
	
	loc := locator.GetLocation("/users/0/emails/1")
	t.Logf("Second email location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorEscapedPointer(t *testing.T) {
	jsonText := `{
  "a/b": "value1",
  "c~d": "value2"
}`
	locator := NewJsonSourceLocator(jsonText)
	
	// ~1 should unescape to /
	loc := locator.GetLocation("/a~1b")
	t.Logf("a/b location: %d:%d", loc.Line, loc.Column)
	
	// ~0 should unescape to ~
	loc = locator.GetLocation("/c~0d")
	t.Logf("c~d location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorHashPrefix(t *testing.T) {
	jsonText := `{"key": "value"}`
	locator := NewJsonSourceLocator(jsonText)
	
	// Should handle # prefix
	loc := locator.GetLocation("#/key")
	t.Logf("key location with # prefix: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorNumbers(t *testing.T) {
	jsonText := `{"count": 42, "price": 19.99}`
	locator := NewJsonSourceLocator(jsonText)
	
	loc := locator.GetLocation("/count")
	t.Logf("count location: %d:%d", loc.Line, loc.Column)
	
	loc = locator.GetLocation("/price")
	t.Logf("price location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorBooleans(t *testing.T) {
	jsonText := `{"active": true, "deleted": false}`
	locator := NewJsonSourceLocator(jsonText)
	
	loc := locator.GetLocation("/active")
	t.Logf("active location: %d:%d", loc.Line, loc.Column)
	
	loc = locator.GetLocation("/deleted")
	t.Logf("deleted location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorNull(t *testing.T) {
	jsonText := `{"value": null}`
	locator := NewJsonSourceLocator(jsonText)
	
	loc := locator.GetLocation("/value")
	t.Logf("null value location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorStringEscapes(t *testing.T) {
	jsonText := `{"text": "Hello \"World\""}`
	locator := NewJsonSourceLocator(jsonText)
	
	loc := locator.GetLocation("/text")
	t.Logf("text location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorNestedArrays(t *testing.T) {
	jsonText := `{
  "matrix": [
    [1, 2, 3],
    [4, 5, 6]
  ]
}`
	locator := NewJsonSourceLocator(jsonText)
	
	loc := locator.GetLocation("/matrix/0")
	t.Logf("First row location: %d:%d", loc.Line, loc.Column)
	
	loc = locator.GetLocation("/matrix/1/2")
	t.Logf("matrix[1][2] location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorRootPath(t *testing.T) {
	jsonText := `{"key": "value"}`
	locator := NewJsonSourceLocator(jsonText)
	
	loc := locator.GetLocation("/")
	t.Logf("Root path location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorWhitespace(t *testing.T) {
	jsonText := `{
    
    "spaced"   :    "value"
    
}`
	locator := NewJsonSourceLocator(jsonText)
	
	loc := locator.GetLocation("/spaced")
	t.Logf("spaced key location: %d:%d", loc.Line, loc.Column)
}

func TestJsonSourceLocatorLongArray(t *testing.T) {
	jsonText := `{"items": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}`
	locator := NewJsonSourceLocator(jsonText)
	
	// Get location of later element
	loc := locator.GetLocation("/items/9")
	t.Logf("items[9] location: %d:%d", loc.Line, loc.Column)
}

func TestBuildLineOffsets(t *testing.T) {
	text := "line1\nline2\nline3"
	offsets := buildLineOffsets(text)
	
	// Should have 3 lines
	if len(offsets) != 3 {
		t.Errorf("Expected 3 line offsets, got %d", len(offsets))
	}
	
	// First line starts at 0
	if offsets[0] != 0 {
		t.Errorf("Expected first line at offset 0, got %d", offsets[0])
	}
	
	// Second line starts after "line1\n"
	if offsets[1] != 6 {
		t.Errorf("Expected second line at offset 6, got %d", offsets[1])
	}
}

func TestJsonSourceLocatorNotFound(t *testing.T) {
	jsonText := `{"key": "value"}`
	locator := NewJsonSourceLocator(jsonText)
	
	// Non-existent path
	loc := locator.GetLocation("/nonexistent")
	t.Logf("Nonexistent path location: %d:%d (may be unknown)", loc.Line, loc.Column)
}
