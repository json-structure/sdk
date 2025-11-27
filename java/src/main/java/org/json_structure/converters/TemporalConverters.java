// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.converters;

import com.fasterxml.jackson.core.*;
import com.fasterxml.jackson.databind.*;

import java.io.IOException;
import java.time.*;
import java.time.format.DateTimeFormatter;

/**
 * Jackson serializers and deserializers for temporal types conforming to JSON Structure format.
 */
public final class TemporalConverters {

    private TemporalConverters() {
        // Static utility class
    }

    /**
     * Serializer for LocalDate as ISO-8601 date string (yyyy-MM-dd).
     */
    public static class LocalDateSerializer extends JsonSerializer<LocalDate> {
        @Override
        public void serialize(LocalDate value, JsonGenerator gen, SerializerProvider provider) throws IOException {
            if (value == null) {
                gen.writeNull();
            } else {
                gen.writeString(value.format(DateTimeFormatter.ISO_LOCAL_DATE));
            }
        }
    }

    /**
     * Deserializer for LocalDate from ISO-8601 date string.
     */
    public static class LocalDateDeserializer extends JsonDeserializer<LocalDate> {
        @Override
        public LocalDate deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            if (p.currentToken() == JsonToken.VALUE_STRING) {
                return LocalDate.parse(p.getText(), DateTimeFormatter.ISO_LOCAL_DATE);
            }
            throw ctxt.wrongTokenException(p, LocalDate.class, JsonToken.VALUE_STRING, "Expected ISO date string");
        }
    }

    /**
     * Serializer for LocalTime as ISO-8601 time string.
     */
    public static class LocalTimeSerializer extends JsonSerializer<LocalTime> {
        @Override
        public void serialize(LocalTime value, JsonGenerator gen, SerializerProvider provider) throws IOException {
            if (value == null) {
                gen.writeNull();
            } else {
                gen.writeString(value.format(DateTimeFormatter.ISO_LOCAL_TIME));
            }
        }
    }

    /**
     * Deserializer for LocalTime from ISO-8601 time string.
     */
    public static class LocalTimeDeserializer extends JsonDeserializer<LocalTime> {
        @Override
        public LocalTime deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            if (p.currentToken() == JsonToken.VALUE_STRING) {
                return LocalTime.parse(p.getText(), DateTimeFormatter.ISO_LOCAL_TIME);
            }
            throw ctxt.wrongTokenException(p, LocalTime.class, JsonToken.VALUE_STRING, "Expected ISO time string");
        }
    }

    /**
     * Serializer for OffsetDateTime as ISO-8601 datetime string.
     */
    public static class OffsetDateTimeSerializer extends JsonSerializer<OffsetDateTime> {
        @Override
        public void serialize(OffsetDateTime value, JsonGenerator gen, SerializerProvider provider) throws IOException {
            if (value == null) {
                gen.writeNull();
            } else {
                gen.writeString(value.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
            }
        }
    }

    /**
     * Deserializer for OffsetDateTime from ISO-8601 datetime string.
     */
    public static class OffsetDateTimeDeserializer extends JsonDeserializer<OffsetDateTime> {
        @Override
        public OffsetDateTime deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            if (p.currentToken() == JsonToken.VALUE_STRING) {
                return OffsetDateTime.parse(p.getText(), DateTimeFormatter.ISO_OFFSET_DATE_TIME);
            }
            throw ctxt.wrongTokenException(p, OffsetDateTime.class, JsonToken.VALUE_STRING, "Expected ISO datetime string");
        }
    }

    /**
     * Serializer for Instant as ISO-8601 datetime string.
     */
    public static class InstantSerializer extends JsonSerializer<Instant> {
        @Override
        public void serialize(Instant value, JsonGenerator gen, SerializerProvider provider) throws IOException {
            if (value == null) {
                gen.writeNull();
            } else {
                gen.writeString(DateTimeFormatter.ISO_INSTANT.format(value));
            }
        }
    }

    /**
     * Deserializer for Instant from ISO-8601 datetime string.
     */
    public static class InstantDeserializer extends JsonDeserializer<Instant> {
        @Override
        public Instant deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            if (p.currentToken() == JsonToken.VALUE_STRING) {
                return Instant.parse(p.getText());
            }
            throw ctxt.wrongTokenException(p, Instant.class, JsonToken.VALUE_STRING, "Expected ISO instant string");
        }
    }

    /**
     * Serializer for Duration as ISO-8601 duration string.
     */
    public static class DurationSerializer extends JsonSerializer<Duration> {
        @Override
        public void serialize(Duration value, JsonGenerator gen, SerializerProvider provider) throws IOException {
            if (value == null) {
                gen.writeNull();
            } else {
                gen.writeString(value.toString());
            }
        }
    }

    /**
     * Deserializer for Duration from ISO-8601 duration string.
     */
    public static class DurationDeserializer extends JsonDeserializer<Duration> {
        @Override
        public Duration deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
            if (p.currentToken() == JsonToken.VALUE_STRING) {
                return Duration.parse(p.getText());
            }
            throw ctxt.wrongTokenException(p, Duration.class, JsonToken.VALUE_STRING, "Expected ISO duration string");
        }
    }
}
