import * as vscode from 'vscode';
import { SchemaCache } from './schemaCache';

export type SchemaStatus = 'loading' | 'loaded' | 'not-found' | 'error' | 'none';

export interface SchemaStatusInfo {
    status: SchemaStatus;
    schemaUri?: string;
    schemaId?: string;
    errorMessage?: string;
    source?: 'workspace' | 'remote' | 'file';
    /** Number of validation warnings */
    warningCount?: number;
}

/**
 * Tracks schema loading status for each document
 */
export class SchemaStatusTracker {
    private statusMap: Map<string, SchemaStatusInfo> = new Map();
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;

    setStatus(documentUri: vscode.Uri, info: SchemaStatusInfo): void {
        this.statusMap.set(documentUri.toString(), info);
        this._onDidChange.fire(documentUri);
    }

    getStatus(documentUri: vscode.Uri): SchemaStatusInfo {
        return this.statusMap.get(documentUri.toString()) || { status: 'none' };
    }

    clearStatus(documentUri: vscode.Uri): void {
        this.statusMap.delete(documentUri.toString());
        this._onDidChange.fire(documentUri);
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}

/**
 * CodeLens provider that shows schema loading status next to $schema
 */
export class SchemaStatusCodeLensProvider implements vscode.CodeLensProvider {
    private schemaCache: SchemaCache;
    private statusTracker: SchemaStatusTracker;
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor(schemaCache: SchemaCache, statusTracker: SchemaStatusTracker) {
        this.schemaCache = schemaCache;
        this.statusTracker = statusTracker;

        // Refresh CodeLenses when status changes
        this.statusTracker.onDidChange(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
        const codeLenses: vscode.CodeLens[] = [];

        // Check if CodeLens is enabled
        const config = vscode.workspace.getConfiguration('jsonStructure');
        if (!config.get<boolean>('enableCodeLens', true)) {
            return codeLenses;
        }

        // Only for JSON files
        if (document.languageId !== 'json' && document.languageId !== 'jsonc') {
            return codeLenses;
        }

        // Find $schema in the document
        const text = document.getText();
        const schemaMatch = text.match(/"(\$schema)"\s*:\s*"([^"]*)"/);
        
        if (!schemaMatch || schemaMatch.index === undefined) {
            return codeLenses;
        }

        // Get position of $schema
        const startPos = document.positionAt(schemaMatch.index);
        const endPos = document.positionAt(schemaMatch.index + schemaMatch[0].length);
        const range = new vscode.Range(startPos, endPos);

        // Get current status
        const statusInfo = this.statusTracker.getStatus(document.uri);
        
        // Create CodeLens based on status
        const codeLens = this.createStatusCodeLens(range, statusInfo, schemaMatch[2]);
        if (codeLens) {
            codeLenses.push(codeLens);
        }

        return codeLenses;
    }

    private createStatusCodeLens(range: vscode.Range, statusInfo: SchemaStatusInfo, schemaUri: string): vscode.CodeLens | null {
        let title: string;
        let tooltip: string;
        let command: string | undefined;

        switch (statusInfo.status) {
            case 'loading':
                title = '⏳ Loading schema...';
                tooltip = `Loading schema from ${schemaUri}`;
                break;
            
            case 'loaded':
                const sourceIcon = statusInfo.source === 'workspace' ? '📁' : 
                                   statusInfo.source === 'file' ? '📄' : '🌐';
                const sourceText = statusInfo.source === 'workspace' ? 'workspace' :
                                   statusInfo.source === 'file' ? 'local file' : 'remote';
                
                // Show warning indicator if there are warnings
                if (statusInfo.warningCount && statusInfo.warningCount > 0) {
                    const warningText = statusInfo.warningCount === 1 ? '1 warning' : `${statusInfo.warningCount} warnings`;
                    title = `${sourceIcon} ⚠️ Schema loaded with ${warningText} (${sourceText})`;
                    tooltip = `Schema "${statusInfo.schemaId || schemaUri}" loaded from ${sourceText} with ${warningText}`;
                } else {
                    title = `${sourceIcon} ✓ Schema loaded (${sourceText})`;
                    tooltip = `Schema "${statusInfo.schemaId || schemaUri}" loaded from ${sourceText}`;
                }
                command = 'jsonStructure.showSchemaInfo';
                break;
            
            case 'not-found':
                title = '⚠️ Schema not found';
                tooltip = `Could not find schema: ${schemaUri}`;
                command = 'jsonStructure.clearCache';
                break;
            
            case 'error':
                title = `❌ Schema error`;
                tooltip = statusInfo.errorMessage || `Error loading schema: ${schemaUri}`;
                command = 'jsonStructure.clearCache';
                break;
            
            case 'none':
            default:
                // No status yet - show pending
                title = '… Schema pending...';
                tooltip = 'Schema validation pending';
                break;
        }

        return new vscode.CodeLens(range, {
            title,
            tooltip,
            command: command || '',
            arguments: command ? [schemaUri] : undefined
        });
    }

    resolveCodeLens(codeLens: vscode.CodeLens, _token: vscode.CancellationToken): vscode.CodeLens {
        // CodeLens is already resolved in provideCodeLenses
        return codeLens;
    }

    dispose(): void {
        this._onDidChangeCodeLenses.dispose();
    }
}
