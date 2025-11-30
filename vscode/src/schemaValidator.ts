import * as vscode from 'vscode';
import { DiagnosticsManager } from './diagnosticsManager';
import {
    SchemaValidator as JsonStructureSchemaValidator,
    ValidationError,
    isKnownLocation,
    JsonValue
} from '@json-structure/sdk';

/**
 * Validates JSON Structure schema documents (*.struct.json files)
 */
export class SchemaValidator {
    private diagnosticsManager: DiagnosticsManager;
    private schemaValidator: JsonStructureSchemaValidator;

    constructor(diagnosticsManager: DiagnosticsManager) {
        this.diagnosticsManager = diagnosticsManager;
        this.schemaValidator = new JsonStructureSchemaValidator();
    }

    /**
     * Validate a document as a JSON Structure schema
     */
    async validate(document: vscode.TextDocument): Promise<void> {
        const text = document.getText();
        const diagnostics: vscode.Diagnostic[] = [];

        // First, try to parse the JSON
        let schema: unknown;
        try {
            schema = JSON.parse(text);
        } catch (e) {
            // JSON parse error - let VS Code's built-in JSON validation handle this
            this.diagnosticsManager.clearDiagnostics(document.uri);
            return;
        }

        // Validate the schema using the JSON Structure SDK
        const result = this.schemaValidator.validate(schema as JsonValue, text);

        // Add errors as Error severity
        if (!result.isValid) {
            for (const error of result.errors) {
                const diagnostic = this.createDiagnostic(document, error, vscode.DiagnosticSeverity.Error);
                diagnostics.push(diagnostic);
            }
        }

        // Add warnings as Warning severity
        if (result.warnings && result.warnings.length > 0) {
            for (const warning of result.warnings) {
                const diagnostic = this.createDiagnostic(document, warning, vscode.DiagnosticSeverity.Warning);
                diagnostics.push(diagnostic);
            }
        }

        this.diagnosticsManager.setDiagnostics(document.uri, diagnostics);
    }

    /**
     * Create a VS Code diagnostic from a validation error
     */
    private createDiagnostic(
        document: vscode.TextDocument,
        error: ValidationError,
        severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error
    ): vscode.Diagnostic {
        let range: vscode.Range;

        if (error.location && isKnownLocation(error.location)) {
            range = DiagnosticsManager.createRange(
                document,
                error.location.line,
                error.location.column
            );
        } else {
            // Try to find the location from the JSON path
            range = this.findRangeFromPath(document, error.path);
        }

        return DiagnosticsManager.createDiagnostic(
            range,
            error.message,
            severity,
            error.code,
            'JSON Structure Schema'
        );
    }

    /**
     * Find a range in the document from a JSON pointer path
     */
    private findRangeFromPath(document: vscode.TextDocument, path: string): vscode.Range {
        const text = document.getText();

        // Parse the JSON pointer path
        const segments = path.split('/').filter(s => s && s !== '#');
        
        if (segments.length === 0) {
            // Root level error - point to the first character
            return new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(0, 1)
            );
        }

        // Try to find the key in the document
        // This is a simple heuristic that works for many cases
        const lastSegment = segments[segments.length - 1];
        const searchPattern = `"${lastSegment}"`;
        const index = text.indexOf(searchPattern);

        if (index >= 0) {
            const position = document.positionAt(index);
            return DiagnosticsManager.createRange(
                document,
                position.line + 1,
                position.character + 1
            );
        }

        // Fallback to document start
        return new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, 1)
        );
    }
}
