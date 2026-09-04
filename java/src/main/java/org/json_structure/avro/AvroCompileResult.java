package org.json_structure.avro;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Objects;

/**
 * The result of a compilation: the schema, and everything that did not survive
 * the trip intact.
 *
 * @param schema   the Avro schema, as a JSON document
 * @param warnings what the target could not express, in emission order
 */
public record AvroCompileResult(JsonNode schema, List<AvroWarning> warnings) {

    /** @throws NullPointerException if either component is null */
    public AvroCompileResult {
        Objects.requireNonNull(schema, "schema");
        warnings = List.copyOf(Objects.requireNonNull(warnings, "warnings"));
    }
}
