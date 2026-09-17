const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const editorRoot = join(__dirname, '..', '..', 'editor');
const cli = join(editorRoot, 'node_modules', 'tsup', 'dist', 'cli-default.js');
const result = spawnSync(process.execPath, [
  cli,
  'src/conversion/types.ts',
  'src/conversion/process.ts',
  'src/libraries/host-runtime.ts',
  'src/host/effective-imports.ts',
  '--format',
  'esm,cjs',
  '--dts',
  '--clean',
], { cwd: editorRoot, stdio: 'inherit' });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
