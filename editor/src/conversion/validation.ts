import { parseDocument } from '../parser.js';

const CORE_SCHEMA_URI = 'https://json-structure.org/meta/core/v0/#';
const EXTENDED_SCHEMA_URI = 'https://json-structure.org/meta/extended/v0/#';
const VALIDATION_SCHEMA_URI = 'https://json-structure.org/meta/validation/v0/#';
const JSON_SCHEMA_URI = 'https://json-schema.org/draft/2020-12/schema';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pointerValue(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith('#/')) return undefined;
  return pointer.slice(2).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((value, token) =>
    isRecord(value) ? value[token] : undefined, root);
}

function validateJsonStructure(document: Record<string, unknown>, path: string): void {
  if (![CORE_SCHEMA_URI, EXTENDED_SCHEMA_URI, VALIDATION_SCHEMA_URI].includes(String(document.$schema))) throw new Error(`Generated JSON Structure output ${path} has a non-canonical schema URI.`);
  if (typeof document.$id !== 'string') throw new Error(`Generated JSON Structure output ${path} requires an absolute $id URI.`);
  try {
    if (!new URL(document.$id).protocol) throw new Error();
  } catch {
    throw new Error(`Generated JSON Structure output ${path} requires an absolute $id URI.`);
  }
  if (typeof document.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(document.name)) throw new Error(`Generated JSON Structure output ${path} requires a valid name.`);
  if (typeof document.$root !== 'string' || !isRecord(pointerValue(document, document.$root))) throw new Error(`Generated JSON Structure output ${path} has an unresolved $root.`);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isRecord(value)) return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#') && pointerValue(document, value.$ref) === undefined) {
      throw new Error(`Generated JSON Structure output ${path} has an unresolved reference ${value.$ref}.`);
    }
    Object.values(value).forEach(visit);
  };
  visit(document);
}

export function validateGeneratedConversionFiles(targetFormat: string, files: Readonly<Record<string, Uint8Array>>): void {
  const entries = Object.entries(files);
  if (entries.length === 0) throw new Error('Converter produced no output files.');
  for (const [path, content] of entries) {
    if (targetFormat === 'protobuf' && path.endsWith('.proto')) {
      const text = new TextDecoder().decode(content);
      if (!/^syntax = "proto3";\n/.test(text) || !/\n(?:message|enum) [A-Za-z_][A-Za-z0-9_]* \{\n/.test(text) || !text.endsWith('\n')) throw new Error(`Generated Protobuf output ${path} is not a canonical proto3 source file.`);
      continue;
    }
    let value: unknown;
    const text = new TextDecoder().decode(content);
    try { value = JSON.parse(text); }
    catch { throw new Error(`Generated output ${path} is not valid JSON.`); }
    if (targetFormat === 'avro') {
      if (typeof value === 'string' && value.length > 0) continue;
      if (Array.isArray(value) && value.length > 0) continue;
      if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'type')) continue;
      throw new Error(`Generated Avro output ${path} has no root type.`);
    }
    if (!isRecord(value)) throw new Error(`Generated output ${path} must be a JSON object.`);
    if (targetFormat === 'protobuf') {
      if (path !== 'proto-numbers.json' || value.version !== 2 || !isRecord(value.messages) || !isRecord(value.enums)) throw new Error(`Generated Protobuf lock ${path} is invalid.`);
      continue;
    }
    if (targetFormat === 'json-structure') {
      validateJsonStructure(value, path);
      const parsed = parseDocument(`conversion-output://${encodeURIComponent(path)}`, text);
      const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      if (errors.length > 0) {
        const first = errors[0];
        throw new Error(`Generated JSON Structure output ${path} failed canonical validation: ${first.code} at ${first.location?.pointer || '/'}: ${first.message}`);
      }
    }
    else if (targetFormat === 'json-schema' && value.$schema !== JSON_SCHEMA_URI) throw new Error(`Generated JSON Schema output ${path} has an unsupported dialect.`);
  }
}