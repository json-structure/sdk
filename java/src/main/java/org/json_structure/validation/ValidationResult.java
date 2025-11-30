// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

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
     * Adds a warning to the validation result.
     *
     * @param code     the warning code
     * @param message  the warning message
     * @param path     the JSON path where the warning occurred
     * @param location the source location
     */
    public void addWarning(String code, String message, String path, JsonLocation location) {
        errors.add(new ValidationError(code, message, path, ValidationSeverity.WARNING, location, null));
    }

    /**
     * Returns whether the validation succeeded (no errors, warnings don't affect validity).
     *
     * @return true if valid, false otherwise
     */
    public boolean isValid() {
        return errors.stream().noneMatch(e -> e.getSeverity() == ValidationSeverity.ERROR);
    }

    /**
     * Gets the list of all validation messages (both errors and warnings).
     *
     * @return an unmodifiable list of messages
     */
    public List<ValidationError> getErrors() {
        return Collections.unmodifiableList(errors);
    }

    /**
     * Gets only the errors (not warnings).
     *
     * @return an unmodifiable list of errors
     */
    public List<ValidationError> getErrorsOnly() {
        return errors.stream()
                .filter(e -> e.getSeverity() == ValidationSeverity.ERROR)
                .collect(Collectors.toUnmodifiableList());
    }

    /**
     * Gets only the warnings.
     *
     * @return an unmodifiable list of warnings
     */
    public List<ValidationError> getWarnings() {
        return errors.stream()
                .filter(e -> e.getSeverity() == ValidationSeverity.WARNING)
                .collect(Collectors.toUnmodifiableList());
    }

    /**
     * Gets the number of errors (not including warnings).
     *
     * @return the error count
     */
    public int getErrorCount() {
        return (int) errors.stream().filter(e -> e.getSeverity() == ValidationSeverity.ERROR).count();
    }

    /**
     * Gets the number of warnings.
     *
     * @return the warning count
     */
    public int getWarningCount() {
        return (int) errors.stream().filter(e -> e.getSeverity() == ValidationSeverity.WARNING).count();
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
