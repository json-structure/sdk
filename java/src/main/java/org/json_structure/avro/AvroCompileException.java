package org.json_structure.avro;

/**
 * A JSON Structure document that cannot be represented as an Avro schema.
 *
 * <p>The compiler is loud about what Avro cannot express rather than quietly
 * lossy, so these are thrown for genuine impossibilities. Everything that is
 * merely imprecise — a set losing its uniqueness, a {@code const} losing its
 * enforcement — is an {@link AvroWarning} instead.
 *
 * <p>Unchecked, because it reports a defect in the input document rather than a
 * condition a caller can recover from: the fix is to edit the schema, not to
 * catch and retry.
 */
public final class AvroCompileException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final AvroErrorKind kind;
    private final String path;

    AvroCompileException(AvroErrorKind kind, String message, String path) {
        super(path == null ? message : message + " (at " + path + ")");
        this.kind = kind;
        this.path = path;
    }

    /**
     * Which problem this is.
     *
     * @return the error variant
     */
    public AvroErrorKind kind() {
        return kind;
    }

    /**
     * JSON Pointer of the offending node, where the kind carries one.
     *
     * @return the pointer, or null
     */
    public String path() {
        return path;
    }

    static AvroCompileException noRootType() {
        return new AvroCompileException(
            AvroErrorKind.NoRootType,
            "document declares neither `type` nor `$root`; nothing to compile",
            null);
    }

    static AvroCompileException unresolvedRef(String pointer, String path) {
        return new AvroCompileException(
            AvroErrorKind.UnresolvedRef, "cannot resolve '" + pointer + "'", path);
    }

    static AvroCompileException invalid(String message, String path) {
        return new AvroCompileException(AvroErrorKind.Invalid, message, path);
    }

    static AvroCompileException illegalName(String name, String path) {
        return new AvroCompileException(
            AvroErrorKind.IllegalName, "'" + name + "' is not a legal Avro name", path);
    }

    static AvroCompileException unknownAddIn(String name) {
        return new AvroCompileException(
            AvroErrorKind.UnknownAddIn,
            "add-in '" + name + "' is not offered by this schema",
            null);
    }
}
