const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export const STRUCTURIZE_OFFLINE_ROUTES = Object.freeze([
  'fbs2s',
  'j2s',
  'json2s',
  'xml2s',
  'a2s',
  'jtd2s',
  'cddl2s',
  'oas2s',
  'cue2s',
  'thrift2s',
  'smithy2s',
  'capnp2s',
  'raml2s',
]);

export const STRUCTURIZE_ROUTES = Object.freeze([...STRUCTURIZE_OFFLINE_ROUTES, 'k2s']);
export const STRUCTURIZE_PIPELINE_ROUTES = Object.freeze([
  'p2a', 'x2a', 'surreal2a', 'pq2a', 'asn2a', 'kstruct2a', 'csv2a', 'sql2a',
  'a2mongo', 'a2dynamodb', 'a2es', 'a2couchdb', 'a2neo4j', 'a2firebase', 'a2cosmos', 'a2hbase', 'a2surreal',
]);

export const STRUCTURIZE_FIXTURES = Object.freeze([
  {
    route: 'fbs2s',
    sourceName: 'person.fbs',
    source: `namespace Example;\ntable Person { id:string (required); age:int = 1; }\nroot_type Person;\n`,
  },
  {
    route: 'j2s',
    sourceName: 'person.schema.json',
    source: json({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/person.schema.json',
      title: 'Person',
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, age: { type: 'integer', minimum: 0 } },
    }),
  },
  {
    route: 'json2s',
    sourceName: 'person.json',
    source: json({ id: 'person-1', age: 42, active: true }),
  },
  {
    route: 'xml2s',
    sourceName: 'person.xml',
    source: '<Person><id>person-1</id><age>42</age><active>true</active></Person>\n',
  },
  {
    route: 'a2s',
    sourceName: 'person.avsc',
    source: json({
      type: 'record',
      name: 'Person',
      fields: [{ name: 'id', type: 'string' }, { name: 'age', type: 'int' }],
    }),
  },
  {
    route: 'jtd2s',
    sourceName: 'person.jtd.json',
    source: json({
      definitions: { Address: { properties: { street: { type: 'string' } } } },
      properties: { id: { type: 'string' }, address: { ref: 'Address' } },
      optionalProperties: { age: { type: 'uint32' } },
    }),
  },
  {
    route: 'cddl2s',
    sourceName: 'person.cddl',
    source: 'person = { id: tstr, age: uint, active: bool }\n',
  },
  {
    route: 'oas2s',
    sourceName: 'person.openapi.json',
    source: json({
      openapi: '3.0.3',
      info: { title: 'Person API', version: '1.0.0' },
      paths: {},
      components: { schemas: { Person: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, age: { type: 'integer' } } } } },
    }),
  },
  {
    route: 'cue2s',
    sourceName: 'person.cue',
    source: 'package example\n\n#Person: { id: string, age?: int, active: bool }\n',
  },
  {
    route: 'thrift2s',
    sourceName: 'person.thrift',
    source: 'namespace * example\nstruct Person { 1: required string id, 2: optional i32 age }\n',
  },
  {
    route: 'smithy2s',
    sourceName: 'person.smithy',
    source: '$version: "2.0"\nnamespace example\nstructure Person {\n    @required\n    id: String\n    age: Integer\n}\n',
  },
  {
    route: 'capnp2s',
    sourceName: 'person.capnp',
    source: '@0xbf5147a1d903c2f0;\nstruct Person { id @0 :Text; age @1 :UInt32; }\n',
  },
  {
    route: 'raml2s',
    sourceName: 'person.raml',
    source: '#%RAML 1.0 Library\ntypes:\n  Person:\n    type: object\n    properties:\n      id: string\n      age?: integer\n',
  },
]);

export const STRUCTURIZE_KUSTO_GATE = Object.freeze({
  route: 'k2s',
  sourceName: 'person.kusto',
  source: '{}\n',
  options: {},
  message: 'Kusto import requires a configured cluster URI, database, and table; local file conversion is not supported.',
});

export const STRUCTURIZE_BRIDGE_FIXTURES = Object.freeze([
  { commandId: 'export.json-structure.to-protobuf', outputExtension: '.proto', sourceName: 'person.struct.json' },
  { commandId: 'export.structurize.s2x', outputExtension: '.xsd', sourceName: 'person.struct.json' },
  { commandId: 'export.structurize.s2sql', outputExtension: '.sql', sourceName: 'person.struct.json' },
  { commandId: 'export.structurize.s2ib', outputName: 'schema.iceberg.json', sourceName: 'person.struct.json', binary: true },
  { commandId: 'export.structurize.s2pq', outputName: 'schema.parquet', sourceName: 'person.struct.json', binary: true },
  { commandId: 'export.structurize.s2dp', outputName: 'datapackage.json', sourceName: 'person.struct.json', dataPackage: true },
]);

export const STRUCTURIZE_EXPORT_FIXTURES = Object.freeze([
  { commandId: 'export.structurize.s2asn', outputName: 'schema.asn' },
  { commandId: 'export.structurize.s2fbs', outputName: 'schema.fbs' },
  { commandId: 'export.structurize.s2k', outputName: 'schema.kql' },
  { commandId: 'export.structurize.s2sql', outputName: 'schema.sql', options: { dialect: 'sqlite' } },
  { commandId: 'export.structurize.s2ib', outputName: 'schema.iceberg.json', binary: true },
  { commandId: 'export.structurize.s2pq', outputName: 'schema.parquet', binary: true },
  { commandId: 'export.structurize.s2tsml', outputName: 'schema.tmsl.json' },
  { commandId: 'export.structurize.s2cs', directory: true },
  { commandId: 'export.structurize.s2py', directory: true },
  { commandId: 'export.structurize.s2cpp', directory: true },
  { commandId: 'export.structurize.s2csv', outputName: 'schema.csv' },
  { commandId: 'export.structurize.s2rust', directory: true },
  { commandId: 'export.structurize.s2ts', directory: true },
  { commandId: 'export.structurize.s2java', directory: true },
  { commandId: 'export.structurize.s2js', directory: true },
  { commandId: 'export.structurize.s2go', directory: true },
  { commandId: 'export.structurize.s2graphql', outputName: 'schema.graphql' },
  { commandId: 'export.structurize.s2dp', outputName: 'datapackage.json', dataPackage: true },
  { commandId: 'export.structurize.s2cassandra', outputName: 'schema.cql' },
  { commandId: 'export.structurize.s2jtd', outputName: 'schema.jtd.json' },
  { commandId: 'export.structurize.s2x', outputName: 'schema.xsd' },
  { commandId: 'export.structurize.s2cddl', outputName: 'schema.cddl' },
  { commandId: 'export.structurize.s2md', outputName: 'schema.md' },
  { commandId: 'export.structurize.s2cue', outputName: 'schema.cue' },
  { commandId: 'export.structurize.s2thrift', outputName: 'schema.thrift' },
  { commandId: 'export.structurize.s2smithy', outputName: 'schema.smithy' },
  { commandId: 'export.structurize.s2capnp', outputName: 'schema.capnp' },
  { commandId: 'export.structurize.s2raml', outputName: 'schema.raml' },
]);

export const STRUCTURIZE_BRIDGE_SOURCE = json({
  $schema: 'https://json-structure.org/meta/core/v0/#',
  $id: 'https://example.com/person',
  name: 'Person',
  type: 'object',
  properties: { id: { type: 'string' }, age: { type: 'int32' } },
  required: ['id'],
});

export function commandIdForRoute(route) {
  return `import.structurize.${route}`;
}

export function parseMeaningfulJsonStructure(content, context) {
  let document;
  try {
    document = JSON.parse(Buffer.from(content).toString('utf8'));
  } catch (error) {
    throw new Error(`${context} did not produce valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error(`${context} did not produce a JSON Structure object.`);
  if (typeof document.$schema !== 'string' || !document.$schema.startsWith('https://json-structure.org/meta/')) throw new Error(`${context} did not identify a JSON Structure schema.`);
  const named = typeof document.name === 'string' && document.name.length > 0;
  const rooted = typeof document.$root === 'string' && document.$root.startsWith('#/');
  const typed = typeof document.type === 'string';
  const definitions = document.definitions && typeof document.definitions === 'object' && !Array.isArray(document.definitions) && Object.keys(document.definitions).length > 0;
  const properties = document.properties && typeof document.properties === 'object' && !Array.isArray(document.properties) && Object.keys(document.properties).length > 0;
  if ((!named && !(rooted && definitions)) || (!rooted && !typed) || (!definitions && !properties && !typed)) throw new Error(`${context} was valid JSON but not a meaningful JSON Structure document.`);
  return document;
}
