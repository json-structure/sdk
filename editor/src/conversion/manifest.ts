import { parseCommandsManifest, type ConversionCommandsManifest } from './types.js';

interface StructurizeImportCommand {
  readonly cliCommand: string;
  readonly sourceFormat: string;
  readonly displayName: string;
  readonly sourceExtensions: readonly string[];
  readonly options: readonly string[];
  readonly availability?: 'external-service';
  readonly availabilityMessage?: string;
  readonly availabilityRequirements?: readonly string[];
}

interface StructurizeBridgeCommand {
  readonly id: string;
  readonly direction: 'import' | 'export';
  readonly label: string;
  readonly sourceFormat: string;
  readonly targetFormat: string;
  readonly sourceExtensions?: readonly string[];
  readonly outputName: string;
  readonly outputKind?: 'file' | 'directory';
  readonly optionNames: readonly string[];
  readonly firstCommand: string;
  readonly firstOptions: readonly string[];
  readonly secondCommand: string;
  readonly secondOptions: readonly string[];
  readonly availability?: 'external-service';
  readonly availabilityMessage?: string;
  readonly availabilityRequirements?: readonly string[];
}

const structurizeImportCommands: readonly StructurizeImportCommand[] = [
  { cliCommand: 'fbs2s', sourceFormat: 'flatbuffers', displayName: 'FlatBuffers', sourceExtensions: ['.fbs'], options: ['namespace'] },
  { cliCommand: 'j2s', sourceFormat: 'json-schema', displayName: 'JSON Schema', sourceExtensions: ['.json', '.jsons'], options: ['namespace', 'root_class_name'] },
  { cliCommand: 'k2s', sourceFormat: 'kusto', displayName: 'Kusto', sourceExtensions: ['.kusto'], options: ['kusto_uri', 'kusto_database', 'table_name', 'base_id', 'emit_cloudevents', 'emit_xregistry', 'sample_size', 'infer_choices', 'choice_depth', 'infer_enums'], availability: 'external-service', availabilityMessage: 'Kusto import requires a configured cluster URI, database, and table; local file conversion is not supported.', availabilityRequirements: ['kusto_uri', 'kusto_database', 'table_name'] },
  { cliCommand: 'json2s', sourceFormat: 'json', displayName: 'JSON data', sourceExtensions: ['.json', '.jsonl', '.ndjson'], options: ['type_name', 'base_id', 'sample_size', 'infer_choices', 'choice_depth', 'infer_enums'] },
  { cliCommand: 'xml2s', sourceFormat: 'xml', displayName: 'XML data', sourceExtensions: ['.xml'], options: ['type_name', 'base_id', 'sample_size'] },
  { cliCommand: 'a2s', sourceFormat: 'avro', displayName: 'Avro', sourceExtensions: ['.avsc'], options: ['naming', 'avro_encoding'] },
  { cliCommand: 'jtd2s', sourceFormat: 'jtd', displayName: 'JSON Type Definition', sourceExtensions: ['.jtd.json', '.jtd'], options: ['namespace'] },
  { cliCommand: 'cddl2s', sourceFormat: 'cddl', displayName: 'CDDL', sourceExtensions: ['.cddl'], options: ['namespace'] },
  { cliCommand: 'oas2s', sourceFormat: 'openapi', displayName: 'OpenAPI', sourceExtensions: ['.yaml', '.yml', '.json'], options: ['namespace', 'preserve_composition', 'detect_discriminators', 'lift_inline_schemas'] },
  { cliCommand: 'cue2s', sourceFormat: 'cue', displayName: 'CUE', sourceExtensions: ['.cue'], options: ['namespace'] },
  { cliCommand: 'thrift2s', sourceFormat: 'thrift', displayName: 'Apache Thrift', sourceExtensions: ['.thrift'], options: ['namespace'] },
  { cliCommand: 'smithy2s', sourceFormat: 'smithy', displayName: 'Smithy', sourceExtensions: ['.smithy'], options: ['namespace'] },
  { cliCommand: 'capnp2s', sourceFormat: 'capnp', displayName: "Cap'n Proto", sourceExtensions: ['.capnp'], options: ['namespace', 'naming', 'avro_encoding'] },
  { cliCommand: 'raml2s', sourceFormat: 'raml', displayName: 'RAML', sourceExtensions: ['.raml'], options: ['namespace'] },
];

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

const structurizeBridgeCommands: readonly StructurizeBridgeCommand[] = [
  { id: 'import.structurize.p2s', direction: 'import', label: 'Import Protocol Buffers to JSON Structure', sourceFormat: 'protobuf', targetFormat: 'json-structure', sourceExtensions: ['.proto'], outputName: 'schema.struct.json', optionNames: ['namespace', 'message_type', 'proto_root', 'naming', 'avro_encoding'], firstCommand: 'p2a', firstOptions: ['namespace', 'message_type', 'proto_root'], secondCommand: 'a2s', secondOptions: ['naming', 'avro_encoding'] },
  { id: 'import.structurize.x2s', direction: 'import', label: 'Import XML Schema to JSON Structure', sourceFormat: 'xsd', targetFormat: 'json-structure', sourceExtensions: ['.xsd'], outputName: 'schema.struct.json', optionNames: ['namespace', 'naming', 'avro_encoding'], firstCommand: 'x2a', firstOptions: ['namespace'], secondCommand: 'a2s', secondOptions: ['naming', 'avro_encoding'] },
  { id: 'import.structurize.surreal2s', direction: 'import', label: 'Import SurrealQL to JSON Structure', sourceFormat: 'surrealql', targetFormat: 'json-structure', sourceExtensions: ['.surql', '.surrealql'], outputName: 'schema.struct.json', optionNames: ['namespace', 'naming', 'avro_encoding'], firstCommand: 'surreal2a', firstOptions: ['namespace'], secondCommand: 'a2s', secondOptions: ['naming', 'avro_encoding'] },
  { id: 'import.structurize.pq2s', direction: 'import', label: 'Import Apache Parquet to JSON Structure', sourceFormat: 'parquet', targetFormat: 'json-structure', sourceExtensions: ['.parquet'], outputName: 'schema.struct.json', optionNames: ['namespace', 'naming', 'avro_encoding'], firstCommand: 'pq2a', firstOptions: ['namespace'], secondCommand: 'a2s', secondOptions: ['naming', 'avro_encoding'] },
  { id: 'import.structurize.asn2s', direction: 'import', label: 'Import ASN.1 to JSON Structure', sourceFormat: 'asn1', targetFormat: 'json-structure', sourceExtensions: ['.asn1'], outputName: 'schema.struct.json', optionNames: ['naming', 'avro_encoding'], firstCommand: 'asn2a', firstOptions: [], secondCommand: 'a2s', secondOptions: ['naming', 'avro_encoding'] },
  { id: 'import.structurize.kstruct2s', direction: 'import', label: 'Import Kafka Struct to JSON Structure', sourceFormat: 'kafka-struct', targetFormat: 'json-structure', sourceExtensions: ['.kstruct'], outputName: 'schema.struct.json', optionNames: ['naming', 'avro_encoding'], firstCommand: 'kstruct2a', firstOptions: [], secondCommand: 'a2s', secondOptions: ['naming', 'avro_encoding'] },
  { id: 'import.structurize.csv2s', direction: 'import', label: 'Import CSV data to JSON Structure', sourceFormat: 'csv', targetFormat: 'json-structure', sourceExtensions: ['.csv'], outputName: 'schema.struct.json', optionNames: ['namespace', 'naming', 'avro_encoding'], firstCommand: 'csv2a', firstOptions: ['namespace'], secondCommand: 'a2s', secondOptions: ['naming', 'avro_encoding'] },
  { id: 'import.structurize.sql2s', direction: 'import', label: 'Import SQL database to JSON Structure', sourceFormat: 'sql-database', targetFormat: 'json-structure', outputName: 'schema.struct.json', optionNames: ['connection_string', 'username', 'password', 'database', 'table_name', 'namespace', 'dialect', 'emit_cloudevents', 'sample_size', 'infer_json', 'infer_xml', 'infer_choices', 'naming', 'avro_encoding'], firstCommand: 'sql2a', firstOptions: ['connection_string', 'username', 'password', 'database', 'table_name', 'namespace', 'dialect', 'emit_cloudevents', 'sample_size', 'infer_json', 'infer_xml', 'infer_choices'], secondCommand: 'a2s', secondOptions: ['naming', 'avro_encoding'], availability: 'external-service', availabilityMessage: 'SQL import requires a database connection string; local file conversion is not supported.', availabilityRequirements: ['connection_string'] },
  { id: 'export.structurize.s2mongo', direction: 'export', label: 'Export JSON Structure to MongoDB schema', sourceFormat: 'json-structure', targetFormat: 'mongodb', outputName: 'mongodb', outputKind: 'directory', optionNames: ['emit_cloudevents_columns'], firstCommand: 's2a', firstOptions: [], secondCommand: 'a2mongo', secondOptions: ['emit_cloudevents_columns'] },
  { id: 'export.structurize.s2dynamodb', direction: 'export', label: 'Export JSON Structure to DynamoDB schema', sourceFormat: 'json-structure', targetFormat: 'dynamodb', outputName: 'dynamodb', outputKind: 'directory', optionNames: ['emit_cloudevents_columns'], firstCommand: 's2a', firstOptions: [], secondCommand: 'a2dynamodb', secondOptions: ['emit_cloudevents_columns'] },
  { id: 'export.structurize.s2es', direction: 'export', label: 'Export JSON Structure to Elasticsearch schema', sourceFormat: 'json-structure', targetFormat: 'elasticsearch', outputName: 'elasticsearch', outputKind: 'directory', optionNames: ['emit_cloudevents_columns'], firstCommand: 's2a', firstOptions: [], secondCommand: 'a2es', secondOptions: ['emit_cloudevents_columns'] },
  { id: 'export.structurize.s2couchdb', direction: 'export', label: 'Export JSON Structure to CouchDB schema', sourceFormat: 'json-structure', targetFormat: 'couchdb', outputName: 'couchdb', outputKind: 'directory', optionNames: ['emit_cloudevents_columns'], firstCommand: 's2a', firstOptions: [], secondCommand: 'a2couchdb', secondOptions: ['emit_cloudevents_columns'] },
  { id: 'export.structurize.s2neo4j', direction: 'export', label: 'Export JSON Structure to Neo4j schema', sourceFormat: 'json-structure', targetFormat: 'neo4j', outputName: 'neo4j', outputKind: 'directory', optionNames: ['emit_cloudevents_columns'], firstCommand: 's2a', firstOptions: [], secondCommand: 'a2neo4j', secondOptions: ['emit_cloudevents_columns'] },
  { id: 'export.structurize.s2firebase', direction: 'export', label: 'Export JSON Structure to Firebase schema', sourceFormat: 'json-structure', targetFormat: 'firebase', outputName: 'firebase', outputKind: 'directory', optionNames: ['emit_cloudevents_columns'], firstCommand: 's2a', firstOptions: [], secondCommand: 'a2firebase', secondOptions: ['emit_cloudevents_columns'] },
  { id: 'export.structurize.s2cosmos', direction: 'export', label: 'Export JSON Structure to Cosmos DB schema', sourceFormat: 'json-structure', targetFormat: 'cosmosdb', outputName: 'cosmosdb', outputKind: 'directory', optionNames: ['emit_cloudevents_columns'], firstCommand: 's2a', firstOptions: [], secondCommand: 'a2cosmos', secondOptions: ['emit_cloudevents_columns'] },
  { id: 'export.structurize.s2hbase', direction: 'export', label: 'Export JSON Structure to HBase schema', sourceFormat: 'json-structure', targetFormat: 'hbase', outputName: 'hbase', outputKind: 'directory', optionNames: ['emit_cloudevents_columns'], firstCommand: 's2a', firstOptions: [], secondCommand: 'a2hbase', secondOptions: ['emit_cloudevents_columns'] },
  { id: 'export.structurize.s2surreal', direction: 'export', label: 'Export JSON Structure to SurrealQL schema', sourceFormat: 'json-structure', targetFormat: 'surrealql', outputName: 'schema.surql', optionNames: ['record_type'], firstCommand: 's2a', firstOptions: [], secondCommand: 'a2surreal', secondOptions: ['record_type'] },
];

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
      sourceFormats: ['json-structure', ...structurizeImportCommands.map((item) => item.sourceFormat), ...structurizeBridgeCommands.filter((item) => item.direction === 'import').map((item) => item.sourceFormat)],
      targetFormats: [...structurizeExportCommands.map(([, format]) => format), ...structurizeBridgeCommands.filter((item) => item.direction === 'export').map((item) => item.targetFormat), 'json-structure'],
      options: [
        { name: 'dialect', type: 'string', description: 'SQL dialect used by the s2sql exporter.', default: 'postgres', allowedValues: ['mysql', 'mariadb', 'postgres', 'sqlserver', 'oracle', 'sqlite', 'bigquery', 'snowflake', 'redshift', 'db2'] },
        { name: 'namespace', type: 'string', description: 'Namespace for generated declarations.', default: '' },
        { name: 'root_class_name', type: 'string', description: 'Root class name used by the j2s converter.', default: 'document' },
        { name: 'type_name', type: 'string', description: 'Root type name used by inference converters.', default: 'Document' },
        { name: 'base_id', type: 'string', description: 'Base URI used for inferred schema identity.', default: 'https://example.com/' },
        { name: 'sample_size', type: 'number', description: 'Maximum number of samples (0 means all).', default: 0, minimum: 0, maximum: 100000 },
        { name: 'choice_depth', type: 'number', description: 'Maximum nested choice inference depth.', default: 1, minimum: 1, maximum: 64 },
        { name: 'infer_choices', type: 'boolean', description: 'Infer discriminated choices from samples.', default: false },
        { name: 'infer_enums', type: 'boolean', description: 'Infer enums from repeated values.', default: false },
        { name: 'preserve_composition', type: 'boolean', description: 'Preserve composition keywords where supported.', default: false },
        { name: 'detect_inheritance', type: 'boolean', description: 'Detect inheritance patterns in JSON Schema.', default: true },
        { name: 'detect_discriminators', type: 'boolean', description: 'Detect discriminator patterns.', default: true },
        { name: 'lift_inline_schemas', type: 'boolean', description: 'Lift inline OpenAPI schemas into definitions.', default: false },
        { name: 'convert_empty_objects_to_maps', type: 'boolean', description: 'Convert empty JSON Schema objects to maps.', default: true },
        { name: 'naming', type: 'string', description: 'Type naming convention.', default: 'default', allowedValues: ['snake', 'camel', 'pascal', 'default'] },
        { name: 'avro_encoding', type: 'boolean', description: 'Enable Avro encoding for unions.', default: false },
        { name: 'kusto_uri', type: 'string', description: 'Kusto cluster URI.', default: '' },
        { name: 'kusto_database', type: 'string', description: 'Kusto database name.', default: '' },
        { name: 'table_name', type: 'string', description: 'Kusto table name.', default: '' },
        { name: 'emit_cloudevents', type: 'boolean', description: 'Emit CloudEvents declarations.', default: false },
        { name: 'emit_xregistry', type: 'boolean', description: 'Emit an xRegistry manifest.', default: false },
        { name: 'message_type', type: 'string', description: 'Protocol Buffers message selected as the imported root.', default: '' },
        { name: 'proto_root', type: 'string', description: 'Root directory used to resolve Protocol Buffers imports.', default: '' },
        { name: 'connection_string', type: 'string', description: 'Database connection string used for SQL schema import.', default: '' },
        { name: 'username', type: 'string', description: 'Optional database user name.', default: '' },
        { name: 'password', type: 'string', description: 'Optional database password.', default: '' },
        { name: 'database', type: 'string', description: 'Optional database name.', default: '' },
        { name: 'infer_json', type: 'boolean', description: 'Infer structures stored in JSON columns.', default: false },
        { name: 'infer_xml', type: 'boolean', description: 'Infer structures stored in XML columns.', default: false },
        { name: 'emit_cloudevents_columns', type: 'boolean', description: 'Include CloudEvents metadata columns in generated database schemas.', default: false },
        { name: 'record_type', type: 'string', description: 'SurrealQL record type used for generated declarations.', default: '' },
      ]
    }
  ],
  commands: [
    ...structurizeImportCommands.map((item) => ({
      id: `import.structurize.${item.cliCommand}`,
      converterId: 'structurize-cli',
      direction: 'import' as const,
      label: `Import ${item.displayName} to JSON Structure`,
      sourceFormat: item.sourceFormat,
      targetFormat: 'json-structure',
      defaultAutoOpen: true,
      optionNames: item.options,
      cliCommand: item.cliCommand,
      outputKind: 'file' as const,
      outputName: 'schema.struct.json',
      sourceExtensions: item.sourceExtensions,
      ...(item.availability ? { availability: item.availability, availabilityMessage: item.availabilityMessage } : {}),
      ...(item.availabilityRequirements ? { availabilityRequirements: item.availabilityRequirements } : {}),
    })),
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
    ...structurizeBridgeCommands.map((item) => ({
      id: item.id,
      converterId: 'structurize-cli',
      direction: item.direction,
      label: item.label,
      sourceFormat: item.sourceFormat,
      targetFormat: item.targetFormat,
      defaultAutoOpen: item.direction === 'import' || item.outputKind !== 'directory',
      optionNames: item.optionNames,
      outputKind: item.outputKind ?? 'file',
      outputName: item.outputName,
      sourceExtensions: item.sourceExtensions,
      cliPipeline: [
        { cliCommand: item.firstCommand, outputKind: 'file' as const, outputName: 'schema.avsc', optionNames: item.firstOptions },
        { cliCommand: item.secondCommand, outputKind: item.outputKind ?? 'file', outputName: item.outputName, optionNames: item.secondOptions },
      ],
      ...(item.availability ? { availability: item.availability, availabilityMessage: item.availabilityMessage } : {}),
      ...(item.availabilityRequirements ? { availabilityRequirements: item.availabilityRequirements } : {}),
    })),
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
