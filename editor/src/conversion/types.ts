export type ConversionOption =
  | { name: string; type: 'boolean'; description?: string; default?: boolean }
  | { name: string; type: 'string'; description?: string; default?: string; allowedValues?: readonly string[] }
  | { name: string; type: 'number'; description?: string; default?: number; minimum?: number; maximum?: number };

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
}

export interface ConversionCommandsManifest {
  schemaVersion: 1;
  converters: readonly ConverterMetadata[];
  commands: readonly ConversionCommand[];
}

export type ConversionOptionValues = Readonly<Record<string, boolean | string | number>>;

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
  if (item.type === 'number') {
    for (const key of ['default', 'minimum', 'maximum'] as const) {
      if (item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isFinite(item[key]))) throw new Error(`${context}.${key} must be a finite number.`);
    }
    if (typeof item.minimum === 'number' && typeof item.maximum === 'number' && item.minimum > item.maximum) throw new Error(`${context}.minimum must not exceed maximum.`);
    return { name, type: 'number', description, default: item.default as number | undefined, minimum: item.minimum as number | undefined, maximum: item.maximum as number | undefined };
  }
  throw new Error(`${context}.type must be boolean, string, or number.`);
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
    if (!converterIds.has(converterId)) throw new Error(`manifest.commands[${index}] references an unknown converter.`);
    if (item.direction !== 'import' && item.direction !== 'export') throw new Error(`manifest.commands[${index}].direction must be import or export.`);
    if (item.defaultAutoOpen !== undefined && typeof item.defaultAutoOpen !== 'boolean') throw new Error(`manifest.commands[${index}].defaultAutoOpen must be a boolean.`);
    return {
      id: text(item.id, `manifest.commands[${index}].id`), converterId, direction: item.direction,
      label: text(item.label, `manifest.commands[${index}].label`),
      sourceFormat: text(item.sourceFormat, `manifest.commands[${index}].sourceFormat`),
      targetFormat: text(item.targetFormat, `manifest.commands[${index}].targetFormat`),
      defaultAutoOpen: item.defaultAutoOpen ?? true,
    };
  });
  if (new Set(commands.map(({ id }) => id)).size !== commands.length) throw new Error('Command ids must be unique.');
  return { schemaVersion: 1, converters, commands };
}

export function validateOptionValues(metadata: ConverterMetadata, values: ConversionOptionValues): ConversionOptionValues {
  const result: Record<string, boolean | string | number> = {};
  const definitions = new Map(metadata.options.map(option => [option.name, option]));
  for (const name of Object.keys(values)) if (!definitions.has(name)) throw new Error(`Unknown option: ${name}.`);
  for (const option of metadata.options) {
    const value = values[option.name] ?? option.default;
    if (value === undefined) continue;
    if (typeof value !== option.type) throw new Error(`Option ${option.name} must be a ${option.type}.`);
    if (option.type === 'string' && option.allowedValues && !option.allowedValues.includes(value as string)) throw new Error(`Option ${option.name} is not an allowed value.`);
    if (option.type === 'number' && option.minimum !== undefined && (value as number) < option.minimum) throw new Error(`Option ${option.name} is below its minimum.`);
    if (option.type === 'number' && option.maximum !== undefined && (value as number) > option.maximum) throw new Error(`Option ${option.name} exceeds its maximum.`);
    result[option.name] = value;
  }
  return result;
}