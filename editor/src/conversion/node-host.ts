import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ConversionRequest, ConversionResult, HostFile } from '../contracts.js';
import { PROTOCOL_VERSION } from '../contracts.js';
import { NodeProcessExecutableLauncher } from './process.js';
import { ConversionService } from './service.js';
import type { ConversionStorage } from './storage.js';
import { PackagedExecutableWorkerAdapter } from './worker.js';

export class NodeFilesystemConversionStorage implements ConversionStorage {
  async createStagingDirectory(destination: string, operationId: string): Promise<string> {
    const staging = `${destination}.staging-${operationId}`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    return staging;
  }

  async writeFile(directory: string, outputPath: string, content: Uint8Array): Promise<void> {
    const target = containedPath(directory, outputPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  async publishDirectory(stagingDirectory: string, destination: string, signal: AbortSignal): Promise<void> {
    const files = await stagedFiles(stagingDirectory);
    validateOutputPaths(files);
    await preflightDestination(destination, files);

    const rollbackDirectory = `${destination}.rollback-${randomUUID()}`;
    const published: { target: string; backup?: string }[] = [];
    const createdDirectories = new Set<string>();
    try {
      await ensureDirectory(destination, createdDirectories);
      await mkdir(rollbackDirectory, { recursive: true });
      for (const outputPath of files) {
        if (signal.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
        const source = containedPath(stagingDirectory, outputPath);
        const target = containedPath(destination, outputPath);
        const backup = containedPath(rollbackDirectory, outputPath);
        await ensureDirectory(dirname(target), createdDirectories);
        let existing = false;
        try { await lstat(target); existing = true; } catch (error) { if (!isMissing(error)) throw error; }
        if (existing) {
          await mkdir(dirname(backup), { recursive: true });
          await copyFile(target, backup);
        }
        published.push({ target, backup: existing ? backup : undefined });
        await this.publishPath(source, target, existing);
        if (signal.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
      }
      await rm(rollbackDirectory, { recursive: true, force: true });
      await rm(stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      for (const entry of published.reverse()) {
        await rm(entry.target, { force: true }).catch(() => undefined);
        if (entry.backup) await this.renamePath(entry.backup, entry.target).catch(() => undefined);
      }
      for (const directory of [...createdDirectories].sort((left, right) => right.length - left.length)) {
        await rm(directory).catch(() => undefined);
      }
      await rm(rollbackDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  removeDirectory(directory: string): Promise<void> {
    return rm(directory, { recursive: true, force: true });
  }

  protected renamePath(source: string, destination: string): Promise<void> {
    return rename(source, destination);
  }

  protected async publishPath(source: string, destination: string, overwrite: boolean): Promise<void> {
    try { await rename(source, destination); }
    catch (error) {
      if (!overwrite || !['EEXIST', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await rm(destination, { force: true });
      await rename(source, destination);
    }
  }
}

export interface NodeConversionHostOptions {
  readonly runtimeRoot: string;
  destination(request: ConversionRequest): Promise<string | undefined>;
  launch?(path: string): Promise<void>;
  progress?(request: ConversionRequest, phase: string, completed: number, total: number, message?: string): void;
}

export class NodeConversionHost {
  private readonly service: ConversionService;
  private readonly committedOutputs = new Set<string>();
  private readonly operations = new Map<string, AbortController>();

  constructor(private readonly options: NodeConversionHostOptions) {
    this.service = new ConversionService({
      worker: new PackagedExecutableWorkerAdapter('worker-runtime/converter-worker.cjs', new NodeProcessExecutableLauncher(options.runtimeRoot)),
      storage: new NodeFilesystemConversionStorage(),
    });
  }

  listCommands() { return this.service.listCommands(); }

  async convert(request: ConversionRequest): Promise<ConversionResult> {
    const destination = await this.options.destination(request);
    if (!destination) return { protocolVersion: PROTOCOL_VERSION, requestId: request.requestId, documentVersion: request.documentVersion, succeeded: false, outputs: [], diagnostics: [{ code: 'conversion.cancelled', message: 'Conversion destination selection was cancelled.', severity: 'info' }] };
    const controller = new AbortController();
    this.operations.set(request.requestId, controller);
    const result = await this.service.execute({
      operationId: request.requestId,
      commandId: request.commandId,
      sourceName: request.sourceName,
      source: new TextEncoder().encode(request.sourceText),
      destination,
      preview: false,
      optionValues: request.options,
      launch: { autoOpen: false },
      signal: controller.signal,
      onProgress: (progress) => this.options.progress?.(request, progress.phase, progress.completed, progress.total, progress.message),
    }).finally(() => this.operations.delete(request.requestId));
    const outputs: HostFile[] = Object.keys(result.runtime.files).sort().map((outputPath) => ({ uri: containedPath(destination, outputPath), name: outputPath.replace(/^.*[\\/]/, '') }));
    if (result.runtime.published) for (const output of outputs) this.committedOutputs.add(resolve(output.uri));
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId: request.requestId,
      documentVersion: request.documentVersion,
      succeeded: result.runtime.state === 'completed' && result.runtime.published,
      outputs,
      diagnostics: result.diagnostics,
      review: {
        commandId: result.command.id,
        converter: { id: result.converter.id, displayName: result.converter.displayName, version: result.converter.version },
        sourceFormat: result.command.sourceFormat,
        targetFormat: result.command.targetFormat,
        lifecycle: result.runtime.states,
        published: result.runtime.published,
        lossiness: result.runtime.lossiness,
        warnings: result.runtime.warnings,
        manifest: result.runtime.manifest,
      },
    };
  }

  cancel(requestId: string): void {
    this.operations.get(requestId)?.abort();
  }

  async open(output: HostFile): Promise<void> {
    const canonical = resolve(output.uri);
    if (!this.committedOutputs.has(canonical)) throw new Error('Generated output was not committed by this editor session.');
    await readFile(canonical);
    if (!this.options.launch) throw new Error('This host cannot open generated output.');
    await this.options.launch(canonical);
  }
}

function containedPath(root: string, outputPath: string): string {
  const target = resolve(root, outputPath);
  const relativePath = relative(resolve(root), target);
  if (!relativePath || relativePath.startsWith('..') || resolve(relativePath) === relativePath) throw new Error(`Unsafe output path: ${outputPath}.`);
  return target;
}

async function stagedFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await stagedFiles(root, fullPath));
    else if (entry.isFile()) files.push(relative(root, fullPath).split(sep).join('/'));
    else throw new Error(`Unsupported staged output: ${relative(root, fullPath)}.`);
  }
  return files.sort();
}

function validateOutputPaths(paths: readonly string[]): void {
  const canonical = new Set<string>();
  for (const outputPath of paths) {
    containedPath('.', outputPath);
    const key = outputPath.replace(/\\/g, '/').toLocaleLowerCase('en-US');
    if (canonical.has(key)) throw new Error(`Duplicate or case-colliding output path: ${outputPath}.`);
    canonical.add(key);
  }
}

async function preflightDestination(destination: string, files: readonly string[]): Promise<void> {
  for (const outputPath of files) {
    const target = containedPath(destination, outputPath);
    try {
      if ((await lstat(target)).isDirectory()) throw new Error(`Output path collides with a destination directory: ${outputPath}.`);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    let parent = dirname(target);
    const root = resolve(destination);
    while (parent !== root) {
      try {
        if (!(await lstat(parent)).isDirectory()) throw new Error(`Output path has a non-directory parent: ${outputPath}.`);
        break;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      parent = dirname(parent);
    }
  }
}

async function ensureDirectory(directory: string, created: Set<string>): Promise<void> {
  const missing: string[] = [];
  let current = resolve(directory);
  while (true) {
    try { await lstat(current); break; }
    catch (error) { if (!isMissing(error)) throw error; }
    missing.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  await mkdir(directory, { recursive: true });
  for (const item of missing) created.add(item);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}