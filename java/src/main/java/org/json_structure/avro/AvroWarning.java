package org.json_structure.avro;

import java.util.Objects;

/**
 * Something the target could not express, reported rather than dropped.
 *
 * <p>A warning is a promise that something did not survive the translation. The
 * conformance corpus asserts the exact set for every case, because an
 * unasserted warning is free to stop being emitted.
 *
 * @param path    JSON Pointer of the schema node that lost information
 * @param message what was lost
 */
public record AvroWarning(String path, String message) {

    /** @throws NullPointerException if either component is null */
    public AvroWarning {
        Objects.requireNonNull(path, "path");
        Objects.requireNonNull(message, "message");
    }

    /** Renders as {@code pointer: message}, the corpus wire format. */
    @Override
    public String toString() {
        return path + ": " + message;
    }
}
