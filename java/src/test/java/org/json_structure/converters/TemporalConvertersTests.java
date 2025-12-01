// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.converters;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for TemporalConverters serializers and deserializers.
 */
public class TemporalConvertersTests {

    @Nested
    @DisplayName("LocalDate Converter Tests")
    class LocalDateConverterTests {
        
        @Test
        @DisplayName("Should serialize LocalDate to ISO string")
        void shouldSerializeLocalDateToIsoString() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addSerializer(LocalDate.class, new TemporalConverters.LocalDateSerializer());
            mapper.registerModule(module);
            
            LocalDate date = LocalDate.of(2024, 3, 15);
            String result = mapper.writeValueAsString(date);
            assertEquals("\"2024-03-15\"", result);
        }
        
        @Test
        @DisplayName("Should serialize null LocalDate")
        void shouldSerializeNullLocalDate() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addSerializer(LocalDate.class, new TemporalConverters.LocalDateSerializer());
            mapper.registerModule(module);
            
            String result = mapper.writeValueAsString((LocalDate) null);
            assertEquals("null", result);
        }
        
        @Test
        @DisplayName("Should deserialize ISO string to LocalDate")
        void shouldDeserializeIsoStringToLocalDate() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addDeserializer(LocalDate.class, new TemporalConverters.LocalDateDeserializer());
            mapper.registerModule(module);
            
            LocalDate result = mapper.readValue("\"2024-03-15\"", LocalDate.class);
            assertEquals(LocalDate.of(2024, 3, 15), result);
        }
        
        @Test
        @DisplayName("Should throw on wrong token for LocalDate")
        void shouldThrowOnWrongTokenForLocalDate() {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addDeserializer(LocalDate.class, new TemporalConverters.LocalDateDeserializer());
            mapper.registerModule(module);
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("12345", LocalDate.class);
            });
        }
    }

    @Nested
    @DisplayName("LocalTime Converter Tests")
    class LocalTimeConverterTests {
        
        @Test
        @DisplayName("Should serialize LocalTime to ISO string")
        void shouldSerializeLocalTimeToIsoString() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addSerializer(LocalTime.class, new TemporalConverters.LocalTimeSerializer());
            mapper.registerModule(module);
            
            LocalTime time = LocalTime.of(14, 30, 45);
            String result = mapper.writeValueAsString(time);
            assertEquals("\"14:30:45\"", result);
        }
        
        @Test
        @DisplayName("Should serialize null LocalTime")
        void shouldSerializeNullLocalTime() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addSerializer(LocalTime.class, new TemporalConverters.LocalTimeSerializer());
            mapper.registerModule(module);
            
            String result = mapper.writeValueAsString((LocalTime) null);
            assertEquals("null", result);
        }
        
        @Test
        @DisplayName("Should deserialize ISO string to LocalTime")
        void shouldDeserializeIsoStringToLocalTime() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addDeserializer(LocalTime.class, new TemporalConverters.LocalTimeDeserializer());
            mapper.registerModule(module);
            
            LocalTime result = mapper.readValue("\"14:30:45\"", LocalTime.class);
            assertEquals(LocalTime.of(14, 30, 45), result);
        }
        
        @Test
        @DisplayName("Should throw on wrong token for LocalTime")
        void shouldThrowOnWrongTokenForLocalTime() {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addDeserializer(LocalTime.class, new TemporalConverters.LocalTimeDeserializer());
            mapper.registerModule(module);
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("12345", LocalTime.class);
            });
        }
    }

    @Nested
    @DisplayName("OffsetDateTime Converter Tests")
    class OffsetDateTimeConverterTests {
        
        @Test
        @DisplayName("Should serialize OffsetDateTime to ISO string")
        void shouldSerializeOffsetDateTimeToIsoString() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addSerializer(OffsetDateTime.class, new TemporalConverters.OffsetDateTimeSerializer());
            mapper.registerModule(module);
            
            OffsetDateTime dateTime = OffsetDateTime.of(2024, 3, 15, 14, 30, 45, 0, ZoneOffset.UTC);
            String result = mapper.writeValueAsString(dateTime);
            assertEquals("\"2024-03-15T14:30:45Z\"", result);
        }
        
        @Test
        @DisplayName("Should serialize null OffsetDateTime")
        void shouldSerializeNullOffsetDateTime() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addSerializer(OffsetDateTime.class, new TemporalConverters.OffsetDateTimeSerializer());
            mapper.registerModule(module);
            
            String result = mapper.writeValueAsString((OffsetDateTime) null);
            assertEquals("null", result);
        }
        
        @Test
        @DisplayName("Should deserialize ISO string to OffsetDateTime")
        void shouldDeserializeIsoStringToOffsetDateTime() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addDeserializer(OffsetDateTime.class, new TemporalConverters.OffsetDateTimeDeserializer());
            mapper.registerModule(module);
            
            OffsetDateTime result = mapper.readValue("\"2024-03-15T14:30:45Z\"", OffsetDateTime.class);
            assertEquals(OffsetDateTime.of(2024, 3, 15, 14, 30, 45, 0, ZoneOffset.UTC), result);
        }
        
        @Test
        @DisplayName("Should throw on wrong token for OffsetDateTime")
        void shouldThrowOnWrongTokenForOffsetDateTime() {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addDeserializer(OffsetDateTime.class, new TemporalConverters.OffsetDateTimeDeserializer());
            mapper.registerModule(module);
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("12345", OffsetDateTime.class);
            });
        }
    }

    @Nested
    @DisplayName("Instant Converter Tests")
    class InstantConverterTests {
        
        @Test
        @DisplayName("Should serialize Instant to ISO string")
        void shouldSerializeInstantToIsoString() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addSerializer(Instant.class, new TemporalConverters.InstantSerializer());
            mapper.registerModule(module);
            
            Instant instant = Instant.parse("2024-03-15T14:30:45Z");
            String result = mapper.writeValueAsString(instant);
            assertEquals("\"2024-03-15T14:30:45Z\"", result);
        }
        
        @Test
        @DisplayName("Should serialize null Instant")
        void shouldSerializeNullInstant() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addSerializer(Instant.class, new TemporalConverters.InstantSerializer());
            mapper.registerModule(module);
            
            String result = mapper.writeValueAsString((Instant) null);
            assertEquals("null", result);
        }
        
        @Test
        @DisplayName("Should deserialize ISO string to Instant")
        void shouldDeserializeIsoStringToInstant() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addDeserializer(Instant.class, new TemporalConverters.InstantDeserializer());
            mapper.registerModule(module);
            
            Instant result = mapper.readValue("\"2024-03-15T14:30:45Z\"", Instant.class);
            assertEquals(Instant.parse("2024-03-15T14:30:45Z"), result);
        }
        
        @Test
        @DisplayName("Should throw on wrong token for Instant")
        void shouldThrowOnWrongTokenForInstant() {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addDeserializer(Instant.class, new TemporalConverters.InstantDeserializer());
            mapper.registerModule(module);
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("12345", Instant.class);
            });
        }
    }

    @Nested
    @DisplayName("Duration Converter Tests")
    class DurationConverterTests {
        
        @Test
        @DisplayName("Should serialize Duration to ISO string")
        void shouldSerializeDurationToIsoString() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addSerializer(Duration.class, new TemporalConverters.DurationSerializer());
            mapper.registerModule(module);
            
            Duration duration = Duration.ofHours(2).plusMinutes(30);
            String result = mapper.writeValueAsString(duration);
            assertEquals("\"PT2H30M\"", result);
        }
        
        @Test
        @DisplayName("Should serialize null Duration")
        void shouldSerializeNullDuration() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addSerializer(Duration.class, new TemporalConverters.DurationSerializer());
            mapper.registerModule(module);
            
            String result = mapper.writeValueAsString((Duration) null);
            assertEquals("null", result);
        }
        
        @Test
        @DisplayName("Should deserialize ISO string to Duration")
        void shouldDeserializeIsoStringToDuration() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addDeserializer(Duration.class, new TemporalConverters.DurationDeserializer());
            mapper.registerModule(module);
            
            Duration result = mapper.readValue("\"PT2H30M\"", Duration.class);
            assertEquals(Duration.ofHours(2).plusMinutes(30), result);
        }
        
        @Test
        @DisplayName("Should throw on wrong token for Duration")
        void shouldThrowOnWrongTokenForDuration() {
            ObjectMapper mapper = new ObjectMapper();
            SimpleModule module = new SimpleModule();
            module.addDeserializer(Duration.class, new TemporalConverters.DurationDeserializer());
            mapper.registerModule(module);
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("12345", Duration.class);
            });
        }
    }
}
