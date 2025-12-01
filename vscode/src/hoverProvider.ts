import * as vscode from 'vscode';
import { SchemaCache } from './schemaCache';

/**
 * Type documentation from the JSON Structure spec
 */
const TYPE_DOCUMENTATION: Record<string, { summary: string; details: string }> = {
    // Primitive types
    string: {
        summary: 'Unicode string',
        details: 'A sequence of Unicode characters. Supports constraints: minLength, maxLength, pattern, format.'
    },
    number: {
        summary: 'JSON number (float64)',
        details: 'A double-precision floating-point number. Supports constraints: minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf.'
    },
    integer: {
        summary: 'Arbitrary precision integer',
        details: 'An integer of arbitrary precision, serialized as a JSON number or string if very large.'
    },
    boolean: {
        summary: 'Boolean value',
        details: 'A true or false value.'
    },
    null: {
        summary: 'Null value',
        details: 'The JSON null value. Often used in union types like ["string", "null"] for optional values.'
    },
    binary: {
        summary: 'Base64-encoded binary data',
        details: 'Binary data encoded as a base64 string. Use contentEncoding to specify encoding variant.'
    },
    int8: {
        summary: 'Signed 8-bit integer',
        details: 'Range: -128 to 127. Serialized as JSON number.'
    },
    uint8: {
        summary: 'Unsigned 8-bit integer',
        details: 'Range: 0 to 255. Serialized as JSON number.'
    },
    int16: {
        summary: 'Signed 16-bit integer',
        details: 'Range: -32,768 to 32,767. Serialized as JSON number.'
    },
    uint16: {
        summary: 'Unsigned 16-bit integer',
        details: 'Range: 0 to 65,535. Serialized as JSON number.'
    },
    int32: {
        summary: 'Signed 32-bit integer',
        details: 'Range: -2,147,483,648 to 2,147,483,647. Serialized as JSON number.'
    },
    uint32: {
        summary: 'Unsigned 32-bit integer',
        details: 'Range: 0 to 4,294,967,295. Serialized as JSON number.'
    },
    int64: {
        summary: 'Signed 64-bit integer',
        details: 'Range: -9,223,372,036,854,775,808 to 9,223,372,036,854,775,807. Serialized as JSON string to preserve precision.'
    },
    uint64: {
        summary: 'Unsigned 64-bit integer',
        details: 'Range: 0 to 18,446,744,073,709,551,615. Serialized as JSON string to preserve precision.'
    },
    int128: {
        summary: 'Signed 128-bit integer',
        details: 'Very large integer range. Serialized as JSON string to preserve precision.'
    },
    uint128: {
        summary: 'Unsigned 128-bit integer',
        details: 'Very large unsigned integer range. Serialized as JSON string to preserve precision.'
    },
    float: {
        summary: 'Single-precision float (float32)',
        details: 'A 32-bit IEEE 754 floating-point number. Serialized as JSON number.'
    },
    float8: {
        summary: '8-bit floating point',
        details: 'A compact 8-bit floating-point representation.'
    },
    double: {
        summary: 'Double-precision float (float64)',
        details: 'A 64-bit IEEE 754 floating-point number. Serialized as JSON number.'
    },
    decimal: {
        summary: 'Arbitrary precision decimal',
        details: 'An exact decimal number. Serialized as JSON string. Supports precision and scale constraints.'
    },
    date: {
        summary: 'ISO 8601 date',
        details: 'A date without time, formatted as YYYY-MM-DD (e.g., "2024-01-15").'
    },
    datetime: {
        summary: 'ISO 8601 date-time',
        details: 'A date with time and timezone, formatted as YYYY-MM-DDTHH:MM:SSZ (e.g., "2024-01-15T14:30:00Z").'
    },
    time: {
        summary: 'ISO 8601 time',
        details: 'A time without date, formatted as HH:MM:SS (e.g., "14:30:00").'
    },
    duration: {
        summary: 'ISO 8601 duration',
        details: 'A time duration, formatted as PnYnMnDTnHnMnS (e.g., "P1Y2M3DT4H5M6S" for 1 year, 2 months, 3 days, 4 hours, 5 minutes, 6 seconds).'
    },
    uuid: {
        summary: 'UUID/GUID',
        details: 'A Universally Unique Identifier in standard format (e.g., "550e8400-e29b-41d4-a716-446655440000").'
    },
    uri: {
        summary: 'URI/URL',
        details: 'A Uniform Resource Identifier (e.g., "https://example.com/path").'
    },
    jsonpointer: {
        summary: 'JSON Pointer',
        details: 'A JSON Pointer reference (RFC 6901), e.g., "#/definitions/MyType".'
    },
    // Compound types
    object: {
        summary: 'Object with named properties',
        details: 'A JSON object with defined properties. Requires "properties" keyword. Supports required, additionalProperties, $extends.'
    },
    array: {
        summary: 'Ordered list of items',
        details: 'A JSON array where all items conform to a single schema. Requires "items" keyword. Supports minItems, maxItems, uniqueItems.'
    },
    set: {
        summary: 'Unordered collection of unique items',
        details: 'Like an array, but items must be unique. Serialized as JSON array. Requires "items" keyword.'
    },
    map: {
        summary: 'Dictionary with string keys',
        details: 'A JSON object used as a dictionary with arbitrary string keys. Requires "values" keyword to define the value schema.'
    },
    tuple: {
        summary: 'Fixed-length typed array',
        details: 'A JSON array with a fixed number of elements, each with its own schema. Requires "prefixItems" keyword.'
    },
    choice: {
        summary: 'Discriminated union (tagged union)',
        details: 'A type that can be one of several variants, selected by a discriminator property. Requires "selector" and "choices" keywords.'
    },
    any: {
        summary: 'Any JSON value',
        details: 'Accepts any valid JSON value: string, number, boolean, null, object, or array.'
    },
};

/**
 * Keyword documentation
 */
const KEYWORD_DOCUMENTATION: Record<string, { summary: string; details: string }> = {
    $schema: {
        summary: 'Metaschema URI',
        details: 'Identifies the JSON Structure metaschema this document conforms to. Typically "https://json-structure.org/meta/core/v0/#" for core schemas.'
    },
    $id: {
        summary: 'Schema identifier',
        details: 'A unique URI that identifies this schema. Used for referencing this schema from other documents.'
    },
    name: {
        summary: 'Schema or type name',
        details: 'A human-readable name for the schema or type. Used for documentation and code generation.'
    },
    description: {
        summary: 'Description',
        details: 'A human-readable description of the schema, type, or property.'
    },
    type: {
        summary: 'Type specifier',
        details: 'Specifies the data type. Can be a primitive type name, compound type name, or array for union types.'
    },
    $root: {
        summary: 'Root type reference',
        details: 'A JSON Pointer to the definition that serves as the root type of this schema. Alternative to defining type at the root level.'
    },
    $ref: {
        summary: 'Type reference',
        details: 'A JSON Pointer reference to a type definition. Example: "#/definitions/MyType"'
    },
    definitions: {
        summary: 'Type definitions',
        details: 'A collection of named type definitions that can be referenced using $ref.'
    },
    properties: {
        summary: 'Object properties',
        details: 'Defines the properties of an object type. Each property has a name and a schema.'
    },
    required: {
        summary: 'Required properties',
        details: 'An array of property names that must be present in instances of this object type.'
    },
    additionalProperties: {
        summary: 'Additional properties control',
        details: 'Controls whether properties not defined in "properties" are allowed. Can be boolean or a schema for additional properties.'
    },
    $extends: {
        summary: 'Type inheritance',
        details: 'Specifies a base type that this type extends. The base type must be an abstract object type. Properties are inherited.'
    },
    abstract: {
        summary: 'Abstract type marker',
        details: 'When true, this type cannot be instantiated directly and must be extended by other types.'
    },
    items: {
        summary: 'Array/Set item schema',
        details: 'Defines the schema for items in an array or set.'
    },
    values: {
        summary: 'Map value schema',
        details: 'Defines the schema for values in a map (dictionary).'
    },
    prefixItems: {
        summary: 'Tuple element schemas',
        details: 'An array of schemas, one for each element position in the tuple.'
    },
    selector: {
        summary: 'Choice discriminator',
        details: 'The property name used to determine which variant of a choice type to use.'
    },
    choices: {
        summary: 'Choice variants',
        details: 'An object mapping discriminator values to their corresponding type schemas.'
    },
    enum: {
        summary: 'Enumeration values',
        details: 'An array of allowed values. The instance must match one of these values exactly.'
    },
    const: {
        summary: 'Constant value',
        details: 'The instance must be exactly equal to this value.'
    },
    default: {
        summary: 'Default value',
        details: 'The default value to use when this property is not provided.'
    },
    examples: {
        summary: 'Example values',
        details: 'An array of example values for documentation purposes.'
    },
    deprecated: {
        summary: 'Deprecation marker',
        details: 'When true, indicates this type or property is deprecated and should not be used.'
    },
    // Constraints
    minLength: {
        summary: 'Minimum string length',
        details: 'The minimum length of a string value (inclusive).'
    },
    maxLength: {
        summary: 'Maximum string length',
        details: 'The maximum length of a string value (inclusive).'
    },
    pattern: {
        summary: 'Regular expression pattern',
        details: 'A regular expression that string values must match.'
    },
    format: {
        summary: 'String format',
        details: 'A semantic format hint for the string (e.g., "email", "hostname").'
    },
    minimum: {
        summary: 'Minimum value',
        details: 'The minimum numeric value (inclusive).'
    },
    maximum: {
        summary: 'Maximum value',
        details: 'The maximum numeric value (inclusive).'
    },
    exclusiveMinimum: {
        summary: 'Exclusive minimum',
        details: 'The minimum numeric value (exclusive - value must be greater than this).'
    },
    exclusiveMaximum: {
        summary: 'Exclusive maximum',
        details: 'The maximum numeric value (exclusive - value must be less than this).'
    },
    multipleOf: {
        summary: 'Multiple of constraint',
        details: 'The numeric value must be a multiple of this number.'
    },
    precision: {
        summary: 'Decimal precision',
        details: 'The total number of significant digits for a decimal type.'
    },
    scale: {
        summary: 'Decimal scale',
        details: 'The number of digits after the decimal point for a decimal type.'
    },
    minItems: {
        summary: 'Minimum items',
        details: 'The minimum number of items in an array or set.'
    },
    maxItems: {
        summary: 'Maximum items',
        details: 'The maximum number of items in an array or set.'
    },
    uniqueItems: {
        summary: 'Unique items constraint',
        details: 'When true, all items in the array must be unique.'
    },
    contentEncoding: {
        summary: 'Content encoding',
        details: 'The encoding used for binary content (e.g., "base64", "base64url").'
    },
    contentMediaType: {
        summary: 'Content media type',
        details: 'The MIME type of the content (e.g., "application/json", "image/png").'
    },
};

/**
 * Provides hover information for JSON Structure documents
 */
export class JsonStructureHoverProvider implements vscode.HoverProvider {
    private schemaCache: SchemaCache;

    constructor(schemaCache: SchemaCache) {
        this.schemaCache = schemaCache;
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const text = document.getText();
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_$]+/);
        
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const lineText = document.lineAt(position.line).text;
        
        // Parse the document to get context
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(text);
        } catch {
            return undefined;
        }

        const isSchemaDocument = this.isSchemaDocument(document, parsed);

        // Check if we're hovering over a property name (in quotes before a colon)
        const isPropertyName = this.isPropertyName(lineText, position.character, word);
        
        // Check if we're hovering over a type value
        const isTypeValue = this.isTypeValue(lineText, position.character, word);

        if (isSchemaDocument) {
            // Schema document hover
            if (isPropertyName) {
                // Hovering over a keyword
                const doc = KEYWORD_DOCUMENTATION[word];
                if (doc) {
                    return this.createHover(doc.summary, doc.details);
                }
            } else if (isTypeValue) {
                // Hovering over a type name
                const doc = TYPE_DOCUMENTATION[word];
                if (doc) {
                    return this.createHover(`Type: ${word}`, doc.details);
                }
            }

            // Check if hovering over a $ref value
            if (word.startsWith('#') || lineText.includes('"$ref"') || lineText.includes('"$extends"') || lineText.includes('"$root"')) {
                const refMatch = lineText.match(/"#\/definitions\/([^"]+)"/);
                if (refMatch) {
                    const defName = refMatch[1];
                    const defSchema = this.getDefinition(parsed, defName);
                    if (defSchema) {
                        return this.createDefinitionHover(defName, defSchema);
                    }
                }
            }
        } else {
            // Instance document hover - show schema info
            return await this.getInstanceHover(document, parsed, position, word);
        }

        return undefined;
    }

    private isSchemaDocument(document: vscode.TextDocument, parsed: Record<string, unknown>): boolean {
        if (document.fileName.endsWith('.struct.json')) {
            return true;
        }
        if (parsed.$schema && typeof parsed.$schema === 'string' && 
            parsed.$schema.includes('json-structure.org/meta')) {
            return true;
        }
        return false;
    }

    private isPropertyName(lineText: string, charPosition: number, word: string): boolean {
        // Find the word in the line and check if it's followed by a colon
        const wordIndex = lineText.indexOf(`"${word}"`);
        if (wordIndex === -1) return false;
        
        const afterWord = lineText.substring(wordIndex + word.length + 2).trim();
        return afterWord.startsWith(':');
    }

    private isTypeValue(lineText: string, _charPosition: number, word: string): boolean {
        // Check if this is a type value (after "type":)
        const typeMatch = lineText.match(/"type"\s*:\s*"([^"]+)"/);
        if (typeMatch && typeMatch[1] === word) {
            return true;
        }
        
        // Check if in a type array
        if (lineText.includes('"type"') && lineText.includes('[')) {
            return TYPE_DOCUMENTATION[word] !== undefined;
        }
        
        return false;
    }

    private getDefinition(schema: Record<string, unknown>, name: string): Record<string, unknown> | null {
        // JSON Structure uses 'definitions' (not JSON Schema's '$defs')
        if (schema.definitions && typeof schema.definitions === 'object') {
            const defs = schema.definitions as Record<string, unknown>;
            if (defs[name] && typeof defs[name] === 'object') {
                return defs[name] as Record<string, unknown>;
            }
        }
        return null;
    }

    private createHover(title: string, details: string): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**${title}**\n\n`);
        markdown.appendMarkdown(details);
        return new vscode.Hover(markdown);
    }

    private createDefinitionHover(name: string, schema: Record<string, unknown>): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**Definition: ${name}**\n\n`);
        
        if (schema.description && typeof schema.description === 'string') {
            markdown.appendMarkdown(`${schema.description}\n\n`);
        }
        
        if (schema.type) {
            markdown.appendMarkdown(`Type: \`${JSON.stringify(schema.type)}\`\n\n`);
        }
        
        if (schema.abstract === true) {
            markdown.appendMarkdown(`*Abstract type*\n\n`);
        }
        
        if (schema.properties && typeof schema.properties === 'object') {
            const props = Object.keys(schema.properties);
            if (props.length > 0) {
                markdown.appendMarkdown(`Properties: ${props.slice(0, 5).map(p => `\`${p}\``).join(', ')}`);
                if (props.length > 5) {
                    markdown.appendMarkdown(` ... and ${props.length - 5} more`);
                }
            }
        }
        
        return new vscode.Hover(markdown);
    }

    private async getInstanceHover(
        document: vscode.TextDocument,
        parsed: Record<string, unknown>,
        position: vscode.Position,
        word: string
    ): Promise<vscode.Hover | undefined> {
        if (!parsed.$schema || typeof parsed.$schema !== 'string') {
            return undefined;
        }

        // Fetch the schema
        const schemaResult = await this.schemaCache.getSchema(parsed.$schema, document.uri);
        if (!schemaResult.schema) {
            return undefined;
        }

        const schema = schemaResult.schema as Record<string, unknown>;
        
        // Find the current path and get schema info
        const lineText = document.lineAt(position.line).text;
        const isPropertyName = this.isPropertyName(lineText, position.character, word);
        
        if (isPropertyName) {
            // Find the property in the schema
            const path = this.findPathToPosition(document.getText(), document.offsetAt(position));
            const propSchema = this.getPropertySchema(schema, path, word);
            
            if (propSchema) {
                return this.createPropertyHover(word, propSchema, schema);
            }
        }
        
        return undefined;
    }

    private findPathToPosition(text: string, offset: number): string[] {
        const path: string[] = [];
        const beforeCursor = text.substring(0, offset);
        
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
                }
            }
        }
        
        return path;
    }

    private getPropertySchema(
        schema: Record<string, unknown>,
        path: string[],
        propertyName: string
    ): Record<string, unknown> | null {
        let current: Record<string, unknown> = schema;
        
        // Handle $root reference
        if (current.$root && typeof current.$root === 'string') {
            const resolved = this.resolveRef(current.$root, schema);
            if (resolved) {
                current = resolved;
            }
        }

        // Navigate to the current path
        for (const segment of path) {
            if (current.properties && typeof current.properties === 'object') {
                const props = current.properties as Record<string, unknown>;
                if (props[segment] && typeof props[segment] === 'object') {
                    current = props[segment] as Record<string, unknown>;
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

        // Now look for the property
        if (current.properties && typeof current.properties === 'object') {
            const props = current.properties as Record<string, unknown>;
            if (props[propertyName] && typeof props[propertyName] === 'object') {
                let propSchema = props[propertyName] as Record<string, unknown>;
                if (propSchema.$ref && typeof propSchema.$ref === 'string') {
                    const resolved = this.resolveRef(propSchema.$ref, schema);
                    if (resolved) {
                        propSchema = { ...resolved, ...propSchema };
                    }
                }
                return propSchema;
            }
        }

        return null;
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

    private createPropertyHover(
        name: string,
        propSchema: Record<string, unknown>,
        _rootSchema: Record<string, unknown>
    ): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**Property: ${name}**\n\n`);
        
        if (propSchema.description && typeof propSchema.description === 'string') {
            markdown.appendMarkdown(`${propSchema.description}\n\n`);
        }
        
        if (propSchema.type) {
            const typeStr = typeof propSchema.type === 'string' 
                ? propSchema.type 
                : JSON.stringify(propSchema.type);
            markdown.appendMarkdown(`Type: \`${typeStr}\`\n\n`);
            
            // Add type documentation
            if (typeof propSchema.type === 'string' && TYPE_DOCUMENTATION[propSchema.type]) {
                markdown.appendMarkdown(`*${TYPE_DOCUMENTATION[propSchema.type].summary}*\n\n`);
            }
        }
        
        if (propSchema.enum && Array.isArray(propSchema.enum)) {
            markdown.appendMarkdown(`Allowed values: ${propSchema.enum.map(v => `\`${v}\``).join(', ')}\n\n`);
        }
        
        if (propSchema.const !== undefined) {
            markdown.appendMarkdown(`Constant value: \`${JSON.stringify(propSchema.const)}\`\n\n`);
        }
        
        if (propSchema.default !== undefined) {
            markdown.appendMarkdown(`Default: \`${JSON.stringify(propSchema.default)}\`\n\n`);
        }
        
        if (propSchema.deprecated === true) {
            markdown.appendMarkdown(`⚠️ *Deprecated*\n\n`);
        }
        
        return new vscode.Hover(markdown);
    }
}
