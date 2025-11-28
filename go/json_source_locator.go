// Package jsonstructure provides validators for JSON Structure schemas and instances.
package jsonstructure

import (
	"strconv"
	"strings"
)

// JsonSourceLocator tracks line and column positions in a JSON document
// and maps JSON Pointer paths to source locations.
type JsonSourceLocator struct {
	jsonText    string
	lineOffsets []int
}

// NewJsonSourceLocator creates a new source locator for the given JSON text.
func NewJsonSourceLocator(jsonText string) *JsonSourceLocator {
	locator := &JsonSourceLocator{
		jsonText:    jsonText,
		lineOffsets: buildLineOffsets(jsonText),
	}
	return locator
}

// buildLineOffsets builds an array of line start offsets for efficient line/column lookup.
func buildLineOffsets(text string) []int {
	offsets := []int{0} // First line starts at offset 0
	for i, char := range text {
		if char == '\n' {
			offsets = append(offsets, i+1)
		}
	}
	return offsets
}

// GetLocation returns the source location for a JSON Pointer path.
func (l *JsonSourceLocator) GetLocation(path string) JsonLocation {
	if path == "" || l.jsonText == "" {
		return UnknownLocation()
	}

	// Parse the JSON Pointer path
	segments := l.parseJSONPointer(path)

	// Navigate through the JSON text to find the location
	return l.findLocationInText(segments)
}

// parseJSONPointer parses a JSON Pointer path into segments.
// Handles both standard JSON Pointer format (/a/0) and bracket notation (/a[0]).
func (l *JsonSourceLocator) parseJSONPointer(path string) []string {
	// Remove leading # if present (JSON Pointer fragment identifier)
	path = strings.TrimPrefix(path, "#")

	// Handle empty path or just "/"
	if path == "" || path == "/" {
		return []string{}
	}

	// Split by / and unescape segments, handling bracket notation
	var segments []string
	for _, segment := range strings.Split(path, "/") {
		if segment == "" {
			continue
		}
		// Unescape JSON Pointer tokens
		segment = strings.ReplaceAll(segment, "~1", "/")
		segment = strings.ReplaceAll(segment, "~0", "~")
		
		// Handle bracket notation (e.g., "required[0]" -> "required", "0")
		if bracketIdx := strings.Index(segment, "["); bracketIdx > 0 {
			// Extract the property name before the bracket
			propName := segment[:bracketIdx]
			segments = append(segments, propName)
			
			// Extract all bracket indices
			rest := segment[bracketIdx:]
			for len(rest) > 0 && rest[0] == '[' {
				closeIdx := strings.Index(rest, "]")
				if closeIdx < 0 {
					break
				}
				indexStr := rest[1:closeIdx]
				segments = append(segments, indexStr)
				rest = rest[closeIdx+1:]
			}
		} else {
			segments = append(segments, segment)
		}
	}

	return segments
}

// offsetToLocation converts a character offset to line/column position.
func (l *JsonSourceLocator) offsetToLocation(offset int) JsonLocation {
	if offset < 0 || offset > len(l.jsonText) {
		return UnknownLocation()
	}

	// Binary search for the line
	line := 0
	left, right := 0, len(l.lineOffsets)-1
	for left <= right {
		mid := (left + right) / 2
		if l.lineOffsets[mid] <= offset {
			line = mid
			left = mid + 1
		} else {
			right = mid - 1
		}
	}

	// Column is offset from line start (1-based)
	column := offset - l.lineOffsets[line] + 1
	return JsonLocation{Line: line + 1, Column: column} // 1-based line numbers
}

// findLocationInText navigates through JSON text to find the location of a path.
func (l *JsonSourceLocator) findLocationInText(segments []string) JsonLocation {
	text := l.jsonText
	offset := 0

	// Skip initial whitespace
	offset = l.skipWhitespace(text, offset)

	if offset >= len(text) {
		return UnknownLocation()
	}

	// If no segments, return the start of the document
	if len(segments) == 0 {
		return l.offsetToLocation(offset)
	}

	// Navigate through each segment
	for _, segment := range segments {
		offset = l.skipWhitespace(text, offset)

		if offset >= len(text) {
			return UnknownLocation()
		}

		char := text[offset]

		if char == '{' {
			// Object - find the property
			offset = l.findObjectProperty(text, offset, segment)
			if offset < 0 {
				return UnknownLocation()
			}
		} else if char == '[' {
			// Array - find the index
			index, err := strconv.Atoi(segment)
			if err != nil {
				return UnknownLocation()
			}
			offset = l.findArrayElement(text, offset, index)
			if offset < 0 {
				return UnknownLocation()
			}
		} else {
			// Not an object or array, can't navigate further
			return UnknownLocation()
		}
	}

	return l.offsetToLocation(offset)
}

// skipWhitespace skips whitespace characters.
func (l *JsonSourceLocator) skipWhitespace(text string, offset int) int {
	for offset < len(text) {
		c := text[offset]
		if c != ' ' && c != '\t' && c != '\n' && c != '\r' {
			break
		}
		offset++
	}
	return offset
}

// skipString skips a JSON string value and returns the offset after the closing quote.
func (l *JsonSourceLocator) skipString(text string, offset int) int {
	if offset >= len(text) || text[offset] != '"' {
		return offset
	}

	offset++ // Skip opening quote
	for offset < len(text) {
		char := text[offset]
		if char == '\\' {
			offset += 2 // Skip escape sequence
		} else if char == '"' {
			return offset + 1 // Return position after closing quote
		} else {
			offset++
		}
	}
	return offset
}

// skipValue skips a JSON value and returns the offset after it.
func (l *JsonSourceLocator) skipValue(text string, offset int) int {
	offset = l.skipWhitespace(text, offset)

	if offset >= len(text) {
		return offset
	}

	char := text[offset]

	switch {
	case char == '"':
		return l.skipString(text, offset)
	case char == '{':
		return l.skipObject(text, offset)
	case char == '[':
		return l.skipArray(text, offset)
	case char == 't':
		if offset+4 <= len(text) && text[offset:offset+4] == "true" {
			return offset + 4
		}
	case char == 'f':
		if offset+5 <= len(text) && text[offset:offset+5] == "false" {
			return offset + 5
		}
	case char == 'n':
		if offset+4 <= len(text) && text[offset:offset+4] == "null" {
			return offset + 4
		}
	case char == '-' || (char >= '0' && char <= '9'):
		// Number
		for offset < len(text) {
			c := text[offset]
			if c != '-' && c != '+' && c != '.' && c != 'e' && c != 'E' && (c < '0' || c > '9') {
				break
			}
			offset++
		}
		return offset
	}

	return offset
}

// skipObject skips an entire JSON object.
func (l *JsonSourceLocator) skipObject(text string, offset int) int {
	if offset >= len(text) || text[offset] != '{' {
		return offset
	}

	offset++ // Skip opening brace
	depth := 1

	for offset < len(text) && depth > 0 {
		offset = l.skipWhitespace(text, offset)
		if offset >= len(text) {
			break
		}

		char := text[offset]
		switch char {
		case '{':
			depth++
			offset++
		case '}':
			depth--
			offset++
		case '"':
			offset = l.skipString(text, offset)
		default:
			offset++
		}
	}

	return offset
}

// skipArray skips an entire JSON array.
func (l *JsonSourceLocator) skipArray(text string, offset int) int {
	if offset >= len(text) || text[offset] != '[' {
		return offset
	}

	offset++ // Skip opening bracket
	depth := 1

	for offset < len(text) && depth > 0 {
		offset = l.skipWhitespace(text, offset)
		if offset >= len(text) {
			break
		}

		char := text[offset]
		switch char {
		case '[':
			depth++
			offset++
		case ']':
			depth--
			offset++
		case '{':
			offset = l.skipObject(text, offset)
		case '"':
			offset = l.skipString(text, offset)
		default:
			offset++
		}
	}

	return offset
}

// findObjectProperty finds a property in an object and returns the offset of its value.
func (l *JsonSourceLocator) findObjectProperty(text string, offset int, propertyName string) int {
	if offset >= len(text) || text[offset] != '{' {
		return -1
	}

	offset++ // Skip opening brace

	for offset < len(text) {
		offset = l.skipWhitespace(text, offset)

		if offset >= len(text) {
			return -1
		}

		if text[offset] == '}' {
			return -1 // End of object, property not found
		}

		// Skip comma if present
		if text[offset] == ',' {
			offset++
			offset = l.skipWhitespace(text, offset)
		}

		// Expect a property name (string)
		if offset >= len(text) || text[offset] != '"' {
			return -1
		}

		// Parse the property name
		nameStart := offset + 1
		offset = l.skipString(text, offset)
		nameEnd := offset - 1 // Don't include closing quote
		currentName := text[nameStart:nameEnd]

		// Skip whitespace and colon
		offset = l.skipWhitespace(text, offset)
		if offset >= len(text) || text[offset] != ':' {
			return -1
		}
		offset++
		offset = l.skipWhitespace(text, offset)

		if currentName == propertyName {
			return offset // Return offset of the value
		}

		// Skip this value
		offset = l.skipValue(text, offset)
	}

	return -1
}

// findArrayElement finds an array element by index and returns the offset of its value.
func (l *JsonSourceLocator) findArrayElement(text string, offset int, index int) int {
	if offset >= len(text) || text[offset] != '[' {
		return -1
	}

	offset++ // Skip opening bracket
	currentIndex := 0

	for offset < len(text) {
		offset = l.skipWhitespace(text, offset)

		if offset >= len(text) {
			return -1
		}

		if text[offset] == ']' {
			return -1 // End of array, index not found
		}

		// Skip comma if present
		if text[offset] == ',' {
			offset++
			offset = l.skipWhitespace(text, offset)
		}

		if currentIndex == index {
			return offset // Return offset of the element
		}

		// Skip this value
		offset = l.skipValue(text, offset)
		currentIndex++
	}

	return -1
}
