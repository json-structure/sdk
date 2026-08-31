#!/usr/bin/env node
'use strict';

const { stdin, stdout } = process;

function emit(event) {
  stdout.write(JSON.stringify(event) + '\n');
}

function mapPrimitiveType(type) {
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'string' || type === 'boolean' || type === 'null') return type;
  return 'string';
}

function convertJsonSchemaToJsonStructure(sourceText, sourceName, options, preview) {
  const doc = JSON.parse(sourceText);
  const rootName = typeof options.rootName === 'string' && options.rootName.trim() ? options.rootName.trim() : 'Root';
  const required = Array.isArray(doc.required) ? doc.required.filter((item) => typeof item === 'string') : [];
  const properties = doc.properties && typeof doc.properties === 'object' && !Array.isArray(doc.properties) ? doc.properties : {};
  const convertedProperties = {};
  const warnings = [];
  for (const [name, value] of Object.entries(properties)) {
    const prop = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const type = typeof prop.type === 'string' ? prop.type : undefined;
    if (!type) {
      warnings.push({
        code: 'jsonschema.type.unspecified',
        message: `Property ${name} has no explicit type and defaults to string.`,
        lossiness: 'unsupported-feature',
        targetPath: `/definitions/${rootName}/properties/${name}`,
      });
    }
    convertedProperties[name] = {
      type: mapPrimitiveType(type || 'string'),
      ...(typeof prop.description === 'string' ? { description: prop.description } : {}),
    };
    const extraKeys = Object.keys(prop).filter((key) => !['type', 'description'].includes(key));
    if (extraKeys.length > 0) {
      warnings.push({
        code: 'jsonschema.keyword.unsupported',
        message: `Property ${name} uses unsupported JSON Schema keywords: ${extraKeys.join(', ')}.`,
        lossiness: 'metadata',
        targetPath: `/definitions/${rootName}/properties/${name}`,
      });
    }
  }
  const output = {
    $schema: 'https://json-structure.org/meta/core/v0',
    $id: `urn:converted:${sourceName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
    $root: `#/definitions/${rootName}`,
    definitions: {
      [rootName]: {
        type: 'object',
        properties: convertedProperties,
        ...(required.length > 0 ? { required } : {}),
      },
    },
  };
  const files = {};
  if (preview) {
    files['preview.json'] = Buffer.from(JSON.stringify(output, null, 2) + '\n').toString('base64');
  } else {
    files[`${rootName}.struct.json`] = Buffer.from(JSON.stringify(output, null, 2) + '\n').toString('base64');
  }
  return {
    lossiness: warnings.length > 0 ? 'metadata' : 'none',
    warnings,
    files,
  };
}

function convertJsonStructureToJsonSchema(sourceText, _sourceName, _options, preview) {
  const doc = JSON.parse(sourceText);
  const rootRef = typeof doc.$root === 'string' ? doc.$root : '';
  const rootName = rootRef.startsWith('#/definitions/') ? rootRef.slice('#/definitions/'.length) : undefined;
  const definition = rootName && doc.definitions && typeof doc.definitions === 'object' ? doc.definitions[rootName] : undefined;
  const root = definition && typeof definition === 'object' ? definition : {};
  const properties = root.properties && typeof root.properties === 'object' ? root.properties : {};
  const outputProperties = {};
  for (const [name, value] of Object.entries(properties)) {
    const prop = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    outputProperties[name] = {
      type: typeof prop.type === 'string' ? prop.type : 'string',
      ...(typeof prop.description === 'string' ? { description: prop.description } : {}),
    };
  }
  const output = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: outputProperties,
    ...(Array.isArray(root.required) ? { required: root.required.filter((item) => typeof item === 'string') } : {}),
  };
  const files = {};
  files[preview ? 'preview.schema.json' : 'schema.json'] = Buffer.from(JSON.stringify(output, null, 2) + '\n').toString('base64');
  return {
    lossiness: rootName ? 'none' : 'unsupported-feature',
    warnings: rootName ? [] : [{
      code: 'json-structure.root.missing',
      message: 'The source document has no $root; exported a generic object schema.',
      lossiness: 'unsupported-feature',
      targetPath: '/$root',
    }],
    files,
  };
}

function convertAvroToJsonStructure(sourceText, sourceName, options, preview) {
  const doc = JSON.parse(sourceText);
  const rootName = typeof doc.name === 'string' && doc.name.length > 0 ? doc.name : (typeof options.rootName === 'string' && options.rootName.trim() ? options.rootName.trim() : 'Root');
  const fields = Array.isArray(doc.fields) ? doc.fields : [];
  const properties = {};
  const required = [];
  const warnings = [];
  for (const field of fields) {
    if (!field || typeof field !== 'object' || Array.isArray(field) || typeof field.name !== 'string') continue;
    const fieldType = field.type;
    if (Array.isArray(fieldType)) {
      warnings.push({
        code: 'avro.union.coerced',
        message: `Union field ${field.name} is approximated as string in JSON Structure export preview.`,
        lossiness: 'unsupported-feature',
        targetPath: `/definitions/${rootName}/properties/${field.name}`,
      });
    }
    const mapped = typeof fieldType === 'string' ? fieldType : 'string';
    properties[field.name] = { type: mapPrimitiveType(mapped) };
    required.push(field.name);
    if (typeof field.logicalType === 'string') {
      warnings.push({
        code: 'avro.logicalType.metadata',
        message: `Logical type ${field.logicalType} on ${field.name} is preserved as warning metadata only.`,
        lossiness: 'metadata',
        targetPath: `/definitions/${rootName}/properties/${field.name}`,
      });
    }
  }
  const output = {
    $schema: 'https://json-structure.org/meta/core/v0',
    $id: `urn:converted:${sourceName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
    $root: `#/definitions/${rootName}`,
    definitions: {
      [rootName]: {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    },
  };
  return {
    lossiness: warnings.length > 0 ? 'unsupported-feature' : 'none',
    warnings,
    files: {
      [preview ? 'preview.json' : `${rootName}.struct.json`]: Buffer.from(JSON.stringify(output, null, 2) + '\n').toString('base64'),
    },
  };
}

function convertJsonStructureToAvro(sourceText, sourceName, _options, preview) {
  const doc = JSON.parse(sourceText);
  const rootRef = typeof doc.$root === 'string' ? doc.$root : '';
  const rootName = rootRef.startsWith('#/definitions/') ? rootRef.slice('#/definitions/'.length) : sourceName.replace(/\.struct\.json$/i, '') || 'Root';
  const definition = rootName && doc.definitions && typeof doc.definitions === 'object' ? doc.definitions[rootName] : undefined;
  const root = definition && typeof definition === 'object' ? definition : {};
  const properties = root.properties && typeof root.properties === 'object' && !Array.isArray(root.properties) ? root.properties : {};
  const required = Array.isArray(root.required) ? new Set(root.required.filter((item) => typeof item === 'string')) : new Set();
  const warnings = [];
  const fields = Object.entries(properties).map(([name, value]) => {
    const prop = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const type = typeof prop.type === 'string' ? prop.type : 'string';
    const avroType = type === 'integer' ? 'int' : type === 'number' ? 'double' : type === 'boolean' ? 'boolean' : 'string';
    const optional = !required.has(name);
    if (optional) {
      warnings.push({
        code: 'json-structure.optional.field',
        message: `Optional property ${name} exported as nullable Avro union.`,
        lossiness: 'metadata',
        targetPath: `/fields/${name}`,
      });
    }
    return {
      name,
      type: optional ? ['null', avroType] : avroType,
    };
  });
  const output = {
    type: 'record',
    name: rootName || 'Root',
    namespace: 'converted',
    fields,
  };
  return {
    lossiness: warnings.length > 0 ? 'metadata' : 'none',
    warnings,
    files: {
      [preview ? 'preview.avsc' : `${rootName || 'Root'}.avsc`]: Buffer.from(JSON.stringify(output, null, 2) + '\n').toString('base64'),
    },
  };
}

function runConversion(commandId, sourceName, sourceText, options, preview) {
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
  throw new Error(`Unsupported command id: ${commandId}`);
}

let input = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => {
  input += chunk;
});
stdin.on('end', () => {
  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    if (!request || request.type !== 'request') continue;
    const operationId = typeof request.operationId === 'string' ? request.operationId : 'unknown';
    try {
      emit({ type: 'progress', operationId, phase: 'read', completed: 1, total: 3, message: 'Parsing source document.' });
      const source = Buffer.from(String(request.sourceBase64 || ''), 'base64').toString('utf8');
      emit({ type: 'progress', operationId, phase: 'convert', completed: 2, total: 3, message: 'Running conversion workflow.' });
      const result = runConversion(String(request.commandId || ''), String(request.sourceName || 'source.json'), source, request.options && typeof request.options === 'object' ? request.options : {}, Boolean(request.preview));
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
        code: 'conversion.failed',
        message: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    }
  }
});
