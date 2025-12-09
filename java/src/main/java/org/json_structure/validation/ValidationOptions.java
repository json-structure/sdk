// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.validation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.function.Function;

/**
 * Options for controlling validation behavior.
 * <p>
 * <strong>Thread Safety:</strong> ValidationOptions instances should be configured once during
 * initialization and then treated as immutable. While setter methods are provided for convenience,
 * they should not be called after an instance is passed to a validator that may be used
 * concurrently. For thread-safe usage, configure all options before passing to validators,
 * or use the builder pattern (coming soon).
 * </p>
 * <p>
 * The {@link #DEFAULT} instance is safe for concurrent use as it is never modified after creation.
 * </p>
 */
public final class ValidationOptions {
    /**
     * Default validation options.
     * This instance is safe for concurrent use.
     */
    public static final ValidationOptions DEFAULT = new ValidationOptions();

    private int maxValidationDepth = 64;
    private boolean stopOnFirstError = false;
    private boolean strictFormatValidation = false;
    private boolean allowDollar = false;
    private boolean allowImport = false;
    private boolean warnOnUnusedExtensionKeywords = true;
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
     * <p>
     * <strong>Note:</strong> This method should only be called during initialization,
     * before the options instance is passed to a validator. Modifying options after
     * passing to a validator that is used concurrently may lead to unpredictable behavior.
     * </p>
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
     * <p>
     * <strong>Note:</strong> This method should only be called during initialization,
     * before the options instance is passed to a validator. Modifying options after
     * passing to a validator that is used concurrently may lead to unpredictable behavior.
     * </p>
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
     * <p>
     * <strong>Note:</strong> This method should only be called during initialization,
     * before the options instance is passed to a validator. Modifying options after
     * passing to a validator that is used concurrently may lead to unpredictable behavior.
     * </p>
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
     * <p>
     * <strong>Note:</strong> This method should only be called during initialization,
     * before the options instance is passed to a validator. Modifying options after
     * passing to a validator that is used concurrently may lead to unpredictable behavior.
     * </p>
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
     * <p>
     * <strong>Note:</strong> This method should only be called during initialization,
     * before the options instance is passed to a validator. Modifying options after
     * passing to a validator that is used concurrently may lead to unpredictable behavior.
     * </p>
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
     * <p>
     * <strong>Note:</strong> This method should only be called during initialization,
     * before the options instance is passed to a validator. Modifying options after
     * passing to a validator that is used concurrently may lead to unpredictable behavior.
     * </p>
     *
     * @param allowImport true to enable import processing
     * @return this options instance for chaining
     */
    public ValidationOptions setAllowImport(boolean allowImport) {
        this.allowImport = allowImport;
        return this;
    }

    /**
     * Gets whether to emit warnings when extension keywords are used without being enabled
     * via $schema or $uses. When true (default), the validator will emit warnings for validation
     * extension keywords (like minimum, maximum, minLength, maxLength, pattern, format, minItems,
     * maxItems, etc.) that are present in a schema but won't be enforced because the validation
     * extension is not enabled.
     *
     * @return true if warnings are enabled for unused extension keywords
     */
    public boolean isWarnOnUnusedExtensionKeywords() {
        return warnOnUnusedExtensionKeywords;
    }

    /**
     * Sets whether to emit warnings when extension keywords are used without being enabled
     * via $schema or $uses. When true (default), the validator will emit warnings for validation
     * extension keywords (like minimum, maximum, minLength, maxLength, pattern, format, minItems,
     * maxItems, etc.) that are present in a schema but won't be enforced because the validation
     * extension is not enabled. Set to false to suppress these warnings.
     * <p>
     * <strong>Note:</strong> This method should only be called during initialization,
     * before the options instance is passed to a validator. Modifying options after
     * passing to a validator that is used concurrently may lead to unpredictable behavior.
     * </p>
     *
     * <p>Extension keywords are optional features defined in JSON Structure Validation extension.
     * They require either the validation meta-schema or a $uses clause with "JSONStructureValidation"
     * to be enforced. Using them without enabling the extension means they will be ignored during
     * validation, which might not be the author's intent.</p>
     *
     * @param warnOnUnusedExtensionKeywords true to enable warnings
     * @return this options instance for chaining
     * @see <a href="https://json-structure.github.io/validation/draft-vasters-json-structure-validation.html">JSON Structure Validation Extension</a>
     */
    public ValidationOptions setWarnOnUnusedExtensionKeywords(boolean warnOnUnusedExtensionKeywords) {
        this.warnOnUnusedExtensionKeywords = warnOnUnusedExtensionKeywords;
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
     * <p>
     * <strong>Note:</strong> This method should only be called during initialization,
     * before the options instance is passed to a validator. Modifying options after
     * passing to a validator that is used concurrently may lead to unpredictable behavior.
     * </p>
     *
     * @param externalSchemas the map of URI to schema
     * @return this options instance for chaining
     */
    public ValidationOptions setExternalSchemas(Map<String, JsonNode> externalSchemas) {
        this.externalSchemas = externalSchemas;
        return this;
    }
}
