package org.json_structure.avro;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.Iterator;
import java.util.Map;

/**
 * Small accessors over Jackson's {@link JsonNode}, and a JSON writer whose
 * output is fixed by the mapping spec rather than by Jackson's defaults.
 *
 * <p>The accessors return {@code null} rather than throwing on a type mismatch,
 * because the compiler reads an untrusted document and reports problems with a
 * JSON Pointer — it needs to ask "is this a string?" without an exception being
 * the answer. They also fold Jackson's {@code NullNode} in with an absent
 * member, which is what the reference implementations do: everywhere the
 * difference between "not there" and "explicitly null" actually matters, the
 * compiler calls {@link JsonNode#has(String)} directly.
 */
final class Js {

    private Js() {
    }

    // -- accessors -------------------------------------------------------------

    /**
     * The member of an object, or {@code null} when the node is not an object,
     * the member is absent, or the member is JSON {@code null}.
     */
    static JsonNode get(JsonNode node, String key) {
        if (node == null || !node.isObject()) {
            return null;
        }
        JsonNode value = node.get(key);
        return value == null || value.isNull() ? null : value;
    }

    static ObjectNode obj(JsonNode node) {
        return node instanceof ObjectNode object ? object : null;
    }

    static ArrayNode arr(JsonNode node) {
        return node instanceof ArrayNode array ? array : null;
    }

    static String str(JsonNode node) {
        return node != null && node.isTextual() ? node.textValue() : null;
    }

    /** Tri-state: {@code TRUE}, {@code FALSE}, or {@code null} for anything else. */
    static Boolean bool(JsonNode node) {
        if (node == null || !node.isBoolean()) {
            return null;
        }
        return node.booleanValue();
    }

    /** Renders a node for an error message. A missing node renders as {@code null}. */
    static String compact(JsonNode node) {
        return node == null ? "null" : write(node, false);
    }

    // -- writing ---------------------------------------------------------------

    /**
     * Serializes a node the way the conformance corpus is written: two-space
     * indent, {@code ": "} between a key and its value, and no gratuitous
     * escaping.
     *
     * <p>Byte-for-byte agreement with the other SDKs is a conformance
     * requirement rather than a nicety — see §7 of the mapping spec — so this
     * does not go through Jackson's pretty printer. Jackson's default writes
     * {@code "key" : value} with a space before the colon and indents array
     * elements differently again; matching {@code serde_json::to_string_pretty}
     * by configuring it is more fragile than simply writing the bytes.
     *
     * <p>The line ending is LF on every platform, and that is deliberate: a raw
     * CR can only come from the writer, never from the content, because a
     * carriage return inside a JSON string is written as the two-character
     * escape {@code \r}.
     */
    static String writePretty(JsonNode node) {
        return write(node, true);
    }

    private static String write(JsonNode node, boolean pretty) {
        StringBuilder out = new StringBuilder(256);
        writeValue(out, node, pretty, 0);
        return out.toString();
    }

    private static void writeValue(StringBuilder out, JsonNode node, boolean pretty, int depth) {
        if (node == null || node.isNull()) {
            out.append("null");
            return;
        }
        if (node.isObject()) {
            writeObject(out, (ObjectNode) node, pretty, depth);
            return;
        }
        if (node.isArray()) {
            writeArray(out, (ArrayNode) node, pretty, depth);
            return;
        }
        if (node.isTextual()) {
            writeString(out, node.textValue());
            return;
        }
        if (node.isBoolean()) {
            out.append(node.booleanValue() ? "true" : "false");
            return;
        }
        if (node.isNumber()) {
            out.append(number(node));
            return;
        }
        // Binary and POJO nodes never occur in a compiled schema; rendering them
        // through Jackson keeps this total rather than silently dropping one.
        out.append(node.toString());
    }

    private static void writeObject(StringBuilder out, ObjectNode node, boolean pretty, int depth) {
        if (node.isEmpty()) {
            out.append("{}");
            return;
        }
        out.append('{');
        boolean first = true;
        Iterator<Map.Entry<String, JsonNode>> entries = node.fields();
        while (entries.hasNext()) {
            Map.Entry<String, JsonNode> entry = entries.next();
            if (!first) {
                out.append(',');
            }
            first = false;
            newline(out, pretty, depth + 1);
            writeString(out, entry.getKey());
            out.append(':');
            if (pretty) {
                out.append(' ');
            }
            writeValue(out, entry.getValue(), pretty, depth + 1);
        }
        newline(out, pretty, depth);
        out.append('}');
    }

    private static void writeArray(StringBuilder out, ArrayNode node, boolean pretty, int depth) {
        if (node.isEmpty()) {
            out.append("[]");
            return;
        }
        out.append('[');
        for (int index = 0; index < node.size(); index++) {
            if (index > 0) {
                out.append(',');
            }
            newline(out, pretty, depth + 1);
            writeValue(out, node.get(index), pretty, depth + 1);
        }
        newline(out, pretty, depth);
        out.append(']');
    }

    private static void newline(StringBuilder out, boolean pretty, int depth) {
        if (!pretty) {
            return;
        }
        out.append('\n');
        out.append("  ".repeat(depth));
    }

    /**
     * Escapes exactly what {@code serde_json} escapes: the quote, the backslash,
     * and the control characters. Everything else — including every non-ASCII
     * character — is written raw.
     */
    private static void writeString(StringBuilder out, String value) {
        out.append('"');
        for (int index = 0; index < value.length(); index++) {
            char c = value.charAt(index);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        out.append('"');
    }

    /**
     * Renders a number the way {@code serde_json} does.
     *
     * <p>Integers are exact and give no trouble. Floating point is written from
     * the shortest round-tripping decimal, in plain notation over the range
     * where {@code ryu} — which is what {@code serde_json} uses — writes plain
     * notation, and in exponential notation outside it. Note that the corpus
     * contains only integers, so this path is reached today only by a
     * {@code default}, {@code minimum} or {@code maximum} copied out of a source
     * document.
     */
    private static String number(JsonNode node) {
        if (node.isIntegralNumber()) {
            return node.bigIntegerValue().toString();
        }
        if (node.isBigDecimal()) {
            return plain(node.decimalValue());
        }
        double value = node.doubleValue();
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            // Not representable in JSON; serde_json writes null.
            return "null";
        }
        if (value == 0.0) {
            return 1.0 / value < 0 ? "-0.0" : "0.0";
        }

        BigDecimal shortest = new BigDecimal(
            node.isFloat() ? Float.toString(node.floatValue()) : Double.toString(value));
        int exponent = shortest.precision() - shortest.scale() - 1;
        if (exponent >= -5 && exponent < 17) {
            return plain(shortest);
        }
        String mantissa = shortest.stripTrailingZeros().movePointLeft(exponent).toPlainString();
        return mantissa + "e" + exponent;
    }

    /** Plain decimal notation, always with a fraction part so it reads as a float. */
    private static String plain(BigDecimal value) {
        String text = value.stripTrailingZeros().toPlainString();
        return text.indexOf('.') < 0 ? text + ".0" : text;
    }
}
