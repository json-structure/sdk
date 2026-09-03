import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(process.env.STRUCTURIZE_SOURCE_ROOT || path.resolve(projectRoot, '..', '..', 'avrotize'));
const pythonRoot = path.resolve(process.env.STRUCTURIZE_PYTHON_ROOT || path.join(sourceRoot, '.tools', 'python312'));
const outputRoot = path.resolve(process.env.STRUCTURIZE_RUNTIME_OUTPUT || path.join(projectRoot, 'build', 'structurize-runtime'));
const platformKey = `${process.platform}-${process.arch}`;
const runtimeDirectory = path.join(outputRoot, platformKey);
const routeNames = ['fbs2s', 'j2s', 'k2s', 'json2s', 'xml2s', 'a2s', 'jtd2s', 'cddl2s', 'oas2s', 'cue2s', 'thrift2s', 'smithy2s', 'capnp2s', 'raml2s'];

function fail(message) {
  console.error(`Structurize runtime packaging failed: ${message}`);
  process.exit(1);
}

if (platformKey !== 'win32-x64') fail(`this release currently supports win32-x64; got ${platformKey}.`);
if (!existsSync(sourceRoot)) fail(`Avrotize source was not found at ${sourceRoot}. Set STRUCTURIZE_SOURCE_ROOT to an accepted local checkout.`);
if (!existsSync(path.join(sourceRoot, 'avrotize', 'commands.json'))) fail(`Avrotize source at ${sourceRoot} has no avrotize\\commands.json.`);
if (!existsSync(pythonRoot)) fail(`the pinned Python runtime was not found at ${pythonRoot}. Set STRUCTURIZE_PYTHON_ROOT to a local runtime.`);
if (!existsSync(path.join(pythonRoot, 'python.exe'))) fail(`the pinned runtime at ${pythonRoot} has no python.exe.`);
if (!process.argv.includes('--force') && existsSync(path.join(runtimeDirectory, 'runtime.json')) && existsSync(path.join(runtimeDirectory, 'Lib', 'encodings')) && existsSync(path.join(runtimeDirectory, 'avrotize', 'commands.json'))) {
  console.log(`using staged ${platformKey} Structurize runtime at ${runtimeDirectory}; pass --force to rebuild it`);
  process.exit(0);
}

function shouldCopy(sourcePath, rootPath) {
  const name = path.basename(sourcePath);
  if (name === '__pycache__' || name === '.pytest_cache' || name === '.cache') return false;
  if (/\.(?:pyc|pyo)$/i.test(name)) return false;
  const relative = path.relative(rootPath, sourcePath);
  if (relative && relative.split(path.sep).some((part) => part === '__pycache__' || part === '.pytest_cache' || part === '.cache')) return false;
  return true;
}

function copyTree(source, destination) {
  cpSync(source, destination, { recursive: true, filter: (entry) => shouldCopy(entry, source) });
}

function copyIfPresent(relativePath) {
  const source = path.join(pythonRoot, relativePath);
  if (existsSync(source)) copyTree(source, path.join(runtimeDirectory, relativePath));
}

rmSync(runtimeDirectory, { recursive: true, force: true });
mkdirSync(runtimeDirectory, { recursive: true });
for (const entry of ['python.exe', 'python3.dll', 'python312.dll', 'python312.zip', 'vcruntime140.dll', 'vcruntime140_1.dll', 'DLLs', 'Lib']) copyIfPresent(entry);
copyTree(path.join(sourceRoot, 'avrotize'), path.join(runtimeDirectory, 'avrotize'));
if (existsSync(path.join(sourceRoot, 'LICENSE'))) cpSync(path.join(sourceRoot, 'LICENSE'), path.join(runtimeDirectory, 'avrotize.LICENSE'));

function prune(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (['__pycache__', '.pytest_cache', '.cache', 'tests', 'test'].includes(entry.name)) rmSync(target, { recursive: true, force: true });
      else prune(target);
      continue;
    }
    if (/\.exe$/i.test(entry.name) && target !== path.join(runtimeDirectory, 'python.exe')) rmSync(target, { force: true });
    else if (/\.(?:pyc|pyo|pth)$/i.test(entry.name) || entry.name === 'direct_url.json') rmSync(target, { force: true });
  }
}
prune(runtimeDirectory);

function packageMetadata(directory) {
  const packages = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue;
    const metadataPath = path.join(directory, entry.name, 'METADATA');
    if (!existsSync(metadataPath)) continue;
    const metadata = readFileSync(metadataPath, 'utf8');
    const field = (name) => metadata.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || 'UNKNOWN';
    packages.push({ name: field('Name'), version: field('Version'), license: field('License') });
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

const dependencies = packageMetadata(path.join(runtimeDirectory, 'Lib', 'site-packages'));
const notices = [
  'JSON Structure Editor bundled Structurize runtime',
  '',
  'Avrotize is distributed under the MIT License. See avrotize.LICENSE.',
  'CPython is distributed under the Python Software Foundation License. See LICENSE.txt.',
  '',
  'Dependency metadata copied from the bundled wheel/runtime installation:',
  ...dependencies.map((dependency) => `- ${dependency.name} ${dependency.version} (${dependency.license})`),
  '',
  'The corresponding license texts remain in the copied package .dist-info directories where supplied by each distribution.',
  '',
].join('\n');
writeFileSync(path.join(runtimeDirectory, 'THIRD-PARTY-NOTICES.txt'), notices, 'utf8');

function digest(relativePath) {
  const content = readFileSync(path.join(runtimeDirectory, relativePath));
  return createHash('sha256').update(content).digest('hex');
}
const runtimeManifest = {
  schemaVersion: 1,
  kind: 'structurize-runtime',
  implementation: 'avrotize',
  version: (() => {
    const source = readFileSync(path.join(runtimeDirectory, 'avrotize', '_version.py'), 'utf8');
    return source.match(/version\s*=\s*[\'\"]([^\'\"]+)/)?.[1] || 'unknown';
  })(),
  executable: 'python.exe',
  arguments: ['-m', 'avrotize'],
  pythonPath: ['.', 'Lib/site-packages'],
  routes: routeNames,
  licenses: { avrotize: 'MIT', cpython: 'Python Software Foundation License', dependencies: dependencies.length },
  files: [
    { path: 'python.exe', sha256: digest('python.exe') },
    { path: 'python312.dll', sha256: digest('python312.dll') },
    { path: 'avrotize/commands.json', sha256: digest('avrotize/commands.json') },
    { path: 'THIRD-PARTY-NOTICES.txt', sha256: digest('THIRD-PARTY-NOTICES.txt') },
  ],
};
writeFileSync(path.join(runtimeDirectory, 'runtime.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8');

function bytes(directory) {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    total += entry.isDirectory() ? bytes(target) : statSync(target).size;
  }
  return total;
}
console.log(`prepared ${platformKey} Structurize runtime ${runtimeManifest.version}: ${bytes(runtimeDirectory)} bytes, ${dependencies.length} dependency metadata records, ${routeNames.length} routes`);
