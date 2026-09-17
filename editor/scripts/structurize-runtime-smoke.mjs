import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  STRUCTURIZE_BRIDGE_FIXTURES,
  STRUCTURIZE_BRIDGE_SOURCE,
  STRUCTURIZE_FIXTURES,
  STRUCTURIZE_KUSTO_GATE,
  STRUCTURIZE_OFFLINE_ROUTES,
  STRUCTURIZE_PIPELINE_ROUTES,
  STRUCTURIZE_EXPORT_FIXTURES,
  STRUCTURIZE_ROUTES,
  commandIdForRoute,
  parseMeaningfulJsonStructure,
} from './structurize-fixtures.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platformKey = `${process.platform}-${process.arch}`;
const runtimeBundleRoot = path.resolve(process.env.STRUCTURIZE_RUNTIME_BUNDLE_ROOT || path.join(projectRoot, 'build', 'structurize-runtime'));
const configuredRuntimeRoot = process.env.STRUCTURIZE_RUNTIME_DIRECTORY ? path.resolve(process.env.STRUCTURIZE_RUNTIME_DIRECTORY) : undefined;
const runtimeRoot = configuredRuntimeRoot || path.join(runtimeBundleRoot, platformKey);
const manifestPath = path.join(runtimeRoot, 'runtime.json');
const smokeRoot = path.resolve(process.env.STRUCTURIZE_SMOKE_WORKSPACE || path.join(projectRoot, 'build', 'structurize-runtime-smoke', platformKey));
const workerPath = process.env.STRUCTURIZE_WORKER_PATH || path.join(projectRoot, 'src', 'conversion', 'worker-runtime', 'converter-worker.cjs');

function fail(message) {
  throw new Error(`Structurize packaged-runtime smoke failed: ${message}`);
}
function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
function safeRuntimePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) fail(`runtime manifest contains an unsafe path: ${String(relativePath)}`);
}
function loadManifest() {
  if (!existsSync(manifestPath)) fail(`no staged runtime for ${platformKey} at ${runtimeRoot}; run the pinned provisioning and prepare steps first`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch (error) { fail(`runtime manifest is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'structurize-runtime' || manifest.implementation !== 'avrotize') fail('runtime manifest kind is invalid');
  if (manifest.platform?.key !== platformKey || manifest.platform?.nodePlatform !== process.platform || manifest.platform?.nodeArchitecture !== process.arch) fail(`runtime manifest platform does not match ${platformKey}`);
  if (manifest.executable !== manifest.interpreter?.executable || manifest.interpreter?.version?.split('.').slice(0, 2).join('.') !== '3.12') fail('runtime manifest interpreter metadata is incomplete');
  if (typeof manifest.source?.revision !== 'string' || !/^[a-f0-9]{40}$/i.test(manifest.source.revision) || !/^[a-f0-9]{64}$/i.test(manifest.source.fingerprint) || !/^[a-f0-9]{64}$/i.test(manifest.dependenciesFingerprint)) fail('runtime source/dependency fingerprint metadata is incomplete');
  safeRuntimePath(manifest.executable);
  if (!existsSync(path.join(runtimeRoot, manifest.executable))) fail(`runtime interpreter is missing: ${manifest.executable}`);
  if (!Array.isArray(manifest.pythonPath) || !manifest.pythonPath.every((entry) => typeof entry === 'string')) fail('runtime manifest PYTHONPATH metadata is incomplete');
  if (!Array.isArray(manifest.routes) || JSON.stringify(manifest.routes) !== JSON.stringify(STRUCTURIZE_ROUTES)) fail('runtime manifest is missing the complete 14-route contract');
  if (!Array.isArray(manifest.exportRoutes) || JSON.stringify(manifest.exportRoutes) !== JSON.stringify(STRUCTURIZE_EXPORT_FIXTURES.map((fixture) => fixture.commandId.replace('export.structurize.', '')))) fail('runtime manifest is missing the complete Structurize export contract');
  if (!Array.isArray(manifest.pipelineRoutes) || JSON.stringify(manifest.pipelineRoutes) !== JSON.stringify(STRUCTURIZE_PIPELINE_ROUTES)) fail('runtime manifest is missing the complete Structurize pipeline contract');
  if (manifest.availability?.k2s?.kind !== 'external-service' || JSON.stringify(manifest.availability?.k2s?.requires) !== JSON.stringify(['kusto_uri', 'kusto_database', 'table_name'])) fail('k2s availability metadata is incomplete');
  if (manifest.licenses?.avrotize !== 'MIT' || manifest.licenses?.cpython !== 'Python Software Foundation License' || !Array.isArray(manifest.dependencies)) fail('runtime license metadata is incomplete');
  if (!Array.isArray(manifest.requiredFiles) || manifest.requiredFiles.length < 6) fail('runtime required-file digest metadata is incomplete');
  if (['avrotize/commands.json', 'LICENSE.txt', 'avrotize.LICENSE', 'THIRD-PARTY-NOTICES.txt', manifest.executable, manifest.interpreter.sharedLibrary].some((required) => !manifest.requiredFiles.some((entry) => entry.path === required))) fail('runtime required-file digest metadata omits a critical file');
  for (const entry of manifest.requiredFiles) {
    safeRuntimePath(entry.path);
    const file = path.join(runtimeRoot, entry.path);
    if (!existsSync(file) || digest(file) !== entry.sha256) fail(`runtime integrity check failed for ${entry.path}`);
  }
  return manifest;
}
const manifest = loadManifest();
const executable = path.join(runtimeRoot, manifest.executable);
const environment = {
  ...process.env,
  PATH: '',
  Path: '',
  PATHEXT: '',
  PYTHONHOME: runtimeRoot,
  PYTHONPATH: manifest.pythonPath.map((entry) => path.join(runtimeRoot, entry)).join(path.delimiter),
  PYTHONDONTWRITEBYTECODE: '1',
};
delete environment.STRUCTURIZE_EXECUTABLE;

async function runCli(args) {
  return execFileAsync(executable, [...manifest.arguments, ...args], { cwd: runtimeRoot, env: environment, windowsHide: true, maxBuffer: 1024 * 1024 });
}

function workerResult(request) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [workerPath], { cwd: projectRoot, env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let errorOutput = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errorOutput += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      const events = output.split(/\r?\n/).filter(Boolean).map((line) => {
        try { return JSON.parse(line); }
        catch (error) { throw new Error(`worker emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
      });
      const result = events.find((event) => event.type === 'result' || event.type === 'error');
      if (result && (code === 0 || result.type === 'error')) resolvePromise(result);
      else if (result) reject(new Error(`worker emitted a result with exit code ${String(code)}: ${errorOutput.trim() || output.trim()}`));
      else reject(new Error(`worker exited with code ${String(code)}: ${errorOutput.trim() || output.trim()}`));
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function assertWorkerJsonStructure(result, context) {
  if (result.type !== 'result' || !Array.isArray(result.files) || result.files.length === 0) fail(`${context} did not return generated files: ${result.message || result.type}`);
  for (const file of result.files) parseMeaningfulJsonStructure(Buffer.from(file.contentBase64, 'base64'), `${context}/${file.path}`);
}

function assertBridgeResult(result, fixture) {
  if (result.type !== 'result' || !Array.isArray(result.files) || result.files.length === 0) fail(`${fixture.commandId} did not return a bridge artifact: ${result.message || result.type}`);
  const file = fixture.outputName ? result.files.find((entry) => entry.path === fixture.outputName) : result.files.find((entry) => entry.path.toLowerCase().endsWith(fixture.outputExtension));
  if (!file) fail(`${fixture.commandId} returned no ${fixture.outputName || fixture.outputExtension} artifact`);
  const bytes = Buffer.from(file.contentBase64, 'base64');
  if (fixture.binary) {
    if (bytes.byteLength < 64) fail(`${fixture.commandId} returned an empty binary bridge artifact`);
    return;
  }
  const text = bytes.toString('utf8');
  if (text.trim().length < 20) fail(`${fixture.commandId} returned an empty bridge artifact`);
  if (fixture.outputExtension === '.proto' && !/message\s+Person\s*\{/i.test(text)) fail('Proto bridge output was not semantic');
  if (fixture.outputExtension === '.xsd' && !/<[^>]*schema/i.test(text)) fail('XSD bridge output was not semantic');
  if (fixture.outputExtension === '.sql' && !/create\s+table/i.test(text)) fail('SQL bridge output was not semantic');
  if (fixture.dataPackage) {
    let packageDocument;
    try { packageDocument = JSON.parse(text); } catch (error) { fail(`DataPackage bridge output was not JSON: ${error instanceof Error ? error.message : String(error)}`); }
    if (packageDocument?.profile !== 'data-package' || !Array.isArray(packageDocument.resources) || packageDocument.resources.length === 0) fail('DataPackage bridge output was not semantic');
  }
}


function assertExportResult(result, fixture) {
  if (result.type !== 'result' || !Array.isArray(result.files) || result.files.length === 0) fail(`${fixture.commandId} did not return generated files: ${result.message || result.type}`);
  if (fixture.directory) {
    if (result.files.some((file) => Buffer.from(file.contentBase64, 'base64').byteLength < 8)) fail(`${fixture.commandId} returned an empty generated file`);
    return;
  }
  const file = result.files.find((entry) => entry.path === fixture.outputName);
  if (!file) fail(`${fixture.commandId} returned no ${fixture.outputName} artifact`);
  const bytes = Buffer.from(file.contentBase64, 'base64');
  if (fixture.binary) {
    if (bytes.byteLength < 64) fail(`${fixture.commandId} returned an empty binary artifact`);
    return;
  }
  if (bytes.toString('utf8').trim().length < 20) fail(`${fixture.commandId} returned an empty text artifact`);
}
rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(smokeRoot, { recursive: true });
try {
  const direct = [];
  for (const fixture of STRUCTURIZE_FIXTURES) {
    const directory = path.join(smokeRoot, 'cli', fixture.route);
    mkdirSync(directory, { recursive: true });
    const inputPath = path.join(directory, fixture.sourceName);
    const outputPath = path.join(directory, 'schema.struct.json');
    writeFileSync(inputPath, fixture.source, 'utf8');
    await runCli([fixture.route, inputPath, '--out', outputPath]);
    if (!existsSync(outputPath)) fail(`${fixture.route} CLI produced no output`);
    parseMeaningfulJsonStructure(readFileSync(outputPath), `${fixture.route} CLI`);
    direct.push(fixture.route);
  }

  const worker = [];
  for (const fixture of STRUCTURIZE_FIXTURES) {
    const result = await workerResult({ type: 'request', requestId: `runtime-smoke-${fixture.route}`, operationId: `runtime-smoke-${fixture.route}`, commandId: commandIdForRoute(fixture.route), sourceName: fixture.sourceName, sourceBase64: Buffer.from(fixture.source).toString('base64'), options: fixture.options || {}, preview: true });
    assertWorkerJsonStructure(result, `${fixture.route} worker`);
    worker.push(fixture.route);
  }

  const gated = await workerResult({ type: 'request', requestId: 'runtime-smoke-k2s', operationId: 'runtime-smoke-k2s', commandId: commandIdForRoute(STRUCTURIZE_KUSTO_GATE.route), sourceName: STRUCTURIZE_KUSTO_GATE.sourceName, sourceBase64: Buffer.from(STRUCTURIZE_KUSTO_GATE.source).toString('base64'), options: STRUCTURIZE_KUSTO_GATE.options, preview: true });
  if (gated.type !== 'error' || gated.code !== 'conversion.failed' || gated.message !== STRUCTURIZE_KUSTO_GATE.message) fail(`k2s was not precisely availability-gated: ${gated.message || gated.type}`);

  for (const fixture of STRUCTURIZE_BRIDGE_FIXTURES) {
    const result = await workerResult({ type: 'request', requestId: `runtime-smoke-${fixture.commandId}`, operationId: `runtime-smoke-${fixture.commandId}`, commandId: fixture.commandId, sourceName: fixture.sourceName, sourceBase64: Buffer.from(STRUCTURIZE_BRIDGE_SOURCE).toString('base64'), options: fixture.commandId.endsWith('s2sql') ? { dialect: 'sqlite' } : {}, preview: true });
    assertBridgeResult(result, fixture);
  }
  const bridgeCommands = new Set(STRUCTURIZE_BRIDGE_FIXTURES.map((fixture) => fixture.commandId));
  const exports = STRUCTURIZE_EXPORT_FIXTURES.filter((fixture) => !bridgeCommands.has(fixture.commandId));
  for (const fixture of exports) {
    const result = await workerResult({ type: 'request', requestId: `runtime-smoke-${fixture.commandId}`, operationId: `runtime-smoke-${fixture.commandId}`, commandId: fixture.commandId, sourceName: fixture.sourceName || 'person.struct.json', sourceBase64: Buffer.from(STRUCTURIZE_BRIDGE_SOURCE).toString('base64'), options: fixture.options || {}, preview: true });
    assertExportResult(result, fixture);
  }
  console.log(`Structurize clean-PATH semantic smoke passed: direct=${direct.length}/${STRUCTURIZE_OFFLINE_ROUTES.length}, worker=${worker.length}/${STRUCTURIZE_OFFLINE_ROUTES.length}, exports=${STRUCTURIZE_EXPORT_FIXTURES.length}/${STRUCTURIZE_EXPORT_FIXTURES.length}, k2s=GATED(${STRUCTURIZE_KUSTO_GATE.message}), bridges=proto/xsd/sql/iceberg/parquet/datapackage, platform=${platformKey}, runtimeBytes=${readFileSync(executable).byteLength}`);
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
