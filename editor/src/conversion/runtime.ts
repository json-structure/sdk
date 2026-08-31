import { createOutputManifest } from './integrity.js';
import { shouldAutoOpen, type HostLaunchAdapter, type LaunchPreference } from './launch.js';
import { ConversionLifecycle, type ConversionState } from './lifecycle.js';
import { publishAtomically, type ConversionStorage } from './storage.js';
import type { ConversionOptionValues } from './types.js';
import { abortError, type ConversionProgress, type ConversionWarning, type ConversionWorkerTransport, type Lossiness } from './worker.js';

const encoder = new TextEncoder();

export interface ConversionRunRequest {
  operationId: string;
  commandId: string;
  sourceName: string;
  source: Uint8Array;
  options?: ConversionOptionValues;
  destination?: string;
  preview?: boolean;
  defaultAutoOpen?: boolean;
  launch?: LaunchPreference;
  signal?: AbortSignal;
  onProgress?(progress: ConversionProgress): void;
}

export interface ConversionRunResult {
  state: Extract<ConversionState, 'completed' | 'cancelled' | 'failed'>;
  states: readonly ConversionState[];
  files: Readonly<Record<string, Uint8Array>>;
  warnings: readonly ConversionWarning[];
  lossiness: Lossiness;
  manifest?: ReturnType<typeof createOutputManifest>;
  published: boolean;
  launchError?: Error;
  error?: Error;
}

export interface ConversionRuntimeDependencies {
  worker: ConversionWorkerTransport;
  storage?: ConversionStorage;
  launcher?: HostLaunchAdapter;
}

export class ConversionRuntime {
  constructor(private readonly dependencies: ConversionRuntimeDependencies) {}

  async run(request: ConversionRunRequest): Promise<ConversionRunResult> {
    const lifecycle = new ConversionLifecycle();
    let files: Readonly<Record<string, Uint8Array>> = {};
    let warnings: readonly ConversionWarning[] = [];
    let lossiness: Lossiness = 'none';
    let published = false;
    let manifest: ReturnType<typeof createOutputManifest> | undefined;
    const signal = request.signal ?? new AbortController().signal;
    try {
      lifecycle.transition('preparing');
      if (signal.aborted) throw abortError();
      lifecycle.transition('running');
      const result = await this.dependencies.worker.execute({
        operationId: request.operationId, commandId: request.commandId, sourceName: request.sourceName,
        source: request.source.slice(), options: request.options ?? {}, preview: request.preview ?? false,
      }, { signal, reportProgress: progress => request.onProgress?.(progress) });
      files = result.files;
      warnings = result.warnings;
      lossiness = result.lossiness;
      manifest = createOutputManifest(files);
      if (request.preview) {
        lifecycle.transition('completed');
        return { state: 'completed', states: lifecycle.states, files, warnings, lossiness, manifest, published };
      }
      if (!request.destination || !this.dependencies.storage) throw new Error('Publication requires a destination and storage adapter.');
      lifecycle.transition('publishing');
      await publishAtomically(this.dependencies.storage, request.destination, request.operationId, files, encoder.encode(JSON.stringify(manifest, null, 2) + '\n'), signal);
      published = true;
      if (shouldAutoOpen(request.launch, request.defaultAutoOpen ?? true) && this.dependencies.launcher) {
        lifecycle.transition('launching');
        try {
          await this.dependencies.launcher.launch(request.destination, request.launch?.application);
        } catch (error) {
          const launchError = asError(error);
          lifecycle.transition('completed');
          return { state: 'completed', states: lifecycle.states, files, warnings, lossiness, manifest, published, launchError };
        }
      }
      lifecycle.transition('completed');
      return { state: 'completed', states: lifecycle.states, files, warnings, lossiness, manifest, published };
    } catch (error) {
      const failure = asError(error);
      lifecycle.transition(signal.aborted || failure.name === 'AbortError' ? 'cancelled' : 'failed');
      return { state: lifecycle.state as 'cancelled' | 'failed', states: lifecycle.states, files, warnings, lossiness, manifest, published, error: failure };
    }
  }
}

function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }