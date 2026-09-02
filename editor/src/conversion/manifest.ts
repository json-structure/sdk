import { parseCommandsManifest, type ConversionCommandsManifest } from './types.js';

export const BUILTIN_CONVERSION_COMMANDS_MANIFEST: ConversionCommandsManifest = parseCommandsManifest({
  schemaVersion: 1,
  converters: [
    {
      id: 'jsonschema',
      displayName: 'JSON Schema Converter',
      version: '1.0.0-node',
      sourceFormats: ['json-schema', 'json'],
      targetFormats: ['json-structure'],
      options: [
        {
          name: 'rootName',
          type: 'string',
          description: 'Root declaration name used for imported anonymous schemas.',
          default: 'Root'
        },
        {
          name: 'preserveUnknownKeywords',
          type: 'boolean',
          description: 'Preserve unsupported JSON Schema keywords as x-json-schema-* annotations.',
          default: false
        }
      ]
    },
    {
      id: 'avro',
      displayName: 'Avro Converter',
      version: '1.0.0-node',
      sourceFormats: ['avro', 'json'],
      targetFormats: ['json-structure'],
      options: [
        {
          name: 'rootName',
          type: 'string',
          description: 'Root declaration name for unnamed Avro schemas.',
          default: 'Root'
        },
        {
          name: 'preserveLogicalType',
          type: 'boolean',
          description: 'Carry Avro logicalType metadata into conversion warnings.',
          default: true
        },
        {
          name: 'mode',
          type: 'string',
          description: 'Emit compact wire metadata or the full normative annotation set.',
          default: 'compact',
          allowedValues: ['compact', 'full']
        },
        {
          name: 'uses',
          type: 'string-list',
          description: 'Ordered add-in names selected from the document $offers map.',
          default: []
        },
        {
          name: 'additional_properties',
          type: 'string',
          description: 'Ignore open records with a warning or reject them during Avro export.',
          default: 'ignore',
          allowedValues: ['ignore', 'error']
        },
        {
          name: 'emit_doc',
          type: 'boolean',
          description: 'Emit Avro doc attributes from JSON Structure descriptions.',
          default: true
        }
      ]
    },
    {
      id: 'protobuf',
      displayName: 'Protocol Buffers Generator',
      version: '1.0.0-node',
      sourceFormats: ['json-structure'],
      targetFormats: ['protobuf'],
      options: [
        {
          name: 'uses',
          type: 'string-list',
          description: 'Ordered add-in names selected from the document $offers map.',
          default: []
        },
        {
          name: 'additional_properties',
          type: 'string',
          description: 'Ignore open records with a warning or reject them during Protobuf export.',
          default: 'ignore',
          allowedValues: ['ignore', 'error']
        },
        {
          name: 'emit_comments',
          type: 'boolean',
          description: 'Emit leading comments from JSON Structure descriptions and defaults.',
          default: true
        },
        {
          name: 'numbers',
          type: 'string',
          description: 'Optional version 2 field-number lock as JSON.',
          default: ''
        }
      ]
    }
  ],
  commands: [
    {
      id: 'import.jsonschema.to-json-structure',
      converterId: 'jsonschema',
      direction: 'import',
      label: 'Import JSON Schema to JSON Structure',
      sourceFormat: 'json-schema',
      targetFormat: 'json-structure',
      defaultAutoOpen: true,
      optionNames: ['rootName', 'preserveUnknownKeywords']
    },
    {
      id: 'export.json-structure.to-jsonschema',
      converterId: 'jsonschema',
      direction: 'export',
      label: 'Export JSON Structure to JSON Schema',
      sourceFormat: 'json-structure',
      targetFormat: 'json-schema',
      defaultAutoOpen: true,
      optionNames: []
    },
    {
      id: 'import.avro.to-json-structure',
      converterId: 'avro',
      direction: 'import',
      label: 'Import Avro to JSON Structure',
      sourceFormat: 'avro',
      targetFormat: 'json-structure',
      defaultAutoOpen: true,
      optionNames: ['rootName', 'preserveLogicalType']
    },
    {
      id: 'export.json-structure.to-avro',
      converterId: 'avro',
      direction: 'export',
      label: 'Export JSON Structure to Avro',
      sourceFormat: 'json-structure',
      targetFormat: 'avro',
      defaultAutoOpen: true,
      optionNames: ['mode', 'uses', 'additional_properties', 'emit_doc']
    },
    {
      id: 'export.json-structure.to-protobuf',
      converterId: 'protobuf',
      direction: 'export',
      label: 'Export JSON Structure to Protocol Buffers',
      sourceFormat: 'json-structure',
      targetFormat: 'protobuf',
      defaultAutoOpen: false,
      optionNames: ['uses', 'additional_properties', 'emit_comments', 'numbers']
    }
  ]
});

export function cloneBuiltInCommandsManifest(): ConversionCommandsManifest {
  return parseCommandsManifest(JSON.parse(JSON.stringify(BUILTIN_CONVERSION_COMMANDS_MANIFEST)));
}
