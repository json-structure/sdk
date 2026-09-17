import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const providerIds = [
  'bundled.json-structure-units',
  'bundled.ucum',
  'bundled.iso-4217',
  'bundled.qudt-quantity-kinds',
  'bundled.cf-standard-names',
  'bundled.sosa',
  'bundled.schema-org',
  'bundled.dublin-core-terms',
  'bundled.skos-prov-o',
  'bundled.semantic-annotations',
];
const representativeValues = [
  'm/s^2',
  'http://qudt.org/vocab/quantitykind/Length',
  '#air_temperature',
  'http://www.w3.org/ns/sosa/Sensor',
  'https://schema.org/name',
  'http://purl.org/dc/terms/title',
  'http://www.w3.org/ns/prov#wasDerivedFrom',
];

async function electronRendererBundle() {
  const assets = join(process.cwd(), 'dist', 'renderer', 'assets');
  const files = (await readdir(assets)).filter((file) => file.endsWith('.js'));
  if (!files.length) throw new Error('Electron renderer JavaScript assets are missing; run beta:build first.');
  return (await Promise.all(files.map((file) => readFile(join(assets, file), 'utf8')))).join('\n');
}

function assertCatalogs(bundle, artifact) {
  for (const value of [...providerIds, ...representativeValues]) {
    if (!bundle.includes(value)) throw new Error(`${artifact} does not contain offline catalog value: ${value}`);
  }
}

const [electron, vscode] = await Promise.all([
  electronRendererBundle(),
  readFile(join(process.cwd(), '..', 'vscode', 'media', 'editor', 'editor.iife.js'), 'utf8'),
]);
assertCatalogs(electron, 'Electron renderer');
assertCatalogs(vscode, 'VS Code renderer');
console.log(`Verified ${providerIds.length} offline catalog providers in Electron and VS Code renderer artifacts.`);
