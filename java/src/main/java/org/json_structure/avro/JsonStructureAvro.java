package org.json_structure.avro;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Objects;
import org.apache.avro.Schema;

/**
 * Loads a JSON Structure document as a ready-to-use Apache Avro schema.
 *
 * <p>This is the seam that makes the {@code .avsc} disappear. Wherever an
 * application would have called {@code new Schema.Parser().parse(avsc)} on a
 * hand-maintained {@code .avsc}, it calls {@link #schemaFrom(String)} on its
 * JSON Structure document instead, and everything downstream — the datum
 * writers, the readers, the file writers — is unchanged.
 *
 * <p>The type name carries the qualification rather than the method name,
 * because Java resolves types by simple name after an import: a bare
 * {@code schemaFrom} would say nothing at the call site about what it replaces.
 *
 * <pre>{@code
 * Schema schema = JsonStructureAvro.schemaFrom(personStructJson);
 *
 * GenericRecord record = new GenericData.Record(schema);
 * record.put("name", "Alice");
 *
 * ByteArrayOutputStream buffer = new ByteArrayOutputStream();
 * new GenericDatumWriter<GenericRecord>(schema)
 *     .write(record, EncoderFactory.get().binaryEncoder(buffer, null));
 * }</pre>
 *
 * <p>Compilation is cheap but not free, and a schema embedded in the jar is
 * compiled from the same bytes every time. It costs a few microseconds per
 * declared property and is linear in document size, which is nothing once and a
 * great deal per message — so hold the result in a {@code static final} field or
 * behind a memoizing supplier rather than calling this per operation.
 *
 * <p><b>On {@code full} mode and logical types.</b> The {@code rfc3339-*} names
 * that {@link AvroMode#FULL} emits are not in the Avro specification. Avro tells
 * a parser to ignore a {@code logicalType} it does not recognize, and the Java
 * runtime does exactly that, so no registration step is needed here — unlike
 * .NET, where Apache.Avro throws instead. The consequence is that a value
 * annotated {@code rfc3339-timestamp-micros} reaches a datum reader as the plain
 * {@code string} it is on the wire, which is the same thing {@code compact} mode
 * would have handed over.
 *
 * <p>This class needs {@code org.apache.avro:avro} on the classpath. The
 * dependency is declared optional, so add it explicitly. {@link AvroCompiler}
 * produces the schema document without it.
 */
public final class JsonStructureAvro {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private JsonStructureAvro() {
    }

    /**
     * Compiles a JSON Structure document from a string.
     *
     * @param source the document text
     * @return the parsed Avro schema
     * @throws AvroCompileException the document cannot be represented in Avro
     */
    public static Schema schemaFrom(String source) {
        return schemaFrom(source, AvroOptions.defaults());
    }

    /**
     * Compiles a JSON Structure document from a string, with options.
     *
     * @param source  the document text
     * @param options compilation options
     * @return the parsed Avro schema
     * @throws AvroCompileException the document cannot be represented in Avro
     */
    public static Schema schemaFrom(String source, AvroOptions options) {
        Objects.requireNonNull(source, "source");
        return schemaFrom(parse(source), options);
    }

    /**
     * Compiles an already-parsed JSON Structure document.
     *
     * @param document the document
     * @return the parsed Avro schema
     * @throws AvroCompileException the document cannot be represented in Avro
     */
    public static Schema schemaFrom(JsonNode document) {
        return schemaFrom(document, AvroOptions.defaults());
    }

    /**
     * Compiles an already-parsed JSON Structure document, with options.
     *
     * @param document the document
     * @param options  compilation options
     * @return the parsed Avro schema
     * @throws AvroCompileException the document cannot be represented in Avro
     */
    public static Schema schemaFrom(JsonNode document, AvroOptions options) {
        JsonNode compiled = AvroCompiler.compile(document, options).schema();
        // A fresh parser per call: Schema.Parser remembers every name it has
        // seen, so a shared one would reject the second schema that declares a
        // type it already knows.
        return new Schema.Parser().parse(Js.compact(compiled));
    }

    /**
     * Compiles a JSON Structure document read from disk.
     *
     * @param path path to the document
     * @return the parsed Avro schema
     * @throws AvroCompileException the document cannot be represented in Avro
     * @throws UncheckedIOException  the file cannot be read
     */
    public static Schema schemaFromFile(Path path) {
        return schemaFromFile(path, AvroOptions.defaults());
    }

    /**
     * Compiles a JSON Structure document read from disk, with options.
     *
     * @param path    path to the document
     * @param options compilation options
     * @return the parsed Avro schema
     * @throws AvroCompileException the document cannot be represented in Avro
     * @throws UncheckedIOException  the file cannot be read
     */
    public static Schema schemaFromFile(Path path, AvroOptions options) {
        Objects.requireNonNull(path, "path");
        try {
            return schemaFrom(Files.readString(path, StandardCharsets.UTF_8), options);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read " + path, e);
        }
    }

    private static JsonNode parse(String source) {
        try {
            JsonNode document = MAPPER.readTree(source);
            if (document == null || document.isMissingNode()) {
                throw AvroCompileException.invalid(
                    "schema document must be a JSON object", "#");
            }
            return document;
        } catch (JsonProcessingException e) {
            throw AvroCompileException.invalid(
                "schema document is not well-formed JSON: " + e.getOriginalMessage(), "#");
        }
    }
}
