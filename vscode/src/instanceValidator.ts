import * as vscode from 'vscode';
import { DiagnosticsManager } from './diagnosticsManager';
import { SchemaCache } from './schemaCache';
import { SchemaStatusTracker } from './schemaStatusCodeLensProvider';
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
    private statusTracker: SchemaStatusTracker | null = null;
    private validationInProgress: Map<string, Promise<void>> = new Map();

    constructor(diagnosticsManager: DiagnosticsManager, schemaCache: SchemaCache) {
        this.diagnosticsManager = diagnosticsManager;
        this.schemaCache = schemaCache;
        this.instanceValidator = new JsonStructureInstanceValidator({ extended: true });
    }

    /**
     * Set the status tracker for schema loading status updates
     */
    setStatusTracker(tracker: SchemaStatusTracker): void {
        this.statusTracker = tracker;
    }

    /**
     * Validate a document as a JSON instance against its $schema
     * Uses a lock to prevent concurrent validations of the same document
     */
    async validate(document: vscode.TextDocument): Promise<void> {
        const uriString = document.uri.toString();
        
        // If validation is already in progress for this document, wait for it to complete
        // then start a new validation (in case content changed)
        const existingValidation = this.validationInProgress.get(uriString);
        if (existingValidation) {
            await existingValidation;
        }
        
        // Start new validation and track it
        const validationPromise = this.doValidate(document);
        this.validationInProgress.set(uriString, validationPromise);
        
        try {
            await validationPromise;
        } finally {
            // Only clear if this is still the current validation
            if (this.validationInProgress.get(uriString) === validationPromise) {
                this.validationInProgress.delete(uriString);
            }
        }
    }

    /**
     * Internal validation implementation
     */
    private async doValidate(document: vscode.TextDocument): Promise<void> {
        const text = document.getText();
        const diagnostics: vscode.Diagnostic[] = [];

        // Clear any existing diagnostics at the START of validation
        // This ensures stale errors from previous runs are removed
        this.diagnosticsManager.clearDiagnostics(document.uri);

        // First, try to parse the JSON
        let instance: unknown;
        try {
            instance = JSON.parse(text);
        } catch (e) {
            // JSON parse error - let VS Code's built-in JSON validation handle this
            this.statusTracker?.clearStatus(document.uri);
            return;
        }

        // Check if it's an object with a $schema property
        if (!this.isObject(instance) || !('$schema' in instance)) {
            // Not a document we should validate
            this.statusTracker?.clearStatus(document.uri);
            this.statusTracker?.clearStatus(document.uri);
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
            this.statusTracker?.setStatus(document.uri, {
                status: 'error',
                schemaUri: String(schemaUri),
                errorMessage: '$schema must be a string URI'
            });
            return;
        }

        // Update status to loading
        this.statusTracker?.setStatus(document.uri, {
            status: 'loading',
            schemaUri
        });

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
            this.statusTracker?.setStatus(document.uri, {
                status: schemaResult.error?.includes('not found') ? 'not-found' : 'error',
                schemaUri,
                errorMessage: schemaResult.error
            });
            return;
        }

        // Determine schema source
        const source = this.determineSchemaSource(schemaUri, schemaResult);

        // Update status to loaded
        const schemaObj = schemaResult.schema as Record<string, unknown>;
        this.statusTracker?.setStatus(document.uri, {
            status: 'loaded',
            schemaUri,
            schemaId: typeof schemaObj.$id === 'string' ? schemaObj.$id : undefined,
            source
        });

        // Validate the instance against the schema
        try {
            const result = this.instanceValidator.validate(instance as JsonValue, schemaResult.schema as JsonValue, text);

            if (!result.isValid) {
                for (const error of result.errors) {
                    const diagnostic = this.createDiagnostic(document, error);
                    diagnostics.push(diagnostic);
                }
            }
        } catch (validationError) {
            // If validation throws, add an error diagnostic
            console.error('Validation error:', validationError);
            diagnostics.push(
                DiagnosticsManager.createDiagnostic(
                    this.findSchemaPropertyRange(document),
                    `Validation error: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
                    vscode.DiagnosticSeverity.Error,
                    'VALIDATION_ERROR',
                    'JSON Structure'
                )
            );
        }

        // Always set diagnostics to clear any stale ones
        this.diagnosticsManager.setDiagnostics(document.uri, diagnostics);
    }

    /**
     * Determine the source of a loaded schema
     */
    private determineSchemaSource(schemaUri: string, _schemaResult: { schema: unknown }): 'workspace' | 'remote' | 'file' {
        // Check if it looks like a file path or file:// URI
        if (schemaUri.startsWith('file://') || schemaUri.startsWith('./') || schemaUri.startsWith('../') || /^[a-zA-Z]:/.test(schemaUri)) {
            return 'file';
        }
        
        // Check if it's an http(s) URL - could be workspace or remote
        // Workspace schemas are found by $id matching, so if we got here with a URL,
        // we check if it matches a workspace schema
        if (schemaUri.startsWith('http://') || schemaUri.startsWith('https://')) {
            // If the schema cache found it in workspace, it's workspace
            // For now, we assume URLs that work are either remote or workspace-cached
            // The schemaCache.getSchema first checks workspace schemas by $id
            return this.schemaCache.hasWorkspaceSchema(schemaUri) ? 'workspace' : 'remote';
        }
        
        return 'remote';
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
