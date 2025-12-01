import * as vscode from 'vscode';

/**
 * Provides go-to-definition for $ref, $extends, and $root references in JSON Structure documents
 */
export class JsonStructureDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const text = document.getText();
        const lineText = document.lineAt(position.line).text;
        
        // Parse the document
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(text);
        } catch {
            return undefined;
        }

        // Check if we're on a $ref, $extends, or $root value
        const refMatch = lineText.match(/"\$(?:ref|extends|root)"\s*:\s*"(#\/[^"]+)"/);
        if (!refMatch) {
            return undefined;
        }

        const refValue = refMatch[1];
        const refIndex = lineText.indexOf(refValue);
        
        // Check if the cursor is within the reference value
        if (position.character < refIndex || position.character > refIndex + refValue.length) {
            return undefined;
        }

        // Parse the JSON pointer
        const location = this.findDefinitionLocation(document, text, refValue, parsed);
        return location;
    }

    private findDefinitionLocation(
        document: vscode.TextDocument,
        text: string,
        ref: string,
        parsed: Record<string, unknown>
    ): vscode.Location | undefined {
        if (!ref.startsWith('#/')) {
            return undefined;
        }

        const parts = ref.substring(2).split('/');
        
        // Find the position of the definition in the source text
        // We need to find the location of the definition key in the JSON
        
        let searchPath = '';
        for (const part of parts) {
            searchPath += `/${part}`;
        }

        // Navigate to the definition to verify it exists
        let current: unknown = parsed;
        for (const part of parts) {
            if (current && typeof current === 'object' && current !== null) {
                current = (current as Record<string, unknown>)[part];
            } else {
                return undefined;
            }
        }

        if (!current) {
            return undefined;
        }

        // Now find the position in the source
        // We look for the pattern "definitionName": { which marks the start of the definition
        const lastPart = parts[parts.length - 1];
        const definitionPattern = new RegExp(`"${this.escapeRegex(lastPart)}"\\s*:\\s*\\{`);
        
        // We need to find the right occurrence based on the path
        // For now, use a simple approach: find the definition key after the parent key
        const parentPart = parts.length > 1 ? parts[parts.length - 2] : null;
        
        let searchStart = 0;
        if (parentPart) {
            const parentPattern = new RegExp(`"${this.escapeRegex(parentPart)}"\\s*:\\s*\\{`);
            const parentMatch = text.match(parentPattern);
            if (parentMatch && parentMatch.index !== undefined) {
                searchStart = parentMatch.index;
            }
        }

        const searchText = text.substring(searchStart);
        const match = searchText.match(definitionPattern);
        
        if (match && match.index !== undefined) {
            const absoluteIndex = searchStart + match.index;
            const position = document.positionAt(absoluteIndex + 1); // +1 to skip the opening quote
            return new vscode.Location(document.uri, position);
        }

        return undefined;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

/**
 * Provides document links for $ref, $extends, and $root references
 * This allows Ctrl+Click navigation on the references
 */
export class JsonStructureDocumentLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.DocumentLink[] {
        const text = document.getText();
        const links: vscode.DocumentLink[] = [];

        // Find all $ref, $extends, $root references
        const refPattern = /"\$(?:ref|extends|root)"\s*:\s*"(#\/[^"]+)"/g;
        let match;

        while ((match = refPattern.exec(text)) !== null) {
            const refValue = match[1];
            const startIndex = match.index + match[0].indexOf(refValue);
            const endIndex = startIndex + refValue.length;

            const startPos = document.positionAt(startIndex);
            const endPos = document.positionAt(endIndex);
            const range = new vscode.Range(startPos, endPos);

            // Create a command URI that will trigger go-to-definition
            const link = new vscode.DocumentLink(range);
            link.tooltip = `Go to ${refValue}`;
            links.push(link);
        }

        return links;
    }
}

/**
 * Provides reference finding for definitions in JSON Structure documents
 * Shows all places where a definition is referenced
 */
export class JsonStructureReferenceProvider implements vscode.ReferenceProvider {
    provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.ReferenceContext,
        _token: vscode.CancellationToken
    ): vscode.Location[] {
        const text = document.getText();
        const locations: vscode.Location[] = [];

        // Get the word at the current position
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_]+/);
        if (!wordRange) {
            return locations;
        }

        const word = document.getText(wordRange);
        const lineText = document.lineAt(position.line).text;

        // Check if we're on a definition name
        // Definitions are typically: "DefinitionName": {
        const isDefinition = lineText.match(new RegExp(`"${word}"\\s*:\\s*\\{`));
        if (!isDefinition) {
            return locations;
        }

        // Determine the full reference path
        // JSON Structure uses 'definitions' (not JSON Schema's '$defs')
        let refPath = '';
        if (text.includes(`"definitions"`) && text.indexOf(`"${word}"`) > text.indexOf(`"definitions"`)) {
            refPath = `#/definitions/${word}`;
        }

        if (!refPath) {
            return locations;
        }

        // Find all references to this definition
        const escapedPath = refPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const refPattern = new RegExp(`"${escapedPath}"`, 'g');
        let match;

        while ((match = refPattern.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            locations.push(new vscode.Location(document.uri, new vscode.Range(startPos, endPos)));
        }

        return locations;
    }
}
