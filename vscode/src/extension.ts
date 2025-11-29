import * as vscode from 'vscode';
import { SchemaCache } from './schemaCache';
import { SchemaValidator } from './schemaValidator';
import { InstanceValidator } from './instanceValidator';
import { DiagnosticsManager } from './diagnosticsManager';
import { JsonStructureCompletionProvider } from './completionProvider';
import { JsonStructureHoverProvider } from './hoverProvider';
import { JsonStructureDefinitionProvider } from './definitionProvider';
import { JsonStructureDocumentSymbolProvider } from './documentSymbolProvider';
import { SchemaStatusCodeLensProvider, SchemaStatusTracker } from './schemaStatusCodeLensProvider';

let diagnosticsManager: DiagnosticsManager;
let schemaValidator: SchemaValidator;
let instanceValidator: InstanceValidator;
let schemaCache: SchemaCache;
let statusTracker: SchemaStatusTracker;

export function activate(context: vscode.ExtensionContext): void {
    console.log('JSON Structure extension is now active');

    // Initialize components
    schemaCache = new SchemaCache(context);
    diagnosticsManager = new DiagnosticsManager();
    schemaValidator = new SchemaValidator(diagnosticsManager);
    instanceValidator = new InstanceValidator(diagnosticsManager, schemaCache);
    statusTracker = new SchemaStatusTracker();
    
    // Wire up status tracker to instance validator
    instanceValidator.setStatusTracker(statusTracker);

    // Register the diagnostics collection
    context.subscriptions.push(diagnosticsManager.getDiagnosticCollection());

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('jsonStructure.clearCache', () => {
            schemaCache.clearCache();
            vscode.window.showInformationMessage('JSON Structure schema cache cleared');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jsonStructure.validateDocument', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }
            await validateDocument(editor.document);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jsonStructure.showSchemaInfo', async (schemaUri: string) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            
            const statusInfo = statusTracker.getStatus(editor.document.uri);
            let message = `Schema: ${schemaUri}`;
            
            if (statusInfo.schemaId && statusInfo.schemaId !== schemaUri) {
                message += `\n$id: ${statusInfo.schemaId}`;
            }
            if (statusInfo.source) {
                const sourceDescription = statusInfo.source === 'workspace' ? 'Local workspace file' :
                                          statusInfo.source === 'file' ? 'Local file' : 'Remote URL';
                message += `\nSource: ${sourceDescription}`;
            }
            
            vscode.window.showInformationMessage(message);
        })
    );

    // Validate on document open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            validateDocument(document);
        })
    );

    // Validate on document save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            validateDocument(document);
        })
    );

    // Validate on document change (with debounce)
    let validateTimeout: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (validateTimeout) {
                clearTimeout(validateTimeout);
            }
            validateTimeout = setTimeout(() => {
                validateDocument(event.document);
            }, 500);
        })
    );

    // Clear diagnostics when document is closed
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) => {
            diagnosticsManager.clearDiagnostics(document.uri);
        })
    );

    // Validate all open documents on activation - run in background to not block activation
    setImmediate(() => {
        vscode.workspace.textDocuments.forEach((document) => {
            validateDocument(document);
        });
    });

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('jsonStructure')) {
                // Re-validate all open documents
                vscode.workspace.textDocuments.forEach((document) => {
                    validateDocument(document);
                });
            }
        })
    );

    // Register language features for JSON Structure documents
    const jsonSelector: vscode.DocumentSelector = [
        { language: 'json', scheme: 'file' },
        { language: 'jsonc', scheme: 'file' }
    ];

    // Completion provider for IntelliSense
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            jsonSelector,
            new JsonStructureCompletionProvider(schemaCache),
            '"', ':', ' ', '/'  // Trigger characters
        )
    );

    // Hover provider for documentation on hover
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            jsonSelector,
            new JsonStructureHoverProvider(schemaCache)
        )
    );

    // Definition provider for go-to-definition on $ref, $extends, $root
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            jsonSelector,
            new JsonStructureDefinitionProvider()
        )
    );

    // Document symbol provider for outline view and breadcrumbs
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            jsonSelector,
            new JsonStructureDocumentSymbolProvider()
        )
    );

    // CodeLens provider for schema status indicator
    const codeLensProvider = new SchemaStatusCodeLensProvider(schemaCache, statusTracker);
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            jsonSelector,
            codeLensProvider
        )
    );
    context.subscriptions.push(codeLensProvider);
}

async function validateDocument(document: vscode.TextDocument): Promise<void> {
    // Only validate JSON files
    if (document.languageId !== 'json' && document.languageId !== 'jsonc') {
        return;
    }

    // Skip untitled documents
    if (document.uri.scheme !== 'file') {
        return;
    }

    const config = vscode.workspace.getConfiguration('jsonStructure');
    const fileName = document.fileName;

    // Check if it's a schema document (*.struct.json)
    if (fileName.endsWith('.struct.json')) {
        if (config.get<boolean>('enableSchemaValidation', true)) {
            await schemaValidator.validate(document);
        }
        return;
    }

    // Check if instance validation is enabled
    if (!config.get<boolean>('enableInstanceValidation', true)) {
        diagnosticsManager.clearDiagnostics(document.uri);
        return;
    }

    // Try to validate as an instance document (has $schema property)
    await instanceValidator.validate(document);
}

export function deactivate(): void {
    if (diagnosticsManager) {
        diagnosticsManager.dispose();
    }
    if (statusTracker) {
        statusTracker.dispose();
    }
}
