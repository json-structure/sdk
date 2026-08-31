import fs from 'node:fs';
import path from 'node:path';
import { CONTRACT_VERSION, DIMENSIONS, TEST_FACETS, loadCoverageInputs, validateCoverage } from '../src/coverage-contract.mjs';

const projectRoot = process.cwd();
const generatedRoot = path.join(projectRoot, 'coverage', 'generated');
const inputs = loadCoverageInputs(projectRoot);

function applicable(requirementId, dimension, facet, kinds) {
  return inputs.manifest.evidence.filter((entry) =>
    kinds.includes(entry.kind) && entry.dimensions.includes(dimension) &&
    entry.requirements.includes(requirementId) && (!facet || entry.facet === facet));
}

function claim(requirementId, dimension, facet) {
  const concrete = applicable(requirementId, dimension, facet, facet ? ['test'] : ['implementation', 'test']);
  if (concrete.length) return { status: 'partial', ids: concrete.map((entry) => entry.id).sort() };
  const rationale = applicable(requirementId, dimension, facet, ['rationale']);
  return { status: 'gap', ids: rationale.map((entry) => entry.id).sort() };
}

const features = inputs.records.map((record) => {
  const evidence = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, claim(record.id, dimension)]));
  evidence.tests.facets = Object.fromEntries(TEST_FACETS.map((facet) => [facet, claim(record.id, 'tests', facet)]));
  return { ...record, status: Object.values(evidence).some((entry) => entry.status === 'partial') ? 'partial' : 'gap', evidence };
});
const ledger = {
  policy: {
    version: CONTRACT_VERSION,
    inventory: 'coverage/inventory.json',
    evidenceManifest: 'coverage/evidence-manifest.json',
    completeRequiresAllDimensions: true,
    completeRequiresAllTestFacets: true
  },
  features
};
const gaps = {
  generatedFrom: ['coverage/inventory.json', 'coverage/evidence-manifest.json'],
  interpretationQuestions: inputs.inventory.interpretationQuestions,
  incompleteRecords: features.filter((feature) => feature.status !== 'complete').map((feature) => ({
    id: feature.id,
    spec: feature.spec,
    status: feature.status,
    incompleteDimensions: DIMENSIONS.filter((dimension) => feature.evidence[dimension].status !== 'complete'),
    incompleteTestFacets: TEST_FACETS.filter((facet) => feature.evidence.tests.facets[facet].status !== 'complete')
  }))
};

const counts = {};
for (const feature of features) counts[feature.spec] = { ...(counts[feature.spec] ?? {}), [feature.status]: ((counts[feature.spec] ?? {})[feature.status] ?? 0) + 1 };
const lines = [
  '# Phase 1 specification coverage', '',
  `Generated from the checked source inventory and evidence manifest (${features.length} atomic requirement records).`, '',
  '| ID | Specification | Exact normative source | Policy | Status |',
  '|---|---|---|---|---|'
];
for (const feature of features) lines.push(`| ${feature.id} | ${feature.spec} | ${feature.normativeSources.map((source) => `${source.source}${source.anchor}`).join('<br>')} | ${feature.policy} | ${feature.status} |`);
lines.push('', '## Counts', '', '| Specification | Complete | Partial | Gap | Pending | Unsupported | Total |', '|---|---:|---:|---:|---:|---:|---:|');
for (const [spec, row] of Object.entries(counts)) lines.push(`| ${spec} | ${row.complete ?? 0} | ${row.partial ?? 0} | ${row.gap ?? 0} | ${row.pending ?? 0} | ${row.unsupported ?? 0} | ${Object.values(row).reduce((sum, value) => sum + value, 0)} |`);
lines.push('', '## Policy', '', 'A record is partial only when its manifest contains requirement-applicable implementation or executable-test evidence. Unimplemented dimensions and facets are gaps with rationale IDs. Shared semantic records retain two independently validated normative anchors; draft-specific differences are delta records.');

const outputs = new Map([
  ['ledger.json', `${JSON.stringify(ledger, null, 2)}\n`],
  ['gaps.json', `${JSON.stringify(gaps, null, 2)}\n`],
  ['COVERAGE.md', `${lines.join('\n')}\n`]
]);
if (process.argv.includes('--check')) {
  for (const [name, content] of outputs) {
    const outputPath = path.join(generatedRoot, name);
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== content) {
      console.error(`coverage/generated/${name} is stale; run npm run coverage:generate`);
      process.exit(1);
    }
  }
  const errors = validateCoverage({ projectRoot, ...inputs, ledger });
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
} else {
  for (const obsolete of ['COVERAGE.md', 'gaps.json', 'ledger.json']) fs.rmSync(path.join(projectRoot, 'coverage', obsolete), { force: true });
  fs.mkdirSync(generatedRoot, { recursive: true });
  for (const entry of fs.readdirSync(generatedRoot)) if (!outputs.has(entry)) fs.rmSync(path.join(generatedRoot, entry), { recursive: true, force: true });
  for (const [name, content] of outputs) fs.writeFileSync(path.join(generatedRoot, name), content);
}
