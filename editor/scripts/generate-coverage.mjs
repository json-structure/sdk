import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const ledgerPath = path.join(root, 'coverage', 'ledger.json');
const outputPath = path.join(root, 'coverage', 'COVERAGE.md');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const lines = ['# Phase 0 specification coverage', '', `Generated from \`coverage/ledger.json\` (${ledger.features.length} feature records).`, '', '| ID | Spec | Feature | Owner | Status | Evidence |', '|---|---|---|---|---|---|'];
for (const f of ledger.features) lines.push(`| ${f.id} | ${f.spec} | ${f.feature} | ${f.owner} | ${f.status} | ${Object.entries(f.evidence).map(([k, v]) => `${k}: ${v.status} (${v.reference})`).join('; ')} |`);
lines.push('', '## Policy', '', 'This initial milestone permits explicit `partial`, `gap`, `unsupported`, and `pending` records. It fails missing ownership, malformed evidence, false `complete` claims, duplicate IDs, fewer than five seeded Core records, and stale generated output.');
const generated = `${lines.join('\n')}\n`;
if (process.argv.includes('--check')) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== generated) { console.error('coverage/COVERAGE.md is stale; run npm run coverage:generate'); process.exit(1); }
} else fs.writeFileSync(outputPath, generated);
