// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import java.util.Objects;

/**
 * Represents a validation error with a code, message, and location information.
 */
public final class ValidationError {
    private final String code;
    private final String message;
    private final String path;
    private final ValidationSeverity severity;
    private final JsonLocation location;
    private final String schemaPath;

    /**
     * Creates a new validation error with code, message, and path.
     *
     * @param code    the error code
     * @param message the error message
     * @param path    the JSON path where the error occurred
     */
    public ValidationError(String code, String message, String path) {
        this(code, message, path, ValidationSeverity.ERROR, JsonLocation.UNKNOWN, null);
    }

    /**
     * Creates a new validation error with all fields.
     *
     * @param code       the error code
     * @param message    the error message
     * @param path       the JSON path where the error occurred
     * @param severity   the severity of the error
     * @param location   the source location (line/column)
     * @param schemaPath the path in the schema that caused the error
     */
    public ValidationError(String code, String message, String path, 
                          ValidationSeverity severity, JsonLocation location, String schemaPath) {
        this.code = Objects.requireNonNull(code, "code cannot be null");
        this.message = Objects.requireNonNull(message, "message cannot be null");
        this.path = path != null ? path : "";
        this.severity = severity != null ? severity : ValidationSeverity.ERROR;
        this.location = location != null ? location : JsonLocation.UNKNOWN;
        this.schemaPath = schemaPath;
    }

    /**
     * Gets the error code.
     *
     * @return the error code
     */
    public String getCode() {
        return code;
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

    /**
     * Gets the severity of the error.
     *
     * @return the severity
     */
    public ValidationSeverity getSeverity() {
        return severity;
    }

    /**
     * Gets the source location (line/column) of the error.
     *
     * @return the location
     */
    public JsonLocation getLocation() {
        return location;
    }

    /**
     * Gets the schema path that caused the error.
     *
     * @return the schema path, or null if not applicable
     */
    public String getSchemaPath() {
        return schemaPath;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder();
        
        if (!path.isEmpty()) {
            sb.append(path).append(" ");
        }
        
        if (location.isKnown()) {
            sb.append(location.toString()).append(" ");
        }
        
        sb.append("[").append(code).append("] ").append(message);
        
        if (schemaPath != null && !schemaPath.isEmpty()) {
            sb.append(" (schema: ").append(schemaPath).append(")");
        }
        
        return sb.toString();
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;
        ValidationError that = (ValidationError) obj;
        return code.equals(that.code) && 
               message.equals(that.message) && 
               path.equals(that.path) &&
               severity == that.severity &&
               location.equals(that.location) &&
               Objects.equals(schemaPath, that.schemaPath);
    }

    @Override
    public int hashCode() {
        return Objects.hash(code, message, path, severity, location, schemaPath);
    }
}
