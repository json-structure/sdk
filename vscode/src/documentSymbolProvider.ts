import * as vscode from 'vscode';

/**
 * Provides document symbols (outline) for JSON Structure schema documents
 */
export class JsonStructureDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.DocumentSymbol[] {
        const text = document.getText();
        const symbols: vscode.DocumentSymbol[] = [];

        // Parse the document
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(text);
        } catch {
            return symbols;
        }

        // Check if this is a schema document
        if (!this.isSchemaDocument(document, parsed)) {
            return symbols;
        }

        // Create the root symbol
        const schemaName = (parsed.name as string) || 'Schema';
        const rootRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(text.length)
        );
        
        const rootSymbol = new vscode.DocumentSymbol(
            schemaName,
            parsed.$id as string || '',
            vscode.SymbolKind.File,
            rootRange,
            rootRange
        );

        // Add type symbol if present at root
        if (parsed.type) {
            const typeSymbol = this.createTypeSymbol(document, text, 'type', parsed.type, parsed);
            if (typeSymbol) {
                rootSymbol.children.push(typeSymbol);
            }
        }

        // Add $root symbol if present
        if (parsed.$root && typeof parsed.$root === 'string') {
            const rootRefSymbol = this.findSymbolInText(document, text, '$root', parsed.$root);
            if (rootRefSymbol) {
                rootRefSymbol.kind = vscode.SymbolKind.Key;
                rootSymbol.children.push(rootRefSymbol);
            }
        }

        // Add definitions (JSON Structure uses 'definitions', not JSON Schema's '$defs')
        if (parsed.definitions && typeof parsed.definitions === 'object') {
            const defsSymbol = this.createDefinitionsSymbol(document, text, 'definitions', parsed.definitions);
            if (defsSymbol) {
                rootSymbol.children.push(defsSymbol);
            }
        }

        symbols.push(rootSymbol);
        return symbols;
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

    private createDefinitionsSymbol(
        document: vscode.TextDocument,
        text: string,
        key: string,
        definitions: unknown
    ): vscode.DocumentSymbol | null {
        if (!definitions || typeof definitions !== 'object') {
            return null;
        }

        const defsRange = this.findKeyRange(document, text, key);
        if (!defsRange) {
            return null;
        }

        const defsSymbol = new vscode.DocumentSymbol(
            key,
            `${Object.keys(definitions).length} definitions`,
            vscode.SymbolKind.Namespace,
            defsRange,
            defsRange
        );

        // Add each definition
        for (const [name, def] of Object.entries(definitions)) {
            if (!def || typeof def !== 'object') continue;
            
            const defObj = def as Record<string, unknown>;
            const defSymbol = this.createDefinitionSymbol(document, text, name, defObj);
            if (defSymbol) {
                defsSymbol.children.push(defSymbol);
            }
        }

        return defsSymbol;
    }

    private createDefinitionSymbol(
        document: vscode.TextDocument,
        text: string,
        name: string,
        def: Record<string, unknown>
    ): vscode.DocumentSymbol | null {
        const range = this.findDefinitionRange(document, text, name);
        if (!range) {
            return null;
        }

        // Determine symbol kind based on type
        let kind = vscode.SymbolKind.Class;
        let detail = '';

        if (def.type) {
            if (typeof def.type === 'string') {
                detail = def.type;
                kind = this.getSymbolKindForType(def.type);
            } else if (Array.isArray(def.type)) {
                detail = 'union';
                kind = vscode.SymbolKind.Enum;
            }
        }

        if (def.abstract === true) {
            detail = 'abstract ' + detail;
            kind = vscode.SymbolKind.Interface;
        }

        if (def.description && typeof def.description === 'string') {
            detail += detail ? ' - ' : '';
            detail += def.description.substring(0, 50);
            if (def.description.length > 50) {
                detail += '...';
            }
        }

        const symbol = new vscode.DocumentSymbol(
            name,
            detail,
            kind,
            range,
            range
        );

        // Add properties as children for object types
        if (def.type === 'object' && def.properties && typeof def.properties === 'object') {
            for (const [propName, propDef] of Object.entries(def.properties)) {
                if (!propDef || typeof propDef !== 'object') continue;
                
                const propObj = propDef as Record<string, unknown>;
                const propSymbol = this.createPropertySymbol(document, text, name, propName, propObj, def);
                if (propSymbol) {
                    symbol.children.push(propSymbol);
                }
            }
        }

        // Add choices as children for choice types
        if (def.type === 'choice' && def.choices && typeof def.choices === 'object') {
            for (const [choiceName, choiceDef] of Object.entries(def.choices)) {
                const choiceSymbol = this.createChoiceSymbol(choiceName, choiceDef);
                if (choiceSymbol) {
                    symbol.children.push(choiceSymbol);
                }
            }
        }

        // Add prefixItems as children for tuple types
        if (def.type === 'tuple' && Array.isArray(def.prefixItems)) {
            for (let i = 0; i < def.prefixItems.length; i++) {
                const item = def.prefixItems[i];
                if (!item || typeof item !== 'object') continue;
                
                const itemObj = item as Record<string, unknown>;
                const typeStr = typeof itemObj.type === 'string' ? itemObj.type : 'unknown';
                const itemSymbol = new vscode.DocumentSymbol(
                    `[${i}]`,
                    typeStr,
                    vscode.SymbolKind.Field,
                    range,
                    range
                );
                symbol.children.push(itemSymbol);
            }
        }

        return symbol;
    }

    private createPropertySymbol(
        _document: vscode.TextDocument,
        _text: string,
        _parentName: string,
        propName: string,
        propDef: Record<string, unknown>,
        parentDef: Record<string, unknown>
    ): vscode.DocumentSymbol | null {
        let detail = '';
        let kind = vscode.SymbolKind.Property;

        if (propDef.type) {
            if (typeof propDef.type === 'string') {
                detail = propDef.type;
            } else if (Array.isArray(propDef.type)) {
                detail = 'union';
            }
        } else if (propDef.$ref && typeof propDef.$ref === 'string') {
            detail = propDef.$ref.split('/').pop() || '$ref';
            kind = vscode.SymbolKind.TypeParameter;
        }

        // Check if required
        const required = Array.isArray(parentDef.required) && parentDef.required.includes(propName);
        if (required) {
            detail += ' (required)';
        }

        // We create a placeholder range since finding exact property position is complex
        const placeholderRange = new vscode.Range(0, 0, 0, 0);
        
        return new vscode.DocumentSymbol(
            propName,
            detail,
            kind,
            placeholderRange,
            placeholderRange
        );
    }

    private createChoiceSymbol(name: string, def: unknown): vscode.DocumentSymbol | null {
        let detail = '';
        
        if (def && typeof def === 'object') {
            const defObj = def as Record<string, unknown>;
            if (defObj.$ref && typeof defObj.$ref === 'string') {
                detail = defObj.$ref.split('/').pop() || '';
            } else if (defObj.type) {
                if (typeof defObj.type === 'object' && (defObj.type as Record<string, unknown>).$ref) {
                    detail = ((defObj.type as Record<string, unknown>).$ref as string).split('/').pop() || '';
                }
            }
        }

        const placeholderRange = new vscode.Range(0, 0, 0, 0);
        
        return new vscode.DocumentSymbol(
            name,
            detail,
            vscode.SymbolKind.EnumMember,
            placeholderRange,
            placeholderRange
        );
    }

    private createTypeSymbol(
        _document: vscode.TextDocument,
        _text: string,
        _key: string,
        typeValue: unknown,
        _schema: Record<string, unknown>
    ): vscode.DocumentSymbol | null {
        let typeName = '';
        let kind = vscode.SymbolKind.TypeParameter;

        if (typeof typeValue === 'string') {
            typeName = typeValue;
            kind = this.getSymbolKindForType(typeValue);
        } else if (Array.isArray(typeValue)) {
            typeName = 'union';
            kind = vscode.SymbolKind.Enum;
        }

        const placeholderRange = new vscode.Range(0, 0, 0, 0);
        
        return new vscode.DocumentSymbol(
            'type',
            typeName,
            kind,
            placeholderRange,
            placeholderRange
        );
    }

    private getSymbolKindForType(type: string): vscode.SymbolKind {
        switch (type) {
            case 'object':
                return vscode.SymbolKind.Class;
            case 'array':
            case 'set':
                return vscode.SymbolKind.Array;
            case 'map':
                return vscode.SymbolKind.Object;
            case 'tuple':
                return vscode.SymbolKind.Struct;
            case 'choice':
                return vscode.SymbolKind.Enum;
            case 'string':
                return vscode.SymbolKind.String;
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
                return vscode.SymbolKind.Number;
            case 'boolean':
                return vscode.SymbolKind.Boolean;
            case 'null':
                return vscode.SymbolKind.Null;
            default:
                return vscode.SymbolKind.TypeParameter;
        }
    }

    private findKeyRange(
        document: vscode.TextDocument,
        text: string,
        key: string
    ): vscode.Range | null {
        const pattern = new RegExp(`"${this.escapeRegex(key)}"\\s*:`);
        const match = text.match(pattern);
        
        if (match && match.index !== undefined) {
            const startPos = document.positionAt(match.index);
            // Find the end of this object/array
            const endPos = this.findMatchingBrace(document, text, match.index + match[0].length);
            return new vscode.Range(startPos, endPos);
        }
        
        return null;
    }

    private findDefinitionRange(
        document: vscode.TextDocument,
        text: string,
        name: string
    ): vscode.Range | null {
        // Look for the definition within definitions (JSON Structure uses 'definitions', not JSON Schema's '$defs')
        const defsPatterns = [
            `"definitions"\\s*:\\s*\\{[^]*?"${this.escapeRegex(name)}"\\s*:\\s*\\{`
        ];

        for (const patternStr of defsPatterns) {
            const pattern = new RegExp(patternStr);
            const match = text.match(pattern);
            
            if (match && match.index !== undefined) {
                // Find the start of just the definition name
                const defNamePattern = new RegExp(`"${this.escapeRegex(name)}"\\s*:\\s*\\{`);
                const defMatch = text.substring(match.index).match(defNamePattern);
                
                if (defMatch && defMatch.index !== undefined) {
                    const startIndex = match.index + defMatch.index;
                    const startPos = document.positionAt(startIndex);
                    const endPos = this.findMatchingBrace(document, text, startIndex + defMatch[0].length - 1);
                    return new vscode.Range(startPos, endPos);
                }
            }
        }
        
        return null;
    }

    private findMatchingBrace(
        document: vscode.TextDocument,
        text: string,
        startIndex: number
    ): vscode.Position {
        let depth = 1;
        let inString = false;
        
        for (let i = startIndex + 1; i < text.length; i++) {
            const char = text[i];
            
            if (char === '"' && text[i - 1] !== '\\') {
                inString = !inString;
            } else if (!inString) {
                if (char === '{' || char === '[') {
                    depth++;
                } else if (char === '}' || char === ']') {
                    depth--;
                    if (depth === 0) {
                        return document.positionAt(i + 1);
                    }
                }
            }
        }
        
        return document.positionAt(text.length);
    }

    private findSymbolInText(
        document: vscode.TextDocument,
        text: string,
        key: string,
        value: string
    ): vscode.DocumentSymbol | null {
        const pattern = new RegExp(`"${this.escapeRegex(key)}"\\s*:\\s*"${this.escapeRegex(value)}"`);
        const match = text.match(pattern);
        
        if (match && match.index !== undefined) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);
            
            return new vscode.DocumentSymbol(
                key,
                value,
                vscode.SymbolKind.Key,
                range,
                range
            );
        }
        
        return null;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
