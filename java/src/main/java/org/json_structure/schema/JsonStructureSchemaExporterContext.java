// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package org.json_structure.schema;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

/**
 * Context provided to schema transformation callbacks.
 */
public final class JsonStructureSchemaExporterContext {

    private final Class<?> type;
    private final Field field;
    private final Method method;
    private final String path;

    /**
     * Creates a new context.
     *
     * @param type   the type being processed
     * @param field  the field being processed (may be null)
     * @param method the getter method being processed (may be null)
     * @param path   the path in the schema
     */
    public JsonStructureSchemaExporterContext(Class<?> type, Field field, Method method, String path) {
        this.type = type;
        this.field = field;
        this.method = method;
        this.path = path;
    }

    /**
     * Gets the type being processed.
     *
     * @return the type
     */
    public Class<?> getType() {
        return type;
    }

    /**
     * Gets the field being processed, if any.
     *
     * @return the field, or null
     */
    public Field getField() {
        return field;
    }

    /**
     * Gets the getter method being processed, if any.
     *
     * @return the method, or null
     */
    public Method getMethod() {
        return method;
    }

    /**
     * Gets the path in the schema.
     *
     * @return the path
     */
    public String getPath() {
        return path;
    }

    /**
     * Returns whether this is the root schema.
     *
     * @return true if this is the root
     */
    public boolean isRoot() {
        return path == null || path.isEmpty();
    }
}
