import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const vscodeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editorRoot = path.join(vscodeRoot, '..', 'editor');
const platformKey = `${process.platform}-${process.arch}`;
const vsixPath = path.resolve(process.argv[2] || process.env.JSON_STRUCTURE_VSIX_PATH || path.join(vscodeRoot, 'artifacts', 'json-structure-editor.vsix'));
const extractionRoot = path.resolve(process.env.JSON_STRUCTURE_VSIX_SMOKE_ROOT || path.join(vscodeRoot, 'build', 'vsix-runtime-smoke', platformKey));
const extensionRoot = path.join(extractionRoot, 'extension');
const runtimeRoot = path.join(extensionRoot, 'media', 'conversion', 'worker-runtime', 'structurize-runtime');
const workerPath = path.join(extensionRoot, 'media', 'conversion', 'worker-runtime', 'converter-worker.cjs');
const manifestPath = path.join(runtimeRoot, platformKey, 'runtime.json');

function fail(message) {
  throw new Error(`VSIX packaged-runtime smoke failed: ${message}`);
}
function files(directory, root = directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`VSIX contains an unsupported symbolic link: ${path.relative(root, target)}`);
    if (entry.isDirectory()) files(target, root, result);
    else if (entry.isFile()) result.push({ path: path.relative(root, target).split(path.sep).join('/'), file: target, size: statSync(target).size });
  }
  return result;
}
function scanPayload() {
  const credentialPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_+/.=-]{8,}/i;
  const absolutePathPattern = /(?:[A-Za-z]:[\\/](?:Users|build|agent|home|git)[\\/][^\s"']+|\/(?:Users|home|builds|private\/var|workspace)\/[^\s"']+)/i;
  for (const entry of files(extensionRoot)) {
    if (/\.(?:pyc|pyo|pth)$/i.test(entry.path) || /(?:^|\/)node_modules\/\.cache(?:\/|$)|(?:^|\/)(?:builder-debug\.yml|builder-effective-config\.yaml|debug\.log)$/i.test(entry.path)) fail(`VSIX contains a build/debug artifact: ${entry.path}`);
    if (entry.size > 16 * 1024 * 1024 || !/\.(?:css|html|js|json|map|md|mjs|txt|xml|yaml|yml)$/i.test(entry.path)) continue;
    const text = readFileSync(entry.file, 'utf8');
    if (credentialPattern.test(text)) fail(`VSIX contains credential-like material: ${entry.path}`);
    if (absolutePathPattern.test(text)) fail(`VSIX contains an absolute build path: ${entry.path}`);
  }
}
function extract() {
  if (!existsSync(vsixPath)) fail(`VSIX does not exist: ${vsixPath}`);
  mkdirSync(extractionRoot, { recursive: true });
  if (process.platform !== 'win32') {
    execFileSync('unzip', ['-q', '-o', vsixPath, '-d', extractionRoot], { stdio: 'inherit' });
    return;
  }
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const archivePath = path.join(path.dirname(extractionRoot), `vsix-${process.pid}.zip`);
  copyFileSync(vsixPath, archivePath);
  try {
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quote(archivePath)} -DestinationPath ${quote(extractionRoot)} -Force`], { stdio: 'inherit' });
  } finally {
    rmSync(archivePath, { force: true });
  }
}

rmSync(extractionRoot, { recursive: true, force: true });
try {
  extract();
  if (!existsSync(workerPath)) fail(`worker is missing from the final VSIX: ${workerPath}`);
  if (!existsSync(manifestPath)) fail(`runtime.json for ${platformKey} is missing from the final VSIX: ${manifestPath}`);
  scanPayload();
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const extensionManifest = readFileSync(path.join(extractionRoot, 'extension.vsixmanifest'), 'utf8');
  if (!new RegExp(`<Identity[^>]*TargetPlatform=["']${platformKey}["']`, 'i').test(extensionManifest)) fail(`final VSIX is not targeted to ${platformKey}`);
  if (manifest.platform?.key !== platformKey || manifest.executable !== manifest.interpreter?.executable || !Array.isArray(manifest.routes) || manifest.routes.length !== 14) fail('final VSIX runtime metadata is incomplete');
  const environment = { ...process.env, STRUCTURIZE_RUNTIME_BUNDLE_ROOT: runtimeRoot, STRUCTURIZE_WORKER_PATH: workerPath, STRUCTURIZE_SMOKE_WORKSPACE: path.join(extractionRoot, 'semantic-workspace') };
  delete environment.STRUCTURIZE_EXECUTABLE;
  execFileSync(process.execPath, [path.join(editorRoot, 'scripts', 'structurize-runtime-smoke.mjs')], { cwd: editorRoot, env: environment, stdio: 'inherit' });
  const bytes = readFileSync(vsixPath).byteLength;
  console.log(`VSIX final artifact semantic smoke passed: ${vsixPath}, platform=${platformKey}, packageBytes=${bytes}, runtime=${manifest.version}, routes=13 offline + k2s gated`);
} finally {
  rmSync(extractionRoot, { recursive: true, force: true });
}
