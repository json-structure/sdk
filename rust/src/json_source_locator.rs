//! JSON source locator for tracking line/column positions.
//!
//! Provides utilities to map JSON Pointer paths to source locations
//! in the original JSON text.

use std::collections::HashMap;

use crate::types::JsonLocation;

/// Locates positions in JSON source text.
#[derive(Debug, Clone)]
pub struct JsonSourceLocator {
    /// Map from JSON Pointer paths to source locations.
    locations: HashMap<String, JsonLocation>,
}

impl JsonSourceLocator {
    /// Creates a new source locator by parsing the given JSON text.
    pub fn new(json_text: &str) -> Self {
        let mut locator = Self {
            locations: HashMap::new(),
        };
        locator.parse(json_text);
        locator
    }

    /// Parses JSON text and builds the location map.
    fn parse(&mut self, text: &str) {
        let mut line = 1usize;
        let mut column = 1usize;
        let mut path_stack: Vec<PathSegment> = Vec::new();
        let chars: Vec<char> = text.chars().collect();
        let len = chars.len();
        let mut i = 0;

        // Record root location
        self.skip_whitespace(&chars, &mut i, &mut line, &mut column);
        if i < len {
            self.locations.insert(String::new(), JsonLocation::new(line, column));
        }

        while i < len {
            let ch = chars[i];

            match ch {
                '{' => {
                    // Start of object
                    i += 1;
                    column += 1;
                    self.skip_whitespace(&chars, &mut i, &mut line, &mut column);
                    
                    // Parse object properties
                    while i < len && chars[i] != '}' {
                        self.skip_whitespace(&chars, &mut i, &mut line, &mut column);
                        if i >= len || chars[i] == '}' {
                            break;
                        }

                        // Expect property name (string)
                        if chars[i] == '\"' {
                            let _key_line = line;
                            let _key_column = column;
                            let key = self.parse_string(&chars, &mut i, &mut line, &mut column);
                            
                            // Skip colon
                            self.skip_whitespace(&chars, &mut i, &mut line, &mut column);
                            if i < len && chars[i] == ':' {
                                i += 1;
                                column += 1;
                            }
                            
                            // Record value location
                            self.skip_whitespace(&chars, &mut i, &mut line, &mut column);
                            path_stack.push(PathSegment::Property(key.clone()));
                            let path = self.build_path(&path_stack);
                            self.locations.insert(path, JsonLocation::new(line, column));
                            
                            // Skip value
                            self.skip_value(&chars, &mut i, &mut line, &mut column, &mut path_stack);
                            path_stack.pop();
                            
                            // Skip comma
                            self.skip_whitespace(&chars, &mut i, &mut line, &mut column);
                            if i < len && chars[i] == ',' {
                                i += 1;
                                column += 1;
                            }
                        } else {
                            // Invalid JSON, skip character
                            i += 1;
                            column += 1;
                        }
                    }
                    
                    // Skip closing brace
                    if i < len && chars[i] == '}' {
                        i += 1;
                        column += 1;
                    }
                }
                '[' => {
                    // Start of array
                    i += 1;
                    column += 1;
                    let mut index = 0usize;
                    
                    self.skip_whitespace(&chars, &mut i, &mut line, &mut column);
                    
                    while i < len && chars[i] != ']' {
                        self.skip_whitespace(&chars, &mut i, &mut line, &mut column);
                        if i >= len || chars[i] == ']' {
                            break;
                        }
                        
                        // Record element location
                        path_stack.push(PathSegment::Index(index));
                        let path = self.build_path(&path_stack);
                        self.locations.insert(path, JsonLocation::new(line, column));
                        
                        // Skip value
                        self.skip_value(&chars, &mut i, &mut line, &mut column, &mut path_stack);
                        path_stack.pop();
                        
                        index += 1;
                        
                        // Skip comma
                        self.skip_whitespace(&chars, &mut i, &mut line, &mut column);
                        if i < len && chars[i] == ',' {
                            i += 1;
                            column += 1;
                        }
                    }
                    
                    // Skip closing bracket
                    if i < len && chars[i] == ']' {
                        i += 1;
                        column += 1;
                    }
                }
                '"' => {
                    self.parse_string(&chars, &mut i, &mut line, &mut column);
                }
                '\n' => {
                    i += 1;
                    line += 1;
                    column = 1;
                }
                _ => {
                    // Skip other characters (numbers, booleans, null, whitespace)
                    i += 1;
                    column += 1;
                }
            }
        }
    }

    /// Skips whitespace characters.
    fn skip_whitespace(&self, chars: &[char], i: &mut usize, line: &mut usize, column: &mut usize) {
        while *i < chars.len() {
            match chars[*i] {
                ' ' | '\t' | '\r' => {
                    *i += 1;
                    *column += 1;
                }
                '\n' => {
                    *i += 1;
                    *line += 1;
                    *column = 1;
                }
                _ => break,
            }
        }
    }

    /// Parses a JSON string and returns its content.
    fn parse_string(&self, chars: &[char], i: &mut usize, line: &mut usize, column: &mut usize) -> String {
        let mut result = String::new();
        
        // Skip opening quote
        if *i < chars.len() && chars[*i] == '"' {
            *i += 1;
            *column += 1;
        }
        
        while *i < chars.len() {
            let ch = chars[*i];
            
            if ch == '"' {
                // End of string
                *i += 1;
                *column += 1;
                break;
            } else if ch == '\\' && *i + 1 < chars.len() {
                // Escape sequence
                *i += 1;
                *column += 1;
                let escaped = chars[*i];
                *i += 1;
                *column += 1;
                
                match escaped {
                    'n' => result.push('\n'),
                    'r' => result.push('\r'),
                    't' => result.push('\t'),
                    '\\' => result.push('\\'),
                    '"' => result.push('"'),
                    '/' => result.push('/'),
                    'u' => {
                        // Unicode escape - skip 4 hex digits
                        for _ in 0..4 {
                            if *i < chars.len() {
                                *i += 1;
                                *column += 1;
                            }
                        }
                    }
                    _ => result.push(escaped),
                }
            } else if ch == '\n' {
                *i += 1;
                *line += 1;
                *column = 1;
            } else {
                result.push(ch);
                *i += 1;
                *column += 1;
            }
        }
        
        result
    }

    /// Skips a JSON value (recursively handles objects and arrays).
    fn skip_value(
        &mut self,
        chars: &[char],
        i: &mut usize,
        line: &mut usize,
        column: &mut usize,
        path_stack: &mut Vec<PathSegment>,
    ) {
        self.skip_whitespace(chars, i, line, column);
        
        if *i >= chars.len() {
            return;
        }
        
        match chars[*i] {
            '{' => {
                *i += 1;
                *column += 1;
                self.skip_whitespace(chars, i, line, column);
                
                while *i < chars.len() && chars[*i] != '}' {
                    self.skip_whitespace(chars, i, line, column);
                    if *i >= chars.len() || chars[*i] == '}' {
                        break;
                    }
                    
                    // Parse property name
                    if chars[*i] == '"' {
                        let key = self.parse_string(chars, i, line, column);
                        
                        // Skip colon
                        self.skip_whitespace(chars, i, line, column);
                        if *i < chars.len() && chars[*i] == ':' {
                            *i += 1;
                            *column += 1;
                        }
                        
                        // Record and skip value
                        self.skip_whitespace(chars, i, line, column);
                        path_stack.push(PathSegment::Property(key.clone()));
                        let path = self.build_path(path_stack);
                        self.locations.insert(path, JsonLocation::new(*line, *column));
                        self.skip_value(chars, i, line, column, path_stack);
                        path_stack.pop();
                        
                        // Skip comma
                        self.skip_whitespace(chars, i, line, column);
                        if *i < chars.len() && chars[*i] == ',' {
                            *i += 1;
                            *column += 1;
                        }
                    } else {
                        *i += 1;
                        *column += 1;
                    }
                }
                
                if *i < chars.len() && chars[*i] == '}' {
                    *i += 1;
                    *column += 1;
                }
            }
            '[' => {
                *i += 1;
                *column += 1;
                let mut index = 0usize;
                
                self.skip_whitespace(chars, i, line, column);
                
                while *i < chars.len() && chars[*i] != ']' {
                    self.skip_whitespace(chars, i, line, column);
                    if *i >= chars.len() || chars[*i] == ']' {
                        break;
                    }
                    
                    // Record and skip element
                    path_stack.push(PathSegment::Index(index));
                    let path = self.build_path(path_stack);
                    self.locations.insert(path, JsonLocation::new(*line, *column));
                    self.skip_value(chars, i, line, column, path_stack);
                    path_stack.pop();
                    
                    index += 1;
                    
                    // Skip comma
                    self.skip_whitespace(chars, i, line, column);
                    if *i < chars.len() && chars[*i] == ',' {
                        *i += 1;
                        *column += 1;
                    }
                }
                
                if *i < chars.len() && chars[*i] == ']' {
                    *i += 1;
                    *column += 1;
                }
            }
            '"' => {
                self.parse_string(chars, i, line, column);
            }
            _ => {
                // Number, boolean, null - skip until delimiter
                while *i < chars.len() {
                    let ch = chars[*i];
                    if ch == ',' || ch == '}' || ch == ']' || ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' {
                        break;
                    }
                    if ch == '\n' {
                        *line += 1;
                        *column = 1;
                    } else {
                        *column += 1;
                    }
                    *i += 1;
                }
            }
        }
    }

    /// Builds a JSON Pointer path from the path stack.
    fn build_path(&self, stack: &[PathSegment]) -> String {
        if stack.is_empty() {
            return String::new();
        }
        
        let mut path = String::new();
        for segment in stack {
            path.push('/');
            match segment {
                PathSegment::Property(key) => {
                    // Escape ~ and / in property names
                    for ch in key.chars() {
                        match ch {
                            '~' => path.push_str("~0"),
                            '/' => path.push_str("~1"),
                            _ => path.push(ch),
                        }
                    }
                }
                PathSegment::Index(idx) => {
                    path.push_str(&idx.to_string());
                }
            }
        }
        path
    }

    /// Gets the source location for a JSON Pointer path.
    pub fn get_location(&self, path: &str) -> JsonLocation {
        self.locations
            .get(path)
            .copied()
            .unwrap_or_else(JsonLocation::unknown)
    }

    /// Returns true if the locator has a location for the given path.
    pub fn has_location(&self, path: &str) -> bool {
        self.locations.contains_key(path)
    }
}

/// A segment in a JSON Pointer path.
#[derive(Debug, Clone)]
enum PathSegment {
    Property(String),
    Index(usize),
}

impl Default for JsonSourceLocator {
    fn default() -> Self {
        Self {
            locations: HashMap::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_object() {
        let json = r#"{"name": "test", "value": 42}"#;
        let locator = JsonSourceLocator::new(json);
        
        let root = locator.get_location("");
        assert_eq!(root.line, 1);
        assert_eq!(root.column, 1);
        
        let name = locator.get_location("/name");
        assert!(!name.is_unknown());
        
        let value = locator.get_location("/value");
        assert!(!value.is_unknown());
    }

    #[test]
    fn test_nested_object() {
        let json = r#"{
  "outer": {
    "inner": "value"
  }
}"#;
        let locator = JsonSourceLocator::new(json);
        
        let inner = locator.get_location("/outer/inner");
        assert!(!inner.is_unknown());
        assert_eq!(inner.line, 3);
    }

    #[test]
    fn test_array() {
        let json = r#"[1, 2, 3]"#;
        let locator = JsonSourceLocator::new(json);
        
        let first = locator.get_location("/0");
        assert!(!first.is_unknown());
        
        let second = locator.get_location("/1");
        assert!(!second.is_unknown());
    }

    #[test]
    fn test_unknown_path() {
        let json = r#"{"name": "test"}"#;
        let locator = JsonSourceLocator::new(json);
        
        let unknown = locator.get_location("/nonexistent");
        assert!(unknown.is_unknown());
    }
}
