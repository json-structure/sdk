import { NodeProcessExecutableLauncher } from '@json-structure/editor-foundation/conversion-process';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONVERSION_WORKER_LIMITS, GeneratedImportRegistry, parseCommandsManifest, validateGeneratedConversionFiles as validateGeneratedConversionFileRecord, validateOptionValues, validateWorkerOutputQuotas, type ConversionCommandsManifest, type ConversionOptionValues, type ConversionWorkerLimits } from '@json-structure/editor-foundation/conversion-types';
import { discoverImportSources, loadExternalDocuments, materializeEffectiveImports, ResolvedSchemaContext, resourceSnapshot } from '@json-structure/editor-foundation/host/effective-imports';

export interface ConversionRequest {
    readonly protocolVersion: 1;
    readonly requestId: string;
    readonly kind: 'conversion';
    readonly documentVersion: number;
    readonly commandId: string;
    readonly sourceName: string;
    readonly sourceText: string;
    readonly documentUri?: string;
    readonly options: ConversionOptionValues;
}
export interface HostFile { readonly uri: string; readonly name: string }
export const customEditorViewType = 'jsonStructure.editor' as const;
export interface OpenGeneratedOutputRequest { readonly protocolVersion: 1; readonly requestId: string; readonly kind: 'open-generated-output'; readonly outputs: readonly HostFile[] }
export type GeneratedOutputOpenKind = 'json-structure' | 'file' | 'directory';

export function classifyGeneratedOutputs(outputs: readonly HostFile[]): GeneratedOutputOpenKind {
    if (outputs.length === 0) throw new Error('No generated outputs were supplied.');
    if (outputs.length > 1) return 'directory';
    return outputs[0]!.uri.toLocaleLowerCase().endsWith('.struct.json') ? 'json-structure' : 'file';
}
/** Untitled URIs deliberately carry no filesystem path; native Save performs Save As. */
export async function openUntitledJsonStructureDocument(text: string, isCurrent: () => boolean = () => true): Promise<vscode.TextDocument> {
    const assertCurrent = (): void => { if (!isCurrent()) throw new Error('The conversion source changed; the import result is stale.'); };
    assertCurrent();
    // The content overload creates an unassociated untitled document, with no suggested filesystem target.
    const document = await vscode.workspace.openTextDocument({ content: text, language: 'json' });
    assertCurrent();
    await vscode.commands.executeCommand('vscode.openWith', document.uri, customEditorViewType);
    return document;
}

type Lossiness = 'none' | 'formatting' | 'metadata' | 'precision' | 'unsupported-feature' | 'data-loss';
interface WorkerWarning { readonly code: string; readonly message: string; readonly lossiness: Exclude<Lossiness, 'none'>; readonly sourceLocation?: string; readonly targetPath?: string; readonly details?: Readonly<Record<string, string | number | boolean>> }
interface WorkerResult { readonly files: readonly { path: string; contentBase64: string }[]; readonly warnings: readonly WorkerWarning[]; readonly lossiness: Lossiness }
export interface ConversionProgress { readonly phase: string; readonly completed: number; readonly total: number; readonly message?: string }
const lossinessRank: Readonly<Record<Lossiness, number>> = { none: 0, formatting: 1, metadata: 2, precision: 3, 'unsupported-feature': 4, 'data-loss': 5 };

export function effectiveWorkerLossiness(result: Pick<WorkerResult, 'lossiness' | 'warnings'>): Lossiness {
    return result.warnings.reduce<Lossiness>((lossiness, warning) => lossinessRank[warning.lossiness] > lossinessRank[lossiness] ? warning.lossiness : lossiness, result.lossiness);
}
export async function loadConversionCommandsManifest(extensionUri: vscode.Uri): Promise<ConversionCommandsManifest> {
    const uri = vscode.Uri.joinPath(extensionUri, 'media', 'conversion', 'worker-runtime', 'commands-manifest.json');
    const content = await vscode.workspace.fs.readFile(uri);
    return parseCommandsManifest(JSON.parse(new TextDecoder().decode(content)));
}

export function normalizeConversionOptions(manifest: ConversionCommandsManifest, request: ConversionRequest): ConversionOptionValues {
    const command = manifest.commands.find((candidate) => candidate.id === request.commandId);
    const converter = manifest.converters.find((candidate) => candidate.id === command?.converterId);
    if (!command || !converter) throw new Error(`Conversion metadata for '${request.commandId}' is unavailable.`);
    return validateOptionValues(converter, request.options, command.optionNames);
}
export interface PublicationFileSystem {
    stat(uri: vscode.Uri): Thenable<vscode.FileStat>;
    createDirectory(uri: vscode.Uri): Thenable<void>;
    writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>;
    copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite: boolean }): Thenable<void>;
    rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite: boolean }): Thenable<void>;
    delete(uri: vscode.Uri, options?: { recursive: boolean; useTrash: boolean }): Thenable<void>;
}
type WorkerEvent = { readonly type: 'progress'; readonly operationId: string; readonly phase: string; readonly completed: number; readonly total: number; readonly message?: string } |
    { readonly type: 'result'; readonly operationId: string; readonly files: WorkerResult['files']; readonly warnings: WorkerResult['warnings']; readonly lossiness: Lossiness } |
    { readonly type: 'error'; readonly operationId: string; readonly code: string; readonly message: string } |
    { readonly type: 'log'; readonly operationId: string; readonly level: 'debug' | 'info' | 'warn' | 'error'; readonly message: string };

export function buildOutputManifest(files: WorkerResult['files']): { readonly algorithm: 'sha256'; readonly files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[] } {
    return {
        algorithm: 'sha256',
        files: [...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => {
            const content = Buffer.from(file.contentBase64, 'base64');
            return { path: file.path, bytes: content.byteLength, sha256: createHash('sha256').update(content).digest('hex') };
        })
    };
}

export function isConversionRequest(value: unknown): value is ConversionRequest {
    if (!isProtocolEnvelope(value)) return false;
    const request = value as Record<string, unknown>;
    return request.kind === 'conversion' && Number.isInteger(request.documentVersion) && (request.documentVersion as number) >= 0 &&
        typeof request.commandId === 'string' && request.commandId.length > 0 && typeof request.sourceName === 'string' && request.sourceName.length > 0 &&
        request.sourceName.length <= 255 && !/[\\/]/.test(request.sourceName) && typeof request.sourceText === 'string' && request.sourceText.length <= 4 * 1024 * 1024 &&
        (request.documentUri === undefined || typeof request.documentUri === 'string' && request.documentUri.length > 0 && request.documentUri.length <= 4096) &&
        isConversionOptionsRecord(request.options);
}

    function isConversionOptionsRecord(value: unknown): value is ConversionOptionValues {
        return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 64 && Object.values(value).every((entry) =>
        typeof entry === 'string' || typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry) ||
        Array.isArray(entry) && entry.length <= 256 && entry.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 256));
    }

export function isProtocolEnvelope(value: unknown): value is { readonly protocolVersion: 1; readonly requestId: string } {
    if (!value || typeof value !== 'object') return false;
    const envelope = value as Record<string, unknown>;
    return envelope.protocolVersion === 1 && typeof envelope.requestId === 'string' && envelope.requestId.length > 0 && envelope.requestId.length <= 256;
}

export interface VsCodeConversionHostOptions {
    readonly selectDestination?: () => Promise<vscode.Uri | undefined>;
    readonly workerLimits?: ConversionWorkerLimits;
    readonly publicationFileSystem?: PublicationFileSystem;
    readonly readResource?: (documentUri: string, resourceUri: string) => Promise<{ readonly uri: string; readonly content: string }>;
}

export class VsCodeConversionHost {
    private readonly committed = new Set<string>();
    private readonly imports = new GeneratedImportRegistry();
    private readonly importSources = new Map<string, { readonly uri: string; readonly version: number }>();
    private readonly operations = new Map<string, { controller: AbortController }>();
    private readonly manifest: Promise<ConversionCommandsManifest>;
    private readonly workerLimits: ConversionWorkerLimits;
    constructor(private readonly extensionUri: vscode.Uri, private readonly options: VsCodeConversionHostOptions = {}) {
        this.manifest = loadConversionCommandsManifest(extensionUri);
        this.workerLimits = options.workerLimits ?? CONVERSION_WORKER_LIMITS;
    }

    listCommands(): Promise<ConversionCommandsManifest> { return this.manifest; }

    async convert(request: ConversionRequest, onProgress?: (progress: ConversionProgress) => void, documentUri?: string): Promise<{ protocolVersion: 1; requestId: string; documentVersion: number; succeeded: boolean; outputs: readonly HostFile[]; diagnostics: readonly unknown[]; review?: unknown }> {
        if (this.operations.has(request.requestId)) throw new Error(`Conversion ${request.requestId} is already running.`);
        const controller = new AbortController();
        this.operations.set(request.requestId, { controller });
        try {
            const manifest = await this.manifest;
            const command = manifest.commands.find((candidate) => candidate.id === request.commandId);
            const converter = manifest.converters.find((candidate) => candidate.id === command?.converterId);
            const options = normalizeConversionOptions(manifest, request);
            if (!command || !converter) throw new Error(`Conversion metadata for '${request.commandId}' is unavailable.`);
            if (controller.signal.aborted) return cancelledConversionResult(request);
            const isImport = command.direction === 'import';
            const destination = isImport ? undefined : this.options.selectDestination
                ? await this.options.selectDestination()
                : (await vscode.window.showOpenDialog({ title: 'Choose conversion output directory', canSelectFolders: true, canSelectFiles: false, canSelectMany: false }))?.[0];
            if ((!isImport && !destination) || controller.signal.aborted) return cancelledConversionResult(request);
            const sourceText = command.direction === 'export' && documentUri && this.options.readResource
                ? await materializeVsCodeImportClosure(request.sourceText, request.sourceName, documentUri, this.options.readResource, controller.signal)
                : request.sourceText;
            if (controller.signal.aborted) return cancelledConversionResult(request);
            const result = await this.runWorker({ ...request, sourceText, options }, onProgress);
            validateGeneratedConversionFiles(command.targetFormat, result.files);
            if (controller.signal.aborted) return cancelledConversionResult(request);
            if (isImport && documentUri && !isCurrentDocumentVersion(documentUri, request.documentVersion)) return staleConversionResult(request);
            const outputs = isImport
                ? this.imports.register(randomUUID(), Object.fromEntries(result.files.map(file => [file.path, Buffer.from(file.contentBase64, 'base64')])))
                : await publishGeneratedFiles(this.options.publicationFileSystem ?? vscode.workspace.fs, destination!, result.files, controller.signal);
            if (isImport) {
                if (documentUri) for (const output of outputs) this.importSources.set(output.uri, { uri: documentUri, version: request.documentVersion });
            }
            if (!isImport) for (const output of outputs) this.committed.add(path.resolve(output.uri));
            const source = Buffer.from(request.sourceText, 'utf8');
            return {
                protocolVersion: 1,
                requestId: request.requestId,
                documentVersion: request.documentVersion,
                succeeded: true,
                outputs,
                diagnostics: result.warnings.map((warning) => ({ code: `conversion.warning.${warning.code}`, message: warning.message, severity: warning.lossiness === 'data-loss' ? 'error' : warning.lossiness === 'formatting' ? 'info' : 'warning', location: warning.targetPath ? { uri: warning.targetPath, pointer: warning.targetPath } : undefined })),
                review: {
                    commandId: command.id,
                    converter: { id: converter.id, displayName: converter.displayName, version: converter.version },
                    sourceFormat: command.sourceFormat,
                    targetFormat: command.targetFormat,
                    lifecycle: isImport ? ['idle', 'preparing', 'running', 'completed'] : ['idle', 'preparing', 'running', 'publishing', 'completed'],
                    published: !isImport,
                    outputMode: isImport ? 'untitled-document' : 'published-files',
                    lossiness: effectiveWorkerLossiness(result),
                    warnings: result.warnings,
                    effectiveOptions: options,
                    source: { name: request.sourceName, bytes: source.byteLength, sha256: createHash('sha256').update(source).digest('hex') },
                    manifest: buildOutputManifest(result.files),
                },
            };
        } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) return cancelledConversionResult(request);
            throw error;
        } finally { this.operations.delete(request.requestId); }
    }

    cancel(requestId: string): void {
        const operation = this.operations.get(requestId);
        operation?.controller.abort();
    }

    releaseForDocument(documentUri: string): void {
        for (const [outputUri, source] of this.importSources) {
            if (source.uri !== documentUri) continue;
            this.imports.release(outputUri);
            this.importSources.delete(outputUri);
        }
    }

    async open(output: HostFile): Promise<vscode.TextDocument | undefined> {
        return this.openOutputs([output]);
    }

    async openOutputs(outputs: readonly HostFile[]): Promise<vscode.TextDocument | undefined> {
        if (outputs.some(output => this.imports.has(output.uri))) {
            if (outputs.length !== 1) throw new Error('An imported result must open as one untitled document.');
            const output = outputs[0]!;
            const imported = this.imports.consume(output);
            const source = this.importSources.get(output.uri);
            this.importSources.delete(output.uri);
            const isCurrent = (): boolean => !source || vscode.workspace.textDocuments.some(document => document.uri.toString() === source.uri && document.version === source.version);
            return openUntitledJsonStructureDocument(imported.text, isCurrent);
        }
        if (outputs.length === 0) throw new Error('No generated outputs were supplied.');
        const resolved = outputs.map((output) => path.resolve(output.uri));
        for (const file of resolved) {
            if (!this.committed.has(file)) throw new Error('Generated output was not committed by this editor session.');
            await vscode.workspace.fs.stat(vscode.Uri.file(file));
        }
        if (classifyGeneratedOutputs(outputs) === 'json-structure') {
            await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(resolved[0]!), customEditorViewType);
            return;
        }
        const target = resolved.length === 1 ? resolved[0]! : commonOutputDirectory(resolved);
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target));
    }

    private async runWorker(request: ConversionRequest, onProgress?: (progress: ConversionProgress) => void): Promise<WorkerResult> {
        const operation = this.operations.get(request.requestId);
        if (!operation) throw new Error('The conversion operation is no longer active.');
        const result = await new NodeProcessExecutableLauncher(vscode.Uri.joinPath(this.extensionUri, 'media', 'conversion').fsPath, this.workerLimits).invoke({
            executablePath: 'worker-runtime/converter-worker.cjs', arguments: [],
            request: { operationId: randomUUID(), commandId: request.commandId, sourceName: request.sourceName, source: Buffer.from(request.sourceText, 'utf8'), options: request.options, preview: false },
            signal: operation.controller.signal,
            onProgress: progress => onProgress?.(progress),
        });
        return { files: Object.entries(result.files).map(([path, content]) => ({ path, contentBase64: Buffer.from(content).toString('base64') })), warnings: result.warnings, lossiness: result.lossiness };
    }
}

export async function materializeVsCodeImportClosure(
    sourceText: string,
    sourceName: string,
    documentUri: string,
    readResource: (documentUri: string, resourceUri: string) => Promise<{ readonly uri: string; readonly content: string }>,
    signal: AbortSignal,
): Promise<string> {
    if (signal.aborted) throw abortError();
    let value: unknown;
    try { value = JSON.parse(sourceText); } catch { return sourceText; }
    if (!isRecord(value)) return sourceText;
    const sources = discoverImportSources(value);
    if (sources.length === 0) return sourceText;
    const external = await loadExternalDocuments(documentUri, sources, async (uri) => {
        if (signal.aborted) throw abortError();
        const resource = await readResource(documentUri, uri);
        if (resource.uri !== uri) throw new Error(`Imported resource URI changed from ${uri} to ${resource.uri}.`);
        return resourceSnapshot(`conversion-import-${randomUUID()}`, resource.uri, resource.content);
    });
    if (signal.aborted) throw abortError();
    const resolvedDocuments = external.flatMap((entry) => entry.value ? [{ uri: entry.uri, document: entry.value }] : []);
    const context = new ResolvedSchemaContext(value, { documentUri, resolvedDocuments });
    const materialized = materializeEffectiveImports(value, context);
    if (signal.aborted) throw abortError();
    return JSON.stringify(materialized);
}

function commonOutputDirectory(files: readonly string[]): string {
    let candidate = path.dirname(files[0]!);
    for (const file of files.slice(1)) {
        while (!isWithinPath(file, candidate)) {
            const parent = path.dirname(candidate);
            if (parent === candidate) return candidate;
            candidate = parent;
        }
    }
    return candidate;
}

function isWithinPath(file: string, directory: string): boolean {
    const relative = path.relative(directory, file);
    return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function cancelledConversionResult(request: ConversionRequest): { protocolVersion: 1; requestId: string; documentVersion: number; succeeded: false; outputs: readonly HostFile[]; diagnostics: readonly unknown[] } {
    return {
        protocolVersion: 1,
        requestId: request.requestId,
        documentVersion: request.documentVersion,
        succeeded: false,
        outputs: [],
        diagnostics: [{ code: 'conversion.cancelled', message: 'Conversion was cancelled.', severity: 'info' }]
    };
}

function staleConversionResult(request: ConversionRequest): { protocolVersion: 1; requestId: string; documentVersion: number; succeeded: false; outputs: readonly HostFile[]; diagnostics: readonly unknown[] } {
    return {
        protocolVersion: 1,
        requestId: request.requestId,
        documentVersion: request.documentVersion,
        succeeded: false,
        outputs: [],
        diagnostics: [{ code: 'conversion.stale-source', message: 'The source document changed while converting.', severity: 'info' }]
    };
}

function isCurrentDocumentVersion(documentUri: string, version: number): boolean {
    return vscode.workspace.textDocuments.some(document => document.uri.toString() === documentUri && document.version === version);
}

export function validateGeneratedConversionFiles(targetFormat: string, files: WorkerResult['files']): void {
    const decoded: Record<string, Uint8Array> = {};
    for (const file of files) {
        if (Object.prototype.hasOwnProperty.call(decoded, file.path)) throw new Error(`Converter produced duplicate output path ${file.path}.`);
        decoded[file.path] = Buffer.from(file.contentBase64, 'base64');
    }
    validateGeneratedConversionFileRecord(targetFormat, decoded);
}

export async function publishGeneratedFiles(fileSystem: PublicationFileSystem, destination: vscode.Uri, files: WorkerResult['files'], signal: AbortSignal): Promise<HostFile[]> {
    const manifestPath = 'conversion-output-manifest.json';
    validateOutputPaths([...files.map((file) => file.path), manifestPath]);
    const staging = vscode.Uri.file(`${destination.fsPath}.staging-${randomUUID()}`);
    const rollback = vscode.Uri.file(`${destination.fsPath}.rollback-${randomUUID()}`);
    const publications = [...files.map((file) => ({ path: file.path, content: Buffer.from(file.contentBase64, 'base64') })), {
        path: manifestPath,
        content: new TextEncoder().encode(JSON.stringify(buildOutputManifest(files), null, 2) + '\n')
    }].sort((left, right) => left.path.localeCompare(right.path));
    const published: { target: vscode.Uri; backup?: vscode.Uri }[] = [];
    const createdDirectories: vscode.Uri[] = [];
    try {
        await preflightDestination(fileSystem, destination, publications.map((file) => file.path));
        await fileSystem.createDirectory(staging);
        for (const file of publications) {
            if (signal.aborted) throw abortError();
            const target = safeOutput(staging, file.path);
            await fileSystem.createDirectory(vscode.Uri.joinPath(target, '..'));
            await fileSystem.writeFile(target, file.content);
        }
        if (signal.aborted) throw abortError();
        await ensureDirectory(fileSystem, destination, createdDirectories);
        await fileSystem.createDirectory(rollback);
        for (const file of publications) {
            if (signal.aborted) throw abortError();
            const source = safeOutput(staging, file.path);
            const target = safeOutput(destination, file.path);
            const backup = safeOutput(rollback, file.path);
            await ensureDirectory(fileSystem, vscode.Uri.joinPath(target, '..'), createdDirectories);
            const existing = await exists(fileSystem, target);
            if (existing) {
                await fileSystem.createDirectory(vscode.Uri.joinPath(backup, '..'));
                await fileSystem.copy(target, backup, { overwrite: false });
            }
            published.push({ target, backup: existing ? backup : undefined });
            await fileSystem.rename(source, target, { overwrite: existing });
            if (signal.aborted) throw abortError();
        }
        return files.map((file) => ({ uri: path.join(destination.fsPath, file.path), name: path.basename(file.path) }));
    } catch (error) {
        for (const entry of published.reverse()) {
            await fileSystem.delete(entry.target, { recursive: false, useTrash: false }).then(undefined, () => undefined);
            if (entry.backup) await fileSystem.rename(entry.backup, entry.target, { overwrite: false }).then(undefined, () => undefined);
        }
        for (const directory of createdDirectories.reverse()) {
            await fileSystem.delete(directory, { recursive: false, useTrash: false }).then(undefined, () => undefined);
        }
        throw error;
    } finally {
        await removeTemporaryDirectory(fileSystem, staging, destination).then(undefined, () => undefined);
        await removeTemporaryDirectory(fileSystem, rollback, destination).then(undefined, () => undefined);
    }
}

async function removeTemporaryDirectory(fileSystem: PublicationFileSystem, temporary: vscode.Uri, destination: vscode.Uri): Promise<void> {
    const canonicalTemporary = validateTemporaryDirectoryForCleanup(temporary, destination);
    await fileSystem.delete(canonicalTemporary, { recursive: true, useTrash: false });
}

export function validateTemporaryDirectoryForCleanup(temporary: vscode.Uri, destination: vscode.Uri): vscode.Uri {
    const canonicalTemporary = path.resolve(temporary.fsPath);
    const canonicalParent = path.resolve(path.dirname(destination.fsPath));
    if (path.dirname(canonicalTemporary) !== canonicalParent) throw new Error(`Refusing recursive deletion outside the canonical conversion parent: ${temporary.fsPath}.`);
    const destinationName = path.basename(destination.fsPath);
    const temporaryName = path.basename(canonicalTemporary);
    if (!temporaryName.startsWith(`${destinationName}.staging-`) && !temporaryName.startsWith(`${destinationName}.rollback-`)) throw new Error(`Refusing recursive deletion of an unrecognized conversion directory: ${temporary.fsPath}.`);
    return vscode.Uri.file(canonicalTemporary);
}

export function parseWorkerEvent(line: string, limits: ConversionWorkerLimits = CONVERSION_WORKER_LIMITS): WorkerEvent {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error('Converter emitted invalid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Converter event must be an object.');
    const event = value as Record<string, unknown>;
    if (typeof event.operationId !== 'string' || !event.operationId || typeof event.type !== 'string') throw new Error('Converter event is missing its type or operation ID.');
    if (event.type === 'progress') {
        if (typeof event.phase !== 'string' || !Number.isFinite(event.completed) || !Number.isFinite(event.total) || (event.message !== undefined && typeof event.message !== 'string')) throw new Error('Converter progress event is malformed.');
        return { type: 'progress', operationId: event.operationId, phase: event.phase, completed: Number(event.completed), total: Number(event.total), message: event.message as string | undefined };
    }
    if (event.type === 'result') {
        if (!Array.isArray(event.files) || !event.files.every(isWorkerFile) || !Array.isArray(event.warnings) || !event.warnings.every(isWorkerWarning) || !isLossiness(event.lossiness)) throw new Error('Converter result event is malformed.');
        validateWorkerOutputQuotas(event.files, event.warnings, limits);
        return { type: 'result', operationId: event.operationId, files: event.files, warnings: event.warnings, lossiness: event.lossiness };
    }
    if (event.type === 'error') {
        if (typeof event.code !== 'string' || typeof event.message !== 'string') throw new Error('Converter error event is malformed.');
        return { type: 'error', operationId: event.operationId, code: event.code, message: event.message };
    }
    if (event.type === 'log') {
        if (!['debug', 'info', 'warn', 'error'].includes(String(event.level)) || typeof event.message !== 'string') throw new Error('Converter log event is malformed.');
        return { type: 'log', operationId: event.operationId, level: event.level as 'debug' | 'info' | 'warn' | 'error', message: event.message };
    }
    throw new Error(`Unsupported converter event: ${event.type}.`);
}

function isWorkerFile(value: unknown): value is WorkerResult['files'][number] {
    return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).path === 'string' && typeof (value as Record<string, unknown>).contentBase64 === 'string';
}

function isWorkerWarning(value: unknown): value is WorkerResult['warnings'][number] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const warning = value as Record<string, unknown>;
    return typeof warning.code === 'string' && typeof warning.message === 'string' && isLossiness(warning.lossiness) && warning.lossiness !== 'none' &&
        (warning.sourceLocation === undefined || typeof warning.sourceLocation === 'string') && (warning.targetPath === undefined || typeof warning.targetPath === 'string') &&
        (warning.details === undefined || isScalarRecord(warning.details));
}

function isLossiness(value: unknown): value is Lossiness {
    return typeof value === 'string' && ['none', 'formatting', 'metadata', 'precision', 'unsupported-feature', 'data-loss'].includes(value);
}

function isScalarRecord(value: unknown): value is Readonly<Record<string, string | number | boolean>> {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === 'string' || typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry));
}

async function exists(fileSystem: PublicationFileSystem, uri: vscode.Uri): Promise<boolean> {
    try { await fileSystem.stat(uri); return true; }
    catch (error) { if (isMissing(error)) return false; throw error; }
}

function validateOutputPaths(paths: readonly string[]): void {
    const canonical = new Set<string>();
    for (const outputPath of paths) {
        safeOutput(vscode.Uri.file(path.parse(process.cwd()).root), outputPath);
        const key = outputPath.replace(/\\/g, '/').toLocaleLowerCase('en-US');
        if (canonical.has(key)) throw new Error(`Duplicate or case-colliding output path: ${outputPath}.`);
        canonical.add(key);
    }
}

async function preflightDestination(fileSystem: PublicationFileSystem, destination: vscode.Uri, paths: readonly string[]): Promise<void> {
    for (const outputPath of paths) {
        const target = safeOutput(destination, outputPath);
        try {
            if ((await fileSystem.stat(target)).type === vscode.FileType.Directory) throw new Error(`Output path collides with a destination directory: ${outputPath}.`);
        } catch (error) {
            if (!isMissing(error)) throw error;
        }
        let parent = vscode.Uri.joinPath(target, '..');
        while (parent.fsPath !== destination.fsPath) {
            try {
                if ((await fileSystem.stat(parent)).type !== vscode.FileType.Directory) throw new Error(`Output path has a non-directory parent: ${outputPath}.`);
                break;
            } catch (error) {
                if (!isMissing(error)) throw error;
            }
            parent = vscode.Uri.joinPath(parent, '..');
        }
    }
}

async function ensureDirectory(fileSystem: PublicationFileSystem, directory: vscode.Uri, created: vscode.Uri[]): Promise<void> {
    const missing: vscode.Uri[] = [];
    let current = directory;
    while (true) {
        try { await fileSystem.stat(current); break; }
        catch (error) { if (!isMissing(error)) throw error; }
        missing.push(current);
        const parent = vscode.Uri.joinPath(current, '..');
        if (parent.fsPath === current.fsPath) break;
        current = parent;
    }
    await fileSystem.createDirectory(directory);
    created.push(...missing.reverse());
}

function isMissing(error: unknown): boolean {
    return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

function abortError(): Error {
    const error = new Error('Conversion cancelled.');
    error.name = 'AbortError';
    return error;
}

function safeOutput(root: vscode.Uri, relativePath: string): vscode.Uri {
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) throw new Error(`Unsafe output path: ${relativePath}.`);
    return vscode.Uri.joinPath(root, ...relativePath.split(/[\\/]/));
}
