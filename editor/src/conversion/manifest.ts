import { parseCommandsManifest, type ConversionCommandsManifest } from './types.js';

const structurizeExportCommands = [
  ['s2asn', 'asn1', 'ASN.1', 'file', 'schema.asn'],
  ['s2fbs', 'flatbuffers', 'FlatBuffers', 'file', 'schema.fbs'],
  ['s2k', 'kusto', 'Kusto table schemas', 'file', 'schema.kql'],
  ['s2sql', 'sql', 'SQL schema', 'file', 'schema.sql'],
  ['s2ib', 'iceberg', 'Apache Iceberg schema', 'file', 'schema.iceberg.json'],
  ['s2pq', 'parquet', 'Apache Parquet schema', 'file', 'schema.parquet'],
  ['s2tsml', 'tmsl', 'Tabular Model Scripting Language', 'file', 'schema.tmsl.json'],
  ['s2cs', 'csharp', 'C# classes', 'directory', 'csharp'],
  ['s2py', 'python', 'Python classes', 'directory', 'python'],
  ['s2cpp', 'cpp', 'C++ classes', 'directory', 'cpp'],
  ['s2csv', 'csv-schema', 'CSV schema', 'file', 'schema.csv'],
  ['s2rust', 'rust', 'Rust classes', 'directory', 'rust'],
  ['s2ts', 'typescript', 'TypeScript classes', 'directory', 'typescript'],
  ['s2java', 'java', 'Java classes', 'directory', 'java'],
  ['s2js', 'javascript', 'JavaScript classes', 'directory', 'javascript'],
  ['s2go', 'go', 'Go structs', 'directory', 'go'],
  ['s2graphql', 'graphql', 'GraphQL schema', 'file', 'schema.graphql'],
  ['s2dp', 'data-package', 'Data Package schema', 'file', 'datapackage.json'],
  ['s2cassandra', 'cassandra', 'Apache Cassandra schema', 'file', 'schema.cql'],
  ['s2jtd', 'jtd', 'JSON Type Definition', 'file', 'schema.jtd.json'],
  ['s2x', 'xsd', 'XML Schema', 'file', 'schema.xsd'],
  ['s2cddl', 'cddl', 'CDDL schema', 'file', 'schema.cddl'],
  ['s2md', 'markdown', 'Markdown documentation', 'file', 'schema.md'],
  ['s2cue', 'cue', 'CUE schema', 'file', 'schema.cue'],
  ['s2thrift', 'thrift', 'Apache Thrift IDL', 'file', 'schema.thrift'],
  ['s2smithy', 'smithy', 'Smithy IDL', 'file', 'schema.smithy'],
  ['s2capnp', 'capnp', "Cap'n Proto schema", 'file', 'schema.capnp'],
  ['s2raml', 'raml', 'RAML Data Types', 'file', 'schema.raml'],
] as const;

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
    },
    {
      id: 'structurize-cli',
      displayName: 'Structurize CLI',
      version: 'external',
      sourceFormats: ['json-structure'],
      targetFormats: structurizeExportCommands.map(([, format]) => format),
      options: [
        {
          name: 'dialect',
          type: 'string',
          description: 'SQL dialect used by the s2sql exporter.',
          default: 'postgres',
          allowedValues: ['mysql', 'mariadb', 'postgres', 'sqlserver', 'oracle', 'sqlite', 'bigquery', 'snowflake', 'redshift', 'db2']
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
      optionNames: [],
      cliCommand: 's2j'
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
      optionNames: ['mode', 'uses', 'additional_properties', 'emit_doc'],
      cliCommand: 's2a'
    },
    {
      id: 'export.json-structure.to-protobuf',
      converterId: 'protobuf',
      direction: 'export',
      label: 'Export JSON Structure to Protocol Buffers',
      sourceFormat: 'json-structure',
      targetFormat: 'protobuf',
      defaultAutoOpen: false,
      optionNames: ['uses', 'additional_properties', 'emit_comments', 'numbers'],
      cliCommand: 's2p'
    },
    ...structurizeExportCommands.map(([cliCommand, targetFormat, displayName, outputKind, outputName]) => ({
      id: `export.structurize.${cliCommand}`,
      converterId: 'structurize-cli',
      direction: 'export' as const,
      label: `Export JSON Structure to ${displayName}`,
      sourceFormat: 'json-structure',
      targetFormat,
      defaultAutoOpen: outputKind === 'file',
      optionNames: cliCommand === 's2sql' ? ['dialect'] : [],
      cliCommand,
      outputKind,
      outputName,
    }))
  ]
});

export function cloneBuiltInCommandsManifest(): ConversionCommandsManifest {
  return parseCommandsManifest(JSON.parse(JSON.stringify(BUILTIN_CONVERSION_COMMANDS_MANIFEST)));
}
