import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platformKey = `${process.platform}-${process.arch}`;
const runtimeRoot = path.join(projectRoot, 'build', 'structurize-runtime', platformKey);
const manifestPath = path.join(runtimeRoot, 'runtime.json');
const routes = ['fbs2s', 'j2s', 'k2s', 'json2s', 'xml2s', 'a2s', 'jtd2s', 'cddl2s', 'oas2s', 'cue2s', 'thrift2s', 'smithy2s', 'capnp2s', 'raml2s'];

if (!existsSync(manifestPath)) throw new Error(`No staged Structurize runtime for ${platformKey}; run npm run prepare:structurize-runtime first.`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.kind !== 'structurize-runtime' || manifest.implementation !== 'avrotize' || manifest.executable !== 'python.exe' || JSON.stringify(manifest.routes) !== JSON.stringify(routes)) throw new Error('Staged Structurize runtime manifest is missing the complete 14-route contract.');
const executable = path.join(runtimeRoot, manifest.executable);
if (!existsSync(executable)) throw new Error(`Staged Structurize executable is missing: ${executable}`);
const environment = {
  ...process.env,
  PATH: '',
  Path: '',
  PATHEXT: '',
  PYTHONHOME: runtimeRoot,
  PYTHONPATH: [runtimeRoot, path.join(runtimeRoot, 'Lib', 'site-packages')].join(path.delimiter),
};
delete environment.STRUCTURIZE_EXECUTABLE;
environment.STRUCTURIZE_RUNTIME_ROOT = path.join(projectRoot, 'build', 'structurize-runtime');
function runWorker(request) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [path.join(projectRoot, 'src', 'conversion', 'worker-runtime', 'converter-worker.cjs')], { cwd: projectRoot, env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let errorOutput = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errorOutput += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      const result = output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find((event) => event.type === 'result');
      if (result) resolvePromise(result);
      else reject(new Error(`Packaged worker smoke failed with exit code ${String(code)}: ${errorOutput.trim() || output.trim()}`));
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}
delete environment.STRUCTURIZE_EXECUTABLE;
environment.STRUCTURIZE_RUNTIME_ROOT = path.join(projectRoot, 'build', 'structurize-runtime');
const run = (args) => execFileAsync(executable, [...manifest.arguments, ...args], { cwd: runtimeRoot, env: environment, windowsHide: true, maxBuffer: 1024 * 1024 });

for (const route of routes) await run([route, '--help']);
const workspace = mkdtempSync(path.join(tmpdir(), 'json-structure-structurize-smoke-'));
try {
  const jsonSchema = path.join(workspace, 'schema.json');
  const jsonOutput = path.join(workspace, 'schema.struct.json');
  writeFileSync(jsonSchema, JSON.stringify({ title: 'Smoke', type: 'object', properties: { id: { type: 'string' } } }), 'utf8');
  await run(['j2s', jsonSchema, '--out', jsonOutput]);
  if (!existsSync(jsonOutput)) throw new Error('Structurize j2s smoke route produced no output.');

  const avroSchema = path.join(workspace, 'schema.avsc');
  const avroOutput = path.join(workspace, 'avro.struct.json');
  writeFileSync(avroSchema, JSON.stringify({ type: 'record', name: 'Smoke', fields: [{ name: 'id', type: 'string' }] }), 'utf8');
  await run(['a2s', avroSchema, '--out', avroOutput]);
  if (!existsSync(avroOutput)) throw new Error('Structurize a2s smoke route produced no output.');
  const workerResult = await runWorker({ type: 'request', requestId: 'runtime-smoke', operationId: 'runtime-smoke', commandId: 'import.structurize.j2s', sourceName: 'schema.json', sourceBase64: Buffer.from(readFileSync(jsonSchema)).toString('base64'), options: {}, preview: true });
  if (!Array.isArray(workerResult.files) || workerResult.files.length === 0) throw new Error('Packaged worker smoke route produced no files.');
  console.log(`Structurize clean-PATH smoke passed: ${routes.length} routes, j2s and a2s executed directly and through the packaged worker, executable=${path.relative(projectRoot, executable).replaceAll(path.sep, '/')}, bytes=${readFileSync(executable).byteLength}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
