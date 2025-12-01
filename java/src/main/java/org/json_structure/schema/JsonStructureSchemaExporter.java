// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.schema;

import com.fasterxml.jackson.annotation.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.introspect.*;
import com.fasterxml.jackson.databind.node.*;

import java.lang.reflect.*;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URI;
import java.time.*;
import java.util.*;

/**
 * Generates JSON Structure schemas from Java types using Jackson type introspection.
 * Similar to System.Text.Json.Schema.JsonSchemaExporter but for JSON Structure format.
 */
public final class JsonStructureSchemaExporter {

    private JsonStructureSchemaExporter() {
        // Static utility class
    }

    /**
     * Gets the JSON Structure schema for the specified type.
     *
     * @param type   the type to generate a schema for
     * @param mapper the ObjectMapper to use for introspection
     * @return a JsonNode representing the schema
     */
    public static ObjectNode getSchemaAsNode(Class<?> type, ObjectMapper mapper) {
        return getSchemaAsNode(type, mapper, null);
    }

    /**
     * Gets the JSON Structure schema for the specified type.
     *
     * @param type    the type to generate a schema for
     * @param mapper  the ObjectMapper to use for introspection
     * @param options optional exporter options
     * @return a JsonNode representing the schema
     */
    public static ObjectNode getSchemaAsNode(Class<?> type, ObjectMapper mapper,
                                              JsonStructureSchemaExporterOptions options) {
        Objects.requireNonNull(type, "type cannot be null");
        Objects.requireNonNull(mapper, "mapper cannot be null");

        if (options == null) {
            options = new JsonStructureSchemaExporterOptions();
        }

        return generateSchema(type, mapper, options, "", new HashSet<>());
    }

    private static ObjectNode generateSchema(Class<?> type, ObjectMapper mapper,
                                              JsonStructureSchemaExporterOptions options,
                                              String path, Set<Class<?>> visitedTypes) {
        ObjectNode schema = mapper.createObjectNode();
        boolean isRoot = path.isEmpty();

        // Add $schema and $uses for root
        if (isRoot && options.isIncludeSchemaKeyword()) {
            if (options.isUseExtendedValidation()) {
                // Use extended meta-schema with validation extension
                schema.put("$schema", "https://json-structure.org/meta/extended/v0/#");
                ArrayNode usesArray = schema.putArray("$uses");
                usesArray.add("JSONStructureValidation");
            } else {
                schema.put("$schema", options.getSchemaUri());
            }
        }

        // Handle wrapper types
        type = unwrapType(type);

        // Check for recursion - per JSON Structure spec, $ref must be inside type
        if (visitedTypes.contains(type) && !type.isPrimitive() && type != String.class) {
            ObjectNode refObj = mapper.createObjectNode();
            refObj.put("$ref", "#/definitions/" + getTypeName(type));
            schema.set("type", refObj);
            return applyTransform(schema, type, null, null, path, options);
        }

        // Map Java type to JSON Structure type
        String structureType = getJsonStructureType(type);
        if (structureType != null) {
            schema.put("type", structureType);
        }

        // Add metadata
        if (options.isIncludeTitles()) {
            schema.put("title", getFriendlyTypeName(type));
        }

        // Handle enums
        if (type.isEnum()) {
            schema.put("type", "string");
            ArrayNode enumValues = schema.putArray("enum");
            for (Object constant : type.getEnumConstants()) {
                String name = getEnumValueName((Enum<?>) constant, mapper);
                enumValues.add(name);
            }
            return applyTransform(schema, type, null, null, path, options);
        }

        // Handle byte[] as binary (special case before generic arrays)
        if (type == byte[].class) {
            schema.put("type", "binary");
            return applyTransform(schema, type, null, null, path, options);
        }

        // Handle arrays
        if (type.isArray()) {
            schema.put("type", "array");
            Class<?> componentType = type.getComponentType();
            schema.set("items", generateSchema(componentType, mapper, options,
                    path + "/items", new HashSet<>(visitedTypes)));
            return applyTransform(schema, type, null, null, path, options);
        }

        // Handle collections
        if (Collection.class.isAssignableFrom(type)) {
            if (Set.class.isAssignableFrom(type)) {
                schema.put("type", "set");
            } else {
                schema.put("type", "array");
            }
            // Generic type info would require more complex handling with TypeReference
            return applyTransform(schema, type, null, null, path, options);
        }

        // Handle maps
        if (Map.class.isAssignableFrom(type)) {
            schema.put("type", "map");
            // Generic type info would require more complex handling
            return applyTransform(schema, type, null, null, path, options);
        }

        // Handle complex objects
        if ("object".equals(structureType) && !type.isPrimitive() && type != String.class) {
            visitedTypes.add(type);

            ObjectNode properties = mapper.createObjectNode();
            ArrayNode required = mapper.createArrayNode();

            // Use Jackson's introspection to get properties
            JavaType javaType = mapper.getTypeFactory().constructType(type);
            BeanDescription beanDesc = mapper.getSerializationConfig().introspect(javaType);

            for (BeanPropertyDefinition prop : beanDesc.findProperties()) {
                if (prop.couldSerialize()) {
                    String jsonName = prop.getName();
                    Class<?> propType = getPropertyType(prop);

                    if (propType == null) continue;

                    // Check for JsonIgnore
                    if (isIgnored(prop)) continue;

                    // Generate property schema
                    ObjectNode propSchema = generateSchema(propType, mapper, options,
                            path + "/properties/" + jsonName, new HashSet<>(visitedTypes));

                    // Add property metadata
                    if (options.isIncludeDescriptions()) {
                        String description = getPropertyDescription(prop);
                        if (description != null) {
                            propSchema.put("description", description);
                        }
                    }

                    // Check for validation annotations
                    addValidationConstraints(prop, propSchema);

                    properties.set(jsonName, applyTransform(propSchema, propType,
                            prop.getField() != null ? prop.getField().getAnnotated() : null,
                            prop.getGetter() != null ? prop.getGetter().getAnnotated() : null,
                            path + "/properties/" + jsonName, options));

                    // Check if required
                    if (isPropertyRequired(prop, options)) {
                        required.add(jsonName);
                    }
                }
            }

            schema.set("properties", properties);
            if (required.size() > 0) {
                schema.set("required", required);
            }

            visitedTypes.remove(type);
        }

        return applyTransform(schema, type, null, null, path, options);
    }

    private static Class<?> unwrapType(Class<?> type) {
        // Unwrap Optional
        if (type == Optional.class) {
            return Object.class; // Would need generic type info
        }
        return type;
    }

    private static String getJsonStructureType(Class<?> type) {
        // Primitive types
        if (type == String.class || type == CharSequence.class) return "string";
        if (type == boolean.class || type == Boolean.class) return "boolean";

        // Integer types
        if (type == byte.class || type == Byte.class) return "int8";
        if (type == short.class || type == Short.class) return "int16";
        if (type == int.class || type == Integer.class) return "int32";
        if (type == long.class || type == Long.class) return "int64";

        // BigInteger for larger types
        if (type == BigInteger.class) return "int128"; // Or could be uint128

        // Floating point - use spec names: float (32-bit), double (64-bit)
        if (type == float.class || type == Float.class) return "float";
        if (type == double.class || type == Double.class) return "double";
        if (type == BigDecimal.class) return "decimal";

        // Date/time types
        if (type == LocalDate.class) return "date";
        if (type == LocalTime.class) return "time";
        if (type == LocalDateTime.class) return "datetime";
        if (type == OffsetDateTime.class) return "datetime";
        if (type == ZonedDateTime.class) return "datetime";
        if (type == Instant.class) return "datetime";
        if (type == Duration.class) return "duration";
        if (type == Period.class) return "duration";

        // Other types
        if (type == UUID.class) return "uuid";
        if (type == URI.class) return "uri";
        if (type == java.net.URL.class) return "uri";
        if (type == byte[].class) return "binary";

        // Object for complex types
        if (!type.isPrimitive() && !type.isEnum() && !type.isArray() &&
                !Collection.class.isAssignableFrom(type) && !Map.class.isAssignableFrom(type)) {
            return "object";
        }

        return null;
    }

    private static Class<?> getPropertyType(BeanPropertyDefinition prop) {
        AnnotatedMember member = prop.getPrimaryMember();
        if (member != null) {
            return member.getRawType();
        }
        if (prop.getField() != null) {
            return prop.getField().getRawType();
        }
        if (prop.getGetter() != null) {
            return prop.getGetter().getRawType();
        }
        return null;
    }

    private static boolean isIgnored(BeanPropertyDefinition prop) {
        AnnotatedMember member = prop.getPrimaryMember();
        if (member != null) {
            JsonIgnore ignore = member.getAnnotation(JsonIgnore.class);
            if (ignore != null && ignore.value()) return true;
        }
        return false;
    }

    private static String getPropertyDescription(BeanPropertyDefinition prop) {
        AnnotatedMember member = prop.getPrimaryMember();
        if (member != null) {
            JsonPropertyDescription desc = member.getAnnotation(JsonPropertyDescription.class);
            if (desc != null) {
                return desc.value();
            }
        }
        return null;
    }

    private static boolean isPropertyRequired(BeanPropertyDefinition prop, JsonStructureSchemaExporterOptions options) {
        // Check for JsonProperty.required
        AnnotatedMember member = prop.getPrimaryMember();
        if (member != null) {
            JsonProperty jsonProp = member.getAnnotation(JsonProperty.class);
            if (jsonProp != null && jsonProp.required()) {
                return true;
            }
        }

        // Primitive types are always required (can't be null)
        Class<?> type = getPropertyType(prop);
        if (type != null && type.isPrimitive()) {
            return true;
        }

        return false;
    }

    private static void addValidationConstraints(BeanPropertyDefinition prop, ObjectNode schema) {
        AnnotatedMember member = prop.getPrimaryMember();
        if (member == null) return;

        // Check for common validation annotations
        // Note: These would typically come from Jakarta validation annotations
        // This is a simplified implementation

        // Pattern annotation (if using regex)
        // Size annotation for collections/strings
        // Min/Max for numbers

        // For now, we'll rely on the Jackson-based metadata
    }

    private static String getEnumValueName(Enum<?> value, ObjectMapper mapper) {
        try {
            Field field = value.getDeclaringClass().getField(value.name());
            JsonProperty prop = field.getAnnotation(JsonProperty.class);
            if (prop != null && !prop.value().isEmpty()) {
                return prop.value();
            }
        } catch (NoSuchFieldException e) {
            // Fall through
        }

        // Use Jackson's naming strategy
        return value.name();
    }

    private static String getTypeName(Class<?> type) {
        if (type.isArray()) {
            return getTypeName(type.getComponentType()) + "Array";
        }
        return type.getSimpleName();
    }

    private static String getFriendlyTypeName(Class<?> type) {
        if (type.isArray()) {
            return getFriendlyTypeName(type.getComponentType()) + "[]";
        }
        String name = type.getSimpleName();

        // Handle generic types
        TypeVariable<?>[] typeParams = type.getTypeParameters();
        if (typeParams.length > 0) {
            StringBuilder sb = new StringBuilder(name);
            sb.append("<");
            for (int i = 0; i < typeParams.length; i++) {
                if (i > 0) sb.append(", ");
                sb.append(typeParams[i].getName());
            }
            sb.append(">");
            return sb.toString();
        }

        return name;
    }

    private static ObjectNode applyTransform(ObjectNode schema, Class<?> type,
                                              Field field, Method method, String path,
                                              JsonStructureSchemaExporterOptions options) {
        if (options.getSchemaTransformer() == null) {
            return schema;
        }

        JsonStructureSchemaExporterContext context =
                new JsonStructureSchemaExporterContext(type, field, method, path);

        return options.getSchemaTransformer().transform(context, schema);
    }
}
