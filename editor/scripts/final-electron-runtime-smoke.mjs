import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platformKey = `${process.platform}-${process.arch}`;
const releaseRoot = path.resolve(process.env.JSON_STRUCTURE_ELECTRON_RELEASE_ROOT || path.join(projectRoot, 'release'));
const smokeScript = path.join(projectRoot, 'scripts', 'structurize-runtime-smoke.mjs');

function fail(message) {
  throw new Error(`Final Electron runtime smoke failed: ${message}`);
}
function locateResources() {
  const candidates = process.platform === 'win32'
    ? [path.join(releaseRoot, 'win-unpacked', 'resources')]
    : process.platform === 'linux'
      ? [path.join(releaseRoot, 'linux-unpacked', 'resources')]
      : readdirSync(releaseRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith('mac')).flatMap((entry) => [
          path.join(releaseRoot, entry.name, 'JSON Structure Editor.app', 'Contents', 'Resources'),
        ]);
  const resources = candidates.find((candidate) => existsSync(path.join(candidate, 'conversion', 'worker-runtime', 'converter-worker.cjs')));
  if (!resources) fail(`the unpacked Electron resources were not found below ${releaseRoot}; run electron-builder --dir first`);
  return resources;
}

const resources = locateResources();
const runtimeRoot = path.join(resources, 'conversion', 'worker-runtime', 'structurize-runtime');
const workerPath = path.join(resources, 'conversion', 'worker-runtime', 'converter-worker.cjs');
if (!existsSync(path.join(runtimeRoot, platformKey, 'runtime.json'))) fail(`runtime.json for ${platformKey} is missing from ${runtimeRoot}`);
if (!existsSync(workerPath)) fail(`the packaged worker is missing from ${workerPath}`);
const environment = {
  ...process.env,
  STRUCTURIZE_RUNTIME_BUNDLE_ROOT: runtimeRoot,
  STRUCTURIZE_WORKER_PATH: workerPath,
  STRUCTURIZE_SMOKE_WORKSPACE: path.join(projectRoot, 'build', 'final-electron-runtime-smoke', platformKey),
};
delete environment.STRUCTURIZE_EXECUTABLE;
execFileSync(process.execPath, [smokeScript], { cwd: projectRoot, env: environment, stdio: 'inherit' });
console.log(`Final Electron resources semantic smoke passed: platform=${platformKey}, runtime=${runtimeRoot}`);
