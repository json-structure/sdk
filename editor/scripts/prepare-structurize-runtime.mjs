import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = process.env.STRUCTURIZE_SOURCE_ROOT ? path.resolve(process.env.STRUCTURIZE_SOURCE_ROOT) : undefined;
const pythonRoot = path.resolve(process.env.STRUCTURIZE_PYTHON_ROOT || path.join(sourceRoot, '.tools', 'python312'));
const outputRoot = path.resolve(process.env.STRUCTURIZE_RUNTIME_OUTPUT || path.join(projectRoot, 'build', 'structurize-runtime'));
const lockPath = path.resolve(process.env.STRUCTURIZE_RUNTIME_LOCK || path.join(projectRoot, 'config', 'structurize-runtime.lock.json'));
const platformKey = `${process.platform}-${process.arch}`;
const runtimeDirectory = path.join(outputRoot, platformKey);
const routeNames = ['fbs2s', 'j2s', 'json2s', 'xml2s', 'a2s', 'jtd2s', 'cddl2s', 'oas2s', 'cue2s', 'thrift2s', 'smithy2s', 'capnp2s', 'raml2s', 'k2s'];
const exportRouteNames = ['s2asn', 's2fbs', 's2k', 's2sql', 's2ib', 's2pq', 's2tsml', 's2cs', 's2py', 's2cpp', 's2csv', 's2rust', 's2ts', 's2java', 's2js', 's2go', 's2graphql', 's2dp', 's2cassandra', 's2jtd', 's2x', 's2cddl', 's2md', 's2cue', 's2thrift', 's2smithy', 's2capnp', 's2raml'];
const pipelineRouteNames = ['p2a', 'x2a', 'surreal2a', 'pq2a', 'asn2a', 'kstruct2a', 'csv2a', 'sql2a', 'a2mongo', 'a2dynamodb', 'a2es', 'a2couchdb', 'a2neo4j', 'a2firebase', 'a2cosmos', 'a2hbase', 'a2surreal'];
const windows = process.platform === 'win32';

function fail(message) {
  console.error(`Structurize runtime packaging failed: ${message}`);
  process.exit(1);
}

function readJson(file, description) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { fail(`${description} is missing or invalid at ${file}: ${error instanceof Error ? error.message : String(error)}`); }
}

const lock = readJson(lockPath, 'the checked-in Structurize runtime lock');
if (lock.schemaVersion !== 1 || !lock.source || !lock.python || !lock.routes || !Array.isArray(lock.packages) || !Array.isArray(lock.licenseFiles)) fail(`runtime lock ${lockPath} is malformed.`);
if (!Array.isArray(lock.python.platforms) || !lock.python.platforms.includes(platformKey)) fail(`platform ${platformKey} is not in the supported runtime matrix (${lock.python.platforms?.join(', ') || 'none'}). Build on a native runner or add a reviewed runtime artifact.`);
if (lock.source.license !== 'MIT' || lock.python.license !== 'Python Software Foundation License' || typeof lock.python.patch !== 'string' || !/^3\.12\.\d+$/.test(lock.python.patch)) fail('runtime lock has an unexpected Avrotize or CPython version/license policy.');
if (Object.keys(lock.routes).sort().join('|') !== routeNames.slice().sort().join('|')) fail('runtime lock route matrix does not contain exactly the advertised Structurize routes.');
if (!Array.isArray(lock.exportRoutes) || JSON.stringify(lock.exportRoutes) !== JSON.stringify(exportRouteNames)) fail('runtime lock export route matrix does not contain exactly the advertised Structurize exports.');
if (!Array.isArray(lock.pipelineRoutes) || JSON.stringify(lock.pipelineRoutes) !== JSON.stringify(pipelineRouteNames)) fail('runtime lock pipeline route matrix does not contain exactly the advertised Structurize bridges.');
const externalRoute = lock.routes.k2s;
if (externalRoute.kind !== 'external-service' || JSON.stringify(externalRoute.requires) !== JSON.stringify(['kusto_uri', 'kusto_database', 'table_name']) || typeof externalRoute.message !== 'string' || externalRoute.message.length === 0) fail('the k2s external-service gate is incomplete.');

if (!sourceRoot || !existsSync(sourceRoot)) fail('STRUCTURIZE_SOURCE_ROOT must point to the checked-out, pinned Avrotize source; a local sibling checkout is never selected implicitly.');
const sourcePackageRoot = path.join(sourceRoot, 'avrotize');
if (!existsSync(path.join(sourcePackageRoot, 'commands.json'))) fail(`Avrotize source at ${sourceRoot} has no avrotize\\commands.json.`);
if (!existsSync(path.join(sourcePackageRoot, '_version.py'))) fail(`Avrotize source at ${sourceRoot} has no avrotize\\_version.py.`);
const sourceVersionText = readFileSync(path.join(sourcePackageRoot, '_version.py'), 'utf8');
const sourceVersion = sourceVersionText.match(/version\s*=\s*['"]([^'"]+)/)?.[1];
if (!sourceVersion) fail(`Avrotize source at ${sourceRoot} has no readable version.`);
if (sourceVersion !== lock.source.version) fail(`Avrotize source version ${sourceVersion} does not match the locked version ${lock.source.version}.`);

function sourceRevision() {
  if (process.env.STRUCTURIZE_SOURCE_REVISION) return process.env.STRUCTURIZE_SOURCE_REVISION.trim();
  try { return execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch (error) { fail(`the pinned Avrotize revision could not be verified at ${sourceRoot}: ${error instanceof Error ? error.message : String(error)}. Set STRUCTURIZE_SOURCE_REVISION only for an independently verified source archive.`); }
}
const revision = sourceRevision();
if (revision !== lock.source.revision) fail(`Avrotize revision ${revision} does not match the locked revision ${lock.source.revision}.`);

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function sourceEntries(directory, root = directory, entries = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const source = path.join(directory, entry.name);
    if (['.git', '__pycache__', '.pytest_cache', '.cache', 'obj', 'bin'].includes(entry.name)) continue;
    if (entry.isDirectory()) sourceEntries(source, root, entries);
    else if (entry.isFile() && !/\.(?:pyc|pyo)$/i.test(entry.name)) entries.push({ path: path.relative(root, source).split(path.sep).join('/'), sha256: sha256(readFileSync(source)) });
  }
  return entries;
}

function digestEntries(entries) {
  return sha256(entries.slice().sort((left, right) => left.path.localeCompare(right.path)).map((entry) => `${entry.path}\0${entry.sha256}\n`).join(''));
}

const sourceFingerprint = digestEntries(sourceEntries(sourcePackageRoot, sourceRoot));

function isCleanRuntime(directory) {
  if (!existsSync(directory)) return false;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) return false;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && ['__pycache__', '.pytest_cache', '.cache', 'tests', 'test'].includes(entry.name)) return false;
    if (entry.isFile() && /\.(?:pyc|pyo|pth)$/i.test(entry.name)) return false;
    if (entry.isDirectory() && !isCleanRuntime(target)) return false;
  }
  return true;
}

function metadataFromDirectory(directory) {
  const packages = [];
  if (!existsSync(directory)) return packages;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue;
    const metadataPath = path.join(directory, entry.name, 'METADATA');
    if (!existsSync(metadataPath)) continue;
    const metadata = readFileSync(metadataPath, 'utf8');
    const field = (name) => metadata.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || '';
    const license = field('License-Expression') || field('License') || metadata.match(/^Classifier: License :: OSI Approved :: (.+)$/mi)?.[1]?.trim() || '';
    packages.push({ name: field('Name') || entry.name, version: field('Version') || 'UNKNOWN', license });
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

function normalizedPackageName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function packageMetadata(directory) {
  const packages = metadataFromDirectory(directory);
  if (packages.some((dependency) => !dependency.license || dependency.license === 'UNKNOWN')) fail('one or more bundled Python distributions has no license metadata or license classifier.');
  const byName = new Map(packages.map((dependency) => [normalizedPackageName(dependency.name), dependency]));
  for (const expected of lock.packages) {
    const actual = byName.get(normalizedPackageName(expected.name));
    if (!actual) fail(`required Python dependency ${expected.name}==${expected.version} is absent. Provision the locked requirements into the runtime site-packages.`);
    if (actual.version !== expected.version) fail(`required Python dependency ${expected.name} is ${actual.version}, expected the pinned ${expected.version}.`);
  }
  return packages;
}

function findFirst(root, candidates) {
  for (const candidate of candidates) if (existsSync(path.join(root, candidate))) return candidate;
  return undefined;
}

const executableRelative = findFirst(pythonRoot, windows ? ['python.exe'] : ['bin/python3', 'bin/python', 'bin/python3.12']);
if (!executableRelative) fail(`the native Python ${lock.python.version} interpreter was not found below ${pythonRoot}. Set STRUCTURIZE_PYTHON_ROOT to a complete native runtime; PATH is not used.`);
const sharedLibraryRelative = windows
  ? findFirst(pythonRoot, ['python312.dll', 'python3.dll'])
  : existsSync(path.join(pythonRoot, 'lib')) ? sourceEntries(path.join(pythonRoot, 'lib'), pythonRoot).find((entry) => /^lib\/libpython[^/]+\.(?:so(?:\.[0-9.]+)?|dylib)$/i.test(entry.path))?.path : undefined;
if (!sharedLibraryRelative) fail(`the native Python ${lock.python.version} shared library was not found below ${pythonRoot}.`);
const requiredRuntimePaths = [executableRelative, sharedLibraryRelative, 'avrotize/commands.json', 'LICENSE.txt', 'avrotize.LICENSE', 'THIRD-PARTY-NOTICES.txt'];
const executableSource = path.join(pythonRoot, executableRelative);
let interpreterVersion;
try { interpreterVersion = execFileSync(executableSource, ['--version'], { cwd: pythonRoot, encoding: 'utf8' }).trim().replace(/^Python\s+/i, ''); }
catch (error) { fail(`the native Python interpreter at ${executableSource} could not be executed: ${error instanceof Error ? error.message : String(error)}.`); }
if (interpreterVersion !== lock.python.patch) fail(`Python interpreter ${interpreterVersion || 'unknown'} does not match the locked ${lock.python.patch} runtime.`);

const sitePackagesRelative = windows ? 'Lib/site-packages' : (() => {
  const lib = path.join(pythonRoot, 'lib');
  const directory = existsSync(lib) ? readdirSync(lib, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name === `python${lock.python.version}`) : undefined;
  return directory ? `lib/${directory.name}/site-packages` : `lib/python${lock.python.version}/site-packages`;
})();
const defaultOverlaySitePackages = path.join(projectRoot, 'build', 'structurize-site-packages');
const sourceSitePackages = path.resolve(process.env.STRUCTURIZE_SITE_PACKAGES || (existsSync(defaultOverlaySitePackages) ? defaultOverlaySitePackages : path.join(pythonRoot, sitePackagesRelative)));
if (!existsSync(sourceSitePackages)) fail(`Python site-packages were not found at ${sourceSitePackages}. Provision ${lockPath} before packaging.`);
const sitePackagesFingerprint = digestEntries(sourceEntries(sourceSitePackages, sourceSitePackages));

function shouldCopy(source, root) {
  const name = path.basename(source);
  if (['__pycache__', '.pytest_cache', '.cache', 'tests', 'test'].includes(name) || (root === sourcePackageRoot && ['obj', 'bin'].includes(name)) || (root === pythonRoot && name === 'site-packages') || /\.(?:pyc|pyo|pth)$/i.test(name)) return false;
  const relative = path.relative(root, source);
  return !relative || (!relative.split(path.sep).some((part) => ['__pycache__', '.pytest_cache', '.cache', 'tests', 'test'].includes(part)) && !(root === sourcePackageRoot && relative.split(path.sep).some((part) => ['obj', 'bin'].includes(part))) && !(root === pythonRoot && relative.split(path.sep).some((part) => part === 'site-packages')));
}

function copyEntry(source, destination, root = source) {
  if (!shouldCopy(source, root)) return;
  const information = lstatSync(source);
  if (information.isSymbolicLink()) return copyEntry(realpathSync(source), destination, root);
  if (information.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) copyEntry(path.join(source, entry.name), path.join(destination, entry.name), root);
  } else if (information.isFile()) {
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination);
  }
}

function copyIfPresent(relativePath) {
  const source = path.join(pythonRoot, relativePath);
  if (existsSync(source)) copyEntry(source, path.join(runtimeDirectory, relativePath), pythonRoot);
}

function runtimeFiles(directory, root = directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) runtimeFiles(target, root, result);
    else if (entry.isFile()) result.push({ path: path.relative(root, target).split(path.sep).join('/'), sha256: sha256(readFileSync(target)), bytes: statSync(target).size });
  }
  return result;
}

function runtimeTreeDigest(directory) {
  return digestEntries(runtimeFiles(directory).filter((entry) => entry.path !== 'runtime.json'));
}

function requiredFileEntries(directory, relativePaths) {
  return relativePaths.map((file) => {
    const target = path.join(directory, file);
    if (!existsSync(target) || !lstatSync(target).isFile()) fail(`required runtime file is missing: ${file}`);
    const content = readFileSync(target);
    return { path: file, sha256: sha256(content), bytes: content.byteLength };
  });
}

function readStagedManifest() {
  const manifestPath = path.join(runtimeDirectory, 'runtime.json');
  if (!existsSync(manifestPath)) return undefined;
  try { return JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch { return undefined; }
}

function stagedRuntimeIsCurrent(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.kind !== 'structurize-runtime' || manifest.implementation !== 'avrotize') return false;
  if (manifest.version !== sourceVersion || manifest.platform?.key !== platformKey || manifest.platform?.nodePlatform !== process.platform || manifest.platform?.nodeArchitecture !== process.arch) return false;
  if (manifest.source?.repository !== lock.source.repository || manifest.source?.revision !== revision || manifest.source?.fingerprint !== sourceFingerprint || manifest.dependenciesFingerprint !== sitePackagesFingerprint) return false;
  if (manifest.executable !== executableRelative || manifest.interpreter?.executable !== executableRelative || manifest.interpreter?.sharedLibrary !== sharedLibraryRelative || manifest.interpreter?.version !== interpreterVersion) return false;
  if (JSON.stringify(manifest.routes) !== JSON.stringify(routeNames) || manifest.availability?.k2s?.kind !== 'external-service' || JSON.stringify(manifest.availability?.k2s?.requires) !== JSON.stringify(externalRoute.requires) || manifest.availability?.k2s?.message !== externalRoute.message) return false;
  if (JSON.stringify(manifest.exportRoutes) !== JSON.stringify(exportRouteNames)) return false;
  if (JSON.stringify(manifest.pipelineRoutes) !== JSON.stringify(pipelineRouteNames)) return false;
  if (!Array.isArray(manifest.requiredFiles) || !Array.isArray(manifest.dependencies) || !isCleanRuntime(runtimeDirectory)) return false;
  if (!Array.isArray(manifest.files) || JSON.stringify(manifest.files) !== JSON.stringify(manifest.requiredFiles)) return false;
  if (manifest.requiredFiles.map((file) => file.path).sort().join('|') !== requiredRuntimePaths.slice().sort().join('|')) return false;
  if (!manifest.licenses || manifest.licenses.avrotize !== lock.source.license || manifest.licenses.cpython !== lock.python.license || manifest.licenses.dependencies !== manifest.dependencies.length) return false;
  if (manifest.tree?.sha256 !== runtimeTreeDigest(runtimeDirectory) || manifest.tree?.fileCount !== runtimeFiles(runtimeDirectory).filter((entry) => entry.path !== 'runtime.json').length) return false;
  for (const file of manifest.requiredFiles) {
    const target = path.join(runtimeDirectory, file.path);
    if (!existsSync(target) || sha256(readFileSync(target)) !== file.sha256) return false;
  }
  const metadata = metadataFromDirectory(path.join(runtimeDirectory, sitePackagesRelative));
  return metadata.every((entry) => entry.license && entry.license !== 'UNKNOWN') && JSON.stringify(metadata) === JSON.stringify(manifest.dependencies) && lock.packages.every((entry) => metadata.some((actual) => normalizedPackageName(actual.name) === normalizedPackageName(entry.name) && actual.version === entry.version));
}

const stagedManifest = readStagedManifest();
if (!process.argv.includes('--force') && stagedRuntimeIsCurrent(stagedManifest)) {
  const bytes = runtimeFiles(runtimeDirectory).reduce((total, entry) => total + entry.bytes, 0);
  console.log(`using validated ${platformKey} Structurize runtime ${sourceVersion} at ${runtimeDirectory}; ${bytes} bytes, ${stagedManifest.dependencies.length} dependency records, ${routeNames.length} routes; pass --force to rebuild it`);
  process.exit(0);
}

rmSync(runtimeDirectory, { recursive: true, force: true });
mkdirSync(runtimeDirectory, { recursive: true });
const pythonEntries = windows ? ['python.exe', 'python3.dll', 'python312.dll', 'python312.zip', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt', 'DLLs', 'Lib'] : ['bin', 'lib', 'lib64', 'share', 'LICENSE.txt'];
for (const entry of pythonEntries) copyIfPresent(entry);
copyEntry(sourcePackageRoot, path.join(runtimeDirectory, 'avrotize'), sourcePackageRoot);
const sourceLicense = path.join(sourceRoot, 'LICENSE');
if (!existsSync(sourceLicense)) fail(`Avrotize source license is missing at ${sourceLicense}.`);
cpSync(sourceLicense, path.join(runtimeDirectory, 'avrotize.LICENSE'));
const overlaySitePackages = path.join(runtimeDirectory, sitePackagesRelative);
copyEntry(sourceSitePackages, overlaySitePackages, sourceSitePackages);
if (!existsSync(overlaySitePackages)) fail(`runtime site-packages was not staged at ${overlaySitePackages}.`);

function normalizeAvrotizeMetadata() {
  const candidates = readdirSync(overlaySitePackages, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.endsWith('.dist-info') && existsSync(path.join(overlaySitePackages, entry.name, 'METADATA'))).filter((entry) => /^Name:\s*avrotize$/mi.test(readFileSync(path.join(overlaySitePackages, entry.name, 'METADATA'), 'utf8')));
  if (candidates.length > 1) fail('the pinned runtime contains multiple Avrotize distributions.');
  if (candidates.length === 0) return;
  const current = candidates[0].name;
  const target = `avrotize-${sourceVersion}.dist-info`;
  const currentDirectory = path.join(overlaySitePackages, current);
  const targetDirectory = path.join(overlaySitePackages, target);
  if (current !== target) {
    rmSync(targetDirectory, { recursive: true, force: true });
    renameSync(currentDirectory, targetDirectory);
  }
  const metadataPath = path.join(targetDirectory, 'METADATA');
  writeFileSync(metadataPath, readFileSync(metadataPath, 'utf8').replace(/^Version:\s*.+$/mi, `Version: ${sourceVersion}`), 'utf8');
  rmSync(path.join(targetDirectory, 'RECORD'), { force: true });
}
normalizeAvrotizeMetadata();

function prune(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (['__pycache__', '.pytest_cache', '.cache', 'tests', 'test'].includes(entry.name)) rmSync(target, { recursive: true, force: true });
      else prune(target);
    } else if ((windows && /\.exe$/i.test(entry.name) && target !== path.join(runtimeDirectory, 'python.exe')) || /\.(?:pyc|pyo|pth)$/i.test(entry.name) || entry.name === 'direct_url.json') rmSync(target, { force: true });
  }
}
prune(runtimeDirectory);
const dependencies = packageMetadata(overlaySitePackages);
const notices = [
  'JSON Structure Editor bundled Structurize runtime',
  '',
  'Avrotize is distributed under the MIT License. See avrotize.LICENSE.',
  'CPython is distributed under the Python Software Foundation License. See LICENSE.txt.',
  '',
  'Pinned Python dependency inventory (name, version, declared license):',
  ...dependencies.map((dependency) => `- ${dependency.name} ${dependency.version} (${dependency.license})`),
  '',
  'License identifiers are copied from each distribution METADATA file.',
  'The corresponding license files remain in the copied package .dist-info directories where supplied.',
  '',
].join('\n');
writeFileSync(path.join(runtimeDirectory, 'THIRD-PARTY-NOTICES.txt'), notices, 'utf8');
for (const licenseFile of lock.licenseFiles) if (!existsSync(path.join(runtimeDirectory, licenseFile))) fail(`required runtime license or notice file is missing: ${licenseFile}`);
const requiredFiles = requiredFileEntries(runtimeDirectory, requiredRuntimePaths);
const runtimeManifest = {
  schemaVersion: 1,
  kind: 'structurize-runtime',
  implementation: 'avrotize',
  version: sourceVersion,
  platform: { key: platformKey, nodePlatform: process.platform, nodeArchitecture: process.arch },
  source: { repository: lock.source.repository, revision, fingerprint: sourceFingerprint },
  executable: executableRelative,
  arguments: ['-m', 'avrotize'],
  pythonPath: ['.', sitePackagesRelative],
  interpreter: { executable: executableRelative, version: interpreterVersion, sharedLibrary: sharedLibraryRelative },
  routes: routeNames,
  exportRoutes: exportRouteNames,
  pipelineRoutes: pipelineRouteNames,
  availability: { k2s: { kind: externalRoute.kind, requires: externalRoute.requires, message: externalRoute.message } },
  licenses: { avrotize: lock.source.license, cpython: lock.python.license, dependencies: dependencies.length, dependencyLicenses: dependencies.map(({ name, version, license }) => ({ name, version, license })) },
  dependencies,
  dependenciesFingerprint: sitePackagesFingerprint,
  requiredFiles,
  files: requiredFiles,
  tree: { fileCount: runtimeFiles(runtimeDirectory).filter((entry) => entry.path !== 'runtime.json').length, sha256: runtimeTreeDigest(runtimeDirectory) },
};
writeFileSync(path.join(runtimeDirectory, 'runtime.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8');
const bytes = runtimeFiles(runtimeDirectory).reduce((total, entry) => total + entry.bytes, 0);
console.log(`prepared ${platformKey} Structurize runtime ${runtimeManifest.version}: ${bytes} bytes, ${dependencies.length} dependency metadata records, ${routeNames.length} routes; source=${revision}`);
