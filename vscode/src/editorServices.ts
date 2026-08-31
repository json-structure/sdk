import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

export interface ConversionRequest {
    readonly protocolVersion: 1;
    readonly requestId: string;
    readonly kind: 'conversion';
    readonly documentVersion: number;
    readonly commandId: string;
    readonly sourceName: string;
    readonly sourceText: string;
    readonly options: Readonly<Record<string, string | number | boolean>>;
}
export interface HostFile { readonly uri: string; readonly name: string }
export interface OpenGeneratedOutputRequest { readonly protocolVersion: 1; readonly requestId: string; readonly kind: 'open-generated-output'; readonly outputs: readonly HostFile[] }
type Lossiness = 'none' | 'formatting' | 'metadata' | 'precision' | 'unsupported-feature' | 'data-loss';
interface WorkerWarning { readonly code: string; readonly message: string; readonly lossiness: Exclude<Lossiness, 'none'>; readonly sourceLocation?: string; readonly targetPath?: string; readonly details?: Readonly<Record<string, string | number | boolean>> }
interface WorkerResult { readonly files: readonly { path: string; contentBase64: string }[]; readonly warnings: readonly WorkerWarning[]; readonly lossiness: Lossiness }
export interface ConversionProgress { readonly phase: string; readonly completed: number; readonly total: number; readonly message?: string }
export const conversionCommandsManifest = {
    schemaVersion: 1,
    converters: [
        { id: 'jsonschema', displayName: 'JSON Schema Converter', version: '1.0.0-node', sourceFormats: ['json-schema', 'json'], targetFormats: ['json-structure'], options: [] },
        { id: 'avro', displayName: 'Avro Converter', version: '1.0.0-node', sourceFormats: ['avro', 'json'], targetFormats: ['json-structure'], options: [] },
    ],
    commands: [
        { id: 'import.jsonschema.to-json-structure', converterId: 'jsonschema', direction: 'import', label: 'Import JSON Schema to JSON Structure', sourceFormat: 'json-schema', targetFormat: 'json-structure', defaultAutoOpen: true },
        { id: 'export.json-structure.to-jsonschema', converterId: 'jsonschema', direction: 'export', label: 'Export JSON Structure to JSON Schema', sourceFormat: 'json-structure', targetFormat: 'json-schema', defaultAutoOpen: true },
        { id: 'import.avro.to-json-structure', converterId: 'avro', direction: 'import', label: 'Import Avro to JSON Structure', sourceFormat: 'avro', targetFormat: 'json-structure', defaultAutoOpen: true },
        { id: 'export.json-structure.to-avro', converterId: 'avro', direction: 'export', label: 'Export JSON Structure to Avro', sourceFormat: 'json-structure', targetFormat: 'avro', defaultAutoOpen: true },
    ],
} as const;
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
        !!request.options && typeof request.options === 'object' && !Array.isArray(request.options) && Object.values(request.options).every((entry) => typeof entry === 'string' || typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry));
}

export function isProtocolEnvelope(value: unknown): value is { readonly protocolVersion: 1; readonly requestId: string } {
    if (!value || typeof value !== 'object') return false;
    const envelope = value as Record<string, unknown>;
    return envelope.protocolVersion === 1 && typeof envelope.requestId === 'string' && envelope.requestId.length > 0 && envelope.requestId.length <= 256;
}

export class VsCodeConversionHost {
    private readonly committed = new Set<string>();
    private readonly operations = new Map<string, { child?: ChildProcessWithoutNullStreams; controller: AbortController }>();
    constructor(private readonly extensionUri: vscode.Uri) {}

    async convert(request: ConversionRequest, onProgress?: (progress: ConversionProgress) => void): Promise<{ protocolVersion: 1; requestId: string; documentVersion: number; succeeded: boolean; outputs: readonly HostFile[]; diagnostics: readonly unknown[]; review?: unknown }> {
        const selected = await vscode.window.showOpenDialog({ title: 'Choose conversion output directory', canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
        const destination = selected?.[0];
        if (!destination) return { protocolVersion: 1, requestId: request.requestId, documentVersion: request.documentVersion, succeeded: false, outputs: [], diagnostics: [{ code: 'conversion.cancelled', message: 'Conversion destination selection was cancelled.', severity: 'info' }] };
        if (this.operations.has(request.requestId)) throw new Error(`Conversion ${request.requestId} is already running.`);
        const controller = new AbortController();
        this.operations.set(request.requestId, { controller });
        try {
            const result = await this.runWorker(request, onProgress);
            const outputs = await publishGeneratedFiles(vscode.workspace.fs, destination, result.files, controller.signal);
            const command = conversionCommandsManifest.commands.find((candidate) => candidate.id === request.commandId);
            const converter = conversionCommandsManifest.converters.find((candidate) => candidate.id === command?.converterId);
            if (!command || !converter) throw new Error(`Conversion metadata for '${request.commandId}' is unavailable.`);
            for (const output of outputs) this.committed.add(path.resolve(output.uri));
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
                    lifecycle: ['idle', 'preparing', 'running', 'publishing', 'completed'],
                    published: true,
                    lossiness: result.lossiness,
                    warnings: result.warnings,
                    manifest: buildOutputManifest(result.files),
                },
            };
        } finally { this.operations.delete(request.requestId); }
    }

    cancel(requestId: string): void {
        const operation = this.operations.get(requestId);
        operation?.controller.abort();
        operation?.child?.kill('SIGTERM');
    }

    async open(output: HostFile): Promise<void> {
        const resolved = path.resolve(output.uri);
        if (!this.committed.has(resolved)) throw new Error('Generated output was not committed by this editor session.');
        await vscode.workspace.fs.stat(vscode.Uri.file(resolved));
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(resolved));
    }

    private runWorker(request: ConversionRequest, onProgress?: (progress: ConversionProgress) => void): Promise<WorkerResult> {
        const worker = vscode.Uri.joinPath(this.extensionUri, 'media', 'conversion', 'worker-runtime', 'converter-worker.cjs').fsPath;
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [worker], { stdio: 'pipe', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
            const operation = this.operations.get(request.requestId);
            if (!operation || operation.child) { child.kill(); reject(new Error(`Conversion ${request.requestId} is already running.`)); return; }
            operation.child = child;
            let carry = '';
            let result: WorkerResult | undefined;
            let failure: Error | undefined;
            child.stdout.on('data', (chunk: Buffer) => {
                const lines = (carry + chunk.toString('utf8')).split(/\r?\n/); carry = lines.pop() ?? '';
                for (const line of lines) if (line.trim()) {
                    let event: WorkerEvent;
                    try { event = parseWorkerEvent(line); }
                    catch (error) { failure = error instanceof Error ? error : new Error(String(error)); child.kill(); continue; }
                    if (event.operationId !== request.requestId) continue;
                    if (event.type === 'progress') onProgress?.({ phase: event.phase, completed: event.completed, total: event.total, message: event.message });
                    if (event.type === 'result') result = { files: event.files, warnings: event.warnings, lossiness: event.lossiness };
                    if (event.type === 'error') failure = new Error(`${event.code}: ${event.message}`);
                }
            });
            child.on('error', reject);
            child.on('exit', (code) => {
                operation.child = undefined;
                if (failure) reject(failure);
                else if (code !== 0) reject(new Error(code === null ? 'Conversion cancelled.' : `Converter exited with code ${String(code)}.`));
                else if (result) resolve(result);
                else reject(new Error('Converter exited without a result.'));
            });
            child.stdin.end(JSON.stringify({ type: 'request', requestId: randomUUID(), operationId: request.requestId, commandId: request.commandId, sourceName: request.sourceName, sourceBase64: Buffer.from(request.sourceText).toString('base64'), options: request.options, preview: false }) + '\n');
        });
    }
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
        await fileSystem.delete(staging, { recursive: true, useTrash: false }).then(undefined, () => undefined);
        await fileSystem.delete(rollback, { recursive: true, useTrash: false }).then(undefined, () => undefined);
    }
}

export function parseWorkerEvent(line: string): WorkerEvent {
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
