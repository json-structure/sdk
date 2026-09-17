package org.json_structure.avro;

/**
 * The kind of a fatal compilation problem.
 *
 * <p>A conformance harness asserts on this rather than on a substring of the
 * message, so that rewording an error does not silently turn a negative test
 * into one that passes for the wrong reason. The names match the Rust reference
 * implementation's error variants exactly, which is why they are camel case
 * rather than Java's usual shouting constants: the corpus records the reference
 * names verbatim, and a port that renamed them would have to translate on every
 * comparison — which is exactly the place a mistranslation would hide.
 */
public enum AvroErrorKind {
    /** The document has no root type and none was named. */
    NoRootType,

    /** A {@code $ref}, {@code $extends}, or {@code $offers} pointer does not resolve. */
    UnresolvedRef,

    /** The schema is not expressible in Avro, or is malformed. */
    Invalid,

    /** An {@code altnames}/{@code altenums} override is not a legal Avro name. */
    IllegalName,

    /** An add-in named in {@link AvroOptions#uses()} is not advertised by {@code $offers}. */
    UnknownAddIn,
}
