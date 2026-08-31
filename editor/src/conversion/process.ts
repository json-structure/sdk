import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { extname, resolve } from 'node:path';
import type { ConversionCommandsManifest } from './types.js';
import { parseCommandsManifest } from './types.js';
import type {
  ConversionProgress,
  ConversionWarning,
  ConversionWorkerResult,
  Lossiness,
  PackagedExecutableInvocation,
  PackagedExecutableLauncher,
} from './worker.js';

interface WorkerEventBase {
  readonly type: string;
  readonly operationId: string;
}

interface WorkerProgressEvent extends WorkerEventBase {
  readonly type: 'progress';
  readonly phase: string;
  readonly completed: number;
  readonly total: number;
  readonly message?: string;
}

interface WorkerLogEvent extends WorkerEventBase {
  readonly type: 'log';
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
}

interface WorkerResultFile {
  readonly path: string;
  readonly contentBase64: string;
}

interface WorkerResultEvent extends WorkerEventBase {
  readonly type: 'result';
  readonly lossiness: Lossiness;
  readonly warnings: readonly ConversionWarning[];
  readonly files: readonly WorkerResultFile[];
}

interface WorkerErrorEvent extends WorkerEventBase {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

type WorkerEvent = WorkerProgressEvent | WorkerLogEvent | WorkerResultEvent | WorkerErrorEvent;

function parseEvent(line: string): WorkerEvent {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    throw new Error('Worker emitted invalid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Worker event must be an object.');
  const event = data as Record<string, unknown>;
  const type = event.type;
  const operationId = event.operationId;
  if (typeof type !== 'string' || typeof operationId !== 'string' || operationId.length === 0) throw new Error('Worker event missing type or operationId.');
  if (type === 'progress') {
    const completed = event.completed;
    const total = event.total;
    if (!Number.isFinite(completed) || !Number.isFinite(total) || typeof event.phase !== 'string') throw new Error('Invalid worker progress event.');
    return {
      type: 'progress', operationId,
      phase: event.phase,
      completed: Number(completed),
      total: Number(total),
      message: typeof event.message === 'string' ? event.message : undefined,
    };
  }
  if (type === 'log') {
    if ((event.level !== 'debug' && event.level !== 'info' && event.level !== 'warn' && event.level !== 'error') || typeof event.message !== 'string') {
      throw new Error('Invalid worker log event.');
    }
    return { type: 'log', operationId, level: event.level, message: event.message };
  }
  if (type === 'result') {
    if (!Array.isArray(event.files) || !Array.isArray(event.warnings) || typeof event.lossiness !== 'string') throw new Error('Invalid worker result event.');
    const files = event.files.map((item, index): WorkerResultFile => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid worker result file at index ${index}.`);
      const file = item as Record<string, unknown>;
      if (typeof file.path !== 'string' || typeof file.contentBase64 !== 'string') throw new Error(`Worker result file ${index} is malformed.`);
      return { path: file.path, contentBase64: file.contentBase64 };
    });
    const warnings = event.warnings.map((item, index): ConversionWarning => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid worker warning at index ${index}.`);
      const warning = item as Record<string, unknown>;
      if (typeof warning.code !== 'string' || typeof warning.message !== 'string' || typeof warning.lossiness !== 'string' || warning.lossiness === 'none') {
        throw new Error(`Worker warning ${index} is malformed.`);
      }
      return {
        code: warning.code,
        message: warning.message,
        lossiness: warning.lossiness as Exclude<Lossiness, 'none'>,
        sourceLocation: typeof warning.sourceLocation === 'string' ? warning.sourceLocation : undefined,
        targetPath: typeof warning.targetPath === 'string' ? warning.targetPath : undefined,
        details: warning.details && typeof warning.details === 'object' && !Array.isArray(warning.details) ? warning.details as Readonly<Record<string, string | number | boolean>> : undefined,
      };
    });
    return { type: 'result', operationId, files, warnings, lossiness: event.lossiness as Lossiness };
  }
  if (type === 'error') {
    if (typeof event.code !== 'string' || typeof event.message !== 'string') throw new Error('Invalid worker error event.');
    return { type: 'error', operationId, code: event.code, message: event.message };
  }
  throw new Error(`Unsupported worker event: ${type}.`);
}

function decodeFiles(files: readonly WorkerResultFile[]): Readonly<Record<string, Uint8Array>> {
  const decoded: Record<string, Uint8Array> = {};
  for (const file of files) decoded[file.path] = Buffer.from(file.contentBase64, 'base64');
  return decoded;
}

function collectLines(process: ChildProcessWithoutNullStreams, onLine: (line: string) => void): () => void {
  let stdoutCarry = '';
  let stderrCarry = '';
  const onStdout = (chunk: Buffer): void => {
    const text = stdoutCarry + chunk.toString('utf8');
    const lines = text.split(/\r?\n/);
    stdoutCarry = lines.pop() ?? '';
    for (const line of lines) if (line.trim().length > 0) onLine(line);
  };
  const onStderr = (chunk: Buffer): void => {
    const text = stderrCarry + chunk.toString('utf8');
    const lines = text.split(/\r?\n/);
    stderrCarry = lines.pop() ?? '';
    for (const line of lines) if (line.trim().length > 0) onLine(JSON.stringify({ type: 'log', operationId: 'stderr', level: 'warn', message: line }));
  };
  process.stdout.on('data', onStdout);
  process.stderr.on('data', onStderr);
  return () => {
    process.stdout.off('data', onStdout);
    process.stderr.off('data', onStderr);
  };
}

export class NodeProcessExecutableLauncher implements PackagedExecutableLauncher {
  constructor(private readonly cwd: string = process.cwd()) {}

  async invoke(invocation: PackagedExecutableInvocation): Promise<ConversionWorkerResult> {
    const requestId = randomUUID();
    const executablePath = resolve(this.cwd, invocation.executablePath);
    const asScript = ['.js', '.cjs', '.mjs'].includes(extname(executablePath).toLowerCase());
    const command = asScript ? process.execPath : executablePath;
    const args = asScript ? [executablePath, ...invocation.arguments] : [...invocation.arguments];
    const child = spawn(command, args, {
      cwd: this.cwd,
      stdio: 'pipe',
      windowsHide: true,
      env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    });
    const abort = (): void => {
      child.kill('SIGTERM');
    };
    invocation.signal.addEventListener('abort', abort, { once: true });
    try {
      const requestPayload = {
        type: 'request',
        requestId,
        operationId: invocation.request.operationId,
        commandId: invocation.request.commandId,
        sourceName: invocation.request.sourceName,
        sourceBase64: Buffer.from(invocation.request.source).toString('base64'),
        options: invocation.request.options,
        preview: invocation.request.preview,
      };
      child.stdin.write(JSON.stringify(requestPayload) + '\n');
      child.stdin.end();
      let resultEvent: WorkerResultEvent | undefined;
      let workerError: Error | undefined;
      const detach = collectLines(child, (line) => {
        const event = parseEvent(line);
        if (event.type === 'log') return;
        if (event.operationId !== invocation.request.operationId) return;
        if (event.type === 'progress') {
          const progress: ConversionProgress = { phase: event.phase, completed: event.completed, total: event.total, message: event.message };
          invocation.onProgress(progress);
          return;
        }
        if (event.type === 'error') {
          workerError = new Error(`${event.code}: ${event.message}`);
          return;
        }
        resultEvent = event;
      });
      const [code] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
      detach();
      if (invocation.signal.aborted) {
        const error = new Error('Conversion cancelled.');
        error.name = 'AbortError';
        throw error;
      }
      if (workerError) throw workerError;
      if (code !== 0) throw new Error(`Worker exited with code ${String(code)}.`);
      if (!resultEvent) throw new Error('Worker exited without a result event.');
      return {
        files: decodeFiles(resultEvent.files),
        warnings: resultEvent.warnings,
        lossiness: resultEvent.lossiness,
      };
    } finally {
      invocation.signal.removeEventListener('abort', abort);
    }
  }
}

export function parseBundledCommandsManifest(content: Uint8Array): ConversionCommandsManifest {
  const text = Buffer.from(content).toString('utf8');
  return parseCommandsManifest(JSON.parse(text));
}
