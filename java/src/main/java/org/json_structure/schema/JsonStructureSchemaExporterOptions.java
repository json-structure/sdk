// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.schema;

/**
 * Options for controlling JSON Structure schema generation.
 */
public final class JsonStructureSchemaExporterOptions {

    private String schemaUri = "https://json-structure.org/meta/core/v0/#";
    private boolean includeSchemaKeyword = true;
    private boolean includeTitles = true;
    private boolean includeDescriptions = true;
    private boolean treatNullAsOptional = true;
    private boolean useExtendedValidation = false;
    private SchemaTransformer schemaTransformer = null;

    /**
     * Creates options with default values.
     */
    public JsonStructureSchemaExporterOptions() {
    }

    /**
     * Gets the schema URI to use. Defaults to JSON Structure core v0.
     * When {@link #isUseExtendedValidation()} is true, this is overridden to use the extended meta-schema.
     *
     * @return the schema URI
     */
    public String getSchemaUri() {
        return schemaUri;
    }

    /**
     * Sets the schema URI to use.
     *
     * @param schemaUri the schema URI
     * @return this options instance for chaining
     */
    public JsonStructureSchemaExporterOptions setSchemaUri(String schemaUri) {
        this.schemaUri = schemaUri;
        return this;
    }

    /**
     * Gets whether to include the $schema property.
     *
     * @return true if including $schema
     */
    public boolean isIncludeSchemaKeyword() {
        return includeSchemaKeyword;
    }

    /**
     * Sets whether to include the $schema property.
     *
     * @param includeSchemaKeyword true to include $schema
     * @return this options instance for chaining
     */
    public JsonStructureSchemaExporterOptions setIncludeSchemaKeyword(boolean includeSchemaKeyword) {
        this.includeSchemaKeyword = includeSchemaKeyword;
        return this;
    }

    /**
     * Gets whether to include titles.
     *
     * @return true if including titles
     */
    public boolean isIncludeTitles() {
        return includeTitles;
    }

    /**
     * Sets whether to include titles.
     *
     * @param includeTitles true to include titles
     * @return this options instance for chaining
     */
    public JsonStructureSchemaExporterOptions setIncludeTitles(boolean includeTitles) {
        this.includeTitles = includeTitles;
        return this;
    }

    /**
     * Gets whether to include descriptions.
     *
     * @return true if including descriptions
     */
    public boolean isIncludeDescriptions() {
        return includeDescriptions;
    }

    /**
     * Sets whether to include descriptions.
     *
     * @param includeDescriptions true to include descriptions
     * @return this options instance for chaining
     */
    public JsonStructureSchemaExporterOptions setIncludeDescriptions(boolean includeDescriptions) {
        this.includeDescriptions = includeDescriptions;
        return this;
    }

    /**
     * Gets whether nullable types should be treated as optional.
     *
     * @return true if nullable means optional
     */
    public boolean isTreatNullAsOptional() {
        return treatNullAsOptional;
    }

    /**
     * Sets whether nullable types should be treated as optional.
     *
     * @param treatNullAsOptional true if nullable means optional
     * @return this options instance for chaining
     */
    public JsonStructureSchemaExporterOptions setTreatNullAsOptional(boolean treatNullAsOptional) {
        this.treatNullAsOptional = treatNullAsOptional;
        return this;
    }

    /**
     * Gets whether to use extended validation keywords from the JSON Structure Validation extension.
     * When enabled, the schema will use the extended meta-schema URI and include a $uses clause
     * with "JSONStructureValidation". This enables additional validation keywords such as
     * minLength, pattern, format, minItems, maxItems, uniqueItems, contains, minProperties,
     * maxProperties, dependentRequired, patternProperties, propertyNames, and default.
     *
     * @return true if extended validation is enabled
     * @see <a href="https://json-structure.github.io/validation/draft-vasters-json-structure-validation.html">JSON Structure Validation Extension</a>
     */
    public boolean isUseExtendedValidation() {
        return useExtendedValidation;
    }

    /**
     * Sets whether to use extended validation keywords from the JSON Structure Validation extension.
     * When enabled, the schema will use the extended meta-schema URI and include a $uses clause
     * with "JSONStructureValidation". This enables additional validation keywords such as
     * minLength, pattern, format, minItems, maxItems, uniqueItems, contains, minProperties,
     * maxProperties, dependentRequired, patternProperties, propertyNames, and default.
     *
     * @param useExtendedValidation true to enable extended validation
     * @return this options instance for chaining
     * @see <a href="https://json-structure.github.io/validation/draft-vasters-json-structure-validation.html">JSON Structure Validation Extension</a>
     */
    public JsonStructureSchemaExporterOptions setUseExtendedValidation(boolean useExtendedValidation) {
        this.useExtendedValidation = useExtendedValidation;
        return this;
    }

    /**
     * Gets the schema transformer.
     *
     * @return the transformer, or null if not set
     */
    public SchemaTransformer getSchemaTransformer() {
        return schemaTransformer;
    }

    /**
     * Sets a callback to transform the generated schema.
     *
     * @param schemaTransformer the transformer
     * @return this options instance for chaining
     */
    public JsonStructureSchemaExporterOptions setSchemaTransformer(SchemaTransformer schemaTransformer) {
        this.schemaTransformer = schemaTransformer;
        return this;
    }

    /**
     * Functional interface for schema transformation.
     */
    @FunctionalInterface
    public interface SchemaTransformer {
        /**
         * Transforms a generated schema node.
         *
         * @param context the context for the schema being generated
         * @param schema  the generated schema
         * @return the transformed schema
         */
        com.fasterxml.jackson.databind.node.ObjectNode transform(
                JsonStructureSchemaExporterContext context,
                com.fasterxml.jackson.databind.node.ObjectNode schema);
    }
}
