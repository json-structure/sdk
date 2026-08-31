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
      defaultAutoOpen: true
    },
    {
      id: 'export.json-structure.to-jsonschema',
      converterId: 'jsonschema',
      direction: 'export',
      label: 'Export JSON Structure to JSON Schema',
      sourceFormat: 'json-structure',
      targetFormat: 'json-schema',
      defaultAutoOpen: true
    },
    {
      id: 'import.avro.to-json-structure',
      converterId: 'avro',
      direction: 'import',
      label: 'Import Avro to JSON Structure',
      sourceFormat: 'avro',
      targetFormat: 'json-structure',
      defaultAutoOpen: true
    },
    {
      id: 'export.json-structure.to-avro',
      converterId: 'avro',
      direction: 'export',
      label: 'Export JSON Structure to Avro',
      sourceFormat: 'json-structure',
      targetFormat: 'avro',
      defaultAutoOpen: true
    }
  ]
});

export function cloneBuiltInCommandsManifest(): ConversionCommandsManifest {
  return parseCommandsManifest(JSON.parse(JSON.stringify(BUILTIN_CONVERSION_COMMANDS_MANIFEST)));
}
