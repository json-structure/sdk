import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadCoverageInputs, readJson, validateCoverage } from '../src/coverage-contract.mjs';

const projectRoot = process.cwd();
try {
  const inputs = loadCoverageInputs(projectRoot);
  const ledger = readJson(path.join(projectRoot, 'coverage', 'generated', 'ledger.json'));
  const errors = validateCoverage({ projectRoot, ...inputs, ledger });
  if (errors.length) throw new Error(errors.join('\n'));
  execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'generate-coverage.mjs'), '--check'], { stdio: 'inherit' });
  console.log(`coverage gate passed: ${ledger.features.length} requirement records`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
