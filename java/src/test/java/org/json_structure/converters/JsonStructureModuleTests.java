// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.converters;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.math.BigInteger;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for JsonStructureModule serializers and deserializers.
 */
public class JsonStructureModuleTests {

    @Nested
    @DisplayName("SafeInt64Serializer Tests")
    class SafeInt64SerializerTests {
        
        @Test
        @DisplayName("Should serialize small longs as numbers")
        void shouldSerializeSmallLongsAsNumbers() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(new JsonStructureModule());
            
            String result = mapper.writeValueAsString(12345L);
            assertEquals("12345", result);
        }
        
        @Test
        @DisplayName("Should serialize large longs as strings")
        void shouldSerializeLargeLongsAsStrings() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(new JsonStructureModule());
            
            // Value greater than JS max safe integer (9007199254740991)
            String result = mapper.writeValueAsString(9007199254740992L);
            assertEquals("\"9007199254740992\"", result);
        }
        
        @Test
        @DisplayName("Should serialize negative large longs as strings")
        void shouldSerializeNegativeLargeLongsAsStrings() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(new JsonStructureModule());
            
            // Value less than JS min safe integer (-9007199254740991)
            String result = mapper.writeValueAsString(-9007199254740992L);
            assertEquals("\"-9007199254740992\"", result);
        }
        
        @Test
        @DisplayName("Should serialize boundary values correctly")
        void shouldSerializeBoundaryValuesCorrectly() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(new JsonStructureModule());
            
            // Exactly at safe integer boundary - should still be number
            String resultMax = mapper.writeValueAsString(9007199254740991L);
            assertEquals("9007199254740991", resultMax);
            
            String resultMin = mapper.writeValueAsString(-9007199254740991L);
            assertEquals("-9007199254740991", resultMin);
        }
        
        @Test
        @DisplayName("Should serialize null correctly")
        void shouldSerializeNullCorrectly() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(new JsonStructureModule());
            
            String result = mapper.writeValueAsString((Long) null);
            assertEquals("null", result);
        }
    }
    
    @Nested
    @DisplayName("BigIntegerAsStringSerializer Tests")
    class BigIntegerAsStringSerializerTests {
        
        @Test
        @DisplayName("Should serialize BigInteger as string")
        void shouldSerializeBigIntegerAsString() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(new JsonStructureModule());
            
            BigInteger value = new BigInteger("170141183460469231731687303715884105727");
            String result = mapper.writeValueAsString(value);
            assertEquals("\"170141183460469231731687303715884105727\"", result);
        }
        
        @Test
        @DisplayName("Should serialize null BigInteger correctly")
        void shouldSerializeNullBigIntegerCorrectly() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(new JsonStructureModule());
            
            String result = mapper.writeValueAsString((BigInteger) null);
            assertEquals("null", result);
        }
        
        @Test
        @DisplayName("Should serialize negative BigInteger as string")
        void shouldSerializeNegativeBigIntegerAsString() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(new JsonStructureModule());
            
            BigInteger value = new BigInteger("-170141183460469231731687303715884105728");
            String result = mapper.writeValueAsString(value);
            assertEquals("\"-170141183460469231731687303715884105728\"", result);
        }
    }
    
    @Nested
    @DisplayName("BigDecimalAsStringSerializer Tests")
    class BigDecimalAsStringSerializerTests {
        
        @Test
        @DisplayName("Should serialize BigDecimal as string")
        void shouldSerializeBigDecimalAsString() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(new JsonStructureModule());
            
            BigDecimal value = new BigDecimal("123.456789012345678901234567890");
            String result = mapper.writeValueAsString(value);
            assertEquals("\"123.456789012345678901234567890\"", result);
        }
        
        @Test
        @DisplayName("Should serialize null BigDecimal correctly")
        void shouldSerializeNullBigDecimalCorrectly() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(new JsonStructureModule());
            
            String result = mapper.writeValueAsString((BigDecimal) null);
            assertEquals("null", result);
        }
    }
    
    @Nested
    @DisplayName("Int64Deserializer Tests")
    class Int64DeserializerTests {
        
        @Test
        @DisplayName("Should deserialize number to Long")
        void shouldDeserializeNumberToLong() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            Long result = mapper.readValue("12345", Long.class);
            assertEquals(12345L, result);
        }
        
        @Test
        @DisplayName("Should deserialize string to Long")
        void shouldDeserializeStringToLong() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            Long result = mapper.readValue("\"9007199254740992\"", Long.class);
            assertEquals(9007199254740992L, result);
        }
        
        @Test
        @DisplayName("Should throw on invalid string for Long")
        void shouldThrowOnInvalidStringForLong() {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("\"not-a-number\"", Long.class);
            });
        }
        
        @Test
        @DisplayName("Should throw on wrong token type")
        void shouldThrowOnWrongTokenTypeForLong() {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("true", Long.class);
            });
        }
    }
    
    @Nested
    @DisplayName("BigIntegerDeserializer Tests")
    class BigIntegerDeserializerTests {
        
        @Test
        @DisplayName("Should deserialize number to BigInteger")
        void shouldDeserializeNumberToBigInteger() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            BigInteger result = mapper.readValue("12345", BigInteger.class);
            assertEquals(new BigInteger("12345"), result);
        }
        
        @Test
        @DisplayName("Should deserialize string to BigInteger")
        void shouldDeserializeStringToBigInteger() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            BigInteger result = mapper.readValue("\"170141183460469231731687303715884105727\"", BigInteger.class);
            assertEquals(new BigInteger("170141183460469231731687303715884105727"), result);
        }
        
        @Test
        @DisplayName("Should throw on invalid string for BigInteger")
        void shouldThrowOnInvalidStringForBigInteger() {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("\"not-a-number\"", BigInteger.class);
            });
        }
        
        @Test
        @DisplayName("Should throw on wrong token type for BigInteger")
        void shouldThrowOnWrongTokenTypeForBigInteger() {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("true", BigInteger.class);
            });
        }
    }
    
    @Nested
    @DisplayName("BigDecimalDeserializer Tests")
    class BigDecimalDeserializerTests {
        
        @Test
        @DisplayName("Should deserialize number to BigDecimal")
        void shouldDeserializeNumberToBigDecimal() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            BigDecimal result = mapper.readValue("123.456", BigDecimal.class);
            assertEquals(new BigDecimal("123.456"), result);
        }
        
        @Test
        @DisplayName("Should deserialize string to BigDecimal")
        void shouldDeserializeStringToBigDecimal() throws JsonProcessingException {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            BigDecimal result = mapper.readValue("\"123.456789012345678901234567890\"", BigDecimal.class);
            assertEquals(new BigDecimal("123.456789012345678901234567890"), result);
        }
        
        @Test
        @DisplayName("Should throw on invalid string for BigDecimal")
        void shouldThrowOnInvalidStringForBigDecimal() {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("\"not-a-decimal\"", BigDecimal.class);
            });
        }
        
        @Test
        @DisplayName("Should throw on wrong token type for BigDecimal")
        void shouldThrowOnWrongTokenTypeForBigDecimal() {
            ObjectMapper mapper = new ObjectMapper().registerModule(JsonStructureModule.withDeserializers());
            
            assertThrows(JsonMappingException.class, () -> {
                mapper.readValue("true", BigDecimal.class);
            });
        }
    }
    
    @Nested
    @DisplayName("Module Constants Tests")
    class ModuleConstantsTests {
        
        @Test
        @DisplayName("UINT64_MAX should be correct")
        void uint64MaxShouldBeCorrect() {
            assertEquals(new BigInteger("18446744073709551615"), JsonStructureModule.UINT64_MAX);
        }
        
        @Test
        @DisplayName("INT128_MAX should be correct")
        void int128MaxShouldBeCorrect() {
            assertEquals(new BigInteger("170141183460469231731687303715884105727"), JsonStructureModule.INT128_MAX);
        }
        
        @Test
        @DisplayName("INT128_MIN should be correct")
        void int128MinShouldBeCorrect() {
            assertEquals(new BigInteger("-170141183460469231731687303715884105728"), JsonStructureModule.INT128_MIN);
        }
        
        @Test
        @DisplayName("UINT128_MAX should be correct")
        void uint128MaxShouldBeCorrect() {
            assertEquals(new BigInteger("340282366920938463463374607431768211455"), JsonStructureModule.UINT128_MAX);
        }
    }
}
