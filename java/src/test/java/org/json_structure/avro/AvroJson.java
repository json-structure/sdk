package org.json_structure.avro;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.avro.LogicalType;
import org.apache.avro.LogicalTypes;
import org.apache.avro.Schema;
import org.apache.avro.generic.GenericData;

/**
 * Reads the corpus instance encoding — "Plain JSON" — into the datum shapes
 * Avro's generic writer expects.
 *
 * <p>The corpus does not use Avro's own JSON encoding. Avro JSON writes binary
 * as Latin-1 code points, temporals as bare epoch numbers, and every union value
 * wrapped in a single-key object naming the branch — none of which an ordinary
 * JSON producer emits or an ordinary JSON consumer understands. The corpus uses
 * the Plain JSON encoding instead: base64 for binary, RFC 3339 strings for
 * temporals, quoted numbers for {@code long} and {@code decimal}, and untagged
 * union values resolved by structure.
 *
 * <p>The cost is that no shipping Avro library will read the corpus instances,
 * so Avro's own {@code JsonDecoder} can no longer serve as a second opinion on
 * this decoder. The corpus replaces that with something stronger and
 * cross-language: {@code expected.avro.b64} pins the bytes each instance must
 * encode to, so this decoder is checked against the Rust one rather than against
 * itself.
 *
 * <p>Everything here produces <em>base</em> values rather than logical ones — a
 * {@link ByteBuffer} for a decimal, a {@link String} for a uuid — because
 * {@link GenericData#get()} carries no conversions, so Avro's generic writer
 * passes a logical datum straight through to the base encoder.
 */
final class AvroJson {

    private AvroJson() {
    }

    /** The value, or the reason it could not be decoded. */
    private record Attempt(boolean ok, Object value, String why) {

        static Attempt of(Object value) {
            return new Attempt(true, value, null);
        }

        static Attempt no(String why) {
            return new Attempt(false, null, why);
        }
    }

    /**
     * Decodes {@code json} as an instance of {@code schema}.
     *
     * @throws IllegalArgumentException when the value does not fit the schema
     */
    static Object decode(Schema schema, JsonNode json) {
        Attempt attempt = tryDecode(schema, json);
        if (!attempt.ok()) {
            throw new IllegalArgumentException(attempt.why());
        }
        return attempt.value();
    }

    /**
     * The fallible core of {@link #decode}.
     *
     * <p>Failure has to be an ordinary answer rather than an exception, because
     * Plain JSON drops the union branch tag: the only way to find the branch is
     * to try them all and see which one fits.
     */
    private static Attempt tryDecode(Schema schema, JsonNode json) {
        LogicalType logical = schema.getLogicalType();
        if (logical != null) {
            Attempt attempt = tryDecodeLogical(schema, logical, json);
            if (attempt != null) {
                return attempt;
            }
        }

        return switch (schema.getType()) {
            case NULL -> isNull(json)
                ? Attempt.of(null)
                : Attempt.no(wrong("null", json));

            case BOOLEAN -> json != null && json.isBoolean()
                ? Attempt.of(json.booleanValue())
                : Attempt.no(wrong("a boolean", json));

            case INT -> decodeInt(json);

            // Feature 3: a `long` travels as a *string* in JSON number syntax,
            // because JSON numbers are only guaranteed to survive to 2^53 and an
            // Avro long runs to 2^63.
            case LONG -> decodeLong(json);

            case FLOAT -> json != null && json.isNumber()
                ? Attempt.of((float) json.doubleValue())
                : Attempt.no(wrong("a float", json));

            case DOUBLE -> json != null && json.isNumber()
                ? Attempt.of(json.doubleValue())
                : Attempt.no(wrong("a double", json));

            case STRING -> json != null && json.isTextual()
                ? Attempt.of(json.textValue())
                : Attempt.no(wrong("a string", json));

            // Feature 2: bytes are base64, not Avro JSON's Latin-1 code points.
            case BYTES -> decodeBytes(json);

            case FIXED -> decodeFixed(schema, json);

            case ENUM -> decodeEnum(schema, json);

            case ARRAY -> decodeArray(schema, json);

            case MAP -> decodeMap(schema, json);

            case RECORD -> decodeRecord(schema, json);

            case UNION -> decodeUnion(schema, json);
        };
    }

    private static Attempt decodeInt(JsonNode json) {
        if (json == null || !json.isIntegralNumber() || !json.canConvertToInt()) {
            return Attempt.no(wrong("an int", json));
        }
        return Attempt.of(json.intValue());
    }

    private static Attempt decodeLong(JsonNode json) {
        if (json == null || !json.isTextual()) {
            return Attempt.no(wrong("a long as a quoted number", json));
        }
        try {
            return Attempt.of(Long.parseLong(json.textValue().trim()));
        } catch (NumberFormatException e) {
            return Attempt.no(wrong("a long as a quoted number", json));
        }
    }

    private static Attempt decodeBytes(JsonNode json) {
        byte[] raw = base64(json);
        return raw == null
            ? Attempt.no(wrong("base64 bytes", json))
            : Attempt.of(ByteBuffer.wrap(raw));
    }

    private static Attempt decodeFixed(Schema schema, JsonNode json) {
        byte[] raw = base64(json);
        if (raw == null) {
            return Attempt.no(wrong("base64 bytes", json));
        }
        if (raw.length != schema.getFixedSize()) {
            return Attempt.no("fixed(" + schema.getFullName() + ") needs "
                + schema.getFixedSize() + " bytes, found " + raw.length);
        }
        return Attempt.of(new GenericData.Fixed(schema, raw));
    }

    private static Attempt decodeEnum(Schema schema, JsonNode json) {
        if (json == null || !json.isTextual()) {
            return Attempt.no(wrong("an enum symbol", json));
        }
        String symbol = json.textValue();
        if (!schema.hasEnumSymbol(symbol)) {
            return Attempt.no("'" + symbol + "' is not a symbol of " + schema.getFullName());
        }
        return Attempt.of(new GenericData.EnumSymbol(schema, symbol));
    }

    private static Attempt decodeArray(Schema schema, JsonNode json) {
        if (json == null || !json.isArray()) {
            return Attempt.no(wrong("an array", json));
        }
        List<Object> decoded = new ArrayList<>(json.size());
        for (int index = 0; index < json.size(); index++) {
            Attempt item = tryDecode(schema.getElementType(), json.get(index));
            if (!item.ok()) {
                return Attempt.no("item " + index + ": " + item.why());
            }
            decoded.add(item.value());
        }
        return Attempt.of(decoded);
    }

    private static Attempt decodeMap(Schema schema, JsonNode json) {
        if (json == null || !json.isObject()) {
            return Attempt.no(wrong("an object", json));
        }
        Map<String, Object> map = new LinkedHashMap<>();
        Iterator<Map.Entry<String, JsonNode>> entries = json.fields();
        while (entries.hasNext()) {
            Map.Entry<String, JsonNode> entry = entries.next();
            Attempt item = tryDecode(schema.getValueType(), entry.getValue());
            if (!item.ok()) {
                return Attempt.no("entry '" + entry.getKey() + "': " + item.why());
            }
            map.put(entry.getKey(), item.value());
        }
        return Attempt.of(map);
    }

    private static Attempt decodeRecord(Schema schema, JsonNode json) {
        if (json == null || !json.isObject()) {
            return Attempt.no(wrong("an object", json));
        }

        GenericData.Record record = new GenericData.Record(schema);
        for (Schema.Field field : schema.getFields()) {
            if (json.has(field.name())) {
                Attempt decoded = tryDecode(field.schema(), json.get(field.name()));
                if (!decoded.ok()) {
                    return Attempt.no("field '" + field.name() + "': " + decoded.why());
                }
                record.put(field.name(), decoded.value());
                continue;
            }

            // Feature 5 lets a null-valued field be left out entirely, which is
            // what a JSON producer that omits empty properties will hand us.
            if (!holdsNull(field.schema())) {
                return Attempt.no("missing field '" + field.name() + "'");
            }
            record.put(field.name(), null);
        }

        Iterator<String> names = json.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            if (schema.getField(name) == null) {
                return Attempt.no("'" + name + "' is not a field of " + schema.getFullName());
            }
        }

        return Attempt.of(record);
    }

    /**
     * Features 5 and 6: Plain JSON carries no branch tag, so the branch is
     * whichever one the value fits.
     *
     * <p>Ambiguity is an error rather than a first-match race. A union whose
     * branches are not structurally distinguishable cannot be decoded from plain
     * JSON by anybody, and saying so is better than taking the first match and
     * handing back a plausible wrong answer.
     */
    private static Attempt decodeUnion(Schema schema, JsonNode json) {
        int matched = -1;
        Object match = null;
        List<String> reasons = new ArrayList<>();

        List<Schema> branches = schema.getTypes();
        for (int index = 0; index < branches.size(); index++) {
            Attempt attempt = tryDecode(branches.get(index), json);
            if (!attempt.ok()) {
                reasons.add("  branch " + index + ": " + attempt.why());
                continue;
            }
            if (matched >= 0) {
                return Attempt.no("ambiguous union: the value fits both branch " + matched
                    + " and branch " + index + ", so no decoder can choose");
            }
            matched = index;
            match = attempt.value();
        }

        if (matched < 0) {
            return Attempt.no("no union branch fits:\n" + String.join("\n", reasons));
        }
        return Attempt.of(match);
    }

    /**
     * Decodes a value carrying a {@code logicalType}, or returns {@code null} to
     * fall through to the base type.
     *
     * <p>Only {@code decimal} and {@code uuid} need anything special. The
     * {@code rfc3339-*} family is not registered with the Java runtime at all —
     * Avro ignores a logical type it does not know — so those never reach here.
     */
    private static Attempt tryDecodeLogical(Schema schema, LogicalType logical, JsonNode json) {
        // Feature 3 again: a decimal is its *numeric* value as a string, not the
        // unscaled bytes. That is the whole interoperability point — a plain JSON
        // consumer can read `"1.25"` and cannot read `"fQ=="`.
        if (logical instanceof LogicalTypes.Decimal decimal) {
            if (json == null || !json.isTextual()) {
                return Attempt.no(
                    "expected a decimal as a quoted number, found " + render(json));
            }
            return unscaled(json.textValue(), decimal.getScale());
        }

        if ("uuid".equals(logical.getName())) {
            if (json == null || !json.isTextual()) {
                return Attempt.no("expected a uuid string, found " + render(json));
            }
            String text = json.textValue();
            try {
                java.util.UUID.fromString(text);
            } catch (IllegalArgumentException e) {
                return Attempt.no("expected a uuid string, found " + render(json));
            }
            // The base representation: Avro's generic writer has no uuid
            // conversion registered, so it writes the string straight through.
            return Attempt.of(text);
        }

        return null;
    }

    /** Reads a decimal in JSON number syntax into its unscaled integer. */
    private static Attempt unscaled(String text, int scale) {
        BigInteger sign = BigInteger.ONE;
        String digits = text;
        if (digits.startsWith("-")) {
            sign = BigInteger.valueOf(-1);
            digits = digits.substring(1);
        } else if (digits.startsWith("+")) {
            digits = digits.substring(1);
        }

        int dot = digits.indexOf('.');
        String whole = dot < 0 ? digits : digits.substring(0, dot);
        String fraction = dot < 0 ? "" : digits.substring(dot + 1);

        if (fraction.length() > scale) {
            return Attempt.no("'" + text + "' has " + fraction.length()
                + " fraction digits, more than the schema's scale of " + scale);
        }

        String padded = whole + fraction + "0".repeat(scale - fraction.length());
        if (padded.isEmpty() || !padded.chars().allMatch(c -> c >= '0' && c <= '9')) {
            return Attempt.no("'" + text + "' is not a decimal");
        }

        BigInteger magnitude;
        try {
            magnitude = new BigInteger(padded);
        } catch (NumberFormatException e) {
            return Attempt.no("'" + text + "' is not a decimal");
        }
        return Attempt.of(ByteBuffer.wrap(sign.multiply(magnitude).toByteArray()));
    }

    /** Whether a schema can hold null, for the omitted-field rule. */
    private static boolean holdsNull(Schema schema) {
        if (schema.getType() == Schema.Type.NULL) {
            return true;
        }
        if (schema.getType() != Schema.Type.UNION) {
            return false;
        }
        return schema.getTypes().stream().anyMatch(branch -> branch.getType() == Schema.Type.NULL);
    }

    private static boolean isNull(JsonNode json) {
        return json == null || json.isNull();
    }

    private static byte[] base64(JsonNode json) {
        if (json == null || !json.isTextual()) {
            return null;
        }
        try {
            return Base64.getDecoder().decode(json.textValue());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String wrong(String what, JsonNode json) {
        return "expected " + what + ", found " + render(json);
    }

    private static String render(JsonNode json) {
        return json == null ? "null" : json.toString();
    }
}
