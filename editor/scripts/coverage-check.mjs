import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const ledgerPath = path.join(root, 'coverage', 'ledger.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const allowed = new Set(['complete', 'partial', 'gap', 'unsupported', 'pending']);
const dimensions = ['editing', 'inspection', 'diagnostics', 'roundtrip', 'tests'];
const aggregatePatterns = [/^scalars?$/i, /^arrays?,?\s*maps?,?\s*tuples?$/i, /^annotations?$/i, /^forms?$/i, /^metadata$/i, /^identity,?\s*target/i, /^operators?$/i, /^placements?$/i];
const errors = [];
if (!Array.isArray(ledger.features)) errors.push('features must be an array');
const ids = new Set();
for (const feature of ledger.features ?? []) {
  if (!feature.id || ids.has(feature.id)) errors.push(`duplicate or missing feature ID: ${feature.id ?? '<missing>'}`);
  ids.add(feature.id);
  for (const field of ['spec', 'feature', 'owner', 'status']) if (typeof feature[field] !== 'string' || !feature[field]) errors.push(`${feature.id}: missing ${field}`);
  if (!allowed.has(feature.status)) errors.push(`${feature.id}: invalid status`);
  if (aggregatePatterns.some((pattern) => pattern.test(feature.id ?? '') || pattern.test(feature.feature ?? ''))) errors.push(`${feature.id}: aggregate feature records are not permitted`);
  for (const dimension of dimensions) {
    const evidence = feature.evidence?.[dimension];
    if (!evidence || typeof evidence.status !== 'string' || typeof evidence.reference !== 'string' || !evidence.reference) errors.push(`${feature.id}: malformed ${dimension} evidence`);
    if (evidence && !allowed.has(evidence.status)) errors.push(`${feature.id}: invalid ${dimension} evidence status`);
    if (evidence?.reference && evidence.reference.startsWith('coverage/')) {
      const evidencePath = path.join(root, evidence.reference);
      if (!fs.existsSync(evidencePath)) errors.push(`${feature.id}: missing evidence path ${evidence.reference}`);
    } else if (evidence?.reference && !evidence.reference.startsWith('http')) {
      const evidencePath = path.join(root, evidence.reference);
      if (!fs.existsSync(evidencePath)) errors.push(`${feature.id}: missing evidence path ${evidence.reference}`);
    }
    if (feature.status === 'complete' && evidence?.status !== 'complete') errors.push(`${feature.id}: completed claim lacks complete ${dimension} evidence`);
  }
}
const core = (ledger.features ?? []).filter((f) => f.spec === 'Core');
if (core.length < 5 || core.some((f) => !f.owner || !f.status)) errors.push('at least five owned Core feature records are required');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-coverage.mjs'), '--check'], { stdio: 'inherit' });
console.log(`coverage gate passed: ${ledger.features.length} feature records`);
