// JSONStructure Swift SDK
// JSON Source Locator for line/column tracking

import Foundation

/// Tracks line and column positions in a JSON document and maps JSON Pointer paths to source locations.
public final class JsonSourceLocator: Sendable {
    private let jsonText: String
    private let lineOffsets: [Int]
    
    /// Creates a new source locator for the given JSON text.
    public init(_ jsonText: String) {
        self.jsonText = jsonText
        self.lineOffsets = JsonSourceLocator.buildLineOffsets(jsonText)
    }
    
    /// Builds an array of line start offsets for efficient line/column lookup.
    private static func buildLineOffsets(_ text: String) -> [Int] {
        var offsets: [Int] = [0] // First line starts at offset 0
        for (index, char) in text.enumerated() {
            if char == "\n" {
                offsets.append(index + 1)
            }
        }
        return offsets
    }
    
    /// Returns the source location for a JSON Pointer path.
    public func getLocation(_ path: String) -> JsonLocation {
        if path.isEmpty || jsonText.isEmpty {
            return .unknown()
        }
        
        let segments = parseJSONPointer(path)
        return findLocationInText(segments)
    }
    
    /// Parses a JSON Pointer path into segments.
    private func parseJSONPointer(_ path: String) -> [String] {
        var pathCopy = path
        
        // Remove leading # if present (JSON Pointer fragment identifier)
        if pathCopy.hasPrefix("#") {
            pathCopy = String(pathCopy.dropFirst())
        }
        
        // Handle empty path or just "/"
        if pathCopy.isEmpty || pathCopy == "/" {
            return []
        }
        
        var segments: [String] = []
        
        for segment in pathCopy.split(separator: "/", omittingEmptySubsequences: true) {
            var segmentStr = String(segment)
            
            // Unescape JSON Pointer tokens
            segmentStr = segmentStr.replacingOccurrences(of: "~1", with: "/")
            segmentStr = segmentStr.replacingOccurrences(of: "~0", with: "~")
            
            // Handle bracket notation (e.g., "required[0]" -> "required", "0")
            if let bracketIdx = segmentStr.firstIndex(of: "["), bracketIdx != segmentStr.startIndex {
                let propName = String(segmentStr[..<bracketIdx])
                segments.append(propName)
                
                var rest = String(segmentStr[bracketIdx...])
                while !rest.isEmpty && rest.first == "[" {
                    guard let closeIdx = rest.firstIndex(of: "]") else { break }
                    let afterOpenBracket = rest.index(after: rest.startIndex)
                    let indexStr = String(rest[afterOpenBracket..<closeIdx])
                    segments.append(indexStr)
                    rest = String(rest[rest.index(after: closeIdx)...])
                }
            } else {
                segments.append(segmentStr)
            }
        }
        
        return segments
    }
    
    /// Converts a character offset to line/column position.
    private func offsetToLocation(_ offset: Int) -> JsonLocation {
        if offset < 0 || offset > jsonText.count {
            return .unknown()
        }
        
        // Binary search for the line
        var line = 0
        var left = 0
        var right = lineOffsets.count - 1
        
        while left <= right {
            let mid = (left + right) / 2
            if lineOffsets[mid] <= offset {
                line = mid
                left = mid + 1
            } else {
                right = mid - 1
            }
        }
        
        // Column is offset from line start (1-based)
        let column = offset - lineOffsets[line] + 1
        return JsonLocation(line: line + 1, column: column)
    }
    
    /// Navigates through JSON text to find the location of a path.
    private func findLocationInText(_ segments: [String]) -> JsonLocation {
        var offset = 0
        
        // Skip initial whitespace
        offset = skipWhitespace(offset)
        
        if offset >= jsonText.count {
            return .unknown()
        }
        
        // If no segments, return the start of the document
        if segments.isEmpty {
            return offsetToLocation(offset)
        }
        
        // Navigate through each segment
        for segment in segments {
            offset = skipWhitespace(offset)
            
            if offset >= jsonText.count {
                return .unknown()
            }
            
            let char = charAt(offset)
            
            if char == "{" {
                // Object - find the property
                guard let newOffset = findObjectProperty(offset, segment) else {
                    return .unknown()
                }
                offset = newOffset
            } else if char == "[" {
                // Array - find the index
                guard let index = Int(segment),
                      let newOffset = findArrayElement(offset, index) else {
                    return .unknown()
                }
                offset = newOffset
            } else {
                // Not an object or array, can't navigate further
                return .unknown()
            }
        }
        
        return offsetToLocation(offset)
    }
    
    /// Gets character at offset.
    private func charAt(_ offset: Int) -> Character {
        let index = jsonText.index(jsonText.startIndex, offsetBy: offset)
        return jsonText[index]
    }
    
    /// Skips whitespace characters.
    private func skipWhitespace(_ offset: Int) -> Int {
        var pos = offset
        while pos < jsonText.count {
            let char = charAt(pos)
            if char != " " && char != "\t" && char != "\n" && char != "\r" {
                break
            }
            pos += 1
        }
        return pos
    }
    
    /// Skips a JSON string value and returns the offset after the closing quote.
    private func skipString(_ offset: Int) -> Int {
        guard offset < jsonText.count && charAt(offset) == "\"" else {
            return offset
        }
        
        var pos = offset + 1 // Skip opening quote
        while pos < jsonText.count {
            let char = charAt(pos)
            if char == "\\" {
                pos += 2 // Skip escape sequence
            } else if char == "\"" {
                return pos + 1 // Return position after closing quote
            } else {
                pos += 1
            }
        }
        return pos
    }
    
    /// Skips a JSON value and returns the offset after it.
    private func skipValue(_ offset: Int) -> Int {
        var pos = skipWhitespace(offset)
        
        guard pos < jsonText.count else {
            return pos
        }
        
        let char = charAt(pos)
        
        switch char {
        case "\"":
            return skipString(pos)
        case "{":
            return skipObject(pos)
        case "[":
            return skipArray(pos)
        case "t":
            if hasPrefix(pos, "true") {
                return pos + 4
            }
        case "f":
            if hasPrefix(pos, "false") {
                return pos + 5
            }
        case "n":
            if hasPrefix(pos, "null") {
                return pos + 4
            }
        case "-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9":
            // Number
            while pos < jsonText.count {
                let c = charAt(pos)
                if c != "-" && c != "+" && c != "." && c != "e" && c != "E" &&
                   (c < "0" || c > "9") {
                    break
                }
                pos += 1
            }
            return pos
        default:
            break
        }
        
        return pos
    }
    
    /// Checks if text has prefix at position.
    private func hasPrefix(_ offset: Int, _ prefix: String) -> Bool {
        guard offset + prefix.count <= jsonText.count else {
            return false
        }
        let start = jsonText.index(jsonText.startIndex, offsetBy: offset)
        let end = jsonText.index(start, offsetBy: prefix.count)
        return jsonText[start..<end].elementsEqual(prefix)
    }
    
    /// Skips an entire JSON object.
    private func skipObject(_ offset: Int) -> Int {
        guard offset < jsonText.count && charAt(offset) == "{" else {
            return offset
        }
        
        var pos = offset + 1 // Skip opening brace
        var depth = 1
        
        while pos < jsonText.count && depth > 0 {
            pos = skipWhitespace(pos)
            guard pos < jsonText.count else { break }
            
            let char = charAt(pos)
            switch char {
            case "{":
                depth += 1
                pos += 1
            case "}":
                depth -= 1
                pos += 1
            case "\"":
                pos = skipString(pos)
            default:
                pos += 1
            }
        }
        
        return pos
    }
    
    /// Skips an entire JSON array.
    private func skipArray(_ offset: Int) -> Int {
        guard offset < jsonText.count && charAt(offset) == "[" else {
            return offset
        }
        
        var pos = offset + 1 // Skip opening bracket
        var depth = 1
        
        while pos < jsonText.count && depth > 0 {
            pos = skipWhitespace(pos)
            guard pos < jsonText.count else { break }
            
            let char = charAt(pos)
            switch char {
            case "[":
                depth += 1
                pos += 1
            case "]":
                depth -= 1
                pos += 1
            case "{":
                pos = skipObject(pos)
            case "\"":
                pos = skipString(pos)
            default:
                pos += 1
            }
        }
        
        return pos
    }
    
    /// Finds a property in an object and returns the offset of its value.
    private func findObjectProperty(_ offset: Int, _ propertyName: String) -> Int? {
        guard offset < jsonText.count && charAt(offset) == "{" else {
            return nil
        }
        
        var pos = offset + 1 // Skip opening brace
        
        while pos < jsonText.count {
            pos = skipWhitespace(pos)
            
            guard pos < jsonText.count else { return nil }
            
            if charAt(pos) == "}" {
                return nil // End of object, property not found
            }
            
            // Skip comma if present
            if charAt(pos) == "," {
                pos += 1
                pos = skipWhitespace(pos)
            }
            
            // Expect a property name (string)
            guard pos < jsonText.count && charAt(pos) == "\"" else {
                return nil
            }
            
            // Parse the property name
            let nameStart = pos + 1
            pos = skipString(pos)
            let nameEnd = pos - 1 // Don't include closing quote
            
            let startIndex = jsonText.index(jsonText.startIndex, offsetBy: nameStart)
            let endIndex = jsonText.index(jsonText.startIndex, offsetBy: nameEnd)
            let currentName = String(jsonText[startIndex..<endIndex])
            
            // Skip whitespace and colon
            pos = skipWhitespace(pos)
            guard pos < jsonText.count && charAt(pos) == ":" else {
                return nil
            }
            pos += 1
            pos = skipWhitespace(pos)
            
            if currentName == propertyName {
                return pos // Return offset of the value
            }
            
            // Skip this value
            pos = skipValue(pos)
        }
        
        return nil
    }
    
    /// Finds an array element by index and returns the offset of its value.
    private func findArrayElement(_ offset: Int, _ index: Int) -> Int? {
        guard offset < jsonText.count && charAt(offset) == "[" else {
            return nil
        }
        
        var pos = offset + 1 // Skip opening bracket
        var currentIndex = 0
        
        while pos < jsonText.count {
            pos = skipWhitespace(pos)
            
            guard pos < jsonText.count else { return nil }
            
            if charAt(pos) == "]" {
                return nil // End of array, index not found
            }
            
            // Skip comma if present
            if charAt(pos) == "," {
                pos += 1
                pos = skipWhitespace(pos)
            }
            
            if currentIndex == index {
                return pos // Return offset of the element
            }
            
            // Skip this value
            pos = skipValue(pos)
            currentIndex += 1
        }
        
        return nil
    }
}
