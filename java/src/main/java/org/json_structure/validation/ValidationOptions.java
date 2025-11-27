// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.function.Function;

/**
 * Options for controlling validation behavior.
 */
public final class ValidationOptions {
    /**
     * Default validation options.
     */
    public static final ValidationOptions DEFAULT = new ValidationOptions();

    private int maxValidationDepth = 64;
    private boolean stopOnFirstError = false;
    private boolean strictFormatValidation = false;
    private Function<String, JsonNode> referenceResolver = null;

    /**
     * Creates validation options with default values.
     */
    public ValidationOptions() {
    }

    /**
     * Gets the maximum depth for validation recursion.
     *
     * @return the maximum validation depth
     */
    public int getMaxValidationDepth() {
        return maxValidationDepth;
    }

    /**
     * Sets the maximum depth for validation recursion.
     *
     * @param maxValidationDepth the maximum depth
     * @return this options instance for chaining
     */
    public ValidationOptions setMaxValidationDepth(int maxValidationDepth) {
        this.maxValidationDepth = maxValidationDepth;
        return this;
    }

    /**
     * Gets whether validation should stop after the first error.
     *
     * @return true if stopping on first error
     */
    public boolean isStopOnFirstError() {
        return stopOnFirstError;
    }

    /**
     * Sets whether validation should stop after the first error.
     *
     * @param stopOnFirstError true to stop on first error
     * @return this options instance for chaining
     */
    public ValidationOptions setStopOnFirstError(boolean stopOnFirstError) {
        this.stopOnFirstError = stopOnFirstError;
        return this;
    }

    /**
     * Gets whether to strictly validate string formats.
     *
     * @return true if strict format validation is enabled
     */
    public boolean isStrictFormatValidation() {
        return strictFormatValidation;
    }

    /**
     * Sets whether to strictly validate string formats.
     *
     * @param strictFormatValidation true to enable strict format validation
     * @return this options instance for chaining
     */
    public ValidationOptions setStrictFormatValidation(boolean strictFormatValidation) {
        this.strictFormatValidation = strictFormatValidation;
        return this;
    }

    /**
     * Gets the reference resolver function.
     *
     * @return the reference resolver, or null if not set
     */
    public Function<String, JsonNode> getReferenceResolver() {
        return referenceResolver;
    }

    /**
     * Sets a function to resolve external references.
     *
     * @param referenceResolver the resolver function
     * @return this options instance for chaining
     */
    public ValidationOptions setReferenceResolver(Function<String, JsonNode> referenceResolver) {
        this.referenceResolver = referenceResolver;
        return this;
    }
}
