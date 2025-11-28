/**
 * Locates the source position (line and column) of a JSON Pointer path within JSON text.
 */

import { JsonLocation, UNKNOWN_LOCATION } from './types';

/**
 * Parses a JSON Pointer path and returns an array of segments.
 * Handles both standard JSON Pointer format (/foo/bar) and 
 * the notation used in validation paths (#/foo/bar[0]).
 */
function parsePath(path: string): string[] {
  if (!path) {
    return [];
  }

  // Remove leading '#' if present (JSON Pointer anchor)
  if (path.startsWith('#')) {
    path = path.slice(1);
  }

  // Remove leading slash
  if (path.startsWith('/')) {
    path = path.slice(1);
  }

  if (!path) {
    return [];
  }

  // Split and unescape JSON Pointer tokens
  // Also handle array index notation like [0] or [1]
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    // Unescape JSON Pointer tokens
    const unescaped = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    
    // Check for array index notation like "required[0]"
    const bracketMatch = unescaped.match(/^(.+?)\[(\d+)\]$/);
    if (bracketMatch) {
      // Split into property name and array index
      segments.push(bracketMatch[1]);
      segments.push(bracketMatch[2]);
    } else {
      segments.push(unescaped);
    }
  }
  
  return segments;
}

/**
 * JSON Source Locator class that finds line/column positions from JSON Pointer paths.
 */
export class JsonSourceLocator {
  private readonly json: string;
  private readonly locationCache: Map<string, JsonLocation> = new Map();

  constructor(json: string) {
    this.json = json;
  }

  /**
   * Gets the source location for a JSON Pointer path.
   */
  getLocation(path: string): JsonLocation {
    if (!path) {
      return this.getRootLocation();
    }

    const cached = this.locationCache.get(path);
    if (cached) {
      return cached;
    }

    const location = this.findLocationForPath(path);
    this.locationCache.set(path, location);
    return location;
  }

  private getRootLocation(): JsonLocation {
    let line = 1;
    let column = 1;

    for (const c of this.json) {
      if (!/\s/.test(c)) {
        return { line, column };
      }

      if (c === '\n') {
        line++;
        column = 1;
      } else if (c !== '\r') {
        column++;
      }
    }

    return { line: 1, column: 1 };
  }

  private findLocationForPath(path: string): JsonLocation {
    try {
      const segments = parsePath(path);
      if (segments.length === 0) {
        return this.getRootLocation();
      }

      // Use a simple approach: parse the JSON and track positions
      let position = 0;
      let line = 1;
      let column = 1;

      const updatePosition = (chars: number) => {
        for (let i = 0; i < chars && position + i < this.json.length; i++) {
          if (this.json[position + i] === '\n') {
            line++;
            column = 1;
          } else if (this.json[position + i] !== '\r') {
            column++;
          }
        }
        position += chars;
      };

      const skipWhitespace = () => {
        while (position < this.json.length && /\s/.test(this.json[position])) {
          updatePosition(1);
        }
      };

      const readString = (): string => {
        if (this.json[position] !== '"') {
          throw new Error('Expected string');
        }
        updatePosition(1);
        let result = '';
        while (position < this.json.length && this.json[position] !== '"') {
          if (this.json[position] === '\\') {
            updatePosition(1);
            if (position < this.json.length) {
              result += this.json[position];
              updatePosition(1);
            }
          } else {
            result += this.json[position];
            updatePosition(1);
          }
        }
        updatePosition(1); // closing quote
        return result;
      };

      const skipValue = () => {
        skipWhitespace();
        const c = this.json[position];
        if (c === '"') {
          readString();
        } else if (c === '{') {
          let depth = 1;
          updatePosition(1);
          while (position < this.json.length && depth > 0) {
            if (this.json[position] === '{') {
              depth++;
              updatePosition(1);
            } else if (this.json[position] === '}') {
              depth--;
              updatePosition(1);
            } else if (this.json[position] === '"') {
              readString();
            } else {
              updatePosition(1);
            }
          }
        } else if (c === '[') {
          let depth = 1;
          updatePosition(1);
          while (position < this.json.length && depth > 0) {
            if (this.json[position] === '[') {
              depth++;
              updatePosition(1);
            } else if (this.json[position] === ']') {
              depth--;
              updatePosition(1);
            } else if (this.json[position] === '"') {
              readString();
            } else {
              updatePosition(1);
            }
          }
        } else {
          // number, boolean, null
          while (position < this.json.length && /[^,\]\}]/.test(this.json[position])) {
            updatePosition(1);
          }
        }
      };

      // Navigate to the path
      let currentSegmentIndex = 0;

      skipWhitespace();

      while (currentSegmentIndex < segments.length && position < this.json.length) {
        const segment = segments[currentSegmentIndex];
        const isArrayIndex = /^\d+$/.test(segment);

        skipWhitespace();

        if (isArrayIndex) {
          // Navigate into array
          if (this.json[position] !== '[') {
            return UNKNOWN_LOCATION;
          }
          updatePosition(1);
          skipWhitespace();

          const targetIndex = parseInt(segment, 10);
          let currentIndex = 0;

          while (position < this.json.length && this.json[position] !== ']') {
            if (currentIndex === targetIndex) {
              if (currentSegmentIndex === segments.length - 1) {
                // Found it!
                return { line, column };
              }
              currentSegmentIndex++;
              break;
            }

            skipValue();
            skipWhitespace();

            if (this.json[position] === ',') {
              updatePosition(1);
              skipWhitespace();
              currentIndex++;
            } else {
              break;
            }
          }

          if (currentIndex !== targetIndex && currentSegmentIndex !== segments.length) {
            return UNKNOWN_LOCATION;
          }
        } else {
          // Navigate into object
          if (this.json[position] !== '{') {
            return UNKNOWN_LOCATION;
          }
          updatePosition(1);
          skipWhitespace();

          let found = false;

          while (position < this.json.length && this.json[position] !== '}') {
            // Read property name
            const propName = readString();
            skipWhitespace();

            if (this.json[position] !== ':') {
              return UNKNOWN_LOCATION;
            }
            updatePosition(1);
            skipWhitespace();

            if (propName === segment) {
              if (currentSegmentIndex === segments.length - 1) {
                // Found it!
                return { line, column };
              }
              currentSegmentIndex++;
              found = true;
              break;
            }

            // Skip this value
            skipValue();
            skipWhitespace();

            if (this.json[position] === ',') {
              updatePosition(1);
              skipWhitespace();
            }
          }

          if (!found) {
            return UNKNOWN_LOCATION;
          }
        }
      }

      return UNKNOWN_LOCATION;
    } catch {
      return UNKNOWN_LOCATION;
    }
  }
}
