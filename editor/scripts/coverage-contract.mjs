import fs from 'node:fs';
import path from 'node:path';

export const CONTRACT_VERSION = 4;
export const STATUSES = Object.freeze(['complete', 'partial', 'gap', 'unsupported', 'pending']);
export const DIMENSIONS = Object.freeze(['editing', 'inspection', 'diagnostics', 'roundtrip', 'tests']);
export const TEST_FACETS = Object.freeze(['positive', 'negative', 'incomplete', 'hostParity']);
export const GENERATED_ARTIFACTS = Object.freeze([
  'coverage/generated/ledger.json',
  'coverage/generated/gaps.json',
  'coverage/generated/COVERAGE.md'
]);
export const ALLOWED_COVERAGE_ROOT_FILES = Object.freeze([
  'inventory.json',
  'test-cases.json'
]);

const ID_PATTERN = /^[a-z][A-Za-z0-9.-]+$/;
const ANCHOR_PATTERN = /^#[A-Za-z][A-Za-z0-9._:-]*$/;
const SOURCE_PATTERN = /^[^\\:]+\.md$/;

export function resolveNormativeRoot(projectRoot, inventory, environment = process.env) {
  const candidates = [];
  if (environment.JSON_STRUCTURE_SPEC_ROOT) candidates.push(environment.JSON_STRUCTURE_SPEC_ROOT);
  if (inventory.normativeRoot) candidates.push(path.resolve(projectRoot, inventory.normativeRoot));
  candidates.push(path.resolve(projectRoot, '..', '..', '..'));
  candidates.push(path.resolve(projectRoot, '..', '..'));

  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (Object.values(inventory.specs ?? {}).every((source) => fs.existsSync(path.join(root, source)))) return root;
  }
  throw new Error(`normative specification root is unreachable; set JSON_STRUCTURE_SPEC_ROOT or normativeRoot (checked: ${candidates.map((candidate) => path.resolve(candidate)).join(', ')})`);
}

export function parseHeadingAnchors(markdown) {
  return new Set([...markdown.matchAll(/^#{1,6}\s+.+?\s+\{(#[A-Za-z][A-Za-z0-9._:-]*)\}\s*$/gm)].map((match) => match[1]));
}

export function expandInventory(inventory) {
  const expand = (family) => Object.entries(family.items ?? {}).map(([suffix, item]) => {
    const value = typeof item === 'string' ? { requirement: item } : item;
    return {
      id: `${family.prefix}.${suffix}`,
      spec: family.spec,
      normativeSource: inventory.specs?.[family.spec],
      anchor: value.anchor ?? family.anchor,
      category: value.category ?? suffix,
      policy: value.policy ?? family.policy ?? 'normative',
      reconciliation: value.reconciliation ?? family.reconciliation ?? null,
      requirement: value.requirement
    };
  });
  return [
    ...(inventory.families ?? []).flatMap(expand),
    ...(inventory.sharedFamilies ?? []).flatMap((family) => expand({ ...family, spec: 'Shared Semantic Model' })),
    ...(inventory.deltas ?? []).flatMap(expand)
  ];
}

export function validateContract({ projectRoot, inventory, ledger, testCases, normativeRoot, checkArtifacts = true }) {
  const errors = [];
  const statusSet = new Set(STATUSES);
  const records = expandInventory(inventory);
  const inventoryIds = new Set();
  const caseIds = new Set();
  const casesByRequirement = new Map();

  if (inventory.version !== CONTRACT_VERSION) errors.push(`inventory version must be ${CONTRACT_VERSION}`);
  if (ledger.policy?.version !== CONTRACT_VERSION) errors.push(`ledger policy version must be ${CONTRACT_VERSION}`);
  if (!Array.isArray(testCases?.cases)) errors.push('test case manifest cases must be an array');
  for (const testCase of testCases?.cases ?? []) {
    if (!ID_PATTERN.test(testCase.id ?? '') || caseIds.has(testCase.id)) errors.push(`duplicate or malformed evidence case ID: ${testCase.id ?? '<missing>'}`);
    caseIds.add(testCase.id);
    if (!TEST_FACETS.includes(testCase.facet)) errors.push(`${testCase.id}: invalid evidence facet`);
    if (typeof testCase.file !== 'string' || typeof testCase.test !== 'string') errors.push(`${testCase.id}: malformed executable test reference`);
    for (const requirementId of testCase.requirements ?? []) {
      const mapped = casesByRequirement.get(requirementId) ?? [];
      mapped.push(testCase);
      casesByRequirement.set(requirementId, mapped);
    }
  }

  const anchorsBySource = new Map();
  for (const [spec, source] of Object.entries(inventory.specs ?? {})) {
    if (!SOURCE_PATTERN.test(source)) errors.push(`invalid normative source for ${spec}: ${source}`);
    const sourcePath = path.join(normativeRoot, source);
    if (!fs.existsSync(sourcePath)) errors.push(`missing normative source for ${spec}: ${source}`);
    else anchorsBySource.set(source, parseHeadingAnchors(fs.readFileSync(sourcePath, 'utf8')));
  }

  for (const record of records) {
    if (!ID_PATTERN.test(record.id) || inventoryIds.has(record.id)) errors.push(`duplicate or malformed inventory ID: ${record.id}`);
    inventoryIds.add(record.id);
    if (!record.normativeSource || !inventory.specs?.[record.spec]) errors.push(`${record.id}: unknown or missing normative source`);
    if (!ANCHOR_PATTERN.test(record.anchor ?? '') || !anchorsBySource.get(record.normativeSource)?.has(record.anchor)) errors.push(`${record.id}: missing or stale exact anchor ${record.anchor ?? '<missing>'}`);
    if (typeof record.requirement !== 'string' || !record.requirement.trim()) errors.push(`${record.id}: malformed requirement`);
    if (!['normative', 'shared', 'delta'].includes(record.policy)) errors.push(`${record.id}: invalid policy`);
    if ((record.policy === 'shared' || record.policy === 'delta') && !record.reconciliation) errors.push(`${record.id}: missing reconciliation metadata`);
  }

  const ledgerIds = new Set();
  for (const feature of ledger.features ?? []) {
    if (ledgerIds.has(feature.id)) errors.push(`duplicate ledger ID: ${feature.id}`);
    ledgerIds.add(feature.id);
    const expected = records.find((record) => record.id === feature.id);
    if (!expected) errors.push(`extra ledger record: ${feature.id}`);
    else for (const field of ['spec', 'normativeSource', 'anchor', 'category', 'policy', 'reconciliation', 'requirement']) {
      if (JSON.stringify(feature[field] ?? null) !== JSON.stringify(expected[field] ?? null)) errors.push(`${feature.id}: source-contract drift in ${field}`);
    }
    if (!statusSet.has(feature.status)) errors.push(`${feature.id}: invalid status`);
    for (const dimension of DIMENSIONS) {
      const evidence = feature.evidence?.[dimension];
      if (!evidence || !statusSet.has(evidence.status) || !Array.isArray(evidence.ids) || evidence.ids.length === 0) errors.push(`${feature.id}: malformed ${dimension} evidence`);
      if (evidence?.status === 'partial' && evidence.ids.every((id) => id.startsWith('rationale.'))) errors.push(`${feature.id}: partial ${dimension} lacks concrete evidence`);
      if (feature.status === 'complete' && evidence?.status !== 'complete') errors.push(`${feature.id}: false complete claim for ${dimension}`);
    }
    for (const facet of TEST_FACETS) {
      const facetEvidence = feature.evidence?.tests?.facets?.[facet];
      if (!facetEvidence || !statusSet.has(facetEvidence.status) || !Array.isArray(facetEvidence.ids) || facetEvidence.ids.length === 0) errors.push(`${feature.id}: malformed ${facet} test facet`);
      for (const caseId of facetEvidence?.ids ?? []) {
        const testCase = (testCases?.cases ?? []).find((candidate) => candidate.id === caseId);
        if (caseId.startsWith('case.') && !testCase) errors.push(`${feature.id}: missing evidence case ID ${caseId}`);
        if (testCase && (!testCase.requirements?.includes(feature.id) || testCase.facet !== facet)) errors.push(`${feature.id}: unrelated evidence case ID ${caseId}`);
      }
      if (feature.status === 'complete' && facetEvidence?.status !== 'complete') errors.push(`${feature.id}: false complete claim for ${facet}`);
    }
  }
  for (const id of inventoryIds) if (!ledgerIds.has(id)) errors.push(`missing normative inventory record: ${id}`);
  for (const requirementId of casesByRequirement.keys()) if (!inventoryIds.has(requirementId)) errors.push(`evidence case maps to unknown requirement: ${requirementId}`);

  if (checkArtifacts) {
    const generatedRoot = path.join(projectRoot, 'coverage', 'generated');
    const actual = fs.existsSync(generatedRoot) ? fs.readdirSync(generatedRoot).map((name) => `coverage/generated/${name}`).sort() : [];
    const expected = [...GENERATED_ARTIFACTS].sort();
    for (const artifact of expected) if (!actual.includes(artifact)) errors.push(`missing generated artifact: ${artifact}`);
    for (const artifact of actual) if (!expected.includes(artifact)) errors.push(`unexpected generated artifact: ${artifact}`);
    const coverageRootFiles = fs.readdirSync(path.join(projectRoot, 'coverage'), { withFileTypes: true })
      .filter((entry) => entry.isFile()).map((entry) => entry.name);
    for (const file of coverageRootFiles) if (!ALLOWED_COVERAGE_ROOT_FILES.includes(file)) errors.push(`unexpected spec coverage root file: coverage/${file}`);
  }
  return errors;
}