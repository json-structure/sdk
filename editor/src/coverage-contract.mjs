import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const CONTRACT_VERSION = 5;
export const STATUSES = Object.freeze(['complete', 'partial', 'gap', 'unsupported', 'pending']);
export const DIMENSIONS = Object.freeze(['editing', 'inspection', 'diagnostics', 'roundtrip', 'tests']);
export const TEST_FACETS = Object.freeze(['positive', 'negative', 'incomplete', 'hostParity']);
export const GENERATED_FILES = Object.freeze(['COVERAGE.md', 'gaps.json', 'ledger.json']);
export const SOURCE_FILES = Object.freeze(['evidence-manifest.json', 'inventory.json']);

const ID_PATTERN = /^[a-z][A-Za-z0-9.-]+$/;
const ANCHOR_PATTERN = /^#[A-Za-z][A-Za-z0-9._:-]*$/;
const SOURCE_PATTERN = /^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))[^:]+\.md$/;

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function resolveNormativeRoot(projectRoot, inventory, environment = process.env) {
  const candidates = [environment.JSON_STRUCTURE_SPEC_ROOT, inventory.normativeRoot && path.resolve(projectRoot, inventory.normativeRoot)]
    .filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    const sources = Object.values(inventory.specs ?? {});
    if (sources.length > 0 && sources.every((source) => SOURCE_PATTERN.test(source) && fs.existsSync(path.join(root, source)))) return root;
  }
  throw new Error(`normative specification root is unreachable; configure JSON_STRUCTURE_SPEC_ROOT or inventory.normativeRoot (checked: ${candidates.map((candidate) => path.resolve(candidate)).join(', ') || 'none'})`);
}

export function parseHeadingAnchors(markdown) {
  return new Set([...markdown.matchAll(/^#{1,6}\s+.+?\s+\{(#[A-Za-z][A-Za-z0-9._:-]*)\}\s*$/gm)].map((match) => match[1]));
}

const FALLBACK_ANCHORS = Object.freeze({
  'core.schema': '#schema-elements', 'core.type': '#data-types', 'core.compound': '#compound-types',
  'core.document': '#document-structure', 'core.rule': '#schema-declarations', 'core.keyword': '#structural-keywords',
  'core.annotation': '#type-annotation-keywords', 'alternate-names': '#keywords', 'conditional-composition': '#conditional-composition-keywords',
  import: '#import-and-importdefs-keywords', relations: '#relations', units: '#symbol-annotations', validation: '#validation-keywords',
  model: '#annotation-model', concepts: '#concepts', observation: '#observation-annotations', binding: '#coded-value-annotations',
  temporal: '#temporal-reference-annotations', spatial: '#spatial-reference-annotations', media: '#colorimetric-reference-annotations', processing: '#processing-conformance'
});
const TRAILING_QUALIFIERS = /-(?:wire|range|lexical|default|form|value|values|placement|required|resolution|evaluation|effect|types|type|only|map|array|scalar|string|boolean|presence|processing|compatibility|prohibition|invariance|unique|nonempty|contents|uri|valid|numeric|reference|keyword|closed|open)$/;

function selectAnchor(id, suffix, requirement, prefix, explicitAnchor, available) {
  if (explicitAnchor) return explicitAnchor;
  const tokens = [suffix, id.split('.').at(-1), ...[...requirement.matchAll(/`([^`]+)`/g)].map((match) => match[1])];
  for (const token of tokens) {
    let normalized = String(token).replace(/^\$/, '').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/[^A-Za-z0-9-]/g, '-');
    while (normalized) {
      for (const candidate of [`#${normalized}`, `#${normalized}-keyword`, `#the-${normalized}-keyword`]) if (available.has(candidate)) return candidate;
      const shorter = normalized.replace(TRAILING_QUALIFIERS, '');
      if (shorter === normalized) break;
      normalized = shorter;
    }
  }
  if (prefix === 'core.rule' && suffix.startsWith('union-')) return '#unions';
  if (prefix === 'core.rule' && suffix.startsWith('identifier-')) return '#identifier-rules';
  if (prefix === 'media' && suffix.startsWith('audio-')) return '#audio-channels';
  if (prefix === 'media' && suffix.startsWith('spectral-')) return '#spectral-bands';
  if (prefix === 'media' && suffix.startsWith('color-')) return '#color-spaces';
  return FALLBACK_ANCHORS[prefix];
}

export function expandInventory(inventory, anchorsBySpec) {
  const expand = (family, policy = 'normative') => Object.entries(family.items ?? {}).map(([suffix, item]) => {
    const value = typeof item === 'string' ? { requirement: item } : item;
    const id = `${family.prefix}.${suffix}`;
    const specs = family.specs ?? [family.spec];
    const normativeSources = specs.map((spec) => ({
      spec,
      source: inventory.specs?.[spec],
      anchor: selectAnchor(id, suffix, value.requirement, family.prefix, value.anchors?.[spec] ?? value.anchor ?? family.anchors?.[spec] ?? family.anchor, anchorsBySpec.get(spec) ?? new Set())
    }));
    return {
      id, spec: specs.length === 1 ? specs[0] : specs.join(' + '), normativeSources,
      category: value.category ?? suffix, policy: value.policy ?? policy,
      reconciliation: value.reconciliation ?? family.reconciliation ?? (policy === 'shared'
        ? 'Independent anchor comparison found equivalent normative behavior in both drafts; one shared editor requirement applies to both sources.'
        : null),
      requirement: value.requirement
    };
  });
  return [
    ...(inventory.families ?? []).flatMap((family) => expand(family)),
    ...(inventory.sharedSemanticFamilies ?? []).flatMap((family) => expand({ ...family, specs: ['Characteristics', 'Semantic Annotations'] }, 'shared')),
    ...(inventory.deltas ?? []).flatMap((family) => expand(family, 'delta'))
  ];
}

function evidenceApplies(entry, requirementId, dimension, facet) {
  return entry && entry.requirements.includes(requirementId) && entry.dimensions.includes(dimension) && (!facet || entry.facet === facet);
}

function sourceFile(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function hasExportedSymbol(file, text, symbol) {
  const matches = [];
  const visit = (node) => {
    const exported = ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && 'name' in node && node.name && ts.isIdentifier(node.name) && node.name.text === symbol) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(file, text));
  return matches.length === 1;
}

function hasTestName(file, text, testName) {
  let matches = 0;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['it', 'test'].includes(node.expression.text)) {
      const title = node.arguments[0];
      if (title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) && title.text === testName) matches++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(file, text));
  return matches === 1;
}

export function loadCoverageInputs(projectRoot, environment = process.env) {
  const inventory = readJson(path.join(projectRoot, 'coverage', 'inventory.json'));
  const manifest = readJson(path.join(projectRoot, 'coverage', 'evidence-manifest.json'));
  const normativeRoot = resolveNormativeRoot(projectRoot, inventory, environment);
  const anchorsBySpec = new Map();
  for (const [spec, source] of Object.entries(inventory.specs ?? {})) anchorsBySpec.set(spec, parseHeadingAnchors(fs.readFileSync(path.join(normativeRoot, source), 'utf8')));
  const records = expandInventory(inventory, anchorsBySpec);
  return { inventory, manifest: expandEvidenceManifest(manifest, records), normativeRoot, anchorsBySpec, records };
}

export function expandEvidenceManifest(manifest, records) {
  const evidence = [];
  for (const rule of manifest.rules ?? []) {
    const matched = records.filter((record) => rule.requirementPrefixes?.some((prefix) => record.id.startsWith(prefix)) ?? rule.requirements?.includes(record.id));
    for (const record of matched) evidence.push({
      ...rule,
      id: `${rule.idPrefix}.${record.id}`,
      requirements: [record.id]
    });
  }
  return { ...manifest, evidence: [...(manifest.evidence ?? []), ...evidence] };
}

export function validateCoverage({ projectRoot, inventory, manifest, records, ledger, anchorsBySpec, checkArtifacts = true }) {
  const errors = [];
  if (inventory.version !== CONTRACT_VERSION) errors.push(`inventory version must be ${CONTRACT_VERSION}`);
  if (manifest.version !== CONTRACT_VERSION) errors.push(`evidence manifest version must be ${CONTRACT_VERSION}`);
  if (ledger.policy?.version !== CONTRACT_VERSION) errors.push(`ledger policy version must be ${CONTRACT_VERSION}`);
  const recordIds = new Set();
  for (const record of records) {
    if (!ID_PATTERN.test(record.id) || recordIds.has(record.id)) errors.push(`duplicate or malformed inventory ID: ${record.id}`);
    recordIds.add(record.id);
    if (typeof record.requirement !== 'string' || !record.requirement.trim()) errors.push(`${record.id}: malformed requirement`);
    if (!['normative', 'shared', 'delta'].includes(record.policy)) errors.push(`${record.id}: invalid policy`);
    if (record.policy === 'shared' && record.normativeSources.length !== 2) errors.push(`${record.id}: shared concept requires two independently anchored sources`);
    if ((record.policy === 'shared' || record.policy === 'delta') && !record.reconciliation) errors.push(`${record.id}: missing reconciliation metadata`);
    for (const source of record.normativeSources) if (!SOURCE_PATTERN.test(source.source ?? '') || !ANCHOR_PATTERN.test(source.anchor ?? '') || !anchorsBySpec?.get(source.spec)?.has(source.anchor)) errors.push(`${record.id}: missing or stale exact normative heading anchor for ${source.spec}: ${source.anchor ?? '<missing>'}`);
  }
  const evidence = new Map();
  for (const entry of manifest.evidence ?? []) {
    if (!ID_PATTERN.test(entry.id ?? '') || evidence.has(entry.id)) errors.push(`duplicate or malformed evidence ID: ${entry.id ?? '<missing>'}`);
    evidence.set(entry.id, entry);
    if (!['implementation', 'rationale', 'test'].includes(entry.kind)) errors.push(`${entry.id}: invalid evidence kind`);
    if (!Array.isArray(entry.requirements) || entry.requirements.length === 0) errors.push(`${entry.id}: missing evidence requirements`);
    for (const requirement of entry.requirements ?? []) if (!recordIds.has(requirement)) errors.push(`${entry.id}: evidence maps to unknown requirement ${requirement}`);
    if (!Array.isArray(entry.dimensions) || entry.dimensions.some((dimension) => !DIMENSIONS.includes(dimension))) errors.push(`${entry.id}: invalid evidence dimensions`);
    if (entry.kind === 'test' && (!TEST_FACETS.includes(entry.facet) || typeof entry.file !== 'string' || typeof entry.test !== 'string')) errors.push(`${entry.id}: malformed executable test reference`);
    if (entry.file) {
      const file = path.join(projectRoot, entry.file);
      if (!fs.existsSync(file)) errors.push(`${entry.id}: missing evidence artifact ${entry.file}`);
      else {
        const text = fs.readFileSync(file, 'utf8');
        if (entry.test && !hasTestName(file, text, entry.test)) errors.push(`${entry.id}: executable test name is missing or ambiguous in ${entry.file}`);
        if (entry.symbol && !hasExportedSymbol(file, text, entry.symbol)) errors.push(`${entry.id}: exported implementation symbol is missing or ambiguous in ${entry.file}`);
      }
    }
  }
  const ledgerIds = new Set();
  for (const feature of ledger.features ?? []) {
    if (ledgerIds.has(feature.id)) errors.push(`duplicate ledger ID: ${feature.id}`);
    ledgerIds.add(feature.id);
    const expected = records.find((record) => record.id === feature.id);
    if (!expected) errors.push(`extra ledger record: ${feature.id}`);
    else for (const field of ['spec', 'normativeSources', 'category', 'policy', 'reconciliation', 'requirement']) if (JSON.stringify(feature[field] ?? null) !== JSON.stringify(expected[field] ?? null)) errors.push(`${feature.id}: source-contract drift in ${field}`);
    if (!STATUSES.includes(feature.status)) errors.push(`${feature.id}: invalid status`);
    for (const dimension of DIMENSIONS) {
      const claim = feature.evidence?.[dimension];
      if (!claim || !STATUSES.includes(claim.status) || !Array.isArray(claim.ids) || claim.ids.length === 0) errors.push(`${feature.id}: malformed ${dimension} evidence`);
      for (const id of claim?.ids ?? []) if (!evidenceApplies(evidence.get(id), feature.id, dimension)) errors.push(`${feature.id}: missing, duplicate, or unrelated ${dimension} evidence ID ${id}`);
      if (claim?.status === 'partial' && !(claim.ids ?? []).some((id) => ['implementation', 'test'].includes(evidence.get(id)?.kind))) errors.push(`${feature.id}: partial ${dimension} lacks concrete evidence`);
      if (claim?.status === 'gap' && !(claim.ids ?? []).some((id) => evidence.get(id)?.kind === 'rationale')) errors.push(`${feature.id}: gap ${dimension} lacks rationale evidence`);
      if (feature.status === 'complete' && claim?.status !== 'complete') errors.push(`${feature.id}: false complete claim for ${dimension}`);
    }
    for (const facet of TEST_FACETS) {
      const claim = feature.evidence?.tests?.facets?.[facet];
      if (!claim || !STATUSES.includes(claim.status) || !Array.isArray(claim.ids) || claim.ids.length === 0) errors.push(`${feature.id}: malformed ${facet} test facet`);
      for (const id of claim?.ids ?? []) if (!evidenceApplies(evidence.get(id), feature.id, 'tests', facet)) errors.push(`${feature.id}: missing, duplicate, or unrelated ${facet} evidence ID ${id}`);
      if (claim?.status === 'partial' && !(claim.ids ?? []).some((id) => evidence.get(id)?.kind === 'test')) errors.push(`${feature.id}: partial ${facet} lacks executable test evidence`);
      if (feature.status === 'complete' && claim?.status !== 'complete') errors.push(`${feature.id}: false complete claim for ${facet}`);
    }
  }
  for (const id of recordIds) if (!ledgerIds.has(id)) errors.push(`missing normative inventory record: ${id}`);
  if (checkArtifacts) {
    const coverageRoot = path.join(projectRoot, 'coverage');
    const rootFiles = fs.readdirSync(coverageRoot, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
    for (const file of rootFiles) if (!SOURCE_FILES.includes(file)) errors.push(`unexpected spec coverage source artifact: coverage/${file}`);
    const generatedRoot = path.join(coverageRoot, 'generated');
    const generatedFiles = fs.existsSync(generatedRoot) ? fs.readdirSync(generatedRoot, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name) : [];
    for (const file of GENERATED_FILES) if (!generatedFiles.includes(file)) errors.push(`missing generated spec artifact: coverage/generated/${file}`);
    for (const file of generatedFiles) if (!GENERATED_FILES.includes(file)) errors.push(`unexpected generated spec artifact: coverage/generated/${file}`);
  }
  return errors;
}