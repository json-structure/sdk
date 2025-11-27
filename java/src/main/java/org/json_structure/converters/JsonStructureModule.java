// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.converters;

import com.fasterxml.jackson.core.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.module.SimpleModule;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;

/**
 * Jackson module that registers serializers and deserializers for JSON Structure extended types.
 * Includes support for large integers (int64/uint64/int128/uint128) and high-precision decimals.
 */
public class JsonStructureModule extends SimpleModule {

    private static final long serialVersionUID = 1L;

    /**
     * Maximum value for uint64.
     */
    public static final BigInteger UINT64_MAX = new BigInteger("18446744073709551615");

    /**
     * Maximum value for int128.
     */
    public static final BigInteger INT128_MAX = new BigInteger("170141183460469231731687303715884105727");

    /**
     * Minimum value for int128.
     */
    public static final BigInteger INT128_MIN = new BigInteger("-170141183460469231731687303715884105728");

    /**
     * Maximum value for uint128.
     */
    public static final BigInteger UINT128_MAX = new BigInteger("340282366920938463463374607431768211455");

    /**
     * Creates a new JSON Structure module with default configuration.
     */
    public JsonStructureModule() {
        super("JsonStructureModule");

        // Register Int64 serializer/deserializer for large longs
        addSerializer(Long.class, new SafeInt64Serializer());
        addSerializer(long.class, new SafeInt64Serializer());

        // Register BigInteger serializers for int128/uint128
        addSerializer(BigInteger.class, new BigIntegerAsStringSerializer());

        // Register BigDecimal serializer for precise decimals
        addSerializer(BigDecimal.class, new BigDecimalAsStringSerializer());
    }

    /**
     * Serializer that writes Long values as strings when they exceed JavaScript's safe integer range.
     */
    public static class SafeInt64Serializer extends JsonSerializer<Long> {
        private static final long JS_MAX_SAFE_INTEGER = 9007199254740991L;
        private static final long JS_MIN_SAFE_INTEGER = -9007199254740991L;

        @Override
        public void serialize(Long value, JsonGenerator gen, SerializerProvider provider) throws IOException {
            if (value == null) {
                gen.writeNull();
            } else if (value > JS_MAX_SAFE_INTEGER || value < JS_MIN_SAFE_INTEGER) {
                // Write as string for values outside JavaScript safe integer range
                gen.writeString(value.toString());
            } else {
                gen.writeNumber(value);
            }
        }
    }

    /**
     * Serializer that always writes BigInteger values as strings.
     */
    public static class BigIntegerAsStringSerializer extends JsonSerializer<BigInteger> {
        @Override
        public void serialize(BigInteger value, JsonGenerator gen, SerializerProvider provider) throws IOException {
            if (value == null) {
                gen.writeNull();
            } else {
                gen.writeString(value.toString());
            }
        }
    }

    /**
     * Serializer that writes BigDecimal values as strings for precision preservation.
     */
    public static class BigDecimalAsStringSerializer extends JsonSerializer<BigDecimal> {
        @Override
        public void serialize(BigDecimal value, JsonGenerator gen, SerializerProvider provider) throws IOException {
            if (value == null) {
                gen.writeNull();
            } else {
                gen.writeString(value.toPlainString());
            }
        }
    }

    /**
     * Deserializer for int64 values that may be encoded as strings.
     */
    public static class Int64Deserializer extends JsonDeserializer<Long> {
        @Override
        public Long deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            if (p.currentToken() == JsonToken.VALUE_STRING) {
                try {
                    return Long.parseLong(p.getText());
                } catch (NumberFormatException e) {
                    throw ctxt.weirdStringException(p.getText(), Long.class, "Not a valid int64 value");
                }
            } else if (p.currentToken() == JsonToken.VALUE_NUMBER_INT) {
                return p.getLongValue();
            }
            throw ctxt.wrongTokenException(p, Long.class, JsonToken.VALUE_NUMBER_INT, "Expected number or string");
        }
    }

    /**
     * Deserializer for BigInteger values that may be encoded as strings.
     */
    public static class BigIntegerDeserializer extends JsonDeserializer<BigInteger> {
        @Override
        public BigInteger deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            if (p.currentToken() == JsonToken.VALUE_STRING) {
                try {
                    return new BigInteger(p.getText());
                } catch (NumberFormatException e) {
                    throw ctxt.weirdStringException(p.getText(), BigInteger.class, "Not a valid integer value");
                }
            } else if (p.currentToken() == JsonToken.VALUE_NUMBER_INT) {
                return p.getBigIntegerValue();
            }
            throw ctxt.wrongTokenException(p, BigInteger.class, JsonToken.VALUE_NUMBER_INT, "Expected number or string");
        }
    }

    /**
     * Deserializer for BigDecimal values that may be encoded as strings.
     */
    public static class BigDecimalDeserializer extends JsonDeserializer<BigDecimal> {
        @Override
        public BigDecimal deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            if (p.currentToken() == JsonToken.VALUE_STRING) {
                try {
                    return new BigDecimal(p.getText());
                } catch (NumberFormatException e) {
                    throw ctxt.weirdStringException(p.getText(), BigDecimal.class, "Not a valid decimal value");
                }
            } else if (p.currentToken().isNumeric()) {
                return p.getDecimalValue();
            }
            throw ctxt.wrongTokenException(p, BigDecimal.class, JsonToken.VALUE_NUMBER_FLOAT, "Expected number or string");
        }
    }

    /**
     * Creates a module with deserializers for reading string-encoded numbers.
     *
     * @return a new module with deserializers
     */
    public static JsonStructureModule withDeserializers() {
        JsonStructureModule module = new JsonStructureModule();
        module.addDeserializer(Long.class, new Int64Deserializer());
        module.addDeserializer(long.class, new Int64Deserializer());
        module.addDeserializer(BigInteger.class, new BigIntegerDeserializer());
        module.addDeserializer(BigDecimal.class, new BigDecimalDeserializer());
        return module;
    }
}
