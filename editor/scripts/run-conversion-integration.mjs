import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitest = path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
const runtimeRoot = path.join(projectRoot, 'build', 'structurize-runtime');
const runtimeManifest = path.join(runtimeRoot, `${process.platform}-${process.arch}`, 'runtime.json');
if (!existsSync(runtimeManifest)) {
  console.error(`Prepared Structurize runtime not found at ${runtimeManifest}. Run npm run prepare:structurize-runtime first.`);
  process.exit(1);
}
const child = spawn(process.execPath, [vitest, 'run', 'tests/conversion-external-services.test.ts'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    JSON_STRUCTURE_TESTCONTAINERS: '1',
    STRUCTURIZE_ALLOW_RUNTIME_OVERRIDE: '1',
    STRUCTURIZE_RUNTIME_ROOT: runtimeRoot,
  },
  stdio: 'inherit',
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
