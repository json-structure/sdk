// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.schema;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.*;

import static org.assertj.core.api.Assertions.*;

/**
 * Tests for JsonStructureSchemaExporter.
 */
class JsonStructureSchemaExporterTests {

    private ObjectMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new ObjectMapper();
    }

    @Nested
    @DisplayName("Primitive Types")
    class PrimitiveTypes {

        @Test
        @DisplayName("Export String")
        void exportString() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(String.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("string");
        }

        @Test
        @DisplayName("Export boolean")
        void exportBoolean() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(boolean.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("boolean");
        }

        @Test
        @DisplayName("Export Boolean wrapper")
        void exportBooleanWrapper() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(Boolean.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("boolean");
        }

        @Test
        @DisplayName("Export int")
        void exportInt() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(int.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("int32");
        }

        @Test
        @DisplayName("Export Integer wrapper")
        void exportIntegerWrapper() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(Integer.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("int32");
        }

        @Test
        @DisplayName("Export long")
        void exportLong() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(long.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("int64");
        }

        @Test
        @DisplayName("Export Long wrapper")
        void exportLongWrapper() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(Long.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("int64");
        }

        @Test
        @DisplayName("Export short")
        void exportShort() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(short.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("int16");
        }

        @Test
        @DisplayName("Export byte")
        void exportByte() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(byte.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("int8");
        }

        @Test
        @DisplayName("Export float")
        void exportFloat() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(float.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("float");
        }

        @Test
        @DisplayName("Export double")
        void exportDouble() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(double.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("double");
        }
    }

    @Nested
    @DisplayName("Temporal Types")
    class TemporalTypes {

        @Test
        @DisplayName("Export LocalDate")
        void exportLocalDate() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(LocalDate.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("date");
        }

        @Test
        @DisplayName("Export LocalTime")
        void exportLocalTime() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(LocalTime.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("time");
        }

        @Test
        @DisplayName("Export OffsetDateTime")
        void exportOffsetDateTime() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(OffsetDateTime.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("datetime");
        }

        @Test
        @DisplayName("Export Duration")
        void exportDuration() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(Duration.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("duration");
        }
    }

    @Nested
    @DisplayName("Special Types")
    class SpecialTypes {

        @Test
        @DisplayName("Export UUID")
        void exportUuid() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(UUID.class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("uuid");
        }

        @Test
        @DisplayName("Export byte array as binary")
        void exportByteArrayAsBinary() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(byte[].class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("binary");
        }
    }

    @Nested
    @DisplayName("Collection Types")
    class CollectionTypes {

        @Test
        @DisplayName("Export String array")
        void exportStringArray() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(String[].class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("array");
            assertThat(schema.get("items").get("type").asText()).isEqualTo("string");
        }

        @Test
        @DisplayName("Export int array")
        void exportIntArray() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(int[].class, mapper);
            assertThat(schema.get("type").asText()).isEqualTo("array");
            assertThat(schema.get("items").get("type").asText()).isEqualTo("int32");
        }
    }

    @Nested
    @DisplayName("Complex Object Types")
    class ComplexObjectTypes {

        static class Person {
            private String name;
            private int age;

            public String getName() { return name; }
            public void setName(String name) { this.name = name; }
            public int getAge() { return age; }
            public void setAge(int age) { this.age = age; }
        }

        @Test
        @DisplayName("Export simple object")
        void exportSimpleObject() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(Person.class, mapper);
            
            assertThat(schema.get("type").asText()).isEqualTo("object");
            assertThat(schema.has("properties")).isTrue();
            
            JsonNode properties = schema.get("properties");
            assertThat(properties.has("name")).isTrue();
            assertThat(properties.get("name").get("type").asText()).isEqualTo("string");
            assertThat(properties.has("age")).isTrue();
            assertThat(properties.get("age").get("type").asText()).isEqualTo("int32");
        }

        static class Address {
            private String street;
            private String city;

            public String getStreet() { return street; }
            public void setStreet(String street) { this.street = street; }
            public String getCity() { return city; }
            public void setCity(String city) { this.city = city; }
        }

        static class PersonWithAddress {
            private String name;
            private Address address;

            public String getName() { return name; }
            public void setName(String name) { this.name = name; }
            public Address getAddress() { return address; }
            public void setAddress(Address address) { this.address = address; }
        }

        @Test
        @DisplayName("Export nested object")
        void exportNestedObject() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(PersonWithAddress.class, mapper);
            
            assertThat(schema.get("type").asText()).isEqualTo("object");
            
            JsonNode properties = schema.get("properties");
            assertThat(properties.has("name")).isTrue();
            assertThat(properties.has("address")).isTrue();
            
            JsonNode addressSchema = properties.get("address");
            assertThat(addressSchema.get("type").asText()).isEqualTo("object");
            assertThat(addressSchema.get("properties").has("street")).isTrue();
            assertThat(addressSchema.get("properties").has("city")).isTrue();
        }
    }

    @Nested
    @DisplayName("Enum Types")
    class EnumTypes {

        enum Color {
            RED, GREEN, BLUE
        }

        @Test
        @DisplayName("Export enum")
        void exportEnum() throws Exception {
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(Color.class, mapper);
            
            assertThat(schema.get("type").asText()).isEqualTo("string");
            assertThat(schema.has("enum")).isTrue();
            
            JsonNode enumValues = schema.get("enum");
            assertThat(enumValues.size()).isEqualTo(3);
            
            List<String> values = new ArrayList<>();
            enumValues.elements().forEachRemaining(e -> values.add(e.asText()));
            assertThat(values).containsExactlyInAnyOrder("RED", "GREEN", "BLUE");
        }
    }

    @Nested
    @DisplayName("Schema with Options")
    class SchemaWithOptions {

        static class Product {
            private String name;
            private double price;

            public String getName() { return name; }
            public void setName(String name) { this.name = name; }
            public double getPrice() { return price; }
            public void setPrice(double price) { this.price = price; }
        }

        @Test
        @DisplayName("Export with schema URI")
        void exportWithSchemaUri() throws Exception {
            JsonStructureSchemaExporterOptions options = new JsonStructureSchemaExporterOptions()
                .setSchemaUri("https://json-structure.org/draft/2025-02/schema")
                .setIncludeSchemaKeyword(true);
            
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(Product.class, mapper, options);
            
            assertThat(schema.has("$schema")).isTrue();
            assertThat(schema.get("$schema").asText())
                .isEqualTo("https://json-structure.org/draft/2025-02/schema");
        }

        @Test
        @DisplayName("Export with titles enabled")
        void exportWithTitlesEnabled() throws Exception {
            JsonStructureSchemaExporterOptions options = new JsonStructureSchemaExporterOptions()
                .setIncludeTitles(true);
            
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(Product.class, mapper, options);
            
            assertThat(schema.has("title")).isTrue();
            assertThat(schema.get("title").asText()).isEqualTo("Product");
        }
    }

    @Nested
    @DisplayName("Schema Transformation")
    class SchemaTransformation {

        static class Order {
            private String orderId;
            private String status;

            public String getOrderId() { return orderId; }
            public void setOrderId(String orderId) { this.orderId = orderId; }
            public String getStatus() { return status; }
            public void setStatus(String status) { this.status = status; }
        }

        @Test
        @DisplayName("Transform schema with transformer")
        void transformSchemaWithTransformer() throws Exception {
            JsonStructureSchemaExporterOptions options = new JsonStructureSchemaExporterOptions()
                .setSchemaTransformer((context, schema) -> {
                    // Add a custom annotation to all schemas
                    if (context.getPath().isEmpty()) {
                        schema.put("x-custom", "transformed");
                    }
                    return schema;
                });
            
            ObjectNode schema = JsonStructureSchemaExporter.getSchemaAsNode(Order.class, mapper, options);
            
            assertThat(schema.has("x-custom")).isTrue();
            assertThat(schema.get("x-custom").asText()).isEqualTo("transformed");
        }
    }
}
