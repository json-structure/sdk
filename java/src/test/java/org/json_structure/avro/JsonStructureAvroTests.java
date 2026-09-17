package org.json_structure.avro;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.apache.avro.Schema;
import org.apache.avro.generic.GenericData;
import org.apache.avro.generic.GenericDatumReader;
import org.apache.avro.generic.GenericDatumWriter;
import org.apache.avro.generic.GenericRecord;
import org.apache.avro.io.DecoderFactory;
import org.apache.avro.io.Encoder;
import org.apache.avro.io.EncoderFactory;
import org.apache.avro.util.Utf8;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * The public seam, exercised the way the README tells people to use it.
 *
 * <p>The corpus tests go through {@link AvroCompiler} directly, which leaves the
 * entry points an application actually calls — the string, node and file
 * overloads — covered only by inference. A documented example that no longer
 * compiles is worse than no example.
 */
final class JsonStructureAvroTests {

    private static final String PERSON = """
        {
          "$schema": "https://json-structure.org/meta/core/v0/#",
          "$id": "https://example.com/person",
          "name": "Person",
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "age": { "type": "int32" }
          },
          "required": ["name", "age"]
        }
        """;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void compilesFromAString() {
        Schema schema = JsonStructureAvro.schemaFrom(PERSON);

        assertThat(schema.getName()).isEqualTo("Person");
        assertThat(schema.getFields().stream().map(Schema.Field::name))
            .containsExactly("name", "age");
    }

    @Test
    void compilesFromAParsedDocument() {
        assertThat(JsonStructureAvro.schemaFrom(parse(PERSON)))
            .isEqualTo(JsonStructureAvro.schemaFrom(PERSON));
    }

    @Test
    void compilesFromAFile() throws IOException {
        Path path = Files.createTempFile("person-", ".struct.json");
        try {
            Files.writeString(path, PERSON);
            assertThat(JsonStructureAvro.schemaFromFile(path))
                .isEqualTo(JsonStructureAvro.schemaFrom(PERSON));
        } finally {
            Files.deleteIfExists(path);
        }
    }

    /** The README's opening example, run rather than merely displayed. */
    @Test
    void writesAndReadsARecordThroughTheCompiledSchema() throws IOException {
        Schema schema = JsonStructureAvro.schemaFrom(PERSON);

        GenericRecord person = new GenericData.Record(schema);
        person.put("name", "Alice");
        person.put("age", 42);

        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        Encoder encoder = EncoderFactory.get().binaryEncoder(buffer, null);
        new GenericDatumWriter<GenericRecord>(schema).write(person, encoder);
        encoder.flush();

        byte[] bytes = buffer.toByteArray();
        assertThat(bytes).isNotEmpty();

        GenericRecord readBack = new GenericDatumReader<GenericRecord>(schema, schema)
            .read(null, DecoderFactory.get().binaryDecoder(bytes, null));

        // Avro's generic reader hands strings back as Utf8, not String.
        assertThat(readBack.get("name")).isEqualTo(new Utf8("Alice"));
        assertThat(readBack.get("age")).isEqualTo(42);
    }

    @Test
    void reportsTheOffendingPointerWhenTheDocumentCannotBeMapped() {
        Throwable thrown = catchThrowable(() -> JsonStructureAvro.schemaFrom("""
            {
              "$schema": "https://json-structure.org/meta/core/v0/#",
              "$id": "https://example.com/broken",
              "name": "Broken",
              "type": "object",
              "properties": {
                "who": { "type": { "$ref": "#/definitions/Nobody" } }
              },
              "required": ["who"]
            }
            """));

        assertThat(thrown).isInstanceOf(AvroCompileException.class);
        AvroCompileException failure = (AvroCompileException) thrown;
        assertThat(failure.kind()).isEqualTo(AvroErrorKind.UnresolvedRef);
        assertThat(failure.path()).isNotNull();
    }

    /** Losing something in the mapping is reported, not swallowed. */
    @Test
    void warnsWhereTheMappingLosesSomething() {
        AvroCompileResult result = AvroCompiler.compile(parse("""
            {
              "$schema": "https://json-structure.org/meta/core/v0/#",
              "$id": "https://example.com/tags",
              "name": "Tagged",
              "type": "object",
              "properties": {
                "tags": { "type": "set", "items": { "type": "string" } }
              },
              "required": ["tags"]
            }
            """));

        // Avro has no set type, so uniqueness stops being enforced by the schema.
        assertThat(result.warnings()).isNotEmpty();
        assertThat(result.warnings().get(0).toString()).contains("#/properties/tags");
    }

    /**
     * A semantic annotation that names properties is dropped, in both modes.
     *
     * <p>A corpus case pins this in {@code full} mode. The claim is that the
     * warning does not depend on the mode, and a corpus case cannot say that: it
     * carries one options file.
     */
    @ParameterizedTest(name = "{0}")
    @EnumSource(AvroMode.class)
    void dropsANameBindingAnnotationWithAWarningInBothModes(AvroMode mode) {
        AvroCompileResult result = AvroCompiler.compile(
            parse("""
                {
                  "$schema": "https://json-structure.org/meta/core/v0/#",
                  "$id": "https://example.com/track",
                  "name": "Track",
                  "type": "object",
                  "coordinateReferenceSystem": {
                    "reference": "http://www.opengis.net/def/crs/EPSG/0/4326",
                    "kind": "epsg",
                    "coordinates": ["lat", "lon"]
                  },
                  "properties": {
                    "lat": { "type": "double" },
                    "lon": { "type": "double" }
                  },
                  "required": ["lat", "lon"]
                }
                """),
            AvroOptions.builder().mode(mode).build());

        assertThat(result.warnings().stream().map(AvroWarning::toString))
            .anyMatch(warning -> warning.contains("coordinateReferenceSystem"));
        assertThat(result.schema().get("annotations")).isNull();
    }

    /**
     * The warning list and the emission list must not overlap, or every
     * annotated schema would produce noise.
     */
    @Test
    void doesNotWarnAboutAnAnnotationItCarries() {
        AvroCompileResult result = AvroCompiler.compile(
            parse("""
                {
                  "$schema": "https://json-structure.org/meta/core/v0/#",
                  "$id": "https://example.com/reading",
                  "$uses": ["JSONStructureUnits"],
                  "name": "Reading",
                  "type": "object",
                  "properties": { "distance": { "type": "double", "unit": "m" } },
                  "required": ["distance"]
                }
                """),
            AvroOptions.builder().mode(AvroMode.FULL).build());

        assertThat(result.warnings()).isEmpty();
        assertThat(result.schema().get("fields").get(0).get("annotations").get("unit").textValue())
            .isEqualTo("m");
    }

    @Test
    void rejectsANullSource() {
        assertThat(catchThrowable(() -> JsonStructureAvro.schemaFrom((String) null)))
            .isInstanceOf(NullPointerException.class);
    }

    /**
     * Two compilations do not share a parser.
     *
     * <p>Java's {@link Schema.Parser} remembers every named type it has ever
     * seen and rejects a second definition of one, so a shared parser would make
     * the second call to compile the same document fail. The facade mints a
     * fresh one per call; this is the test that says so.
     */
    @Test
    void compilesTheSameDocumentTwice() {
        assertThat(List.of(
                JsonStructureAvro.schemaFrom(PERSON), JsonStructureAvro.schemaFrom(PERSON)))
            .allSatisfy(schema -> assertThat(schema.getFullName()).isEqualTo("Person"));
    }

    private static JsonNode parse(String text) {
        try {
            return MAPPER.readTree(text);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
