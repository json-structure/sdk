package org.json_structure.avro;

/**
 * How much of the source document the emitted schema describes.
 *
 * <p>The two modes are <b>wire-compatible</b>. Every value takes the same Avro
 * base type under both, so the same datum encodes to the same bytes and a
 * schema compiled in one mode reads data written under the other. Turning
 * {@link #FULL} on for a deployed schema changes what the schema says, never
 * what the bytes mean.
 *
 * <p>That is only possible because the temporal annotations are Avrotize's
 * {@code rfc3339-*} names over a {@code string} base. Avro's own {@code date}
 * and {@code timestamp-micros} would move the value onto an integer base and
 * throw the RFC 3339 offset away.
 */
public enum AvroMode {
    /** Base types only. The default: the smallest schema that carries the data. */
    COMPACT,

    /**
     * Adds {@code logicalType} annotations, and carries the constraints, units
     * and semantic annotations Avro cannot express in an {@code annotations}
     * attribute. Nothing else changes.
     *
     * <p>Unlike .NET's Apache.Avro, the Java Avro runtime ignores a
     * {@code logicalType} it does not recognize rather than throwing, so a
     * schema emitted in this mode parses without any registration step.
     */
    FULL,
}
