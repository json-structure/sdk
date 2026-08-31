import type { ConversionOptionValues } from './types.js';

export type Lossiness = 'none' | 'formatting' | 'metadata' | 'precision' | 'unsupported-feature' | 'data-loss';

export interface ConversionWarning {
  code: string;
  message: string;
  lossiness: Exclude<Lossiness, 'none'>;
  sourceLocation?: string;
  targetPath?: string;
  details?: Readonly<Record<string, string | number | boolean>>;
}

export interface ConversionProgress { phase: string; completed: number; total: number; message?: string }
export interface ConversionWorkerRequest {
  operationId: string;
  commandId: string;
  sourceName: string;
  source: Uint8Array;
  options: ConversionOptionValues;
  preview: boolean;
}
export interface ConversionWorkerResult {
  files: Readonly<Record<string, Uint8Array>>;
  warnings: readonly ConversionWarning[];
  lossiness: Lossiness;
}
export interface ConversionWorkerContext {
  signal: AbortSignal;
  reportProgress(progress: ConversionProgress): void;
}
export interface ConversionWorkerTransport {
  execute(request: ConversionWorkerRequest, context: ConversionWorkerContext): Promise<ConversionWorkerResult>;
  dispose?(): Promise<void>;
}

export interface PackagedExecutableInvocation {
  executablePath: string;
  arguments: readonly string[];
  request: ConversionWorkerRequest;
  signal: AbortSignal;
  onProgress(progress: ConversionProgress): void;
}
export interface PackagedExecutableLauncher {
  invoke(invocation: PackagedExecutableInvocation): Promise<ConversionWorkerResult>;
}

/** Contract adapter for a host-owned process launcher; it never searches PATH or invokes Python. */
export class PackagedExecutableWorkerAdapter implements ConversionWorkerTransport {
  constructor(private readonly executablePath: string, private readonly launcher: PackagedExecutableLauncher) {
    if (!executablePath || /(^|[\\/])(?:python(?:3|\.exe)?|py(?:\.exe)?)$/i.test(executablePath)) throw new Error('A packaged non-Python executable path is required.');
  }
  execute(request: ConversionWorkerRequest, context: ConversionWorkerContext): Promise<ConversionWorkerResult> {
    return this.launcher.invoke({ executablePath: this.executablePath, arguments: ['--json-lines'], request, signal: context.signal, onProgress: context.reportProgress });
  }
}

export type InProcessConversionHandler = (request: ConversionWorkerRequest, context: ConversionWorkerContext) => Promise<ConversionWorkerResult> | ConversionWorkerResult;

/** Deterministic worker used by tests and embedding hosts. */
export class DeterministicInProcessWorker implements ConversionWorkerTransport {
  constructor(private readonly handler: InProcessConversionHandler) {}
  async execute(request: ConversionWorkerRequest, context: ConversionWorkerContext): Promise<ConversionWorkerResult> {
    if (context.signal.aborted) throw abortError();
    const result = await this.handler(request, context);
    if (context.signal.aborted) throw abortError();
    return result;
  }
}

export function abortError(): Error {
  const error = new Error('Conversion cancelled.');
  error.name = 'AbortError';
  return error;
}