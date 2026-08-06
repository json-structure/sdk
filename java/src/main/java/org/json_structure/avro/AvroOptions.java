package org.json_structure.avro;

import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * Options that steer compilation without ever affecting a generated name.
 *
 * <p>Names and namespaces derive from the document alone. The document is the
 * source of truth and this is a translation of it, so there is deliberately no
 * option to override a namespace or rename a type — that belongs in the
 * document, where every target sees it.
 *
 * <p>Instances are immutable. Build one with {@link #builder()}, or start from
 * an existing one with {@link #toBuilder()}:
 *
 * <pre>{@code
 * AvroOptions options = AvroOptions.builder()
 *     .mode(AvroMode.FULL)
 *     .emitDoc(false)
 *     .build();
 * }</pre>
 */
public final class AvroOptions {

    private static final AvroOptions DEFAULT = builder().build();

    private final List<String> uses;
    private final AdditionalPropertiesPolicy additionalProperties;
    private final boolean emitDoc;
    private final AvroMode mode;

    private AvroOptions(Builder builder) {
        this.uses = List.copyOf(builder.uses);
        this.additionalProperties = builder.additionalProperties;
        this.emitDoc = builder.emitDoc;
        this.mode = builder.mode;
    }

    /**
     * The defaults: no add-ins, open records warn, documentation is carried,
     * {@code compact} mode.
     *
     * @return the shared default options
     */
    public static AvroOptions defaults() {
        return DEFAULT;
    }

    /**
     * Starts a fresh builder holding the defaults.
     *
     * @return a new builder
     */
    public static Builder builder() {
        return new Builder();
    }

    /**
     * Starts a builder holding this instance's settings.
     *
     * @return a new builder seeded from this instance
     */
    public Builder toBuilder() {
        return new Builder()
            .uses(uses)
            .additionalProperties(additionalProperties)
            .emitDoc(emitDoc)
            .mode(mode);
    }

    /**
     * Add-ins from {@code $offers} to apply, by name.
     *
     * @return an unmodifiable list of add-in names
     */
    public List<String> uses() {
        return uses;
    }

    /**
     * What to do about records that permit undeclared properties.
     *
     * @return the policy
     */
    public AdditionalPropertiesPolicy additionalProperties() {
        return additionalProperties;
    }

    /**
     * Whether {@code description} is carried across as Avro {@code doc}.
     *
     * @return true when documentation is emitted
     */
    public boolean emitDoc() {
        return emitDoc;
    }

    /**
     * How much the emitted schema describes. Wire-compatible either way.
     *
     * @return the mode
     */
    public AvroMode mode() {
        return mode;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof AvroOptions that)) {
            return false;
        }
        return emitDoc == that.emitDoc
            && mode == that.mode
            && additionalProperties == that.additionalProperties
            && uses.equals(that.uses);
    }

    @Override
    public int hashCode() {
        return Objects.hash(uses, additionalProperties, emitDoc, mode);
    }

    @Override
    public String toString() {
        return "AvroOptions[uses=" + uses
            + ", additionalProperties=" + additionalProperties
            + ", emitDoc=" + emitDoc
            + ", mode=" + mode + "]";
    }

    /** Builds an {@link AvroOptions}. */
    public static final class Builder {

        private List<String> uses = Collections.emptyList();
        private AdditionalPropertiesPolicy additionalProperties = AdditionalPropertiesPolicy.IGNORE;
        private boolean emitDoc = true;
        private AvroMode mode = AvroMode.COMPACT;

        private Builder() {
        }

        /**
         * Sets the add-ins from {@code $offers} to apply.
         *
         * @param value add-in names; the order does not affect the output
         * @return this builder
         */
        public Builder uses(List<String> value) {
            this.uses = List.copyOf(Objects.requireNonNull(value, "uses"));
            return this;
        }

        /**
         * Sets what to do about records that permit undeclared properties.
         *
         * @param value the policy
         * @return this builder
         */
        public Builder additionalProperties(AdditionalPropertiesPolicy value) {
            this.additionalProperties = Objects.requireNonNull(value, "additionalProperties");
            return this;
        }

        /**
         * Sets whether {@code description} is carried across as Avro {@code doc}.
         *
         * @param value true to emit documentation
         * @return this builder
         */
        public Builder emitDoc(boolean value) {
            this.emitDoc = value;
            return this;
        }

        /**
         * Sets how much the emitted schema describes.
         *
         * @param value the mode
         * @return this builder
         */
        public Builder mode(AvroMode value) {
            this.mode = Objects.requireNonNull(value, "mode");
            return this;
        }

        /**
         * Builds the options.
         *
         * @return an immutable {@link AvroOptions}
         */
        public AvroOptions build() {
            return new AvroOptions(this);
        }
    }
}
