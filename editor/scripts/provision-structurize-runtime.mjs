import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.resolve(process.env.STRUCTURIZE_RUNTIME_LOCK || path.join(projectRoot, 'config', 'structurize-runtime.lock.json'));
const requirementsPath = path.join(projectRoot, 'config', 'structurize-runtime-requirements.txt');
const platformKey = `${process.platform}-${process.arch}`;
const sourceRoot = process.env.STRUCTURIZE_SOURCE_ROOT ? path.resolve(process.env.STRUCTURIZE_SOURCE_ROOT) : undefined;
const python = process.env.STRUCTURIZE_PROVISION_PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3');
const sitePackages = path.resolve(process.env.STRUCTURIZE_SITE_PACKAGES || path.join(projectRoot, 'build', 'structurize-site-packages'));
const wheelhouse = path.resolve(process.env.STRUCTURIZE_WHEELHOUSE || path.join(projectRoot, 'build', 'structurize-wheelhouse'));

function fail(message) {
  console.error(`Structurize dependency provisioning failed: ${message}`);
  process.exit(1);
}
function readJson(file, description) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { fail(`${description} is missing or invalid at ${file}: ${error instanceof Error ? error.message : String(error)}`); }
}
function run(args) {
  try { execFileSync(python, args, { stdio: 'inherit', env: { ...process.env, PIP_NO_INPUT: '1', PYTHONDONTWRITEBYTECODE: '1' } }); }
  catch (error) { fail(`'${python} ${args.join(' ')}' failed: ${error instanceof Error ? error.message : String(error)}`); }
}
function normalized(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

const lock = readJson(lockPath, 'the checked-in runtime lock');
if (lock.schemaVersion !== 1 || !lock.source?.revision || !Array.isArray(lock.packages) || !lock.packages.some((entry) => normalized(entry.name) === 'fastavro')) fail(`runtime lock ${lockPath} is malformed or does not pin fastavro.`);
if (!lock.python?.platforms?.includes(platformKey)) fail(`platform ${platformKey} is not supported by ${lockPath}.`);
if (!existsSync(requirementsPath)) fail(`pinned requirements are missing at ${requirementsPath}.`);
if (!sourceRoot || !existsSync(sourceRoot)) fail('STRUCTURIZE_SOURCE_ROOT must point to the checked-out pinned Avrotize source; the developer-only sibling default is not accepted by provisioning.');
let revision;
try { revision = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
catch (error) { fail(`could not verify the Avrotize checkout revision: ${error instanceof Error ? error.message : String(error)}`); }
if (revision !== lock.source.revision) fail(`Avrotize checkout revision ${revision} does not match ${lock.source.revision}.`);
let pythonVersion;
try { pythonVersion = execFileSync(python, ['--version'], { encoding: 'utf8' }).trim().replace(/^Python\s+/i, ''); }
catch (error) { fail(`could not execute the pinned Python ${python}: ${error instanceof Error ? error.message : String(error)}`); }
if (pythonVersion !== lock.python.patch) fail(`Python ${pythonVersion || 'unknown'} does not match the locked ${lock.python.patch}.`);

if (!existsSync(wheelhouse)) mkdirSync(wheelhouse, { recursive: true });
const missingArtifacts = lock.packages.filter((entry) => !entry.wheels?.[platformKey]?.filename || !existsSync(path.join(wheelhouse, entry.wheels[platformKey].filename)));
if (missingArtifacts.length > 0) {
  if (process.env.STRUCTURIZE_ALLOW_NETWORK !== '1') fail(`pinned artifact cache ${wheelhouse} is incomplete; missing ${missingArtifacts.map((entry) => `${entry.name}==${entry.version}`).join(', ')}. Populate the cache or set STRUCTURIZE_ALLOW_NETWORK=1 explicitly in CI; offline builds do not download dependencies.`);
  run(['-m', 'pip', 'download', '--disable-pip-version-check', '--dest', wheelhouse, '--requirement', requirementsPath]);
  for (const entry of missingArtifacts) {
    const expected = entry.wheels?.[platformKey];
    if (expected?.url && !existsSync(path.join(wheelhouse, expected.filename))) run(['-m', 'pip', 'download', '--disable-pip-version-check', '--no-deps', '--dest', wheelhouse, expected.url]);
  }
}

function artifactDigest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
for (const entry of lock.packages) {
  const expected = entry.wheels?.[platformKey];
  if (!expected?.filename || !expected.sha256 || !expected.url || !['wheel', 'sdist'].includes(expected.kind)) fail(`runtime lock has no complete artifact URL/hash for ${entry.name} on ${platformKey}.`);
  const artifact = path.join(wheelhouse, expected.filename);
  if (!existsSync(artifact)) fail(`cached ${entry.name} artifact ${expected.filename} is missing from ${wheelhouse}.`);
  if (artifactDigest(artifact) !== expected.sha256) fail(`cached ${entry.name} artifact ${expected.filename} does not match the locked SHA-256 ${expected.sha256}.`);
}

rmSync(sitePackages, { recursive: true, force: true });
mkdirSync(sitePackages, { recursive: true });
run(['-m', 'pip', 'install', '--disable-pip-version-check', '--no-index', '--find-links', wheelhouse, '--no-deps', '--no-compile', '--target', sitePackages, ...lock.packages.map((entry) => path.join(wheelhouse, entry.wheels[platformKey].filename))]);

const metadata = new Map();
for (const entry of readdirSync(sitePackages, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue;
  const file = path.join(sitePackages, entry.name, 'METADATA');
  if (!existsSync(file)) continue;
  const content = readFileSync(file, 'utf8');
  const name = content.match(/^Name:\s*(.+)$/mi)?.[1]?.trim();
  const version = content.match(/^Version:\s*(.+)$/mi)?.[1]?.trim();
  if (name && version) metadata.set(normalized(name), version);
}
for (const expected of lock.packages) if (metadata.get(normalized(expected.name)) !== expected.version) fail(`provisioned ${expected.name} does not match the pinned ${expected.version}.`);
console.log(`provisioned ${platformKey} Structurize dependencies into ${sitePackages}; ${lock.packages.length} pinned artifacts, fastavro=${lock.packages.find((entry) => normalized(entry.name) === 'fastavro').wheels[platformKey].sha256}`);
