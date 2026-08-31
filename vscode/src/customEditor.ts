import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { customEditorProtocolVersion as protocolVersion, isWebviewMessage, type TextEditMessage } from './customEditorProtocol';
import { conversionCommandsManifest, isConversionRequest, isProtocolEnvelope, VsCodeConversionHost, type OpenGeneratedOutputRequest } from './editorServices';
import { dispatchLibraryOperation, type LibraryCatalogEntry, type LibraryHostResolution, type LibraryHostRuntime, type LibraryOperation } from '@json-structure/editor-foundation/library-host-runtime';
import { createVsCodeLibraryRuntime } from './libraryRuntime';

export const jsonStructureEditorViewType = 'jsonStructure.editor';
const maxImportedResourceBytes = 4 * 1024 * 1024;

interface PanelState {
    readonly panel: vscode.WebviewPanel;
    readonly webview: vscode.Webview;
    readonly disposables: vscode.Disposable[];
}

export class JsonStructureCustomEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly panels = new Set<PanelState>();
    private activePanel: PanelState | undefined;
    private readonly conversionHost: VsCodeConversionHost;
    private readonly libraryRuntime: Promise<LibraryHostRuntime>;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.conversionHost = new VsCodeConversionHost(context.extensionUri);
        this.libraryRuntime = createVsCodeLibraryRuntime(context, vscode.Uri.joinPath(context.extensionUri, 'media', 'libraries', 'financial-types.struct.json'));
    }

    showCommands(): void {
        void this.activePanel?.webview.postMessage({ type: 'showCommands', protocolVersion });
    }

    async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        const webview = webviewPanel.webview;
        const state: PanelState = { panel: webviewPanel, webview, disposables: [] };
        this.panels.add(state);
        if (webviewPanel.active) this.activePanel = state;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor')]
        };
        webviewPanel.webview.html = this.renderHtml(webview);

        const postDocument = (type: 'init' | 'documentChanged'): void => {
            void webview.postMessage({
                type,
                protocolVersion,
                uri: document.uri.toString(),
                title: vscode.workspace.asRelativePath(document.uri, false),
                text: document.getText(),
                documentVersion: document.version
            });
        };
        state.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.toString() === document.uri.toString()) postDocument('documentChanged');
        }));
        state.disposables.push(vscode.workspace.onDidSaveTextDocument((saved) => {
            if (saved.uri.toString() === document.uri.toString()) {
                void webview.postMessage({ type: 'documentSaved', protocolVersion, documentVersion: saved.version });
            }
        }));
        state.disposables.push(webviewPanel.onDidChangeViewState((event) => {
            if (event.webviewPanel.active) this.activePanel = state;
        }));
        state.disposables.push(webview.onDidReceiveMessage(async (message: unknown) => {
            if (!isWebviewMessage(message)) return;
            if (message.type === 'readResource') {
                try {
                    const uri = vscode.Uri.parse(message.uri, true);
                    const content = await readWorkspaceResource(document.uri, uri);
                    void webview.postMessage({ type: 'resourceResult', protocolVersion, requestId: message.requestId, result: { protocolVersion, requestId: message.requestId, uri: uri.toString(), content, contentHash: '' } });
                } catch (error) {
                    void webview.postMessage({ type: 'resourceResult', protocolVersion, requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
                }
                return;
            }
            if (message.type !== 'applyTextEdits') {
                try {
                    const result = await this.handleServiceRequest(message.type, message.request, webview);
                    void webview.postMessage({ type: 'serviceResult', protocolVersion, requestId: message.requestId, result });
                } catch (error) {
                    void webview.postMessage({ type: 'serviceResult', protocolVersion, requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
                }
                return;
            }
            const documentVersion = message.request.documentVersion;
            if (documentVersion !== document.version) {
                this.postApplyResult(webview, message.request.requestId, document, false, 'The document changed before this edit could be applied.');
                return;
            }
            const applied = await this.applyTextEdits(document, message.request.edits);
            this.postApplyResult(webview, message.request.requestId, document, applied, applied ? undefined : 'The document edit was rejected by VS Code.');
        }));
        const disposeSubscription = webviewPanel.onDidDispose(() => {
            this.panels.delete(state);
            for (const disposable of state.disposables) disposable.dispose();
            disposeSubscription.dispose();
            if (this.activePanel === state) this.activePanel = [...this.panels].find((candidate) => candidate.panel.active);
        });
        postDocument('init');
    }

    private async applyTextEdits(document: vscode.TextDocument, edits: readonly TextEditMessage['request']['edits'][number][]): Promise<boolean> {
        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const edit of edits) {
            if (edit.range.startOffset < 0 || edit.range.endOffset < edit.range.startOffset || edit.range.endOffset > document.getText().length) return false;
            workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(edit.range.startOffset), document.positionAt(edit.range.endOffset)), edit.newText);
        }
        return vscode.workspace.applyEdit(workspaceEdit);
    }

    private postApplyResult(webview: vscode.Webview, requestId: string, document: vscode.TextDocument, applied: boolean, message?: string): void {
        void webview.postMessage({
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

    private async handleServiceRequest(type: 'listConversionCommands' | 'convert' | 'cancelConversion' | 'openGeneratedOutput' | 'libraryRequest' | 'listLibraryEntries' | 'readLibraryDocument', request: unknown, webview?: vscode.Webview): Promise<unknown> {
        if (type === 'listConversionCommands') return conversionCommandsManifest;
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
            return this.conversionHost.convert(request, (progress) => { void webview?.postMessage({ type: 'conversionProgress', protocolVersion, requestId: request.requestId, documentVersion: request.documentVersion, phase: progress.phase, percent: progress.total > 0 ? Math.max(0, Math.min(100, progress.completed / progress.total * 100)) : undefined, message: progress.message }); });
        }
        if (type === 'cancelConversion') {
            if (!isProtocolEnvelope(request)) throw new Error('Invalid conversion cancellation request.');
            this.conversionHost.cancel(request.requestId);
            return undefined;
        }
        if (type === 'openGeneratedOutput') {
            if (!isProtocolEnvelope(request) || (request as OpenGeneratedOutputRequest).kind !== 'open-generated-output' || !Array.isArray((request as OpenGeneratedOutputRequest).outputs) || (request as OpenGeneratedOutputRequest).outputs.length !== 1) throw new Error('Invalid generated output request.');
            try {
                await this.conversionHost.open((request as OpenGeneratedOutputRequest).outputs[0]);
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
        return { entryId: value.entryId, version: value.version, uri: resolved.provenance.sourceUri, value: resolved.document };
    }

    private renderHtml(webview: vscode.Webview): string {
        const nonce = createNonce();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor', 'editor.iife.js'));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="json-structure-style-nonce" content="${nonce}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; worker-src blob:;"><title>JSON Structure Editor</title><style nonce="${nonce}">html,body,#editor{height:100%;margin:0}body{background:#121719}</style></head><body><div id="editor"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
    }
}

export async function readWorkspaceResource(documentUri: vscode.Uri, resourceUri: vscode.Uri): Promise<string> {
    const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri);
    validateResourceUri(documentUri, resourceUri, workspaceRoots, vscode.workspace.isTrusted);
    if (resourceUri.scheme === 'file') {
        const canonicalResource = vscode.Uri.parse(pathToFileURL(await realpath(resourceUri.fsPath)).toString());
        const localRoots = [...workspaceRoots, vscode.Uri.joinPath(documentUri, '..')].filter((root) => root.scheme === 'file');
        const canonicalRoots = await Promise.all(localRoots.map(async (root) => vscode.Uri.parse(pathToFileURL(await realpath(root.fsPath)).toString())));
        if (!canonicalRoots.some((root) => isWithinUriRoot(canonicalResource, root))) throw new Error('Imported resources must remain inside a workspace folder or the opened document directory.');
    }
    const stats = await vscode.workspace.fs.stat(resourceUri);
    if ((stats.type & vscode.FileType.File) === 0) throw new Error('Imported resource is not a file.');
    validateResourceSize(stats.size);
    const bytes = await vscode.workspace.fs.readFile(resourceUri);
    validateResourceSize(bytes.byteLength);
    return new TextDecoder().decode(bytes);
}

export function validateResourceSize(size: number): void {
    if (size > maxImportedResourceBytes) throw new Error(`Imported resource exceeds the ${maxImportedResourceBytes}-byte limit.`);
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

function createNonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

