import * as vscode from 'vscode';
import { SchemaCache } from './schemaCache';

/**
 * JSON Structure primitive types
 */
const PRIMITIVE_TYPES = [
    { label: 'string', description: 'A Unicode string' },
    { label: 'number', description: 'A JSON number (float64)' },
    { label: 'integer', description: 'An arbitrary precision integer' },
    { label: 'boolean', description: 'A boolean value (true/false)' },
    { label: 'null', description: 'A null value' },
    { label: 'binary', description: 'Base64-encoded binary data' },
    { label: 'int8', description: 'Signed 8-bit integer (-128 to 127)' },
    { label: 'uint8', description: 'Unsigned 8-bit integer (0 to 255)' },
    { label: 'int16', description: 'Signed 16-bit integer' },
    { label: 'uint16', description: 'Unsigned 16-bit integer' },
    { label: 'int32', description: 'Signed 32-bit integer' },
    { label: 'uint32', description: 'Unsigned 32-bit integer' },
    { label: 'int64', description: 'Signed 64-bit integer (serialized as string)' },
    { label: 'uint64', description: 'Unsigned 64-bit integer (serialized as string)' },
    { label: 'int128', description: 'Signed 128-bit integer (serialized as string)' },
    { label: 'uint128', description: 'Unsigned 128-bit integer (serialized as string)' },
    { label: 'float', description: 'Single-precision floating point (float32)' },
    { label: 'float8', description: '8-bit floating point' },
    { label: 'double', description: 'Double-precision floating point (float64)' },
    { label: 'decimal', description: 'Arbitrary precision decimal (serialized as string)' },
    { label: 'date', description: 'ISO 8601 date (YYYY-MM-DD)' },
    { label: 'datetime', description: 'ISO 8601 date-time with timezone' },
    { label: 'time', description: 'ISO 8601 time (HH:MM:SS)' },
    { label: 'duration', description: 'ISO 8601 duration (e.g., P1Y2M3D)' },
    { label: 'uuid', description: 'UUID/GUID string' },
    { label: 'uri', description: 'URI/URL string' },
    { label: 'jsonpointer', description: 'JSON Pointer string' },
];

/**
 * JSON Structure compound types
 */
const COMPOUND_TYPES = [
    { label: 'object', description: 'An object with named properties' },
    { label: 'array', description: 'An ordered list of items' },
    { label: 'map', description: 'A dictionary with string keys and typed values' },
    { label: 'set', description: 'An unordered collection of unique items' },
    { label: 'tuple', description: 'A fixed-length array with typed elements' },
    { label: 'choice', description: 'A discriminated union (tagged union)' },
    { label: 'any', description: 'Any JSON value' },
];

/**
 * All types combined
 */
const ALL_TYPES = [...PRIMITIVE_TYPES, ...COMPOUND_TYPES];

/**
 * Schema document top-level keywords
 */
const SCHEMA_DOCUMENT_KEYWORDS = [
    { label: '$schema', description: 'The JSON Structure metaschema URI', insertText: '"$schema": "https://json-structure.org/meta/core/v0/#"' },
    { label: '$id', description: 'The unique identifier (URI) for this schema', insertText: '"$id": "$1"' },
    { label: 'name', description: 'The name of the schema', insertText: '"name": "$1"' },
    { label: 'description', description: 'A description of the schema', insertText: '"description": "$1"' },
    { label: 'type', description: 'The type of the root value', insertText: '"type": "$1"' },
    { label: '$root', description: 'Reference to the root type definition', insertText: '"$root": "#/definitions/$1"' },
    { label: 'definitions', description: 'Named type definitions', insertText: '"definitions": {\n\t"$1": {\n\t\t"type": "$2"\n\t}\n}' },
    { label: '$defs', description: 'Named type definitions (alias for definitions)', insertText: '"$defs": {\n\t"$1": {\n\t\t"type": "$2"\n\t}\n}' },
];

/**
 * Object type keywords
 */
const OBJECT_KEYWORDS = [
    { label: 'type', description: 'The type (must be "object")', insertText: '"type": "object"' },
    { label: 'properties', description: 'The properties of the object', insertText: '"properties": {\n\t"$1": {\n\t\t"type": "$2"\n\t}\n}' },
    { label: 'required', description: 'List of required property names', insertText: '"required": ["$1"]' },
    { label: 'additionalProperties', description: 'Whether additional properties are allowed', insertText: '"additionalProperties": ${1|true,false|}' },
    { label: '$extends', description: 'Extend another object type', insertText: '"$extends": "#/definitions/$1"' },
    { label: 'abstract', description: 'Mark this type as abstract (not instantiable)', insertText: '"abstract": true' },
];

/**
 * Array/Set type keywords
 */
const ARRAY_KEYWORDS = [
    { label: 'type', description: 'The type (array or set)', insertText: '"type": "${1|array,set|}"' },
    { label: 'items', description: 'Schema for array/set items', insertText: '"items": {\n\t"type": "$1"\n}' },
    { label: 'minItems', description: 'Minimum number of items', insertText: '"minItems": $1' },
    { label: 'maxItems', description: 'Maximum number of items', insertText: '"maxItems": $1' },
    { label: 'uniqueItems', description: 'Whether items must be unique', insertText: '"uniqueItems": true' },
];

/**
 * Map type keywords
 */
const MAP_KEYWORDS = [
    { label: 'type', description: 'The type (must be "map")', insertText: '"type": "map"' },
    { label: 'values', description: 'Schema for map values', insertText: '"values": {\n\t"type": "$1"\n}' },
];

/**
 * Tuple type keywords
 */
const TUPLE_KEYWORDS = [
    { label: 'type', description: 'The type (must be "tuple")', insertText: '"type": "tuple"' },
    { label: 'prefixItems', description: 'Schemas for each tuple element', insertText: '"prefixItems": [\n\t{ "type": "$1" }\n]' },
];

/**
 * Choice type keywords
 */
const CHOICE_KEYWORDS = [
    { label: 'type', description: 'The type (must be "choice")', insertText: '"type": "choice"' },
    { label: 'selector', description: 'The property used to discriminate variants', insertText: '"selector": "$1"' },
    { label: 'choices', description: 'The variant types', insertText: '"choices": {\n\t"$1": { "$ref": "#/definitions/$2" }\n}' },
];

/**
 * String type constraints
 */
const STRING_CONSTRAINTS = [
    { label: 'minLength', description: 'Minimum string length', insertText: '"minLength": $1' },
    { label: 'maxLength', description: 'Maximum string length', insertText: '"maxLength": $1' },
    { label: 'pattern', description: 'Regular expression pattern', insertText: '"pattern": "$1"' },
    { label: 'format', description: 'Semantic format hint', insertText: '"format": "$1"' },
    { label: 'contentEncoding', description: 'Content encoding (e.g., base64)', insertText: '"contentEncoding": "${1|base64,base64url|}"' },
    { label: 'contentMediaType', description: 'MIME type of content', insertText: '"contentMediaType": "$1"' },
];

/**
 * Numeric type constraints
 */
const NUMERIC_CONSTRAINTS = [
    { label: 'minimum', description: 'Minimum value (inclusive)', insertText: '"minimum": $1' },
    { label: 'maximum', description: 'Maximum value (inclusive)', insertText: '"maximum": $1' },
    { label: 'exclusiveMinimum', description: 'Minimum value (exclusive)', insertText: '"exclusiveMinimum": $1' },
    { label: 'exclusiveMaximum', description: 'Maximum value (exclusive)', insertText: '"exclusiveMaximum": $1' },
    { label: 'multipleOf', description: 'Value must be multiple of this', insertText: '"multipleOf": $1' },
    { label: 'precision', description: 'Number of significant digits', insertText: '"precision": $1' },
    { label: 'scale', description: 'Number of decimal places', insertText: '"scale": $1' },
];

/**
 * Common property keywords
 */
const PROPERTY_KEYWORDS = [
    { label: 'type', description: 'The type of the property' },
    { label: 'description', description: 'A description of the property', insertText: '"description": "$1"' },
    { label: 'default', description: 'Default value for the property', insertText: '"default": $1' },
    { label: 'const', description: 'Fixed constant value', insertText: '"const": $1' },
    { label: 'enum', description: 'List of allowed values', insertText: '"enum": [$1]' },
    { label: 'examples', description: 'Example values', insertText: '"examples": [$1]' },
    { label: '$ref', description: 'Reference to a type definition', insertText: '"$ref": "#/definitions/$1"' },
    { label: 'deprecated', description: 'Mark as deprecated', insertText: '"deprecated": true' },
];

interface JsonContext {
    isSchemaDocument: boolean;
    currentPath: string[];
    parentType: string | null;
    inPropertyValue: boolean;
    propertyName: string | null;
    schema: unknown;
    definitions: Map<string, unknown>;
}

/**
 * Provides IntelliSense completions for JSON Structure documents
 */
export class JsonStructureCompletionProvider implements vscode.CompletionItemProvider {
    private schemaCache: SchemaCache;

    constructor(schemaCache: SchemaCache) {
        this.schemaCache = schemaCache;
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | undefined> {
        const text = document.getText();
        const offset = document.offsetAt(position);
        
        // Parse the document
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            // Try to parse partial document
            parsed = this.parsePartialJson(text, offset);
        }

        const context = this.analyzeContext(text, offset, parsed);
        const items: vscode.CompletionItem[] = [];

        if (context.isSchemaDocument) {
            // Schema document completions
            items.push(...this.getSchemaCompletions(context, position));
        } else {
            // Instance document completions
            items.push(...await this.getInstanceCompletions(document, context, position));
        }

        return items;
    }

    private parsePartialJson(text: string, _offset: number): unknown {
        // Try to parse the document, handling incomplete JSON
        try {
            return JSON.parse(text);
        } catch {
            // Simple fallback - just try to extract what we can
            return null;
        }
    }

    private analyzeContext(text: string, offset: number, parsed: unknown): JsonContext {
        const context: JsonContext = {
            isSchemaDocument: false,
            currentPath: [],
            parentType: null,
            inPropertyValue: false,
            propertyName: null,
            schema: parsed,
            definitions: new Map(),
        };

        // Check if this is a schema document (has .struct.json extension or $schema pointing to metaschema)
        if (parsed && typeof parsed === 'object' && parsed !== null) {
            const obj = parsed as Record<string, unknown>;
            if (obj.$schema && typeof obj.$schema === 'string' && obj.$schema.includes('json-structure.org/meta')) {
                context.isSchemaDocument = true;
            }
            // Extract definitions
            if (obj.definitions && typeof obj.definitions === 'object') {
                for (const [name, def] of Object.entries(obj.definitions as Record<string, unknown>)) {
                    context.definitions.set(name, def);
                }
            }
            if (obj.$defs && typeof obj.$defs === 'object') {
                for (const [name, def] of Object.entries(obj.$defs as Record<string, unknown>)) {
                    context.definitions.set(name, def);
                }
            }
        }

        // Analyze the current position to determine context
        const beforeCursor = text.substring(0, offset);
        
        // Check if we're in a property value position (after a colon)
        const lastColon = beforeCursor.lastIndexOf(':');
        const lastComma = beforeCursor.lastIndexOf(',');
        const lastOpenBrace = beforeCursor.lastIndexOf('{');
        const lastCloseBrace = beforeCursor.lastIndexOf('}');
        
        if (lastColon > lastComma && lastColon > lastOpenBrace) {
            context.inPropertyValue = true;
            // Find the property name before the colon
            const beforeColon = beforeCursor.substring(0, lastColon);
            const propMatch = beforeColon.match(/"([^"]+)"\s*$/);
            if (propMatch) {
                context.propertyName = propMatch[1];
            }
        }

        // Determine the current path and parent type
        context.currentPath = this.findCurrentPath(text, offset);
        context.parentType = this.findParentType(parsed, context.currentPath);

        return context;
    }

    private findCurrentPath(text: string, offset: number): string[] {
        const path: string[] = [];
        const beforeCursor = text.substring(0, offset);
        
        // Simple path tracking based on brace/bracket matching
        let depth = 0;
        let inString = false;
        let currentKey = '';
        let keyStart = -1;
        
        for (let i = 0; i < beforeCursor.length; i++) {
            const char = beforeCursor[i];
            
            if (char === '"' && (i === 0 || beforeCursor[i - 1] !== '\\')) {
                inString = !inString;
                if (inString) {
                    keyStart = i + 1;
                } else if (keyStart >= 0) {
                    currentKey = beforeCursor.substring(keyStart, i);
                    keyStart = -1;
                }
            } else if (!inString) {
                if (char === '{' || char === '[') {
                    if (currentKey) {
                        path.push(currentKey);
                        currentKey = '';
                    }
                    depth++;
                } else if (char === '}' || char === ']') {
                    depth--;
                    if (path.length > depth) {
                        path.pop();
                    }
                } else if (char === ':') {
                    // Current key is the last parsed string
                }
            }
        }
        
        return path;
    }

    private findParentType(parsed: unknown, path: string[]): string | null {
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        let current: unknown = parsed;
        for (let i = 0; i < path.length - 1; i++) {
            if (current && typeof current === 'object' && current !== null) {
                current = (current as Record<string, unknown>)[path[i]];
            } else {
                return null;
            }
        }

        if (current && typeof current === 'object' && current !== null) {
            const obj = current as Record<string, unknown>;
            if (typeof obj.type === 'string') {
                return obj.type;
            }
        }

        return null;
    }

    private getSchemaCompletions(context: JsonContext, _position: vscode.Position): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        if (context.inPropertyValue) {
            // Completing a property value
            if (context.propertyName === 'type') {
                // Suggest types
                for (const type of ALL_TYPES) {
                    const item = new vscode.CompletionItem(type.label, vscode.CompletionItemKind.TypeParameter);
                    item.detail = type.description;
                    item.insertText = `"${type.label}"`;
                    items.push(item);
                }
            } else if (context.propertyName === '$ref' || context.propertyName === '$extends' || context.propertyName === '$root') {
                // Suggest definition references
                for (const [name, def] of context.definitions) {
                    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Reference);
                    if (def && typeof def === 'object') {
                        const defObj = def as Record<string, unknown>;
                        if (typeof defObj.description === 'string') {
                            item.detail = defObj.description;
                        }
                    }
                    item.insertText = `"#/definitions/${name}"`;
                    items.push(item);
                }
            }
        } else {
            // Completing a property name
            const keywordSource = this.getKeywordsForContext(context);
            
            for (const kw of keywordSource) {
                const item = new vscode.CompletionItem(kw.label, vscode.CompletionItemKind.Property);
                item.detail = kw.description;
                if (kw.insertText) {
                    item.insertText = new vscode.SnippetString(kw.insertText);
                }
                items.push(item);
            }
        }

        return items;
    }

    private getKeywordsForContext(context: JsonContext): Array<{label: string; description: string; insertText?: string}> {
        const path = context.currentPath;
        
        // Root level of schema document
        if (path.length === 0) {
            return SCHEMA_DOCUMENT_KEYWORDS;
        }

        // Inside definitions
        if (path.includes('definitions') || path.includes('$defs')) {
            // At the definition level, offer type keywords
            return [...PROPERTY_KEYWORDS, ...OBJECT_KEYWORDS];
        }

        // Inside properties
        if (path.includes('properties')) {
            return [...PROPERTY_KEYWORDS, ...STRING_CONSTRAINTS, ...NUMERIC_CONSTRAINTS];
        }

        // Based on parent type
        switch (context.parentType) {
            case 'object':
                return OBJECT_KEYWORDS;
            case 'array':
            case 'set':
                return ARRAY_KEYWORDS;
            case 'map':
                return MAP_KEYWORDS;
            case 'tuple':
                return TUPLE_KEYWORDS;
            case 'choice':
                return CHOICE_KEYWORDS;
            case 'string':
                return STRING_CONSTRAINTS;
            case 'number':
            case 'integer':
            case 'int8':
            case 'int16':
            case 'int32':
            case 'int64':
            case 'uint8':
            case 'uint16':
            case 'uint32':
            case 'uint64':
            case 'float':
            case 'double':
            case 'decimal':
                return NUMERIC_CONSTRAINTS;
            default:
                return PROPERTY_KEYWORDS;
        }
    }

    private async getInstanceCompletions(
        document: vscode.TextDocument,
        context: JsonContext,
        _position: vscode.Position
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];
        
        // Get the schema for this instance
        const text = document.getText();
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(text);
        } catch {
            return items;
        }

        if (!parsed.$schema || typeof parsed.$schema !== 'string') {
            return items;
        }

        // Fetch the schema
        const schemaResult = await this.schemaCache.getSchema(parsed.$schema as string, document.uri);
        if (!schemaResult.schema) {
            return items;
        }

        const schema = schemaResult.schema as Record<string, unknown>;
        
        // Navigate to the current position in the schema
        const schemaAtPath = this.getSchemaAtPath(schema, context.currentPath);
        if (!schemaAtPath) {
            return items;
        }

        if (context.inPropertyValue) {
            // Suggest values based on schema
            items.push(...this.getValueCompletions(schemaAtPath, context.propertyName));
        } else {
            // Suggest property names based on schema
            items.push(...this.getPropertyCompletions(schemaAtPath, schema));
        }

        return items;
    }

    private getSchemaAtPath(schema: Record<string, unknown>, path: string[]): Record<string, unknown> | null {
        let current: Record<string, unknown> = schema;
        
        // Handle $root reference
        if (current.$root && typeof current.$root === 'string') {
            const resolved = this.resolveRef(current.$root, schema);
            if (resolved) {
                current = resolved;
            }
        }

        for (const segment of path) {
            if (current.properties && typeof current.properties === 'object') {
                const props = current.properties as Record<string, unknown>;
                if (props[segment] && typeof props[segment] === 'object') {
                    current = props[segment] as Record<string, unknown>;
                    // Resolve $ref if present
                    if (current.$ref && typeof current.$ref === 'string') {
                        const resolved = this.resolveRef(current.$ref, schema);
                        if (resolved) {
                            current = resolved;
                        }
                    }
                    continue;
                }
            }
            return null;
        }

        return current;
    }

    private resolveRef(ref: string, schema: Record<string, unknown>): Record<string, unknown> | null {
        if (!ref.startsWith('#/')) {
            return null;
        }

        const parts = ref.substring(2).split('/');
        let current: unknown = schema;

        for (const part of parts) {
            if (current && typeof current === 'object' && current !== null) {
                current = (current as Record<string, unknown>)[part];
            } else {
                return null;
            }
        }

        return current as Record<string, unknown> | null;
    }

    private getPropertyCompletions(schemaAtPath: Record<string, unknown>, rootSchema: Record<string, unknown>): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        if (schemaAtPath.properties && typeof schemaAtPath.properties === 'object') {
            const props = schemaAtPath.properties as Record<string, unknown>;
            const required = Array.isArray(schemaAtPath.required) ? schemaAtPath.required : [];

            for (const [name, propSchema] of Object.entries(props)) {
                if (!propSchema || typeof propSchema !== 'object') continue;
                
                let resolvedSchema = propSchema as Record<string, unknown>;
                if (resolvedSchema.$ref && typeof resolvedSchema.$ref === 'string') {
                    const resolved = this.resolveRef(resolvedSchema.$ref, rootSchema);
                    if (resolved) {
                        resolvedSchema = { ...resolved, ...resolvedSchema };
                    }
                }

                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
                
                if (typeof resolvedSchema.description === 'string') {
                    item.detail = resolvedSchema.description;
                }

                if (required.includes(name)) {
                    item.detail = (item.detail || '') + ' (required)';
                    item.sortText = '0' + name; // Required properties first
                } else {
                    item.sortText = '1' + name;
                }

                // Generate insert text based on type
                const insertText = this.generateInsertText(name, resolvedSchema);
                item.insertText = new vscode.SnippetString(insertText);

                items.push(item);
            }
        }

        return items;
    }

    private generateInsertText(name: string, schema: Record<string, unknown>): string {
        const type = schema.type;
        
        if (typeof type === 'string') {
            switch (type) {
                case 'string':
                    return `"${name}": "$1"`;
                case 'boolean':
                    return `"${name}": \${1|true,false|}`;
                case 'null':
                    return `"${name}": null`;
                case 'object':
                    return `"${name}": {\n\t$1\n}`;
                case 'array':
                case 'set':
                    return `"${name}": [\n\t$1\n]`;
                case 'number':
                case 'integer':
                case 'int8':
                case 'int16':
                case 'int32':
                case 'uint8':
                case 'uint16':
                case 'uint32':
                case 'float':
                case 'double':
                    return `"${name}": $1`;
                case 'int64':
                case 'uint64':
                case 'int128':
                case 'uint128':
                case 'decimal':
                    return `"${name}": "$1"`;
                default:
                    return `"${name}": $1`;
            }
        }

        return `"${name}": $1`;
    }

    private getValueCompletions(schemaAtPath: Record<string, unknown>, propertyName: string | null): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // Find the property schema
        let propSchema: Record<string, unknown> | null = null;
        if (propertyName && schemaAtPath.properties && typeof schemaAtPath.properties === 'object') {
            const props = schemaAtPath.properties as Record<string, unknown>;
            if (props[propertyName] && typeof props[propertyName] === 'object') {
                propSchema = props[propertyName] as Record<string, unknown>;
            }
        }

        if (!propSchema) {
            return items;
        }

        // Enum values
        if (Array.isArray(propSchema.enum)) {
            for (const value of propSchema.enum) {
                const item = new vscode.CompletionItem(
                    String(value),
                    vscode.CompletionItemKind.EnumMember
                );
                if (typeof value === 'string') {
                    item.insertText = `"${value}"`;
                } else {
                    item.insertText = String(value);
                }
                items.push(item);
            }
        }

        // Const value
        if (propSchema.const !== undefined) {
            const value = propSchema.const;
            const item = new vscode.CompletionItem(
                String(value),
                vscode.CompletionItemKind.Constant
            );
            item.detail = 'Required constant value';
            if (typeof value === 'string') {
                item.insertText = `"${value}"`;
            } else {
                item.insertText = String(value);
            }
            items.push(item);
        }

        // Boolean suggestions
        if (propSchema.type === 'boolean') {
            items.push(
                new vscode.CompletionItem('true', vscode.CompletionItemKind.Keyword),
                new vscode.CompletionItem('false', vscode.CompletionItemKind.Keyword)
            );
        }

        // Null suggestion
        if (propSchema.type === 'null' || (Array.isArray(propSchema.type) && propSchema.type.includes('null'))) {
            items.push(new vscode.CompletionItem('null', vscode.CompletionItemKind.Keyword));
        }

        return items;
    }
}
