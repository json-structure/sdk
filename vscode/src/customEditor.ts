import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { LosslessText } from './losslessText';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { customEditorProtocolVersion as protocolVersion, isSerializedMessageWithinBudget, isWebviewMessage, type TextEditMessage } from './customEditorProtocol';
import { customEditorViewType, openUntitledJsonStructureDocument, isConversionRequest, isProtocolEnvelope, VsCodeConversionHost, type OpenGeneratedOutputRequest } from './editorServices';
import { dispatchLibraryOperation, type LibraryCatalogEntry, type LibraryHostResolution, type LibraryHostRuntime, type LibraryOperation } from '@json-structure/editor-foundation/library-host-runtime';
import { createVsCodeLibraryRuntime } from './libraryRuntime';

export const jsonStructureEditorViewType = customEditorViewType;
export const defaultUntitledDocument = JSON.stringify({
    $schema: 'https://json-structure.org/meta/core/v0/#',
    $id: 'urn:json-structure:untitled',
    name: 'UntitledStructure',
    definitions: {}
}, null, 2);

/** Opens a fresh untitled document in the same custom editor as file-backed documents. */
export async function createNewJsonStructureDocument(): Promise<vscode.TextDocument> {
    return openUntitledJsonStructureDocument(defaultUntitledDocument);
}
const maxImportedResourceBytes = 4 * 1024 * 1024;
const maxPrimaryDocumentBytes = 4 * 1024 * 1024;
const maxPrimaryDocumentDepth = 128;
const maxPrimaryDocumentNodes = 100_000;

interface PanelState {
    readonly panel: vscode.WebviewPanel;
    readonly webview: vscode.Webview;
    readonly documentUri: string;
    readonly disposables: vscode.Disposable[];
    readyRequestId?: string;
    initialDocumentPosted: boolean;
    rendererReady: boolean;
}

export class JsonStructureCustomEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly panels = new Set<PanelState>();
    private readonly authoredTexts = new Map<string, LosslessText>();
    private readonly readyDocuments = new Map<string, number>();
    private readonly documentEditQueues = new Map<string, Promise<void>>();
    private activePanel: PanelState | undefined;
    private readonly conversionHost: VsCodeConversionHost;
    private readonly libraryRuntime: Promise<LibraryHostRuntime>;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.libraryRuntime = createVsCodeLibraryRuntime(context, vscode.Uri.joinPath(context.extensionUri, 'media', 'libraries', 'financial-types.struct.json'));
        this.conversionHost = new VsCodeConversionHost(context.extensionUri, {
            readResource: async (documentUri, resourceUri) => ({
                uri: resourceUri,
                content: await readWorkspaceResource(vscode.Uri.parse(documentUri, true), vscode.Uri.parse(resourceUri, true), async (requestedUri) => (await this.libraryRuntime).readResource(requestedUri))
            })
        });
    }

    isRendererReady(uri: vscode.Uri | string): boolean {
        return (this.readyDocuments.get(typeof uri === 'string' ? uri : uri.toString()) ?? 0) > 0;
    }

    private markRendererReady(uri: string): void {
        this.readyDocuments.set(uri, (this.readyDocuments.get(uri) ?? 0) + 1);
    }

    private unmarkRendererReady(uri: string): void {
        const count = this.readyDocuments.get(uri) ?? 0;
        if (count <= 1) this.readyDocuments.delete(uri);
        else this.readyDocuments.set(uri, count - 1);
    }

    showCommands(): void {
        if (this.activePanel) postWebviewMessage(this.activePanel.webview, { type: 'showCommands', protocolVersion });
    }

    async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        const documentKey = document.uri.toString();
        let authored = this.authoredTexts.get(documentKey);
        if (!authored) {
            let bytes: Uint8Array | undefined;
            try {
                const stat = await vscode.workspace.fs.stat(document.uri);
                if (stat.size <= maxPrimaryDocumentBytes) bytes = await vscode.workspace.fs.readFile(document.uri);
            } catch { /* Untitled and unavailable resources use the native model until a file exists. */ }
            authored = new LosslessText(document.getText(), bytes, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
            this.authoredTexts.set(documentKey, authored);
        }
        const sourceText = authored;
        sourceText.observe(document.getText());
        const initialText = sourceText.text;
        try {
            validatePrimaryDocument(initialText);
            assertWebviewMessageBudget(createDocumentMessage('init', document, initialText));
        } catch (error) {
            void vscode.window.showErrorMessage(`JSON Structure editor: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
        const webview = webviewPanel.webview;
        const state: PanelState = { panel: webviewPanel, webview, documentUri: document.uri.toString(), disposables: [], initialDocumentPosted: false, rendererReady: false };
        this.panels.add(state);
        if (webviewPanel.active) this.activePanel = state;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor')]
        };
        webviewPanel.webview.html = this.renderHtml(webview);

        const postDocument = (type: 'init' | 'documentChanged'): void => {
            sourceText.observe(document.getText());
            const text = sourceText.text;
            try {
                validatePrimaryDocument(text);
                postWebviewMessage(webview, createDocumentMessage(type, document, text));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`JSON Structure editor: ${message}`);
                postWebviewMessage(webview, { type: 'documentRejected', protocolVersion, documentVersion: document.version, diagnostics: [{ code: 'vscode.document-limit', message, severity: 'error' }] });
            }
        };
        state.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.toString() === document.uri.toString()) {
                sourceText.observe(document.getText(), event.contentChanges, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
                postDocument('documentChanged');
            }
        }));
        state.disposables.push(vscode.workspace.onDidSaveTextDocument((saved) => {
            if (saved.uri.toString() === document.uri.toString()) {
                const version = saved.version;
                void this.enqueueDocumentEdit(documentKey, async () => {
                    sourceText.observe(saved.getText());
                    try {
                        const persisted = await vscode.workspace.fs.readFile(saved.uri);
                        const restore = sourceText.bytesToRestore(persisted);
                        if (restore && saved.version === version && !saved.isDirty) await vscode.workspace.fs.writeFile(saved.uri, restore);
                    } catch (error) {
                        void vscode.window.showWarningMessage('JSON Structure could not preserve the authored source line endings: ' + (error instanceof Error ? error.message : String(error)));
                    }
                    postWebviewMessage(webview, { type: 'documentSaved', protocolVersion, documentVersion: saved.version });
                });
            }
        }));
        state.disposables.push(webviewPanel.onDidChangeViewState((event) => {
            if (event.webviewPanel.active) this.activePanel = state;
        }));
        state.disposables.push(webview.onDidReceiveMessage(async (message: unknown) => {
            if (isWebviewMessage(message) && message.type === 'rendererReady') {
                if (message.phase === 'mounted') {
                    state.readyRequestId = message.requestId;
                    postWebviewMessage(webview, { type: 'rendererReadyAck', protocolVersion, requestId: message.requestId });
                    if (!state.initialDocumentPosted) {
                        state.initialDocumentPosted = true;
                        postDocument('init');
                    }
                } else if (message.phase === 'rendered' && !state.rendererReady && state.readyRequestId === message.requestId) {
                    state.rendererReady = true;
                    this.markRendererReady(state.documentUri);
                    postWebviewMessage(webview, { type: 'rendererReadyAck', protocolVersion, requestId: message.requestId });
                }
                return;
            }
            if (!isWebviewMessage(message) || message.type === 'rendererReady') return;
            if (message.type === 'readResource') {
                try {
                    const uri = vscode.Uri.parse(message.uri, true);
                    const content = await readWorkspaceResource(document.uri, uri, async (requestedUri) => (await this.libraryRuntime).readResource(requestedUri));
                    postWebviewMessage(webview, { type: 'resourceResult', protocolVersion, requestId: message.requestId, result: { protocolVersion, requestId: message.requestId, uri: uri.toString(), content, contentHash: '' } });
                } catch (error) {
                    postWebviewMessage(webview, { type: 'resourceResult', protocolVersion, requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
                }
                return;
            }
            if (message.type !== 'applyTextEdits') {
                try {
                    const result = await this.handleServiceRequest(message.type, message.request, webview, document.uri.toString());
                    postWebviewMessage(webview, { type: 'serviceResult', protocolVersion, requestId: message.requestId, result });
                } catch (error) {
                    postWebviewMessage(webview, { type: 'serviceResult', protocolVersion, requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
                }
                return;
            }
            await this.enqueueDocumentEdit(document.uri.toString(), async () => {
                const documentVersion = message.request.documentVersion;
                if (documentVersion !== document.version) {
                    this.postApplyResult(webview, message.request.requestId, document, false, 'The document changed before this edit could be applied.');
                    return;
                }
                try {
                    const applied = await this.applyTextEdits(document, message.request.edits);
                    this.postApplyResult(webview, message.request.requestId, document, applied, applied ? undefined : 'The document edit was rejected by VS Code.');
                } catch (error) {
                    this.postApplyResult(webview, message.request.requestId, document, false, error instanceof Error ? error.message : String(error));
                }
            });
        }));
        const disposeSubscription = webviewPanel.onDidDispose(() => {
            this.panels.delete(state);
            if (![...this.panels].some(panel => panel.documentUri === documentKey)) {
                this.authoredTexts.delete(documentKey);
                this.conversionHost.releaseForDocument(documentKey);
            }
            if (state.rendererReady) this.unmarkRendererReady(state.documentUri);
            for (const disposable of state.disposables) disposable.dispose();
            disposeSubscription.dispose();
            if (this.activePanel === state) this.activePanel = [...this.panels].find((candidate) => candidate.panel.active);
        });
    }

    private enqueueDocumentEdit(uri: string, operation: () => Promise<void>): Promise<void> {
        const previous = this.documentEditQueues.get(uri) ?? Promise.resolve();
        const current = previous.then(operation, operation);
        const settled = current.then(() => undefined, () => undefined);
        this.documentEditQueues.set(uri, settled);
        void settled.finally(() => { if (this.documentEditQueues.get(uri) === settled) this.documentEditQueues.delete(uri); });
        return current;
    }

    private async applyTextEdits(document: vscode.TextDocument, edits: readonly TextEditMessage['request']['edits'][number][]): Promise<boolean> {
        const authored = this.authoredTexts.get(document.uri.toString());
        authored?.observe(document.getText());
        const currentText = authored?.text ?? document.getText();
        validatePrimaryDocument(currentText);
        const orderedEdits = [...edits].sort((left, right) => left.range.startOffset - right.range.startOffset || left.range.endOffset - right.range.endOffset);
        const parts: string[] = [];
        let cursor = 0;
        for (const edit of orderedEdits) {
            if (edit.range.startOffset < cursor || edit.range.endOffset < edit.range.startOffset || edit.range.endOffset > currentText.length) return false;
            parts.push(currentText.slice(cursor, edit.range.startOffset), edit.newText);
            cursor = edit.range.endOffset;
        }
        parts.push(currentText.slice(cursor));
        validatePrimaryDocument(parts.join(''));

        const workspaceEdit = new vscode.WorkspaceEdit();
        const mapped = authored?.prepare(edits) ?? edits;
        for (const edit of mapped) {
            workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(edit.range.startOffset), document.positionAt(edit.range.endOffset)), edit.newText);
        }
        try {
            const applied = await vscode.workspace.applyEdit(workspaceEdit);
            if (applied) authored?.observe(document.getText());
            else authored?.cancel();
            return applied;
        } catch (error) { authored?.cancel(); throw error; }
    }

    private postApplyResult(webview: vscode.Webview, requestId: string, document: vscode.TextDocument, applied: boolean, message?: string): void {
        postWebviewMessage(webview, {
            type: 'applyResult',
            protocolVersion,
            requestId,
            result: {
                protocolVersion,
                requestId,
                documentVersion: document.version,
                applied,
                diagnostics: message ? [{ code: 'vscode.edit-rejected', message, severity: 'error' }] : []
            }
        });
    }

    private async handleServiceRequest(type: 'listConversionCommands' | 'selectConversionSource' | 'convert' | 'cancelConversion' | 'openGeneratedOutput' | 'libraryRequest' | 'listLibraryEntries' | 'readLibraryDocument', request: unknown, webview?: vscode.Webview, documentUri?: string): Promise<unknown> {
        if (type === 'listConversionCommands') return this.conversionHost.listCommands();
        if (type === 'selectConversionSource') {
            const sourceRequest = request as { protocolVersion?: unknown; requestId?: unknown; kind?: unknown; formats?: unknown; extensions?: unknown } | undefined;
            if (sourceRequest?.protocolVersion !== protocolVersion || typeof sourceRequest.requestId !== 'string' || sourceRequest.kind !== 'select-conversion-source' || !Array.isArray(sourceRequest.formats) || !sourceRequest.formats.every((format) => typeof format === 'string' && format.length > 0 && format.length <= 64)) throw new Error('Invalid conversion source request.');
            if (sourceRequest.extensions !== undefined && (!Array.isArray(sourceRequest.extensions) || !sourceRequest.extensions.every((extension) => typeof extension === 'string' && /^\.[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/.test(extension)))) throw new Error('Invalid conversion source extensions.');
            const extensions = Array.isArray(sourceRequest.extensions)
                ? sourceRequest.extensions.map((extension) => String(extension).replace(/^\./, ''))
                : ['json', 'avsc', 'yaml', 'yml', 'proto', 'xml', 'xsd'];
            const selected = await vscode.window.showOpenDialog({ title: `Choose ${sourceRequest.formats.join(' or ')} source`, canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'Supported source files': extensions } });
            const uri = selected?.[0];
            if (!uri) return undefined;
            const stat = await vscode.workspace.fs.stat(uri);
            if ((stat.type & vscode.FileType.File) === 0 || stat.size > maxImportedResourceBytes) throw new Error(`Conversion source exceeds the ${maxImportedResourceBytes}-byte limit.`);
            const bytes = await vscode.workspace.fs.readFile(uri);
            if (bytes.byteLength > maxImportedResourceBytes) throw new Error(`Conversion source exceeds the ${maxImportedResourceBytes}-byte limit.`);
            return { uri: uri.toString(), name: uri.path.slice(uri.path.lastIndexOf('/') + 1), text: new TextDecoder().decode(bytes) };
        }
        if (type === 'libraryRequest') {
            const value = request as { operation: LibraryOperation; payload?: unknown };
            return dispatchLibraryOperation(await this.libraryRuntime, value.operation, value.payload);
        }
        if (type === 'listLibraryEntries') {
            const catalog = await dispatchLibraryOperation(await this.libraryRuntime, 'listCatalog') as readonly LibraryCatalogEntry[];
            return catalog.map(({ providerId: _providerId, ...entry }) => entry);
        }
        if (type === 'convert') {
            if (!isConversionRequest(request)) throw new Error('Invalid conversion request.');
            return this.conversionHost.convert(request, (progress) => { if (webview) postWebviewMessage(webview, { type: 'conversionProgress', protocolVersion, requestId: request.requestId, documentVersion: request.documentVersion, phase: progress.phase, percent: progress.total > 0 ? Math.max(0, Math.min(100, progress.completed / progress.total * 100)) : undefined, message: progress.message }); }, documentUri);
        }
        if (type === 'cancelConversion') {
            if (!isProtocolEnvelope(request)) throw new Error('Invalid conversion cancellation request.');
            this.conversionHost.cancel(request.requestId);
            return undefined;
        }
        if (type === 'openGeneratedOutput') {
            if (!isProtocolEnvelope(request) || (request as OpenGeneratedOutputRequest).kind !== 'open-generated-output' || !Array.isArray((request as OpenGeneratedOutputRequest).outputs) || (request as OpenGeneratedOutputRequest).outputs.length === 0 || !(request as OpenGeneratedOutputRequest).outputs.every(isHostFile)) throw new Error('Invalid generated output request.');
            try {
                await this.conversionHost.openOutputs((request as OpenGeneratedOutputRequest).outputs);
                return { protocolVersion, requestId: request.requestId, opened: true };
            } catch (error) {
                return { protocolVersion, requestId: request.requestId, opened: false, message: error instanceof Error ? error.message : String(error) };
            }
        }
        const value = request as { entryId?: unknown; version?: unknown } | undefined;
        if (typeof value?.entryId !== 'string' || typeof value.version !== 'string') throw new Error('Invalid library document request.');
        const catalog = await dispatchLibraryOperation(await this.libraryRuntime, 'listCatalog') as readonly LibraryCatalogEntry[];
        const entry = catalog.find((candidate) => candidate.id === value.entryId && candidate.versions.some((version) => version.version === value.version));
        if (!entry) throw new Error('Requested library document is not available.');
        const resolved = await dispatchLibraryOperation(await this.libraryRuntime, 'resolve', { providerId: entry.providerId, entryId: value.entryId, selector: { kind: 'pinned', version: value.version }, offline: false }) as LibraryHostResolution;
        return { entryId: value.entryId, version: value.version, uri: resolved.documentUri, value: resolved.document };
    }

    private renderHtml(webview: vscode.Webview): string {
        const nonce = createNonce();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor', 'editor.iife.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor', 'editor.css'));
        const readinessRequestId = randomUUID();

        return renderCustomEditorHtml({
            nonce,
            readinessRequestId,
            scriptUri: scriptUri.toString(),
            styleUri: styleUri.toString(),
            cspSource: webview.cspSource,
            acceptanceMode: process.env.JSON_STRUCTURE_VSIX_UI_ACCEPTANCE === '1',
        });
    }
}

export function renderCustomEditorHtml(options: { readonly nonce: string; readonly readinessRequestId: string; readonly scriptUri: string; readonly styleUri: string; readonly cspSource: string; readonly acceptanceMode?: boolean }): string {
    const { nonce, readinessRequestId, scriptUri, styleUri, cspSource, acceptanceMode = false } = options;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="json-structure-style-nonce" content="${nonce}"><meta name="json-structure-renderer-readiness" content="${readinessRequestId}">${acceptanceMode ? '<meta name="json-structure-acceptance" content="enabled">' : ''}<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src ${cspSource} 'nonce-${nonce}'; worker-src ${cspSource} blob:; font-src ${cspSource} data:; img-src ${cspSource} data:"><title>JSON Structure Editor</title><link rel="stylesheet" href="${styleUri}"><style nonce="${nonce}">html,body,#editor{width:100%;height:100%;min-width:0;min-height:0;margin:0;overflow:hidden;overscroll-behavior:none}#editor{position:fixed;inset:0}body{background:#121719}</style></head><body><div id="editor"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
}

export type LibraryResourceReader = (uri: string) => Promise<{ readonly uri: string; readonly document: unknown } | undefined>;
export type WorkspaceResourceFileSystem = Pick<typeof vscode.workspace.fs, 'stat' | 'readFile'>;

export async function readWorkspaceResource(documentUri: vscode.Uri, resourceUri: vscode.Uri, readLibraryResource?: LibraryResourceReader, trusted = vscode.workspace.isTrusted, fileSystem: WorkspaceResourceFileSystem = vscode.workspace.fs): Promise<string> {
    if (!trusted) throw new Error('Imported resources require a trusted workspace.');
    const libraryResource = await readLibraryResource?.(resourceUri.toString());
    if (libraryResource) {
        const content = JSON.stringify(libraryResource.document);
        if (content === undefined) throw new Error('Imported library resource is not representable as JSON.');
        validateResourceSize(new TextEncoder().encode(content).byteLength);
        return content;
    }
    const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri);
    validateResourceUri(documentUri, resourceUri, workspaceRoots, trusted);
    let readUri = resourceUri;
    if (resourceUri.scheme === 'file') {
        const canonicalResource = vscode.Uri.parse(pathToFileURL(await realpath(resourceUri.fsPath)).toString());
        const localRoots = [...workspaceRoots, vscode.Uri.joinPath(documentUri, '..')].filter((root) => root.scheme === 'file');
        const canonicalRoots = await Promise.all(localRoots.map(async (root) => vscode.Uri.parse(pathToFileURL(await realpath(root.fsPath)).toString())));
        if (!canonicalRoots.some((root) => isWithinUriRoot(canonicalResource, root))) throw new Error('Imported resources must remain inside a workspace folder or the opened document directory.');
        readUri = canonicalResource;
    }
    const stats = await fileSystem.stat(readUri);
    if ((stats.type & vscode.FileType.File) === 0) throw new Error('Imported resource is not a file.');
    validateResourceSize(stats.size);
    const bytes = await fileSystem.readFile(readUri);
    validateResourceSize(bytes.byteLength);
    return new TextDecoder().decode(bytes);
}

export function validateResourceSize(size: number): void {
    if (size > maxImportedResourceBytes) throw new Error(`Imported resource exceeds the ${maxImportedResourceBytes}-byte limit.`);
}

export function validatePrimaryDocument(text: string): void {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxPrimaryDocumentBytes) throw new Error(`Primary document exceeds the ${maxPrimaryDocumentBytes}-byte limit (received ${bytes} bytes).`);

    let depth = 0;
    let nodes = 0;
    let inString = false;
    let escaped = false;
    let inPrimitive = false;
    const addNode = (): void => {
        nodes += 1;
        if (nodes > maxPrimaryDocumentNodes) throw new Error(`Primary document exceeds the ${maxPrimaryDocumentNodes}-node structural limit.`);
    };
    for (const character of text) {
        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') {
            addNode();
            inString = true;
            inPrimitive = false;
        } else if (character === '{' || character === '[') {
            addNode();
            depth += 1;
            if (depth > maxPrimaryDocumentDepth) throw new Error(`Primary document exceeds the ${maxPrimaryDocumentDepth}-level nesting limit.`);
            inPrimitive = false;
        } else if (character === '}' || character === ']') {
            depth = Math.max(0, depth - 1);
            inPrimitive = false;
        } else if (character === ',' || character === ':' || /\s/.test(character)) {
            inPrimitive = false;
        } else if (!inPrimitive) {
            addNode();
            inPrimitive = true;
        }
    }
}

export function validateResourceUri(documentUri: vscode.Uri, resourceUri: vscode.Uri, workspaceRoots: readonly vscode.Uri[], trusted: boolean): void {
    if (!trusted) throw new Error('Imported resources require a trusted workspace.');
    if (resourceUri.scheme === 'http' || resourceUri.scheme === 'https') throw new Error('HTTP and HTTPS imports are not supported by the VS Code editor.');
    if (resourceUri.scheme === 'vscode-remote') throw new Error('Remote imports are disabled because canonical containment cannot be verified.');
    if (resourceUri.scheme !== 'file') throw new Error(`Unsupported imported resource scheme: ${resourceUri.scheme || '(none)'}.`);

    const roots = [...workspaceRoots, vscode.Uri.joinPath(documentUri, '..')];
    if (!roots.some((root) => isWithinUriRoot(resourceUri, root))) throw new Error('Imported resources must remain inside a workspace folder or the opened document directory.');
}

export function isWithinUriRoot(resource: vscode.Uri, root: vscode.Uri): boolean {
    if (resource.scheme !== root.scheme || resource.authority.toLowerCase() !== root.authority.toLowerCase()) return false;
    const caseInsensitive = resource.scheme === 'file' && process.platform === 'win32';
    const resourcePath = caseInsensitive ? resource.path.toLowerCase() : resource.path;
    const normalizedRoot = caseInsensitive ? root.path.toLowerCase() : root.path;
    const rootPath = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
    return resourcePath === normalizedRoot || resourcePath.startsWith(rootPath);
}

function isHostFile(value: unknown): value is { readonly uri: string; readonly name: string } {
    return !!value && typeof value === 'object' && !Array.isArray(value) && 'uri' in value && 'name' in value && typeof value.uri === 'string' && value.uri.length > 0 && typeof value.name === 'string' && value.name.length > 0;
}

function createNonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function postWebviewMessage(webview: vscode.Webview, message: unknown): void {
    assertWebviewMessageBudget(message);
    void webview.postMessage(message);
}

function assertWebviewMessageBudget(message: unknown): void {
    if (!isSerializedMessageWithinBudget(message)) throw new Error('VS Code webview message exceeds the aggregate serialization budget.');
}

function createDocumentMessage(type: 'init' | 'documentChanged', document: vscode.TextDocument, text: string): unknown {
    return {
        type,
        protocolVersion,
        uri: document.uri.toString(),
        title: vscode.workspace.asRelativePath(document.uri, false),
        text,
        documentVersion: document.version
    };
}
