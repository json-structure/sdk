// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
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
    private boolean allowDollar = false;
    private boolean allowImport = false;
    private Map<String, JsonNode> externalSchemas = null;
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

    /**
     * Gets whether $ is allowed in property names.
     *
     * @return true if $ is allowed in property names
     */
    public boolean isAllowDollar() {
        return allowDollar;
    }

    /**
     * Sets whether $ is allowed in property names (required for validating metaschemas).
     *
     * @param allowDollar true to allow $ in property names
     * @return this options instance for chaining
     */
    public ValidationOptions setAllowDollar(boolean allowDollar) {
        this.allowDollar = allowDollar;
        return this;
    }

    /**
     * Gets whether $import/$importdefs processing is enabled.
     *
     * @return true if import processing is enabled
     */
    public boolean isAllowImport() {
        return allowImport;
    }

    /**
     * Sets whether $import/$importdefs processing is enabled.
     *
     * @param allowImport true to enable import processing
     * @return this options instance for chaining
     */
    public ValidationOptions setAllowImport(boolean allowImport) {
        this.allowImport = allowImport;
        return this;
    }

    /**
     * Gets the external schemas for import resolution.
     *
     * @return the external schemas map, or null if not set
     */
    public Map<String, JsonNode> getExternalSchemas() {
        return externalSchemas;
    }

    /**
     * Sets the external schemas for import resolution.
     *
     * @param externalSchemas the map of URI to schema
     * @return this options instance for chaining
     */
    public ValidationOptions setExternalSchemas(Map<String, JsonNode> externalSchemas) {
        this.externalSchemas = externalSchemas;
        return this;
    }
}
