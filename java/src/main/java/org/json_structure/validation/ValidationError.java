// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import java.util.Objects;

/**
 * Represents a validation error with a message and location in the schema or instance.
 */
public final class ValidationError {
    private final String message;
    private final String path;

    /**
     * Creates a new validation error.
     *
     * @param message the error message
     * @param path    the JSON path where the error occurred
     */
    public ValidationError(String message, String path) {
        this.message = Objects.requireNonNull(message, "message cannot be null");
        this.path = Objects.requireNonNull(path, "path cannot be null");
    }

    /**
     * Gets the error message.
     *
     * @return the error message
     */
    public String getMessage() {
        return message;
    }

    /**
     * Gets the JSON path where the error occurred.
     *
     * @return the path
     */
    public String getPath() {
        return path;
    }

    @Override
    public String toString() {
        if (path.isEmpty()) {
            return message;
        }
        return path + ": " + message;
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;
        ValidationError that = (ValidationError) obj;
        return message.equals(that.message) && path.equals(that.path);
    }

    @Override
    public int hashCode() {
        return Objects.hash(message, path);
    }
}
