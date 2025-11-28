// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import java.util.ArrayList;
import java.util.List;

/**
 * Tracks line and column positions in a JSON document and maps
 * JSON Pointer paths to source locations.
 */
public final class JsonSourceLocator {
    private final String jsonText;
    private final int[] lineOffsets;

    /**
     * Creates a new JsonSourceLocator for the given JSON text.
     *
     * @param jsonText the raw JSON text to analyze
     */
    public JsonSourceLocator(String jsonText) {
        this.jsonText = jsonText != null ? jsonText : "";
        this.lineOffsets = buildLineOffsets(this.jsonText);
    }

    private static int[] buildLineOffsets(String text) {
        List<Integer> offsets = new ArrayList<>();
        offsets.add(0); // First line starts at offset 0
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                offsets.add(i + 1);
            }
        }
        return offsets.stream().mapToInt(Integer::intValue).toArray();
    }

    /**
     * Gets the source location for a JSON Pointer path.
     *
     * @param path JSON Pointer path (e.g., "/properties/name" or "#/properties/name")
     * @return JsonLocation for the path, or unknown location if not found
     */
    public JsonLocation getLocation(String path) {
        if (path == null || path.isEmpty() || jsonText.isEmpty()) {
            return JsonLocation.UNKNOWN;
        }

        // Parse the JSON Pointer path
        List<String> segments = parseJsonPointer(path);

        // Navigate through the JSON text to find the location
        return findLocationInText(segments);
    }

    private List<String> parseJsonPointer(String path) {
        // Remove leading # if present (JSON Pointer fragment identifier)
        if (path.startsWith("#")) {
            path = path.substring(1);
        }

        // Handle empty path or just "/"
        if (path.isEmpty() || path.equals("/")) {
            return new ArrayList<>();
        }

        // Split by / and unescape segments
        List<String> segments = new ArrayList<>();
        for (String segment : path.split("/")) {
            if (!segment.isEmpty()) {
                // Unescape JSON Pointer tokens
                segment = segment.replace("~1", "/").replace("~0", "~");
                segments.add(segment);
            }
        }

        return segments;
    }

    private JsonLocation offsetToLocation(int offset) {
        if (offset < 0 || offset > jsonText.length()) {
            return JsonLocation.UNKNOWN;
        }

        // Binary search for the line
        int line = 0;
        int left = 0, right = lineOffsets.length - 1;
        while (left <= right) {
            int mid = (left + right) / 2;
            if (lineOffsets[mid] <= offset) {
                line = mid;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        // Column is offset from line start (1-based)
        int column = offset - lineOffsets[line] + 1;
        return new JsonLocation(line + 1, column); // 1-based line numbers
    }

    private JsonLocation findLocationInText(List<String> segments) {
        int offset = 0;

        // Skip initial whitespace
        offset = skipWhitespace(offset);

        if (offset >= jsonText.length()) {
            return JsonLocation.UNKNOWN;
        }

        // If no segments, return the start of the document
        if (segments.isEmpty()) {
            return offsetToLocation(offset);
        }

        // Navigate through each segment
        for (String segment : segments) {
            offset = skipWhitespace(offset);

            if (offset >= jsonText.length()) {
                return JsonLocation.UNKNOWN;
            }

            char ch = jsonText.charAt(offset);

            if (ch == '{') {
                // Object - find the property
                offset = findObjectProperty(offset, segment);
                if (offset < 0) {
                    return JsonLocation.UNKNOWN;
                }
            } else if (ch == '[') {
                // Array - find the index
                try {
                    int index = Integer.parseInt(segment);
                    offset = findArrayElement(offset, index);
                    if (offset < 0) {
                        return JsonLocation.UNKNOWN;
                    }
                } catch (NumberFormatException e) {
                    return JsonLocation.UNKNOWN;
                }
            } else {
                // Not an object or array, can't navigate further
                return JsonLocation.UNKNOWN;
            }
        }

        return offsetToLocation(offset);
    }

    private int skipWhitespace(int offset) {
        while (offset < jsonText.length()) {
            char c = jsonText.charAt(offset);
            if (c != ' ' && c != '\t' && c != '\n' && c != '\r') {
                break;
            }
            offset++;
        }
        return offset;
    }

    private int skipString(int offset) {
        if (offset >= jsonText.length() || jsonText.charAt(offset) != '"') {
            return offset;
        }

        offset++; // Skip opening quote
        while (offset < jsonText.length()) {
            char ch = jsonText.charAt(offset);
            if (ch == '\\') {
                offset += 2; // Skip escape sequence
            } else if (ch == '"') {
                return offset + 1; // Return position after closing quote
            } else {
                offset++;
            }
        }
        return offset;
    }

    private int skipValue(int offset) {
        offset = skipWhitespace(offset);

        if (offset >= jsonText.length()) {
            return offset;
        }

        char ch = jsonText.charAt(offset);

        if (ch == '"') {
            return skipString(offset);
        } else if (ch == '{') {
            return skipObject(offset);
        } else if (ch == '[') {
            return skipArray(offset);
        } else if (ch == 't') {
            if (offset + 4 <= jsonText.length() && jsonText.substring(offset, offset + 4).equals("true")) {
                return offset + 4;
            }
        } else if (ch == 'f') {
            if (offset + 5 <= jsonText.length() && jsonText.substring(offset, offset + 5).equals("false")) {
                return offset + 5;
            }
        } else if (ch == 'n') {
            if (offset + 4 <= jsonText.length() && jsonText.substring(offset, offset + 4).equals("null")) {
                return offset + 4;
            }
        } else if (ch == '-' || (ch >= '0' && ch <= '9')) {
            // Number
            while (offset < jsonText.length()) {
                char c = jsonText.charAt(offset);
                if (c != '-' && c != '+' && c != '.' && c != 'e' && c != 'E' && (c < '0' || c > '9')) {
                    break;
                }
                offset++;
            }
            return offset;
        }

        return offset;
    }

    private int skipObject(int offset) {
        if (offset >= jsonText.length() || jsonText.charAt(offset) != '{') {
            return offset;
        }

        offset++; // Skip opening brace
        int depth = 1;

        while (offset < jsonText.length() && depth > 0) {
            offset = skipWhitespace(offset);
            if (offset >= jsonText.length()) {
                break;
            }

            char ch = jsonText.charAt(offset);
            if (ch == '{') {
                depth++;
                offset++;
            } else if (ch == '}') {
                depth--;
                offset++;
            } else if (ch == '"') {
                offset = skipString(offset);
            } else {
                offset++;
            }
        }

        return offset;
    }

    private int skipArray(int offset) {
        if (offset >= jsonText.length() || jsonText.charAt(offset) != '[') {
            return offset;
        }

        offset++; // Skip opening bracket
        int depth = 1;

        while (offset < jsonText.length() && depth > 0) {
            offset = skipWhitespace(offset);
            if (offset >= jsonText.length()) {
                break;
            }

            char ch = jsonText.charAt(offset);
            if (ch == '[') {
                depth++;
                offset++;
            } else if (ch == ']') {
                depth--;
                offset++;
            } else if (ch == '{') {
                offset = skipObject(offset);
            } else if (ch == '"') {
                offset = skipString(offset);
            } else {
                offset++;
            }
        }

        return offset;
    }

    private int findObjectProperty(int offset, String propertyName) {
        if (offset >= jsonText.length() || jsonText.charAt(offset) != '{') {
            return -1;
        }

        offset++; // Skip opening brace

        while (offset < jsonText.length()) {
            offset = skipWhitespace(offset);

            if (offset >= jsonText.length()) {
                return -1;
            }

            if (jsonText.charAt(offset) == '}') {
                return -1; // End of object, property not found
            }

            // Skip comma if present
            if (jsonText.charAt(offset) == ',') {
                offset++;
                offset = skipWhitespace(offset);
            }

            // Expect a property name (string)
            if (offset >= jsonText.length() || jsonText.charAt(offset) != '"') {
                return -1;
            }

            // Parse the property name
            int nameStart = offset + 1;
            offset = skipString(offset);
            int nameEnd = offset - 1; // Don't include closing quote
            String currentName = jsonText.substring(nameStart, nameEnd);

            // Skip whitespace and colon
            offset = skipWhitespace(offset);
            if (offset >= jsonText.length() || jsonText.charAt(offset) != ':') {
                return -1;
            }
            offset++;
            offset = skipWhitespace(offset);

            if (currentName.equals(propertyName)) {
                return offset; // Return offset of the value
            }

            // Skip this value
            offset = skipValue(offset);
        }

        return -1;
    }

    private int findArrayElement(int offset, int index) {
        if (offset >= jsonText.length() || jsonText.charAt(offset) != '[') {
            return -1;
        }

        offset++; // Skip opening bracket
        int currentIndex = 0;

        while (offset < jsonText.length()) {
            offset = skipWhitespace(offset);

            if (offset >= jsonText.length()) {
                return -1;
            }

            if (jsonText.charAt(offset) == ']') {
                return -1; // End of array, index not found
            }

            // Skip comma if present
            if (jsonText.charAt(offset) == ',') {
                offset++;
                offset = skipWhitespace(offset);
            }

            if (currentIndex == index) {
                return offset; // Return offset of the element
            }

            // Skip this value
            offset = skipValue(offset);
            currentIndex++;
        }

        return -1;
    }
}
