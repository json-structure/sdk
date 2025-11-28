// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import java.util.Objects;

/**
 * Represents a location in a JSON document with line and column information.
 */
public final class JsonLocation {
    /** An unknown location (line 0, column 0). */
    public static final JsonLocation UNKNOWN = new JsonLocation(0, 0);

    private final int line;
    private final int column;

    /**
     * Creates a new JsonLocation.
     *
     * @param line   the 1-based line number (0 for unknown)
     * @param column the 1-based column number (0 for unknown)
     */
    public JsonLocation(int line, int column) {
        this.line = line;
        this.column = column;
    }

    /**
     * Gets the 1-based line number.
     *
     * @return the line number, or 0 if unknown
     */
    public int getLine() {
        return line;
    }

    /**
     * Gets the 1-based column number.
     *
     * @return the column number, or 0 if unknown
     */
    public int getColumn() {
        return column;
    }

    /**
     * Returns true if the location is known (non-zero line and column).
     *
     * @return true if known, false otherwise
     */
    public boolean isKnown() {
        return line > 0 && column > 0;
    }

    @Override
    public String toString() {
        if (isKnown()) {
            return "(" + line + ":" + column + ")";
        }
        return "";
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;
        JsonLocation that = (JsonLocation) obj;
        return line == that.line && column == that.column;
    }

    @Override
    public int hashCode() {
        return Objects.hash(line, column);
    }
}
