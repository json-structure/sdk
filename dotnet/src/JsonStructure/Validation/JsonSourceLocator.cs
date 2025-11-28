// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;

namespace JsonStructure.Validation;

/// <summary>
/// Locates the source position (line and column) of a JSON Pointer path within JSON text.
/// </summary>
internal sealed class JsonSourceLocator
{
    private readonly string _json;
    private readonly Dictionary<string, JsonLocation> _locationCache = new();

    /// <summary>
    /// Initializes a new instance of <see cref="JsonSourceLocator"/>.
    /// </summary>
    /// <param name="json">The original JSON text.</param>
    public JsonSourceLocator(string json)
    {
        _json = json ?? throw new ArgumentNullException(nameof(json));
    }

    /// <summary>
    /// Gets the source location for a JSON Pointer path.
    /// </summary>
    /// <param name="path">The JSON Pointer path (e.g., "/items/0/name").</param>
    /// <returns>The location in the source, or <see cref="JsonLocation.Unknown"/> if not found.</returns>
    public JsonLocation GetLocation(string path)
    {
        if (string.IsNullOrEmpty(path))
        {
            // Root - return position of first non-whitespace
            return GetRootLocation();
        }

        if (_locationCache.TryGetValue(path, out var cached))
        {
            return cached;
        }

        var location = FindLocationForPath(path);
        _locationCache[path] = location;
        return location;
    }

    private JsonLocation GetRootLocation()
    {
        int line = 1;
        int column = 1;

        for (int i = 0; i < _json.Length; i++)
        {
            char c = _json[i];
            if (!char.IsWhiteSpace(c))
            {
                return new JsonLocation(line, column);
            }

            if (c == '\n')
            {
                line++;
                column = 1;
            }
            else if (c != '\r')
            {
                column++;
            }
        }

        return new JsonLocation(1, 1);
    }

    private JsonLocation FindLocationForPath(string path)
    {
        try
        {
            var reader = new Utf8JsonReader(System.Text.Encoding.UTF8.GetBytes(_json));
            var segments = ParsePath(path);
            
            if (segments.Length == 0)
            {
                return GetRootLocation();
            }

            int currentSegment = 0;
            int arrayIndex = -1;
            string? propertyName = null;
            int depth = 0;
            bool lookingForValue = false;
            long targetBytePosition = 0;

            // Parse the first segment to know what we're looking for
            if (int.TryParse(segments[0], out int idx))
            {
                arrayIndex = idx;
            }
            else
            {
                propertyName = segments[0];
            }

            while (reader.Read())
            {
                if (lookingForValue)
                {
                    // We found the property name, now we're at its value
                    if (currentSegment == segments.Length - 1)
                    {
                        // This is the final segment - return this position
                        targetBytePosition = reader.TokenStartIndex;
                        return BytePositionToLocation(targetBytePosition);
                    }
                    else
                    {
                        // Move to next segment
                        currentSegment++;
                        lookingForValue = false;
                        
                        if (int.TryParse(segments[currentSegment], out idx))
                        {
                            arrayIndex = idx;
                            propertyName = null;
                        }
                        else
                        {
                            propertyName = segments[currentSegment];
                            arrayIndex = -1;
                        }

                        // Continue into this value
                        if (reader.TokenType == JsonTokenType.StartObject || reader.TokenType == JsonTokenType.StartArray)
                        {
                            depth = 1;
                        }
                        continue;
                    }
                }

                switch (reader.TokenType)
                {
                    case JsonTokenType.StartObject:
                        if (depth == 0 && propertyName != null)
                        {
                            depth = 1;
                        }
                        else if (depth > 0)
                        {
                            depth++;
                        }
                        break;

                    case JsonTokenType.EndObject:
                        if (depth > 0)
                        {
                            depth--;
                        }
                        break;

                    case JsonTokenType.StartArray:
                        if (depth == 0 && arrayIndex >= 0)
                        {
                            depth = 1;
                            // We need to count array elements
                            int currentIndex = 0;
                            int arrayDepth = 1;
                            
                            while (reader.Read() && arrayDepth > 0)
                            {
                                if (reader.TokenType == JsonTokenType.StartArray || reader.TokenType == JsonTokenType.StartObject)
                                {
                                    if (arrayDepth == 1 && currentIndex == arrayIndex)
                                    {
                                        // Found the target element
                                        if (currentSegment == segments.Length - 1)
                                        {
                                            return BytePositionToLocation(reader.TokenStartIndex);
                                        }
                                        else
                                        {
                                            // Continue into this element
                                            currentSegment++;
                                            if (int.TryParse(segments[currentSegment], out idx))
                                            {
                                                arrayIndex = idx;
                                                propertyName = null;
                                            }
                                            else
                                            {
                                                propertyName = segments[currentSegment];
                                                arrayIndex = -1;
                                            }
                                            depth = 1;
                                            goto continueOuter;
                                        }
                                    }
                                    arrayDepth++;
                                }
                                else if (reader.TokenType == JsonTokenType.EndArray || reader.TokenType == JsonTokenType.EndObject)
                                {
                                    arrayDepth--;
                                }
                                else if (arrayDepth == 1 && reader.TokenType != JsonTokenType.PropertyName)
                                {
                                    if (currentIndex == arrayIndex)
                                    {
                                        // Found a primitive at target index
                                        if (currentSegment == segments.Length - 1)
                                        {
                                            return BytePositionToLocation(reader.TokenStartIndex);
                                        }
                                    }
                                    currentIndex++;
                                }
                                
                                // After completing an element at depth 1, increment index
                                if (arrayDepth == 1 && (reader.TokenType == JsonTokenType.EndArray || reader.TokenType == JsonTokenType.EndObject))
                                {
                                    // Actually this is end of a nested structure
                                }
                            }
                            goto done;
                        }
                        else if (depth > 0)
                        {
                            depth++;
                        }
                        break;

                    case JsonTokenType.EndArray:
                        if (depth > 0)
                        {
                            depth--;
                        }
                        break;

                    case JsonTokenType.PropertyName:
                        if (depth == 1 && propertyName != null)
                        {
                            var name = reader.GetString();
                            if (name == propertyName)
                            {
                                lookingForValue = true;
                            }
                        }
                        break;
                }

                continueOuter:;
            }

            done:
            return JsonLocation.Unknown;
        }
        catch
        {
            return JsonLocation.Unknown;
        }
    }

    private JsonLocation BytePositionToLocation(long bytePosition)
    {
        int line = 1;
        int column = 1;
        int byteIndex = 0;

        var bytes = System.Text.Encoding.UTF8.GetBytes(_json);
        
        for (int i = 0; i < _json.Length && byteIndex < bytePosition; i++)
        {
            char c = _json[i];
            int charBytes = System.Text.Encoding.UTF8.GetByteCount(_json, i, 1);
            
            if (byteIndex + charBytes > bytePosition)
            {
                break;
            }
            
            byteIndex += charBytes;

            if (c == '\n')
            {
                line++;
                column = 1;
            }
            else if (c != '\r')
            {
                column++;
            }
        }

        return new JsonLocation(line, column);
    }

    private static string[] ParsePath(string path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return Array.Empty<string>();
        }

        // Remove leading slash
        if (path.StartsWith('/'))
        {
            path = path[1..];
        }

        if (string.IsNullOrEmpty(path))
        {
            return Array.Empty<string>();
        }

        // Split and unescape JSON Pointer tokens
        var parts = path.Split('/');
        for (int i = 0; i < parts.Length; i++)
        {
            parts[i] = parts[i].Replace("~1", "/").Replace("~0", "~");
        }

        return parts;
    }
}
