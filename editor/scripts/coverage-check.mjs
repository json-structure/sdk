import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadCoverageInputs, readJson, validateCoverage } from '../src/coverage-contract.mjs';

const projectRoot = process.cwd();
try {
  const inputs = loadCoverageInputs(projectRoot);
  const ledger = readJson(path.join(projectRoot, 'coverage', 'generated', 'ledger.json'));
  const errors = validateCoverage({ projectRoot, ...inputs, ledger });
  let generationError;
  try {
    execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'generate-coverage.mjs'), '--check', '--artifacts-only'], { cwd: projectRoot, stdio: 'inherit' });
  } catch (error) {
    generationError = error instanceof Error ? 'generated coverage artifacts are stale or malformed' : String(error);
  }
  if (errors.length || generationError) throw new Error([...errors, generationError].filter(Boolean).join('\n'));
  const vitest = path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
  execFileSync(process.execPath, [vitest, 'run', '--config', path.join(projectRoot, 'vitest.config.ts'), path.join(projectRoot, 'tests', 'corpus-acceptance.test.ts')], { cwd: projectRoot, stdio: 'inherit' });
  console.log(`coverage gate passed: ${ledger.features.length} requirement records and real corpus acceptance`);

} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
