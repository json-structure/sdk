import type { Diagnostic, DiagnosticSeverity } from '../contracts.js';
import { ConversionRuntime, type ConversionRunResult } from './runtime.js';
import { cloneBuiltInCommandsManifest } from './manifest.js';
import type { ConversionStorage } from './storage.js';
import { validateOptionValues, type ConversionCommand, type ConversionCommandsManifest, type ConversionOptionValues, type ConverterMetadata } from './types.js';
import { validateGeneratedConversionFiles } from './validation.js';
import type { ConversionProgress, ConversionWarning, ConversionWorkerTransport } from './worker.js';

export interface EffectiveImportResolver {
  resolve(request: { commandId: string; sourceName: string; source: Uint8Array; documentUri?: string; signal: AbortSignal }): Promise<Uint8Array>;
}

export interface ConversionServiceDependencies {
  worker: ConversionWorkerTransport;
  storage?: ConversionStorage;
  effectiveImports?: EffectiveImportResolver;
  launcher?: { launch(path: string, application?: { id: string; displayName: string; executablePath?: string }): Promise<void> };
}

export interface ConversionExecutionRequest {
  operationId: string;
  commandId: string;
  sourceName: string;
  source: Uint8Array;
  /** Resolution base only; source bytes always come from the current editor snapshot. */
  documentUri?: string;
  destination?: string;
  preview: boolean;
  optionValues?: ConversionOptionValues;
  launch?: { autoOpen?: boolean; application?: { id: string; displayName: string; executablePath?: string } };
  signal?: AbortSignal;
  onProgress?(progress: ConversionProgress): void;
}

export interface ConversionExecutionResult {
  command: ConversionCommand;
  converter: ConverterMetadata;
  effectiveOptions: ConversionOptionValues;
  runtime: ConversionRunResult;
  diagnostics: readonly Diagnostic[];
}

export class ConversionService {
  private readonly runtime: ConversionRuntime;
  private readonly manifest: ConversionCommandsManifest;
  private readonly effectiveImports?: EffectiveImportResolver;

  constructor(dependencies: ConversionServiceDependencies, manifest?: ConversionCommandsManifest) {
    this.runtime = new ConversionRuntime(dependencies);
    this.effectiveImports = dependencies.effectiveImports;
    this.manifest = manifest ? structuredClone(manifest) : cloneBuiltInCommandsManifest();
  }

  listCommands(): ConversionCommandsManifest {
    return structuredClone(this.manifest);
  }

  prepare(commandId: string, optionValues?: ConversionOptionValues): { command: ConversionCommand; converter: ConverterMetadata; effectiveOptions: ConversionOptionValues } {
    const command = this.manifest.commands.find((item) => item.id === commandId);
    if (!command) throw new Error(`Unknown conversion command: ${commandId}.`);
    const converter = this.manifest.converters.find((item) => item.id === command.converterId);
    if (!converter) throw new Error(`Conversion command ${commandId} references unknown converter ${command.converterId}.`);
    return { command, converter, effectiveOptions: validateOptionValues(converter, optionValues ?? {}, command.optionNames) };
  }

  async execute(request: ConversionExecutionRequest): Promise<ConversionExecutionResult> {
    const prepared = this.prepare(request.commandId, request.optionValues);
    const { command, converter, effectiveOptions } = prepared;
    const signal = request.signal ?? new AbortController().signal;
    let source: Uint8Array<ArrayBufferLike> = new Uint8Array(request.source);
    if (command.direction === 'export' && this.effectiveImports && declaresImports(source)) {
      try {
        source = await this.effectiveImports.resolve({ commandId: command.id, sourceName: request.sourceName, source, ...(request.documentUri === undefined ? {} : { documentUri: request.documentUri }), signal });
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (signal.aborted || failure.name === 'AbortError') {
          const runtime = this.runtime.cancelled(failure.name === 'AbortError' ? failure : undefined);
          return { command, converter, effectiveOptions, runtime, diagnostics: diagnosticsFromRun(runtime) };
        }
        throw error;
      }
    }
    const runtime = await this.runtime.run({
      operationId: request.operationId,
      commandId: command.id,
      sourceName: request.sourceName,
      source,
      destination: request.destination,
      preview: request.preview,
      outputMode: command.direction === 'import' ? 'memory' : 'publish',
      options: effectiveOptions,
      defaultAutoOpen: command.defaultAutoOpen,
      launch: request.launch,
      signal,
      validateOutput: files => validateGeneratedConversionFiles(command.targetFormat, files),
      onProgress: request.onProgress,
    });
    return { command, converter, effectiveOptions, runtime, diagnostics: diagnosticsFromRun(runtime) };
  }
}

function diagnosticsFromRun(result: ConversionRunResult): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const warning of result.warnings) diagnostics.push(warningDiagnostic(warning));
  if (result.launchError) {
    diagnostics.push({
      code: 'conversion.launch.failed',
      message: result.launchError.message,
      severity: 'warning',
    });
  }
  if (result.state === 'failed' && result.error) {
    diagnostics.push({
      code: 'conversion.runtime.failed',
      message: result.error.message,
      severity: 'error',
    });
  }
  if (result.state === 'cancelled') {
    diagnostics.push({
      code: 'conversion.runtime.cancelled',
      message: 'Conversion was cancelled.',
      severity: 'info',
    });
  }
  return diagnostics;
}

function warningDiagnostic(warning: ConversionWarning): Diagnostic {
  const severityByLossiness: Readonly<Record<ConversionWarning['lossiness'], DiagnosticSeverity>> = {
    formatting: 'info',
    metadata: 'warning',
    precision: 'warning',
    'unsupported-feature': 'warning',
    'data-loss': 'error',
  };
  return {
    code: `conversion.warning.${warning.code}`,
    message: warning.message,
    severity: severityByLossiness[warning.lossiness],
    location: warning.targetPath ? { uri: warning.targetPath, pointer: warning.targetPath } : undefined,
  };
}

function declaresImports(source: Uint8Array): boolean {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(source)); } catch { return false; }
  return activeImportLocations(value).length > 0;
}

interface ActiveImportLocation { readonly keyword: '$import' | '$importdefs'; readonly pointer: string }

function activeImportLocations(document: unknown): readonly ActiveImportLocation[] {
  if (!isRecord(document)) return [];
  const locations: ActiveImportLocation[] = [];
  const inspect = (namespace: Record<string, unknown>, pointer: string): void => {
    for (const keyword of ['$import', '$importdefs'] as const) {
      if (Object.prototype.hasOwnProperty.call(namespace, keyword)) locations.push({ keyword, pointer: pointer + '/' + keyword });
    }
  };
  const visitNamespace = (namespace: unknown, pointer: string): void => {
    if (!isRecord(namespace)) return;
    inspect(namespace, pointer);
    for (const [name, member] of Object.entries(namespace)) {
      if (name === '$import' || name === '$importdefs' || !isRecord(member) || isTypeDeclaration(member)) continue;
      visitNamespace(member, pointer + '/' + escapePointer(name));
    }
  };
  inspect(document, '#');
  if (isRecord(document.definitions)) visitNamespace(document.definitions, '#/definitions');
  return locations;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTypeDeclaration(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'type') || Object.prototype.hasOwnProperty.call(value, '$extends') || Object.prototype.hasOwnProperty.call(value, 'abstract');
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
