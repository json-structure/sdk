// Font Awesome Free 7.3.1 icons are bundled into the editor build.
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faGolang, faJava, faJs, faMarkdown, faMicrosoft, faPython, faRust } from '@fortawesome/free-brands-svg-icons';
import { faCode, faCubes, faDatabase, faDiagramProject, faFeatherPointed, faFileCode, faFileCsv, faSnowflake, faTableColumns } from '@fortawesome/free-solid-svg-icons';

const formatIcons: Readonly<Record<string, IconDefinition>> = {
  asn1: faFileCode,
  avro: faFeatherPointed,
  capnp: faCubes,
  cassandra: faDatabase,
  cddl: faFileCode,
  cpp: faCode,
  csharp: faMicrosoft,
  csv: faFileCsv,
  'csv-schema': faFileCsv,
  cue: faCode,
  'data-package': faCubes,
  flatbuffers: faCubes,
  go: faGolang,
  graphql: faDiagramProject,
  iceberg: faSnowflake,
  java: faJava,
  javascript: faJs,
  'json-schema': faFileCode,
  jtd: faFileCode,
  kusto: faDatabase,
  markdown: faMarkdown,
  parquet: faTableColumns,
  protobuf: faDiagramProject,
  python: faPython,
  raml: faFileCode,
  rust: faRust,
  smithy: faCubes,
  sql: faDatabase,
  thrift: faDiagramProject,
  tmsl: faMicrosoft,
  typescript: faCode,
  xsd: faFileCode,
};

export function technologyIcon(format: string): string {
  const definition = formatIcons[format] ?? faFileCode;
  const [width, height, , , pathData] = definition.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  return `<svg class="js-technology-icon" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${paths.map((path) => `<path d="${path}"></path>`).join('')}</svg>`;
}
