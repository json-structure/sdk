import * as vscode from 'vscode';
import { DiagnosticsManager } from './diagnosticsManager';
import { SchemaCache } from './schemaCache';
import {
    InstanceValidator as JsonStructureInstanceValidator,
    ValidationError,
    isKnownLocation,
    JsonValue
} from '@json-structure/sdk';

/**
 * Validates JSON documents against JSON Structure schemas
 * Documents must have a $schema property pointing to the schema
 */
export class InstanceValidator {
    private diagnosticsManager: DiagnosticsManager;
    private schemaCache: SchemaCache;
    private instanceValidator: JsonStructureInstanceValidator;

    constructor(diagnosticsManager: DiagnosticsManager, schemaCache: SchemaCache) {
        this.diagnosticsManager = diagnosticsManager;
        this.schemaCache = schemaCache;
        this.instanceValidator = new JsonStructureInstanceValidator({ extended: true });
    }

    /**
     * Validate a document as a JSON instance against its $schema
     */
    async validate(document: vscode.TextDocument): Promise<void> {
        const text = document.getText();
        const diagnostics: vscode.Diagnostic[] = [];

        // First, try to parse the JSON
        let instance: unknown;
        try {
            instance = JSON.parse(text);
        } catch (e) {
            // JSON parse error - let VS Code's built-in JSON validation handle this
            this.diagnosticsManager.clearDiagnostics(document.uri);
            return;
        }

        // Check if it's an object with a $schema property
        if (!this.isObject(instance) || !('$schema' in instance)) {
            // Not a document we should validate - clear any existing diagnostics
            this.diagnosticsManager.clearDiagnostics(document.uri);
            return;
        }

        const schemaUri = instance.$schema;
        if (typeof schemaUri !== 'string') {
            diagnostics.push(
                DiagnosticsManager.createDiagnostic(
                    this.findSchemaPropertyRange(document),
                    '$schema must be a string URI',
                    vscode.DiagnosticSeverity.Error,
                    'INSTANCE_SCHEMA_INVALID',
                    'JSON Structure'
                )
            );
            this.diagnosticsManager.setDiagnostics(document.uri, diagnostics);
            return;
        }

        // Fetch the schema (pass document URI for relative path resolution)
        const schemaResult = await this.schemaCache.getSchema(schemaUri, document.uri);
        
        if (schemaResult.schema === null) {
            diagnostics.push(
                DiagnosticsManager.createDiagnostic(
                    this.findSchemaPropertyRange(document),
                    schemaResult.error || `Could not load schema: ${schemaUri}`,
                    vscode.DiagnosticSeverity.Warning,
                    'SCHEMA_NOT_FOUND',
                    'JSON Structure'
                )
            );
            this.diagnosticsManager.setDiagnostics(document.uri, diagnostics);
            return;
        }

        // Validate the instance against the schema
        const result = this.instanceValidator.validate(instance as JsonValue, schemaResult.schema as JsonValue, text);

        if (!result.isValid) {
            for (const error of result.errors) {
                const diagnostic = this.createDiagnostic(document, error);
                diagnostics.push(diagnostic);
            }
        }

        this.diagnosticsManager.setDiagnostics(document.uri, diagnostics);
    }

    /**
     * Check if a value is an object
     */
    private isObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    /**
     * Create a VS Code diagnostic from a validation error
     */
    private createDiagnostic(
        document: vscode.TextDocument,
        error: ValidationError
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

        const severity = error.severity === 'warning' 
            ? vscode.DiagnosticSeverity.Warning 
            : vscode.DiagnosticSeverity.Error;

        return DiagnosticsManager.createDiagnostic(
            range,
            error.message,
            severity,
            error.code,
            'JSON Structure'
        );
    }

    /**
     * Find the range of the $schema property in the document
     */
    private findSchemaPropertyRange(document: vscode.TextDocument): vscode.Range {
        const text = document.getText();
        const schemaMatch = text.match(/"?\$schema"?\s*:/);
        
        if (schemaMatch && schemaMatch.index !== undefined) {
            const position = document.positionAt(schemaMatch.index);
            return DiagnosticsManager.createRange(
                document,
                position.line + 1,
                position.character + 1
            );
        }

        return new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, 1)
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
        // For array indices, this won't work well, but for object keys it should
        const lastSegment = segments[segments.length - 1];
        
        // Skip numeric segments (array indices)
        if (/^\d+$/.test(lastSegment)) {
            // For array elements, try to find the parent
            if (segments.length > 1) {
                const parentSegment = segments[segments.length - 2];
                const searchPattern = `"${parentSegment}"`;
                const index = text.indexOf(searchPattern);
                if (index >= 0) {
                    const position = document.positionAt(index);
                    return DiagnosticsManager.createRange(
                        document,
                        position.line + 1,
                        position.character + 1
                    );
                }
            }
        } else {
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
        }

        // Fallback to document start
        return new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, 1)
        );
    }
}
