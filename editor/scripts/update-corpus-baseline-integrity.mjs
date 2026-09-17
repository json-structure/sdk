import fs from 'node:fs';
import path from 'node:path';
import { canonicalJsonSha256 } from '../src/coverage-contract.mjs';

const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const projectRoot = path.resolve(valueFor('--root') ?? (args[0] && !args[0].startsWith('--') ? args[0] : process.cwd()));
const reviewId = valueFor('--review-id');
const reason = valueFor('--reason');
const approvedBy = valueFor('--approved-by');
const tokenEnvironment = 'JSON_STRUCTURE_BASELINE_UPDATE_TOKEN';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!process.env[tokenEnvironment]) {
  fail(`refusing corpus baseline trust update: ${tokenEnvironment} is required`);
} else if (!reviewId || !reason || !approvedBy) {
  fail('refusing corpus baseline trust update: --review-id, --reason, and --approved-by are required');
} else {
  const baselinePath = path.join(projectRoot, 'coverage', 'corpus-baseline.json');
  const integrityPath = path.join(projectRoot, 'coverage', 'release-integrity.json');
  try {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const current = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
    if (baseline.version !== 1 || current.schemaVersion !== 1 || current.artifact?.path !== 'coverage/corpus-baseline.json' || current.artifact?.canonicalization !== 'json-stable-v1') {
      throw new Error('baseline or trust manifest is malformed');
    }
    const next = {
      ...current,
      artifact: { ...current.artifact, version: baseline.version, sha256: canonicalJsonSha256(baseline) },
      review: { ...current.review, lastApproved: { reviewId, reason, approvedBy } }
    };
    fs.writeFileSync(integrityPath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`updated corpus baseline trust digest for review ${reviewId}`);
  } catch (error) {
    fail(`refusing corpus baseline trust update: ${error instanceof Error ? error.message : String(error)}`);
  }
}
