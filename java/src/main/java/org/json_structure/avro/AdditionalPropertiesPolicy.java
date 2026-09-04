package org.json_structure.avro;

/**
 * How the compiler treats a record that permits undeclared properties.
 *
 * <p>Avro records are closed. A JSON Structure type that allows additional
 * properties therefore cannot be carried faithfully, and the only question is
 * whether that is worth stopping for.
 */
public enum AdditionalPropertiesPolicy {
    /** Warn and drop the undeclared properties. The default. */
    IGNORE,

    /** Fail the compilation. */
    ERROR,
}
