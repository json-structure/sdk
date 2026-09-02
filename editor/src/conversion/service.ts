import type { Diagnostic, DiagnosticSeverity } from '../contracts.js';
import { ConversionRuntime, type ConversionRunResult } from './runtime.js';
import { cloneBuiltInCommandsManifest } from './manifest.js';
import type { ConversionStorage } from './storage.js';
import { validateOptionValues, type ConversionCommand, type ConversionCommandsManifest, type ConversionOptionValues, type ConverterMetadata } from './types.js';
import { validateGeneratedConversionFiles } from './validation.js';
import type { ConversionProgress, ConversionWarning, ConversionWorkerTransport } from './worker.js';

export interface ConversionServiceDependencies {
  worker: ConversionWorkerTransport;
  storage?: ConversionStorage;
  launcher?: { launch(path: string, application?: { id: string; displayName: string; executablePath?: string }): Promise<void> };
}

export interface ConversionExecutionRequest {
  operationId: string;
  commandId: string;
  sourceName: string;
  source: Uint8Array;
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

  constructor(dependencies: ConversionServiceDependencies, manifest?: ConversionCommandsManifest) {
    this.runtime = new ConversionRuntime(dependencies);
    this.manifest = manifest ? structuredClone(manifest) : cloneBuiltInCommandsManifest();
  }

  listCommands(): ConversionCommandsManifest {
    return structuredClone(this.manifest);
  }

  async execute(request: ConversionExecutionRequest): Promise<ConversionExecutionResult> {
    const command = this.manifest.commands.find((item) => item.id === request.commandId);
    if (!command) throw new Error(`Unknown conversion command: ${request.commandId}.`);
    const converter = this.manifest.converters.find((item) => item.id === command.converterId);
    if (!converter) throw new Error(`Conversion command ${request.commandId} references unknown converter ${command.converterId}.`);
    const options = validateOptionValues(converter, request.optionValues ?? {}, command.optionNames);
    const runtime = await this.runtime.run({
      operationId: request.operationId,
      commandId: command.id,
      sourceName: request.sourceName,
      source: request.source,
      destination: request.destination,
      preview: request.preview,
      options,
      defaultAutoOpen: command.defaultAutoOpen,
      launch: request.launch,
      signal: request.signal,
      validateOutput: files => validateGeneratedConversionFiles(command.targetFormat, files),
      onProgress: request.onProgress,
    });
    return { command, converter, effectiveOptions: options, runtime, diagnostics: diagnosticsFromRun(runtime) };
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
