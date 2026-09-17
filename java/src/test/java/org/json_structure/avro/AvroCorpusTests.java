package org.json_structure.avro;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.apache.avro.Schema;
import org.apache.avro.generic.GenericDatumReader;
import org.apache.avro.generic.GenericDatumWriter;
import org.apache.avro.io.DecoderFactory;
import org.apache.avro.io.Encoder;
import org.apache.avro.io.EncoderFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * The Avro conformance corpus, run against this implementation.
 *
 * <p>The corpus under {@code test-assets/avro/} is shared by every SDK, and its
 * README defines the checks a conforming harness must implement. All of them are
 * here. The point of the exercise is that this implementation and the Rust
 * reference agree byte for byte — a port that merely produces "valid Avro" would
 * be a second dialect, not a second implementation.
 */
final class AvroCorpusTests {

    static Stream<String> validCases() {
        return caseNames("valid").stream();
    }

    static Stream<String> invalidCases() {
        return caseNames("invalid").stream();
    }

    /** Check 1: the compiled schema matches the expected file, byte for byte. */
    @ParameterizedTest(name = "{0}")
    @MethodSource("validCases")
    void compilesToTheExpectedSchema(String name) {
        Path dir = caseDir("valid", name);
        AvroCompileResult result = AvroCompiler.compile(readDocument(dir), readOptions(dir));
        String actual = AvroCompiler.toAvsc(result.schema());
        String expected = normalize(read(dir.resolve("expected.avsc")));

        assertThat(actual)
            .as("case '%s' does not match its expected .avsc. Attribute order is part of the "
                + "contract (spec §7), so a difference here is a real divergence even if the "
                + "parsed JSON would compare equal.", name)
            .isEqualTo(expected);
    }

    /**
     * Check 2: compiling the same input ten times produces the same bytes.
     *
     * <p>This is not paranoia about the compiler being non-deterministic on
     * purpose. It catches the ordinary way determinism dies: an unordered
     * collection somewhere on the naming path, whose iteration order happens to
     * be stable within one process run and is not stable across them.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("validCases")
    void compilesDeterministically(String name) {
        Path dir = caseDir("valid", name);
        JsonNode document = readDocument(dir);
        AvroOptions options = readOptions(dir);

        String first = AvroCompiler.toAvsc(AvroCompiler.compile(document, options).schema());
        for (int run = 0; run < 10; run++) {
            assertThat(AvroCompiler.toAvsc(AvroCompiler.compile(document, options).schema()))
                .as("case '%s' compiled differently on run %d", name, run)
                .isEqualTo(first);
        }
    }

    /** Check 3: a real Avro parser accepts the output. */
    @ParameterizedTest(name = "{0}")
    @MethodSource("validCases")
    void producesSchemaTheAvroLibraryAccepts(String name) {
        Path dir = caseDir("valid", name);
        assertThat(JsonStructureAvro.schemaFrom(readDocument(dir), readOptions(dir))).isNotNull();
    }

    /**
     * Check 4: an instance written by hand survives a real write and read.
     *
     * <p>This is the one check a blessed expected file cannot perform.
     * {@code expected.avsc} proves this implementation agrees with the reference;
     * it cannot prove the reference is right, because the expected file was
     * blessed from it. The instance is written against what the <em>source
     * document</em> means, so a schema that is self-consistent but wrong fails
     * here.
     *
     * <p>The bytes are then compared against {@code expected.avro.b64}, which the
     * Rust harness blessed from the same instance. That is what keeps this
     * honest: a round trip only proves this SDK agrees with itself, while the
     * pinned bytes prove the two SDKs read the same instance the same way and
     * hand Avro the same datum. Cases containing a {@code map} are exempt,
     * because Avro writes map entries in iteration order and no two
     * implementations need agree on it.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("validCases")
    void roundTripsItsInstanceThroughAvro(String name) {
        roundTrip(name, new int[2]);
    }

    private void roundTrip(String name, int[] tally) {
        Path dir = caseDir("valid", name);
        Path instancePath = dir.resolve("instance.avro.json");
        assertThat(Files.exists(instancePath))
            .as("case '%s' has no instance.avro.json, so its schema is never asked to carry "
                + "data. Every valid case must have one.", name)
            .isTrue();

        Schema schema = JsonStructureAvro.schemaFrom(readDocument(dir), readOptions(dir));
        JsonNode instance = parse(normalize(read(instancePath)).trim());

        Object datum = AvroJson.decode(schema, instance);
        byte[] bytes = writeBinary(schema, datum);

        Object readBack = readBinary(schema, bytes);
        assertThat(writeBinary(schema, readBack))
            .as("case '%s' did not survive a binary write, read and rewrite", name)
            .isEqualTo(bytes);

        String pinned = pinnedBytes(dir);
        if (pinned != null) {
            assertThat(Base64.getEncoder().encodeToString(bytes))
                .as("case '%s' encoded to different bytes than expected.avro.b64, which the "
                    + "Rust harness blessed from the same instance. Either the two decoders "
                    + "read the Plain JSON encoding differently, or the two compilers emit "
                    + "different schemas", name)
                .isEqualTo(pinned);
            tally[0]++;
        } else {
            assertThat(containsMap(schema))
                .as("case '%s' has no expected.avro.b64 but contains no map either. Only "
                    + "map-bearing cases may skip the pinned bytes; pin the rest from the "
                    + "Rust harness", name)
                .isTrue();
            tally[1]++;
        }
    }

    /**
     * The pinned-bytes check has not quietly stopped happening.
     *
     * <p>A check wrapped in "if there is an expected file for it" degrades
     * silently to no check at all when the expected files go missing, so both
     * sides of that condition are counted and asserted. The same trap has fired
     * twice in this corpus already.
     */
    @Test
    void pinsTheEncodedBytesOfMostInstances() {
        int[] tally = new int[2];
        for (String name : caseNames("valid")) {
            roundTrip(name, tally);
        }

        assertThat(tally[0]).as("no case pinned its encoded bytes").isGreaterThan(0);
        assertThat(tally[1])
            .as("no case contains a map any more, so the exemption above is dead code")
            .isGreaterThan(0);
    }

    /**
     * Check 5: the emitted warnings match, in emission order.
     *
     * <p>A warning is a promise that something was lost. Unasserted, it is free
     * to stop being made.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("validCases")
    void emitsTheExpectedWarnings(String name) {
        Path dir = caseDir("valid", name);
        AvroCompileResult result = AvroCompiler.compile(readDocument(dir), readOptions(dir));
        List<String> actual = result.warnings().stream().map(AvroWarning::toString).toList();

        assertThat(actual)
            .as("case '%s' emitted a different set of warnings", name)
            .isEqualTo(expectedWarnings(dir));
    }

    /** Check 6: every negative case fails with the recorded kind, pointer and message. */
    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidCases")
    void failsWithTheExpectedError(String name) {
        Path dir = caseDir("invalid", name);
        Map<String, String> expected = readExpectedError(dir);

        AvroCompileException thrown = null;
        try {
            AvroCompiler.compile(readDocument(dir), readOptions(dir));
        } catch (AvroCompileException e) {
            thrown = e;
        }

        assertThat(thrown)
            .as("case '%s' was expected to fail with %s", name, expected.get("kind"))
            .isNotNull();

        assertThat(thrown.kind().toString())
            .as("case '%s' raised the wrong error kind", name)
            .isEqualTo(expected.get("kind"));
        assertThat(thrown.path())
            .as("case '%s' reported the wrong JSON Pointer", name)
            .isEqualTo(expected.get("path"));
        assertThat(thrown.getMessage())
            .as("case '%s' reported the wrong message", name)
            .isEqualTo(expected.get("message"));
    }

    /**
     * The corpus is not empty and has not shrunk unnoticed.
     *
     * <p>A harness that discovers its own cases will pass perfectly while running
     * none of them if the discovery ever breaks.
     */
    @Test
    void findsTheWholeCorpus() {
        assertThat(caseNames("valid")).hasSizeGreaterThanOrEqualTo(42);
        assertThat(caseNames("invalid")).hasSizeGreaterThanOrEqualTo(10);
    }

    /**
     * {@code full} mode adds metadata and changes nothing else.
     *
     * <p>Strip everything the mode is allowed to add — {@code doc}, the
     * {@code annotations} attribute, and a {@code logicalType} that is not
     * {@code decimal}, which §2.3 emits in both modes — and the two schemas must
     * be the same bytes. Anything left over is a wire change the mode was never
     * allowed to make.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("validCases")
    void fullModeOnlyAddsMetadata(String name) {
        Path dir = caseDir("valid", name);
        JsonNode document = readDocument(dir);
        AvroOptions options = readOptions(dir);

        AvroCompileResult compact =
            AvroCompiler.compile(document, options.toBuilder().mode(AvroMode.COMPACT).build());
        AvroCompileResult full =
            AvroCompiler.compile(document, options.toBuilder().mode(AvroMode.FULL).build());

        assertThat(AvroCompiler.toAvsc(strip(full.schema())))
            .as("case '%s': full mode changed the wire format, not just the metadata", name)
            .isEqualTo(AvroCompiler.toAvsc(strip(compact.schema())));

        // Warnings describe lost information, which is a property of the
        // document rather than of how much metadata was asked for.
        assertThat(full.warnings().stream().map(AvroWarning::toString).toList())
            .as("case '%s': the two modes disagreed about what was lost", name)
            .isEqualTo(compact.warnings().stream().map(AvroWarning::toString).toList());
    }

    /**
     * Rebuilds {@code value} without anything {@code full} mode is allowed to
     * add — {@code doc}, the {@code annotations} attribute, and a
     * non-{@code decimal} {@code logicalType}.
     */
    private static JsonNode strip(JsonNode value) {
        if (value instanceof ArrayNode items) {
            ArrayNode out = MAPPER.createArrayNode();
            for (JsonNode item : items) {
                out.add(strip(item));
            }
            return out;
        }

        if (!(value instanceof ObjectNode map)) {
            return value;
        }

        ObjectNode out = MAPPER.createObjectNode();
        Iterator<Map.Entry<String, JsonNode>> entries = map.fields();
        while (entries.hasNext()) {
            Map.Entry<String, JsonNode> entry = entries.next();
            String key = entry.getKey();
            if (key.equals("doc") || key.equals("annotations")) {
                continue;
            }
            // `decimal` is not a `full`-mode annotation -- §2.3 emits it in both
            // modes -- so it and its `precision` and `scale` stay.
            if (key.equals("logicalType") && !"decimal".equals(entry.getValue().asText(null))) {
                continue;
            }
            out.set(key, strip(entry.getValue()));
        }

        // An annotation-only object collapses back to its base type, which is
        // how `compact` would have written it in the first place.
        if (out.size() == 1 && out.get("type") != null && out.get("type").isTextual()) {
            return TextNode.valueOf(out.get("type").textValue());
        }
        return out;
    }

    /**
     * The wire-compatibility claim, proved on bytes rather than schema shape.
     *
     * <p>{@link #fullModeOnlyAddsMetadata} checks that the two schemas
     * <i>look</i> the same once annotations are stripped. This checks what
     * actually matters: that the same value encodes to the same bytes under both
     * modes. If that holds, turning {@code full} on for a deployed schema is
     * safe, which is the whole promise.
     *
     * <p>Java's Avro runtime drops a {@code logicalType} it does not recognize,
     * so the {@code rfc3339-*} family collapses into plain schema equality and
     * only the cases carrying {@code doc} or {@code annotations} reach the byte
     * comparison. That is still the claim worth proving.
     */
    @Test
    void theTwoModesEncodeIdenticalBytes() {
        int compared = 0;

        for (String name : caseNames("valid")) {
            Path dir = caseDir("valid", name);
            JsonNode document = readDocument(dir);
            AvroOptions options = readOptions(dir);

            Schema compact = JsonStructureAvro.schemaFrom(
                document, options.toBuilder().mode(AvroMode.COMPACT).build());
            Schema full = JsonStructureAvro.schemaFrom(
                document, options.toBuilder().mode(AvroMode.FULL).build());
            if (compact.toString().equals(full.toString())) {
                continue;
            }
            compared++;

            JsonNode json = parse(normalize(read(dir.resolve("instance.avro.json"))).trim());

            assertThat(writeBinary(full, AvroJson.decode(full, json)))
                .as("case '%s': the two modes encoded the same value to different bytes", name)
                .isEqualTo(writeBinary(compact, AvroJson.decode(compact, json)));
        }

        assertThat(compared)
            .as("no case exercises a difference between the modes, so this test proves nothing")
            .isGreaterThan(0);
    }

    // -- Avro plumbing ---------------------------------------------------------

    /** The pinned encoding for a case, or {@code null} if it is map-exempt. */
    private static String pinnedBytes(Path dir) {
        Path path = dir.resolve("expected.avro.b64");
        if (!Files.exists(path)) {
            return null;
        }
        String base64 = read(path).trim();
        return base64.isEmpty() ? null : base64;
    }

    private static byte[] writeBinary(Schema schema, Object datum) {
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            Encoder encoder = EncoderFactory.get().binaryEncoder(buffer, null);
            new GenericDatumWriter<>(schema).write(datum, encoder);
            encoder.flush();
            return buffer.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static Object readBinary(Schema schema, byte[] bytes) {
        try {
            return new GenericDatumReader<>(schema, schema)
                .read(null, DecoderFactory.get().binaryDecoder(bytes, null));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /**
     * Whether a schema contains a {@code map} anywhere, and so has no stable byte
     * encoding. Walking the serialized JSON is simpler, and more obviously
     * exhaustive, than walking every {@link Schema.Type}.
     */
    private static boolean containsMap(Schema schema) {
        return walkForMap(parse(schema.toString()));
    }

    private static boolean walkForMap(JsonNode node) {
        if (node.isObject()) {
            JsonNode type = node.get("type");
            if (type != null && type.isTextual() && type.textValue().equals("map")) {
                return true;
            }
            for (JsonNode child : node) {
                if (walkForMap(child)) {
                    return true;
                }
            }
            return false;
        }
        if (node.isArray()) {
            for (JsonNode child : node) {
                if (walkForMap(child)) {
                    return true;
                }
            }
        }
        return false;
    }

    // -- corpus plumbing -------------------------------------------------------

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static List<String> caseNames(String group) {
        try (Stream<Path> dirs = Files.list(CORPUS_ROOT.resolve(group))) {
            return dirs.filter(Files::isDirectory)
                .map(path -> path.getFileName().toString())
                .sorted(Comparator.naturalOrder())
                .toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static Path caseDir(String group, String name) {
        return CORPUS_ROOT.resolve(group).resolve(name);
    }

    private static JsonNode readDocument(Path dir) {
        return parse(read(dir.resolve("schema.struct.json")));
    }

    private static AvroOptions readOptions(Path dir) {
        Path path = dir.resolve("options.json");
        if (!Files.exists(path)) {
            return AvroOptions.defaults();
        }

        JsonNode node = parse(read(path));

        List<String> uses = new ArrayList<>();
        JsonNode usesNode = node.get("uses");
        if (usesNode != null && usesNode.isArray()) {
            usesNode.forEach(item -> uses.add(item.textValue()));
        }

        AdditionalPropertiesPolicy additional =
            "error".equals(text(node, "additionalProperties"))
                ? AdditionalPropertiesPolicy.ERROR
                : AdditionalPropertiesPolicy.IGNORE;

        JsonNode emitDoc = node.get("emitDoc");
        AvroMode mode = "full".equals(text(node, "mode")) ? AvroMode.FULL : AvroMode.COMPACT;

        return AvroOptions.builder()
            .uses(uses)
            .additionalProperties(additional)
            .emitDoc(emitDoc == null || emitDoc.booleanValue())
            .mode(mode)
            .build();
    }

    private static String text(JsonNode node, String key) {
        JsonNode value = node.get(key);
        return value == null || !value.isTextual() ? null : value.textValue();
    }

    private static List<String> expectedWarnings(Path dir) {
        Path path = dir.resolve("expected-warnings.txt");
        if (!Files.exists(path)) {
            return List.of();
        }
        return normalize(read(path)).lines()
            .filter(line -> !line.isEmpty())
            .map(String::stripTrailing)
            .toList();
    }

    private static Map<String, String> readExpectedError(Path dir) {
        Map<String, String> fields = new java.util.LinkedHashMap<>();
        for (String line : normalize(read(dir.resolve("expected-error.txt"))).split("\n")) {
            int cut = line.indexOf(':');
            if (cut < 0) {
                continue;
            }
            fields.put(line.substring(0, cut).trim(), line.substring(cut + 1).trim());
        }

        if (!fields.containsKey("kind")) {
            fail("%s has no `kind:` line", dir);
        }
        if (!fields.containsKey("message")) {
            fail("%s has no `message:` line", dir);
        }
        return fields;
    }

    private static JsonNode parse(String text) {
        try {
            return MAPPER.readTree(text);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String read(Path path) {
        try {
            return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /**
     * Corpus files are stored with LF endings; git may hand them back with CRLF
     * on Windows, which would fail a byte comparison for no real reason.
     */
    private static String normalize(String text) {
        return text.replace("\r\n", "\n");
    }

    private static final Path CORPUS_ROOT = findCorpus();

    private static Path findCorpus() {
        Path dir = Paths.get(System.getProperty("user.dir")).toAbsolutePath();
        while (dir != null) {
            Path candidate = dir.resolve("test-assets").resolve("avro");
            if (Files.isDirectory(candidate)) {
                return candidate;
            }
            dir = dir.getParent();
        }

        throw new IllegalStateException(
            "could not locate test-assets/avro by walking up from "
                + System.getProperty("user.dir"));
    }
}
