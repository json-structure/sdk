import * as vscode from 'vscode';

/**
 * Manages VS Code diagnostics for JSON Structure validation
 */
export class DiagnosticsManager {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('json-structure');
    }

    /**
     * Set diagnostics for a document
     */
    setDiagnostics(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]): void {
        this.diagnosticCollection.set(uri, diagnostics);
    }

    /**
     * Clear diagnostics for a document
     */
    clearDiagnostics(uri: vscode.Uri): void {
        this.diagnosticCollection.delete(uri);
    }

    /**
     * Get the diagnostic collection for subscription management
     */
    getDiagnosticCollection(): vscode.DiagnosticCollection {
        return this.diagnosticCollection;
    }

    /**
     * Dispose of the diagnostic collection
     */
    dispose(): void {
        this.diagnosticCollection.dispose();
    }

    /**
     * Create a diagnostic from a validation error
     */
    static createDiagnostic(
        range: vscode.Range,
        message: string,
        severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error,
        code?: string,
        source: string = 'JSON Structure'
    ): vscode.Diagnostic {
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = source;
        if (code) {
            diagnostic.code = code;
        }
        return diagnostic;
    }

    /**
     * Create a range from line and column information
     * Line and column are 1-based from JSON Structure SDK
     */
    static createRange(
        document: vscode.TextDocument,
        line: number,
        column: number,
        endLine?: number,
        endColumn?: number
    ): vscode.Range {
        // Convert from 1-based to 0-based
        const startLine = Math.max(0, line - 1);
        const startColumn = Math.max(0, column - 1);
        
        // If no end position, highlight to end of word or line
        if (endLine === undefined || endColumn === undefined) {
            const lineText = document.lineAt(startLine).text;
            const endPos = findEndOfToken(lineText, startColumn);
            return new vscode.Range(
                new vscode.Position(startLine, startColumn),
                new vscode.Position(startLine, endPos)
            );
        }

        return new vscode.Range(
            new vscode.Position(startLine, startColumn),
            new vscode.Position(Math.max(0, endLine - 1), Math.max(0, endColumn - 1))
        );
    }
}

/**
 * Find the end of the token at the given position
 */
function findEndOfToken(lineText: string, startColumn: number): number {
    if (startColumn >= lineText.length) {
        return lineText.length;
    }

    const char = lineText[startColumn];
    
    // If we're at a string, find the end of it
    if (char === '"') {
        let pos = startColumn + 1;
        while (pos < lineText.length) {
            if (lineText[pos] === '"' && lineText[pos - 1] !== '\\') {
                return pos + 1;
            }
            pos++;
        }
        return lineText.length;
    }

    // For other tokens, find word boundary
    let pos = startColumn;
    while (pos < lineText.length && !isDelimiter(lineText[pos])) {
        pos++;
    }
    
    return pos > startColumn ? pos : startColumn + 1;
}

function isDelimiter(char: string): boolean {
    return /[\s,\[\]\{\}:]/.test(char);
}
