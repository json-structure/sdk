// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Represents the result of a validation operation.
 */
public final class ValidationResult {
    private final List<ValidationError> errors;

    /**
     * Creates a new empty validation result (valid by default).
     */
    public ValidationResult() {
        this.errors = new ArrayList<>();
    }

    /**
     * Adds an error to the validation result.
     *
     * @param message the error message
     * @param path    the JSON path where the error occurred
     */
    public void addError(String message, String path) {
        // Use a generic error code for backward compatibility
        errors.add(new ValidationError("VALIDATION_ERROR", message, path));
    }

    /**
     * Adds an error with code to the validation result.
     *
     * @param code    the error code
     * @param message the error message
     * @param path    the JSON path where the error occurred
     */
    public void addError(String code, String message, String path) {
        errors.add(new ValidationError(code, message, path));
    }

    /**
     * Adds an error to the validation result.
     *
     * @param error the validation error
     */
    public void addError(ValidationError error) {
        errors.add(error);
    }

    /**
     * Returns whether the validation succeeded (no errors).
     *
     * @return true if valid, false otherwise
     */
    public boolean isValid() {
        return errors.isEmpty();
    }

    /**
     * Gets the list of validation errors.
     *
     * @return an unmodifiable list of errors
     */
    public List<ValidationError> getErrors() {
        return Collections.unmodifiableList(errors);
    }

    /**
     * Gets the number of errors.
     *
     * @return the error count
     */
    public int getErrorCount() {
        return errors.size();
    }

    /**
     * Creates a failure result with a single error.
     *
     * @param message the error message
     * @return a new ValidationResult with the error
     */
    public static ValidationResult failure(String message) {
        ValidationResult result = new ValidationResult();
        result.addError("VALIDATION_ERROR", message, "");
        return result;
    }

    /**
     * Creates a failure result with a single error at a specific path.
     *
     * @param message the error message
     * @param path    the JSON path
     * @return a new ValidationResult with the error
     */
    public static ValidationResult failure(String message, String path) {
        ValidationResult result = new ValidationResult();
        result.addError("VALIDATION_ERROR", message, path);
        return result;
    }

    /**
     * Creates a failure result with a single error with code at a specific path.
     *
     * @param code    the error code
     * @param message the error message
     * @param path    the JSON path
     * @return a new ValidationResult with the error
     */
    public static ValidationResult failure(String code, String message, String path) {
        ValidationResult result = new ValidationResult();
        result.addError(code, message, path);
        return result;
    }

    /**
     * Creates a successful validation result.
     *
     * @return a new valid ValidationResult
     */
    public static ValidationResult success() {
        return new ValidationResult();
    }

    @Override
    public String toString() {
        if (isValid()) {
            return "ValidationResult: Valid";
        }
        StringBuilder sb = new StringBuilder("ValidationResult: Invalid (");
        sb.append(errors.size()).append(" error(s))");
        for (ValidationError error : errors) {
            sb.append("\n  - ").append(error);
        }
        return sb.toString();
    }
}
