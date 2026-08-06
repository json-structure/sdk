package org.json_structure.avro;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import org.apache.avro.Schema;
import org.junit.jupiter.api.Test;

/**
 * The error paths of the Plain JSON decoder.
 *
 * <p>The corpus only carries instances that are meant to decode, so it exercises
 * none of the decoder's guards: mutating any of them away leaves the corpus
 * green. These tests hold those guards, and each one corresponds to a mutation
 * the corpus was measured against and failed to catch.
 */
final class AvroJsonTests {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static String rejects(String schema, String json) {
        Throwable thrown = catchThrowable(() -> AvroJson.decode(parseSchema(schema), parse(json)));
        assertThat(thrown).isInstanceOf(IllegalArgumentException.class);
        return thrown.getMessage();
    }

    /**
     * Two branches of the same shape are a decoding failure, not a race.
     *
     * <p>Plain JSON resolves a union by structure, so a union whose branches are
     * not structurally distinguishable cannot be decoded by anybody. Taking the
     * first match would hand back a plausible wrong answer instead of saying so.
     */
    @Test
    void refusesAUnionWhoseBranchesAreIndistinguishable() {
        assertThat(rejects(
            """
            ["null",
             {"type": "record", "name": "A", "fields": [{"name": "x", "type": "int"}]},
             {"type": "record", "name": "B", "fields": [{"name": "x", "type": "int"}]}]
            """,
            """
            {"x": 1}"""))
            .contains("ambiguous union");
    }

    /**
     * An unambiguous union still resolves. Without this, the test above is
     * satisfied by a decoder that rejects every union.
     */
    @Test
    void resolvesAUnionWhoseBranchesDiffer() {
        Schema schema = parseSchema(
            """
            ["null",
             {"type": "record", "name": "A", "fields": [{"name": "x", "type": "int"}]},
             {"type": "record", "name": "B", "fields": [{"name": "y", "type": "int"}]}]
            """);

        assertThat(AvroJson.decode(schema, parse("""
            {"y": 1}"""))).isNotNull();
        assertThat(AvroJson.decode(schema, parse("null"))).isNull();
    }

    /**
     * Only a field that can hold null may be left out.
     *
     * <p>Feature 5 lets a producer drop a null-valued property. Read too loosely,
     * that turns every absent required field into a silent null and Avro then
     * writes a record the schema does not describe.
     */
    @Test
    void refusesAnOmittedFieldThatCannotHoldNull() {
        assertThat(rejects(
            """
            {"type": "record", "name": "R", "fields": [{"name": "x", "type": "int"}]}""",
            "{}"))
            .contains("missing field 'x'");
    }

    @Test
    void acceptsAnOmittedFieldThatCanHoldNull() {
        Schema schema = parseSchema(
            """
            {"type": "record", "name": "R",
             "fields": [{"name": "x", "type": ["null", "int"]}]}
            """);

        assertThat(AvroJson.decode(schema, parse("{}"))).isNotNull();
    }

    /**
     * A decimal carrying more precision than the schema declares is rejected.
     *
     * <p>Avro stores a decimal as an unscaled integer at a fixed scale, so an
     * extra fraction digit has nowhere to go. Rounding it away would lose money
     * quietly, which is the one thing a decimal type exists to prevent.
     */
    @Test
    void refusesADecimalFinerThanItsScale() {
        assertThat(rejects(
            """
            {"type": "bytes", "logicalType": "decimal", "precision": 9, "scale": 2}""",
            "\"1.234\""))
            .contains("more than the schema's scale");
    }

    @Test
    void acceptsADecimalWithinItsScale() {
        Schema schema = parseSchema(
            """
            {"type": "bytes", "logicalType": "decimal", "precision": 9, "scale": 2}""");

        assertThat(AvroJson.decode(schema, parse("\"-1.2\""))).isNotNull();
    }

    /**
     * A long must be quoted, and bytes must be base64.
     *
     * <p>Both are places where Plain JSON deliberately departs from what a reader
     * might assume, so both are places a lenient decoder would paper over a
     * producer that got it wrong.
     */
    @Test
    void refusesAnUnquotedLongAndUnencodedBytes() {
        assertThat(rejects("\"long\"", "5000000000")).contains("a long as a quoted number");
        assertThat(rejects("\"bytes\"", "\"not base64!\"")).contains("base64 bytes");
    }

    /**
     * A uuid arrives as a string rather than as Avro's base-16 bytes.
     *
     * <p>Java's Avro runtime registers no conversions on {@link
     * org.apache.avro.generic.GenericData#get()}, so the decoder must hand the
     * writer the <em>base</em> representation. Anything else fails at write time
     * rather than at decode time, which is far harder to read.
     */
    @Test
    void decodesAUuidToItsBaseRepresentation() {
        Schema schema = parseSchema("""
            {"type": "string", "logicalType": "uuid"}""");

        assertThat(AvroJson.decode(schema, parse("\"8f14e45f-ceea-467a-9f9e-4f2b9a1c3d55\"")))
            .isEqualTo("8f14e45f-ceea-467a-9f9e-4f2b9a1c3d55");
        assertThat(rejects("""
            {"type": "string", "logicalType": "uuid"}""", "\"not-a-uuid\""))
            .contains("uuid string");
    }

    private static Schema parseSchema(String text) {
        return new Schema.Parser().parse(text);
    }

    private static JsonNode parse(String text) {
        try {
            return MAPPER.readTree(text);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
