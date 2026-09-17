#!/usr/bin/env node
'use strict';

const { stdin, stdout } = process;
const { createHash } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, delimiter, extname, join, relative, resolve } = require('node:path');
const { generateProto } = require('./proto-generator.cjs');
const commandsManifest = require('./commands-manifest.json');
const STRUCTURIZE_ROUTE_NAMES = ['fbs2s', 'j2s', 'json2s', 'xml2s', 'a2s', 'jtd2s', 'cddl2s', 'oas2s', 'cue2s', 'thrift2s', 'smithy2s', 'capnp2s', 'raml2s', 'k2s'];
const STRUCTURIZE_EXPORT_ROUTE_NAMES = ['s2asn', 's2fbs', 's2k', 's2sql', 's2ib', 's2pq', 's2tsml', 's2cs', 's2py', 's2cpp', 's2csv', 's2rust', 's2ts', 's2java', 's2js', 's2go', 's2graphql', 's2dp', 's2cassandra', 's2jtd', 's2x', 's2cddl', 's2md', 's2cue', 's2thrift', 's2smithy', 's2capnp', 's2raml'];

function runtimePathIsSafe(value) {
  return typeof value === 'string' && value.length > 0 && !/^(?:[a-z]:|[\\/])/i.test(value) && !value.split(/[\\/]/).includes('..');
}

function runtimeFileEntries(directory, root = directory, entries = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const target = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Bundled Structurize runtime contains an unsupported symbolic link: ${relative(root, target)}`);
    if (entry.isDirectory()) runtimeFileEntries(target, root, entries);
    else if (entry.isFile()) entries.push({ path: relative(root, target).split('\\').join('/'), sha256: createHash('sha256').update(readFileSync(target)).digest('hex') });
    else throw new Error(`Bundled Structurize runtime contains an unsupported filesystem entry: ${relative(root, target)}`);
  }
  return entries;
}

function runtimeTreeDigest(entries) {
  return createHash('sha256').update(entries.filter((entry) => entry.path !== 'runtime.json').sort((left, right) => left.path.localeCompare(right.path)).map((entry) => `${entry.path}\0${entry.sha256}\n`).join('')).digest('hex');
}

function verifyBundledRuntime(runtimeDirectory, manifestPath, manifest) {
  const platformKey = `${process.platform}-${process.arch}`;
  if (!isRecord(manifest) || manifest.schemaVersion !== 1 || manifest.kind !== 'structurize-runtime' || manifest.implementation !== 'avrotize') throw new Error(`Bundled Structurize runtime manifest is malformed: ${manifestPath}`);
  if (manifest.platform?.key !== platformKey || manifest.platform?.nodePlatform !== process.platform || manifest.platform?.nodeArchitecture !== process.arch) throw new Error(`Bundled Structurize runtime targets ${manifest.platform?.key || 'an unknown platform'}, not ${platformKey}: ${manifestPath}`);
  if (typeof manifest.source?.revision !== 'string' || !/^[a-f0-9]{40}$/i.test(manifest.source.revision) || !/^[a-f0-9]{64}$/i.test(manifest.source.fingerprint) || !/^[a-f0-9]{64}$/i.test(manifest.dependenciesFingerprint)) throw new Error(`Bundled Structurize runtime provenance metadata is incomplete: ${manifestPath}`);
  if (typeof manifest.executable !== 'string' || !runtimePathIsSafe(manifest.executable) || manifest.executable === '.' || !Array.isArray(manifest.arguments) || !manifest.arguments.every((value) => typeof value === 'string')) throw new Error(`Bundled Structurize runtime interpreter metadata is malformed: ${manifestPath}`);
  if (manifest.interpreter?.executable !== manifest.executable || typeof manifest.interpreter?.version !== 'string' || !manifest.interpreter.version.startsWith('3.12.') || !runtimePathIsSafe(manifest.interpreter.sharedLibrary)) throw new Error(`Bundled Structurize runtime interpreter metadata is incomplete: ${manifestPath}`);
  if (!Array.isArray(manifest.routes) || JSON.stringify(manifest.routes) !== JSON.stringify(STRUCTURIZE_ROUTE_NAMES)) throw new Error(`Bundled Structurize runtime route contract is incomplete: ${manifestPath}`);
  if (!Array.isArray(manifest.exportRoutes) || JSON.stringify(manifest.exportRoutes) !== JSON.stringify(STRUCTURIZE_EXPORT_ROUTE_NAMES)) throw new Error(`Bundled Structurize runtime export route contract is incomplete: ${manifestPath}`);
  if (manifest.availability?.k2s?.kind !== 'external-service' || !Array.isArray(manifest.availability?.k2s?.requires) || manifest.availability.k2s.requires.length !== 3 || typeof manifest.availability?.k2s?.message !== 'string') throw new Error(`Bundled Structurize runtime k2s availability metadata is malformed: ${manifestPath}`);
  if (manifest.licenses?.avrotize !== 'MIT' || manifest.licenses?.cpython !== 'Python Software Foundation License' || !Array.isArray(manifest.dependencies) || !Array.isArray(manifest.requiredFiles)) throw new Error(`Bundled Structurize runtime license metadata is incomplete: ${manifestPath}`);
  if (['avrotize/commands.json', 'LICENSE.txt', 'avrotize.LICENSE', 'THIRD-PARTY-NOTICES.txt', manifest.executable, manifest.interpreter.sharedLibrary].some((required) => !manifest.requiredFiles.some((file) => file.path === required))) throw new Error(`Bundled Structurize runtime required-file metadata is incomplete: ${manifestPath}`);
  for (const file of manifest.requiredFiles) {
    if (!runtimePathIsSafe(file?.path) || !/^[a-f0-9]{64}$/i.test(file?.sha256)) throw new Error(`Bundled Structurize runtime file metadata is malformed: ${manifestPath}`);
    const target = join(runtimeDirectory, file.path);
    if (!existsSync(target) || createHash('sha256').update(readFileSync(target)).digest('hex') !== file.sha256.toLowerCase()) throw new Error(`Bundled Structurize runtime integrity check failed for ${file.path}: ${manifestPath}`);
  }
  const executable = join(runtimeDirectory, manifest.executable);
  if (!existsSync(executable)) throw new Error(`Bundled Structurize executable is missing: ${executable}`);
  if (!Array.isArray(manifest.pythonPath) || !manifest.pythonPath.every(runtimePathIsSafe)) throw new Error(`Bundled Structurize runtime PYTHONPATH metadata is malformed: ${manifestPath}`);
  return { executable, arguments: manifest.arguments, environment: { PYTHONHOME: runtimeDirectory, PYTHONPATH: manifest.pythonPath.map((value) => join(runtimeDirectory, value)).join(delimiter), PYTHONDONTWRITEBYTECODE: '1' } };
}
const CORE_SCHEMA_URI = 'https://json-structure.org/meta/core/v0/#';
const EXTENDED_SCHEMA_URI = 'https://json-structure.org/meta/extended/v0/#';
const VALIDATION_SCHEMA_URI = 'https://json-structure.org/meta/validation/v0/#';
const JSON_SCHEMA_URI = 'https://json-schema.org/draft/2020-12/schema';
const VALIDATION_KEYWORDS = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'minContains', 'maxContains', 'minProperties', 'maxProperties', 'minEntries', 'maxEntries', 'default', 'contains', 'propertyNames', 'keyNames', 'has', 'dependentRequired', 'patternProperties', 'patternKeys']);
const COMPOSITION_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else']);

function emit(event) {
  stdout.write(JSON.stringify(event) + '\n');
}

const lossinessRank = { none: 0, formatting: 1, metadata: 2, precision: 3, 'unsupported-feature': 4, 'data-loss': 5 };

function aggregateLossiness(warnings) {
  return warnings.reduce((result, warning) => lossinessRank[warning.lossiness] > lossinessRank[result] ? warning.lossiness : result, 'none');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function defineOwn(target, key, value) {
  Object.defineProperty(target, key, { configurable: true, enumerable: true, writable: true, value });
  return value;
}

const JSON_SCHEMA_VOCABULARY = new Set([
  '$schema', '$id', '$ref', '$anchor', '$dynamicRef', '$dynamicAnchor', '$defs', '$comment',
  '$recursiveRef', '$recursiveAnchor', '$vocabulary',
  'type', 'enum', 'const', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'prefixItems', 'items', 'contains', 'additionalItems', 'additionalProperties', 'properties',
  'patternProperties', 'unevaluatedItems', 'unevaluatedProperties', 'propertyNames',
  'dependentSchemas', 'dependencies', 'required', 'dependentRequired', 'minContains', 'maxContains',
  'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum', 'maxLength',
  'minLength', 'pattern', 'maxItems', 'minItems', 'uniqueItems', 'maxProperties', 'minProperties',
  'format', 'contentEncoding', 'contentMediaType', 'contentSchema', 'title', 'description',
  'default', 'deprecated', 'readOnly', 'writeOnly', 'examples', 'definitions', 'id',
]);

function isTypeDeclaration(value) {
  return isRecord(value) && (Object.prototype.hasOwnProperty.call(value, 'type') || Object.prototype.hasOwnProperty.call(value, '$extends') || Object.prototype.hasOwnProperty.call(value, 'abstract'));
}

function isJsonSchemaNode(value) {
  if (typeof value === 'boolean') return true;
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  // A namespace is an object whose children are all declaration/namespace objects.
  // Every other object is a schema, including an empty or annotation-only schema.
  return keys.length === 0 || keys.some((key) => JSON_SCHEMA_VOCABULARY.has(key)) || keys.some((key) => !isRecord(value[key]));
}

function activeImportLocations(document) {
  if (!isRecord(document)) return [];
  const locations = [];
  const inspect = (namespace, pointer) => {
    for (const key of ['$import', '$importdefs']) {
      if (Object.prototype.hasOwnProperty.call(namespace, key)) locations.push({ key, pointer: pointer + '/' + key });
    }
  };
  const visitNamespace = (namespace, pointer) => {
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

function assertEffectiveImports(document, targetFormat) {
  const importLocation = activeImportLocations(document)[0];
  if (importLocation) throw new Error(targetFormat + ' export requires effective imports; resolve ' + importLocation.key + ' before conversion (at ' + importLocation.pointer + ').');
}

function escapePointer(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function childPointer(pointer, value) {
  return `${pointer}/${escapePointer(value)}`;
}

function warning(warnings, code, message, lossiness, sourceLocation, targetPath) {
  warnings.push({ code, message, lossiness, ...(sourceLocation ? { sourceLocation } : {}), ...(targetPath ? { targetPath } : {}) });
}

function generatedJsonStructureCapabilities(document) {
  let validation = false;
  let composition = false;
  const visitSchema = (schema) => {
    if (!isRecord(schema)) return;
    for (const key of Object.keys(schema)) {
      if (VALIDATION_KEYWORDS.has(key)) validation = true;
      if (COMPOSITION_KEYWORDS.has(key)) composition = true;
    }
    if (isRecord(schema.properties)) Object.values(schema.properties).forEach(visitSchema);
    if (isRecord(schema.choices)) Object.values(schema.choices).forEach(visitSchema);
    for (const key of ['items', 'values', 'additionalProperties', 'contains', 'propertyNames', 'keyNames', 'has', 'not', 'if', 'then', 'else']) visitSchema(schema[key]);
    for (const key of ['patternProperties', 'patternKeys']) if (isRecord(schema[key])) Object.values(schema[key]).forEach(visitSchema);
    for (const key of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(schema[key])) schema[key].forEach(visitSchema);
    if (Array.isArray(schema.type)) schema.type.forEach(visitSchema);
  };
  const visitDefinitions = (definitions) => {
    if (!isRecord(definitions)) return;
    for (const member of Object.values(definitions)) {
      if (!isRecord(member)) continue;
      if (Object.prototype.hasOwnProperty.call(member, 'type') || Object.prototype.hasOwnProperty.call(member, '$ref') || [...COMPOSITION_KEYWORDS].some((key) => Object.prototype.hasOwnProperty.call(member, key))) visitSchema(member);
      else visitDefinitions(member);
    }
  };
  if (Object.prototype.hasOwnProperty.call(document, 'type')) visitSchema(document);
  visitDefinitions(document.definitions);
  if (validation) return { schema: VALIDATION_SCHEMA_URI };
  if (composition) return { schema: EXTENDED_SCHEMA_URI, uses: ['JSONStructureConditionalComposition'] };
  return { schema: CORE_SCHEMA_URI };
}

function applyGeneratedJsonStructureCapabilities(document) {
  const capabilities = generatedJsonStructureCapabilities(document);
  document.$schema = capabilities.schema;
  if (capabilities.uses) document.$uses = capabilities.uses;
  else delete document.$uses;
}

function normalizedIdentifier(value, fallback) {
  const input = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  let normalized = input.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(normalized)) normalized = `_${normalized}`;
  return normalized || fallback;
}

function normalizeName(value, fallback, warnings, sourceLocation) {
  const input = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const normalized = normalizedIdentifier(input, fallback);
  if (normalized !== input) warning(warnings, 'jsonschema.name.normalized', `Name ${JSON.stringify(input)} was normalized to ${normalized}.`, 'metadata', sourceLocation, '/name');
  return normalized;
}

function generatedId(sourceId, sourceName, warnings) {
  if (typeof sourceId === 'string') {
    try {
      const parsed = new URL(sourceId);
      if (parsed.protocol) return sourceId;
    } catch {
      warning(warnings, 'source.id.invalid', `Source identifier ${JSON.stringify(sourceId)} is not an absolute URI and was replaced.`, 'metadata', '/$id', '/$id');
    }
  }
  return `urn:json-structure:converted:${encodeURIComponent(sourceName || 'source.json')}`;
}

function structureReference(reference, rootName, definitionNames) {
  if (reference === '#') return `#/definitions/${escapePointer(rootName)}`;
  const definitionReference = reference.match(/^#\/(\$defs|definitions)\/(.+)$/);
  if (definitionReference) {
    const keyword = definitionReference[1];
    const segments = definitionReference[2].split('/').map(decodePointerToken);
    for (let count = segments.length; count > 0; count--) {
      const sourcePointer = `#/${keyword}/${segments.slice(0, count).map(escapePointer).join('/')}`;
      const targetName = definitionNames.get(sourcePointer);
      if (targetName) {
        const suffix = segments.slice(count).map(escapePointer).join('/');
        return `#/definitions/${escapePointer(targetName)}${suffix ? `/${suffix}` : ''}`;
      }
    }
  }
  if (reference.startsWith('#/')) return `#/definitions/${escapePointer(rootName)}${reference.slice(1)}`;
  return undefined;
}

function preserveOrWarnUnknown(source, consumed, output, sourcePointer, targetPointer, warnings, preserveUnknownKeywords) {
  for (const key of Object.keys(source)) {
    if (consumed.has(key)) continue;
    const annotation = `x-json-schema-${key}`;
    if (preserveUnknownKeywords) {
      defineOwn(output, annotation, source[key]);
      warning(warnings, 'jsonschema.keyword.preserved', `JSON Schema keyword ${key} was preserved as ${annotation}; its semantics are not enforced by JSON Structure.`, 'metadata', childPointer(sourcePointer, key), childPointer(targetPointer, annotation));
    } else {
      warning(warnings, 'jsonschema.keyword.omitted', `JSON Schema keyword ${key} is not represented in JSON Structure output.`, 'metadata', childPointer(sourcePointer, key), targetPointer);
    }
  }
}

function jsonSchemaPropertyNames(schema, sourcePointer, targetPointer, warnings) {
  const names = [];
  if (isRecord(schema.properties)) names.push(...Object.keys(schema.properties));
  if (Array.isArray(schema.required)) {
    for (const name of schema.required) if (typeof name === 'string' && !names.includes(name)) names.push(name);
  }
  const mapped = new Map();
  const reserved = new Set();
  for (const sourceName of names) {
    const base = normalizedIdentifier(sourceName, 'property');
    let targetName = base;
    let suffix = 2;
    while (reserved.has(targetName)) targetName = `${base}_${suffix++}`;
    const sourceLocation = childPointer(childPointer(sourcePointer, 'properties'), sourceName);
    const targetLocation = childPointer(childPointer(targetPointer, 'properties'), targetName);
    if (base !== sourceName) warning(warnings, 'jsonschema.property.normalized', `Property ${JSON.stringify(sourceName)} was renamed to ${base} to satisfy JSON Structure identifier rules.`, 'data-loss', sourceLocation, targetLocation);
    if (targetName !== base) warning(warnings, 'jsonschema.property.collision', `Property ${JSON.stringify(sourceName)} collided after normalization and was renamed to ${targetName}.`, 'data-loss', sourceLocation, targetLocation);
    reserved.add(targetName);
    mapped.set(sourceName, targetName);
  }
  return mapped;
}

const jsonSchemaTypes = new Set(['null', 'boolean', 'object', 'array', 'number', 'string', 'integer']);
const jsonSchemaNativeFormats = new Map([
  ['date', 'date'],
  ['date-time', 'datetime'],
  ['time', 'time'],
  ['duration', 'duration'],
  ['uuid', 'uuid'],
  ['uri', 'uri'],
  ['uri-reference', 'uri'],
  ['json-pointer', 'jsonpointer'],
]);
const binaryEncodings = new Set(['base64', 'base64url', 'base16', 'base32', 'base32hex']);

function convertJsonSchemaNode(schema, sourcePointer, targetPointer, rootName, definitionNames, warnings, preserveUnknownKeywords) {
  if (typeof schema === 'boolean') {
    warning(warnings, 'jsonschema.boolean.coerced', `Boolean schema ${schema} was approximated because JSON Structure has no equivalent boolean-schema form.`, 'unsupported-feature', sourcePointer, targetPointer);
    return schema ? { type: 'any' } : { type: 'any', not: { type: 'any' } };
  }
  if (!isRecord(schema)) {
    warning(warnings, 'jsonschema.schema.invalid', 'A non-object JSON Schema node was omitted.', 'data-loss', sourcePointer, targetPointer);
    return { type: 'any' };
  }
  const output = {};
  const consumed = new Set();
  if (sourcePointer === '') {
    for (const keyword of ['$schema', '$id']) if (Object.prototype.hasOwnProperty.call(schema, keyword)) consumed.add(keyword);
  }
  for (const keyword of ['$defs', 'definitions']) if (isRecord(schema[keyword])) consumed.add(keyword);
  if (typeof schema.$ref === 'string') {
    const reference = structureReference(schema.$ref, rootName, definitionNames);
    if (reference) output.type = { $ref: reference };
    else {
      output.type = 'any';
      if (preserveUnknownKeywords) output['x-json-schema-$ref'] = schema.$ref;
      warning(warnings, 'jsonschema.reference.unsupported', `Reference ${JSON.stringify(schema.$ref)} is not a local JSON Pointer and was replaced with any${preserveUnknownKeywords ? ' while preserving its source value as x-json-schema-$ref' : ''}.`, 'data-loss', childPointer(sourcePointer, '$ref'), targetPointer);
    }
    consumed.add('$ref');
  }
  if (typeof schema.type === 'string') {
    consumed.add('type');
    if (jsonSchemaTypes.has(schema.type)) output.type = schema.type;
    else {
      output.type = 'any';
      warning(warnings, 'jsonschema.type.coerced', `Unknown JSON Schema type ${JSON.stringify(schema.type)} was replaced with any.`, 'data-loss', childPointer(sourcePointer, 'type'), childPointer(targetPointer, 'type'));
    }
  } else if (Array.isArray(schema.type)) {
    consumed.add('type');
    const validTypes = [...new Set(schema.type.filter((type) => typeof type === 'string' && jsonSchemaTypes.has(type)))];
    output.type = validTypes.length === 0 ? 'any' : validTypes;
    if (validTypes.length !== schema.type.length) warning(warnings, 'jsonschema.type.invalid', 'Invalid or duplicate JSON Schema union members were omitted.', 'data-loss', childPointer(sourcePointer, 'type'), childPointer(targetPointer, 'type'));
  }
  if (schema.type === 'integer' || Array.isArray(schema.type) && schema.type.includes('integer')) {
    warning(warnings, 'jsonschema.integer.narrowed', 'JSON Schema integer has no fixed range and was narrowed to JSON Structure integer (int32).', 'precision', childPointer(sourcePointer, 'type'), childPointer(targetPointer, 'type'));
  }
  if (output.type === 'string' && typeof schema.format === 'string' && jsonSchemaNativeFormats.has(schema.format)) {
    output.type = jsonSchemaNativeFormats.get(schema.format);
    consumed.add('format');
  }
  if (Array.isArray(output.type) && output.type.includes('string') && typeof schema.format === 'string' && jsonSchemaNativeFormats.has(schema.format)) {
    output.type = output.type.map((type) => type === 'string' ? jsonSchemaNativeFormats.get(schema.format) : type);
    consumed.add('format');
  }
  if (output.type === 'string' && typeof schema.contentEncoding === 'string' && binaryEncodings.has(schema.contentEncoding)) {
    output.type = 'binary';
    output.contentEncoding = schema.contentEncoding;
    consumed.add('contentEncoding');
    if (typeof schema.contentMediaType === 'string') {
      output.contentMediaType = schema.contentMediaType;
      consumed.add('contentMediaType');
    }
  }
  if (Array.isArray(output.type) && output.type.includes('string') && typeof schema.contentEncoding === 'string' && binaryEncodings.has(schema.contentEncoding)) {
    output.anyOf = output.type.map((type) => type === 'string'
      ? { type: 'binary', contentEncoding: schema.contentEncoding, ...(typeof schema.contentMediaType === 'string' ? { contentMediaType: schema.contentMediaType } : {}) }
      : { type });
    delete output.type;
    consumed.add('contentEncoding');
    if (typeof schema.contentMediaType === 'string') consumed.add('contentMediaType');
  }
  if (!Object.prototype.hasOwnProperty.call(output, 'type')) {
    if (isRecord(schema.properties) || Array.isArray(schema.required) || Object.prototype.hasOwnProperty.call(schema, 'additionalProperties')) {
      output.type = 'object';
      warning(warnings, 'jsonschema.type.inferred', 'Object type was inferred from object-only keywords; non-object JSON instances accepted by the source are no longer accepted.', 'data-loss', sourcePointer, targetPointer);
    } else if (Object.prototype.hasOwnProperty.call(schema, 'items') || Array.isArray(schema.prefixItems)) {
      output.type = 'array';
      warning(warnings, 'jsonschema.type.inferred', 'Array type was inferred from array-only keywords; non-array JSON instances accepted by the source are no longer accepted.', 'data-loss', sourcePointer, targetPointer);
    } else output.type = 'any';
  }

  const propertyNames = jsonSchemaPropertyNames(schema, sourcePointer, targetPointer, warnings);
  if (isRecord(schema.properties)) {
    consumed.add('properties');
    output.properties = Object.fromEntries(Object.entries(schema.properties).map(([name, member]) => [
      propertyNames.get(name),
      convertJsonSchemaNode(member, childPointer(childPointer(sourcePointer, 'properties'), name), childPointer(childPointer(targetPointer, 'properties'), propertyNames.get(name)), rootName, definitionNames, warnings, preserveUnknownKeywords),
    ]));
  }
  if (Array.isArray(schema.required)) {
    consumed.add('required');
    const required = [...new Set(schema.required.filter((name) => typeof name === 'string').map((name) => propertyNames.get(name)))];
    output.required = required;
    if (required.length !== schema.required.length) warning(warnings, 'jsonschema.required.invalid', 'Invalid or duplicate required entries were omitted.', 'data-loss', childPointer(sourcePointer, 'required'), childPointer(targetPointer, 'required'));
    if (!isRecord(output.properties)) output.properties = {};
    for (const sourceName of schema.required) {
      if (typeof sourceName !== 'string' || Object.prototype.hasOwnProperty.call(output.properties, propertyNames.get(sourceName))) continue;
      const targetName = propertyNames.get(sourceName);
      defineOwn(output.properties, targetName, { type: 'any' });
      warning(warnings, 'jsonschema.required.synthesized', `Required property ${JSON.stringify(sourceName)} had no property schema and was represented with type any.`, 'metadata', childPointer(sourcePointer, 'required'), childPointer(childPointer(targetPointer, 'properties'), targetName));
    }
  }
  if (output.type === 'object' && (!isRecord(output.properties) || Object.keys(output.properties).length === 0)) {
    if (schema.additionalProperties === false) throw new Error(`Closed empty JSON Schema object at ${sourcePointer || '/'} has no conforming JSON Structure Core representation.`);
    const additional = isRecord(schema.additionalProperties)
      ? convertJsonSchemaNode(schema.additionalProperties, childPointer(sourcePointer, 'additionalProperties'), childPointer(targetPointer, 'values'), rootName, definitionNames, warnings, preserveUnknownKeywords)
      : { type: 'any' };
    output.type = 'map';
    output.values = additional;
    delete output.properties;
    warning(warnings, 'jsonschema.empty-object.map', 'An open object with no declared properties was represented as a map.', 'metadata', sourcePointer, targetPointer);
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'items')) {
    consumed.add('items');
    if (schema.items === false) {
      output.maxItems = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
      warning(warnings, 'jsonschema.items.closed', 'The closed items constraint was represented as maxItems.', 'metadata', childPointer(sourcePointer, 'items'), childPointer(targetPointer, 'maxItems'));
    } else if (schema.items !== true) {
      output.items = convertJsonSchemaNode(schema.items, childPointer(sourcePointer, 'items'), childPointer(targetPointer, 'items'), rootName, definitionNames, warnings, preserveUnknownKeywords);
    }
  }
  if (Array.isArray(schema.prefixItems)) {
    consumed.add('prefixItems');
    const tupleNames = schema.prefixItems.map((_, index) => `item${index}`);
    output.type = 'tuple';
    output.tuple = tupleNames;
    output.properties = Object.fromEntries(schema.prefixItems.map((member, index) => [
      tupleNames[index],
      convertJsonSchemaNode(member, childPointer(childPointer(sourcePointer, 'prefixItems'), index), childPointer(childPointer(targetPointer, 'properties'), tupleNames[index]), rootName, definitionNames, warnings, preserveUnknownKeywords),
    ]));
    warning(warnings, 'jsonschema.prefixItems.named', 'Tuple positions were assigned generated JSON Structure property names.', 'metadata', childPointer(sourcePointer, 'prefixItems'), childPointer(targetPointer, 'tuple'));
  }
  if (output.type === 'array' && !Object.prototype.hasOwnProperty.call(output, 'items')) output.items = { type: 'any' };
  for (const keyword of ['additionalProperties']) {
    if (!Object.prototype.hasOwnProperty.call(schema, keyword)) continue;
    consumed.add(keyword);
    output[keyword] = typeof schema[keyword] === 'boolean'
      ? schema[keyword]
      : convertJsonSchemaNode(schema[keyword], childPointer(sourcePointer, keyword), childPointer(targetPointer, keyword), rootName, definitionNames, warnings, preserveUnknownKeywords);
  }
  for (const keyword of ['patternProperties']) {
    if (!isRecord(schema[keyword])) continue;
    consumed.add(keyword);
    output[keyword] = Object.fromEntries(Object.entries(schema[keyword]).map(([name, member]) => [
      name,
      convertJsonSchemaNode(member, childPointer(childPointer(sourcePointer, keyword), name), childPointer(childPointer(targetPointer, keyword), name), rootName, definitionNames, warnings, preserveUnknownKeywords),
    ]));
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    if (!Array.isArray(schema[keyword])) continue;
    consumed.add(keyword);
    output[keyword] = schema[keyword].map((branch, index) => convertJsonSchemaNode(branch, childPointer(childPointer(sourcePointer, keyword), index), childPointer(childPointer(targetPointer, keyword), index), rootName, definitionNames, warnings, preserveUnknownKeywords));
  }
  for (const keyword of ['not', 'if', 'then', 'else', 'contains', 'propertyNames']) {
    if (!Object.prototype.hasOwnProperty.call(schema, keyword)) continue;
    consumed.add(keyword);
    output[keyword] = convertJsonSchemaNode(schema[keyword], childPointer(sourcePointer, keyword), childPointer(targetPointer, keyword), rootName, definitionNames, warnings, preserveUnknownKeywords);
  }
  for (const keyword of ['description', 'examples', 'enum', 'const', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'minContains', 'maxContains', 'minProperties', 'maxProperties', 'dependentRequired']) {
    if (!consumed.has(keyword) && Object.prototype.hasOwnProperty.call(schema, keyword)) {
      output[keyword] = schema[keyword];
      consumed.add(keyword);
    }
  }
  preserveOrWarnUnknown(schema, consumed, output, sourcePointer, targetPointer, warnings, preserveUnknownKeywords);
  return output;
}

function convertJsonSchemaDefinitions(value, sourcePointer, parentTargetName, rootName, definitionNames, warnings, preserveUnknownKeywords, output) {
  if (!isRecord(value)) return;
  for (const [name, schema] of Object.entries(value)) {
    const memberPointer = `${sourcePointer}/${escapePointer(name)}`;
    const targetName = definitionNames.get(memberPointer);
    const namespaceName = targetName || (parentTargetName ? `${parentTargetName}_${normalizedIdentifier(name, 'Definition')}` : normalizedIdentifier(name, 'Definition'));
    if (!isJsonSchemaNode(schema)) {
      if (isRecord(schema)) convertJsonSchemaDefinitions(schema, memberPointer, namespaceName, rootName, definitionNames, warnings, preserveUnknownKeywords, output);
      continue;
    }
    if (!targetName) continue;
    defineOwn(output, targetName, convertJsonSchemaNode(schema, memberPointer.slice(1), `/definitions/${escapePointer(targetName)}`, rootName, definitionNames, warnings, preserveUnknownKeywords));
    if (!isRecord(schema)) continue;
    for (const keyword of ['definitions', '$defs']) {
      if (isRecord(schema[keyword])) convertJsonSchemaDefinitions(schema[keyword], `${memberPointer}/${keyword}`, targetName, rootName, definitionNames, warnings, preserveUnknownKeywords, output);
    }
  }
}

function jsonSchemaDefinitionNames(doc, rootName, warnings) {
  const names = new Map();
  const reserved = new Set([rootName]);
  const visit = (value, sourcePointer, parentTargetName) => {
    if (!isRecord(value)) return;
    for (const [sourceName, schema] of Object.entries(value)) {
      const memberPointer = `${sourcePointer}/${escapePointer(sourceName)}`;
      const sourceLocation = memberPointer.slice(1);
      const baseName = normalizeName(sourceName, 'Definition', warnings, sourceLocation);
      const base = parentTargetName ? `${parentTargetName}_${baseName}` : baseName;
      if (!isJsonSchemaNode(schema)) {
        if (isRecord(schema)) visit(schema, memberPointer, base);
        continue;
      }
      let targetName = base;
      let suffix = 2;
      while (reserved.has(targetName)) targetName = `${base}_${suffix++}`;
      if (targetName !== base) warning(warnings, 'jsonschema.name.collision', `Definition name ${base} was already reserved and was changed to ${targetName}.`, 'metadata', sourceLocation, `/definitions/${escapePointer(targetName)}`);
      reserved.add(targetName);
      names.set(memberPointer, targetName);
      if (isRecord(schema)) for (const keyword of ['definitions', '$defs']) {
        if (isRecord(schema[keyword])) visit(schema[keyword], `${memberPointer}/${keyword}`, targetName);
      }
    }
  };
  if (isRecord(doc)) for (const keyword of ['definitions', '$defs']) visit(doc[keyword], `#/${keyword}`, '');
  return names;
}

function convertJsonSchemaToJsonStructure(sourceText, sourceName, options, preview) {
  const doc = JSON.parse(sourceText);
  const warnings = [];
  if (!isRecord(doc) && typeof doc !== 'boolean') throw new Error('JSON Schema source must be an object or boolean schema.');
  const requestedName = typeof options.rootName === 'string' && options.rootName.trim() ? options.rootName : 'Root';
  const rootName = normalizeName(requestedName, 'Root', warnings, '/name');
  const definitionNames = isRecord(doc) ? jsonSchemaDefinitionNames(doc, rootName, warnings) : new Map();
  const preserveUnknownKeywords = options.preserveUnknownKeywords === true;
  const targetRoot = `/definitions/${escapePointer(rootName)}`;
  const root = convertJsonSchemaNode(doc, '', targetRoot, rootName, definitionNames, warnings, preserveUnknownKeywords);
  const definitions = {};
  if (isRecord(doc)) for (const keyword of ['definitions', '$defs']) {
    if (isRecord(doc[keyword])) convertJsonSchemaDefinitions(doc[keyword], `#/${keyword}`, '', rootName, definitionNames, warnings, preserveUnknownKeywords, definitions);
  }
  if (isRecord(doc)) {
    delete root.$id;
    delete root.$schema;
    delete root.$defs;
    delete root.definitions;
  }
  defineOwn(definitions, rootName, root);
  const output = {
    $schema: CORE_SCHEMA_URI,
    $id: generatedId(isRecord(doc) ? doc.$id : undefined, sourceName, warnings),
    name: rootName,
    $root: `#/definitions/${escapePointer(rootName)}`,
    definitions,
  };
  applyGeneratedJsonStructureCapabilities(output);
  validateGeneratedJsonStructure(output);
  const files = {};
  if (preview) {
    files['preview.json'] = Buffer.from(JSON.stringify(output, null, 2) + '\n').toString('base64');
  } else {
    files[`${rootName}.struct.json`] = Buffer.from(JSON.stringify(output, null, 2) + '\n').toString('base64');
  }
  return {
    lossiness: aggregateLossiness(warnings),
    warnings,
    files,
  };
}

function jsonSchemaReference(reference) {
  return reference.startsWith('#/definitions/') ? `#/$defs/${reference.slice('#/definitions/'.length)}` : reference;
}

function convertDefinitionTree(value, sourcePointer, targetPointer, warnings) {
  const converted = {};
  for (const [name, member] of Object.entries(value)) {
    const source = childPointer(sourcePointer, name);
    const target = childPointer(targetPointer, name);
    if (!isRecord(member)) {
      warning(warnings, 'json-structure.definition.invalid', `Definition ${name} is not an object and was omitted.`, 'data-loss', source, target);
      continue;
    }
    defineOwn(converted, name, Object.prototype.hasOwnProperty.call(member, 'type') || Object.prototype.hasOwnProperty.call(member, '$ref')
      ? convertJsonStructureSchema(member, source, target, warnings)
      : convertDefinitionTree(member, source, target, warnings));
  }
  return converted;
}

function convertJsonStructureSchema(schema, sourcePointer, targetPointer, warnings) {
  if (!isRecord(schema)) {
    warning(warnings, 'json-structure.schema.invalid', 'A non-object schema was omitted.', 'data-loss', sourcePointer, targetPointer);
    return {};
  }
  const output = {};
  const consumed = new Set();
  if (sourcePointer === '') {
    for (const keyword of ['$schema', '$id', 'definitions']) if (Object.prototype.hasOwnProperty.call(schema, keyword)) consumed.add(keyword);
    if (typeof schema.name === 'string') {
      output.title = schema.name;
      consumed.add('name');
    }
  }
  if (typeof schema.$ref === 'string') {
    output.$ref = jsonSchemaReference(schema.$ref);
    consumed.add('$ref');
  }
  const type = schema.type;
  if (isRecord(type) && typeof type.$ref === 'string') {
    output.$ref = jsonSchemaReference(type.$ref);
    consumed.add('type');
  } else if (Array.isArray(type)) {
    output.anyOf = type.map((member, index) => convertJsonStructureSchema(isRecord(member) ? member : { type: member }, childPointer(childPointer(sourcePointer, 'type'), index), childPointer(childPointer(targetPointer, 'anyOf'), index), warnings));
    consumed.add('type');
    warning(warnings, 'json-structure.union.order', 'Ordered first-match union semantics are approximated with JSON Schema anyOf.', 'unsupported-feature', childPointer(sourcePointer, 'type'), childPointer(targetPointer, 'anyOf'));
  } else if (typeof type === 'string') {
    consumed.add('type');
    if (['string', 'number', 'integer', 'boolean', 'null', 'object', 'array'].includes(type)) output.type = type;
    else if (type === 'any') {
      // An absent JSON Schema type permits any JSON value.
    } else if (type === 'set') {
      output.type = 'array';
      output.uniqueItems = true;
    } else if (type === 'map') {
      output.type = 'object';
    } else if (type === 'tuple') {
      output.type = 'array';
    } else if (type === 'choice') {
      const choices = isRecord(schema.choices) ? schema.choices : {};
      output.oneOf = Object.entries(choices).map(([name, branch], index) => isRecord(branch)
        ? convertJsonStructureSchema(branch, childPointer(childPointer(sourcePointer, 'choices'), name), childPointer(childPointer(targetPointer, 'oneOf'), index), warnings)
        : {});
      consumed.add('choices');
      consumed.add('selector');
      warning(warnings, 'json-structure.choice.approximated', 'Choice wire semantics are approximated with JSON Schema oneOf.', 'unsupported-feature', sourcePointer, targetPointer);
    } else if (['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32'].includes(type)) {
      output.type = 'integer';
      const ranges = { int8: [-128, 127], uint8: [0, 255], int16: [-32768, 32767], uint16: [0, 65535], int32: [-2147483648, 2147483647], uint32: [0, 4294967295] };
      [output.minimum, output.maximum] = ranges[type];
    } else if (['float8', 'float', 'double'].includes(type)) {
      output.type = 'number';
      warning(warnings, 'json-structure.numeric.precision', `${type} precision is not represented by JSON Schema type alone.`, 'precision', childPointer(sourcePointer, 'type'), childPointer(targetPointer, 'type'));
    } else if (['int64', 'uint64', 'int128', 'uint128', 'decimal'].includes(type)) {
      output.type = 'string';
      warning(warnings, 'json-structure.numeric.lexical', `${type} lexical and range semantics are retained only as a string representation.`, 'precision', childPointer(sourcePointer, 'type'), childPointer(targetPointer, 'type'));
    } else if (['date', 'datetime', 'time', 'duration', 'uuid', 'uri'].includes(type)) {
      output.type = 'string';
      output.format = type === 'datetime' ? 'date-time' : type === 'uri' ? 'uri-reference' : type;
    } else if (type === 'binary') {
      output.type = 'string';
      output.contentEncoding = typeof schema.contentEncoding === 'string' ? schema.contentEncoding : 'base64';
      consumed.add('contentEncoding');
      if (typeof schema.contentMediaType === 'string') { output.contentMediaType = schema.contentMediaType; consumed.add('contentMediaType'); }
    } else if (type === 'jsonpointer') {
      output.type = 'string';
      output.pattern = '^(?:/(?:[^~/]|~[01])*)*$';
    } else {
      output.type = 'string';
      warning(warnings, 'json-structure.type.unsupported', `Type ${type} was coerced to string.`, 'unsupported-feature', childPointer(sourcePointer, 'type'), childPointer(targetPointer, 'type'));
    }
  } else if (!output.$ref) {
    warning(warnings, 'json-structure.type.unspecified', 'Schema has no supported type and was exported without a JSON Schema type.', 'unsupported-feature', childPointer(sourcePointer, 'type'), targetPointer);
  }

  if (isRecord(schema.properties) && (type === 'object' || type === 'tuple')) {
    consumed.add('properties');
    if (type === 'tuple' && Array.isArray(schema.tuple)) {
      consumed.add('tuple');
      output.prefixItems = schema.tuple.map((name, index) => typeof name === 'string' && isRecord(schema.properties[name])
        ? convertJsonStructureSchema(schema.properties[name], childPointer(childPointer(sourcePointer, 'properties'), name), childPointer(childPointer(targetPointer, 'prefixItems'), index), warnings)
        : {});
      output.items = false;
    } else {
      output.properties = Object.fromEntries(Object.entries(schema.properties).filter(([, member]) => isRecord(member)).map(([name, member]) => [name, convertJsonStructureSchema(member, childPointer(childPointer(sourcePointer, 'properties'), name), childPointer(childPointer(targetPointer, 'properties'), name), warnings)]));
    }
  }
  if ((type === 'array' || type === 'set') && isRecord(schema.items)) {
    consumed.add('items');
    output.items = convertJsonStructureSchema(schema.items, childPointer(sourcePointer, 'items'), childPointer(targetPointer, 'items'), warnings);
  }
  if (type === 'map' && isRecord(schema.values)) {
    consumed.add('values');
    output.additionalProperties = convertJsonStructureSchema(schema.values, childPointer(sourcePointer, 'values'), childPointer(targetPointer, 'additionalProperties'), warnings);
  }
  if (Array.isArray(schema.required)) {
    consumed.add('required');
    if (schema.required.every((name) => typeof name === 'string')) output.required = schema.required;
    else {
      output.oneOf = schema.required.filter(Array.isArray).map((names) => ({ required: names }));
      warning(warnings, 'json-structure.required.alternatives', 'Alternative required sets are approximated with JSON Schema oneOf.', 'metadata', childPointer(sourcePointer, 'required'), childPointer(targetPointer, 'oneOf'));
    }
  }
  const stringBackedNumber = ['int64', 'uint64', 'int128', 'uint128', 'decimal'].includes(type);
  if (stringBackedNumber) {
    const lexicalPatterns = {
      int64: '^-?(?:0|[1-9][0-9]*)$',
      uint64: '^(?:0|[1-9][0-9]*)$',
      int128: '^-?(?:0|[1-9][0-9]*)$',
      uint128: '^(?:0|[1-9][0-9]*)$',
      decimal: '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$',
    };
    output.pattern = lexicalPatterns[type];
    for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'precision', 'scale', 'pattern']) {
      if (!Object.prototype.hasOwnProperty.call(schema, keyword)) continue;
      consumed.add(keyword);
      warning(warnings, 'json-structure.numeric.constraint.omitted', `${keyword} on string-backed ${type} cannot be emitted as a JSON Schema numeric keyword and was omitted.`, 'precision', childPointer(sourcePointer, keyword), targetPointer);
    }
  }
  for (const keyword of ['description', 'enum', 'const', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties']) {
    if (stringBackedNumber && ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'pattern'].includes(keyword)) continue;
    if (Object.prototype.hasOwnProperty.call(schema, keyword)) { output[keyword] = schema[keyword]; consumed.add(keyword); }
  }
  if (typeof schema.additionalProperties === 'boolean' || isRecord(schema.additionalProperties)) {
    consumed.add('additionalProperties');
    output.additionalProperties = isRecord(schema.additionalProperties)
      ? convertJsonStructureSchema(schema.additionalProperties, childPointer(sourcePointer, 'additionalProperties'), childPointer(targetPointer, 'additionalProperties'), warnings)
      : schema.additionalProperties;
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(schema[keyword])) {
    consumed.add(keyword);
    output[keyword] = schema[keyword].map((branch, index) => convertJsonStructureSchema(branch, childPointer(childPointer(sourcePointer, keyword), index), childPointer(childPointer(targetPointer, keyword), index), warnings));
  }
  for (const keyword of ['not', 'if', 'then', 'else', 'contains', 'propertyNames']) if (isRecord(schema[keyword])) {
    consumed.add(keyword);
    output[keyword] = convertJsonStructureSchema(schema[keyword], childPointer(sourcePointer, keyword), childPointer(targetPointer, keyword), warnings);
  }
  if (typeof schema.$extends === 'string' || Array.isArray(schema.$extends)) {
    consumed.add('$extends');
    const bases = typeof schema.$extends === 'string' ? [schema.$extends] : schema.$extends.filter((base) => typeof base === 'string');
    output.allOf = [...(output.allOf || []), ...bases.map((base) => ({ $ref: jsonSchemaReference(base) }))];
    warning(warnings, 'json-structure.extends.approximated', 'Inheritance merge semantics are approximated with JSON Schema allOf.', 'metadata', childPointer(sourcePointer, '$extends'), childPointer(targetPointer, 'allOf'));
  }
  for (const key of Object.keys(schema)) if (!consumed.has(key)) {
    warning(warnings, 'json-structure.keyword.omitted', `Keyword ${key} is not represented in JSON Schema output.`, 'metadata', childPointer(sourcePointer, key), targetPointer);
  }
  return output;
}

function pointerValue(root, pointer) {
  if (!pointer.startsWith('#/')) return undefined;
  return pointer.slice(2).split('/').map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((value, token) => isRecord(value) && hasOwn(value, token) ? value[token] : undefined, root);
}

function validateGeneratedJsonStructure(document) {
  if (!isRecord(document) || ![CORE_SCHEMA_URI, EXTENDED_SCHEMA_URI, VALIDATION_SCHEMA_URI].includes(document.$schema)) throw new Error('Generated JSON Structure document has a non-canonical schema URI.');
  try {
    const identifier = new URL(document.$id);
    if (!identifier.protocol) throw new Error();
  } catch {
    throw new Error('Generated JSON Structure document requires an absolute $id URI.');
  }
  if (typeof document.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(document.name)) throw new Error('Generated JSON Structure document requires a valid name.');
  if (typeof document.$root !== 'string' || !isRecord(pointerValue(document, document.$root))) throw new Error('Generated JSON Structure $root does not resolve.');
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#') && pointerValue(document, value.$ref) === undefined) throw new Error(`Generated JSON Structure reference does not resolve: ${value.$ref}.`);
    for (const child of Object.values(value)) visit(child);
  };
  visit(document);
}

function validateGeneratedJsonSchema(document) {
  if (!isRecord(document) || document.$schema !== JSON_SCHEMA_URI) throw new Error('Generated JSON Schema has an invalid dialect URI.');
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    if (value.type === 'string') {
      for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']) {
        if (Object.prototype.hasOwnProperty.call(value, keyword)) throw new Error(`Generated string schema contains invalid numeric keyword ${keyword}.`);
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(document);
}

function convertJsonStructureToJsonSchema(sourceText, _sourceName, _options, preview) {
  const doc = JSON.parse(sourceText);
  if (!isRecord(doc)) throw new Error('JSON Structure source must be an object.');
  assertEffectiveImports(doc, 'JSON Schema');
  const rootRef = typeof doc.$root === 'string' ? doc.$root : '';
  const root = rootRef ? pointerValue(doc, rootRef) : Object.prototype.hasOwnProperty.call(doc, 'type') ? doc : undefined;
  const warnings = [];
  if (!isRecord(root)) warning(warnings, 'json-structure.root.missing', 'The source document has no resolvable $root or inline root; exported an unconstrained schema.', 'unsupported-feature', '/$root', '');
  const output = { $schema: JSON_SCHEMA_URI, ...convertJsonStructureSchema(isRecord(root) ? root : {}, rootRef ? rootRef.slice(1) : '', '', warnings) };
  if (typeof doc.$id === 'string') output.$id = doc.$id;
  if (isRecord(doc.definitions)) output.$defs = convertDefinitionTree(doc.definitions, '/definitions', '/$defs', warnings);
  for (const key of Object.keys(doc)) if (!['$schema', '$id', 'name', '$root', 'definitions', 'type', 'description', 'properties', 'required', 'items', 'values', 'tuple', 'choices', 'selector', 'enum', 'const', 'additionalProperties'].includes(key) && root !== doc) {
    warning(warnings, 'json-structure.document-keyword.omitted', `Document keyword ${key} is not represented in JSON Schema output.`, 'metadata', childPointer('', key), '');
  }
  validateGeneratedJsonSchema(output);
  const files = {};
  files[preview ? 'preview.schema.json' : 'schema.json'] = Buffer.from(JSON.stringify(output, null, 2) + '\n').toString('base64');
  return {
    lossiness: aggregateLossiness(warnings),
    warnings,
    files,
  };
}

const avroPrimitiveTypes = new Set(['null', 'boolean', 'int', 'long', 'float', 'double', 'bytes', 'string']);

function avroNameParts(name, declaredNamespace, enclosingNamespace) {
  if (typeof name !== 'string' || !name) throw new Error('Avro named type requires a name.');
  const parts = name.split('.');
  const shortName = parts.pop();
  const namespace = parts.length > 0 ? parts.join('.') : (typeof declaredNamespace === 'string' ? declaredNamespace : enclosingNamespace || '');
  const allParts = [...namespace.split('.').filter(Boolean), shortName];
  if (allParts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) throw new Error(`Illegal Avro name: ${name}.`);
  return { shortName, namespace, fullName: namespace ? `${namespace}.${shortName}` : shortName };
}

function definitionPointer(fullName) {
  return `#/definitions/${fullName.split('.').map(escapePointer).join('/')}`;
}

function setNestedDefinition(definitions, fullName, value) {
  const parts = fullName.split('.');
  let current = definitions;
  for (const part of parts.slice(0, -1)) {
    if (!hasOwn(current, part)) defineOwn(current, part, {});
    const child = current[part];
    if (!isRecord(child) || Object.prototype.hasOwnProperty.call(child, 'type')) throw new Error(`Avro namespace collides with a type: ${fullName}.`);
    current = child;
  }
  const name = parts[parts.length - 1];
  if (Object.prototype.hasOwnProperty.call(current, name)) throw new Error(`Duplicate Avro named type: ${fullName}.`);
  defineOwn(current, name, value);
}

function resolveAvroReference(name, namespace, context) {
  const candidates = [];
  if (name.includes('.')) candidates.push(name);
  else {
    if (namespace) candidates.push(`${namespace}.${name}`);
    candidates.push(name);
  }
  const match = candidates.find((candidate) => context.named.has(candidate));
  if (!match) throw new Error(`Unresolved or forward Avro named type: ${name}.`);
  return context.named.get(match);
}

function warnAvroUnknown(source, consumed, sourcePointer, targetPointer, warnings) {
  for (const key of Object.keys(source)) {
    if (consumed.has(key)) continue;
    warning(warnings, 'avro.keyword.omitted', `Avro attribute ${key} is not represented in JSON Structure output.`, 'metadata', childPointer(sourcePointer, key), targetPointer);
  }
}

function applyAvroLogicalType(output, source, sourcePointer, targetPointer, context) {
  if (typeof source.logicalType !== 'string') return;
  const logicalType = source.logicalType;
  const mapped = {
    uuid: 'uuid',
    date: 'date',
    'time-millis': 'time',
    'time-micros': 'time',
    'timestamp-millis': 'datetime',
    'timestamp-micros': 'datetime',
    'local-timestamp-millis': 'datetime',
    'local-timestamp-micros': 'datetime',
    duration: 'duration',
    decimal: 'decimal',
  }[logicalType];
  if (mapped) output.type = mapped;
  else warning(context.warnings, 'avro.logicalType.unsupported', `Avro logical type ${logicalType} has no JSON Structure mapping.`, 'unsupported-feature', childPointer(sourcePointer, 'logicalType'), targetPointer);
  if (logicalType === 'decimal') {
    if (Number.isInteger(source.precision) && source.precision > 0) output.precision = source.precision;
    else warning(context.warnings, 'avro.decimal.precision.omitted', 'Avro decimal precision is invalid or absent.', 'data-loss', childPointer(sourcePointer, 'precision'), targetPointer);
    if (Number.isInteger(source.scale) && source.scale >= 0) output.scale = source.scale;
  }
  if (context.preserveLogicalType) {
    output['x-avro-logicalType'] = logicalType;
    warning(context.warnings, 'avro.logicalType.preserved', `Avro logical type ${logicalType} was preserved as conversion metadata.`, 'metadata', childPointer(sourcePointer, 'logicalType'), childPointer(targetPointer, 'x-avro-logicalType'));
  } else {
    warning(context.warnings, 'avro.logicalType.omitted', `Avro logical type ${logicalType} metadata was omitted after mapping its base semantics.`, 'metadata', childPointer(sourcePointer, 'logicalType'), targetPointer);
  }
}

function avroUnionMember(schema) {
  return isRecord(schema) && Object.keys(schema).length === 1 && Object.prototype.hasOwnProperty.call(schema, 'type') ? schema.type : undefined;
}

function convertAvroSchema(schema, sourcePointer, targetPointer, namespace, context) {
  if (Array.isArray(schema)) {
    if (schema.length === 0) throw new Error(`Avro union at ${sourcePointer || '/'} must not be empty.`);
    const converted = schema.map((branch, index) => convertAvroSchema(branch, childPointer(sourcePointer, index), childPointer(targetPointer, index), namespace, context));
    const members = converted.map(avroUnionMember);
    if (members.every((member) => member !== undefined)) return { type: members };
    warning(context.warnings, 'avro.union.composition', 'An Avro union with constrained branches was represented with anyOf.', 'unsupported-feature', sourcePointer, targetPointer);
    return { anyOf: converted };
  }
  if (typeof schema === 'string') {
    const primitive = { null: 'null', boolean: 'boolean', int: 'int32', long: 'int64', float: 'float', double: 'double', bytes: 'binary', string: 'string' }[schema];
    if (primitive) {
      if (schema === 'long') warning(context.warnings, 'avro.long.lexical', 'Avro long values outside the JSON safe-integer range require JSON Structure int64 lexical strings.', 'precision', sourcePointer, targetPointer);
      return { type: primitive };
    }
    return { type: { $ref: resolveAvroReference(schema, namespace, context) } };
  }
  if (!isRecord(schema)) throw new Error(`Invalid Avro schema at ${sourcePointer || '/'}.`);
  const consumed = new Set(['type']);
  const type = schema.type;

  if (type === 'record') {
    consumed.add('name'); consumed.add('namespace'); consumed.add('fields');
    const parts = avroNameParts(schema.name, schema.namespace, namespace);
    const pointer = definitionPointer(parts.fullName);
    const record = { name: parts.shortName, type: 'object', properties: {} };
    if (typeof schema.doc === 'string') { record.description = schema.doc; consumed.add('doc'); }
    context.named.set(parts.fullName, pointer);
    setNestedDefinition(context.definitions, parts.fullName, record);
    if (!Array.isArray(schema.fields)) throw new Error(`Avro record ${parts.fullName} requires a fields array.`);
    if (schema.fields.length === 0) throw new Error(`Empty Avro record ${parts.fullName} has no conforming JSON Structure Core representation.`);
    const required = [];
    const fieldNames = new Set();
    for (let index = 0; index < schema.fields.length; index++) {
      const field = schema.fields[index];
      const fieldPointer = childPointer(childPointer(sourcePointer, 'fields'), index);
      if (!isRecord(field) || typeof field.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name)) throw new Error(`Invalid Avro field at ${fieldPointer}.`);
      if (fieldNames.has(field.name)) throw new Error(`Duplicate Avro field ${field.name} in ${parts.fullName}.`);
      fieldNames.add(field.name);
      const target = childPointer(childPointer(pointer.slice(1), 'properties'), field.name);
      const property = convertAvroSchema(field.type, childPointer(fieldPointer, 'type'), target, parts.namespace, context);
      if (Object.prototype.hasOwnProperty.call(field, 'default')) property.default = field.default;
      if (typeof field.doc === 'string') property.description = field.doc;
      defineOwn(record.properties, field.name, property);
      const nullableWithDefault = Array.isArray(field.type) && field.type.some((branch) => branch === 'null' || isRecord(branch) && branch.type === 'null') && Object.prototype.hasOwnProperty.call(field, 'default');
      if (!nullableWithDefault) required.push(field.name);
      else warning(context.warnings, 'avro.field.optional.inferred', `Field ${field.name} was inferred as optional from its nullable type and default.`, 'metadata', fieldPointer, target);
      const fieldConsumed = new Set(['name', 'type']);
      if (Object.prototype.hasOwnProperty.call(field, 'default')) fieldConsumed.add('default');
      if (typeof field.doc === 'string') fieldConsumed.add('doc');
      warnAvroUnknown(field, fieldConsumed, fieldPointer, target, context.warnings);
    }
    if (required.length > 0) record.required = required;
    warnAvroUnknown(schema, consumed, sourcePointer, pointer.slice(1), context.warnings);
    return { type: { $ref: pointer } };
  }

  if (type === 'enum') {
    consumed.add('name'); consumed.add('namespace'); consumed.add('symbols');
    const parts = avroNameParts(schema.name, schema.namespace, namespace);
    if (!Array.isArray(schema.symbols) || schema.symbols.length === 0 || !schema.symbols.every((symbol) => typeof symbol === 'string')) throw new Error(`Avro enum ${parts.fullName} requires string symbols.`);
    const declaration = { name: parts.shortName, type: 'string', enum: [...schema.symbols] };
    if (Object.prototype.hasOwnProperty.call(schema, 'default')) { declaration.default = schema.default; consumed.add('default'); }
    if (typeof schema.doc === 'string') { declaration.description = schema.doc; consumed.add('doc'); }
    const pointer = definitionPointer(parts.fullName);
    context.named.set(parts.fullName, pointer);
    setNestedDefinition(context.definitions, parts.fullName, declaration);
    warnAvroUnknown(schema, consumed, sourcePointer, pointer.slice(1), context.warnings);
    return { type: { $ref: pointer } };
  }

  if (type === 'fixed') {
    consumed.add('name'); consumed.add('namespace'); consumed.add('size');
    const parts = avroNameParts(schema.name, schema.namespace, namespace);
    if (!Number.isInteger(schema.size) || schema.size <= 0) throw new Error(`Avro fixed ${parts.fullName} requires a positive size.`);
    const declaration = { name: parts.shortName, type: 'binary' };
    applyAvroLogicalType(declaration, schema, sourcePointer, targetPointer, context);
    if (typeof schema.logicalType === 'string') consumed.add('logicalType');
    if (schema.logicalType === 'decimal' && Object.prototype.hasOwnProperty.call(schema, 'precision')) consumed.add('precision');
    if (schema.logicalType === 'decimal' && Object.prototype.hasOwnProperty.call(schema, 'scale')) consumed.add('scale');
    warning(context.warnings, 'avro.fixed.constraint', `Avro fixed size ${schema.size} is not enforced by JSON Structure binary.`, 'unsupported-feature', childPointer(sourcePointer, 'size'), targetPointer);
    const pointer = definitionPointer(parts.fullName);
    context.named.set(parts.fullName, pointer);
    setNestedDefinition(context.definitions, parts.fullName, declaration);
    warnAvroUnknown(schema, consumed, sourcePointer, pointer.slice(1), context.warnings);
    return { type: { $ref: pointer } };
  }

  if (type === 'array') {
    consumed.add('items');
    const result = { type: 'array', items: convertAvroSchema(schema.items, childPointer(sourcePointer, 'items'), childPointer(targetPointer, 'items'), namespace, context) };
    warnAvroUnknown(schema, consumed, sourcePointer, targetPointer, context.warnings);
    return result;
  }
  if (type === 'map') {
    consumed.add('values');
    const result = { type: 'map', values: convertAvroSchema(schema.values, childPointer(sourcePointer, 'values'), childPointer(targetPointer, 'values'), namespace, context) };
    warnAvroUnknown(schema, consumed, sourcePointer, targetPointer, context.warnings);
    return result;
  }
  if (typeof type === 'string' && avroPrimitiveTypes.has(type)) {
    const result = type === 'long' && typeof schema.logicalType === 'string'
      ? { type: 'int64' }
      : convertAvroSchema(type, sourcePointer, targetPointer, namespace, context);
    applyAvroLogicalType(result, schema, sourcePointer, targetPointer, context);
    if (typeof schema.logicalType === 'string') consumed.add('logicalType');
    if (schema.logicalType === 'decimal' && Object.prototype.hasOwnProperty.call(schema, 'precision')) consumed.add('precision');
    if (schema.logicalType === 'decimal' && Object.prototype.hasOwnProperty.call(schema, 'scale')) consumed.add('scale');
    warnAvroUnknown(schema, consumed, sourcePointer, targetPointer, context.warnings);
    return result;
  }
  if (typeof type === 'string') {
    const result = { type: { $ref: resolveAvroReference(type, namespace, context) } };
    warnAvroUnknown(schema, consumed, sourcePointer, targetPointer, context.warnings);
    return result;
  }
  const result = convertAvroSchema(type, childPointer(sourcePointer, 'type'), targetPointer, namespace, context);
  warnAvroUnknown(schema, consumed, sourcePointer, targetPointer, context.warnings);
  return result;
}

function convertAvroToJsonStructure(sourceText, sourceName, options, preview) {
  const doc = JSON.parse(sourceText);
  const warnings = [];
  const context = { definitions: {}, named: new Map(), warnings, preserveLogicalType: options.preserveLogicalType !== false };
  const rootSchema = convertAvroSchema(doc, '', '/definitions', '', context);
  let rootPointer = isRecord(rootSchema.type) && typeof rootSchema.type.$ref === 'string' ? rootSchema.type.$ref : undefined;
  let rootName;
  if (rootPointer) {
    const tokens = rootPointer.slice('#/definitions/'.length).split('/');
    rootName = tokens[tokens.length - 1].replace(/~1/g, '/').replace(/~0/g, '~');
  } else {
    rootName = normalizeName(typeof options.rootName === 'string' ? options.rootName : 'Root', 'Root', warnings, '/name');
    rootPointer = `#/definitions/${escapePointer(rootName)}`;
    setNestedDefinition(context.definitions, rootName, rootSchema);
  }
  const output = {
    $schema: CORE_SCHEMA_URI,
    $id: generatedId(undefined, sourceName, warnings),
    name: rootName,
    $root: rootPointer,
    definitions: context.definitions,
  };
  applyGeneratedJsonStructureCapabilities(output);
  validateGeneratedJsonStructure(output);
  return {
    lossiness: aggregateLossiness(warnings),
    warnings,
    files: {
      [preview ? 'preview.json' : `${rootName}.struct.json`]: Buffer.from(JSON.stringify(output, null, 2) + '\n').toString('base64'),
    },
  };
}

function decodePointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function isSchemaDeclaration(value) {
  return isRecord(value) && (Object.prototype.hasOwnProperty.call(value, 'type') || Object.prototype.hasOwnProperty.call(value, '$ref'));
}

function avroLegalName(value, context) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`${context} must be a legal Avro name.`);
  return value;
}
function schemaPointer(pointer) {
  if (!pointer || pointer === '/') return '#';
  return pointer.startsWith('#') ? pointer : `#${pointer}`;
}
function avroAlternateName(schema, fallback, sourcePointer) {
  const alternate = isRecord(schema.altnames) ? schema.altnames.avro : undefined;
  if (alternate === undefined) return avroLegalName(fallback, sourcePointer);
  const pointer = `${schemaPointer(sourcePointer)}/altnames/avro`;
  if (typeof alternate !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alternate)) throw new Error(`'${String(alternate)}' is not a legal Avro name (at ${pointer})`);
  return alternate;
}
function avroEnumSymbols(schema, sourcePointer) {
  if (!Array.isArray(schema.enum)) return undefined;
  const alternates = isRecord(schema.altenums) && isRecord(schema.altenums.avro) ? schema.altenums.avro : {};
  const symbols = schema.enum.map((value) => typeof value === 'string' && alternates[value] !== undefined ? alternates[value] : value);
  return symbols.every((symbol) => typeof symbol === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol))
    ? symbols
    : undefined;
}

function registerJsonStructureDefinitions(value, pointer, path, context) {
  if (!isRecord(value)) throw new Error(`Definitions namespace ${pointer} must be an object.`);
  for (const [name, member] of Object.entries(value)) {
    const memberPointer = `${pointer}/${escapePointer(name)}`;
    if (isSchemaDeclaration(member)) {
      const avroName = avroAlternateName(member, name, memberPointer);
      const namespace = path.join('.');
      const fullName = namespace ? `${namespace}.${avroName}` : avroName;
      if (context.fullNames.has(fullName)) throw new Error(`two declared types both map to the Avro fullname \`${fullName}\` (at #${memberPointer})`);
      const descriptor = { pointer: `#${memberPointer}`, schema: member, name: avroName, namespace, fullName };
      context.registry.set(descriptor.pointer, descriptor);
      context.fullNames.add(fullName);
    } else {
      avroLegalName(name, `Namespace ${memberPointer}`);
      registerJsonStructureDefinitions(member, memberPointer, [...path, name], context);
    }
  }
}

function referenceFromSchema(schema) {
  if (typeof schema.$ref === 'string') return schema.$ref;
  return isRecord(schema.type) && typeof schema.type.$ref === 'string' ? schema.type.$ref : undefined;
}

function resolveStructureDescriptor(reference, context, fromPointer = '') {
  if (!reference.startsWith('#/')) throw new Error(`Avro export requires consolidated local references; unresolved external reference ${reference}.`);
  const descriptor = context.registry.get(reference);
  if (!descriptor) throw new Error(`cannot resolve '${reference}' (at ${schemaPointer(fromPointer)})`);
  return descriptor;
}

function avroReferenceName(descriptor, namespace) {
  return descriptor.namespace === namespace ? descriptor.name : descriptor.fullName;
}

function warningForOmittedKeywords(schema, consumed, sourcePointer, context) {
  for (const key of Object.keys(schema)) {
    if (sourcePointer === '' && (key === '$schema' || key === '$id')) continue;
    if (consumed.has(key)) continue;
    warning(context.warnings, 'json-structure.keyword.omitted', `Keyword ${key} is not represented in Avro output.`, 'metadata', childPointer(sourcePointer, key), undefined);
  }
}

const AVRO_ANNOTATION_KEYWORDS = [
  'maxLength', 'minLength', 'precision', 'scale', 'pattern', 'minimum', 'maximum',
  'contentEncoding', 'contentMediaType', 'contentCompression',
  'symbol', 'symbols', 'unit', 'ucumUnit', 'currency',
  'concepts', 'observedProperty', 'semanticRole', 'derivation', 'statistic',
  'phenomenonTimeRelation', 'supportPeriod', 'cadence', 'codedValues', 'measurementConditioning',
];
const AVRO_NAME_BINDING_ANNOTATIONS = [
  'coordinateReferenceSystem', 'vectorReferenceFrames', 'tensorReferenceFrames', 'frameTransforms',
  'linearReferenceSystem', 'colorSpaces', 'audioChannels', 'spectralBands',
  'temporalReferenceSystem', 'referenceRole',
];

function avroDocumentFields(schema, consumed, sourcePointer, context) {
  if (context.emitDoc && typeof schema.description === 'string') consumed.add('description');
  for (const keyword of AVRO_NAME_BINDING_ANNOTATIONS) {
    if (!Object.prototype.hasOwnProperty.call(schema, keyword)) continue;
    consumed.add(keyword);
    warning(context.warnings, 'json-structure.annotation.dropped', `\`${keyword}\` names properties of the annotated type, and Avro field names are not the names it binds; the annotation is dropped.`, 'metadata', sourcePointer, undefined);
  }
  if (context.mode !== 'full') return {};
  const annotations = {};
  const decimalCarriesConstraints = schema.type === 'decimal' && Number.isInteger(schema.precision) && schema.precision > 0 && Number.isInteger(schema.scale ?? 0) && (schema.scale ?? 0) <= schema.precision;
  for (const keyword of AVRO_ANNOTATION_KEYWORDS) {
    if (!Object.prototype.hasOwnProperty.call(schema, keyword)) continue;
    consumed.add(keyword);
    if (decimalCarriesConstraints && (keyword === 'precision' || keyword === 'scale')) continue;
    annotations[keyword] = schema[keyword];
  }
  return Object.keys(annotations).length > 0 ? { annotations } : {};
}

function avroDescription(schema, context) {
  return context.emitDoc && typeof schema.description === 'string' ? schema.description : undefined;
}

function selectedAvroAddIns(document, uses, context) {
  if (uses.length === 0) return [];
  const requested = new Set(uses);
  const found = new Set();
  const addIns = [];
  const offers = isRecord(document.$offers) ? document.$offers : {};
  for (const [name, offered] of Object.entries(offers)) {
    if (!requested.has(name)) continue;
    found.add(name);
    const references = Array.isArray(offered) ? offered : [offered];
    for (const reference of references) {
      if (typeof reference !== 'string') throw new Error(`$offers/${name} must contain JSON Pointer references.`);
      const descriptor = resolveStructureDescriptor(reference, context, `/$offers/${escapePointer(name)}`);
      const target = descriptor.schema.$extends;
      if (typeof target !== 'string') throw new Error(`Add-in ${reference} must declare a single $extends target.`);
      addIns.push({ target, descriptor });
    }
  }
  for (const name of uses) if (!found.has(name)) throw new Error(`add-in '${name}' is not offered by this schema`);
  return addIns;
}

function requiredNames(schema, sourcePointer, context) {
  if (!Array.isArray(schema.required)) return new Set();
  if (schema.required.every((name) => typeof name === 'string')) return new Set(schema.required);
  if (!schema.required.every((alternative) => Array.isArray(alternative) && alternative.every((name) => typeof name === 'string'))) throw new Error(`required at ${sourcePointer || '/'} is malformed.`);
  const alternatives = schema.required;
  const intersection = alternatives.length === 0 ? [] : alternatives[0].filter((name) => alternatives.every((candidate) => candidate.includes(name)));
  warning(context.warnings, 'json-structure.required.alternatives', 'Alternative required sets were reduced to their intersection because Avro cannot represent the disjunction.', 'unsupported-feature', childPointer(sourcePointer, 'required'), undefined);
  return new Set(intersection);
}

function collectStructuredFields(schema, sourcePointer, context, kind, ancestors = []) {
  if (ancestors.includes(sourcePointer)) {
    const chain = [...ancestors, sourcePointer].map(schemaPointer).join(' -> ');
    throw new Error(`\`$extends\` cycle: ${chain} (at ${schemaPointer(sourcePointer)})`);
  }
  const fields = [];
  const names = new Set();
  const bases = typeof schema.$extends === 'string' ? [schema.$extends] : Array.isArray(schema.$extends) ? schema.$extends : [];
  if (bases.some((base) => typeof base !== 'string')) throw new Error(`$extends at ${sourcePointer} must contain references.`);
  for (const baseReference of bases) {
    const base = resolveStructureDescriptor(baseReference, context, sourcePointer);
    if (!isRecord(base.schema) || base.schema.type !== kind) throw new Error(`Base ${baseReference} is not a ${kind} type.`);
    if (base.schema.abstract !== true) throw new Error(`Base ${baseReference} must be abstract for Avro inheritance flattening.`);
    for (const field of collectStructuredFields(base.schema, base.pointer.slice(1), context, kind, [...ancestors, sourcePointer])) {
      if (!names.has(field.name)) {
        names.add(field.name);
        fields.push(field);
      }
    }
  }
  const properties = schema.properties === undefined ? {} : schema.properties;
  if (!isRecord(properties)) throw new Error(`properties at ${sourcePointer || '/'} must be an object.`);
  const required = requiredNames(schema, sourcePointer, context);
  const entries = kind === 'tuple'
    ? (Array.isArray(schema.tuple) ? schema.tuple : []).map((name) => [name, properties[name]])
    : Object.entries(properties);
  if (kind === 'tuple' && (!Array.isArray(schema.tuple) || schema.tuple.length === 0)) throw new Error(`tuple at ${sourcePointer || '/'} requires tuple order.`);
  for (const [name, member] of entries) {
    if (typeof name !== 'string') throw new Error(`Tuple member at ${sourcePointer || '/'} must be a property name.`);
    if (!isRecord(member)) throw new Error(`Property ${name} at ${sourcePointer || '/'} must be a schema object.`);
    if (names.has(name)) {
      const pointer = `${schemaPointer(sourcePointer)}/properties/${escapePointer(name)}`;
      throw new Error(`property '${name}' is inherited through \`$extends\` and MUST NOT be redefined (at ${pointer})`);
    }
    names.add(name);
    fields.push({ name, schema: member, pointer: childPointer(childPointer(sourcePointer, 'properties'), name), required: kind === 'tuple' || required.has(name) });
  }
  for (const name of required) if (!names.has(name)) throw new Error(`Required property ${name} at ${sourcePointer || '/'} is not declared.`);
  const currentReference = sourcePointer ? `#${sourcePointer}` : '#';
  for (const addIn of context.addIns.filter((candidate) => candidate.target === currentReference)) {
    const addInSchema = addIn.descriptor.schema;
    if (addInSchema.type !== kind) throw new Error(`Add-in ${addIn.descriptor.pointer} is not a ${kind} type.`);
    const addInProperties = addInSchema.properties;
    if (!isRecord(addInProperties)) continue;
    const addInRequired = requiredNames(addInSchema, addIn.descriptor.pointer.slice(1), context);
    for (const [name, member] of Object.entries(addInProperties)) {
      if (names.has(name)) continue;
      if (!isRecord(member)) throw new Error(`Property ${name} at ${addIn.descriptor.pointer} must be a schema object.`);
      names.add(name);
      fields.push({ name, schema: member, pointer: childPointer(childPointer(addIn.descriptor.pointer.slice(1), 'properties'), name), required: kind === 'tuple' || addInRequired.has(name) });
    }
  }
  return fields;
}

function generatedAvroName(suggestedName, namespace, sourcePointer, context) {
  const base = avroLegalName(suggestedName.replace(/[^A-Za-z0-9_]/g, '_'), `Generated name at ${sourcePointer || '/'}`);
  let name = base;
  let suffix = 2;
  while (context.fullNames.has(namespace ? `${namespace}.${name}` : name)) name = `${base}_${suffix++}`;
  if (name !== base) warning(context.warnings, 'json-structure.name.suffixed', `Generated Avro name ${base} was already reserved and was changed to ${name}.`, 'metadata', sourcePointer, undefined);
  context.fullNames.add(namespace ? `${namespace}.${name}` : name);
  return name;
}

function flattenAvroUnion(branches) {
  const result = [];
  const seen = new Set();
  const add = (branch) => {
    if (Array.isArray(branch)) {
      for (const nested of branch) add(nested);
      return;
    }
    const key = typeof branch === 'string' ? branch : isRecord(branch) && typeof branch.name === 'string'
      ? `${branch.namespace ? `${branch.namespace}.` : ''}${branch.name}`
      : isRecord(branch) && typeof branch.type === 'string' ? branch.type : JSON.stringify(branch);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(branch);
  };
  for (const branch of branches) add(branch);
  return result;
}

function nullableAvroType(type, defaultValue, hasDefault) {
  const branches = flattenAvroUnion(Array.isArray(type) ? type : [type]);
  const withoutNull = branches.filter((branch) => branch !== 'null');
  if (!hasDefault) return { type: ['null', ...withoutNull], default: null };
  if (defaultValue === null) return { type: ['null', ...withoutNull], default: null };
  return placeAvroDefault([...withoutNull, 'null'], defaultValue);
}

function avroTypeNames(type) {
  if (typeof type === 'string') return [type, type.split('.').pop()];
  if (!isRecord(type)) return [];
  if (typeof type.name === 'string') {
    const fullName = typeof type.namespace === 'string' ? `${type.namespace}.${type.name}` : type.name;
    return [fullName, type.name];
  }
  return typeof type.type === 'string' ? [type.type] : [];
}

function placeAvroDefault(type, defaultValue) {
  const branches = flattenAvroUnion(Array.isArray(type) ? type : [type]);
  let matchingIndex = -1;
  let emittedDefault = defaultValue;
  if (isRecord(defaultValue) && Object.keys(defaultValue).length === 1) {
    const [tag] = Object.keys(defaultValue);
    matchingIndex = branches.findIndex((branch) => avroTypeNames(branch).includes(tag));
    if (matchingIndex >= 0) {
      emittedDefault = defaultValue[tag];
      const selected = branches[matchingIndex];
      if (isRecord(selected) && selected.type === 'record' && Array.isArray(selected.fields) && selected.fields.length === 1 && selected.fields[0]?.name === 'value') {
        emittedDefault = { value: emittedDefault };
      }
    }
  }
  if (matchingIndex < 0) matchingIndex = branches.findIndex((branch) => defaultMatchesAvroType(defaultValue, branch));
  if (matchingIndex < 0) throw new Error('A field default does not match any emitted Avro branch.');
  if (branches.length === 1) return { type: branches[0], default: emittedDefault };
  const selected = branches[matchingIndex];
  return { type: [selected, ...branches.filter((_, index) => index !== matchingIndex)], default: emittedDefault };
}

function defaultMatchesAvroType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'int' || type === 'long') return Number.isInteger(value);
  if (type === 'float' || type === 'double') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string' || type === 'bytes') return typeof value === 'string';
  if (typeof type === 'string' && !avroPrimitiveTypes.has(type)) return typeof value === 'string' || isRecord(value);
  if (!isRecord(type)) return false;
  if (type.type === 'array') return Array.isArray(value);
  if (type.type === 'map' || type.type === 'record') return isRecord(value);
  if (type.type === 'enum' || type.type === 'fixed' || type.type === 'bytes') return typeof value === 'string';
  return defaultMatchesAvroType(value, type.type);
}

function declarationEmitsAvroName(schema) {
  if (schema.type === 'object' || schema.type === 'tuple' || schema.type === 'any') return true;
  return schema.type === 'string' && Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((symbol) => typeof symbol === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol));
}

function compileDeclaredType(descriptor, context, currentNamespace, injectSelector) {
  const aliasReference = referenceFromSchema(descriptor.schema);
  if (aliasReference) {
    if (context.resolvingAliases.has(descriptor.pointer)) throw new Error(`Reference cycle detected at ${descriptor.pointer}.`);
    context.resolvingAliases.add(descriptor.pointer);
    try {
      return compileDeclaredType(resolveStructureDescriptor(aliasReference, context, descriptor.pointer), context, currentNamespace, injectSelector);
    } finally {
      context.resolvingAliases.delete(descriptor.pointer);
    }
  }
  if (descriptor.schema.abstract === true) throw new Error(`abstract types cannot be used as a value type (at ${descriptor.pointer})`);
  const named = declarationEmitsAvroName(descriptor.schema);
  if (context.emitting.has(descriptor.pointer)) {
    if (!named) throw new Error(`Recursive declaration ${descriptor.pointer} has no Avro named-type representation.`);
    return avroReferenceName(descriptor, currentNamespace);
  }
  if (named && context.emitted.has(descriptor.pointer)) return avroReferenceName(descriptor, currentNamespace);
  context.emitting.add(descriptor.pointer);
  if (named) context.emitted.add(descriptor.pointer);
  try {
    return compileStructureSchema(descriptor.schema, descriptor.pointer.slice(1), context, {
      namespace: descriptor.namespace,
      name: descriptor.name,
      named: true,
      injectSelector,
    });
  } finally {
    context.emitting.delete(descriptor.pointer);
  }
}

function compileRecord(schema, sourcePointer, context, naming, tupleOrder) {
  if (schema.abstract === true) throw new Error(`abstract types cannot be used as a value type (at ${schemaPointer(sourcePointer)})`);
  const openRecord = schema.additionalProperties === true || isRecord(schema.additionalProperties);
  if (openRecord && context.additionalProperties === 'error') throw new Error(`Avro records are closed; \`additionalProperties\` cannot be carried and undeclared properties will not be transmitted (at ${schemaPointer(sourcePointer)})`);
  const name = naming.named ? naming.name : generatedAvroName(naming.name, naming.namespace, sourcePointer, context);
  const output = { type: 'record', name };
  if (naming.namespace) output.namespace = naming.namespace;
  const consumed = new Set(['type', 'name', 'properties', 'required', 'description', '$extends', 'abstract', 'tuple', 'additionalProperties', 'altnames']);
  const doc = avroDescription(schema, context);
  if (doc !== undefined) output.doc = doc;
  Object.assign(output, avroDocumentFields(schema, consumed, sourcePointer, context));
  const fields = collectStructuredFields(schema, sourcePointer, context, tupleOrder ? 'tuple' : 'object');
  output.fields = [];
  if (naming.injectSelector && !fields.some((field) => field.name === naming.injectSelector)) output.fields.push({ name: naming.injectSelector, type: 'string' });
  output.fields.push(...fields.map((field) => {
    const fieldName = avroAlternateName(field.schema, field.name, field.pointer);
    const mapped = compileStructureSchema(field.schema, field.pointer, context, { namespace: naming.namespace, name: `${name}_${fieldName}`, named: false });
    const hasDefault = Object.prototype.hasOwnProperty.call(field.schema, 'default');
    const fieldConsumed = new Set(['type', 'name', 'description', 'default']);
    const fieldDoc = avroDescription(field.schema, context);
    const metadata = avroDocumentFields(field.schema, fieldConsumed, field.pointer, context);
    if (field.required) {
      const required = hasDefault ? placeAvroDefault(mapped, field.schema.default) : { type: mapped };
      return { name: fieldName, type: required.type, ...(fieldDoc === undefined ? {} : { doc: fieldDoc }), ...metadata, ...(hasDefault ? { default: required.default } : {}) };
    }
    const optional = nullableAvroType(mapped, field.schema.default, hasDefault);
    return { name: fieldName, type: optional.type, ...(fieldDoc === undefined ? {} : { doc: fieldDoc }), ...metadata, default: optional.default };
  }));
  if (openRecord) warning(context.warnings, 'json-structure.additionalProperties.dropped', 'Avro records are closed; undeclared properties will not be transmitted.', 'data-loss', childPointer(sourcePointer, 'additionalProperties'), undefined);
  warningForOmittedKeywords(schema, consumed, sourcePointer, context);
  return output;
}

function compileStringEnum(schema, sourcePointer, context, naming) {
  const symbols = avroEnumSymbols(schema, sourcePointer);
  if (!symbols || symbols.length === 0) return undefined;
  const name = naming.named ? naming.name : generatedAvroName(naming.name, naming.namespace, sourcePointer, context);
  const output = { type: 'enum', name };
  if (naming.namespace) output.namespace = naming.namespace;
  const consumed = new Set(['type', 'name', 'enum', 'default', 'description', 'altnames', 'altenums']);
  const doc = avroDescription(schema, context);
  if (doc !== undefined) output.doc = doc;
  Object.assign(output, avroDocumentFields(schema, consumed, sourcePointer, context));
  output.symbols = symbols;
  if (typeof schema.default === 'string' && schema.enum.includes(schema.default)) {
    const index = schema.enum.indexOf(schema.default);
    output.default = symbols[index];
  }
  warningForOmittedKeywords(schema, consumed, sourcePointer, context);
  return output;
}

function compileChoice(schema, sourcePointer, context, naming) {
  if (!isRecord(schema.choices) || Object.keys(schema.choices).length === 0) throw new Error(`Choice at ${sourcePointer} requires choices.`);
  const branches = [];
  const inline = Object.prototype.hasOwnProperty.call(schema, '$extends') && typeof schema.selector === 'string';
  for (const [key, branch] of Object.entries(schema.choices)) {
    if (!isRecord(branch)) throw new Error(`Choice branch ${key} at ${sourcePointer} must be a schema.`);
    if (inline) {
      const reference = referenceFromSchema(branch);
      if (!reference) throw new Error(`Inline choice branch ${key} at ${sourcePointer} must reference a named type.`);
      branches.push(compileDeclaredType(resolveStructureDescriptor(reference, context, childPointer(childPointer(sourcePointer, 'choices'), key)), context, naming.namespace, schema.selector));
      continue;
    }
    const mapped = compileStructureSchema(branch, childPointer(childPointer(sourcePointer, 'choices'), key), context, { namespace: naming.namespace, name: `${naming.name}_${avroLegalName(key, `Choice key ${key}`)}`, named: false });
    const branchName = typeof mapped === 'string' ? mapped.split('.').pop() : isRecord(mapped) && typeof mapped.name === 'string' ? mapped.name : isRecord(mapped) && typeof mapped.type === 'string' ? mapped.type : undefined;
    if (branchName === key) branches.push(mapped);
    else {
      const wrapperName = generatedAvroName(key, naming.namespace, sourcePointer, context);
      branches.push({ type: 'record', name: wrapperName, ...(naming.namespace ? { namespace: naming.namespace } : {}), fields: [{ name: 'value', type: mapped }] });
    }
  }
  warningForOmittedKeywords(schema, new Set(['type', 'name', 'choices', 'selector', 'description', '$extends']), sourcePointer, context);
  return flattenAvroUnion(branches);
}

function compileStructureSchema(schema, sourcePointer, context, naming) {
  if (!isRecord(schema)) throw new Error(`Schema at ${sourcePointer || '/'} must be an object.`);
  const reference = referenceFromSchema(schema);
  if (reference) return compileDeclaredType(resolveStructureDescriptor(reference, context, sourcePointer), context, naming.namespace);
  const type = schema.type;
  if (Array.isArray(type)) {
    const branches = type.map((member, index) => {
      if (typeof member === 'string') return compileStructureSchema({ type: member }, childPointer(childPointer(sourcePointer, 'type'), index), context, naming);
      if (isRecord(member) && typeof member.$ref === 'string') return compileDeclaredType(resolveStructureDescriptor(member.$ref, context, childPointer(childPointer(sourcePointer, 'type'), index)), context, naming.namespace);
      if (isRecord(member)) return compileStructureSchema(member, childPointer(childPointer(sourcePointer, 'type'), index), context, naming);
      throw new Error(`Union member at ${childPointer(childPointer(sourcePointer, 'type'), index)} must be a schema.`);
    });
    const union = flattenAvroUnion(branches);
    return union.length === 1 ? union[0] : union;
  }
  if (type === 'null' || type === 'boolean' || type === 'string') {
    if (type === 'string') {
      const avroEnum = compileStringEnum(schema, sourcePointer, context, naming);
      if (avroEnum) return avroEnum;
    }
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default']), sourcePointer, context);
    return type;
  }
  if (['integer', 'int8', 'uint8', 'int16', 'uint16', 'int32'].includes(type)) {
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default']), sourcePointer, context);
    return 'int';
  }
  if (type === 'int64' || type === 'uint32') {
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default']), sourcePointer, context);
    return 'long';
  }
  if (['int128', 'uint64', 'uint128'].includes(type)) {
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default']), sourcePointer, context);
    return 'string';
  }
  if (type === 'number') {
    warning(context.warnings, 'json-structure.numeric.precision', 'JSON Structure number was narrowed to Avro double.', 'precision', childPointer(sourcePointer, 'type'), undefined);
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default']), sourcePointer, context);
    return 'double';
  }
  if (type === 'float8' || type === 'float') {
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default']), sourcePointer, context);
    return 'float';
  }
  if (type === 'double') {
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default']), sourcePointer, context);
    return 'double';
  }
  if (type === 'decimal') {
    const precision = schema.precision;
    const scale = schema.scale === undefined ? 0 : schema.scale;
    if (Number.isInteger(precision) && precision > 0 && Number.isInteger(scale) && scale >= 0 && scale <= precision) {
      warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default', 'precision', 'scale']), sourcePointer, context);
      return { type: 'bytes', logicalType: 'decimal', precision, scale };
    }
    const reason = !Number.isInteger(precision) || precision <= 0 ? 'declares no valid precision' : `declares scale ${String(scale)} greater than precision ${String(precision)}`;
    warning(context.warnings, 'json-structure.decimal.lexical', `decimal ${reason}; the value is carried as a lexical string.`, 'precision', sourcePointer, undefined);
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default', 'precision', 'scale']), sourcePointer, context);
    return 'string';
  }
  if (type === 'binary') {
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default']), sourcePointer, context);
    return 'bytes';
  }
  if (['date', 'datetime', 'time', 'duration', 'uuid', 'uri', 'jsonpointer'].includes(type)) {
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default']), sourcePointer, context);
    const logicalType = context.mode === 'full' ? { date: 'rfc3339-date', time: 'rfc3339-time-micros', datetime: 'rfc3339-timestamp-micros', duration: 'rfc3339-duration', uuid: 'uuid' }[type] : undefined;
    return logicalType ? { type: 'string', logicalType } : 'string';
  }
  if (type === 'array' || type === 'set') {
    if (!isRecord(schema.items)) throw new Error(`${type} at ${sourcePointer} requires items.`);
    if (type === 'set') warning(context.warnings, 'json-structure.set.uniqueness', 'Set uniqueness is not represented by Avro arrays.', 'unsupported-feature', sourcePointer, undefined);
    const output = { type: 'array', items: compileStructureSchema(schema.items, childPointer(sourcePointer, 'items'), context, { namespace: naming.namespace, name: `${naming.name}_item`, named: false }) };
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default', 'items']), sourcePointer, context);
    return output;
  }
  if (type === 'map') {
    if (!isRecord(schema.values)) throw new Error(`map at ${sourcePointer} requires values.`);
    const output = { type: 'map', values: compileStructureSchema(schema.values, childPointer(sourcePointer, 'values'), context, { namespace: naming.namespace, name: `${naming.name}_value`, named: false }) };
    warningForOmittedKeywords(schema, new Set(['type', 'name', 'description', 'default', 'values']), sourcePointer, context);
    return output;
  }
  if (type === 'object') return compileRecord(schema, sourcePointer, context, naming);
  if (type === 'tuple') {
    if (!Array.isArray(schema.tuple)) throw new Error(`tuple at ${sourcePointer} requires tuple order.`);
    return compileRecord(schema, sourcePointer, context, naming, schema.tuple);
  }
  if (type === 'choice') return compileChoice(schema, sourcePointer, context, naming);
  if (type === 'any') {
    warning(context.warnings, 'json-structure.any.reader-only', 'Avro any placeholder is readable but cannot write an arbitrary payload.', 'unsupported-feature', sourcePointer, undefined);
    return compileRecord({ type: 'object', properties: {} }, sourcePointer, context, naming);
  }
  throw new Error(`Unsupported JSON Structure type ${String(type)} at ${sourcePointer || '/'}.`);
}

function validateGeneratedAvro(schema) {
  const defined = new Set();
  const visit = (value, namespace = '') => {
    if (Array.isArray(value)) {
      if (value.length === 0) throw new Error('Generated Avro union must not be empty.');
      for (const branch of value) {
        if (Array.isArray(branch)) throw new Error('Generated Avro contains a nested union.');
        visit(branch, namespace);
      }
      return;
    }
    if (typeof value === 'string') {
      if (!avroPrimitiveTypes.has(value) && !defined.has(value) && !defined.has(namespace ? `${namespace}.${value}` : value)) throw new Error(`Generated Avro references undefined named type ${value}.`);
      return;
    }
    if (!isRecord(value)) throw new Error('Generated Avro schema node is invalid.');
    if (value.type === 'record' || value.type === 'enum' || value.type === 'fixed') {
      const name = avroLegalName(value.name, 'Generated Avro named type');
      const typeNamespace = typeof value.namespace === 'string' ? value.namespace : namespace;
      const fullName = typeNamespace ? `${typeNamespace}.${name}` : name;
      if (defined.has(fullName)) throw new Error(`Generated Avro redefines named type ${fullName}.`);
      defined.add(fullName);
      if (value.type === 'record') {
        if (!Array.isArray(value.fields)) throw new Error(`Generated Avro record ${fullName} has no fields array.`);
        const fieldNames = new Set();
        for (const field of value.fields) {
          if (!isRecord(field)) throw new Error(`Generated Avro record ${fullName} has an invalid field.`);
          const fieldName = avroLegalName(field.name, `Field in ${fullName}`);
          if (fieldNames.has(fieldName)) throw new Error(`Generated Avro record ${fullName} repeats field ${fieldName}.`);
          fieldNames.add(fieldName);
          visit(field.type, typeNamespace);
          if (Object.prototype.hasOwnProperty.call(field, 'default')) {
            const firstBranch = Array.isArray(field.type) ? field.type[0] : field.type;
            if (!defaultMatchesAvroType(field.default, firstBranch)) throw new Error(`Generated Avro field ${fullName}.${fieldName} has a default that does not match its first branch.`);
          }
        }
      }
      return;
    }
    if (value.type === 'array') { visit(value.items, namespace); return; }
    if (value.type === 'map') { visit(value.values, namespace); return; }
    if (value.logicalType === 'decimal' && (value.type !== 'bytes' || !Number.isInteger(value.precision) || value.precision <= 0 || !Number.isInteger(value.scale) || value.scale < 0 || value.scale > value.precision)) throw new Error('Generated Avro decimal is invalid.');
    visit(value.type, namespace);
  };
  visit(schema);
}

function convertJsonStructureToAvro(sourceText, sourceName, options, preview) {
  const doc = JSON.parse(sourceText);
  if (!isRecord(doc)) throw new Error('JSON Structure source must be an object.');
  assertEffectiveImports(doc, 'Avro');
  const warnings = [];
  const context = {
    document: doc,
    warnings,
    registry: new Map(),
    fullNames: new Set(),
    emitted: new Set(),
    emitting: new Set(),
    resolvingAliases: new Set(),
    additionalProperties: options.additional_properties === 'error' ? 'error' : 'ignore',
    mode: options.mode === 'full' ? 'full' : 'compact',
    emitDoc: options.emit_doc !== false,
    addIns: [],
  };
  if (doc.definitions !== undefined) registerJsonStructureDefinitions(doc.definitions, '/definitions', [], context);
  const uses = Array.isArray(options.uses) ? options.uses : [];
  context.addIns = selectedAvroAddIns(doc, uses, context);
  let output;
  let rootName;
  if (typeof doc.$root === 'string') {
    const root = resolveStructureDescriptor(doc.$root, context, '/$root');
    rootName = root.name;
    output = compileDeclaredType(root, context, root.namespace);
  } else if (Object.prototype.hasOwnProperty.call(doc, 'type')) {
    if (doc.abstract === true) throw new Error('abstract types cannot be used as a value type (at #)');
    rootName = typeof doc.name === 'string' ? avroAlternateName(doc, doc.name, '') : undefined;
    const rootType = Array.isArray(doc.type) ? undefined : doc.type;
    if (['object', 'tuple', 'choice', 'any'].includes(rootType) && !rootName) throw new Error('Named root JSON Structure types require a valid name for Avro export.');
    output = compileStructureSchema(doc, '', context, { namespace: '', name: rootName || 'Root', named: Boolean(rootName) });
  } else {
    throw new Error('document declares neither `type` nor `$root`; nothing to compile');
  }
  validateGeneratedAvro(output);
  const outputName = rootName || sourceName.replace(/\.struct\.json$/i, '') || 'schema';
  return {
    lossiness: aggregateLossiness(warnings),
    warnings,
    files: {
      [preview ? 'preview.avsc' : `${outputName}.avsc`]: Buffer.from(JSON.stringify(output, null, 2) + '\n').toString('base64'),
    },
  };
}

function convertJsonStructureToProto(sourceText, sourceName, options) {
  const document = JSON.parse(sourceText);
  if (!isRecord(document)) throw new Error('JSON Structure source must be an object.');
  assertEffectiveImports(document, 'Protobuf');
  const generated = generateProto(document, sourceName, options);
  const files = {};
  for (const file of generated.files) defineOwn(files, file.path, Buffer.from(file.contents, 'utf8').toString('base64'));
  files['proto-numbers.json'] = Buffer.from(JSON.stringify(generated.numbers, null, 2) + '\n', 'utf8').toString('base64');
  const warnings = generated.warnings.map((entry) => ({
    code: entry.code,
    message: entry.message,
    lossiness: entry.lossiness,
    sourceLocation: entry.path,
  }));
  return { files, warnings, lossiness: aggregateLossiness(warnings) };
}

function readGeneratedFiles(root, directory = root) {
  const files = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) for (const [filePath, content] of Object.entries(readGeneratedFiles(root, path))) defineOwn(files, filePath, content);
    else if (entry.isFile()) defineOwn(files, relative(root, path).replace(/\\/g, '/'), readFileSync(path).toString('base64'));
  }
  return files;
}

const STRUCTURIZE_OUTPUT_LIMIT = 1024 * 1024;
let activeStructurizeProcess;
let activeOperationId;
let cancellationRequested = false;
let cancellationInProgress;

function conversionCancelledError() {
  const error = new Error('Conversion cancelled.');
  error.name = 'AbortError';
  return error;
}

function waitForProcessExit(child, milliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    timer.unref();
    child.once('exit', onExit);
  });
}

async function terminateStructurizeProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  const pid = child.pid;
  if (process.platform === 'win32') {
    await new Promise((resolveTermination) => {
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolveTermination());
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    if (!await waitForProcessExit(child, 750)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
  await waitForProcessExit(child, 1_000);
}

function cancelActiveStructurize(operationId) {
  if (operationId !== undefined && activeOperationId !== operationId) return Promise.resolve();
  cancellationRequested = true;
  if (!cancellationInProgress) {
    cancellationInProgress = terminateStructurizeProcess(activeStructurizeProcess).finally(() => {
      cancellationInProgress = undefined;
    });
  }
  return cancellationInProgress;
}

function resolveBundledStructurizeInvocation() {
  const roots = [];
  const allowLocalOverride = process.env.STRUCTURIZE_ALLOW_RUNTIME_OVERRIDE === '1' && process.env.NODE_ENV !== 'production' && !process.versions.electron;
  if (allowLocalOverride && process.env.STRUCTURIZE_RUNTIME_ROOT) roots.push(resolve(process.env.STRUCTURIZE_RUNTIME_ROOT));
  else {
    roots.push(resolve(process.cwd(), 'build', 'structurize-runtime'));
    roots.push(resolve(__dirname, '..', '..', '..', 'build', 'structurize-runtime'));
    roots.push(join(__dirname, 'structurize-runtime'));
  }
  const seen = new Set();
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    const runtimeDirectory = join(root, `${process.platform}-${process.arch}`);
    const manifestPath = join(runtimeDirectory, 'runtime.json');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
    catch (error) { throw new Error(`Bundled Structurize runtime manifest is invalid: ${error instanceof Error ? error.message : String(error)}`); }
    return verifyBundledRuntime(runtimeDirectory, manifestPath, manifest);
  }
  if (allowLocalOverride && process.env.STRUCTURIZE_RUNTIME_ROOT) return undefined;
  return undefined;
}

function invokeStructurizeExecutable(executable, args, workspace, environment = {}) {
  return new Promise((resolveInvocation) => {
    const script = ['.js', '.cjs', '.mjs'].includes(extname(executable).toLowerCase());
    const command = script ? process.execPath : executable;
    const commandArgs = script ? [executable, ...args] : args;
    const child = spawn(command, commandArgs, {
      cwd: workspace,
      env: { ...process.env, ...environment },
      encoding: 'utf8',
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeStructurizeProcess = child;
    let settled = false;
    let stdoutText = '';
    let stderrText = '';
    let outputError;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (activeStructurizeProcess === child) activeStructurizeProcess = undefined;
      resolveInvocation({ ...result, stdout: stdoutText, stderr: stderrText });
    };
    const consume = (stream, chunk) => {
      if (outputError) return;
      if (stream === 'stdout') stdoutText += chunk.toString('utf8');
      else stderrText += chunk.toString('utf8');
      if (Buffer.byteLength(stdoutText) + Buffer.byteLength(stderrText) > STRUCTURIZE_OUTPUT_LIMIT) {
        outputError = new Error(`Structurize ${stream} exceeded the ${STRUCTURIZE_OUTPUT_LIMIT}-byte output limit.`);
        void terminateStructurizeProcess(child);
      }
    };
    child.stdout.on('data', (chunk) => consume('stdout', chunk));
    child.stderr.on('data', (chunk) => consume('stderr', chunk));
    child.once('error', (error) => finish({ error }));
    child.once('close', (status, signal) => finish({ status, signal, ...(outputError ? { error: outputError } : {}) }));
    if (cancellationRequested) void terminateStructurizeProcess(child);
  });
}

function normalizeStructurizeJsonStructure(files, command) {
  if (command.targetFormat !== 'json-structure') return { files, warnings: [] };
  const normalized = {};
  const warnings = [];
  for (const [path, encoded] of Object.entries(files)) {
    let document;
    try { document = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch { defineOwn(normalized, path, encoded); continue; }
    if (!isRecord(document)) { defineOwn(normalized, path, encoded); continue; }
    if (document.name === undefined) {
      let rootName;
      if (typeof document.$root === 'string' && document.$root.startsWith('#/definitions/')) {
        const token = document.$root.slice('#/definitions/'.length).split('/')[0];
        const definition = isRecord(document.definitions) && hasOwn(document.definitions, decodePointerToken(token)) ? document.definitions[decodePointerToken(token)] : undefined;
        rootName = isRecord(definition) && typeof definition.name === 'string' ? definition.name : decodePointerToken(token);
      } else if (typeof document.name === 'string') rootName = document.name;
      else if (Object.prototype.hasOwnProperty.call(document, 'type')) rootName = 'Document';
      if (typeof rootName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(rootName)) throw new Error(`Structurize ${command.cliCommand} produced JSON Structure output ${path} without a valid root declaration name.`);
      document.name = rootName;
      defineOwn(normalized, path, Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8').toString('base64'));
      warnings.push({ code: 'structurize.root-name.normalized', message: `Structurize ${command.cliCommand} output did not include a document name; ${rootName} was derived from its root declaration.`, lossiness: 'metadata' });
    } else defineOwn(normalized, path, encoded);
  }
  return { files: normalized, warnings };
}

function structurizeWarnings(command) {
  const warnings = [{
    code: 'structurize.lossiness.unreported',
    message: `Structurize ${command.cliCommand} completed without machine-readable lossiness metadata; review the generated output for features the target format cannot represent.`,
    lossiness: 'unsupported-feature',
  }];
  if (command.cliCommand === 'json2s' || command.cliCommand === 'xml2s') warnings.push({
    code: `structurize.${command.cliCommand}.inference`,
    message: `${command.cliCommand} infers a schema from sample data; values and constraints not present in the sample are not represented.`,
    lossiness: 'data-loss',
  });
  return warnings;
}

async function runStructurize(command, sourceName, sourceText, options) {
  if (command.availability === 'external-service') {
    const required = Array.isArray(command.availabilityRequirements) ? command.availabilityRequirements : [];
    const missing = required.filter((name) => typeof options?.[name] !== 'string' || options[name].trim() === '');
    if (missing.length > 0) throw new Error(missing.length === required.length ? (command.availabilityMessage || `Structurize ${command.cliCommand} requires an external service capability that is not configured.`) : `${command.availabilityMessage || `Structurize ${command.cliCommand} requires an external service capability that is not configured.`} Missing configuration: ${missing.join(', ')}.`);
  }

  if (command.direction === 'export') {
    const document = JSON.parse(sourceText);
    if (!isRecord(document)) throw new Error('JSON Structure source must be an object.');
    assertEffectiveImports(document, `Structurize ${command.cliCommand}`);
  }
  const workspace = mkdtempSync(join(tmpdir(), 'json-structure-convert-'));
  try {
    if (cancellationRequested) throw conversionCancelledError();
    const inputName = basename(sourceName) || 'source.schema';
    const inputPath = join(workspace, inputName);
    writeFileSync(inputPath, sourceText, 'utf8');
    const outputRoot = join(workspace, 'output');
    const outputPath = command.outputKind === 'directory' ? outputRoot : join(outputRoot, command.outputName);
    mkdirSync(command.outputKind === 'directory' ? outputPath : outputRoot, { recursive: true });
    const args = [command.cliCommand, inputPath, '--out', outputPath];
    for (const [name, value] of Object.entries(options)) {
      const flag = `--${name.replace(/_/g, '-')}`;
      if (typeof value === 'boolean') {
        if (value) args.push(flag);
      } else if (Array.isArray(value)) {
        for (const item of value) args.push(flag, item);
      } else if (value !== '') {
        args.push(flag, String(value));
      }
    }
    const allowLocalOverride = process.env.STRUCTURIZE_ALLOW_RUNTIME_OVERRIDE === '1' && process.env.NODE_ENV !== 'production' && !process.versions.electron;
    const bundled = allowLocalOverride && process.env.STRUCTURIZE_EXECUTABLE ? undefined : resolveBundledStructurizeInvocation();
    const candidates = allowLocalOverride && process.env.STRUCTURIZE_EXECUTABLE
      ? [{ executable: process.env.STRUCTURIZE_EXECUTABLE, arguments: [], environment: {} }]
      : bundled
        ? [bundled]
        : [];
    if (candidates.length === 0) throw new Error(`Structurize runtime is unavailable for ${command.cliCommand} on ${process.platform}-${process.arch}; no matching packaged runtime was found and PATH fallback is disabled. Build the platform runtime or use the explicit local-development override.`);
    let result;
    for (const candidate of candidates) {
      if (cancellationRequested) throw conversionCancelledError();
      result = await invokeStructurizeExecutable(candidate.executable, [...candidate.arguments, ...args], workspace, candidate.environment);
      if (!result.error || result.error.code !== 'ENOENT') break;
    }
    if (cancellationRequested) throw conversionCancelledError();
    if (result?.error) {
      if (result.error.code === 'ENOENT') throw new Error(`Structurize runtime is unavailable for ${command.cliCommand} on ${process.platform}-${process.arch}. Build and install the matching packaged runtime; STRUCTURIZE_EXECUTABLE is a local-development override.`);
      throw result.error;
    }
    if (!result || result.status !== 0) {
      const detail = result?.stderr?.trim() || result?.stdout?.trim() || `exit code ${String(result?.status)}`;
      throw new Error(`Structurize ${command.cliCommand} failed: ${detail}`);
    }
    let files = command.outputKind === 'directory'
      ? readGeneratedFiles(outputPath)
      : existsSync(outputPath) ? { [command.outputName]: readFileSync(outputPath).toString('base64') } : {};
    if (Object.keys(files).length === 0) throw new Error(`Structurize ${command.cliCommand} produced no output files.`);
    const normalized = normalizeStructurizeJsonStructure(files, command);
    files = normalized.files;
    const warnings = [...structurizeWarnings(command), ...normalized.warnings];
    return { files, warnings, lossiness: aggregateLossiness(warnings) };
  } finally {
    if (activeStructurizeProcess) await terminateStructurizeProcess(activeStructurizeProcess);
    if (cancellationInProgress) await cancellationInProgress;
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function runStructurizePipeline(command, sourceName, sourceText, options) {
  let currentName = sourceName;
  let currentText = sourceText;
  const warnings = [];
  let lossiness = 'none';
  let files = {};
  for (let index = 0; index < command.cliPipeline.length; index += 1) {
    const step = command.cliPipeline[index];
    const final = index === command.cliPipeline.length - 1;
    const stepOptions = Object.fromEntries(Object.entries(options).filter(([name]) => !step.optionNames || step.optionNames.includes(name)));
    const result = await runStructurize({
      ...command,
      cliCommand: step.cliCommand,
      cliPipeline: undefined,
      direction: index === 0 ? command.direction : 'import',
      targetFormat: final ? command.targetFormat : 'avro',
      outputKind: step.outputKind,
      outputName: step.outputName,
      availability: index === 0 ? command.availability : 'local',
      availabilityRequirements: index === 0 ? command.availabilityRequirements : undefined,
    }, currentName, currentText, stepOptions);
    warnings.push(...result.warnings);
    if (result.lossiness !== 'none') lossiness = result.lossiness;
    files = result.files;
    if (!final) {
      const entries = Object.entries(files);
      if (entries.length !== 1) throw new Error(`Structurize pipeline step ${step.cliCommand} produced ${entries.length} files; exactly one intermediate schema is required.`);
      currentName = entries[0][0];
      currentText = Buffer.from(entries[0][1], 'base64').toString('utf8');
    }
  }
  return { files, warnings, lossiness };
}

async function runConversion(commandId, sourceName, sourceText, options, preview) {
  if (commandId === 'import.jsonschema.to-json-structure') {
    return convertJsonSchemaToJsonStructure(sourceText, sourceName, options, preview);
  }
  if (commandId === 'export.json-structure.to-jsonschema') {
    return convertJsonStructureToJsonSchema(sourceText, sourceName, options, preview);
  }
  if (commandId === 'import.avro.to-json-structure') {
    return convertAvroToJsonStructure(sourceText, sourceName, options, preview);
  }
  if (commandId === 'export.json-structure.to-avro') {
    return convertJsonStructureToAvro(sourceText, sourceName, options, preview);
  }
  if (commandId === 'export.json-structure.to-protobuf') {
    return convertJsonStructureToProto(sourceText, sourceName, options);
  }
  const command = commandsManifest.commands.find((candidate) => candidate.id === commandId && (candidate.cliCommand || candidate.cliPipeline));
  if (command?.cliPipeline) return await runStructurizePipeline(command, sourceName, sourceText, options);
  if (command) return await runStructurize(command, sourceName, sourceText, options);
  throw new Error(`Unsupported command id: ${commandId}`);
}

let input = '';
let requestStarted = false;
let activeRequest;
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => {
  input += chunk;
  const lines = input.split(/\r?\n/);
  input = lines.pop() || '';
  for (const line of lines) processInputLine(line);
});
stdin.on('end', () => {
  if (input.trim()) processInputLine(input);
});

function processInputLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!message || typeof message !== 'object') return;
  if (message.type === 'cancel') {
    void cancelActiveStructurize(typeof message.operationId === 'string' ? message.operationId : undefined);
    return;
  }
  if (message.type !== 'request' || requestStarted) return;
  requestStarted = true;
  activeOperationId = typeof message.operationId === 'string' ? message.operationId : 'unknown';
  activeRequest = handleRequest(message).finally(() => {
    activeRequest = undefined;
    activeOperationId = undefined;
    stdin.destroy();
  });
}

async function handleRequest(request) {
  const operationId = activeOperationId;
  try {
    emit({ type: 'progress', operationId, phase: 'read', completed: 1, total: 3, message: 'Parsing source document.' });
    const source = Buffer.from(String(request.sourceBase64 || ''), 'base64').toString('utf8');
    emit({ type: 'progress', operationId, phase: 'convert', completed: 2, total: 3, message: 'Running conversion workflow.' });
    const result = await runConversion(String(request.commandId || ''), String(request.sourceName || 'source.json'), source, request.options && typeof request.options === 'object' ? request.options : {}, Boolean(request.preview));
    if (cancellationRequested) throw conversionCancelledError();
    emit({ type: 'progress', operationId, phase: 'finalize', completed: 3, total: 3, message: 'Packaging output files.' });
    emit({
      type: 'result',
      operationId,
      lossiness: result.lossiness,
      warnings: result.warnings,
      files: Object.entries(result.files).map(([path, contentBase64]) => ({ path, contentBase64 })),
    });
  } catch (error) {
    emit({
      type: 'error',
      operationId,
      code: cancellationRequested || error?.name === 'AbortError' ? 'conversion.cancelled' : 'conversion.failed',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

const handleTerminationSignal = () => {
  void cancelActiveStructurize().finally(() => {
    if (!activeRequest) stdin.destroy();
  });
};
process.once('SIGTERM', handleTerminationSignal);
process.once('SIGINT', handleTerminationSignal);
