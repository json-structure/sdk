export {
  GeneratedImportRegistry,
  MAX_PRIMARY_DOCUMENT_BYTES,
  MAX_PRIMARY_DOCUMENT_DEPTH,
  MAX_PRIMARY_DOCUMENT_NODES,
  MAX_PENDING_IMPORT_BYTES,
  MAX_PENDING_IMPORT_DOCUMENTS,
  validatePrimaryDocument,
  type GeneratedImportHandle,
  type GeneratedImportContent,
} from './import-output.js';
export type ConversionOption =
  | { name: string; type: 'boolean'; description?: string; default?: boolean }
  | { name: string; type: 'string'; description?: string; default?: string; allowedValues?: readonly string[] }
  | { name: string; type: 'string-list'; description?: string; default?: readonly string[] }
  | { name: string; type: 'number'; description?: string; default?: number; minimum?: number; maximum?: number };

export { validateGeneratedConversionFiles } from './validation.js';

export interface ConverterMetadata {
  id: string;
  displayName: string;
  version: string;
  sourceFormats: readonly string[];
  targetFormats: readonly string[];
  options: readonly ConversionOption[];
}

export interface ConversionCommand {
  id: string;
  converterId: string;
  direction: 'import' | 'export';
  label: string;
  sourceFormat: string;
  targetFormat: string;
  defaultAutoOpen: boolean;
  optionNames?: readonly string[];
  cliCommand?: string;
  cliPipeline?: readonly {
    cliCommand: string;
    outputKind: 'file' | 'directory';
    outputName: string;
    optionNames?: readonly string[];
  }[];
  outputKind?: 'file' | 'directory';
  outputName?: string;
  /** File extensions accepted by the host source picker for import routes. */
  sourceExtensions?: readonly string[];
  /** A route that needs a host capability rather than a local source file. */
  availability?: 'local' | 'external-service';
  availabilityMessage?: string;
  availabilityRequirements?: readonly string[];
}

export interface ConversionCommandsManifest {
  schemaVersion: 1;
  converters: readonly ConverterMetadata[];
  commands: readonly ConversionCommand[];
}

export type ConversionOptionValue = boolean | string | number | readonly string[];
export type ConversionOptionValues = Readonly<Record<string, ConversionOptionValue>>;

export interface ConversionWorkerLimits {
  readonly maxExecutionMs: number;
  readonly maxOldSpaceMb: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxLineBytes: number;
  readonly maxFiles: number;
  readonly maxWarnings: number;
  readonly maxFileBytes: number;
  readonly maxAggregateFileBytes: number;
}

export const CONVERSION_WORKER_LIMITS: ConversionWorkerLimits = Object.freeze({
  maxExecutionMs: 30_000,
  maxOldSpaceMb: 128,
  maxStdoutBytes: 48 * 1024 * 1024,
  maxStderrBytes: 1024 * 1024,
  maxLineBytes: 40 * 1024 * 1024,
  maxFiles: 256,
  maxWarnings: 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxAggregateFileBytes: 32 * 1024 * 1024,
});

export class ConversionWorkerQuotaTracker {
  private stdoutBytes = 0;
  private stderrBytes = 0;

  constructor(readonly limits: ConversionWorkerLimits = CONVERSION_WORKER_LIMITS) {}

  consume(channel: 'stdout' | 'stderr', bytes: number): void {
    if (!Number.isInteger(bytes) || bytes < 0) throw new Error('Worker stream byte count must be a non-negative integer.');
    if (channel === 'stdout') {
      this.stdoutBytes += bytes;
      if (this.stdoutBytes > this.limits.maxStdoutBytes) throw new Error(`Converter stdout exceeds the ${this.limits.maxStdoutBytes}-byte quota.`);
      return;
    }
    this.stderrBytes += bytes;
    if (this.stderrBytes > this.limits.maxStderrBytes) throw new Error(`Converter stderr exceeds the ${this.limits.maxStderrBytes}-byte quota.`);
  }

  validateLine(line: string): void {
    const bytes = new TextEncoder().encode(line).byteLength;
    if (bytes > this.limits.maxLineBytes) throw new Error(`Converter output line exceeds the ${this.limits.maxLineBytes}-byte quota.`);
  }
}

export interface QuotaWorkerFile { readonly path: string; readonly contentBase64: string }

export function validateWorkerOutputQuotas(
  files: readonly QuotaWorkerFile[],
  warnings: readonly unknown[],
  limits: ConversionWorkerLimits = CONVERSION_WORKER_LIMITS,
): void {
  if (files.length > limits.maxFiles) throw new Error(`Converter output exceeds the ${limits.maxFiles}-file quota.`);
  if (warnings.length > limits.maxWarnings) throw new Error(`Converter output exceeds the ${limits.maxWarnings}-warning quota.`);
  let aggregateBytes = 0;
  const paths = new Set<string>();
  for (const file of files) {
    if (!file.path || file.path.length > 4096) throw new Error('Converter output contains an invalid file path.');
    const canonicalPath = file.path.replace(/\\/g, '/').toLocaleLowerCase('en-US');
    if (paths.has(canonicalPath)) throw new Error(`Converter output contains duplicate or case-colliding path ${file.path}.`);
    paths.add(canonicalPath);
    const bytes = decodedBase64Bytes(file.contentBase64);
    if (bytes > limits.maxFileBytes) throw new Error(`Converter output ${file.path} exceeds the ${limits.maxFileBytes}-byte per-file quota.`);
    aggregateBytes += bytes;
    if (aggregateBytes > limits.maxAggregateFileBytes) throw new Error(`Converter output exceeds the ${limits.maxAggregateFileBytes}-byte aggregate quota.`);
  }
}

function decodedBase64Bytes(value: string): number {
  if (value.length === 0) return 0;
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Converter output contains invalid base64 content.');
  return value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${context} must be a non-empty string.`);
  return value;
}

function stringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array.`);
  return value.map((item, index) => text(item, `${context}[${index}]`));
}

function parseOption(value: unknown, context: string): ConversionOption {
  const item = record(value, context);
  const name = text(item.name, `${context}.name`);
  const description = item.description === undefined ? undefined : text(item.description, `${context}.description`);
  if (item.type === 'boolean') {
    if (item.default !== undefined && typeof item.default !== 'boolean') throw new Error(`${context}.default must be a boolean.`);
    return { name, type: 'boolean', description, default: item.default };
  }
  if (item.type === 'string') {
    if (item.default !== undefined && typeof item.default !== 'string') throw new Error(`${context}.default must be a string.`);
    const allowedValues = item.allowedValues === undefined ? undefined : stringArray(item.allowedValues, `${context}.allowedValues`);
    if (item.default !== undefined && allowedValues && !allowedValues.includes(item.default)) throw new Error(`${context}.default is not an allowed value.`);
    return { name, type: 'string', description, default: item.default, allowedValues };
  }
  if (item.type === 'string-list') {
    if (item.default !== undefined && (!Array.isArray(item.default) || !item.default.every((entry) => typeof entry === 'string' && entry.trim() !== ''))) throw new Error(`${context}.default must be an array of non-empty strings.`);
    return { name, type: 'string-list', description, default: item.default === undefined ? undefined : [...item.default as string[]] };
  }
  if (item.type === 'number') {
    for (const key of ['default', 'minimum', 'maximum'] as const) {
      if (item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isFinite(item[key]))) throw new Error(`${context}.${key} must be a finite number.`);
    }
    if (typeof item.minimum === 'number' && typeof item.maximum === 'number' && item.minimum > item.maximum) throw new Error(`${context}.minimum must not exceed maximum.`);
    return { name, type: 'number', description, default: item.default as number | undefined, minimum: item.minimum as number | undefined, maximum: item.maximum as number | undefined };
  }
  throw new Error(`${context}.type must be boolean, string, string-list, or number.`);
}

export function parseCommandsManifest(value: unknown): ConversionCommandsManifest {
  const root = record(value, 'manifest');
  if (root.schemaVersion !== 1) throw new Error('manifest.schemaVersion must be 1.');
  if (!Array.isArray(root.converters) || !Array.isArray(root.commands)) throw new Error('manifest converters and commands must be arrays.');
  const converters = root.converters.map((value, index): ConverterMetadata => {
    const item = record(value, `manifest.converters[${index}]`);
    if (!Array.isArray(item.options)) throw new Error(`manifest.converters[${index}].options must be an array.`);
    return {
      id: text(item.id, `manifest.converters[${index}].id`),
      displayName: text(item.displayName, `manifest.converters[${index}].displayName`),
      version: text(item.version, `manifest.converters[${index}].version`),
      sourceFormats: stringArray(item.sourceFormats, `manifest.converters[${index}].sourceFormats`),
      targetFormats: stringArray(item.targetFormats, `manifest.converters[${index}].targetFormats`),
      options: item.options.map((option, optionIndex) => parseOption(option, `manifest.converters[${index}].options[${optionIndex}]`)),
    };
  });
  const converterIds = new Set(converters.map(({ id }) => id));
  if (converterIds.size !== converters.length) throw new Error('Converter ids must be unique.');
  const commands = root.commands.map((value, index): ConversionCommand => {
    const item = record(value, `manifest.commands[${index}]`);
    const converterId = text(item.converterId, `manifest.commands[${index}].converterId`);
    const converter = converters.find((candidate) => candidate.id === converterId);
    if (!converter) throw new Error(`manifest.commands[${index}] references an unknown converter.`);
    if (item.direction !== 'import' && item.direction !== 'export') throw new Error(`manifest.commands[${index}].direction must be import or export.`);
    if (item.defaultAutoOpen !== undefined && typeof item.defaultAutoOpen !== 'boolean') throw new Error(`manifest.commands[${index}].defaultAutoOpen must be a boolean.`);
    const optionNames = item.optionNames === undefined ? undefined : stringArray(item.optionNames, `manifest.commands[${index}].optionNames`);
    if (optionNames && new Set(optionNames).size !== optionNames.length) throw new Error(`manifest.commands[${index}].optionNames must be unique.`);
    if (optionNames) for (const optionName of optionNames) if (!converter.options.some((option) => option.name === optionName)) throw new Error(`manifest.commands[${index}] references unknown option ${optionName}.`);
    const sourceExtensions = item.sourceExtensions === undefined ? undefined : stringArray(item.sourceExtensions, `manifest.commands[${index}].sourceExtensions`);
    const availability = item.availability === undefined ? undefined : item.availability === 'local' || item.availability === 'external-service'
      ? item.availability
      : (() => { throw new Error(`manifest.commands[${index}].availability must be local or external-service.`); })();
    const availabilityMessage = item.availabilityMessage === undefined ? undefined : text(item.availabilityMessage, `manifest.commands[${index}].availabilityMessage`);
    const availabilityRequirements = item.availabilityRequirements === undefined ? undefined : stringArray(item.availabilityRequirements, `manifest.commands[${index}].availabilityRequirements`);
    if (availability === 'external-service' && availabilityMessage === undefined) throw new Error(`manifest.commands[${index}] must explain its external-service requirement.`);
    const cliPipeline = item.cliPipeline === undefined ? undefined : (() => {
      if (!Array.isArray(item.cliPipeline) || item.cliPipeline.length < 2) throw new Error(`manifest.commands[${index}].cliPipeline must contain at least two steps.`);
      return item.cliPipeline.map((value, stepIndex) => {
        const step = record(value, `manifest.commands[${index}].cliPipeline[${stepIndex}]`);
        const stepOptionNames = step.optionNames === undefined ? undefined : stringArray(step.optionNames, `manifest.commands[${index}].cliPipeline[${stepIndex}].optionNames`);
        if (step.outputKind !== 'file' && step.outputKind !== 'directory') throw new Error(`manifest.commands[${index}].cliPipeline[${stepIndex}].outputKind must be file or directory.`);
        const outputKind: 'file' | 'directory' = step.outputKind;
        return {
          cliCommand: text(step.cliCommand, `manifest.commands[${index}].cliPipeline[${stepIndex}].cliCommand`),
          outputKind,
          outputName: text(step.outputName, `manifest.commands[${index}].cliPipeline[${stepIndex}].outputName`),
          optionNames: stepOptionNames,
        };
      });
    })();
    if (item.cliCommand !== undefined && cliPipeline !== undefined) throw new Error(`manifest.commands[${index}] cannot define both cliCommand and cliPipeline.`);
    return {
      id: text(item.id, `manifest.commands[${index}].id`), converterId, direction: item.direction,
      label: text(item.label, `manifest.commands[${index}].label`),
      sourceFormat: text(item.sourceFormat, `manifest.commands[${index}].sourceFormat`),
      targetFormat: text(item.targetFormat, `manifest.commands[${index}].targetFormat`),
      defaultAutoOpen: item.defaultAutoOpen ?? true,
      optionNames,
      cliCommand: item.cliCommand === undefined ? undefined : text(item.cliCommand, `manifest.commands[${index}].cliCommand`),
      cliPipeline,
      outputKind: item.outputKind === undefined ? undefined : item.outputKind === 'file' || item.outputKind === 'directory'
        ? item.outputKind
        : (() => { throw new Error(`manifest.commands[${index}].outputKind must be file or directory.`); })(),
      outputName: item.outputName === undefined ? undefined : text(item.outputName, `manifest.commands[${index}].outputName`),
      sourceExtensions,
      availability,
      availabilityMessage,
      availabilityRequirements,
    };
  });
  if (new Set(commands.map(({ id }) => id)).size !== commands.length) throw new Error('Command ids must be unique.');
  return { schemaVersion: 1, converters, commands };
}

export function conversionOptionsForCommand(metadata: ConverterMetadata, command: ConversionCommand): readonly ConversionOption[] {
  const allowed = new Set(command.optionNames ?? metadata.options.map((option) => option.name));
  return metadata.options.filter((option) => allowed.has(option.name));
}

export function validateOptionValues(metadata: ConverterMetadata, values: ConversionOptionValues, optionNames?: readonly string[]): ConversionOptionValues {
  const result: Record<string, ConversionOptionValue> = {};
  const allowed = new Set(optionNames ?? metadata.options.map((option) => option.name));
  const definitions = new Map(metadata.options.filter((option) => allowed.has(option.name)).map(option => [option.name, option]));
  for (const name of Object.keys(values)) if (!definitions.has(name)) throw new Error(`Unknown option: ${name}.`);
  for (const option of definitions.values()) {
    const value = values[option.name] ?? option.default;
    if (value === undefined) continue;
    if (option.type === 'string-list') {
      if (!Array.isArray(value) || value.length > 256 || !value.every((entry) => typeof entry === 'string' && entry.trim() !== '' && entry.length <= 256)) throw new Error(`Option ${option.name} must be an array of non-empty strings.`);
      result[option.name] = [...value];
      continue;
    }
    if (typeof value !== option.type || option.type === 'number' && !Number.isFinite(value)) throw new Error(`Option ${option.name} must be a ${option.type}.`);
    if (option.type === 'string' && option.allowedValues && !option.allowedValues.includes(value as string)) throw new Error(`Option ${option.name} is not an allowed value.`);
    if (option.type === 'number' && option.minimum !== undefined && (value as number) < option.minimum) throw new Error(`Option ${option.name} is below its minimum.`);
    if (option.type === 'number' && option.maximum !== undefined && (value as number) > option.maximum) throw new Error(`Option ${option.name} exceeds its maximum.`);
    result[option.name] = value;
  }
  return result;
}