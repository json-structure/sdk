<?php

declare(strict_types=1);

namespace JsonStructure;

/**
 * Tracks line and column positions in a JSON document and maps
 * JSON Pointer paths to source locations.
 */
class JsonSourceLocator
{
    private string $jsonText;
    /** @var int[] */
    private array $lineOffsets;

    public function __construct(string $jsonText)
    {
        $this->jsonText = $jsonText;
        $this->lineOffsets = $this->buildLineOffsets($jsonText);
    }

    /**
     * Build an array of line start offsets for efficient line/column lookup.
     *
     * @return int[]
     */
    private function buildLineOffsets(string $text): array
    {
        $offsets = [0]; // First line starts at offset 0
        $length = strlen($text);

        for ($i = 0; $i < $length; $i++) {
            if ($text[$i] === "\n") {
                $offsets[] = $i + 1;
            }
        }

        return $offsets;
    }

    /**
     * Convert a character offset to line/column position.
     */
    private function offsetToLocation(int $offset): JsonLocation
    {
        $textLength = strlen($this->jsonText);
        if ($offset < 0 || $offset > $textLength) {
            return JsonLocation::unknown();
        }

        // Binary search for the line
        $line = 0;
        $left = 0;
        $right = count($this->lineOffsets) - 1;

        while ($left <= $right) {
            $mid = (int) (($left + $right) / 2);
            if ($this->lineOffsets[$mid] <= $offset) {
                $line = $mid;
                $left = $mid + 1;
            } else {
                $right = $mid - 1;
            }
        }

        // Column is offset from line start (1-based)
        $column = $offset - $this->lineOffsets[$line] + 1;

        return new JsonLocation($line + 1, $column); // 1-based line numbers
    }

    /**
     * Get the source location for a JSON Pointer path.
     */
    public function getLocation(string $path): JsonLocation
    {
        if ($path === '' || $this->jsonText === '') {
            return JsonLocation::unknown();
        }

        // Parse the JSON Pointer path
        $segments = $this->parseJsonPointer($path);

        // Navigate through the JSON text to find the location
        return $this->findLocationInText($segments);
    }

    /**
     * Parse a JSON Pointer path into segments.
     *
     * @return string[]
     */
    private function parseJsonPointer(string $path): array
    {
        // Remove leading # if present (JSON Pointer fragment identifier)
        if (str_starts_with($path, '#')) {
            $path = substr($path, 1);
        }

        // Handle empty path or just "/"
        if ($path === '' || $path === '/') {
            return [];
        }

        // Split by / and unescape segments
        $segments = [];
        foreach (explode('/', $path) as $segment) {
            if ($segment === '') {
                continue;
            }
            // Unescape JSON Pointer tokens
            $segment = str_replace('~1', '/', $segment);
            $segment = str_replace('~0', '~', $segment);
            $segments[] = $segment;
        }

        return $segments;
    }

    /**
     * Navigate through JSON text to find the location of a path.
     *
     * @param string[] $segments
     */
    private function findLocationInText(array $segments): JsonLocation
    {
        $text = $this->jsonText;
        $offset = 0;

        // Skip initial whitespace
        $offset = $this->skipWhitespace($text, $offset);

        if ($offset >= strlen($text)) {
            return JsonLocation::unknown();
        }

        // If no segments, return the start of the document
        if (count($segments) === 0) {
            return $this->offsetToLocation($offset);
        }

        // Navigate through each segment
        foreach ($segments as $segment) {
            $offset = $this->skipWhitespace($text, $offset);

            if ($offset >= strlen($text)) {
                return JsonLocation::unknown();
            }

            $char = $text[$offset];

            if ($char === '{') {
                // Object - find the property
                $offset = $this->findObjectProperty($text, $offset, $segment);
                if ($offset < 0) {
                    return JsonLocation::unknown();
                }
            } elseif ($char === '[') {
                // Array - find the index
                if (!ctype_digit($segment)) {
                    return JsonLocation::unknown();
                }
                $index = (int) $segment;
                $offset = $this->findArrayElement($text, $offset, $index);
                if ($offset < 0) {
                    return JsonLocation::unknown();
                }
            } else {
                // Not an object or array, can't navigate further
                return JsonLocation::unknown();
            }
        }

        return $this->offsetToLocation($offset);
    }

    /**
     * Skip whitespace characters.
     */
    private function skipWhitespace(string $text, int $offset): int
    {
        $length = strlen($text);
        while ($offset < $length && in_array($text[$offset], [' ', "\t", "\n", "\r"], true)) {
            $offset++;
        }
        return $offset;
    }

    /**
     * Skip a JSON string value and return the offset after the closing quote.
     */
    private function skipString(string $text, int $offset): int
    {
        $length = strlen($text);
        if ($offset >= $length || $text[$offset] !== '"') {
            return $offset;
        }

        $offset++; // Skip opening quote
        while ($offset < $length) {
            $char = $text[$offset];
            if ($char === '\\') {
                $offset += 2; // Skip escape sequence
            } elseif ($char === '"') {
                return $offset + 1; // Return position after closing quote
            } else {
                $offset++;
            }
        }
        return $offset;
    }

    /**
     * Skip a JSON value and return the offset after it.
     */
    private function skipValue(string $text, int $offset): int
    {
        $offset = $this->skipWhitespace($text, $offset);
        $length = strlen($text);

        if ($offset >= $length) {
            return $offset;
        }

        $char = $text[$offset];

        if ($char === '"') {
            return $this->skipString($text, $offset);
        }
        if ($char === '{') {
            return $this->skipObject($text, $offset);
        }
        if ($char === '[') {
            return $this->skipArray($text, $offset);
        }
        if (in_array($char, ['t', 'f', 'n'], true)) {
            // true, false, null
            foreach (['true', 'false', 'null'] as $keyword) {
                if (substr($text, $offset, strlen($keyword)) === $keyword) {
                    return $offset + strlen($keyword);
                }
            }
            return $offset;
        }
        if (str_contains('-0123456789', $char)) {
            // Number
            while ($offset < $length && str_contains('-+.0123456789eE', $text[$offset])) {
                $offset++;
            }
            return $offset;
        }

        return $offset;
    }

    /**
     * Skip an entire JSON object.
     */
    private function skipObject(string $text, int $offset): int
    {
        $length = strlen($text);
        if ($offset >= $length || $text[$offset] !== '{') {
            return $offset;
        }

        $offset++; // Skip opening brace
        $depth = 1;

        while ($offset < $length && $depth > 0) {
            $offset = $this->skipWhitespace($text, $offset);
            if ($offset >= $length) {
                break;
            }

            $char = $text[$offset];
            if ($char === '{') {
                $depth++;
                $offset++;
            } elseif ($char === '}') {
                $depth--;
                $offset++;
            } elseif ($char === '"') {
                $offset = $this->skipString($text, $offset);
            } else {
                $offset++;
            }
        }

        return $offset;
    }

    /**
     * Skip an entire JSON array.
     */
    private function skipArray(string $text, int $offset): int
    {
        $length = strlen($text);
        if ($offset >= $length || $text[$offset] !== '[') {
            return $offset;
        }

        $offset++; // Skip opening bracket
        $depth = 1;

        while ($offset < $length && $depth > 0) {
            $offset = $this->skipWhitespace($text, $offset);
            if ($offset >= $length) {
                break;
            }

            $char = $text[$offset];
            if ($char === '[') {
                $depth++;
                $offset++;
            } elseif ($char === ']') {
                $depth--;
                $offset++;
            } elseif ($char === '{') {
                $offset = $this->skipObject($text, $offset);
            } elseif ($char === '"') {
                $offset = $this->skipString($text, $offset);
            } else {
                $offset++;
            }
        }

        return $offset;
    }

    /**
     * Find a property in an object and return the offset of its value.
     */
    private function findObjectProperty(string $text, int $offset, string $propertyName): int
    {
        $length = strlen($text);
        if ($offset >= $length || $text[$offset] !== '{') {
            return -1;
        }

        $offset++; // Skip opening brace

        while ($offset < $length) {
            $offset = $this->skipWhitespace($text, $offset);

            if ($offset >= $length) {
                return -1;
            }

            if ($text[$offset] === '}') {
                return -1; // End of object, property not found
            }

            // Skip comma if present
            if ($text[$offset] === ',') {
                $offset++;
                $offset = $this->skipWhitespace($text, $offset);
            }

            // Expect a property name (string)
            if ($offset >= $length || $text[$offset] !== '"') {
                return -1;
            }

            // Parse the property name
            $nameStart = $offset + 1;
            $offset = $this->skipString($text, $offset);
            $nameEnd = $offset - 1; // Don't include closing quote
            $currentName = substr($text, $nameStart, $nameEnd - $nameStart);

            // Skip whitespace and colon
            $offset = $this->skipWhitespace($text, $offset);
            if ($offset >= $length || $text[$offset] !== ':') {
                return -1;
            }
            $offset++;
            $offset = $this->skipWhitespace($text, $offset);

            if ($currentName === $propertyName) {
                return $offset; // Return offset of the value
            }

            // Skip this value
            $offset = $this->skipValue($text, $offset);
        }

        return -1;
    }

    /**
     * Find an array element by index and return the offset of its value.
     */
    private function findArrayElement(string $text, int $offset, int $index): int
    {
        $length = strlen($text);
        if ($offset >= $length || $text[$offset] !== '[') {
            return -1;
        }

        $offset++; // Skip opening bracket
        $currentIndex = 0;

        while ($offset < $length) {
            $offset = $this->skipWhitespace($text, $offset);

            if ($offset >= $length) {
                return -1;
            }

            if ($text[$offset] === ']') {
                return -1; // End of array, index not found
            }

            // Skip comma if present
            if ($text[$offset] === ',') {
                $offset++;
                $offset = $this->skipWhitespace($text, $offset);
            }

            if ($currentIndex === $index) {
                return $offset; // Return offset of the element
            }

            // Skip this value
            $offset = $this->skipValue($text, $offset);
            $currentIndex++;
        }

        return -1;
    }
}
