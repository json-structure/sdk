"""
JSON Source Locator - Maps JSON Pointer paths to line/column positions.
"""

import re
from typing import Any, Dict, List, Optional, Tuple, Union
from .error_codes import JsonLocation


class JsonSourceLocator:
    """
    Tracks line and column positions in a JSON document and maps
    JSON Pointer paths to source locations.
    """
    
    def __init__(self, json_text: str):
        """
        Initialize the source locator with the JSON text.
        
        Args:
            json_text: The raw JSON text to analyze
        """
        self._json_text = json_text
        self._line_offsets = self._build_line_offsets(json_text)
    
    def _build_line_offsets(self, text: str) -> List[int]:
        """
        Build an array of line start offsets for efficient line/column lookup.
        
        Args:
            text: The text to analyze
            
        Returns:
            List of character offsets where each line starts
        """
        offsets = [0]  # First line starts at offset 0
        for i, char in enumerate(text):
            if char == '\n':
                offsets.append(i + 1)
        return offsets
    
    def _offset_to_location(self, offset: int) -> JsonLocation:
        """
        Convert a character offset to line/column position.
        
        Args:
            offset: Character offset in the text
            
        Returns:
            JsonLocation with line and column (1-based)
        """
        if offset < 0 or offset > len(self._json_text):
            return JsonLocation.unknown()
        
        # Binary search for the line
        line = 0
        left, right = 0, len(self._line_offsets) - 1
        while left <= right:
            mid = (left + right) // 2
            if self._line_offsets[mid] <= offset:
                line = mid
                left = mid + 1
            else:
                right = mid - 1
        
        # Column is offset from line start (1-based)
        column = offset - self._line_offsets[line] + 1
        return JsonLocation(line + 1, column)  # 1-based line numbers
    
    def get_location(self, path: str, parsed_json: Any = None) -> JsonLocation:
        """
        Get the source location for a JSON Pointer path.
        
        Args:
            path: JSON Pointer path (e.g., "/properties/name" or "#/properties/name")
            parsed_json: Optional parsed JSON object (not used in text-based location)
            
        Returns:
            JsonLocation for the path, or unknown location if not found
        """
        if not path or not self._json_text:
            return JsonLocation.unknown()
        
        # Parse the JSON Pointer path
        segments = self._parse_json_pointer(path)
        
        # Navigate through the JSON text to find the location
        return self._find_location_in_text(segments)
    
    def _parse_json_pointer(self, path: str) -> List[str]:
        """
        Parse a JSON Pointer path into segments.
        
        Args:
            path: JSON Pointer path (e.g., "/properties/name" or "#/properties/name")
            
        Returns:
            List of path segments
        """
        # Remove leading # if present (JSON Pointer fragment identifier)
        if path.startswith('#'):
            path = path[1:]
        
        # Handle empty path or just "/"
        if not path or path == '/':
            return []
        
        # Split by / and unescape segments
        segments = []
        for segment in path.split('/'):
            if not segment:
                continue
            # Unescape JSON Pointer tokens
            segment = segment.replace('~1', '/').replace('~0', '~')
            segments.append(segment)
        
        return segments
    
    def _find_location_in_text(self, segments: List[str]) -> JsonLocation:
        """
        Navigate through JSON text to find the location of a path.
        
        Args:
            segments: Path segments to navigate
            
        Returns:
            JsonLocation for the path
        """
        text = self._json_text
        offset = 0
        
        # Skip initial whitespace
        offset = self._skip_whitespace(text, offset)
        
        if offset >= len(text):
            return JsonLocation.unknown()
        
        # If no segments, return the start of the document
        if not segments:
            return self._offset_to_location(offset)
        
        # Navigate through each segment
        for i, segment in enumerate(segments):
            offset = self._skip_whitespace(text, offset)
            
            if offset >= len(text):
                return JsonLocation.unknown()
            
            char = text[offset]
            
            if char == '{':
                # Object - find the property
                offset = self._find_object_property(text, offset, segment)
                if offset < 0:
                    return JsonLocation.unknown()
            elif char == '[':
                # Array - find the index
                try:
                    index = int(segment)
                    offset = self._find_array_element(text, offset, index)
                    if offset < 0:
                        return JsonLocation.unknown()
                except ValueError:
                    return JsonLocation.unknown()
            else:
                # Not an object or array, can't navigate further
                return JsonLocation.unknown()
        
        return self._offset_to_location(offset)
    
    def _skip_whitespace(self, text: str, offset: int) -> int:
        """Skip whitespace characters."""
        while offset < len(text) and text[offset] in ' \t\n\r':
            offset += 1
        return offset
    
    def _skip_string(self, text: str, offset: int) -> int:
        """Skip a JSON string value and return the offset after the closing quote."""
        if offset >= len(text) or text[offset] != '"':
            return offset
        
        offset += 1  # Skip opening quote
        while offset < len(text):
            char = text[offset]
            if char == '\\':
                offset += 2  # Skip escape sequence
            elif char == '"':
                return offset + 1  # Return position after closing quote
            else:
                offset += 1
        return offset
    
    def _skip_value(self, text: str, offset: int) -> int:
        """Skip a JSON value and return the offset after it."""
        offset = self._skip_whitespace(text, offset)
        
        if offset >= len(text):
            return offset
        
        char = text[offset]
        
        if char == '"':
            return self._skip_string(text, offset)
        elif char == '{':
            return self._skip_object(text, offset)
        elif char == '[':
            return self._skip_array(text, offset)
        elif char in 'tfn':
            # true, false, null
            for keyword in ['true', 'false', 'null']:
                if text[offset:offset+len(keyword)] == keyword:
                    return offset + len(keyword)
            return offset
        elif char in '-0123456789':
            # Number
            while offset < len(text) and text[offset] in '-+.0123456789eE':
                offset += 1
            return offset
        
        return offset
    
    def _skip_object(self, text: str, offset: int) -> int:
        """Skip an entire JSON object."""
        if offset >= len(text) or text[offset] != '{':
            return offset
        
        offset += 1  # Skip opening brace
        depth = 1
        
        while offset < len(text) and depth > 0:
            offset = self._skip_whitespace(text, offset)
            if offset >= len(text):
                break
            
            char = text[offset]
            if char == '{':
                depth += 1
                offset += 1
            elif char == '}':
                depth -= 1
                offset += 1
            elif char == '"':
                offset = self._skip_string(text, offset)
            else:
                offset += 1
        
        return offset
    
    def _skip_array(self, text: str, offset: int) -> int:
        """Skip an entire JSON array."""
        if offset >= len(text) or text[offset] != '[':
            return offset
        
        offset += 1  # Skip opening bracket
        depth = 1
        
        while offset < len(text) and depth > 0:
            offset = self._skip_whitespace(text, offset)
            if offset >= len(text):
                break
            
            char = text[offset]
            if char == '[':
                depth += 1
                offset += 1
            elif char == ']':
                depth -= 1
                offset += 1
            elif char == '{':
                offset = self._skip_object(text, offset)
            elif char == '"':
                offset = self._skip_string(text, offset)
            else:
                offset += 1
        
        return offset
    
    def _find_object_property(self, text: str, offset: int, property_name: str) -> int:
        """
        Find a property in an object and return the offset of its value.
        
        Args:
            text: JSON text
            offset: Starting offset (should be at the opening brace)
            property_name: Name of the property to find
            
        Returns:
            Offset of the property value, or -1 if not found
        """
        if offset >= len(text) or text[offset] != '{':
            return -1
        
        offset += 1  # Skip opening brace
        
        while offset < len(text):
            offset = self._skip_whitespace(text, offset)
            
            if offset >= len(text):
                return -1
            
            if text[offset] == '}':
                return -1  # End of object, property not found
            
            # Skip comma if present
            if text[offset] == ',':
                offset += 1
                offset = self._skip_whitespace(text, offset)
            
            # Expect a property name (string)
            if offset >= len(text) or text[offset] != '"':
                return -1
            
            # Parse the property name
            name_start = offset + 1
            offset = self._skip_string(text, offset)
            name_end = offset - 1  # Don't include closing quote
            current_name = text[name_start:name_end]
            
            # Skip whitespace and colon
            offset = self._skip_whitespace(text, offset)
            if offset >= len(text) or text[offset] != ':':
                return -1
            offset += 1
            offset = self._skip_whitespace(text, offset)
            
            if current_name == property_name:
                return offset  # Return offset of the value
            
            # Skip this value
            offset = self._skip_value(text, offset)
        
        return -1
    
    def _find_array_element(self, text: str, offset: int, index: int) -> int:
        """
        Find an array element by index and return the offset of its value.
        
        Args:
            text: JSON text
            offset: Starting offset (should be at the opening bracket)
            index: Array index to find
            
        Returns:
            Offset of the element value, or -1 if not found
        """
        if offset >= len(text) or text[offset] != '[':
            return -1
        
        offset += 1  # Skip opening bracket
        current_index = 0
        
        while offset < len(text):
            offset = self._skip_whitespace(text, offset)
            
            if offset >= len(text):
                return -1
            
            if text[offset] == ']':
                return -1  # End of array, index not found
            
            # Skip comma if present
            if text[offset] == ',':
                offset += 1
                offset = self._skip_whitespace(text, offset)
            
            if current_index == index:
                return offset  # Return offset of the element
            
            # Skip this value
            offset = self._skip_value(text, offset)
            current_index += 1
        
        return -1
