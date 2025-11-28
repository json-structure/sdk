// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

/**
 * Severity of a validation message.
 */
public enum ValidationSeverity {
    /** An error that must be fixed. */
    ERROR("error"),
    /** A warning that may indicate an issue. */
    WARNING("warning");

    private final String value;

    ValidationSeverity(String value) {
        this.value = value;
    }

    /**
     * Gets the string value of the severity.
     *
     * @return the severity value
     */
    public String getValue() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
